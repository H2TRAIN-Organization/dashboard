<#
.SYNOPSIS
  Runner reproducible de la capa de datos Kubios (migracion consolidada K49).

.DESCRIPTION
  Levanta un PostgreSQL 16 efimero en Docker local, sin red remota, sin puertos publicados
  y sin volumenes nombrados; aprovisiona un bootstrap sintetico minimo que imita los objetos
  de Supabase que usan las migraciones (incluido un fixture realista de users y las seis
  tablas de salud); aplica las migraciones REALES de privacidad T025/T053 y despues TODAS
  las migraciones Kubios en orden cronologico; y ejecuta comprobaciones de privilegios,
  restricciones y contrato de las RPC.

  - No usa credenciales: el contenedor arranca con POSTGRES_HOST_AUTH_METHOD=trust y solo
    se accede por el socket Unix dentro del contenedor (listen_addresses vacio, --network none).
  - No descarga imagenes ni accede a red remota. La imagen debe existir en el daemon local.
  - Los datos de prueba son UserID/UUID y bytes ficticios.
  - Cleanup garantizado: elimina UNICAMENTE el contenedor que crea esta ejecucion, previa
    verificacion del prefijo de nombre y de la label cerbero.test=kubios-db. Nunca ejecuta
    docker prune ni elimina contenedores/volumenes ajenos.
  - Sale con codigo 0 si todas las comprobaciones pasan; 1 si alguna falla; 2 si el entorno
    no permite ejecutar (Docker, imagen o migraciones).

.PARAMETER Image
  Imagen local de PostgreSQL. Por defecto postgres:16. Debe existir ya en el daemon.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\kubios-db\run-kubios-db-tests.ps1

.NOTES
  Requiere PowerShell 5.1 o superior y Docker Desktop en ejecucion. Windows.
#>
[CmdletBinding()]
param(
  [string]$Image = 'postgres:16'
)

$ErrorActionPreference = 'Continue'
$script:ExitCode = 2
$script:Container = $null
$script:ContainerPrefix = 'cerbero-kubios-db-'
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:MigrationsDir = Join-Path $script:RepoRoot 'supabase\migrations'
$script:ExpectedMigrations = @(
  '20261103100413_kubios_production_core.sql'
)
# Migraciones de privacidad reales que deben aplicarse antes de Kubios para
# probar que T025/T053 cierran la exposicion heredada de users y salud.
$script:PrivacyMigrations = @(
  '20261021130000_t025_health_tables_private.sql',
  '20261021150000_t053_users_private.sql'
)

function Write-Step([string]$Message) {
  Write-Host "==> $Message"
}

function Write-Ok([string]$Message) {
  Write-Host "    OK  $Message"
}

function Write-Bad([string]$Message) {
  Write-Host "    FAIL $Message" -ForegroundColor Red
}

function Invoke-Psql {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [switch]$Quiet
  )
  $dockerArgs = @('exec', '-i', $script:Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'kubios_test', '-f', '-')
  if ($Quiet) {
    $dockerArgs = @('exec', '-i', $script:Container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'kubios_test', '-f', '-')
  }
  $lines = @($Sql | & docker @dockerArgs 2>&1 | ForEach-Object { "$_" })
  $code = $LASTEXITCODE
  return [pscustomobject]@{
    ExitCode = $code
    Lines    = $lines
    Text     = ($lines -join [Environment]::NewLine)
  }
}

function Show-PsqlResult($Result) {
  foreach ($line in $Result.Lines) {
    Write-Host $line
  }
}

function Remove-TestContainer {
  if (-not $script:Container) { return }
  $name = $script:Container
  $labelsJson = @(& docker inspect --format '{{json .Config.Labels}}' $name 2>$null | ForEach-Object { "$_" }) -join ''
  $inspectCode = $LASTEXITCODE
  $labelOk = $false
  if ($inspectCode -eq 0 -and $labelsJson) {
    try {
      $labels = $labelsJson | ConvertFrom-Json
      $labelOk = ($labels.'cerbero.test' -eq 'kubios-db')
    }
    catch {
      $labelOk = $false
    }
  }
  $prefixOk = $name.StartsWith($script:ContainerPrefix, [System.StringComparison]::Ordinal)
  if ($inspectCode -eq 0 -and $labelOk -and $prefixOk) {
    & docker rm -f $name 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Step "cleanup: contenedor $name eliminado"
    }
    else {
      Write-Warning "cleanup: no se pudo eliminar el contenedor $name"
    }
  }
  else {
    Write-Warning "cleanup: no se elimina '$name' (label/prefix no verificados; inspeccion=$inspectCode)"
  }
  $script:Container = $null
}

try {
  Write-Step 'K49 - runner de la capa de datos Kubios'
  Write-Host "    migraciones: supabase/migrations"
  Write-Host "    imagen:      $Image (local)"

  # ---------- Precondiciones ----------
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI no esta disponible en PATH.'
  }
  $dockerVersion = @(& docker version --format '{{.Server.Version}}' 2>&1 | ForEach-Object { "$_" }) -join ''
  if ($LASTEXITCODE -ne 0) {
    throw "El daemon de Docker no responde: $dockerVersion"
  }
  Write-Ok "Docker server $($dockerVersion.Trim())"
  & docker image inspect $Image --format '{{.Id}}' 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "La imagen '$Image' no existe en el daemon local. Este runner no descarga imagenes; carguela previamente."
  }

  if (-not (Test-Path -LiteralPath $script:MigrationsDir -PathType Container)) {
    throw 'No existe el directorio supabase/migrations bajo la raiz del repositorio.'
  }
  foreach ($privacyMigration in $script:PrivacyMigrations) {
    $privacyPath = Join-Path $script:MigrationsDir $privacyMigration
    if (-not (Test-Path -LiteralPath $privacyPath -PathType Leaf)) {
      throw "No existe la migracion de privacidad requerida: $privacyMigration"
    }
  }
  $migrations = @(Get-ChildItem -LiteralPath $script:MigrationsDir -Filter '*kubios*.sql' -File | Sort-Object Name)
  if ($migrations.Count -eq 0) {
    throw 'No se encontraron migraciones *kubios*.sql en supabase/migrations.'
  }
  $expectedInOrder = @($migrations | Where-Object { $script:ExpectedMigrations -contains $_.Name } | ForEach-Object { $_.Name })
  if (($expectedInOrder -join '|') -ne ($script:ExpectedMigrations -join '|')) {
    throw "El conjunto/orden de migraciones Kubios no coincide con el esperado. Encontrado: $($expectedInOrder -join ', ')"
  }
  Write-Ok "migraciones Kubios descubiertas: $($migrations.Count) (orden por nombre/timestamp)"

  # ---------- Contenedor efimero ----------
  $script:Container = $script:ContainerPrefix + ([guid]::NewGuid().ToString('N').Substring(0, 12))
  Write-Step "creando contenedor $($script:Container)"
  $runArgs = @(
    'run', '-d',
    '--name', $script:Container,
    '--label', 'cerbero.test=kubios-db',
    '--label', 'cerbero.task=K49',
    '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m',
    '--pull', 'never',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e', 'POSTGRES_USER=postgres',
    '-e', 'POSTGRES_DB=kubios_test',
    $Image,
    '-c', 'listen_addresses=',
    '-c', 'fsync=off',
    '-c', 'synchronous_commit=off'
  )
  $runOutput = @(& docker @runArgs 2>&1 | ForEach-Object { "$_" }) -join ''
  if ($LASTEXITCODE -ne 0) {
    throw "docker run fallo: $runOutput"
  }

  $ready = $false
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    # psql (no solo pg_isready) porque la imagen oficial arranca un servidor temporal
    # durante la inicializacion y luego lo reinicia; pg_isready puede ver ese instante.
    & docker exec $script:Container psql -X -A -t -U postgres -d kubios_test -c 'select 1' 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    $logs = @(& docker logs --tail 40 $script:Container 2>&1 | ForEach-Object { "$_" }) -join [Environment]::NewLine
    Show-PsqlResult ([pscustomobject]@{ Lines = @($logs -split [Environment]::NewLine) })
    throw 'PostgreSQL no acepto conexiones en 60 s.'
  }
  $pgVersion = @(& docker exec $script:Container psql -X -A -t -U postgres -d kubios_test -c 'show server_version' 2>&1 | ForEach-Object { "$_" }) -join ''
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo leer la version de PostgreSQL: $pgVersion"
  }
  Write-Ok "PostgreSQL $($pgVersion.Trim()) listo (socket local, sin TCP)"

  # ---------- Bootstrap sintetico minimo ----------
  # No es un Supabase completo: no hay PostgREST, GoTrue, JWT, auth.uid(), pg_cron ni vault.
  # Incluye un fixture realista minimo de users y las seis tablas de salud que
  # T025/T053 referencian, con la exposicion heredada que esas migraciones deben
  # cerrar. El estado previo se registra para comparar antes/despues.
  $bootstrapSql = @'
set client_min_messages = warning;

-- Roles base de Supabase, sinteticos: sin password (acceso solo por socket local y trust).
-- NOINHERIT imita a Supabase: el Data API hace SET ROLE explicito; la pertenencia no concede
-- privilegios de forma automatica. service_role lleva BYPASSRLS porque las tablas privadas
-- tienen RLS sin politicas y el servicio debe poder operar (igual que en Supabase).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- authenticator: rol de entrada del Data API. LOGIN sin password; miembro de los tres roles
-- de datos para poder hacer SET ROLE, sin heredar privilegios (NOINHERIT).
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

-- Fixture minimo realista de public.users: identidad integer con secuencia,
-- columnas sensibles y dos filas ficticias que usa la FK de user_member_links.
create table public.users (
  "UserID" serial primary key,
  "Username" text,
  "PasswordHash" text,
  "UUID" uuid,
  "Email" text
);
insert into public.users ("UserID", "Username", "PasswordHash", "UUID", "Email") values
  (2001, 'synthetic-user-2001', 'synthetic-password-hash-2001',
   '11111111-1111-4111-8111-111111111111', 'synthetic-2001@example.invalid'),
  (2002, 'synthetic-user-2002', 'synthetic-password-hash-2002',
   '22222222-2222-4222-8222-222222222222', 'synthetic-2002@example.invalid');
select setval(pg_get_serial_sequence('public.users', 'UserID'), 2002, true);

-- Las seis tablas de salud que T025 protege. La forma es minima pero incluye
-- id serial (secuencia real), username y una columna de datos por tabla.
create table public.insulindata (
  id serial primary key, username text, insulin numeric, recorded_at timestamptz
);
create table public.fooddata (
  id serial primary key, username text, carbs numeric, recorded_at timestamptz
);
create table public.exercisedata (
  id serial primary key, username text, minutes integer, recorded_at timestamptz
);
create table public.periodrecords (
  id serial primary key, username text, cycle_day integer, recorded_at timestamptz
);
create table public.mooddata (
  id serial primary key, username text, mood integer, recorded_at timestamptz
);
create table public.polar_data (
  id serial primary key, username text, heart_rate integer, recorded_at timestamptz
);

insert into public.insulindata (username, insulin, recorded_at)
  values ('synthetic-user-2001', 1.5, '2026-01-01T00:00:00Z');
insert into public.fooddata (username, carbs, recorded_at)
  values ('synthetic-user-2001', 30, '2026-01-01T00:00:00Z');
insert into public.exercisedata (username, minutes, recorded_at)
  values ('synthetic-user-2001', 20, '2026-01-01T00:00:00Z');
insert into public.periodrecords (username, cycle_day, recorded_at)
  values ('synthetic-user-2001', 7, '2026-01-01T00:00:00Z');
insert into public.mooddata (username, mood, recorded_at)
  values ('synthetic-user-2001', 4, '2026-01-01T00:00:00Z');
insert into public.polar_data (username, heart_rate, recorded_at)
  values ('synthetic-user-2001', 62, '2026-01-01T00:00:00Z');

-- Baseline de Supabase: los roles de la Data API tienen USAGE sobre public para resolver
-- las RPC por nombre. Las migraciones revocan EXECUTE y conceden solo a service_role, asi
-- que este grant no abre la superficie RPC.
grant usage on schema public to anon, authenticated, service_role;

-- Exposicion heredada que T025/T053 deben cerrar: privilegios de tabla y de
-- columna para PUBLIC/anon/authenticated, incluida una concesion solo de
-- columna en polar_data para ejercitar el REVOKE de columna de T025.
grant select on table public.users to public;
grant select ("PasswordHash") on table public.users to public;
grant select, insert, update, delete on table public.users to anon, authenticated;
grant select ("PasswordHash"), update ("PasswordHash") on table public.users to anon, authenticated;

grant all privileges on table
  public.insulindata, public.fooddata, public.exercisedata,
  public.periodrecords, public.mooddata
  to anon, authenticated;
grant all privileges on table public.polar_data to anon;
grant select (username, heart_rate, recorded_at), update (heart_rate)
  on table public.polar_data to authenticated;

grant select on table
  public.insulindata, public.fooddata, public.exercisedata,
  public.periodrecords, public.mooddata
  to public;
grant select (username) on table
  public.insulindata, public.fooddata, public.exercisedata,
  public.periodrecords, public.mooddata, public.polar_data
  to public;

-- Secuencias reales de users y de las seis tablas de salud: se conceden a los
-- roles publicos para comprobar que T025/T053 tambien las revocan.
do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array[
    'users', 'insulindata', 'fooddata', 'exercisedata',
    'periodrecords', 'mooddata', 'polar_data'
  ]
  loop
    v_sequence := pg_get_serial_sequence(
      format('public.%I', v_table),
      case when v_table = 'users' then 'UserID' else 'id' end
    );
    if v_sequence is not null then
      execute format(
        'grant usage, select on sequence %s to anon, authenticated, public',
        v_sequence
      );
    end if;
  end loop;
end
$$;

-- Politicas heredadas abiertas a PUBLIC/anon/authenticated en users y salud.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'users', 'insulindata', 'fooddata', 'exercisedata',
    'periodrecords', 'mooddata', 'polar_data'
  ]
  loop
    execute format(
      'create policy k49_legacy_public_read on public.%I for select using (true)',
      v_table
    );
    execute format(
      'create policy k49_legacy_anon_all on public.%I for all to anon using (true) with check (true)',
      v_table
    );
    execute format(
      'create policy k49_legacy_authenticated_all on public.%I for all to authenticated using (true) with check (true)',
      v_table
    );
  end loop;
end
$$;

-- Registro del estado efectivo ANTES de aplicar T025/T053. expected=actual
-- prueba que el fixture tenia realmente la exposicion que las migraciones
-- deben cerrar. No se concede nada a este esquema de prueba.
create schema kubios_precheck;
create table kubios_precheck.before (
  check_id text primary key,
  expected boolean not null,
  actual boolean not null
);

insert into kubios_precheck.before(check_id, expected, actual)
select 'table.' || r.role || '.' || t.name,
       not (r.role = 'authenticated' and t.name = 'polar_data'),
       has_table_privilege(r.role, format('public.%I', t.name), 'SELECT')
from (values ('anon'), ('authenticated')) as r(role)
cross join (values
  ('users'), ('insulindata'), ('fooddata'), ('exercisedata'),
  ('periodrecords'), ('mooddata'), ('polar_data')
) as t(name);

insert into kubios_precheck.before(check_id, expected, actual)
select 'column.' || r.role || '.' || t.name,
       true,
       has_column_privilege(r.role, format('public.%I', t.name), t.column_name, 'SELECT')
from (values ('anon'), ('authenticated')) as r(role)
cross join (values
  ('users', 'PasswordHash'),
  ('insulindata', 'username'),
  ('fooddata', 'username'),
  ('exercisedata', 'username'),
  ('periodrecords', 'username'),
  ('mooddata', 'username'),
  ('polar_data', 'username')
) as t(name, column_name);

insert into kubios_precheck.before(check_id, expected, actual)
select 'public.table.' || t.name,
       t.name <> 'polar_data',
       exists (
         select 1
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           cross join lateral aclexplode(c.relacl) a
          where n.nspname = 'public'
            and c.relname = t.name
            and c.relkind = 'r'
            and a.grantee = 0
            and a.privilege_type = 'SELECT'
       )
from (values
  ('users'), ('insulindata'), ('fooddata'), ('exercisedata'),
  ('periodrecords'), ('mooddata'), ('polar_data')
) as t(name);

insert into kubios_precheck.before(check_id, expected, actual)
select 'public.column.' || t.name,
       true,
       exists (
         select 1
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid
                              and a.attname = t.column_name
                              and not a.attisdropped
           cross join lateral aclexplode(a.attacl) x
          where n.nspname = 'public'
            and c.relname = t.name
            and x.grantee = 0
            and x.privilege_type = 'SELECT'
       )
from (values
  ('users', 'PasswordHash'),
  ('insulindata', 'username'),
  ('fooddata', 'username'),
  ('exercisedata', 'username'),
  ('periodrecords', 'username'),
  ('mooddata', 'username'),
  ('polar_data', 'username')
) as t(name, column_name);

insert into kubios_precheck.before(check_id, expected, actual)
select 'policy.' || t.name,
       true,
       exists (
         select 1
           from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = t.name
            and (
              p.roles is null
              or cardinality(p.roles) = 0
              or p.roles && array['public', 'anon', 'authenticated']::name[]
            )
       )
from (values
  ('users'), ('insulindata'), ('fooddata'), ('exercisedata'),
  ('periodrecords'), ('mooddata'), ('polar_data')
) as t(name);

insert into kubios_precheck.before(check_id, expected, actual)
select 'sequence.' || r.role || '.' || t.name,
       true,
       has_sequence_privilege(
         r.role,
         pg_get_serial_sequence(
           format('public.%I', t.name),
           case when t.name = 'users' then 'UserID' else 'id' end
         ),
         'USAGE'
       )
from (values ('anon'), ('authenticated')) as r(role)
cross join (values
  ('users'), ('insulindata'), ('fooddata'), ('exercisedata'),
  ('periodrecords'), ('mooddata'), ('polar_data')
) as t(name);

insert into kubios_precheck.before(check_id, expected, actual)
select 'public.sequence.' || t.name,
       true,
       exists (
         select 1
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           cross join lateral aclexplode(c.relacl) a
          where n.nspname = 'public'
            and c.oid = pg_get_serial_sequence(
              format('public.%I', t.name),
              case when t.name = 'users' then 'UserID' else 'id' end
            )::regclass
            and a.grantee = 0
            and a.privilege_type = 'USAGE'
       )
from (values
  ('users'), ('insulindata'), ('fooddata'), ('exercisedata'),
  ('periodrecords'), ('mooddata'), ('polar_data')
) as t(name);

do $$
declare
  v_total integer;
  v_bad text;
begin
  select count(*), string_agg(check_id, ',' order by check_id)
    filter (where expected is distinct from actual)
    into v_total, v_bad
    from kubios_precheck.before;

  if v_total <> 70 then
    raise exception 'K49_FIXTURE_PRECHECK_INCOMPLETE: % hechos registrados (esperados 70)', v_total;
  end if;
  if v_bad is not null then
    raise exception 'K49_FIXTURE_PRECHECK_FAILED: %', v_bad;
  end if;
end
$$;

-- No se crean extensiones: las migraciones no usan gen_random_uuid() ni pgcrypto.
'@
  Write-Step 'aplicando bootstrap sintetico (roles, users y seis tablas de salud)'
  $bootstrap = Invoke-Psql -Sql $bootstrapSql -Quiet
  if ($bootstrap.ExitCode -ne 0) {
    Show-PsqlResult $bootstrap
    throw "El bootstrap sintetico fallo (exit $($bootstrap.ExitCode))."
  }
  Write-Ok "roles + users(UserID serial) + seis tablas de salud + precheck antes/despues"

  # ---------- Migraciones de privacidad reales (antes de Kubios) ----------
  Write-Step 'aplicando migraciones de privacidad reales (T025, T053)'
  $p = 0
  foreach ($privacyMigration in $script:PrivacyMigrations) {
    $p++
    $privacyPath = Join-Path $script:MigrationsDir $privacyMigration
    $started = Get-Date
    $sql = [System.IO.File]::ReadAllText($privacyPath)
    $result = Invoke-Psql -Sql $sql -Quiet
    $elapsed = [int]((Get-Date) - $started).TotalMilliseconds
    if ($result.ExitCode -ne 0) {
      Show-PsqlResult $result
      throw "La migracion de privacidad $privacyMigration fallo (exit $($result.ExitCode))."
    }
    Write-Ok ("[privacidad {0}/{1}] {2} ({3} ms)" -f $p, $script:PrivacyMigrations.Count, $privacyMigration, $elapsed)
  }

  # ---------- Migraciones Kubios en orden ----------
  $i = 0
  foreach ($migration in $migrations) {
    $i++
    $started = Get-Date
    $sql = [System.IO.File]::ReadAllText($migration.FullName)
    $result = Invoke-Psql -Sql $sql -Quiet
    $elapsed = [int]((Get-Date) - $started).TotalMilliseconds
    if ($result.ExitCode -ne 0) {
      Show-PsqlResult $result
      throw "La migracion $($migration.Name) fallo (exit $($result.ExitCode))."
    }
    Write-Ok ("[Kubios {0}/{1}] {2} ({3} ms)" -f $i, $migrations.Count, $migration.Name, $elapsed)
  }

  # ---------- Comprobaciones ----------
  $testsSql = @'
\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
set client_min_messages = warning;

\echo 'K49 - comprobaciones de la capa de datos Kubios'
\echo 'Entorno: PostgreSQL efimero + bootstrap sintetico. Sin PostgREST/GoTrue/JWT/auth.uid().'
\echo 'Datos: UUID y bytes ficticios. Sin claves, tokens ni datos personales.'
\echo ''

create schema kubios_test;

-- dblink viene en la imagen oficial de PostgreSQL (contrib) y se usa solo para
-- abrir una segunda sesion local que mantenga el lock de team_sync_state. No
-- hay red: la conexion usa el socket Unix del contenedor.
create extension if not exists dblink with schema public;

create table kubios_test.results (
  seq       serial primary key,
  check_id  text not null,
  criterion text not null,
  title     text not null,
  status    text not null check (status in ('PASS','FAIL')),
  detail    text
);

create table kubios_test.state (
  key   text primary key,
  value jsonb not null
);

create or replace function kubios_test.record(
  p_id text, p_criterion text, p_title text, p_ok boolean, p_detail text default null
) returns void
language sql
as $$
  insert into kubios_test.results(check_id, criterion, title, status, detail)
  values (p_id, p_criterion, p_title, case when p_ok then 'PASS' else 'FAIL' end, p_detail);
$$;

-- Ejecuta SQL cambiando de rol con SET LOCAL ROLE (como hace el Data API) y captura el
-- SQLSTATE real. SECURITY INVOKER: no eleva privilegios; solo cambia el rol efectivo.
create or replace function kubios_test.exec_as(p_role text, p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  execute 'reset role';
  if v_state is not null then
    return jsonb_build_object('ok', false, 'sqlstate', v_state, 'message', v_msg);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function kubios_test.query_as(p_role text, p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_rows  jsonb;
  v_state text;
  v_msg   text;
begin
  execute format('set local role %I', p_role);
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (%s) as t', p_sql)
      into v_rows;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  execute 'reset role';
  if v_state is not null then
    return jsonb_build_object('ok', false, 'sqlstate', v_state, 'message', v_msg);
  end if;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end;
$$;

create or replace function kubios_test.expect_error(
  p_id text, p_criterion text, p_title text, p_role text, p_sql text,
  p_state text, p_message text default null
) returns void
language plpgsql
as $$
declare
  v jsonb;
begin
  v := kubios_test.exec_as(p_role, p_sql);
  perform kubios_test.record(
    p_id, p_criterion, p_title,
    (v->>'ok') = 'false'
      and (v->>'sqlstate') = p_state
      and (p_message is null or (v->>'message') = p_message),
    format('esperado SQLSTATE %s%s; obtenido %s: %s',
      p_state,
      case when p_message is null then '' else ' / ' || p_message end,
      coalesce(v->>'sqlstate', '(sin error)'),
      coalesce(v->>'message', '')));
end;
$$;

-- bytea se serializa a jsonb como "\x<hex>"; devuelve solo el hex para comparar.
create or replace function kubios_test.hexof(p_text text)
returns text
language sql
immutable
as $$
  select case when p_text is null then null
              when left(p_text, 2) = '\x' then substring(p_text from 3)
              else encode(convert_to(p_text, 'UTF8'), 'hex') end;
$$;

-- Las identidades ficticias 2001/2002 ya existen en public.users del bootstrap.
-- No hay auth.users: la base de produccion usa public.users("UserID") integer.

-- ===================== A. Separacion por roles =====================
do $$
begin
  perform kubios_test.expect_error('A1', 'A', 'anon no puede leer kubios_private.encrypted_snapshots', 'anon',
    $q$select * from kubios_private.encrypted_snapshots$q$, '42501');

  perform kubios_test.expect_error('A2', 'A', 'anon no puede insertar en kubios_private.encrypted_snapshots', 'anon',
    $q$insert into kubios_private.encrypted_snapshots(team_id, member_id, ciphertext, nonce, tag, key_version)
       values ('f9999999-9999-4999-8999-999999999999'::uuid, 'f8888888-8888-4888-8888-888888888888'::uuid,
               decode('00', 'hex'), decode('00', 'hex'), decode('00', 'hex'), 1)$q$, '42501');

  perform kubios_test.expect_error('A3', 'A', 'anon no puede ejecutar kubios_get_snapshot', 'anon',
    $q$select * from public.kubios_get_snapshot('11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$, '42501');

  perform kubios_test.expect_error('A4', 'A', 'anon no puede ejecutar kubios_write_snapshot', 'anon',
    $q$select public.kubios_write_snapshot('11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, decode('00', 'hex'), decode('00', 'hex'), decode('00', 'hex'), 1)$q$, '42501');

  perform kubios_test.expect_error('A5', 'A', 'anon no puede ejecutar kubios_get_token', 'anon',
    $q$select * from public.kubios_get_token('11111111-1111-4111-8111-111111111111'::uuid)$q$, '42501');

  perform kubios_test.expect_error('A6', 'A', 'authenticated no puede leer kubios_private.team_sync_state', 'authenticated',
    $q$select * from kubios_private.team_sync_state$q$, '42501');

  perform kubios_test.expect_error('A7', 'A', 'authenticated no puede ejecutar kubios_assign_user_member_link', 'authenticated',
    $q$select * from public.kubios_assign_user_member_link(2001,
       '11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$, '42501');

  perform kubios_test.expect_error('A8', 'A', 'authenticated no puede ejecutar kubios_finish_sync', 'authenticated',
    $q$select public.kubios_finish_sync('11111111-1111-4111-8111-111111111111'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, true, null, null)$q$, '42501');

  -- authenticator es miembro de service_role pero NOINHERIT: sin SET ROLE no hereda EXECUTE.
  perform kubios_test.expect_error('A9', 'A', 'authenticator no ejecuta kubios_get_snapshot sin SET ROLE', 'authenticator',
    $q$select * from public.kubios_get_snapshot('11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$, '42501');

  perform kubios_test.expect_error('A10', 'A', 'anon no puede ejecutar kubios_get_user_member_link', 'anon',
    $q$select * from public.kubios_get_user_member_link(2001)$q$, '42501');

  perform kubios_test.expect_error('A11', 'A', 'authenticated no puede actualizar kubios_private.encrypted_snapshots', 'authenticated',
    $q$update kubios_private.encrypted_snapshots set key_version = 1$q$, '42501');

  perform kubios_test.expect_error('A12', 'A', 'anon no puede borrar kubios_private.team_sync_state', 'anon',
    $q$delete from kubios_private.team_sync_state$q$, '42501');

  perform kubios_test.expect_error('A13', 'A', 'anon no puede ejecutar kubios_finish_sync_indefinite', 'anon',
    $q$select public.kubios_finish_sync_indefinite('11111111-1111-4111-8111-111111111111'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 'http.429')$q$, '42501');

  perform kubios_test.expect_error('A14', 'A', 'authenticated no puede ejecutar kubios_finish_sync_indefinite', 'authenticated',
    $q$select public.kubios_finish_sync_indefinite('11111111-1111-4111-8111-111111111111'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 'http.429')$q$, '42501');

  -- authenticator es miembro de service_role pero NOINHERIT: sin SET ROLE no hereda EXECUTE.
  perform kubios_test.expect_error('A15', 'A', 'authenticator no ejecuta kubios_finish_sync_indefinite sin SET ROLE', 'authenticator',
    $q$select public.kubios_finish_sync_indefinite('11111111-1111-4111-8111-111111111111'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 'http.429')$q$, '42501');
end;
$$;

-- ===================== B. Privilegios en catalogo =====================
do $$
declare
  v jsonb;
  v_tables integer;
  v_functions integer;
begin
  select count(*) into v_tables
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'kubios_private'
     and c.relkind = 'r'
     and c.relname in ('encrypted_snapshots', 'encrypted_tokens', 'team_sync_state', 'user_member_links', 'team_sync_cursor');

  select count(*) into v_functions
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ '^kubios_';

  perform kubios_test.record('B0', 'B', 'superficie Kubios esperada: 5 tablas privadas + 12 funciones publicas',
    v_tables = 5 and v_functions = 12,
    format('tablas=%s funciones=%s', v_tables, v_functions));

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v
    from (
      select 'rol ' || rname as violation
        from (values ('anon'), ('authenticated')) as t(rname)
       where has_schema_privilege(t.rname, 'kubios_private', 'USAGE')
      union all
      select 'PUBLIC'
       where exists (
         select 1 from pg_namespace n, aclexplode(n.nspacl) a
          where n.nspname = 'kubios_private' and a.grantee = 0 and a.privilege_type = 'USAGE')
    ) as x;
  perform kubios_test.record('B1', 'B', 'anon/authenticated/PUBLIC sin USAGE sobre kubios_private',
    jsonb_array_length(v) = 0, v::text);

  select coalesce(jsonb_agg(rname || ' ' || tname || ' ' || pname), '[]'::jsonb) into v
    from (values ('anon'), ('authenticated')) as r(rname)
    cross join (values ('encrypted_snapshots'), ('encrypted_tokens'), ('team_sync_state'), ('user_member_links'), ('team_sync_cursor')) as t(tname)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(pname)
   where has_table_privilege(r.rname, 'kubios_private.' || t.tname, p.pname);
  perform kubios_test.record('B2', 'B', 'anon/authenticated sin privilegios de tabla en kubios_private.*',
    jsonb_array_length(v) = 0, v::text);

  select coalesce(jsonb_agg(c.relname || ' ' || a.privilege_type), '[]'::jsonb) into v
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'kubios_private' and c.relkind = 'r' and a.grantee = 0;
  perform kubios_test.record('B3', 'B', 'PUBLIC sin privilegios de tabla en kubios_private.*',
    jsonb_array_length(v) = 0, v::text);

  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' para ' || r.rname), '[]'::jsonb) into v
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) as r(rname)
   where n.nspname = 'public' and p.proname ~ '^kubios_'
     and has_function_privilege(r.rname, p.oid, 'EXECUTE');
  perform kubios_test.record('B4', 'B', 'anon/authenticated sin EXECUTE sobre las RPC Kubios',
    jsonb_array_length(v) = 0, v::text);

  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]'::jsonb) into v
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ '^kubios_'
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  perform kubios_test.record('B5', 'B', 'PUBLIC sin EXECUTE sobre las RPC Kubios',
    jsonb_array_length(v) = 0, v::text);

  with t(tname) as (values ('encrypted_snapshots'), ('encrypted_tokens'), ('team_sync_state'), ('user_member_links'), ('team_sync_cursor')),
       p(pname) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')),
       expected as (
         select tname, pname,
                (tname <> 'team_sync_cursor'
                 and (pname in ('SELECT', 'INSERT', 'UPDATE')
                      or (tname = 'user_member_links' and pname = 'DELETE'))) as want
           from t cross join p
       )
  select coalesce(jsonb_agg(tname || ' ' || pname || ' esperado=' || want), '[]'::jsonb) into v
    from expected
   where has_table_privilege('service_role', 'kubios_private.' || tname, pname) is distinct from want;
  perform kubios_test.record('B6', 'B', 'service_role: SELECT/INSERT/UPDATE; DELETE solo en user_member_links; sin acceso directo al cursor',
    jsonb_array_length(v) = 0, v::text);

  perform kubios_test.record('B7', 'B', 'service_role: USAGE (no CREATE) sobre kubios_private',
    has_schema_privilege('service_role', 'kubios_private', 'USAGE')
      and not has_schema_privilege('service_role', 'kubios_private', 'CREATE'),
    format('usage=%s create=%s',
      has_schema_privilege('service_role', 'kubios_private', 'USAGE'),
      has_schema_privilege('service_role', 'kubios_private', 'CREATE')));

  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]'::jsonb) into v
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ '^kubios_'
     and not has_function_privilege('service_role', p.oid, 'EXECUTE');
  perform kubios_test.record('B8', 'B', 'service_role con EXECUTE sobre las 12 RPC Kubios',
    jsonb_array_length(v) = 0, v::text);

  select coalesce(jsonb_agg(c.relname || ' rls=' || c.relrowsecurity), '[]'::jsonb) into v
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'kubios_private' and c.relkind = 'r'
     and (not c.relrowsecurity
          or exists (select 1 from pg_policies pol
                      where pol.schemaname = 'kubios_private' and pol.tablename = c.relname));
  perform kubios_test.record('B9', 'B', 'RLS activado y sin politicas en las 5 tablas privadas',
    jsonb_array_length(v) = 0, v::text);

  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]'::jsonb) into v
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ '^kubios_'
     and (p.prosecdef
          or p.proconfig is null
          or not exists (
               select 1 from unnest(p.proconfig) cfg
                where cfg in ('search_path=""', 'search_path=pg_catalog, pg_temp')));
  perform kubios_test.record('B10', 'B', 'RPC SECURITY INVOKER con search_path fijo y acotado',
    jsonb_array_length(v) = 0, v::text);

  -- K38: matriz explicita de la RPC nueva. B4/B5/B8 ya la cubren de forma generica.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v
    from (
      select 'service_role sin EXECUTE' as violation
       where not has_function_privilege('service_role',
         'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE')
      union all
      select r.rname || ' con EXECUTE'
        from (values ('anon'), ('authenticated'), ('authenticator')) as r(rname)
       where has_function_privilege(r.rname,
         'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE')
      union all
      select 'PUBLIC con EXECUTE (proacl nula o grant a PUBLIC)'
       where exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'kubios_finish_sync_indefinite'
           and (p.proacl is null
                or exists (select 1 from aclexplode(p.proacl) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE')))
    ) as x;
  perform kubios_test.record('B11', 'B', 'kubios_finish_sync_indefinite: solo service_role (sin PUBLIC/anon/authenticated/authenticator)',
    jsonb_array_length(v) = 0, v::text);

  -- K49: el vinculo usa public.users("UserID") integer, no auth.users UUID.
  perform kubios_test.record('B12', 'B', 'user_member_links.user_id integer FK a public.users(UserID) ON DELETE CASCADE; sin auth.users',
    (select format_type(a.atttypid, a.atttypmod)
       from pg_attribute a
      where a.attrelid = 'kubios_private.user_member_links'::regclass
        and a.attname = 'user_id') = 'integer'
      and exists (
        select 1
          from pg_constraint c
         where c.conname = 'user_member_links_user_id_fkey'
           and c.conrelid = 'kubios_private.user_member_links'::regclass
           and c.confrelid = 'public.users'::regclass
           and c.contype = 'f'
           and c.confdeltype = 'c')
      and to_regclass('auth.users') is null,
    format('tipo=%s fk=%s auth.users=%s',
      (select format_type(a.atttypid, a.atttypmod)
         from pg_attribute a
        where a.attrelid = 'kubios_private.user_member_links'::regclass
          and a.attname = 'user_id'),
      exists (select 1 from pg_constraint c
               where c.conname = 'user_member_links_user_id_fkey'
                 and c.conrelid = 'kubios_private.user_member_links'::regclass
                 and c.confrelid = 'public.users'::regclass
                 and c.confdeltype = 'c'),
      to_regclass('auth.users')));

  perform kubios_test.record('B13', 'B', 'RPC de vinculo con firma integer y sin variante UUID',
    to_regprocedure('public.kubios_get_user_member_link(integer)') is not null
      and to_regprocedure('public.kubios_assign_user_member_link(integer, uuid, uuid)') is not null
      and to_regprocedure('public.kubios_revoke_user_member_link(integer)') is not null
      and to_regprocedure('public.kubios_get_user_member_link(uuid)') is null
      and to_regprocedure('public.kubios_assign_user_member_link(uuid, uuid, uuid)') is null
      and to_regprocedure('public.kubios_revoke_user_member_link(uuid)') is null,
    'firmas integer presentes; firmas uuid ausentes');
end;
$$;

-- ===================== P. Privacidad real T025/T053 sobre fixture ----------
-- El bootstrap registro has_table_privilege/has_column_privilege, ACL de
-- PUBLIC y politicas ANTES de aplicar los SQL reales de T025/T053. Estas
-- comprobaciones contrastan ese estado previo con el estado efectivo posterior.
do $$
declare
  v jsonb;
  v_total integer;
  v_bad integer;
  v_count integer;
  v_ok boolean;
begin
  select count(*), count(*) filter (where expected is distinct from actual)
    into v_total, v_bad
    from kubios_precheck.before;

  perform kubios_test.record('P1', 'P', 'fixture previo: T025/T053 tenian exposicion efectiva que cerrar',
    v_total = 70 and v_bad = 0,
    format('hechos=%s desviaciones=%s', v_total, v_bad));

  -- users: tabla
  select coalesce(jsonb_agg(r.role || ' ' || p.priv), '[]'::jsonb) into v
    from (values ('anon'), ('authenticated')) as r(role)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                       ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
   where has_table_privilege(r.role, 'public.users', p.priv);
  perform kubios_test.record('P2', 'P', 'users: anon/authenticated sin privilegios de tabla tras T053',
    jsonb_array_length(v) = 0, v::text);

  -- users: PUBLIC, tabla y columna
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v
    from (
      select 'tabla ' || a.privilege_type as x
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) a
       where n.nspname = 'public' and c.relname = 'users'
         and c.relkind = 'r' and a.grantee = 0
      union all
      select 'columna ' || a.privilege_type as x
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute att on att.attrelid = c.oid
                             and att.attnum > 0
                             and not att.attisdropped
        cross join lateral aclexplode(att.attacl) a
       where n.nspname = 'public' and c.relname = 'users'
         and a.grantee = 0
    ) as x;
  perform kubios_test.record('P3', 'P', 'users: PUBLIC sin privilegios de tabla ni columna tras T053',
    jsonb_array_length(v) = 0, v::text);

  -- users: columnas para anon/authenticated
  select coalesce(jsonb_agg(r.role || ' ' || a.attname || ' ' || p.priv), '[]'::jsonb) into v
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(role)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) as p(priv)
   where n.nspname = 'public' and c.relname = 'users'
     and a.attnum > 0 and not a.attisdropped
     and has_column_privilege(r.role, c.oid, a.attname, p.priv);
  perform kubios_test.record('P4', 'P', 'users: anon/authenticated sin privilegios de columna tras T053',
    jsonb_array_length(v) = 0, v::text);

  -- salud: tabla para anon/authenticated
  select coalesce(jsonb_agg(r.role || ' ' || t.name || ' ' || p.priv), '[]'::jsonb) into v
    from (values ('anon'), ('authenticated')) as r(role)
    cross join (values ('insulindata'), ('fooddata'), ('exercisedata'),
                       ('periodrecords'), ('mooddata'), ('polar_data')) as t(name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                       ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
   where has_table_privilege(r.role, format('public.%I', t.name), p.priv);
  perform kubios_test.record('P5', 'P', 'salud: anon/authenticated sin privilegios de tabla tras T025',
    jsonb_array_length(v) = 0, v::text);

  -- salud: PUBLIC, tabla y columna
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v
    from (
      select 'tabla ' || c.relname || ' ' || a.privilege_type as x
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) a
       where n.nspname = 'public'
         and c.relname in ('insulindata', 'fooddata', 'exercisedata',
                           'periodrecords', 'mooddata', 'polar_data')
         and c.relkind = 'r' and a.grantee = 0
      union all
      select 'columna ' || c.relname || ' ' || a.privilege_type as x
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute att on att.attrelid = c.oid
                             and att.attnum > 0
                             and not att.attisdropped
        cross join lateral aclexplode(att.attacl) a
       where n.nspname = 'public'
         and c.relname in ('insulindata', 'fooddata', 'exercisedata',
                           'periodrecords', 'mooddata', 'polar_data')
         and a.grantee = 0
    ) as x;
  perform kubios_test.record('P6', 'P', 'salud: PUBLIC sin privilegios de tabla ni columna tras T025',
    jsonb_array_length(v) = 0, v::text);

  -- salud: columnas para anon/authenticated (incluye la concesion solo de
  -- columna de polar_data, que no estaba cubierta por un grant de tabla).
  select coalesce(jsonb_agg(r.role || ' ' || c.relname || ' ' || a.attname || ' ' || p.priv), '[]'::jsonb) into v
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(role)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) as p(priv)
   where n.nspname = 'public'
     and c.relname in ('insulindata', 'fooddata', 'exercisedata',
                       'periodrecords', 'mooddata', 'polar_data')
     and a.attnum > 0 and not a.attisdropped
     and has_column_privilege(r.role, c.oid, a.attname, p.priv);
  perform kubios_test.record('P7', 'P', 'salud: anon/authenticated sin privilegios de columna tras T025',
    jsonb_array_length(v) = 0, v::text);

  -- service_role: acceso de tabla a users (CRUD) y a las seis tablas de salud
  -- (ALL, que T025 concede).
  with expected(name, priv) as (
    select 'users', p.priv
      from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
    union all
    select t.name, p.priv
      from (values ('insulindata'), ('fooddata'), ('exercisedata'),
                   ('periodrecords'), ('mooddata'), ('polar_data')) as t(name)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                         ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
  )
  select coalesce(jsonb_agg(name || ' ' || priv), '[]'::jsonb) into v
    from expected
   where not has_table_privilege('service_role', format('public.%I', name), priv);
  perform kubios_test.record('P8', 'P', 'service_role: acceso de tabla a users y a las seis tablas de salud',
    jsonb_array_length(v) = 0, v::text);

  -- service_role: SELECT de todas las columnas.
  select coalesce(jsonb_agg(c.relname || ' ' || a.attname), '[]'::jsonb) into v
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('users', 'insulindata', 'fooddata', 'exercisedata',
                       'periodrecords', 'mooddata', 'polar_data')
     and a.attnum > 0 and not a.attisdropped
     and not has_column_privilege('service_role', c.oid, a.attname, 'SELECT');
  perform kubios_test.record('P9', 'P', 'service_role: SELECT de todas las columnas de users y salud',
    jsonb_array_length(v) = 0, v::text);

  -- RLS activo en users y las seis tablas de salud.
  select coalesce(jsonb_agg(c.relname), '[]'::jsonb) into v
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('users', 'insulindata', 'fooddata', 'exercisedata',
                       'periodrecords', 'mooddata', 'polar_data')
     and not c.relrowsecurity;
  perform kubios_test.record('P10', 'P', 'RLS activo en users y las seis tablas de salud',
    jsonb_array_length(v) = 0, v::text);

  -- Ninguna politica reabierta a PUBLIC/anon/authenticated.
  select coalesce(jsonb_agg(p.tablename || ':' || p.policyname), '[]'::jsonb) into v
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('users', 'insulindata', 'fooddata', 'exercisedata',
                         'periodrecords', 'mooddata', 'polar_data')
     and (
       p.roles is null
       or cardinality(p.roles) = 0
       or p.roles && array['public', 'anon', 'authenticated']::name[]
     );
  perform kubios_test.record('P11', 'P', 'sin policies publicas/anon/authenticated en users y salud',
    jsonb_array_length(v) = 0, v::text);

  -- T025/T053 dejan una policy service_role por tabla.
  select count(*) into v_count
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('users', 'insulindata', 'fooddata', 'exercisedata',
                         'periodrecords', 'mooddata', 'polar_data')
     and 'service_role' = any(p.roles);
  perform kubios_test.record('P12', 'P', 'policy service_role presente en cada tabla privada',
    v_count = 7, format('policies service_role=%s (esperadas 7)', v_count));

  -- Secuencias: sin USAGE para anon/authenticated/PUBLIC y con USAGE para
  -- service_role, incluidas las de users y las seis tablas de salud.
  with sequences(name, seq) as (
    select t.name, pg_get_serial_sequence(
      format('public.%I', t.name),
      case when t.name = 'users' then 'UserID' else 'id' end)
      from (values ('users'), ('insulindata'), ('fooddata'), ('exercisedata'),
                   ('periodrecords'), ('mooddata'), ('polar_data')) as t(name)
  )
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v
    from (
      select 'anon ' || name as x
        from sequences
       where seq is not null and has_sequence_privilege('anon', seq, 'USAGE')
      union all
      select 'authenticated ' || name as x
        from sequences
       where seq is not null and has_sequence_privilege('authenticated', seq, 'USAGE')
      union all
      select 'PUBLIC ' || s.name as x
        from sequences s
        join pg_class c on c.oid = s.seq::regclass
        cross join lateral aclexplode(c.relacl) a
       where s.seq is not null and a.grantee = 0 and a.privilege_type = 'USAGE'
      union all
      select 'service_role sin USAGE/SELECT ' || name as x
        from sequences
       where seq is null
          or not has_sequence_privilege('service_role', seq, 'USAGE')
          or not has_sequence_privilege('service_role', seq, 'SELECT')
    ) as x;
  perform kubios_test.record('P13', 'P', 'secuencias: anon/authenticated/PUBLIC revocados y service_role con USAGE/SELECT',
    jsonb_array_length(v) = 0, v::text);

  -- T025/T053 no alteran filas ni valores del fixture.
  select (select count(*) from public.users where "UserID" in (2001, 2002)) = 2
     and (select count(*) from public.insulindata) = 1
     and (select count(*) from public.fooddata) = 1
     and (select count(*) from public.exercisedata) = 1
     and (select count(*) from public.periodrecords) = 1
     and (select count(*) from public.mooddata) = 1
     and (select count(*) from public.polar_data) = 1
    into v_ok;
  perform kubios_test.record('P14', 'P', 'T025/T053 preservan las filas ficticias de users y salud',
    v_ok,
    format('users=%s salud=%s/%s/%s/%s/%s/%s',
      (select count(*) from public.users where "UserID" in (2001, 2002)),
      (select count(*) from public.insulindata),
      (select count(*) from public.fooddata),
      (select count(*) from public.exercisedata),
      (select count(*) from public.periodrecords),
      (select count(*) from public.mooddata),
      (select count(*) from public.polar_data)));
end;
$$;

-- ===================== C. service_role: camino feliz =====================
do $$
declare
  v jsonb;
begin
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('11111111-1111-4111-8111-111111111111'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 900) as acquired$q$);
  perform kubios_test.record('C1', 'C', 'service_role adquiere el lease del equipo',
    (v->'rows'->0->>'acquired')::boolean, v::text);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_write_snapshot('11111111-1111-4111-8111-111111111111'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'f1111111-1111-4111-8111-111111111111'::uuid,
       decode('deadbeefcafebabe0011223344556677', 'hex'),
       decode('000102030405060708090a0b', 'hex'),
       decode('101112131415161718191a1b1c1d1e1f', 'hex'), 3) as updated_at$q$);
  perform kubios_test.record('C2', 'C', 'service_role escribe el snapshot cifrado',
    (v->'rows'->0->>'updated_at') is not null, v::text);

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_snapshot('11111111-1111-4111-8111-111111111111'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$);
  perform kubios_test.record('C3', 'C', 'service_role lee el snapshot cifrado',
    jsonb_array_length(v->'rows') = 1, v::text);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_write_token('11111111-1111-4111-8111-111111111111'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       decode('a1a2a3a4b1b2b3b4', 'hex'),
       decode('0102030405060708090a0b0c', 'hex'),
       decode('1112131415161718191a1b1c1d1e1f20', 'hex'), 9,
       '2027-01-01 00:00:00+00'::timestamptz)$q$);
  perform kubios_test.record('C4', 'C', 'service_role escribe el token cifrado',
    (v->>'ok')::boolean, v::text);

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_token('11111111-1111-4111-8111-111111111111'::uuid)$q$);
  perform kubios_test.record('C5', 'C', 'service_role lee el token cifrado',
    jsonb_array_length(v->'rows') = 1, v::text);

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_assign_user_member_link(2001,
       '11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$);
  perform kubios_test.record('C6', 'C', 'service_role crea el vinculo usuario-equipo-miembro',
    jsonb_array_length(v->'rows') = 1
      and (v->'rows'->0->>'user_id') = '2001'
      and (v->'rows'->0->>'team_id') = '11111111-1111-4111-8111-111111111111'
      and (v->'rows'->0->>'kubios_member_id') = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    v::text);

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_user_member_link(2001)$q$);
  perform kubios_test.record('C7', 'C', 'service_role consulta el vinculo por UserID integer',
    jsonb_array_length(v->'rows') = 1, v::text);
end;
$$;

-- ===================== E. Lectura cifrada del snapshot =====================
do $$
declare
  v jsonb;
  v_prev timestamptz;
  v_count integer;
begin
  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_snapshot('11111111-1111-4111-8111-111111111111'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$);

  perform kubios_test.record('E1', 'E', 'kubios_get_snapshot devuelve el ciphertext guardado',
    kubios_test.hexof(v->'rows'->0->>'ciphertext') = encode(decode('deadbeefcafebabe0011223344556677', 'hex'), 'hex'),
    'ciphertext=' || coalesce(kubios_test.hexof(v->'rows'->0->>'ciphertext'), 'null'));

  perform kubios_test.record('E2', 'E', 'kubios_get_snapshot devuelve el nonce guardado',
    kubios_test.hexof(v->'rows'->0->>'nonce') = encode(decode('000102030405060708090a0b', 'hex'), 'hex'),
    'nonce=' || coalesce(kubios_test.hexof(v->'rows'->0->>'nonce'), 'null'));

  perform kubios_test.record('E3', 'E', 'kubios_get_snapshot devuelve el tag guardado',
    kubios_test.hexof(v->'rows'->0->>'tag') = encode(decode('101112131415161718191a1b1c1d1e1f', 'hex'), 'hex'),
    'tag=' || coalesce(kubios_test.hexof(v->'rows'->0->>'tag'), 'null'));

  perform kubios_test.record('E4', 'E', 'kubios_get_snapshot devuelve key_version',
    (v->'rows'->0->>'key_version')::integer = 3,
    'key_version=' || coalesce(v->'rows'->0->>'key_version', 'null'));

  perform kubios_test.record('E5', 'E', 'el ciphertext no coincide con el texto plano sintetico',
    kubios_test.hexof(v->'rows'->0->>'ciphertext') <> encode(decode('504c41494e544558542d4b5542494f53', 'hex'), 'hex')
      and kubios_test.hexof(v->'rows'->0->>'ciphertext') = encode(decode('deadbeefcafebabe0011223344556677', 'hex'), 'hex'),
    'ciphertext=' || coalesce(kubios_test.hexof(v->'rows'->0->>'ciphertext'), 'null'));

  perform kubios_test.record('E6', 'E', 'updated_at devuelto coincide con la fila almacenada',
    (v->'rows'->0->>'updated_at')::timestamptz = (
      select s.updated_at from kubios_private.encrypted_snapshots s
       where s.team_id = '11111111-1111-4111-8111-111111111111'::uuid
         and s.member_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid),
    'rpc=' || coalesce(v->'rows'->0->>'updated_at', 'null'));

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_snapshot('11111111-1111-4111-8111-111111111111'::uuid,
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)$q$);
  perform kubios_test.record('E7', 'E', 'miembro sin snapshot devuelve cero filas (sin error)',
    (v->>'ok')::boolean and jsonb_array_length(v->'rows') = 0, v::text);

  select s.updated_at into v_prev from kubios_private.encrypted_snapshots s
   where s.team_id = '11111111-1111-4111-8111-111111111111'::uuid
     and s.member_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_write_snapshot('11111111-1111-4111-8111-111111111111'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'f1111111-1111-4111-8111-111111111111'::uuid,
       decode('00112233445566778899aabbccddeeff', 'hex'),
       decode('0c0d0e0f1011121314151617', 'hex'),
       decode('202122232425262728292a2b2c2d2e2f', 'hex'), 4) as updated_at$q$);
  select count(*) into v_count from kubios_private.encrypted_snapshots
   where team_id = '11111111-1111-4111-8111-111111111111'::uuid
     and member_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
  perform kubios_test.record('E8', 'E', 'upsert por (team_id, member_id): una fila y updated_at nuevo',
    v_count = 1
      and (v->'rows'->0->>'updated_at')::timestamptz > v_prev
      and (select encode(s.ciphertext, 'hex') from kubios_private.encrypted_snapshots s
            where s.team_id = '11111111-1111-4111-8111-111111111111'::uuid
              and s.member_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) = '00112233445566778899aabbccddeeff',
    format('filas=%s antes=%s despues=%s', v_count, v_prev, (v->'rows'->0->>'updated_at')));

  insert into kubios_test.state(key, value)
  select 'snapshot_baseline', to_jsonb(s)
    from kubios_private.encrypted_snapshots s
   where s.team_id = '11111111-1111-4111-8111-111111111111'::uuid
     and s.member_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  on conflict (key) do update set value = excluded.value;
end;
$$;

-- ===================== F. Fences owner/lease + argumentos =====================
do $$
declare
  v jsonb;
begin
  -- F1: equipo sin fila en team_sync_state.
  perform kubios_test.expect_error('F1', 'F', 'sin lease: kubios_sync_lease_missing', 'service_role',
    $q$select public.kubios_write_snapshot('44444444-4444-4444-8444-444444444444'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'f1111111-1111-4111-8111-111111111111'::uuid,
       decode('aa', 'hex'), decode('bb', 'hex'), decode('cc', 'hex'), 1)$q$,
    'P0001', 'kubios_sync_lease_missing');

  -- F2: lease vigente de owner_1 en team_a; escribe owner_2.
  perform kubios_test.expect_error('F2', 'F', 'owner distinto: kubios_sync_lease_owner_mismatch', 'service_role',
    $q$select public.kubios_write_snapshot('11111111-1111-4111-8111-111111111111'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'f2222222-2222-4222-8222-222222222222'::uuid,
       decode('aa', 'hex'), decode('bb', 'hex'), decode('cc', 'hex'), 1)$q$,
    'P0001', 'kubios_sync_lease_owner_mismatch');

  insert into kubios_test.state(key, value)
  select 'snapshot_after_owner_mismatch', to_jsonb(s)
    from kubios_private.encrypted_snapshots s
   where s.team_id = '11111111-1111-4111-8111-111111111111'::uuid
     and s.member_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  on conflict (key) do update set value = excluded.value;

  -- F3: se vence el lease de forma explicita (setup) y se reintenta con el owner correcto.
  v := kubios_test.exec_as('service_role',
    $q$update kubios_private.team_sync_state
          set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
        where team_id = '11111111-1111-4111-8111-111111111111'::uuid$q$);
  perform kubios_test.record('F3a', 'F', 'setup: lease vencido para la prueba de caducidad',
    (v->>'ok')::boolean, v::text);

  perform kubios_test.expect_error('F3', 'F', 'lease caducado: kubios_sync_lease_expired', 'service_role',
    $q$select public.kubios_write_snapshot('11111111-1111-4111-8111-111111111111'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'f1111111-1111-4111-8111-111111111111'::uuid,
       decode('aa', 'hex'), decode('bb', 'hex'), decode('cc', 'hex'), 1)$q$,
    'P0001', 'kubios_sync_lease_expired');

  insert into kubios_test.state(key, value)
  select 'snapshot_after_expired', to_jsonb(s)
    from kubios_private.encrypted_snapshots s
   where s.team_id = '11111111-1111-4111-8111-111111111111'::uuid
     and s.member_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  on conflict (key) do update set value = excluded.value;

  -- F4: argumento nulo (validacion previa al lease).
  perform kubios_test.expect_error('F4', 'F', 'argumento nulo: kubios_snapshot_invalid_argument', 'service_role',
    $q$select public.kubios_write_snapshot('11111111-1111-4111-8111-111111111111'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'f1111111-1111-4111-8111-111111111111'::uuid,
       null::bytea, decode('bb', 'hex'), decode('cc', 'hex'), 1)$q$,
    'P0001', 'kubios_snapshot_invalid_argument');

  -- F5: escritura de token sin lease vigente (owner distinto y lease vencido).
  perform kubios_test.expect_error('F5', 'F', 'token sin lease vigente: kubios_token_write_denied', 'service_role',
    $q$select public.kubios_write_token('11111111-1111-4111-8111-111111111111'::uuid,
       'f2222222-2222-4222-8222-222222222222'::uuid, decode('aa', 'hex'), decode('bb', 'hex'),
       decode('cc', 'hex'), 1, '2027-01-01 00:00:00+00'::timestamptz)$q$,
    'P0001', 'kubios_token_write_denied');

  -- F6: finish_sync no cierra un intento con lease vencido; devuelve false, sin excepcion.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync('11111111-1111-4111-8111-111111111111'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, true, null, null) as finished$q$);
  perform kubios_test.record('F6', 'F', 'finish_sync con lease vencido devuelve false',
    (v->>'ok')::boolean and (v->'rows'->0->>'finished') = 'false', v::text);
end;
$$;

-- ===================== G. Preservacion del snapshot =====================
do $$
declare
  v_base jsonb;
  v_owner jsonb;
  v_expired jsonb;
  v_now jsonb;
begin
  select value into v_base from kubios_test.state where key = 'snapshot_baseline';
  select value into v_owner from kubios_test.state where key = 'snapshot_after_owner_mismatch';
  select value into v_expired from kubios_test.state where key = 'snapshot_after_expired';
  select to_jsonb(s) into v_now
    from kubios_private.encrypted_snapshots s
   where s.team_id = '11111111-1111-4111-8111-111111111111'::uuid
     and s.member_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;

  perform kubios_test.record('G1', 'G', 'snapshot intacto tras el rechazo por owner distinto',
    v_base is not null and v_base = v_owner, coalesce(v_owner::text, 'null'));

  perform kubios_test.record('G2', 'G', 'snapshot intacto tras el rechazo por lease caducado',
    v_base is not null and v_base = v_expired,
    'baseline=' || coalesce(v_base::text, 'null') || ' despues=' || coalesce(v_expired::text, 'null'));

  perform kubios_test.record('G3', 'G', 'snapshot intacto tras el resto de intentos rechazados',
    v_base is not null and v_base = v_now, coalesce(v_now::text, 'null'));

  perform kubios_test.record('G4', 'G', 'no se crea snapshot para el equipo sin estado/lease',
    not exists (select 1 from kubios_private.encrypted_snapshots
                 where team_id = '44444444-4444-4444-8444-444444444444'::uuid),
    'filas=' || (select count(*) from kubios_private.encrypted_snapshots
                  where team_id = '44444444-4444-4444-8444-444444444444'::uuid)::text);
end;
$$;

-- ===================== D. Unicidad e idempotencia de vinculos =====================
do $$
declare
  v jsonb;
  v_before timestamptz;
  v_after timestamptz;
  v_count integer;
begin
  perform kubios_test.expect_error('D1', 'D', 'PK user_id: segundo vinculo del mismo usuario (23505)', 'service_role',
    $q$insert into kubios_private.user_member_links(user_id, team_id, kubios_member_id)
       values (2001, '11111111-1111-4111-8111-111111111111'::uuid,
               'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)$q$, '23505');

  perform kubios_test.expect_error('D2', 'D', 'UNIQUE kubios_member_id: miembro ya vinculado a otro usuario (23505)', 'service_role',
    $q$insert into kubios_private.user_member_links(user_id, team_id, kubios_member_id)
       values (2002, '11111111-1111-4111-8111-111111111111'::uuid,
               'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$, '23505');

  select l.updated_at into v_before
    from kubios_private.user_member_links l
   where l.user_id = 2001;

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_assign_user_member_link(2001,
       '11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$);
  select l.updated_at into v_after
    from kubios_private.user_member_links l
   where l.user_id = 2001;
  perform kubios_test.record('D3', 'D', 'alta idempotente: mismos valores no tocan updated_at',
    jsonb_array_length(v->'rows') = 1 and v_after = v_before,
    format('antes=%s despues=%s', v_before, v_after));

  perform kubios_test.expect_error('D4', 'D', 'RPC con member_id de otro usuario (23505)', 'service_role',
    $q$select * from public.kubios_assign_user_member_link(2002,
       '11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$,
    '23505');

  select l.updated_at into v_before
    from kubios_private.user_member_links l
   where l.user_id = 2001;
  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_assign_user_member_link(2001,
       '11111111-1111-4111-8111-111111111111'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)$q$);
  select l.updated_at into v_after
    from kubios_private.user_member_links l
   where l.user_id = 2001;
  perform kubios_test.record('D5', 'D', 'reasignacion explicita: actualiza team/member y updated_at',
    (v->'rows'->0->>'kubios_member_id') = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and v_after > v_before,
    format('antes=%s despues=%s', v_before, v_after));

  perform kubios_test.expect_error('D6', 'D', 'RPC con member_id recien reasignado a otro usuario (23505)', 'service_role',
    $q$select * from public.kubios_assign_user_member_link(2002,
       '11111111-1111-4111-8111-111111111111'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)$q$,
    '23505');

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_user_member_link(2002)$q$);
  perform kubios_test.record('D15', 'D', 'cross-user: el usuario 2002 no ve el vinculo del usuario 2001',
    (v->>'ok')::boolean and jsonb_array_length(v->'rows') = 0, v::text);

  perform kubios_test.expect_error('D7', 'D', 'FK public.users: usuario inexistente (23503)', 'service_role',
    $q$select * from public.kubios_assign_user_member_link(9999,
       '11111111-1111-4111-8111-111111111111'::uuid, 'abababab-abab-4bab-8bab-abababababab'::uuid)$q$,
    '23503');

  perform kubios_test.expect_error('D8', 'D', 'argumento NOT NULL nulo (23502)', 'service_role',
    $q$select * from public.kubios_assign_user_member_link(2002,
       null::uuid, 'abababab-abab-4bab-8bab-abababababab'::uuid)$q$, '23502');

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_user_member_link(9999)$q$);
  perform kubios_test.record('D9', 'D', 'consulta de UserID sin vinculo: cero filas, sin error',
    (v->>'ok')::boolean and jsonb_array_length(v->'rows') = 0, v::text);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_revoke_user_member_link(9999) as removed$q$);
  perform kubios_test.record('D10', 'D', 'revocacion de UserID sin vinculo devuelve false',
    (v->'rows'->0->>'removed') = 'false', v::text);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_revoke_user_member_link(2001) as removed$q$);
  perform kubios_test.record('D11', 'D', 'revocacion existente devuelve true',
    (v->'rows'->0->>'removed') = 'true', v::text);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_revoke_user_member_link(2001) as removed$q$);
  perform kubios_test.record('D12', 'D', 'revocacion repetida es idempotente y devuelve false',
    (v->'rows'->0->>'removed') = 'false', v::text);

  insert into public.users ("UserID") values (2003);
  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_assign_user_member_link(2003,
       '33333333-3333-4333-8333-333333333333'::uuid, 'abababab-abab-4bab-8bab-abababababab'::uuid)$q$);
  perform kubios_test.record('D13', 'D', 'vinculo creado para la prueba de borrado en cascada',
    jsonb_array_length(v->'rows') = 1, v::text);

  delete from public.users where "UserID" = 2003;
  select count(*) into v_count
    from kubios_private.user_member_links l
   where l.user_id = 2003;
  perform kubios_test.record('D14', 'D', 'ON DELETE CASCADE elimina el vinculo al borrar public.users',
    v_count = 0, format('vinculos restantes=%s', v_count));
end;
$$;

-- ===================== H. Pausa 429 / backoff y validacion =====================
do $$
declare
  v jsonb;
  v_state record;
  v_seconds numeric;
  v_error_code text;
  v_before jsonb;
  v_after jsonb;
begin
  -- Camino feliz de finish_sync y lectura sin lease.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('22222222-2222-4222-8222-222222222222'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  perform kubios_test.record('H1', 'H', 'equipo B: se adquiere el lease',
    (v->'rows'->0->>'acquired')::boolean, v::text);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_write_snapshot('22222222-2222-4222-8222-222222222222'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'f1111111-1111-4111-8111-111111111111'::uuid,
       decode('deadbeefcafebabe0011223344556677', 'hex'),
       decode('000102030405060708090a0b', 'hex'),
       decode('101112131415161718191a1b1c1d1e1f', 'hex'), 3) as updated_at$q$);
  perform kubios_test.record('H2', 'H', 'equipo B: se escribe snapshot con el lease',
    (v->'rows'->0->>'updated_at') is not null, v::text);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync('22222222-2222-4222-8222-222222222222'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, true, null, null) as finished$q$);
  select * into v_state from kubios_private.team_sync_state
   where team_id = '22222222-2222-4222-8222-222222222222'::uuid;
  perform kubios_test.record('H3', 'H', 'finish_sync con exito registra last_success_at y libera el lease',
    (v->'rows'->0->>'finished') = 'true'
      and v_state.last_success_at is not null
      and v_state.last_error_code is null
      and v_state.lease_owner is null
      and v_state.lease_expires_at is null,
    format('finished=%s last_success_at=%s last_error_code=%s lease_owner=%s',
      v->'rows'->0->>'finished', v_state.last_success_at, v_state.last_error_code, v_state.lease_owner));

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_snapshot('22222222-2222-4222-8222-222222222222'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$);
  perform kubios_test.record('H4', 'H', 'la lectura no exige lease: snapshot visible tras finish_sync',
    jsonb_array_length(v->'rows') = 1, v::text);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('22222222-2222-4222-8222-222222222222'::uuid,
       'f2222222-2222-4222-8222-222222222222'::uuid, 60) as acquired$q$);
  perform kubios_test.record('H5', 'H', 'lease liberado: otro owner puede adquirirlo',
    (v->'rows'->0->>'acquired')::boolean, v::text);

  -- 429: pausa y bloqueo del siguiente intento.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('33333333-3333-4333-8333-333333333333'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  perform kubios_test.record('H6', 'H', 'equipo C: se adquiere el lease para simular un 429',
    (v->'rows'->0->>'acquired')::boolean, v::text);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync('33333333-3333-4333-8333-333333333333'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, 'http.429', 30) as finished$q$);
  select * into v_state from kubios_private.team_sync_state
   where team_id = '33333333-3333-4333-8333-333333333333'::uuid;
  perform kubios_test.record('H7', 'H', 'fallo con retry_after=30 fija next_allowed_at y last_error_code',
    (v->'rows'->0->>'finished') = 'true'
      and v_state.last_error_code = 'http.429'
      and v_state.next_allowed_at > pg_catalog.clock_timestamp() + interval '25 seconds'
      and v_state.next_allowed_at <= pg_catalog.clock_timestamp() + interval '31 seconds',
    format('next_allowed_at=%s last_error_code=%s', v_state.next_allowed_at, v_state.last_error_code));

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('33333333-3333-4333-8333-333333333333'::uuid,
       'f2222222-2222-4222-8222-222222222222'::uuid, 60) as acquired$q$);
  perform kubios_test.record('H8', 'H', 'intento inmediato durante la pausa devuelve false',
    (v->'rows'->0->>'acquired') = 'false', v::text);

  -- No acortar una pausa vigente: se prepara una pausa de 1 h con el lease tomado (setup
  -- sintetico) y finish_sync con retry_after=5 no debe reducirla.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('66666666-6666-4666-8666-666666666666'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  perform kubios_test.record('H9a', 'H', 'setup: lease del equipo G adquirido',
    (v->'rows'->0->>'acquired')::boolean, v::text);
  perform kubios_test.exec_as('service_role',
    $q$update kubios_private.team_sync_state
          set next_allowed_at = pg_catalog.clock_timestamp() + interval '1 hour'
        where team_id = '66666666-6666-4666-8666-666666666666'::uuid$q$);

  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync('66666666-6666-4666-8666-666666666666'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, 'http.429', 5) as finished$q$);
  select extract(epoch from (s.next_allowed_at - pg_catalog.clock_timestamp())) into v_seconds
    from kubios_private.team_sync_state s
   where s.team_id = '66666666-6666-4666-8666-666666666666'::uuid;
  perform kubios_test.record('H9', 'H', 'una pausa nueva mas corta no acorta la pausa vigente',
    (v->'rows'->0->>'finished') = 'true' and v_seconds > 3500,
    format('segundos restantes=%s', round(v_seconds, 1)));

  -- Una pausa mayor si extiende la vigente (misma rama greatest()).
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('77777777-7777-4777-8777-777777777777'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  perform kubios_test.exec_as('service_role',
    $q$update kubios_private.team_sync_state
          set next_allowed_at = pg_catalog.clock_timestamp() + interval '5 seconds'
        where team_id = '77777777-7777-4777-8777-777777777777'::uuid$q$);
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync('77777777-7777-4777-8777-777777777777'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, 'http.429', 60) as finished$q$);
  select extract(epoch from (s.next_allowed_at - pg_catalog.clock_timestamp())) into v_seconds
    from kubios_private.team_sync_state s
   where s.team_id = '77777777-7777-4777-8777-777777777777'::uuid;
  perform kubios_test.record('H10', 'H', 'una pausa nueva mas larga extiende la vigente',
    (v->'rows'->0->>'finished') = 'true' and v_seconds > 55,
    format('segundos restantes=%s', round(v_seconds, 1)));

  -- Validacion de argumentos: SQLSTATE 22023.
  perform kubios_test.expect_error('H11', 'H', 'lease < 5 s: 22023', 'service_role',
    $q$select public.kubios_try_acquire_sync('55555555-5555-4555-8555-555555555555'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 4)$q$, '22023');
  perform kubios_test.expect_error('H12', 'H', 'lease > 3600 s: 22023', 'service_role',
    $q$select public.kubios_try_acquire_sync('55555555-5555-4555-8555-555555555555'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 3601)$q$, '22023');
  perform kubios_test.expect_error('H13', 'H', 'team_id nulo: 22023', 'service_role',
    $q$select public.kubios_try_acquire_sync(null::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60)$q$, '22023');
  perform kubios_test.expect_error('H14', 'H', 'lease_owner nulo: 22023', 'service_role',
    $q$select public.kubios_try_acquire_sync('55555555-5555-4555-8555-555555555555'::uuid,
       null::uuid, 60)$q$, '22023');
  perform kubios_test.expect_error('H15', 'H', 'fallo sin error_code: 22023', 'service_role',
    $q$select public.kubios_finish_sync('55555555-5555-4555-8555-555555555555'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, null, null)$q$, '22023');
  perform kubios_test.expect_error('H16', 'H', 'exito con error_code: 22023', 'service_role',
    $q$select public.kubios_finish_sync('55555555-5555-4555-8555-555555555555'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, true, 'http.429', null)$q$, '22023');
  perform kubios_test.expect_error('H17', 'H', 'error_code con formato invalido: 22023', 'service_role',
    $q$select public.kubios_finish_sync('55555555-5555-4555-8555-555555555555'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, 'HTTP 429', 10)$q$, '22023');
  perform kubios_test.expect_error('H18', 'H', 'retry_after 0: 22023', 'service_role',
    $q$select public.kubios_finish_sync('55555555-5555-4555-8555-555555555555'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, 'http.429', 0)$q$, '22023');
  -- K38: 86401 s (24 h + 1 s) ya no se rechaza; se persiste completo.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync('9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, 'http.429', 86401) as finished$q$);
  select extract(epoch from (s.next_allowed_at - pg_catalog.clock_timestamp())), s.last_error_code
    into v_seconds, v_error_code
    from kubios_private.team_sync_state s
   where s.team_id = '9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a'::uuid;
  perform kubios_test.record('H19', 'H', 'retry_after=86401 se acepta y fija ~24 h sin recorte',
    (v->'rows'->0->>'finished') = 'true'
      and v_error_code = 'http.429'
      and v_seconds > 86395 and v_seconds <= 86405,
    format('finished=%s segundos restantes=%s last_error_code=%s',
      v->'rows'->0->>'finished', round(v_seconds, 1), v_error_code));

  -- Maximo de integer: tambien se persiste completo (~68 anos).
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync('9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, 'http.429', 2147483647) as finished$q$);
  select extract(epoch from (s.next_allowed_at - pg_catalog.clock_timestamp())) into v_seconds
    from kubios_private.team_sync_state s
   where s.team_id = '9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b'::uuid;
  perform kubios_test.record('H19a', 'H', 'retry_after=2147483647 (max integer) se acepta sin recorte',
    (v->'rows'->0->>'finished') = 'true' and v_seconds > 2147483630,
    format('finished=%s segundos restantes=%s',
      v->'rows'->0->>'finished', round(v_seconds, 1)));

  -- >int4: el literal 2147483648 se resuelve como bigint (sin cast implicito a
  -- integer) o, si se forzara el cast, desbordaria. Se exige fallo y estado
  -- intacto, registrando el SQLSTATE real; no se asume 22023 ni un unico codigo.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('9c9c9c9c-9c9c-49c9-89c9-9c9c9c9c9c9c'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  select to_jsonb(s) into v_before from kubios_private.team_sync_state s
   where s.team_id = '9c9c9c9c-9c9c-49c9-89c9-9c9c9c9c9c9c'::uuid;
  v := kubios_test.exec_as('service_role',
    $q$select public.kubios_finish_sync('9c9c9c9c-9c9c-49c9-89c9-9c9c9c9c9c9c'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, 'http.429', 2147483648)$q$);
  select to_jsonb(s) into v_after from kubios_private.team_sync_state s
   where s.team_id = '9c9c9c9c-9c9c-49c9-89c9-9c9c9c9c9c9c'::uuid;
  perform kubios_test.record('H19b', 'H', 'retry_after > max integer se rechaza sin persistir (SQLSTATE real)',
    (v->>'ok') = 'false'
      and (v->>'sqlstate') in ('42883', '22003')
      and v_before is not null and v_before = v_after,
    format('sqlstate=%s mensaje=%s estado_intacto=%s',
      coalesce(v->>'sqlstate', '(sin error)'), coalesce(v->>'message', ''),
      (v_before is not null and v_before = v_after)));

  -- CHECK real de la tabla: formato de last_error_code y pareja del lease.
  perform kubios_test.expect_error('H20', 'H', 'CHECK last_error_code rechaza mensajes libres (23514)', 'service_role',
    $q$insert into kubios_private.team_sync_state(team_id, last_error_code)
       values ('88888888-8888-4888-8888-888888888888'::uuid, 'BAD CODE')$q$, '23514');
  perform kubios_test.expect_error('H21', 'H', 'CHECK lease_owner/lease_expires_at van juntos (23514)', 'service_role',
    $q$insert into kubios_private.team_sync_state(team_id, lease_owner)
       values ('88888888-8888-4888-8888-888888888888'::uuid,
               'f1111111-1111-4111-8111-111111111111'::uuid)$q$, '23514');

  -- K38: pausa indefinida. Mismo owner y lease vigente.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('9d9d9d9d-9d9d-49d9-89d9-9d9d9d9d9d9d'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync_indefinite('9d9d9d9d-9d9d-49d9-89d9-9d9d9d9d9d9d'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 'http.429') as finished$q$);
  select * into v_state from kubios_private.team_sync_state
   where team_id = '9d9d9d9d-9d9d-49d9-89d9-9d9d9d9d9d9d'::uuid;
  perform kubios_test.record('H22', 'H', 'indefinida con lease vigente: infinity y lease limpio',
    (v->'rows'->0->>'finished') = 'true'
      and v_state.next_allowed_at = 'infinity'::timestamptz
      and v_state.last_error_code = 'http.429'
      and v_state.lease_owner is null
      and v_state.lease_expires_at is null,
    format('finished=%s next_allowed_at=%s last_error_code=%s lease_owner=%s',
      v->'rows'->0->>'finished', v_state.next_allowed_at, v_state.last_error_code, v_state.lease_owner));

  -- K38 fail-closed: el mismo owner dejo caducar su lease y nadie lo tomo.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('9e9e9e9e-9e9e-49e9-89e9-9e9e9e9e9e9e'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  perform kubios_test.exec_as('service_role',
    $q$update kubios_private.team_sync_state
          set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
        where team_id = '9e9e9e9e-9e9e-49e9-89e9-9e9e9e9e9e9e'::uuid$q$);
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync_indefinite('9e9e9e9e-9e9e-49e9-89e9-9e9e9e9e9e9e'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 'auth.retry_after_invalid') as finished$q$);
  select * into v_state from kubios_private.team_sync_state
   where team_id = '9e9e9e9e-9e9e-49e9-89e9-9e9e9e9e9e9e'::uuid;
  perform kubios_test.record('H23', 'H', 'indefinida con lease expirado del mismo owner se persiste (fail-closed)',
    (v->'rows'->0->>'finished') = 'true'
      and v_state.next_allowed_at = 'infinity'::timestamptz
      and v_state.last_error_code = 'auth.retry_after_invalid'
      and v_state.lease_owner is null
      and v_state.lease_expires_at is null,
    format('finished=%s next_allowed_at=%s last_error_code=%s lease_owner=%s',
      v->'rows'->0->>'finished', v_state.next_allowed_at, v_state.last_error_code, v_state.lease_owner));

  -- K38 fence: otro owner no roba ni cierra el lease ajeno.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('9f9f9f9f-9f9f-49f9-89f9-9f9f9f9f9f9f'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 60) as acquired$q$);
  select to_jsonb(s) into v_before from kubios_private.team_sync_state s
   where s.team_id = '9f9f9f9f-9f9f-49f9-89f9-9f9f9f9f9f9f'::uuid;
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync_indefinite('9f9f9f9f-9f9f-49f9-89f9-9f9f9f9f9f9f'::uuid,
       'f2222222-2222-4222-8222-222222222222'::uuid, 'http.429') as finished$q$);
  select to_jsonb(s) into v_after from kubios_private.team_sync_state s
   where s.team_id = '9f9f9f9f-9f9f-49f9-89f9-9f9f9f9f9f9f'::uuid;
  perform kubios_test.record('H24', 'H', 'indefinida con owner distinto devuelve false y no toca estado/lease',
    (v->'rows'->0->>'finished') = 'false'
      and v_before is not null and v_before = v_after,
    format('finished=%s estado_intacto=%s', v->'rows'->0->>'finished',
      (v_before is not null and v_before = v_after)));

  -- K38: con next_allowed_at = infinity no se puede adquirir el lease.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('9d9d9d9d-9d9d-49d9-89d9-9d9d9d9d9d9d'::uuid,
       'f2222222-2222-4222-8222-222222222222'::uuid, 60) as acquired$q$);
  perform kubios_test.record('H25', 'H', 'tras la pausa indefinida, try_acquire devuelve false',
    (v->'rows'->0->>'acquired') = 'false', v::text);

  -- Setups sinteticos (como H9/H10): el diseno impide adquirir lease durante una
  -- pausa, asi que el lease se repone con un UPDATE controlado para probar que
  -- un finish_sync finito no acorta 'infinity'.
  perform kubios_test.exec_as('service_role',
    $q$update kubios_private.team_sync_state
          set lease_owner = 'f1111111-1111-4111-8111-111111111111'::uuid,
              lease_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
        where team_id = '9d9d9d9d-9d9d-49d9-89d9-9d9d9d9d9d9d'::uuid$q$);
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_finish_sync('9d9d9d9d-9d9d-49d9-89d9-9d9d9d9d9d9d'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, false, 'http.429', 60) as finished$q$);
  select * into v_state from kubios_private.team_sync_state
   where team_id = '9d9d9d9d-9d9d-49d9-89d9-9d9d9d9d9d9d'::uuid;
  perform kubios_test.record('H26', 'H', 'finish_sync finito posterior no acorta infinity',
    (v->'rows'->0->>'finished') = 'true'
      and v_state.next_allowed_at = 'infinity'::timestamptz
      and v_state.lease_owner is null
      and v_state.lease_expires_at is null,
    format('finished=%s next_allowed_at=%s lease_owner=%s',
      v->'rows'->0->>'finished', v_state.next_allowed_at, v_state.lease_owner));

  -- Permisos de la RPC nueva en catalogo (los intentos reales estan en A13-A15).
  perform kubios_test.record('H27', 'H', 'kubios_finish_sync_indefinite: solo service_role',
    has_function_privilege('service_role',
      'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE')
      and not has_function_privilege('anon',
        'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE')
      and not has_function_privilege('authenticated',
        'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE')
      and not has_function_privilege('authenticator',
        'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE'),
    format('service_role=%s anon=%s authenticated=%s authenticator=%s',
      has_function_privilege('service_role',
        'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE'),
      has_function_privilege('anon',
        'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE'),
      has_function_privilege('authenticated',
        'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE'),
      has_function_privilege('authenticator',
        'public.kubios_finish_sync_indefinite(uuid, uuid, text)', 'EXECUTE')));
end;
$$;

-- ===================== I. Token cifrado: lectura y fences =====================
do $$
declare
  v jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  -- El lease de team_a quedo vencido en F; se vuelve a adquirir con otro owner.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('11111111-1111-4111-8111-111111111111'::uuid,
       'f2222222-2222-4222-8222-222222222222'::uuid, 900) as acquired$q$);
  perform kubios_test.record('I1', 'I', 'lease caducado: un owner nuevo puede adquirir el equipo',
    (v->'rows'->0->>'acquired')::boolean, v::text);

  -- expires_at en el pasado: el contrato no filtra por expiracion, se conserva y es observable.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_write_token('11111111-1111-4111-8111-111111111111'::uuid,
       'f2222222-2222-4222-8222-222222222222'::uuid,
       decode('00112233445566778899aabbccddeeff', 'hex'),
       decode('0c0d0e0f1011121314151617', 'hex'),
       decode('202122232425262728292a2b2c2d2e2f', 'hex'), 9,
       '2026-01-02 03:04:05+00'::timestamptz)$q$);
  perform kubios_test.record('I2', 'I', 'service_role reemplaza el token cifrado bajo lease vigente',
    (v->>'ok')::boolean, v::text);

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_token('11111111-1111-4111-8111-111111111111'::uuid)$q$);
  perform kubios_test.record('I3', 'I', 'kubios_get_token devuelve el ciphertext exacto',
    jsonb_array_length(v->'rows') = 1
      and kubios_test.hexof(v->'rows'->0->>'ciphertext') = '00112233445566778899aabbccddeeff',
    'ciphertext=' || coalesce(kubios_test.hexof(v->'rows'->0->>'ciphertext'), 'null'));

  perform kubios_test.record('I4', 'I', 'kubios_get_token devuelve nonce, tag y key_version exactos',
    kubios_test.hexof(v->'rows'->0->>'nonce') = '0c0d0e0f1011121314151617'
      and kubios_test.hexof(v->'rows'->0->>'tag') = '202122232425262728292a2b2c2d2e2f'
      and (v->'rows'->0->>'key_version')::integer = 9,
    format('nonce=%s tag=%s key_version=%s',
      kubios_test.hexof(v->'rows'->0->>'nonce'),
      kubios_test.hexof(v->'rows'->0->>'tag'),
      v->'rows'->0->>'key_version'));

  perform kubios_test.record('I5', 'I', 'el token no coincide con el texto plano sintetico',
    kubios_test.hexof(v->'rows'->0->>'ciphertext') <> '504c41494e544558542d4b5542494f53',
    'ciphertext=' || coalesce(kubios_test.hexof(v->'rows'->0->>'ciphertext'), 'null'));

  perform kubios_test.record('I6', 'I', 'expiracion pasada conservada y observable (sin filtro)',
    (v->'rows'->0->>'expires_at')::timestamptz = '2026-01-02 03:04:05+00'::timestamptz,
    'expires_at=' || coalesce(v->'rows'->0->>'expires_at', 'null'));

  select to_jsonb(t) into v_before from kubios_private.encrypted_tokens t
   where t.team_id = '11111111-1111-4111-8111-111111111111'::uuid;
  -- La RPC no expone team_id, el resto de columnas debe coincidir exactamente.
  perform kubios_test.record('I7', 'I', 'la fila almacenada coincide con lo devuelto por la RPC',
    v_before is not null and (v->'rows'->0) = (v_before - 'team_id'), coalesce(v_before::text, 'null'));

  perform kubios_test.expect_error('I8', 'I', 'escritura de token con owner distinto: kubios_token_write_denied', 'service_role',
    $q$select public.kubios_write_token('11111111-1111-4111-8111-111111111111'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, decode('ff', 'hex'), decode('ff', 'hex'),
       decode('ff', 'hex'), 1, '2027-01-01 00:00:00+00'::timestamptz)$q$,
    'P0001', 'kubios_token_write_denied');

  select to_jsonb(t) into v_after from kubios_private.encrypted_tokens t
   where t.team_id = '11111111-1111-4111-8111-111111111111'::uuid;
  perform kubios_test.record('I9', 'I', 'token intacto tras la escritura rechazada',
    v_before is not null and v_before = v_after, coalesce(v_after::text, 'null'));

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_token('44444444-4444-4444-8444-444444444444'::uuid)$q$);
  perform kubios_test.record('I10', 'I', 'equipo sin token: cero filas, sin error',
    (v->>'ok')::boolean and jsonb_array_length(v->'rows') = 0, v::text);

  perform kubios_test.expect_error('I11', 'I', 'anon no puede leer kubios_private.encrypted_tokens', 'anon',
    $q$select * from kubios_private.encrypted_tokens$q$, '42501');

  perform kubios_test.expect_error('I12', 'I', 'authenticated no puede ejecutar kubios_get_token', 'authenticated',
    $q$select * from public.kubios_get_token('11111111-1111-4111-8111-111111111111'::uuid)$q$, '42501');
end;
$$;

-- ===================== J. Cursor durable K44 =====================
do $$
declare
  v jsonb;
  v_before jsonb;
  v_after jsonb;
  v_ok boolean;
  v_state text;
  v_violations integer;
begin
  -- J1: lease vigente del equipo de prueba del cursor.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 300) as acquired$q$);
  perform kubios_test.record('J1', 'J', 'cursor: lease del equipo de prueba adquirido',
    (v->'rows'->0->>'acquired')::boolean, v::text);

  -- J2: sin fila previa la lectura devuelve cero filas.
  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid)$q$);
  perform kubios_test.record('J2', 'J', 'cursor: lectura inicial sin fila devuelve cero filas',
    (v->>'ok')::boolean and jsonb_array_length(v->'rows') = 0, v::text);

  -- J3: primer avance con el owner vigente.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array['a2020202-0202-4202-8202-020202020202'::uuid]::uuid[],
       array[]::uuid[]) as moved$q$);
  perform kubios_test.record('J3', 'J', 'cursor: el owner vigente avanza el cursor',
    (v->'rows'->0->>'moved') = 'true', v::text);

  -- J4: la lectura devuelve exactamente lo persistido.
  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid)$q$);
  perform kubios_test.record('J4', 'J', 'cursor: lectura devuelve next y attempted persistidos',
    jsonb_array_length(v->'rows') = 1
      and (v->'rows'->0->>'next_member_id') = 'a1010101-0101-4101-8101-010101010101'
      and jsonb_array_length(v->'rows'->0->'attempted_member_ids') = 1
      and (v->'rows'->0->'attempted_member_ids'->>0) = 'a2020202-0202-4202-8202-020202020202'
      and jsonb_array_length(v->'rows'->0->'failed_member_ids') = 0,
    v::text);

  -- J5: fallos persistidos como subconjunto de los intentados.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a3030303-0303-4303-8303-030303030303'::uuid,
       array['a1010101-0101-4101-8101-010101010101'::uuid,
             'a2020202-0202-4202-8202-020202020202'::uuid]::uuid[],
       array['a1010101-0101-4101-8101-010101010101'::uuid]::uuid[]) as moved$q$);
  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid)$q$);
  perform kubios_test.record('J5', 'J', 'cursor: persiste fallos como subconjunto de intentados',
    jsonb_array_length(v->'rows') = 1
      and (v->'rows'->0->>'next_member_id') = 'a3030303-0303-4303-8303-030303030303'
      and jsonb_array_length(v->'rows'->0->'attempted_member_ids') = 2
      and jsonb_array_length(v->'rows'->0->'failed_member_ids') = 1
      and (v->'rows'->0->'failed_member_ids'->>0) = 'a1010101-0101-4101-8101-010101010101',
    v::text);

  -- J6/J7: un owner distinto no avanza ni modifica el cursor.
  select to_jsonb(cursor) into v_before
    from kubios_private.team_sync_cursor cursor
   where cursor.team_id = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid;
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f2222222-2222-4222-8222-222222222222'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array['a2020202-0202-4202-8202-020202020202'::uuid]::uuid[],
       array[]::uuid[]) as moved$q$);
  select to_jsonb(cursor) into v_after
    from kubios_private.team_sync_cursor cursor
   where cursor.team_id = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid;
  perform kubios_test.record('J6', 'J', 'cursor: owner distinto recibe false',
    (v->'rows'->0->>'moved') = 'false', v::text);
  perform kubios_test.record('J7', 'J', 'cursor: owner distinto no modifica el estado',
    v_before is not null and v_before = v_after,
    coalesce(v_after::text, 'null'));

  -- J8/J9/J10: lease caducado del mismo owner tampoco avanza.
  v := kubios_test.exec_as('service_role',
    $q$update kubios_private.team_sync_state
          set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
        where team_id = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid$q$);
  perform kubios_test.record('J8', 'J', 'cursor: setup de lease caducado',
    (v->>'ok')::boolean, v::text);

  select to_jsonb(cursor) into v_before
    from kubios_private.team_sync_cursor cursor
   where cursor.team_id = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid;
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array['a2020202-0202-4202-8202-020202020202'::uuid]::uuid[],
       array[]::uuid[]) as moved$q$);
  select to_jsonb(cursor) into v_after
    from kubios_private.team_sync_cursor cursor
   where cursor.team_id = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid;
  perform kubios_test.record('J9', 'J', 'cursor: lease caducado del mismo owner recibe false',
    (v->'rows'->0->>'moved') = 'false', v::text);
  perform kubios_test.record('J10', 'J', 'cursor: lease caducado no modifica el estado',
    v_before is not null and v_before = v_after,
    coalesce(v_after::text, 'null'));

  -- J11: se recupera el lease para las pruebas de lock y ACL.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_try_acquire_sync('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, 300) as acquired$q$);
  perform kubios_test.record('J11', 'J', 'cursor: lease recuperado tras caducar',
    (v->'rows'->0->>'acquired')::boolean, v::text);

  -- J12-J16: validacion de argumentos (22023).
  perform kubios_test.expect_error('J12', 'J', 'cursor: next dentro de attempted (22023)', 'service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array['a1010101-0101-4101-8101-010101010101'::uuid]::uuid[],
       array[]::uuid[])$q$, '22023');

  perform kubios_test.expect_error('J13', 'J', 'cursor: failed fuera de attempted (22023)', 'service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array['a2020202-0202-4202-8202-020202020202'::uuid]::uuid[],
       array['a3030303-0303-4303-8303-030303030303'::uuid]::uuid[])$q$, '22023');

  perform kubios_test.expect_error('J14', 'J', 'cursor: elemento nulo en attempted (22023)', 'service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array['a2020202-0202-4202-8202-020202020202'::uuid, null]::uuid[],
       array[]::uuid[])$q$, '22023');

  perform kubios_test.expect_error('J15', 'J', 'cursor: UUID duplicado en attempted (22023)', 'service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array['a2020202-0202-4202-8202-020202020202'::uuid,
             'a2020202-0202-4202-8202-020202020202'::uuid]::uuid[],
       array[]::uuid[])$q$, '22023');

  perform kubios_test.expect_error('J16a', 'J', 'cursor: team_id nulo (22023)', 'service_role',
    $q$select public.kubios_advance_sync_cursor(null::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array[]::uuid[], array[]::uuid[])$q$, '22023');
  perform kubios_test.expect_error('J16b', 'J', 'cursor: lease_owner nulo (22023)', 'service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       null::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array[]::uuid[], array[]::uuid[])$q$, '22023');
  perform kubios_test.expect_error('J16c', 'J', 'cursor: attempted nulo (22023)', 'service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       null::uuid[], array[]::uuid[])$q$, '22023');
  perform kubios_test.expect_error('J16d', 'J', 'cursor: failed nulo (22023)', 'service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       'a1010101-0101-4101-8101-010101010101'::uuid,
       array[]::uuid[], null::uuid[])$q$, '22023');

  -- J17: el CHECK de la tabla tambien protege una escritura directa.
  perform kubios_test.expect_error('J17', 'J', 'cursor: CHECK failed subset rechaza insercion directa (23514)', 'postgres',
    $q$insert into kubios_private.team_sync_cursor(team_id, attempted_member_ids, failed_member_ids)
       values ('c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2'::uuid,
               array['a1010101-0101-4101-8101-010101010101'::uuid]::uuid[],
               array['a2020202-0202-4202-8202-020202020202'::uuid]::uuid[])$q$, '23514');

  -- J20/J21: reset del ciclo con arrays vacios.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       null::uuid, array[]::uuid[], array[]::uuid[]) as moved$q$);
  perform kubios_test.record('J20', 'J', 'cursor: reset a ciclo nuevo con next nulo',
    (v->'rows'->0->>'moved') = 'true', v::text);

  v := kubios_test.query_as('service_role',
    $q$select * from public.kubios_get_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid)$q$);
  perform kubios_test.record('J21', 'J', 'cursor: lectura del reset devuelve arrays vacios',
    jsonb_array_length(v->'rows') = 1
      and (v->'rows'->0->>'next_member_id') is null
      and jsonb_array_length(v->'rows'->0->'attempted_member_ids') = 0
      and jsonb_array_length(v->'rows'->0->'failed_member_ids') = 0,
    v::text);

  -- J22-J25: solo service_role ejecuta las RPC del cursor.
  perform kubios_test.expect_error('J22', 'J', 'cursor: anon no ejecuta kubios_advance_sync_cursor', 'anon',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, null::uuid,
       array[]::uuid[], array[]::uuid[])$q$, '42501');
  perform kubios_test.expect_error('J23', 'J', 'cursor: authenticated no ejecuta kubios_advance_sync_cursor', 'authenticated',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, null::uuid,
       array[]::uuid[], array[]::uuid[])$q$, '42501');
  perform kubios_test.expect_error('J24', 'J', 'cursor: authenticator no hereda EXECUTE de kubios_advance_sync_cursor', 'authenticator',
    $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid, null::uuid,
       array[]::uuid[], array[]::uuid[])$q$, '42501');
  perform kubios_test.expect_error('J25', 'J', 'cursor: anon no ejecuta kubios_get_sync_cursor', 'anon',
    $q$select * from public.kubios_get_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid)$q$, '42501');
  perform kubios_test.expect_error('J26', 'J', 'cursor: authenticated no ejecuta kubios_get_sync_cursor', 'authenticated',
    $q$select * from public.kubios_get_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid)$q$, '42501');

  -- J27: catalogo de EXECUTE. service_role si; PUBLIC/anon/authenticated/authenticator no.
  select count(*) into v_violations
    from (
      select 1 where not has_function_privilege('service_role',
        'public.kubios_get_sync_cursor(uuid)', 'EXECUTE')
      union all
      select 1 where not has_function_privilege('service_role',
        'public.kubios_advance_sync_cursor(uuid, uuid, uuid, uuid[], uuid[])', 'EXECUTE')
      union all
      select 1 where not has_function_privilege('service_role',
        'kubios_private.kubios_get_sync_cursor(uuid)', 'EXECUTE')
      union all
      select 1 where not has_function_privilege('service_role',
        'kubios_private.kubios_advance_sync_cursor(uuid, uuid, uuid, uuid[], uuid[])', 'EXECUTE')
      union all
      select 1
        from (values ('anon'), ('authenticated'), ('authenticator')) as r(rname)
        cross join (values
          ('public.kubios_get_sync_cursor(uuid)'),
          ('public.kubios_advance_sync_cursor(uuid, uuid, uuid, uuid[], uuid[])'),
          ('kubios_private.kubios_get_sync_cursor(uuid)'),
          ('kubios_private.kubios_advance_sync_cursor(uuid, uuid, uuid, uuid[], uuid[])')
        ) as f(signature)
       where has_function_privilege(r.rname, f.signature, 'EXECUTE')
      union all
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where ((n.nspname = 'public' and p.proname in ('kubios_get_sync_cursor', 'kubios_advance_sync_cursor'))
              or (n.nspname = 'kubios_private'
                  and p.proname in ('kubios_get_sync_cursor', 'kubios_advance_sync_cursor')))
         and (p.proacl is null
              or exists (select 1 from aclexplode(p.proacl) a
                          where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
    ) as violations;
  perform kubios_test.record('J27', 'J', 'cursor: solo service_role tiene EXECUTE; sin PUBLIC/anon/authenticated/authenticator',
    v_violations = 0, format('violaciones=%s', v_violations));

  -- J28: sin privilegios directos sobre la tabla privada, RLS activo y sin politicas.
  select count(*) into v_violations
    from (
      select 1
        from (values ('service_role'), ('anon'), ('authenticated')) as r(rname)
        cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(pname)
       where has_table_privilege(r.rname, 'kubios_private.team_sync_cursor', p.pname)
      union all
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'kubios_private' and c.relname = 'team_sync_cursor'
         and (not c.relrowsecurity
              or exists (select 1 from pg_policies pol
                          where pol.schemaname = 'kubios_private' and pol.tablename = 'team_sync_cursor'))
    ) as violations;
  perform kubios_test.record('J28', 'J', 'cursor: tabla privada sin privilegios directos, RLS activo y sin politicas',
    v_violations = 0, format('violaciones=%s', v_violations));

  -- J29: helpers privados SECURITY DEFINER con search_path fijo.
  select count(*) into v_violations
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kubios_private'
     and p.proname in ('kubios_get_sync_cursor', 'kubios_advance_sync_cursor')
     and (not p.prosecdef
          or p.proconfig is null
          or not exists (
               select 1 from unnest(p.proconfig) cfg
                where cfg in ('search_path=""', 'search_path=pg_catalog, pg_temp')));
  perform kubios_test.record('J29', 'J', 'cursor: helpers privados SECURITY DEFINER con search_path fijo',
    v_violations = 0, format('violaciones=%s', v_violations));

  -- J30: wrappers publicos SECURITY INVOKER con search_path fijo.
  select count(*) into v_violations
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('kubios_get_sync_cursor', 'kubios_advance_sync_cursor')
     and (p.prosecdef
          or p.proconfig is null
          or not exists (
               select 1 from unnest(p.proconfig) cfg
                where cfg in ('search_path=""', 'search_path=pg_catalog, pg_temp')));
  perform kubios_test.record('J30', 'J', 'cursor: wrappers publicos SECURITY INVOKER con search_path fijo',
    v_violations = 0, format('violaciones=%s', v_violations));

  -- J31: la tabla solo existe en el esquema privado.
  perform kubios_test.record('J31', 'J', 'cursor: tabla solo en kubios_private, no en public',
    to_regclass('kubios_private.team_sync_cursor') is not null
      and to_regclass('public.team_sync_cursor') is null,
    format('private=%s public=%s',
      to_regclass('kubios_private.team_sync_cursor'),
      to_regclass('public.team_sync_cursor')));

  -- J34: sin fila de team_sync_state no hay lease que autorice el avance.
  v := kubios_test.query_as('service_role',
    $q$select public.kubios_advance_sync_cursor('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3'::uuid,
       'f1111111-1111-4111-8111-111111111111'::uuid,
       null::uuid, array[]::uuid[], array[]::uuid[]) as moved$q$);
  perform kubios_test.record('J34', 'J', 'cursor: equipo sin lease no mueve el cursor',
    (v->'rows'->0->>'moved') = 'false', v::text);
end;
$$;

-- J32/J33: lock real con una segunda sesion local. El bloque anterior ya
-- confirmo el lease del equipo; aqui nadie mas toca team_sync_state antes de
-- que la sesion remota tome el FOR UPDATE, de modo que el avance concurrente
-- espera (lock_timeout 55P03) y no escribe. Tras el rollback remoto, el mismo
-- avance se aplica.
do $$
declare
  v_before jsonb;
  v_after jsonb;
  v jsonb;
  v_state text;
begin
  select to_jsonb(cursor) into v_before
    from kubios_private.team_sync_cursor cursor
   where cursor.team_id = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid;

  perform dblink_connect('k44_lock', 'dbname=kubios_test');
  begin
    perform dblink_exec('k44_lock', 'begin');
    perform * from dblink('k44_lock',
      $q$select 1 from kubios_private.team_sync_state
          where team_id = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid
          for update$q$) as locked(i integer);

    perform set_config('lock_timeout', '400ms', true);
    begin
      perform public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
        'f1111111-1111-4111-8111-111111111111'::uuid,
        'a1010101-0101-4101-8101-010101010101'::uuid,
        array['a2020202-0202-4202-8202-020202020202'::uuid]::uuid[],
        array[]::uuid[]);
    exception when lock_not_available then
      get stacked diagnostics v_state = returned_sqlstate;
    end;
    perform set_config('lock_timeout', '0', true);

    select to_jsonb(cursor) into v_after
      from kubios_private.team_sync_cursor cursor
     where cursor.team_id = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid;
    perform kubios_test.record('J32', 'J', 'cursor: el avance espera el lock y no escribe (55P03)',
      v_state = '55P03' and v_before is not null and v_before = v_after,
      format('sqlstate=%s estado_intacto=%s', coalesce(v_state, '(sin error)'),
        (v_before is not null and v_before = v_after)));

    perform dblink_exec('k44_lock', 'rollback');

    v := kubios_test.query_as('service_role',
      $q$select public.kubios_advance_sync_cursor('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'::uuid,
         'f1111111-1111-4111-8111-111111111111'::uuid,
         'a1010101-0101-4101-8101-010101010101'::uuid,
         array['a2020202-0202-4202-8202-020202020202'::uuid]::uuid[],
         array[]::uuid[]) as moved$q$);
    perform kubios_test.record('J33', 'J', 'cursor: tras liberar el lock el avance se aplica',
      (v->'rows'->0->>'moved') = 'true', v::text);
  exception when others then
    begin
      perform dblink_exec('k44_lock', 'rollback');
    exception when others then
      null;
    end;
    perform dblink_disconnect('k44_lock');
    raise;
  end;
  perform dblink_disconnect('k44_lock');
end;
$$;

\echo ''
\echo '=== PASS/FAIL por comprobacion ==='
select rpad('[' || status || ']', 7) || ' ' || check_id || ' (' || criterion || ') ' || title as comprobacion,
       coalesce(detail, '') as evidencia
  from kubios_test.results
 order by seq;

\echo ''
select 'TOTAL=' || count(*) ||
       ' PASS=' || count(*) filter (where status = 'PASS') ||
       ' FAIL=' || count(*) filter (where status = 'FAIL') as resumen
  from kubios_test.results;

select 'KUBIOS_DB_TESTS_RESULT: ' ||
       case when count(*) filter (where status = 'FAIL') = 0 then 'PASS' else 'FAIL' end ||
       ' (' || count(*) || ' comprobaciones, ' ||
       count(*) filter (where status = 'FAIL') || ' fallidas)' as resultado
  from kubios_test.results;

do $$
declare
  v_total integer;
  v_fail  integer;
begin
  select count(*), count(*) filter (where status = 'FAIL')
    into v_total, v_fail
    from kubios_test.results;
  if v_total < 100 then
    raise exception 'KUBIOS_DB_TESTS_INCOMPLETE: solo % comprobaciones registradas', v_total;
  end if;
  if v_fail > 0 then
    raise exception 'KUBIOS_DB_TESTS_FAILED: % de % comprobaciones fallaron', v_fail, v_total;
  end if;
end;
$$;
'@

  Write-Step 'ejecutando comprobaciones'
  $tests = Invoke-Psql -Sql $testsSql
  Show-PsqlResult $tests
  if ($tests.ExitCode -ne 0) {
    Write-Bad "las comprobaciones fallaron (exit $($tests.ExitCode))"
    $script:ExitCode = 1
  }
  elseif ($tests.Text -notmatch 'KUBIOS_DB_TESTS_RESULT: PASS') {
    Write-Bad 'no se encontro el marcador KUBIOS_DB_TESTS_RESULT: PASS'
    $script:ExitCode = 1
  }
  else {
    Write-Step 'RESULTADO: PASS'
    $script:ExitCode = 0
  }
}
catch {
  Write-Bad $_.Exception.Message
  $script:ExitCode = if ($script:ExitCode -eq 1) { 1 } else { 2 }
}
finally {
  Remove-TestContainer
}

exit $script:ExitCode

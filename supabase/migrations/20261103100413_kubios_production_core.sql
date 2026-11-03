-- K49 - Nucleo Kubios para la base de produccion actual.
--
-- Consolida las nueve migraciones Kubios del checkout anterior
-- (20261027141807 .. 20261027160000) en una sola migracion porque ninguna de
-- ellas esta desplegada en la rama de release ni sus RPC son visibles en el
-- proyecto remoto. No se aplica SQL remoto desde este repositorio.
--
-- Diferencias deliberadas frente al original:
--   * public.users de produccion usa "UserID" integer (cookie HttpOnly), no una
--     identidad UUID. user_member_links.user_id y las RPC de vinculo usan
--     integer con FK a public.users("UserID") ON DELETE CASCADE.
--   * team_id y kubios_member_id siguen siendo uuid: son identificadores
--     opacos de Kubios Cloud, no identidades de la aplicacion.
--   * El esquema kubios_private y sus tablas solo son accesibles por
--     service_role. Las RPC publicas son SECURITY INVOKER y no existe ningun
--     SECURITY DEFINER en public. Los helpers del cursor viven en el esquema
--     privado, fuera de la Data API.
--   * Se conservan AES-256-GCM con version/AAD/nonce, el lease, el cursor y la
--     semantica de Retry-After finito/indefinido del diseno original.
--
-- No se tocan public.users ni las tablas de salud: solo se referencia
-- public.users("UserID") como clave foranea. No se incluye la migracion de
-- propiedad de filas del checkout antiguo.

create schema if not exists kubios_private;

-- Superficie privada: sin acceso para roles de la Data API ni para PUBLIC.
revoke all on schema kubios_private from public;
revoke all on schema kubios_private from anon, authenticated, authenticator;
revoke all on schema kubios_private from service_role;
grant usage on schema kubios_private to service_role;

-- service_role necesita resolver las RPC por nombre en el esquema publico.
grant usage on schema public to service_role;

-- ---------------------------------------------------------------------------
-- K07 - Snapshot cifrado por equipo y miembro.
-- ---------------------------------------------------------------------------

create table kubios_private.encrypted_snapshots (
  team_id uuid not null,
  member_id uuid not null,
  ciphertext bytea not null,
  nonce bytea not null,
  tag bytea not null,
  key_version integer not null,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint encrypted_snapshots_pkey primary key (team_id, member_id),
  constraint encrypted_snapshots_key_version_positive check (key_version > 0)
);

-- RLS activado y sin politicas: denegacion por defecto. service_role es el
-- unico consumidor y omite RLS por atributo del rol (BYPASSRLS).
alter table kubios_private.encrypted_snapshots enable row level security;

revoke all on table kubios_private.encrypted_snapshots from public;
revoke all on table kubios_private.encrypted_snapshots from anon, authenticated, authenticator;
revoke all on table kubios_private.encrypted_snapshots from service_role;
grant select, insert, update on table kubios_private.encrypted_snapshots to service_role;

-- ---------------------------------------------------------------------------
-- K08 - Vinculo usuario de la aplicacion <-> equipo/miembro de Kubios.
-- ---------------------------------------------------------------------------

create table kubios_private.user_member_links (
  user_id integer not null,
  team_id uuid not null,
  kubios_member_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint user_member_links_pkey primary key (user_id),
  constraint user_member_links_kubios_member_id_key unique (kubios_member_id),
  constraint user_member_links_user_id_fkey
    foreign key (user_id) references public.users ("UserID") on delete cascade
);

-- Un usuario tiene como maximo un vinculo y un miembro pertenece como maximo a
-- un usuario. La FK a public.users("UserID") borra el vinculo al borrar la
-- cuenta, igual que hacia la version UUID contra el proveedor de Auth.
alter table kubios_private.user_member_links enable row level security;

revoke all on table kubios_private.user_member_links from public;
revoke all on table kubios_private.user_member_links from anon, authenticated, authenticator;
revoke all on table kubios_private.user_member_links from service_role;
grant select, insert, update, delete on table kubios_private.user_member_links to service_role;

-- ---------------------------------------------------------------------------
-- K09 - Estado de sincronizacion y lease por equipo.
-- ---------------------------------------------------------------------------

create table kubios_private.team_sync_state (
  team_id uuid not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_allowed_at timestamptz,
  lease_owner uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  constraint team_sync_state_pkey primary key (team_id),
  constraint team_sync_state_last_error_code_format check (
    last_error_code is null
    or (
      pg_catalog.char_length(last_error_code) <= 64
      and last_error_code ~ '^[a-z0-9]+([._:-][a-z0-9]+)*$'
    )
  ),
  constraint team_sync_state_lease_pair check (
    (lease_owner is null) = (lease_expires_at is null)
  )
);

alter table kubios_private.team_sync_state enable row level security;

revoke all on table kubios_private.team_sync_state from public;
revoke all on table kubios_private.team_sync_state from anon, authenticated, authenticator;
revoke all on table kubios_private.team_sync_state from service_role;
grant select, insert, update on table kubios_private.team_sync_state to service_role;

-- ---------------------------------------------------------------------------
-- K36 - Token cifrado por equipo.
-- ---------------------------------------------------------------------------

create table kubios_private.encrypted_tokens (
  team_id uuid not null,
  ciphertext bytea not null,
  nonce bytea not null,
  tag bytea not null,
  key_version integer not null,
  expires_at timestamptz not null,
  constraint encrypted_tokens_pkey primary key (team_id),
  constraint encrypted_tokens_key_version_positive check (key_version > 0)
);

alter table kubios_private.encrypted_tokens enable row level security;

revoke all on table kubios_private.encrypted_tokens from public;
revoke all on table kubios_private.encrypted_tokens from anon, authenticated, authenticator;
revoke all on table kubios_private.encrypted_tokens from service_role;
grant select, insert, update on table kubios_private.encrypted_tokens to service_role;

-- ---------------------------------------------------------------------------
-- RPC de token cifrado.
-- ---------------------------------------------------------------------------

create or replace function public.kubios_get_token(p_team_id uuid)
returns table (
  ciphertext bytea,
  nonce bytea,
  tag bytea,
  key_version integer,
  expires_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select t.ciphertext, t.nonce, t.tag, t.key_version, t.expires_at
  from kubios_private.encrypted_tokens as t
  where t.team_id = p_team_id;
$$;

-- Escritura condicionada al lease vigente. El bloqueo FOR UPDATE sobre
-- team_sync_state serializa a los escritores del mismo equipo.
create or replace function public.kubios_write_token(
  p_team_id uuid,
  p_lease_owner uuid,
  p_ciphertext bytea,
  p_nonce bytea,
  p_tag bytea,
  p_key_version integer,
  p_expires_at timestamptz
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_lease_owner uuid;
  v_lease_expires_at timestamptz;
begin
  select s.lease_owner, s.lease_expires_at
    into v_lease_owner, v_lease_expires_at
  from kubios_private.team_sync_state as s
  where s.team_id = p_team_id
  for update;

  if not found
     or p_lease_owner is null
     or v_lease_owner is distinct from p_lease_owner
     or v_lease_expires_at is null
     or v_lease_expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception 'kubios_token_write_denied' using errcode = 'P0001';
  end if;

  insert into kubios_private.encrypted_tokens
    (team_id, ciphertext, nonce, tag, key_version, expires_at)
  values
    (p_team_id, p_ciphertext, p_nonce, p_tag, p_key_version, p_expires_at)
  on conflict (team_id) do update
    set ciphertext = excluded.ciphertext,
        nonce = excluded.nonce,
        tag = excluded.tag,
        key_version = excluded.key_version,
        expires_at = excluded.expires_at;
end;
$$;

revoke all on function public.kubios_get_token(uuid) from public;
revoke all on function public.kubios_get_token(uuid) from anon, authenticated, authenticator, service_role;
grant execute on function public.kubios_get_token(uuid) to service_role;

revoke all on function public.kubios_write_token(uuid, uuid, bytea, bytea, bytea, integer, timestamptz) from public;
revoke all on function public.kubios_write_token(uuid, uuid, bytea, bytea, bytea, integer, timestamptz) from anon, authenticated, authenticator, service_role;
grant execute on function public.kubios_write_token(uuid, uuid, bytea, bytea, bytea, integer, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- K10 - RPC de snapshot cifrado.
-- ---------------------------------------------------------------------------

create or replace function public.kubios_get_snapshot(
  p_team_id uuid,
  p_member_id uuid
)
returns table (
  ciphertext bytea,
  nonce bytea,
  tag bytea,
  key_version integer,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.ciphertext,
         s.nonce,
         s.tag,
         s.key_version,
         s.updated_at
    from kubios_private.encrypted_snapshots s
   where s.team_id = p_team_id
     and s.member_id = p_member_id;
$$;

create or replace function public.kubios_write_snapshot(
  p_team_id uuid,
  p_member_id uuid,
  p_lease_owner uuid,
  p_ciphertext bytea,
  p_nonce bytea,
  p_tag bytea,
  p_key_version integer
)
returns timestamptz
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_lease_owner uuid;
  v_lease_expires_at timestamptz;
  v_updated_at timestamptz;
begin
  if p_team_id is null
     or p_member_id is null
     or p_lease_owner is null
     or p_ciphertext is null
     or p_nonce is null
     or p_tag is null
     or p_key_version is null then
    raise exception 'kubios_snapshot_invalid_argument'
      using errcode = 'P0001';
  end if;

  select state.lease_owner, state.lease_expires_at
    into v_lease_owner, v_lease_expires_at
    from kubios_private.team_sync_state state
   where state.team_id = p_team_id
     for update;

  if not found then
    raise exception 'kubios_sync_lease_missing'
      using errcode = 'P0001';
  end if;

  if v_lease_owner is distinct from p_lease_owner then
    raise exception 'kubios_sync_lease_owner_mismatch'
      using errcode = 'P0001';
  end if;

  if v_lease_expires_at is null
     or v_lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'kubios_sync_lease_expired'
      using errcode = 'P0001';
  end if;

  insert into kubios_private.encrypted_snapshots as snapshot (
    team_id,
    member_id,
    ciphertext,
    nonce,
    tag,
    key_version,
    updated_at
  )
  values (
    p_team_id,
    p_member_id,
    p_ciphertext,
    p_nonce,
    p_tag,
    p_key_version,
    pg_catalog.now()
  )
  on conflict (team_id, member_id) do update
    set ciphertext = excluded.ciphertext,
        nonce = excluded.nonce,
        tag = excluded.tag,
        key_version = excluded.key_version,
        updated_at = pg_catalog.now()
  returning snapshot.updated_at into v_updated_at;

  return v_updated_at;
end;
$$;

revoke all on function public.kubios_get_snapshot(uuid, uuid) from public;
revoke all on function public.kubios_get_snapshot(uuid, uuid) from anon, authenticated, authenticator, service_role;
grant execute on function public.kubios_get_snapshot(uuid, uuid) to service_role;

revoke all on function public.kubios_write_snapshot(uuid, uuid, uuid, bytea, bytea, bytea, integer) from public;
revoke all on function public.kubios_write_snapshot(uuid, uuid, uuid, bytea, bytea, bytea, integer) from anon, authenticated, authenticator, service_role;
grant execute on function public.kubios_write_snapshot(uuid, uuid, uuid, bytea, bytea, bytea, integer) to service_role;

-- ---------------------------------------------------------------------------
-- K34 - RPC de vinculo usuario entero <-> equipo/miembro UUID.
-- ---------------------------------------------------------------------------

create or replace function public.kubios_get_user_member_link(p_user_id integer)
returns table (
  user_id integer,
  team_id uuid,
  kubios_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select l.user_id, l.team_id, l.kubios_member_id, l.created_at, l.updated_at
  from kubios_private.user_member_links as l
  where l.user_id = p_user_id;
$$;

create or replace function public.kubios_assign_user_member_link(
  p_user_id integer,
  p_team_id uuid,
  p_kubios_member_id uuid
)
returns table (
  user_id integer,
  team_id uuid,
  kubios_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
  insert into kubios_private.user_member_links as l (user_id, team_id, kubios_member_id)
  values (p_user_id, p_team_id, p_kubios_member_id)
  on conflict (user_id) do update
    set team_id = excluded.team_id,
        kubios_member_id = excluded.kubios_member_id,
        updated_at = case
          when l.team_id is distinct from excluded.team_id
            or l.kubios_member_id is distinct from excluded.kubios_member_id
          then pg_catalog.now()
          else l.updated_at
        end
  returning l.user_id, l.team_id, l.kubios_member_id, l.created_at, l.updated_at;
$$;

create or replace function public.kubios_revoke_user_member_link(p_user_id integer)
returns boolean
language sql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
  with removed as (
    delete from kubios_private.user_member_links as l
    where l.user_id = p_user_id
    returning 1
  )
  select exists (select 1 from removed);
$$;

comment on function public.kubios_get_user_member_link(integer) is
  'K49: devuelve el vinculo del UserID integer de public.users, o cero filas.';
comment on function public.kubios_assign_user_member_link(integer, uuid, uuid) is
  'K49: crea o reasigna de forma atomica el vinculo team/member del UserID integer.';
comment on function public.kubios_revoke_user_member_link(integer) is
  'K49: revoca el vinculo del UserID integer; false si no existia (idempotente).';

revoke all on function public.kubios_get_user_member_link(integer) from public;
revoke all on function public.kubios_get_user_member_link(integer) from anon, authenticated, authenticator, service_role;
revoke all on function public.kubios_assign_user_member_link(integer, uuid, uuid) from public;
revoke all on function public.kubios_assign_user_member_link(integer, uuid, uuid) from anon, authenticated, authenticator, service_role;
revoke all on function public.kubios_revoke_user_member_link(integer) from public;
revoke all on function public.kubios_revoke_user_member_link(integer) from anon, authenticated, authenticator, service_role;

grant execute on function public.kubios_get_user_member_link(integer) to service_role;
grant execute on function public.kubios_assign_user_member_link(integer, uuid, uuid) to service_role;
grant execute on function public.kubios_revoke_user_member_link(integer) to service_role;

-- ---------------------------------------------------------------------------
-- K35/K38 - Lease atomico y pausa de sincronizacion.
-- ---------------------------------------------------------------------------

create or replace function public.kubios_try_acquire_sync(
  p_team_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_rows integer;
begin
  if p_team_id is null then
    raise exception 'p_team_id is required'
      using errcode = '22023';
  end if;

  if p_lease_owner is null then
    raise exception 'p_lease_owner is required'
      using errcode = '22023';
  end if;

  if p_lease_seconds is null
     or p_lease_seconds < 5
     or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 5 and 3600'
      using errcode = '22023';
  end if;

  insert into kubios_private.team_sync_state as t (
    team_id,
    last_attempt_at,
    lease_owner,
    lease_expires_at
  )
  values (
    p_team_id,
    v_now,
    p_lease_owner,
    v_now + pg_catalog.make_interval(secs => p_lease_seconds)
  )
  on conflict (team_id) do update
    set last_attempt_at = excluded.last_attempt_at,
        lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at
    where (t.lease_expires_at is null
           or t.lease_expires_at <= excluded.last_attempt_at)
      and (t.next_allowed_at is null
           or t.next_allowed_at <= excluded.last_attempt_at);

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

create or replace function public.kubios_finish_sync(
  p_team_id uuid,
  p_lease_owner uuid,
  p_success boolean,
  p_error_code text,
  p_retry_after_seconds integer
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_rows integer;
begin
  if p_team_id is null then
    raise exception 'p_team_id is required'
      using errcode = '22023';
  end if;

  if p_lease_owner is null then
    raise exception 'p_lease_owner is required'
      using errcode = '22023';
  end if;

  if p_success is null then
    raise exception 'p_success is required'
      using errcode = '22023';
  end if;

  if p_success then
    if p_error_code is not null or p_retry_after_seconds is not null then
      raise exception 'p_error_code and p_retry_after_seconds must be null on success'
        using errcode = '22023';
    end if;
  else
    if p_error_code is null then
      raise exception 'p_error_code is required on failure'
        using errcode = '22023';
    end if;

    if pg_catalog.char_length(p_error_code) > 64
       or p_error_code !~ '^[a-z0-9]+([._:-][a-z0-9]+)*$' then
      raise exception 'p_error_code must be a short lowercase code'
        using errcode = '22023';
    end if;

    -- Maximo de integer: cualquier plazo representable se persiste completo.
    if p_retry_after_seconds is not null
       and (p_retry_after_seconds < 1 or p_retry_after_seconds > 2147483647) then
      raise exception 'p_retry_after_seconds must be between 1 and 2147483647'
        using errcode = '22023';
    end if;
  end if;

  update kubios_private.team_sync_state as t
     set last_success_at = case
           when p_success then v_now
           else t.last_success_at
         end,
         last_error_code = case
           when p_success then null
           else p_error_code
         end,
         next_allowed_at = case
           when p_retry_after_seconds is null then t.next_allowed_at
           else greatest(
             t.next_allowed_at,
             v_now + pg_catalog.make_interval(secs => p_retry_after_seconds)
           )
         end,
         lease_owner = null,
         lease_expires_at = null
   where t.team_id = p_team_id
     and t.lease_owner = p_lease_owner
     and t.lease_expires_at > v_now;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

create or replace function public.kubios_finish_sync_indefinite(
  p_team_id uuid,
  p_lease_owner uuid,
  p_error_code text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_rows integer;
begin
  if p_team_id is null then
    raise exception 'p_team_id is required'
      using errcode = '22023';
  end if;

  if p_lease_owner is null then
    raise exception 'p_lease_owner is required'
      using errcode = '22023';
  end if;

  if p_error_code is null then
    raise exception 'p_error_code is required'
      using errcode = '22023';
  end if;

  if pg_catalog.char_length(p_error_code) > 64
     or p_error_code !~ '^[a-z0-9]+([._:-][a-z0-9]+)*$' then
    raise exception 'p_error_code must be a short lowercase code'
      using errcode = '22023';
  end if;

  -- Fence por owner: nunca se toca el lease de otro trabajador. Si el mismo
  -- owner dejo caducar su lease y nadie lo tomo, la pausa se persiste igual
  -- (fail-closed); no se exige lease_expires_at > now en esta RPC.
  update kubios_private.team_sync_state as t
     set last_error_code = p_error_code,
         next_allowed_at = 'infinity'::pg_catalog.timestamptz,
         lease_owner = null,
         lease_expires_at = null
   where t.team_id = p_team_id
     and t.lease_owner = p_lease_owner;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

comment on function public.kubios_try_acquire_sync(uuid, uuid, integer) is
  'K49: toma atomica del lease de sincronizacion de un equipo; true si se adquiere.';
comment on function public.kubios_finish_sync(uuid, uuid, boolean, text, integer) is
  'K49: cierra el intento del owner con lease vigente; pausa finita 1..2147483647 s.';
comment on function public.kubios_finish_sync_indefinite(uuid, uuid, text) is
  'K49: pausa indefinida con next_allowed_at = infinity; exige limpieza administrativa.';

revoke all on function public.kubios_try_acquire_sync(uuid, uuid, integer) from public;
revoke all on function public.kubios_try_acquire_sync(uuid, uuid, integer) from anon, authenticated, authenticator, service_role;
revoke all on function public.kubios_finish_sync(uuid, uuid, boolean, text, integer) from public;
revoke all on function public.kubios_finish_sync(uuid, uuid, boolean, text, integer) from anon, authenticated, authenticator, service_role;
revoke all on function public.kubios_finish_sync_indefinite(uuid, uuid, text) from public;
revoke all on function public.kubios_finish_sync_indefinite(uuid, uuid, text) from anon, authenticated, authenticator, service_role;

grant execute on function public.kubios_try_acquire_sync(uuid, uuid, integer) to service_role;
grant execute on function public.kubios_finish_sync(uuid, uuid, boolean, text, integer) to service_role;
grant execute on function public.kubios_finish_sync_indefinite(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- K44 - Cursor durable por equipo.
-- ---------------------------------------------------------------------------

create table kubios_private.team_sync_cursor (
  team_id uuid not null,
  next_member_id uuid,
  attempted_member_ids uuid[] not null default '{}'::uuid[],
  failed_member_ids uuid[] not null default '{}'::uuid[],
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint team_sync_cursor_pkey primary key (team_id),
  constraint team_sync_cursor_failed_subset check (
    failed_member_ids <@ attempted_member_ids
  ),
  constraint team_sync_cursor_next_not_attempted check (
    next_member_id is null
    or not (next_member_id = any (attempted_member_ids))
  ),
  constraint team_sync_cursor_arrays_clean check (
    pg_catalog.array_position(attempted_member_ids, null) is null
    and pg_catalog.array_position(failed_member_ids, null) is null
    and pg_catalog.cardinality(attempted_member_ids) <= 10000
    and pg_catalog.cardinality(failed_member_ids) <= 10000
  )
);

alter table kubios_private.team_sync_cursor enable row level security;

revoke all on table kubios_private.team_sync_cursor from public;
revoke all on table kubios_private.team_sync_cursor from anon, authenticated, authenticator;
revoke all on table kubios_private.team_sync_cursor from service_role;

-- Helpers privados: solo ellos tocan la tabla. El esquema no esta expuesto en
-- la Data API; los wrappers publicos son SECURITY INVOKER y no elevan
-- privilegios.
create or replace function kubios_private.kubios_get_sync_cursor(
  p_team_id uuid
)
returns table (
  next_member_id uuid,
  attempted_member_ids uuid[],
  failed_member_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_team_id is null then
    raise exception 'kubios_sync_cursor_invalid_argument'
      using errcode = '22023';
  end if;

  return query
    select cursor.next_member_id,
           cursor.attempted_member_ids,
           cursor.failed_member_ids
      from kubios_private.team_sync_cursor cursor
     where cursor.team_id = p_team_id;
end;
$function$;

create or replace function kubios_private.kubios_advance_sync_cursor(
  p_team_id uuid,
  p_lease_owner uuid,
  p_next_member_id uuid,
  p_attempted_member_ids uuid[],
  p_failed_member_ids uuid[]
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_lease_owner uuid;
  v_lease_expires_at timestamptz;
  v_attempted_count integer;
  v_failed_count integer;
  v_attempted_distinct integer;
  v_failed_distinct integer;
begin
  if p_team_id is null
     or p_lease_owner is null
     or p_attempted_member_ids is null
     or p_failed_member_ids is null then
    raise exception 'kubios_sync_cursor_invalid_argument'
      using errcode = '22023';
  end if;

  v_attempted_count := pg_catalog.cardinality(p_attempted_member_ids);
  v_failed_count := pg_catalog.cardinality(p_failed_member_ids);

  if v_attempted_count > 10000 or v_failed_count > 10000 then
    raise exception 'kubios_sync_cursor_invalid_argument'
      using errcode = '22023';
  end if;

  if pg_catalog.array_position(p_attempted_member_ids, null) is not null
     or pg_catalog.array_position(p_failed_member_ids, null) is not null then
    raise exception 'kubios_sync_cursor_invalid_argument'
      using errcode = '22023';
  end if;

  if not (p_failed_member_ids <@ p_attempted_member_ids) then
    raise exception 'kubios_sync_cursor_invalid_argument'
      using errcode = '22023';
  end if;

  if p_next_member_id is not null
     and p_next_member_id = any (p_attempted_member_ids) then
    raise exception 'kubios_sync_cursor_invalid_argument'
      using errcode = '22023';
  end if;

  select pg_catalog.count(distinct members.member_id)::integer
    into v_attempted_distinct
    from pg_catalog.unnest(p_attempted_member_ids) as members(member_id);

  select pg_catalog.count(distinct members.member_id)::integer
    into v_failed_distinct
    from pg_catalog.unnest(p_failed_member_ids) as members(member_id);

  if v_attempted_distinct <> v_attempted_count
     or v_failed_distinct <> v_failed_count then
    raise exception 'kubios_sync_cursor_invalid_argument'
      using errcode = '22023';
  end if;

  -- Orden de bloqueo fijo: primero el estado del equipo. El lease se relee
  -- bajo el lock (READ COMMITTED devuelve la fila vigente tras esperar).
  select state.lease_owner, state.lease_expires_at
    into v_lease_owner, v_lease_expires_at
    from kubios_private.team_sync_state state
   where state.team_id = p_team_id
     for update;

  if not found then
    return false;
  end if;

  if v_lease_owner is distinct from p_lease_owner then
    return false;
  end if;

  if v_lease_expires_at is null
     or v_lease_expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;

  insert into kubios_private.team_sync_cursor as cursor (
    team_id,
    next_member_id,
    attempted_member_ids,
    failed_member_ids,
    updated_at
  )
  values (
    p_team_id,
    p_next_member_id,
    p_attempted_member_ids,
    p_failed_member_ids,
    pg_catalog.clock_timestamp()
  )
  on conflict (team_id) do update
    set next_member_id = excluded.next_member_id,
        attempted_member_ids = excluded.attempted_member_ids,
        failed_member_ids = excluded.failed_member_ids,
        updated_at = excluded.updated_at;

  return true;
end;
$function$;

-- Wrappers publicos SECURITY INVOKER: solo reenvian la llamada.
create or replace function public.kubios_get_sync_cursor(
  p_team_id uuid
)
returns table (
  next_member_id uuid,
  attempted_member_ids uuid[],
  failed_member_ids uuid[]
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select cursor.next_member_id,
         cursor.attempted_member_ids,
         cursor.failed_member_ids
    from kubios_private.kubios_get_sync_cursor(p_team_id) as cursor;
$function$;

create or replace function public.kubios_advance_sync_cursor(
  p_team_id uuid,
  p_lease_owner uuid,
  p_next_member_id uuid,
  p_attempted_member_ids uuid[],
  p_failed_member_ids uuid[]
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $function$
  select kubios_private.kubios_advance_sync_cursor(
    p_team_id,
    p_lease_owner,
    p_next_member_id,
    p_attempted_member_ids,
    p_failed_member_ids
  );
$function$;

comment on table kubios_private.team_sync_cursor is
  'K49: cursor durable y fallos por equipo para repartir miembros entre pasadas.';
comment on function public.kubios_get_sync_cursor(uuid) is
  'K49: wrapper de lectura del cursor para service_role.';
comment on function public.kubios_advance_sync_cursor(uuid, uuid, uuid, uuid[], uuid[]) is
  'K49: wrapper de avance del cursor; solo service_role.';

revoke all on function kubios_private.kubios_get_sync_cursor(uuid)
  from public, anon, authenticated, authenticator, service_role;
revoke all on function kubios_private.kubios_advance_sync_cursor(uuid, uuid, uuid, uuid[], uuid[])
  from public, anon, authenticated, authenticator, service_role;

grant execute on function kubios_private.kubios_get_sync_cursor(uuid)
  to service_role;
grant execute on function kubios_private.kubios_advance_sync_cursor(uuid, uuid, uuid, uuid[], uuid[])
  to service_role;

revoke all on function public.kubios_get_sync_cursor(uuid)
  from public, anon, authenticated, authenticator, service_role;
revoke all on function public.kubios_advance_sync_cursor(uuid, uuid, uuid, uuid[], uuid[])
  from public, anon, authenticated, authenticator, service_role;

grant execute on function public.kubios_get_sync_cursor(uuid)
  to service_role;
grant execute on function public.kubios_advance_sync_cursor(uuid, uuid, uuid, uuid[], uuid[])
  to service_role;

-- PostgREST recarga su cache de esquema al terminar la migracion. No se
-- ejecuta contra un proyecto remoto desde este repositorio.
notify pgrst, 'reload schema';

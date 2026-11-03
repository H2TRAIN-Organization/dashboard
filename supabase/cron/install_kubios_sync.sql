-- K49 - Supabase Cron para invocar /api/cron/kubios-sync cada 5 minutos.
--
-- Alcance:
--   * Deja PREPARADA (no activada) la programacion de Supabase Cron que cada 5
--     minutos encola un POST HTTP a la ruta Vercel /api/cron/kubios-sync.
--   * La URL del endpoint y el secreto Bearer se leen por NOMBRE en cada
--     ejecucion desde vault.decrypted_secrets: kubios_sync_cron_url y
--     kubios_sync_cron_secret. Este archivo no contiene valores de secretos.
--   * El comando del job es solo select kubios_private.kubios_sync_cron_tick();
--     el POST lo hace net.http_post dentro de una funcion security definer.
--   * El job se crea con active = false. Activarlo es un paso humano explicito
--     documentado en README.md; ejecutar este archivo no lo deja corriendo.
--
-- Por que este archivo NO vive en supabase/migrations/:
--   * Cualquier despliegue que aplique migraciones (supabase db push, CI, etc.)
--     ejecutaria automaticamente todo lo que este en supabase/migrations/. Al
--     mantenerse fuera, aplicar migraciones normales NO crea el job ni activa
--     el cron. Se ejecuta a mano, una vez, tras la revision humana y solo
--     cuando la ruta /api/cron/kubios-sync este desplegada.
--
-- Idempotencia y unicidad:
--   * Antes de programar se eliminan los jobs visibles con el jobname
--     kubios-sync-every-5-minutes. Despues se crea con
--     cron.schedule(jobname, ...), disponible desde pg_cron 1.3; el script
--     exige 1.4+ porque usa cron.alter_job. Reejecutar el archivo deja
--     exactamente un job con schedule '*/5 * * * *'.
--   * REINSTALACION TRAS ACTIVAR: el job se recrea SIEMPRE inactivo, el jobid
--     cambia y el historial anterior queda asociado al jobid viejo. Si el job
--     previo estaba activo se emite un NOTICE; hay que reactivarlo a mano. No
--     reejecutes el instalador tras activar salvo que quieras volver a pausar.
--   * cron.job tiene RLS (username = current_user): el script debe ejecutarse
--     como postgres, que es el rol que crea y ejecuta el job. Si otro rol
--     creara un job con el mismo nombre, podria no ser visible ni eliminable
--     desde este bucle; no crees este job desde otros roles ni desde la Data
--     API.
--
-- Extensiones (verificado en la documentacion vigente de Supabase, 2026-10-27):
--   * pg_cron: CREATE EXTENSION pg_cron; crea el esquema cron y las funciones
--     cron.schedule/cron.unschedule/cron.alter_job. Su .control fija el esquema
--     en pg_catalog, por eso no se usa WITH SCHEMA.
--   * pg_net: se registra en el esquema extensions y crea su propio esquema net
--     (net.http_post, net.http_request_queue). La documentacion de Supabase
--     recomienda CREATE EXTENSION pg_net WITH SCHEMA extensions.
--   * En un proyecto Supabase puede que ya esten habilitadas: IF NOT EXISTS las
--     deja como esten. Si el rol postgres no pudiera crearlas, habilitarlas
--     desde Dashboard > Database > Extensions y reejecutar solo el resto.
--
-- Dependencias:
--   * Migracion consolidada 20261103100413_kubios_production_core.sql:
--     esquema kubios_private, team_sync_state y cursor. Este archivo no crea el
--     esquema.
--   * Ruta POST /api/cron/kubios-sync desplegada. Contrato previsto: POST,
--     cabecera Authorization: Bearer <secreto>, cuerpo JSON vacio ({}),
--     respuesta 2xx para exito y 401 para secreto invalido, sin devolver el
--     secreto. Confirmar el contrato antes de activar.
--   * Revision humana pendiente antes de habilitar.
--
-- Seguridad:
--   * Solo instala el rol postgres; el job se crea con el rol que instala y el
--     diseno asume postgres. El script aborta con el rol actual si no es
--     postgres, para no crear una programacion bajo otra identidad/RLS.
--   * Se recortan espacios, tabuladores y saltos de linea de los extremos de la
--     URL y del secreto antes de validar y usar; el valor recortado no se
--     registra ni se devuelve. El btrim no toca caracteres internos: un espacio
--     o control interno en la URL, o un control interno en el secreto, se
--     rechaza porque romperia la peticion o la cabecera Authorization.
--   * Ningun secreto en este archivo, en cron.job.command, en tablas propias,
--     en comentarios ni en logs. Los mensajes de error nombran el secreto
--     ausente o invalido, nunca su valor.
--   * Funcion security definer con search_path vacio y referencias
--     cualificadas; EXECUTE revocado de PUBLIC, anon, authenticated,
--     authenticator y service_role; grant solo a postgres. Los superusuarios
--     pueden ejecutar cualquier funcion por su privilegio, no por un grant.
--   * Riesgo residual de pg_net documentado en README.md: las cabeceras del
--     POST (Authorization incluido) pasan temporalmente por
--     net.http_request_queue y las respuestas por net._http_response.
--
-- Operacion (verificacion, activacion, pausa, rotacion y desinstalacion):
--   README.md de este mismo directorio.

-- Guarda de rol antes de cualquier DDL: el job se crea con el rol que instala,
-- y el diseno asume postgres (dueno de la funcion y unico con EXECUTE
-- concedido). No se permite supabase_admin ni otro rol privilegiado.
do $role_guard$
declare
  v_role text := current_user::text;
begin
  if v_role <> 'postgres' then
    raise exception 'kubios sync cron must be installed as postgres; current role is %. Connect as postgres or run set role postgres; if your role allows it', v_role
      using errcode = '42501';
  end if;
end;
$role_guard$;

-- En Supabase el esquema extensions ya existe; se mantiene el IF NOT EXISTS
-- para que la instalacion sea repetible en proyectos nuevos.
create schema if not exists extensions;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Fail-closed: sin la migracion consolidada no hay esquema privado ni estado
-- de sincronizacion donde alojar la funcion.
do $guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_namespace as n
    where n.nspname = 'kubios_private'
  ) then
    raise exception 'kubios_private schema is missing: apply 20261103100413_kubios_production_core.sql before installing the kubios sync cron'
      using errcode = 'P0001';
  end if;

  if to_regclass('kubios_private.team_sync_state') is null then
    raise exception 'kubios_private.team_sync_state is missing: apply 20261103100413_kubios_production_core.sql before installing the kubios sync cron'
      using errcode = 'P0001';
  end if;
end;
$guard$;

-- Encola el POST con pg_net. La URL y el secreto se leen de Vault por nombre en
-- cada ejecucion, asi que rotar el secreto no requiere reprogramar el job.
-- security definer + search_path vacio: el job corre como postgres y solo esta
-- funcion puede leer vault.decrypted_secrets y llamar a net.http_post.
-- El cuerpo {} es un JSON vacio; la ruta no debe exigir campos adicionales.
create or replace function kubios_private.kubios_sync_cron_tick()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  -- Se recortan espacios, tabuladores y saltos de linea de los extremos (es
  -- habitual al pegar valores en Vault) antes de validar y usar el valor.
  -- btrim no toca caracteres internos; los valores recortados no se registran.
  select pg_catalog.btrim(s.decrypted_secret, E' \t\r\n')
    into v_url
  from vault.decrypted_secrets as s
  where s.name = 'kubios_sync_cron_url';

  if v_url is null or v_url = '' then
    raise exception 'vault secret kubios_sync_cron_url is missing or empty'
      using errcode = 'P0001';
  end if;

  -- Un espacio o control interno romperia la URL; no se registra el valor.
  if v_url ~ '[[:space:][:cntrl:]]' then
    raise exception 'vault secret kubios_sync_cron_url must not contain internal whitespace or control characters'
      using errcode = 'P0001';
  end if;

  -- El secreto de invocacion solo viaja por HTTPS. No se registra el valor.
  if v_url !~ '^https://' then
    raise exception 'vault secret kubios_sync_cron_url must start with https://'
      using errcode = 'P0001';
  end if;

  select pg_catalog.btrim(s.decrypted_secret, E' \t\r\n')
    into v_secret
  from vault.decrypted_secrets as s
  where s.name = 'kubios_sync_cron_secret';

  if v_secret is null or v_secret = '' then
    raise exception 'vault secret kubios_sync_cron_secret is missing or empty'
      using errcode = 'P0001';
  end if;

  -- Un CR/LF interno romperia la cabecera Authorization; no se registra.
  if v_secret ~ '[[:cntrl:]]' then
    raise exception 'vault secret kubios_sync_cron_secret must not contain control characters'
      using errcode = 'P0001';
  end if;

  -- timeout_milliseconds es el plazo del CLIENTE pg_net (30 s), no el limite de
  -- duracion de la funcion Vercel: si vence, Vercel puede seguir ejecutando y el
  -- cierre del lease ocurre igualmente. La ruta usa un presupuesto interno de
  -- 26 s (21 s trabajo + 4 s cierre + 1 s respuesta) para intentar terminar
  -- antes; el margen de cold start no esta medido. Si se cambia este valor,
  -- revisar DEFAULT_KUBIOS_SYNC_BUDGET_MS en src/lib/kubios-sync.ts y
  -- maxDuration de la ruta, y documentarlo en README.md; no se debe recortar por
  -- debajo de la suma.
  select net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 30000
  )
  into v_request_id;

  return v_request_id;
end;
$function$;

-- El dueno debe poder leer vault.decrypted_secrets. En Supabase el rol con ese
-- acceso y el que ejecuta los jobs creados desde el SQL Editor es postgres.
alter function kubios_private.kubios_sync_cron_tick() owner to postgres;

comment on function kubios_private.kubios_sync_cron_tick()
  is 'K49: encola con pg_net un POST a /api/cron/kubios-sync leyendo URL y secreto de Vault; no expone valores.';

revoke all on function kubios_private.kubios_sync_cron_tick() from public;
revoke all on function kubios_private.kubios_sync_cron_tick() from anon, authenticated, authenticator;
revoke all on function kubios_private.kubios_sync_cron_tick() from service_role;

grant execute on function kubios_private.kubios_sync_cron_tick() to postgres;

-- Un unico job, inactivo, con un unico schedule. El bloque es atomico: si algo
-- falla, no queda una programacion a medias.
do $install$
declare
  v_jobids bigint[];
  v_jobid bigint;
  v_had_active_job boolean := false;
begin
  -- Se recogen los ids y si habia un job activo antes de borrar. En el caso
  -- normal hay cero o una fila.
  select coalesce(pg_catalog.array_agg(j.jobid), array[]::bigint[]),
         coalesce(pg_catalog.bool_or(j.active), false)
    into v_jobids, v_had_active_job
  from cron.job as j
  where j.jobname = 'kubios-sync-every-5-minutes';

  foreach v_jobid in array v_jobids
  loop
    perform cron.unschedule(v_jobid);
  end loop;

  v_jobid := cron.schedule(
    'kubios-sync-every-5-minutes',
    '*/5 * * * *',
    'select kubios_private.kubios_sync_cron_tick();'
  );

  -- Activo = false: la activacion es un paso humano posterior y explicito.
  perform cron.alter_job(
    job_id := v_jobid,
    active := false
  );

  if v_had_active_job then
    raise notice 'el job kubios-sync-every-5-minutes estaba activo y se recreo inactivo; el jobid cambio y el historial previo queda en el jobid anterior; reactivar manualmente con cron.alter_job(active := true)';
  end if;
end;
$install$;

-- Verificacion sin secretos: no se consulta cron.job.command con valores
-- dynamicos ni vault.decrypted_secrets. Debe devolver una sola fila.
select j.jobid,
       j.jobname,
       j.schedule,
       j.active,
       j.username,
       j.database
from cron.job as j
where j.jobname = 'kubios-sync-every-5-minutes';

# Kubios sync cron (Supabase pg_cron + pg_net + Vault)

Estado: configuracion preparada y versionada, **NO desplegada y NO activada**.
Nada de este directorio se aplica solo: vive fuera de `supabase/migrations/`
para que `supabase db push` (o cualquier CI que aplique migraciones) no cree el
job ni active el cron.

La programacion no usa Vercel Cron. El disparador es Supabase Cron
(`pg_cron`), que encola una peticion HTTP con `pg_net` hacia la ruta de la
aplicacion. La URL y el secreto Bearer se leen por nombre desde Vault en cada
ejecucion; este repositorio no contiene valores reales.

## Archivos

- `install_kubios_sync.sql`: instalacion manual e idempotente del job
  `kubios-sync-every-5-minutes` (schedule `*/5 * * * *`) y de la funcion
  `kubios_private.kubios_sync_cron_tick()`.
- `README.md`: este documento.

## Requisito de esquema

Antes de instalar el cron debe estar aplicada la migracion consolidada
`supabase/migrations/20261103100413_kubios_production_core.sql`, que crea
`kubios_private`, el lease y el cursor. El instalador falla cerrado si el
esquema privado no existe.

La migracion usa `public.users("UserID")` integer para el vinculo de usuario y
mantiene UUID para equipo/miembro de Kubios. No crea ni modifica las tablas de
salud ni los datos de usuarios.

## Que hace el job

Cada 5 minutos, pg_cron ejecuta:

```sql
select kubios_private.kubios_sync_cron_tick();
```

La funcion (`security definer`, `search_path = ''`) lee por nombre dos secretos
de `vault.decrypted_secrets` y encola con `net.http_post` una peticion HTTP a la
ruta de la aplicacion. El comando guardado en `cron.job.command` no contiene
secretos.

## Contrato con la ruta `/api/cron/kubios-sync`

- Metodo: `POST`.
- Cabecera: `Authorization: Bearer <secreto>` (el valor de
  `kubios_sync_cron_secret`).
- Cuerpo: JSON vacio `{}` con `Content-Type: application/json`. La ruta no
  exige campos adicionales.
- Respuesta esperada: 200 (ok), 202 (locked), 429 (throttled) o 503 (partial o
  error interno). `Retry-After` es condicional:
  - pausa finita: la ruta lo envia con el valor exacto persistido (incluidos
    86401 y 2147483647 s), sin recortarlo;
  - pausa indefinida (`next_allowed_at = 'infinity'`): 429 SIN `Retry-After`,
    porque no existe un plazo que prometer. Una mezcla ambigua (indefinida con
    segundos) se rechaza como 503 generico;
  - 401 aplica tambien si falta `KUBIOS_CRON_SECRET`, si la cabecera
    `Authorization` falta o esta mal formada, o si el secreto no coincide. La
    ruta no devuelve el secreto ni datos sensibles en el cuerpo.
- La ruta ignora el cuerpo; se envia `{}` por compatibilidad.
- Disparos solapados o repetidos: el lease de `kubios_private.team_sync_state`
  es la proteccion, no el cron. Un tick solapado recibe `locked` (202) y no toca
  el intento del owner vigente.
- La ruta importa dinamicamente `@/lib/kubios-sync`; el cron no asume que el
  despliegue de la aplicacion exista hasta verificarlo en el entorno real.

## Presupuesto, plazos y maxDuration

Presupuesto por pasada (`runKubiosSync`):

| Tramo | Por defecto | Que cubre |
| --- | --- | --- |
| Trabajo | 21 s | lease, token, listado de miembros y hasta 2 HRV concurrentes, snapshots |
| Cierre | 4 s | persistencia del cursor, `kubios_finish_sync` o `kubios_finish_sync_indefinite` |
| Respuesta | 1 s | sanitizado y respuesta HTTP de la ruta |
| Total | 26 s | presupuesto interno; el margen real frente a pg_net no esta medido |

- Fuente unica: `DEFAULT_KUBIOS_SYNC_BUDGET_MS = 26000` en
  `src/lib/kubios-sync.ts`. La ruta importa dinamicamente el modulo y pasa
  `budgetMs`; no exporta constantes propias, porque Next solo admite los
  exports de su contrato (`POST`, `runtime`, `maxDuration`, etc.).
- El presupuesto empieza dentro de `runKubiosSync`; la validacion Bearer y la
  carga dinamica del modulo ocurren antes. Los 4 s de margen frente a los 30 s
  de pg_net son una estimacion de diseno, no una medicion de cold start.
- Toda espera que pueda bloquear se ejecuta en una carrera contra el plazo
  restante. Se protege de un `fetch` que ignora `AbortSignal` y de una RPC que
  nunca resuelve; el fence owner/lease impide que una escritura tardia se
  aplique despues de liberar el lease o con otro owner.
- Al agotarse el trabajo se deja de programar miembros nuevos, se espera solo lo
  acotado, se cierra el lease y se devuelve `partial` con `synced` reales. Los
  miembros no sincronizados cuentan como `failed`; no se inventan `synced`.
- Si la RPC de lease no responde, no se sabe si el lease es propio: no se llama
  a `finish` y el lease (si se tomo) caduca solo.
- Si `finish` no confirma, el resultado se degrada a `partial`: nunca se
  devuelve `ok` ni `throttled` como si la pausa se hubiera persistido.

`maxDuration` y Vercel:

- La ruta exporta `maxDuration = 60`. El limite real depende del plan y de
  fluid compute; no se asume el plan del usuario ni que fluid compute este
  activo.
- Si la funcion supera `maxDuration`, Vercel devuelve 504. Ese 504 es de la
  plataforma, no lo genera la ruta: la ruta solo responde 200/202/429/503. Un
  504 no debe interpretarse como pausa persistida; el lease se cierra o caduca
  por su cuenta.
- `pg_net` puede vencer a los 30 s y cerrar su peticion HTTP mientras la
  funcion sigue ejecutandose. El diseno reserva 26 s para que el `finish` y la
  respuesta ocurran antes; el margen depende de un cold start no medido. Si se
  cambia `timeout_milliseconds`, revisar tambien
  `DEFAULT_KUBIOS_SYNC_BUDGET_MS` y `maxDuration`; no se debe dejar el
  presupuesto por encima del timeout de pg_net.

Lease y fence:

- Lease por defecto 120 s. El valor efectivo se amplia como minimo a
  `ceil(budgetMs/1000) + 15 s`, de modo que el trabajo y el cierre caben dentro
  del lease aunque se inyecte un presupuesto grande o se pida un lease corto.
- El cierre finito exige owner y `lease_expires_at > clock_timestamp()` en la
  RPC. Ademas, el cliente comprueba localmente que el lease no deberia haber
  caducado antes de llamar a `kubios_finish_sync`; si lo considera caducado, no
  lo cierra como propio y degrada a `partial`.
- `kubios_finish_sync_indefinite` exige el mismo owner pero no exige lease
  vigente. Si el mismo owner caduco y nadie lo tomo, persiste la pausa
  indefinida y libera el lease (fail-closed). Nunca actualiza el lease de otro
  owner.
- Una pausa `infinity` no se reanuda sola. La unica salida es la limpieza
  administrativa:
  `update kubios_private.team_sync_state set next_allowed_at = null where team_id = '<uuid>';`.
  No existe RPC publica para esa limpieza; hacerla con revision humana.

## Cursor durable y reparto entre ejecuciones

La migracion consolidada crea `kubios_private.team_sync_cursor` y las RPC
`kubios_get_sync_cursor` / `kubios_advance_sync_cursor`. Si la migracion no esta
aplicada y el sincronizador esta desplegado, la lectura del cursor falla cerrado
y la ruta responde `partial` (503), sin escribir snapshots ni devolver `ok`. Al
desplegar, aplicar la migracion antes que el cliente y confirmar que PostgREST
recarga su cache de esquema.

Que guarda y que garantiza:

- `next_member_id`: primer miembro no procesado del ciclo actual.
- `attempted_member_ids`: miembros ya intentados en el ciclo actual, incluidos
  los que fallaron. Evita repetirlos en cada ejecucion.
- `failed_member_ids`: subconjunto de los intentados que fallo y aun no se ha
  vuelto a sincronizar. Impide declarar exito una pasada con fallos.
- El orden de miembros es el de los UUID del equipo ordenados de forma
  ascendente y estable. No se toma de `localStorage`, del cuerpo/query de la
  peticion, de la sesion ni de ningun input no autenticado.
- Una pasada recorre como maximo una vez cada miembro vigente. Si el
  presupuesto termina antes de intentar a alguien, el cursor queda en el primer
  miembro no intentado.
- Un 429 detiene la pasada, no sobrescribe snapshots y no avanza el cursor como
  si el miembro limitado se hubiera procesado.
- Un error individual no sobrescribe el snapshot del miembro, no impide
  procesar el resto y hace que la pasada no sea `ok`; se registra como fallo.
- `ok` solo se devuelve si el ciclo cubrio a todos los miembros vigentes, no
  quedo ningun fallo pendiente y el cursor se persistio.
- Fence y lock: `kubios_advance_sync_cursor` bloquea con `FOR UPDATE` la fila de
  `team_sync_state`, comprueba bajo el lock que `lease_owner` es el mismo y que
  `lease_expires_at > clock_timestamp()`, y solo entonces mueve el cursor. Un
  owner caducado o reemplazado recibe `false`.
- ACL: solo `service_role` tiene `EXECUTE` sobre las RPC y acceso a las tablas
  privadas. `PUBLIC`, `anon`, `authenticated` y `authenticator` no tienen
  privilegios. Los helpers del cursor son `SECURITY DEFINER` dentro de
  `kubios_private` (esquema no expuesto); los wrappers publicos son
  `SECURITY INVOKER`. No hay ningun `SECURITY DEFINER` en `public`.

Lo que no garantiza:

- No garantiza que una sola ejecucion cubra el equipo: con muchos miembros
  siguen haciendo falta varias ejecuciones o ciclos.
- No elimina la pausa por 429 ni la reanudacion administrativa de `infinity`.
- No sustituye al lease: dos ticks solapados siguen resolviendose con `locked`.
- No valida la pertenencia de un miembro al equipo en la base; la lista vigente
  la entrega el proveedor.
- No esta probado contra Supabase/PostgREST real en esta tarea: la verificacion
  es local con PostgreSQL efimero y stubs.

## Prerrequisitos

1. Proyecto Supabase con extensiones `pg_cron` y `pg_net` disponibles. En
   Supabase se habilitan desde Dashboard > Database > Extensions; el script
   intenta `create extension if not exists` y, si el rol no pudiera crearlas,
   se habilitan desde el Dashboard y se reejecuta.
   - `pg_cron` >= 1.4: los jobs con nombre existen desde 1.3, pero
     `cron.alter_job` requiere 1.4.
   - La API de `pg_net` esta en beta: la firma usada aqui es
     `net.http_post(url, body, params, headers, timeout_milliseconds)`. Si
     cambia, revisar `install_kubios_sync.sql` antes de instalar.
2. Ejecutar el SQL como `postgres`. El job se crea con el rol que instala y el
   diseno asume `postgres`; no instalar como `supabase_admin` ni otro rol
   privilegiado. `cron.job` tiene RLS por `username = current_user`, y un job
   con el mismo nombre creado por otro rol podria no ser visible ni eliminable
   desde este script.
3. Migracion consolidada aplicada: esquema `kubios_private`, tablas, lease y
   cursor.
4. Ruta `/api/cron/kubios-sync` desplegada con `KUBIOS_CRON_SECRET`; no se
   asume su despliegue hasta verificarlo en el entorno real.
5. Revision humana pendiente antes de habilitar. Este documento no fija el
   estado de las tarjetas de coordinacion; solo deja constancia de que la
   habilitacion requiere aprobacion humana.

## Variables de entorno y Vault (sin valores)

Variables de la aplicacion (servidor; nunca con prefijo `NEXT_PUBLIC_`):

| Nombre | Uso | Contenido |
| --- | --- | --- |
| `KUBIOS_USERNAME` | login de Kubios Cloud | usuario de servicio |
| `KUBIOS_PASSWORD` | login de Kubios Cloud | contrasena de servicio |
| `KUBIOS_CLIENT_ID` | login de Kubios Cloud | client id |
| `KUBIOS_TEAM_ID` | opcional | override UUID del equipo objetivo |
| `KUBIOS_ENCRYPTION_KEY_V1` | cifrado de token/snapshot | clave AES-256 en base64 (32 bytes) |
| `KUBIOS_CRON_SECRET` | autenticacion Bearer del cron | valor opaco de alta entropia |

Secretos de Vault usados por el cron (se leen por nombre en cada ejecucion):

| Nombre | Contenido |
| --- | --- |
| `kubios_sync_cron_url` | URL completa `https://<dominio-de-produccion>/api/cron/kubios-sync`, sin token ni query string con secretos |
| `kubios_sync_cron_secret` | valor opaco que la ruta espera en `Authorization: Bearer`; debe coincidir con `KUBIOS_CRON_SECRET` |

Los dos valores de Vault se recortan con `btrim` (espacios, tabuladores, CR y
LF) en los extremos antes de validarlos y usarlos. Ese recorte no se registra
en logs ni se devuelve. El `btrim` no toca caracteres internos: un espacio o
control interno en la URL, o un control interno en el secreto, se rechaza
porque romperia la peticion o la cabecera `Authorization`.

Creacion (preferible desde Dashboard > Vault, que no deja el valor en el
historial SQL):

```sql
select vault.create_secret(
  '<url-https-completa>',
  'kubios_sync_cron_url',
  'URL https completa de /api/cron/kubios-sync'
);

select vault.create_secret(
  '<secreto-opaco-introducido-por-el-humano>',
  'kubios_sync_cron_secret',
  'secreto Bearer de invocacion; distinto de la clave AES de Kubios'
);
```

Advertencias:

- No crear estos secretos desde migraciones, seeds ni scripts versionados.
- El SQL Editor guarda el texto ejecutado en su historial y puede aparecer en
  logs: prefiere la UI de Vault para introducir el valor real.
- `kubios_sync_cron_secret` es el secreto de invocacion del cron. NO es la
  clave AES de Kubios (`KUBIOS_ENCRYPTION_KEY_V1`). La clave AES no debe estar
  en Supabase, ni en Vault, ni en este SQL, ni en este README.
- Trata el acceso de escritura a Vault como acceso a secretos: quien pueda
  cambiar `kubios_sync_cron_url` puede redirigir el Bearer a otro host.

Acceso de lectura (supuesto a confirmar en el proyecto real): la funcion se
ejecuta como `postgres` y lee `vault.decrypted_secrets`. Antes de activar hay
que confirmar que `postgres` tiene SELECT sobre esa vista. Si no lo tuviera, el
tick fallara con `permission denied` y habra que ajustar el owner de la funcion
o los grants con revision humana, sin conceder acceso a `anon`, `authenticated`
ni `service_role`.

## Instalacion manual

1. Confirmar que la migracion consolidada esta aplicada y que existe revision
   humana para habilitar.
2. Crear los dos secretos de Vault (seccion anterior).
3. Ejecutar `install_kubios_sync.sql` como `postgres`, bien pegando el contenido
   en el SQL Editor, bien con una conexion directa. No instalar como
   `supabase_admin` ni otro rol privilegiado:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/cron/install_kubios_sync.sql
   ```

   No usar `supabase db push` ni mover el archivo a `supabase/migrations/`.
4. El script termina mostrando el job. Debe haber UNA fila con schedule
   `*/5 * * * *` y `active = false`. Reejecutarlo no debe duplicar la fila.

**No reejecutes el instalador tras activar el job.** El instalador recrea
siempre el job inactivo: si estaba activo emite un `NOTICE`, pero queda pausado.
Ademas cambia el `jobid`, y el historial anterior de `cron.job_run_details`
sigue asociado al `jobid` viejo. Si reinstalas, reactiva manualmente.

## Verificacion

Job (una sola fila; no consulta secretos):

```sql
select jobid, jobname, schedule, active, username, database
from cron.job
where jobname = 'kubios-sync-every-5-minutes';
```

Nombres de secretos existentes, sin descifrar valores:

```sql
select name, description, created_at, updated_at
from vault.secrets
where name in ('kubios_sync_cron_url', 'kubios_sync_cron_secret');
```

Historial de ejecuciones (el mensaje de error nombra el secreto ausente, nunca
su valor):

```sql
select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid from cron.job where jobname = 'kubios-sync-every-5-minutes'
)
order by start_time desc
limit 10;
```

Estado de las peticiones de pg_net, sin cabeceras ni contenido:

```sql
select id, status_code, timed_out, error_msg, created
from net._http_response
order by created desc
limit 10;
```

No ejecutes `select * from net.http_request_queue` ni
`select headers, body from net.http_request_queue` en una consola compartida:
mientras la peticion espera, `headers` contiene el `Authorization: Bearer`.
Tampoco selecciones `decrypted_secret` de Vault en consolas compartidas.

## Activacion

Solo tras la revision humana y con la ruta desplegada:

```sql
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'kubios-sync-every-5-minutes'),
  active := true
);
```

Comprobar con la consulta de `cron.job` que `active = true`. El primer disparo
ocurre en el siguiente multiplo de 5 minutos. Si el secreto falta, la URL no es
HTTPS o contiene espacios/controles internos, la funcion falla y el error queda
en `cron.job_run_details` sin revelar el valor.

**No reejecutes `install_kubios_sync.sql` despues de activar:** volveria a crear
el job inactivo, cambiaria el `jobid` y dejaria el historial previo asociado al
`jobid` anterior.

## Pausa, reanudacion y eliminacion

Pausar (conserva el job y su historial):

```sql
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'kubios-sync-every-5-minutes'),
  active := false
);
```

Reanudar: la misma llamada con `active := true`.

Eliminar el job:

```sql
select cron.unschedule('kubios-sync-every-5-minutes');
```

Alternativa por id, valida en cualquier version:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'kubios-sync-every-5-minutes';
```

`cron.unschedule` borra el job pero conserva `cron.job_run_details` (no se limpia
solo). Con este schedule se acumulan unas 288 filas al dia; si se quiere limitar
su crecimiento, programar una limpieza aparte.

## Rotacion del secreto

La funcion lee el secreto en cada ejecucion, asi que no hay que reprogramar ni
recrear el job. Recomendacion:

1. Generar un valor nuevo opaco con el gestor de secretos del proyecto.
2. Actualizar `KUBIOS_CRON_SECRET` en la aplicacion y redesplegar. Idealmente la
   ruta deberia aceptar el valor vigente y el anterior durante la ventana de
   rotacion; si solo acepta uno, se admite como maximo un tick fallido (5 min).
3. Actualizar el secreto en Vault. Preferible la UI de Vault. Si se hace por SQL:

   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'kubios_sync_cron_secret'),
     '<secreto-nuevo-introducido-por-el-humano>'
   );
   ```

   Ese SQL deja el valor nuevo en el historial del editor: evitalo en consolas
   compartidas.
4. Comprobar el siguiente tick en `cron.job_run_details` y el estado HTTP de la
   ruta. Un 401 indica desalineacion entre la aplicacion y Vault.

Si se sospecha que el valor quedo expuesto (por ejemplo, en
`net.http_request_queue`), rotar de inmediato: el secreto viejo deja de servir
en cuanto la aplicacion y Vault usan el nuevo.

## Desinstalacion

1. Pausar o eliminar el job (seccion anterior).
2. Eliminar la funcion:

   ```sql
   drop function if exists kubios_private.kubios_sync_cron_tick();
   ```

3. Opcional e irreversible: eliminar los secretos de Vault.

   ```sql
   delete from vault.secrets
   where name in ('kubios_sync_cron_url', 'kubios_sync_cron_secret');
   ```

No desinstalar las extensiones `pg_cron`/`pg_net`: pueden usarlas otras
caracteristicas del proyecto. No borrar `cron.job_run_details` si se necesita
auditoria.

## Riesgo residual: pg_net y la cola de peticiones

`net.http_request_queue` es una tabla UNLOGGED donde pg_net guarda la peticion
pendiente, incluidas sus cabeceras. Entre el encolado y el envio, la fila
contiene `Authorization: Bearer <secreto>`. Las respuestas se guardan por
defecto 6 horas en `net._http_response` (tambien UNLOGGED).

Controles aplicables:

- `net` no debe figurar en los esquemas expuestos de la Data API. No conceder
  `net` a `anon` ni a `authenticated`.
- El script de pg_net concede privilegios amplios a PUBLIC en sus tablas. No
  revoques a ciegas: otras funciones (por ejemplo webhooks) pueden depender de
  esos grants. Si se endurece, probar antes el resto de consumidores de pg_net.
- Limitar quien puede conectarse como `postgres`/`supabase_admin`: quien lee la
  cola o `vault.decrypted_secrets` ve material sensible.
- Mantener el timeout acotado (30 s en la funcion), rotar el secreto si se
  sospecha exposicion y no registrar cabeceras ni valores con `raise log`.
- El secreto de invocacion es DISTINTO de la clave AES de Kubios. La clave AES
  se queda en el entorno del servidor; nunca en Supabase ni en este directorio.

No es posible evitar que la cabecera exista temporalmente en la cola: es el
mecanismo de pg_net. Se mitiga con privilegios minimos, ventana corta, rotacion y
no exponiendo `net`.

## Verificacion local

La prueba estatica y dinamica vive en
`tests/kubios-cron-sql.k43.test.mjs`. Usa un PostgreSQL 16 efimero en Docker con
`--network none`, `--pull never`, stubs de `cron`, `net` y `vault`, una URL
ficticia `https://cron.invalid/...` y un secreto sintetico sin valor real. No
contacta con Supabase, Vercel ni Kubios, no lee `.env` ni credenciales reales.

Cubre: job unico e inactivo, schedule, timeout de pg_net, cabecera Bearer y
cuerpo, ausencia de secretos en `pg_proc.prosrc` y `cron.job.command`, permisos
de ejecucion y fallo cerrado si faltan los secretos o la URL no es HTTPS.

Los stubs no reproducen el worker real de pg_cron, el worker de pg_net, el
descifrado de Vault, las RLS/grants reales de Supabase, la Data API ni el envio
HTTP real. Tampoco se probo Vercel ni el modulo de sincronizacion desplegado.
La verificacion en Supabase queda pendiente de la revision humana y de la
activacion controlada.

## Lo que este cambio NO hace

- No activa el cron: el job se crea con `active = false`.
- No crea secretos en Vault.
- No modifica Supabase remoto, Vercel, `.env` ni configuracion desplegada.
- No aplica migraciones ni cambia el esquema existente.
- No usa Vercel Cron ni cambia los esquemas expuestos de la Data API.
- No verifica el plan de Vercel, fluid compute, el worker real de pg_net ni el
  reloj/carga de produccion.

## Referencias

- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase Cron, programar y gestionar jobs: https://supabase.com/docs/guides/cron/quickstart
- pg_net: https://supabase.com/docs/guides/database/extensions/pg_net
- Vault: https://supabase.com/docs/guides/database/vault
- pg_cron: https://github.com/citusdata/pg_cron

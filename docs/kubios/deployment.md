# Publicación de Kubios

Estado de preparación: desarrollo local sobre `codex/kubios-integration`,
basado en la release `codex/release/0.2.0` (`fbb3adc`). Las tarjetas de
desarrollo terminan en revisión; el humano decide su paso a Finalizado.
El 2026-11-03 el humano autorizó expresamente el push para probar el despliegue,
manteniendo las tarjetas en revisión hasta su aceptación. La configuración de
variables que el humano ha elegido hacer tras
el push y la activación remota conservan sus tarjetas abiertas hasta comprobar
esas acciones; no se consideran realizadas al cerrar el desarrollo local.

## Variables privadas de Vercel

Conservar la configuración existente del dashboard, especialmente Supabase,
sesiones y cifrado de los datos de diabetes. Añadir estas variables al entorno
Production del proyecto `h2-train/dashboard`:

| Variable | Uso |
|---|---|
| `KUBIOS_USERNAME` | Cuenta de equipo existente |
| `KUBIOS_PASSWORD` | Contraseña existente, sin recortar espacios |
| `KUBIOS_CLIENT_ID` | Cliente Cognito usado por esa cuenta |
| `KUBIOS_ENCRYPTION_KEY_V1` | Clave nueva de 32 bytes en base64 para AES-256-GCM |
| `KUBIOS_CRON_SECRET` | Secreto independiente para invocar la ruta de sincronización |

`KUBIOS_TEAM_ID` es opcional: sin él se exige una coincidencia única del equipo
`Diabetes Tracker - H2TRAIN` en el perfil autorizado. No se elige el primer
equipo de la respuesta. No usar prefijos `NEXT_PUBLIC_` para estos valores.

La clave de cifrado Kubios es diferente de `ENCRYPTION_SECRET_KEY`. Mantenerla
estable y guardar una copia recuperable fuera de la base de datos: perderla
impide recuperar los snapshots y tokens ya cifrados. Kubios entrega JSON
legible sobre TLS; el servidor aplica este cifrado antes de persistirlo.

El coordinador preparó los valores en un archivo privado fuera del repositorio.
No incluir ese archivo en Git, tarjetas, adjuntos o logs. No regenerar la clave
en cada despliegue. El servidor requiere además `SUPABASE_URL` y una
`SUPABASE_SERVICE_ROLE_KEY` válida; ya se comprobó la clave existente mediante
lectura de la API, sin extraer datos clínicos.

## Vínculo entre las dos cuentas

La integración anterior de producción recibía un identificador de miembro
desde el selector del grupo; no vinculaba esa selección con el usuario de la
sesión. El 2026-11-03 se aplicó el esquema privado y se verificó el primer
vínculo explícito y su snapshot cifrado. Esto no publica la nueva versión web.

La nueva tabla `kubios_private.user_member_links` relaciona el `UserID` entero
del dashboard con `team_id` y `kubios_member_id` (el `team_user_id` de Kubios).
El servidor resuelve ese vínculo desde la sesión, sin aceptar una identidad
elegida por el navegador. La relación es administrativa y revocable.

El email de Kubios sirve para localizar al miembro autorizado, no para suponer
que `public.users.Username` tiene el mismo valor. La columna `users.UUID`
existente no se utiliza como vínculo Kubios por el código actual y se conserva
sin reinterpretarla. Tampoco se presupone que coincida con un UUID de Auth.

## Orden de publicación y activación

1. Revisar código y evidencia de las tarjetas. Identificar el usuario exacto
   del dashboard que corresponde al miembro Kubios. El correo de Kubios por
   sí solo no autoriza crear una cuenta ni asignar un vínculo.
2. Antes de modificar producción, obtener una copia recuperable de la base
   actual y conservar sus claves externas por separado. No se ha ejecutado
   una copia ni una restauración remota como parte del desarrollo local.
3. Revisar y aplicar **solo**
   `supabase/migrations/20261103100413_kubios_production_core.sql` por el
   procedimiento de migraciones del proyecto. Si se usa el SQL Editor,
   ejecutar su contenido dentro de una transacción y comprobar el resultado.
   No ejecutar a ciegas todas las migraciones históricas si su historial no
   está reconciliado. Esta migración añade el esquema privado y las RPC;
   conserva las restricciones existentes de las tablas de salud.
   En el proyecto ya verificado esta migración está aplicada: no repetirla.
   Reconciliar el historial de migraciones antes de cualquier `db push`.
   La inspección posterior confirmó que no existe
   `supabase_migrations.schema_migrations` en ese proyecto; la aplicación
   puntual se verificó mediante sus objetos y permisos, sin crear un historial
   artificial ni ejecutar las migraciones antiguas.
4. Confirmar la recarga de esquema de PostgREST y los privilegios. El esquema
   `kubios_private` no debe exponerse en la Data API. Solo `service_role`
   ejecuta las RPC públicas Kubios; `anon` y `authenticated` no acceden a los
   snapshots ni a los vínculos. El cliente del servidor usa `public`
   explícitamente, pues el perfil predeterminado de la API es `api`.
5. Una vez aprobadas las tarjetas, publicar el código en la rama que Vercel
   tiene conectada: `codex/release/0.2.0`, repositorio
   `H2TRAIN-Organization/dashboard`. Verificar el remoto y actualizar la rama
   sin force-push ni sobrescribir cambios concurrentes. El push dispara el
   despliegue automático.
6. El humano añadirá las variables anteriores en Vercel después del push.
   Si el despliegue ya se había creado, hacer un nuevo despliegue para que
   reciba esas variables. Hasta entonces las rutas fallan de forma cerrada;
   un build correcto no prueba que el runtime esté configurado.
7. Verificar en Vercel el commit publicado, el estado Ready y la URL de
   producción. Comprobar acceso no autenticado 401 a las rutas personales y
   al cron sin su secreto. Con sesión válida y sin vínculo, `/api/kubios/me`
   debe responder `unlinked`, sin consultar Kubios.
8. Asignar el vínculo explícito con el CLI administrativo, usando el `UserID`
   entero confirmado del dashboard y los UUID de equipo/miembro verificados:

   ```powershell
   node scripts/kubios-link.mjs set --user-id <UserID> --team-id <UUID-equipo> --member-id <UUID-miembro>
   ```

   Las variables Supabase deben estar en el entorno privado del proceso; el
   CLI no carga `.env` automáticamente. No usar un UUID de Supabase Auth ni
   inferir el vínculo por email. `show` y `revoke` permiten verificar/revocar.
9. Invocar una sincronización controlada con POST a
   `/api/cron/kubios-sync`, sin registrar la cabecera secreta. Verificar
   persistencia cifrada y lectura propia con una sesión real. Un resultado
   `partial` conserva los snapshots válidos: revisar contadores y errores
   sanitizados antes de declarar aceptada la sincronización.
10. Seguir `supabase/cron/README.md` para guardar en Vault
    `kubios_sync_cron_url` y `kubios_sync_cron_secret`. El segundo debe coincidir
    con `KUBIOS_CRON_SECRET`; la clave AES **no** va en Vault ni en Supabase.
    Ejecutar `supabase/cron/install_kubios_sync.sql`: crea el job inactivo.
    Tras verificar la ruta, activarlo y comprobar un tick real. El intervalo
    es de cinco minutos con Supabase Cron; no depende de Vercel Cron.

## Aceptación en producción

- El usuario vinculado ve únicamente sus mediciones reales, sus fechas y la
  fecha del snapshot. Una segunda cuenta no obtiene esas mediciones; cambiar
  parámetros por `user_id`, equipo o miembro nunca debe cambiar la identidad.
  Las rutas de resultados y exportación rechazan esos parámetros; `/me`
  ignora la query y resuelve siempre la sesión propia.
- El usuario sin medidas no ve la entrada Kubios ni el resumen principal.
- Recargar las páginas produce lecturas Supabase, sin autenticaciones ni
  peticiones a Kubios. Las llamadas al proveedor corresponden al sincronizador.
- Verificar al menos dos ticks y el estado HTTP de la petición de `pg_net`.
  Que el job SQL se haya encolado no prueba que el HTTP haya tenido éxito.
- Probar cierre/cambio de sesión, CSV personal y estado stale. No publicar
  capturas con mediciones o identificadores reales como evidencia compartida.

## Recuperación

Pausar primero el job con `cron.alter_job(..., active := false)` siguiendo la
guía de cron. Volver al despliegue anterior es compatible con dejar las tablas
privadas añadidas; no borrarlas ni revertir las migraciones de privacidad.
Conservar la clave AES para cualquier restauración. Si falla la activación,
mantener el cron pausado y registrar el fallo sanitizado en su tarjeta. La
vuelta de código no revierte un vínculo administrativo ni los datos persistidos.

## Desarrollo local

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run test:kubios
powershell -NoProfile -ExecutionPolicy Bypass -File tests/kubios-db/run-kubios-db-tests.ps1
npm.cmd run build
```

Para las pruebas de navegador se necesita un servidor local y
`PLAYWRIGHT_BASE_URL=http://localhost:3000`; los escenarios Kubios interceptan
las APIs con datos sintéticos. Las pruebas SQL usan PostgreSQL aislado en
Docker y no aplican migraciones a Supabase. Consultar `verification.md` para
los resultados observados y los límites de la validación.

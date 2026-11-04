# Alta de personas y vínculo con Kubios

**Estado de esta revisión:** 2026-11-03. Ámbito: dashboard de producción y rama
`codex/kubios-integration`. La integración Kubios está en desarrollo local; no
se considera desplegada. Esta guía describe el flujo que implementa el código y
lo que debe verificarse, no autoriza cambios en producción.

## 1. Piezas y flujo

```text
Admin crea cuenta en /users
  -> public.users (UserID, Username, PasswordHash bcrypt, role)
  -> la persona entra por /login con Username + contraseña
  -> sesión HttpOnly compartida por SessionContext

Persona queda en el equipo Kubios con resultados compartidos
  -> el sincronizador del servidor recorre el equipo y guarda snapshots cifrados
  -> un operador vincula UserID <-> team_id + team_user_id con el CLI
  -> la persona ve sus métricas en /kubios cuando su propio snapshot está listo
```

El alta del dashboard y el vínculo Kubios son dos operaciones distintas. Crear
la cuenta no crea ni modifica nada en Kubios; añadir a alguien al equipo Kubios
tampoco crea su cuenta del dashboard.

## 2. Identificadores que no deben confundirse

| Identificador | Dónde vive | Para qué sirve |
|---|---|---|
| `UserID` | `public.users`, entero | Identidad estable de la cuenta del dashboard. Es el valor que usa el vínculo Kubios y el CLI. |
| `Username` | `public.users` | Nombre con el que se inicia sesión en `/login`. Puede tener forma de correo y conserva su credencial antigua. `/app-login` redirige al formulario común. |
| `PasswordHash` | `public.users` | Hash bcrypt generado en el servidor. No se muestra ni se devuelve a la interfaz. |
| `UUID` | `public.users` | Columna heredada. El código Kubios actual no la usa como vínculo; no la interpretes como identidad de Auth ni como `team_user_id`. |
| `team_id` | Kubios | UUID del equipo. Debe ser el equipo autorizado `Diabetes Tracker - H2TRAIN` (o el fijado explícitamente en `KUBIOS_TEAM_ID`). |
| `team_user_id` | Kubios | UUID del miembro dentro del equipo. Se guarda como `kubios_member_id` y se pasa al CLI como `--member-id`. |
| UUID de Supabase Auth | Supabase Auth | Identidad del login por email. No se usa para el vínculo Kubios ni se crea desde `/users`. |

El vínculo es **UserID -> equipo/miembro**, no Username -> miembro. Un cambio
controlado de `Username` conserva ese vínculo. Borrar y volver a crear la
cuenta cambia el `UserID`; la nueva cuenta necesita un vínculo nuevo.

La inspección remota del 2026-11-03 confirmó una protección adicional que el
código de la release no contempla: `h2train_identity_immutable` impide cambiar
`Username`, y los registros de salud referencian
`private.legacy_owner_aliases`. La función `t009_update_user` del dashboard
rechaza ese esquema porque espera las relaciones antiguas. Por tanto, el
renombrado desde `/users` no debe presentarse como operativo: requiere una
migración puntual revisada que conserve propietario, alias y datos. Para altas
nuevas, elegir el nombre definitivo desde el principio. No sustituir las
restricciones actuales por las migraciones T009 antiguas.

Las cinco tablas de salud también protegen el propietario mediante
`h2train_version`; su índice privado `record_keys` conserva los identificadores
de los registros. La migración puntual de una cuenta confirmada se ejecutó
con aprobación específica, copia cifrada y bloqueo transaccional: cambió solo
las etiquetas del mismo propietario, preservó los valores cifrados, versiones
e identificadores y restauró las seis guardas. No es un procedimiento de alta
habitual ni autoriza a desactivar esas protecciones en futuras operaciones.

## 3. Modos de acceso reales

| Ruta | Método | Credencial | Cuándo se usa |
|---|---|---|---|
| `/login` | `username` | `Username` + contraseña contra `public.users`, verificada con bcrypt en el servidor | Cuentas creadas desde `/users`; admite también nombres con forma de correo. |
| `/login` | `email` | Email + contraseña contra Supabase Auth | Identidad confirmada y vínculo administrado válido, o coincidencia única del correo confirmado con `users.Username`. El rol procede de `users`. |
| `/app-login` | — | Redirección a `/login` | Compatibilidad con enlaces antiguos. |

Ambos modos terminan en la misma cookie HttpOnly `dashboard_session` y en
`SessionContext`; el método (`username` o `email`) decide qué contexto de la UI
expone la sesión. `public.users` no tiene columna `Email`: un correo usado como
`Username` es solo el texto de esa columna. El registro público no está
disponible.

El formulario común tiene un único campo de correo o nombre de participante.
Si el nombre contiene `@`, el servidor resuelve las credenciales de email y
legacy, conserva el método realmente autenticado y deniega identidades
ambiguas. La UI no reintenta otro método tras una denegación. Un vínculo
administrado roto no se sustituye silenciosamente por otro usuario.
`user_metadata` y `localStorage` nunca conceden permisos. El inicio común es
`/`; `/app-dashboard` redirige a él.

En el alta desde `/users` no hay:

- creación de una identidad en Supabase Auth;
- confirmación o activación de la cuenta por correo;
- recuperación de contraseña desde la UI o la API;
- envío de credenciales por parte de `/users`.

La cuenta creada puede iniciar sesión con su contraseña en cuanto existe. La
contraseña se entrega por el canal seguro que use la organización; la interfaz
no vuelve a mostrarla.

## 4. Alta en el dashboard

Requiere una sesión con rol `admin`. El rol `doctor` puede consultar el listado,
pero no crear ni modificar usuarios. Para una persona que solo verá sus propios
datos, el rol adecuado es `user`; `doctor` y `admin` amplían permisos y no deben
asignarse por rutina.

1. Entra como administrador y abre `/users`.
2. Pulsa **Crear usuario**.
3. Introduce un `Username` único y definitivo, una contraseña y el rol `user`
   (valor propuesto por defecto). Conviene usar el correo de la persona como
   nombre de usuario para facilitar su identificación. El formulario no pide
   un campo email separado y ese valor no crea una identidad Supabase Auth.
4. Confirma la creación y localiza la fila nueva. Anota el `UserID` y el
   `Username` exactos: los necesitarás para el vínculo Kubios y para indicar el
   acceso.
5. Entrega la contraseña por un canal seguro. No la publiques en la tarjeta,
   el repositorio, capturas o mensajes compartidos.

Qué ocurre en el servidor: `POST /api/users` exige sesión de administrador,
valida los campos, genera el hash bcrypt (coste 12) y hace el `insert` en
`public.users`. La aplicación no envía `UserID`; lo asigna la base de datos y la
respuesta devuelve el usuario público sin hash. La creación no crea una
identidad en Supabase Auth ni envía un correo de confirmación.

El formulario exige una contraseña de al menos 6 caracteres; no hay una política
de complejidad adicional visible en esta pantalla.

### Consentimiento GDPR

El alta desde `/users` no envía consentimiento; el servidor guarda
`GDPRConsent` en `false` por defecto y no registra consentimiento por el mero
alta administrativa. No marques la casilla de consentimiento solo porque la
cuenta se haya creado: hazlo únicamente cuando el procedimiento vigente confirme
que la persona ha consentido. La casilla de edición es un registro
administrativo, no sustituye la obtención del consentimiento.

## 5. Kubios: requisito, vínculo y verificación

### 5.1 Preparación en Kubios

En Kubios, la persona debe estar incluida en el equipo
`Diabetes Tracker - H2TRAIN` y sus resultados deben estar compartidos con ese
equipo; si no lo están, el sincronizador no los verá. Esa configuración se
comprueba en Kubios, no en el dashboard. El servidor usa la cuenta de servicio
del equipo; no necesitas las credenciales de Kubios de la persona ni entrar en
su cuenta. El vínculo no concede acceso a los datos de otros miembros: cada
sesión resuelve solo su propio `member_id`.

El sincronizador recorre los miembros del equipo y guarda un snapshot cifrado
por miembro. Puede existir caché de alguien todavía no vinculado, pero ninguna
cuenta del dashboard puede verla hasta que se asigne el vínculo de su `UserID`.
Si `KUBIOS_TEAM_ID` no está fijado, el servidor resuelve el equipo por el nombre
`Diabetes Tracker - H2TRAIN` (normalizando espacios y mayúsculas) y falla
cerrado si falta o es ambiguo; no elige el primer equipo.

Para el alta necesitas dos UUID que entrega Kubios:

- `team_id`: el del equipo autorizado;
- `team_user_id`: el del miembro concreto (el `--member-id` del CLI).

No los deduzcas del correo, del `Username`, del `UUID` de `public.users` ni de
una identidad de Supabase Auth. Que un correo coincida no confirma la identidad
ni autoriza por sí solo a crear la cuenta o asignar el vínculo. Si no puedes
confirmar ambos identificadores, detén el vínculo y pide la confirmación
correspondiente.

### 5.2 Asignar el vínculo

No existe un botón de vincular o desvincular en la UI actual, ni una ruta HTTP
de vínculo para el navegador. El vínculo es una operación administrativa con
credenciales de servidor mediante `scripts/kubios-link.mjs`. El
root/operador autorizado confirma la identidad y ejecuta el comando; no se
delega a la persona. El operador debe tener `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` en el entorno privado del proceso; el CLI no carga
`.env` automáticamente y no se le pasan secretos como argumentos. También exige
HTTPS (HTTP solo en local) y una clave con rol `service_role`.

```powershell
# Consultar el vínculo actual
node scripts/kubios-link.mjs show --user-id <UserID>

# Crear o reasignar el vínculo
node scripts/kubios-link.mjs set --user-id <UserID> --team-id <team_id> --member-id <team_user_id>

# Revocar el vínculo
node scripts/kubios-link.mjs revoke --user-id <UserID>
```

Antes de ejecutar `set`, confirma que `<UserID>` y `<team_user_id>` corresponden
a la misma persona. No vincules por aproximación de nombre o correo. El CLI
valida que el `UserID` sea un entero positivo y que los otros dos valores sean
UUID; no infiere identidades.

El vínculo es uno a uno: un `UserID` tiene como máximo un miembro y un miembro
no puede pertenecer a dos `UserID`. `show` debe devolver el vínculo esperado
después de `set`. `revoke` elimina el vínculo; no borra la cuenta ni el snapshot
cifrado ya guardado. La purga de la caché no forma parte de este comando.

Renombrar `Username` no afecta al vínculo porque la clave es `UserID`. Si la
cuenta llega a eliminarse, el vínculo se elimina en cascada; si se vuelve a
crear, se obtiene un `UserID` nuevo y hay que volver a vincular.

### 5.3 Estados y visibilidad

La lectura propia distingue estos estados:

| Estado | Significado | ¿Enlace y tarjeta Kubios? |
|---|---|---|
| `unlinked` | No hay vínculo para el `UserID`. No se consulta Kubios. | No |
| `pending` | Hay vínculo, pero todavía no hay snapshot. | No |
| `empty` | Hay snapshot, pero con cero resultados. | No |
| `ready` | Snapshot con resultados y actualizado hace 10 minutos o menos. | Sí, si hay al menos una medición |
| `stale` | Snapshot con resultados, pero más antiguo de 10 minutos. | Sí, con aviso de datos desactualizados |

La navegación y la tarjeta de resumen solo aparecen con `ready` o `stale` y
`measurement_count > 0`. Un estado `pending`, `empty`, `unlinked` o un error no
anuncian la sección. La ruta `/kubios` existe aparte; que el enlace esté oculto
no significa que la ruta no exista, sino que la UI no presenta mediciones
propias como disponibles.

`ready` y `stale` describen la caché, no una consulta en vivo: recargar la
página lee Supabase y no autentica contra Kubios. La actualización la realiza el
sincronizador.

### 5.4 Sincronización

El diseño usa Supabase Cron cada 5 minutos (`*/5 * * * *`) para llamar a
`/api/cron/kubios-sync`; el sincronizador recorre los miembros del equipo y
guarda los snapshots cifrados. El cron y el esquema están preparados en el
repositorio, pero **no están desplegados ni activados** en esta revisión. Hasta
completar la publicación y la activación, no prometas una actualización cada 5
minutos ni des por hecho que existe caché nueva.

La guía de publicación y activación, las variables privadas y el orden de
aplicación de la migración están en `docs/kubios/deployment.md`. La evidencia de
lo comprobado hasta el 2026-11-03 está en `docs/kubios/verification.md`.

Estado de las piezas en esta revisión:

| Pieza | Estado |
|---|---|
| Código | Rama `codex/kubios-integration`; no desplegada en producción. |
| Esquema | Migración Kubios aplicada y verificada en Supabase el 2026-11-03; las reglas privadas de propiedad anteriores se conservan. |
| Cron | Job de 5 minutos preparado en `supabase/cron/`; no instalado ni activado. |
| Variables | Enumeradas en `deployment.md`; esta revisión no lee ni confirma valores. |
| Caché | Una cuenta confirmada quedó vinculada por UserID y se persistieron dos mediciones reales cifradas; lectura de servidor verificada. Todavía no es una comprobación del dashboard desplegado. |

## 6. Checklist operativo

- [ ] Crear la cuenta en `/users` con `Username`, contraseña y rol `user`.
- [ ] Anotar `UserID` y `Username`; entregar la contraseña por un canal seguro.
- [ ] No marcar GDPR como consentido por el alta; registrarlo solo si el
      procedimiento vigente lo confirma.
- [ ] Confirmar que la persona está en el equipo Kubios correcto y que sus
      resultados están compartidos con el equipo.
- [ ] Obtener `team_id` y `team_user_id` verificados; no inferirlos.
- [ ] Ejecutar `kubios-link.mjs set` como operador autorizado.
- [ ] Confirmar con `kubios-link.mjs show` que el vínculo es el esperado.
- [ ] Esperar la sincronización o el procedimiento controlado autorizado.
- [ ] Verificar con la cuenta de la persona que solo ve sus métricas y que el
      enlace aparece únicamente con `ready`/`stale` y mediciones.
- [ ] Al retirar el acceso, ejecutar `revoke`; no borrar y recrear la cuenta sin
      volver a vincular.
- [ ] No adjuntar IDs reales, contraseñas, tokens ni capturas con datos en la
      tarjeta o en evidencia compartida.

## 7. Límites y notas observadas

- La integración web no está publicada. El esquema y un vínculo real ya están
  verificados; siguen pendientes la configuración de Vercel, el despliegue,
  la prueba con una sesión real y la activación controlada del cron.
- El rol `admin` no amplía el acceso a las métricas Kubios de otras personas:
  cada sesión resuelve únicamente su propio `UserID` y su propio vínculo.
- La página `/users` usa un guard que, sin sesión, redirige a `/login`. Las
  cuentas creadas aquí no crean identidad de Supabase Auth; su acceso es por
  el mismo `/login` mediante su nombre de participante y contraseña. El
  acceso de lectura y las acciones de escritura dependen del rol real de la
  sesión y de la autorización del servidor.
- No hay recuperación de contraseña en la UI/API ni activación por correo para
  las cuentas creadas desde `/users`. No prometas esos pasos ni los sustituyas
  por un alta nueva.
- Esta guía no contiene correos, IDs, contraseñas ni tokens reales. Los valores
  se sustituyen por placeholders y se gestionan en el entorno autorizado.

## 8. Fuentes de código

- `src/app/users/page.tsx` — formulario de alta y edición, rol y consentimiento.
- `src/app/api/users/route.ts`, `src/server/http/handlers/users.ts` y
  `src/server/application/users/user-use-cases.ts` — autorización y creación.
- `src/server/http/schemas/users.ts` — campos admitidos y valores por defecto.
- `src/lib/permissions.ts` y `src/server/domain/access-policy.ts` — permisos de
  UI y autorización del servidor.
- `src/server/infrastructure/persistence/user/supabase-user-repository.ts` y
  `src/server/infrastructure/persistence/user/password-hasher.ts` — inserción,
  `UserID` y bcrypt en servidor.
- `src/contexts/SessionContext.tsx`, `AppAuthContext.tsx` y `AuthContext.tsx` —
  sesión única y modos `username`/`email`.
- `src/app/login/page.tsx` y `src/app/app-login/page.tsx` — formulario común y
  redirección de compatibilidad.
- `src/server/infrastructure/auth/README.md` — contrato de email, metadatos y
  bcrypt.
- `scripts/kubios-link.mjs` — `show`, `set` y `revoke`.
- `supabase/migrations/20261103100413_kubios_production_core.sql` — tabla de
  vínculo, FK a `UserID` y RPC.
- `src/lib/kubios-authz.ts`, `kubios-personal.ts` y
  `kubios-snapshot-reader.ts` — resolución de identidad, estados y visibilidad.
- `src/components/Navigation.tsx` y
  `src/components/kubios/KubiosSummaryCard.tsx` — cuándo se muestra Kubios.
- `supabase/cron/README.md`, `docs/kubios/deployment.md` y
  `docs/kubios/verification.md` — despliegue, cron y evidencia.

# T-008/T-020 — Autenticación y sesiones (módulo aislado)

Módulo server-side listo para que el integrador lo monte. No modifica
`domain`, `application`, `http`, `composition`, rutas, `package.json` ni
configuración raíz.

Prerrequisito de integración: foundation con `Session.method`/`PublicSession` y
cookie `dashboard_session` (está en el working tree actual de foundation; el
commit `bd1c138` todavía tiene la versión bearer sin `method`).

## Dependencia que debe instalar el integrador

- `bcryptjs@^3` (recomendado; incluye tipos y API `compare`/`hash`), o
  `bcrypt@^6` + `@types/bcrypt` en devDependencies.
- Se inyecta como `options.bcrypt`; este módulo no la importa ni la instala.
- Tests propios en `tests/auth/**`; el integrador debe añadir ese patrón al
  `include` de `vitest.config.mts` (no se modificó configuración raíz).

## Variables de entorno

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `SUPABASE_URL` | sí | URL del proyecto |
| `SUPABASE_PUBLISHABLE_KEY` | sí | `signInWithPassword` y `getUser` |
| `SUPABASE_SERVICE_ROLE_KEY` | sí | `public.users`, sesiones y rate limit |
| `AUTH_SESSION_SECRET` | prod | 32+ bytes (hex/base64url/texto); en dev se genera efímero |
| `AUTH_SESSION_TTL_SECONDS` | no | 28800 por defecto |
| `AUTH_LOGIN_WINDOW_SECONDS` | no | 900 |
| `AUTH_LOGIN_MAX_ATTEMPTS` | no | 10 |
| `AUTH_LOGIN_BLOCK_SECONDS` | no | 900 |

`SUPABASE_SECRET_KEY` solo se acepta si su JWT declara `role=service_role`.
La inspección readonly del `.env.local` original mostró que el valor actual de
`SUPABASE_SECRET_KEY` es `anon`; `SUPABASE_SERVICE_ROLE_KEY` sí es
`service_role`. No se copiaron valores.

## API de fábrica

```ts
import bcrypt from "bcryptjs";
import { createAuthRuntime } from "@/server/runtime/auth-runtime";

const auth = createAuthRuntime({ bcrypt });
// auth.gateway  -> AuthGateway del foundation
// auth.cookies  -> política HttpOnly/Secure/SameSite=Lax
// auth.http     -> helpers de respuesta (cookie + DTO sin token)
// auth.sessionDto(session) -> { user, method, expiresAt }
```

`createAuthRuntime` usa Node (`node:crypto`) y el cliente oficial
`@supabase/supabase-js` ya presente en el proyecto.

## Contrato HTTP que debe montar el integrador

- `POST /api/auth/login`: validar `{email,password}` o `{username,password}`,
  llamar `auth.gateway.authenticateBy*`, responder con `auth.http.sessionResponse`.
- `GET /api/auth/session`: leer `auth.http.readToken(request.headers.get("cookie"))`,
  llamar `auth.gateway.getSession(token)`, responder `auth.http.sessionResponse`.
- `POST /api/auth/logout`: leer cookie, `auth.gateway.revokeSession(token)`,
  responder `auth.http.logoutResponse()` (204 + borrado de cookie).

DTO de sesión: `{ user, method: "email"|"username", expiresAt }`. Nunca incluye
`token`, `PasswordHash`, access token de Supabase ni bearer accesible a JS.

## Identidad por email

1. `signInWithPassword` con clave pública.
2. `getUser(accessToken)` con la misma clave para re-verificar.
3. Email confirmado, mismo `authUserId` y mismo email normalizado.
4. Vínculo explícito:
   - `app_metadata.role` (`admin|doctor|user`) **y**
     `app_metadata.app_user_id` (por defecto `public.users.UserID`; configurable
     a `UUID` con `emailLinkIdField`), o
   - `options.resolveVerifiedEmailLink` inyectado por el integrador.
5. El rol real se lee de `public.users` y debe coincidir con `app_metadata.role`.
6. Sin vínculo explícito: falla cerrado con error de configuración. No se infiere
   el UUID de Auth por email, nombre ni por la columna `UUID`.

La inspección readonly actual muestra 5 identidades Auth y **cero** con
`app_metadata.role`/`app_user_id`; por tanto el login email queda cerrado hasta
que se administren esos metadatos.

## Username / bcrypt

- Solo servidor, tabla `public.users`, `PasswordHash`, roles reales.
- Se observaron 17/21 hashes `$2b$` coste 10 (longitud 60) y 4 valores de
  longitud 64 no-bcrypt. Los no-bcrypt fallan cerrado.
- No hay rehash silencioso: solo se compara; el coste/versión almacenados se
  conservan. Costes > 14 se rechazan para evitar CPU abusiva.
- Username inexistente ejecuta una comparación dummy para reducir diferencias
  de tiempo.

## Sesiones y rate limiting

- Token opaco AES-256-GCM; el payload incluye `sid`, `uid`, `method`, `iat`,
  `exp` y, solo en email, el access token de Supabase **cifrado**.
- Persistencia: `auth_sessions` guarda únicamente SHA-256 del `sid`, usuario,
  método y expiración. `user_id` es `integer` con FK a
  `public.users("UserID")` `ON UPDATE CASCADE ON DELETE CASCADE`: borrar una
  cuenta elimina sus sesiones en la misma transacción y un ID reutilizado no
  hereda sesiones. El dominio sigue usando el ID canónico string; el adaptador
  convierte a entero solo en el borde REST. Logout revoca de verdad la sesión de
  la app; `getSession` recarga el rol actual desde `public.users` en cada
  petición. La revocación del access token de Supabase es best-effort: si ya
  caducó, la sesión local sigue revocada y el token remoto expira solo.
- `CHECK (expires_at > issued_at)` impide rangos inválidos. La migración limpia
  sesiones huérfanas o con tiempos inválidos de borradores anteriores y convierte
  `user_id text` a integer de forma idempotente; no se aplicó a remoto.
- TTL: `public.auth_cleanup_expired(p_session_retention interval default '7 days',
  p_login_limit_retention interval default '7 days')` es una función
  privilegiada e idempotente que borra sesiones expiradas/revocadas antiguas y
  filas de login-limit inactivas (nunca un bloqueo futuro). El operador puede
  ejecutarla manualmente o programarla externamente/pg_cron; esta migración no
  crea cron remoto.
- Rate limit persistente por identificador (hash SHA-256), atómico vía función
  SQL; no usa memoria de proceso ni promete ser distribuido en memoria. Es por
  cuenta, no por IP: conviene complementarlo con el rate limit/WAF de la
  plataforma. No se puede aplicar rate limit por IP aquí sin pasar el contexto
  de la petición al `AuthGateway` (fuera del contrato actual).
- Aplicar `supabase-auth-schema.sql` con un rol privilegiado. Sin migración, el
  login falla cerrado con error de configuración.
- Fixture SQL local: `tests/auth/sql/auth-schema-invariants.sql` (rollback-only;
  no toca el harness de validación ni Supabase).
- No se usa `@supabase/ssr` para el login email: se evita persistir cookies de
  Supabase y el access token solo existe cifrado dentro de la sesión de la app.

## Coordinación con el foundation actual

- `Session` ya incluye `method`, el handler HTTP devuelve `PublicSession` sin
  token, coloca cookie HttpOnly y lee `sessionToken`; el módulo se adaptó a esa
  versión. `auth.http` es un helper alternativo, no un reemplazo obligatorio.
- La cookie usa el mismo nombre que el foundation: `dashboard_session`, con
  `HttpOnly`, `SameSite=Lax`, `Secure` en producción y `Path=/`. El contrato
  OpenAPI actual ya usa `cookieAuth` y `SessionResponse` sin token.
- `public.users` no tiene columna email ni `created_at`; el email de sesión email
  procede de la identidad Supabase verificada y `createdAt` queda `null`.
- `User.id` se mapea al `UserID` numérico canónico como string
  (`String(Number(UserID))`), igual que `persistence/ids.ts` del agente de
  persistencia. Así RBAC y sesión coinciden (p. ej. `"0042"` -> `"42"`).
- Discordancia deliberada con persistencia: su mapper convierte roles
  desconocidos en `user`; auth falla cerrado ante un rol que no sea
  `admin|doctor|user` para no elevar ni degradar silenciosamente. Corregir la
  fila de `public.users` si ocurre.
- Observación de foundation (no editada): en una lectura intermedia,
  `src/server/http/problem.ts` usaba `UnauthorizedError` sin importarlo. El
  agente de foundation debe verificar ese archivo; mi módulo no depende de él.

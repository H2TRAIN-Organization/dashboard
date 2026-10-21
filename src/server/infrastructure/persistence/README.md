# Persistencia Supabase T-009

Implementación aislada para los puertos foundation:

- `UserRepository` y `UserDataPresence`
- `HealthDataRepository`
- `AdminDatabaseRepository`

No se modificó composición, HTTP, dominio, frontend, configuración ni `package.json`.

## Factorías para el integrador

```ts
import bcrypt from "bcryptjs";

import {
  createBcryptPasswordHasher,
  createSupabasePersistenceFromEnvironment,
} from "@/server/infrastructure/persistence";

const persistence = createSupabasePersistenceFromEnvironment({
  passwordHasher: createBcryptPasswordHasher(bcrypt),
});

// composeServerApplication({
//   users: persistence.users,
//   userDataPresence: persistence.userDataPresence,
//   healthData: persistence.healthData,
//   adminDatabase: persistence.adminDatabase,
//   auth: /* adaptador de auth pendiente */,
// });
```

También están disponibles:

- `createSupabasePersistence({ url, serviceRoleKey, encryption, passwordHasher })`
- `createPersistenceWithClient({ client, encryption, passwordHasher })`
- `createBcryptPasswordHasher(bcryptModule, rounds = 12)`

## Dependencia bcrypt

El adaptador no importa bcrypt directamente; recibe el módulo por inyección.
La foundation actual ya declara `bcryptjs`; pásalo a la factory:

```ts
import bcrypt from "bcryptjs";
createBcryptPasswordHasher(bcrypt);
```

No se instaló nada en este worktree `dev`; `@supabase/supabase-js` también está
declarada en la foundation.

## Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` con rol `service_role`
- `SUPABASE_SECRET_KEY` solo se acepta si su JWT declara `service_role` o usa el
  prefijo nuevo `sb_secret_`
- `ENCRYPTION_SECRET_KEY` actual, hexadecimal de 64 caracteres
- `ENCRYPTION_SECRET_KEY0` anterior opcional, hexadecimal de 64 caracteres

Comprobación readonly real: `SUPABASE_SERVICE_ROLE_KEY` es `service_role`;
`SUPABASE_SECRET_KEY` sigue siendo `anon` y no se usa para persistencia.

## Migraciones SQL

Orden obligatorio; **no se aplicaron remotamente**:

1. `supabase/migrations/20261021120000_t009_health_username_integrity.sql`
   - índice único real de `users.Username`
   - secuencia/identity de `UserID` si falta default
   - `GRANT USAGE, SELECT` sobre la secuencia real a `service_role`
   - FK `username -> users.Username` en las seis tablas de salud, con
     `ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID`
2. `supabase/migrations/20261021120100_t009_user_admin_rpcs.sql`
   - `t009_update_user` (rename atómico + rol + GDPR)
   - `t009_delete_user` (bloqueo `USER_HAS_DATA`)
   - `t009_user_has_health_data`
   - bloqueos `SHARE ROW EXCLUSIVE` y verificación de FK listas
3. `supabase/migrations/20261021120200_t009_password_hash_grants.sql`
   - RLS en `users`
   - única política: `t009_service_role_all` para `service_role`
   - revoca `PasswordHash` a `anon`/`authenticated`
   - mantiene acceso `service_role`
4. `supabase/migrations/20261021130000_t025_health_tables_private.sql`
   - T-025: seis tablas de salud privadas (`insulindata`, `fooddata`,
     `exercisedata`, `periodrecords`, `mooddata`, `polar_data`)
   - revoca privilegios de tabla y columna a `PUBLIC`/`anon`/`authenticated`
   - activa RLS y elimina políticas que reabran el acceso a esos roles
   - no deja políticas para `PUBLIC`/`anon`/`authenticated`; mantiene la
     explícita `t025_service_role_all` y grants completos a `service_role`
   - conserva tablas, columnas, filas y cifrado; no crea API de ingesta

Ninguna migración se aplicó al Supabase remoto. La migración 4 se ejecutó solo
en un PostgreSQL local temporal para validar grants, RLS, secuencia y cascadas.
Se aplicó dos veces para comprobar idempotencia. Resultado local: `anon` y
`authenticated` reciben `permission denied` al leer salud; `service_role` y los
RPC de rename/delete siguen funcionando; la cascada de username y el grant de la
secuencia de `users` se mantienen.

Advertencia: las migraciones 3 y 4 cortan la lectura directa desde el navegador
y desde cualquier cliente que use la clave publishable/anon. El backend privado
debe usar `service_role`; los RPC `t009_update_user`/`t009_delete_user` siguen
funcionando por ser `SECURITY DEFINER`. **Clientes de ingesta externos que
dependan de anon —incluidos `pi-mqtt-agent` y `Uploader`, que están fuera de
alcance— necesitan una identidad/política propia revisada antes de volver a
escribir.** No se modifica su código ni se abre otra API de ingesta.

## Contrato foundation frente al contrato final

Discordancias detectadas antes de crear los adaptadores:

- La foundation actual ya usa cookie HttpOnly y
  `GET /api/auth/session -> { user, method, expiresAt }`; el token no sale en
  JSON. Persistencia no implementa auth; el adaptador de auth debe usar
  `persistence.credentials` + bcrypt y crear/revocar sesiones.
- `public.users` no tiene `Email` ni `CreatedAt`. `User.email` y
  `User.createdAt` se devuelven `null`; no se inventa una columna.
- El contrato canónico ya no incluye email en `CreateUserRecord`,
  `CreateUserCommand` ni `UpdateUserPatch`. HTTP solo admite `email: null` u
  omitido como no-op; la infraestructura no escribe email.
- El login por email no puede resolverse con el esquema verificado. El puerto
  conserva `findByEmail`; el lector de credenciales devuelve `null` para email.
  Usar login por username o migrar el esquema.
- `UserID` es entero; el `User.id` público es string canónico.
- Los envelopes definitivos son `{ user }` en POST/PATCH/clear UUID, tanto en
  foundation como en el contrato final. No hay discordancia pendiente aquí.
- `Username` es `varchar(100)` en la base; ese es el límite autoritativo. El
  repositorio rechaza más de 100 y la foundation se alineará a 100.
- Sin columna Email nueva. El DTO de lectura expone `email: null`.
- `/api/data` legacy se implementa con las tablas verificadas y datos
  descifrados (`exercise`, `mood`, `insulin`, `meal`).

## Seguridad de proyección

- `users` público: nunca selecciona `PasswordHash`.
- admin `users`: proyección explícita sin `PasswordHash`.
- salud: descifra y elimina `iv`/`*_iv`; no devuelve ciphertext.
- errores de crypto/persistencia no incluyen valores, hashes, claves ni mensajes
  crudos de Postgres.
- paginación de salud por `id ASC` en páginas de 1000 para no truncar.
- ventana descifrada respeta la interfaz actual: `from` inclusivo y `to`
  exclusivo (`>= from`, `< to`); el endpoint legacy conserva `to` inclusivo.
- `dateFilter` se interpreta como día UTC completo en la capa de aplicación;
  persistencia solo recibe `from`/`to`.
- `selectedUser=all` solo queda sin filtro para admin/doctor; la aplicación
  normaliza al username propio para rol `user`.

# K49 - Pruebas reproducibles de la capa de datos Kubios

Runner: `run-kubios-db-tests.ps1`.

Levanta un PostgreSQL 16 efimero en Docker local, aprovisiona un bootstrap
sintetico minimo de la base de produccion (roles de la Data API,
`public.users("UserID") integer` con secuencia y columnas sensibles, y las seis
tablas de salud), aplica las migraciones reales de privacidad T025/T053 y
despues la migracion consolidada Kubios, y ejecuta 161 comprobaciones de
privilegios, restricciones, aislamiento, privacidad y contrato de las RPC.
Imprime PASS/FAIL por comprobacion y sale con codigo distinto de 0 si algo falla.

No lee `.env`, YAML ni credenciales; no usa datos reales; no accede a red remota;
no modifica migraciones ni ningun otro archivo del repositorio.

## Requisitos

- Windows con PowerShell 5.1 o superior.
- Docker Desktop en ejecucion.
- Imagen local `postgres:16` (probado con PostgreSQL 16.15, Debian). El runner
  **no descarga imagenes**: si no existe localmente, termina con codigo 2.
- Ejecutar desde cualquier directorio: el runner resuelve la raiz del repo a
  partir de su propia ruta.

## Ejecucion

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\kubios-db\run-kubios-db-tests.ps1
```

Codigos de salida:

| Codigo | Significado |
|--------|-------------|
| 0 | Todas las comprobaciones PASS |
| 1 | Al menos una comprobacion FAIL |
| 2 | Entorno no apto: Docker, imagen local o migraciones |

## Que hace el runner

1. Verifica Docker, la imagen local, que exista exactamente la migracion
   `20261103100413_kubios_production_core.sql` y que existan las dos
   migraciones reales de privacidad `20261021130000_t025_health_tables_private.sql`
   y `20261021150000_t053_users_private.sql`.
2. Crea un contenedor efimero con nombre aleatorio `cerbero-kubios-db-<12 hex>`
   y labels `cerbero.test=kubios-db` / `cerbero.task=K49`, con `--network none`,
   `--pull never`, sin puertos publicados, sin volumenes nombrados y con
   `listen_addresses=` (solo socket Unix, sin TCP). Los datos viven en un tmpfs.
3. Aplica el bootstrap sintetico como superusuario `postgres`: roles, fixture
   de users/salud y registro del estado de privilegios/politicas previo.
4. Aplica los SQL reales de T025 y T053, sin modificarlos, antes de Kubios.
5. Aplica la migracion Kubios consolidada.
6. Ejecuta las comprobaciones y muestra la tabla PASS/FAIL con la evidencia.
7. Elimina el contenedor, incluso si las comprobaciones fallan.

## Bootstrap sintetico

Solo existe lo que la migracion referencia. No es un Supabase completo.

| Objeto | Definicion | Motivo |
|--------|------------|--------|
| `anon` | `NOLOGIN NOINHERIT` | Rol de la Data API; sin privilegios extra |
| `authenticated` | `NOLOGIN NOINHERIT` | Rol de la Data API; sin privilegios extra |
| `service_role` | `NOLOGIN NOINHERIT BYPASSRLS` | Unico consumidor de las tablas privadas con RLS y sin politicas |
| `authenticator` | `LOGIN NOINHERIT`, miembro de los tres roles | Rol de entrada del Data API; sin password, solo socket local |
| `public.users` | `("UserID" serial primary key, "Username" text, "PasswordHash" text, "UUID" uuid, "Email" text)` | Fixture realista minimo: identidad integer con secuencia, columnas sensibles y dos filas ficticias; no `auth.users` UUID |
| `public.insulindata`, `fooddata`, `exercisedata`, `periodrecords`, `mooddata`, `polar_data` | `id serial primary key, username text`, una columna de datos y `recorded_at` | Fixture de las seis tablas que T025 protege; incluye secuencias reales y una fila ficticia por tabla |
| Privilegios/politicas heredados | Grants de tabla y columna a `PUBLIC`/`anon`/`authenticated`, grants de secuencia y policies abiertas | Estado previo que T025/T053 deben revocar/eliminar; `kubios_precheck.before` registra el resultado efectivo de 70 hechos antes de aplicar los SQL |
| `USAGE` en `public` | Para `anon`, `authenticated`, `service_role` | Baseline de Supabase para resolver las RPC por nombre; las migraciones revocan EXECUTE y solo conceden a `service_role` |

No se crea el esquema `auth` ni `auth.users`: la migracion consolidada no debe
depender de ellos ni la FK de vinculos. Tampoco se crean extensiones para el
esquema; la unica excepcion es `dblink` (contrib de la imagen oficial), que se
instala solo en la base efimera para abrir una segunda sesion local y verificar
el lock del cursor.

## Comprobaciones y resultado real

Ultima ejecucion (2026-11-03): **161/161 PASS**, exit 0, contenedor eliminado.

| Criterio | Checks | Resultado | Evidencia principal |
|----------|--------|-----------|---------------------|
| A. Separacion por roles | A1-A15 | PASS | `anon`/`authenticated` reciben SQLSTATE **42501** al tocar `kubios_private` o ejecutar RPC; `authenticator` tambien es rechazado sin `SET ROLE` |
| B. Privilegios y contrato integer | B0-B13 | PASS | `has_schema_privilege`, `has_table_privilege` y `has_function_privilege`: sin privilegios para `anon`/`authenticated`/PUBLIC; `service_role` solo SELECT/INSERT/UPDATE (DELETE solo en `user_member_links`) y ningun privilegio directo sobre el cursor; RLS activo sin politicas; `user_member_links.user_id` es `integer` con FK a `public.users("UserID")` ON DELETE CASCADE; no existe `auth.users`; las RPC de vinculo solo tienen firma integer |
| P. Privacidad real T025/T053 | P1-P14 | PASS | 70 hechos previos efectivos (tabla/columna/PUBLIC/policies/secuencias) y estado posterior: `anon`/`authenticated`/PUBLIC sin privilegios de tabla ni columna, `service_role` con acceso, RLS activo, cero policies publicas y una policy `service_role` por tabla, secuencias revocadas y filas ficticias preservadas. Los SQL se aplican sin modificarlos |
| C. `service_role` operativo | C1-C7 | PASS | Lease, escritura/lectura de snapshot, token, alta y consulta de vinculo con `UserID` integer |
| D. Unicidad, idempotencia y cross-user | D1-D15 | PASS | **23505** en PK `user_id` y en `UNIQUE (kubios_member_id)`; **23503** FK a `public.users`; **23502** NOT NULL; alta idempotente no toca `updated_at`; reasignacion si lo actualiza; revocacion `true`/`false`; cross-user no ve el vinculo ajeno; **ON DELETE CASCADE** borra el vinculo al borrar `public.users` |
| E. Lectura cifrada | E1-E8 | PASS | `kubios_get_snapshot` devuelve ciphertext/nonce/tag/key_version exactos; el ciphertext no coincide con el marcador de texto plano; `updated_at` coincide; upsert deja una fila |
| F. Fences owner/lease | F1-F6 | PASS | **P0001** con `kubios_sync_lease_missing`, `kubios_sync_lease_owner_mismatch`, `kubios_sync_lease_expired`, `kubios_snapshot_invalid_argument`, `kubios_token_write_denied`; `finish_sync` con lease vencido devuelve `false` |
| G. Preservacion | G1-G4 | PASS | El JSON completo del snapshot (bytes y `updated_at`) no cambia tras los rechazos; no se crea snapshot para el equipo sin lease |
| H. Backoff 429, pausa indefinida y validacion | H1-H27 | PASS | `retry_after=30` fija `next_allowed_at` a +30 s y el intento inmediato da `false`; `86401` y `2147483647` se aceptan sin recorte; un valor > int4 se rechaza sin persistir; `kubios_finish_sync_indefinite` fija `infinity`, limpia el lease con lease vigente o expirado del mismo owner, no toca nada con otro owner y bloquea `try_acquire`; un `finish_sync` finito posterior no acorta `infinity`; argumentos invalidos dan **22023**; CHECK de formato y de pareja del lease dan **23514** |
| I. Token cifrado | I1-I12 | PASS | Round-trip exacto del token, expiracion pasada conservada (sin filtro), escritura con owner distinto rechazada con `kubios_token_write_denied` y token intacto, `anon`/`authenticated` sin acceso |
| J. Cursor durable | J1-J34 | PASS | Lectura/escritura por `service_role`; owner distinto, lease caducado y equipo sin lease devuelven `false` y no cambian el estado; argumentos invalidos dan **22023**; CHECK `failed subset` da **23514**; `FOR UPDATE` real con `dblink`: avance concurrente bloqueado con **55P03** sin escribir y aplicado tras liberar el lock; solo `service_role` tiene EXECUTE; helpers `SECURITY DEFINER` en `kubios_private`, wrappers `SECURITY INVOKER`, tabla sin privilegios directos y RLS sin politicas |

Salida resumida observada:

```text
TOTAL=161 PASS=161 FAIL=0
KUBIOS_DB_TESTS_RESULT: PASS (161 comprobaciones, 0 fallidas)
==> RESULTADO: PASS
==> cleanup: contenedor cerbero-kubios-db-... eliminado
```

SQLSTATE reales documentados por las comprobaciones:

| Caso | SQLSTATE | Mensaje / restriccion |
|------|----------|-----------------------|
| Acceso de `anon`/`authenticated` a `kubios_private` | 42501 | `permission denied for schema kubios_private` |
| EXECUTE de RPC por `anon`/`authenticated`/`authenticator` | 42501 | `permission denied for function ...` |
| Vinculo duplicado por `user_id` | 23505 | `user_member_links_pkey` |
| Miembro ya vinculado | 23505 | `user_member_links_kubios_member_id_key` |
| Usuario inexistente | 23503 | `user_member_links_user_id_fkey` |
| Argumento NOT NULL nulo | 23502 | columna `team_id` |
| Sin lease / owner distinto / lease vencido | P0001 | `kubios_sync_lease_missing` / `..._owner_mismatch` / `..._expired` |
| Token sin lease vigente | P0001 | `kubios_token_write_denied` |
| Argumentos invalidos de lease/pausa/cursor | 22023 | validacion de la funcion |
| `last_error_code` libre / pareja de lease incompleta | 23514 | CHECK de `team_sync_state` |
| Cursor con `failed` fuera de `attempted` | 23514 | `team_sync_cursor_failed_subset` |
| Avance del cursor bloqueado por `FOR UPDATE` | 55P03 | `lock_timeout` en la prueba `dblink`; sin escritura |

## Limpieza y seguridad del runner

- Cleanup garantizado en `finally`: `docker rm -f` **solo** del contenedor
  propio, previa verificacion del prefijo de nombre y de la label
  `cerbero.test=kubios-db`. Nunca ejecuta `docker prune` ni toca contenedores,
  imagenes o volumenes ajenos.
- Sin `-p`, con `--network none` y `listen_addresses=` (sin socket TCP). El acceso
  es por `docker exec` al socket local.
- `POSTGRES_HOST_AUTH_METHOD=trust` evita passwords; el contenedor es efimero,
  aislado y se elimina al terminar.
- Los UserID, UUID y bytes de prueba son ficticios. No hay claves, tokens,
  secretos ni datos personales.

## Limitaciones de la simulacion local frente a Supabase

Probado de verdad:

- Aplicacion de la migracion consolidada sobre PostgreSQL 16 limpio, sin
  `auth.users`.
- Aislamiento a nivel SQL: schema privado, revokes de tabla y de funcion,
  privilegios efectivos por rol y `SECURITY INVOKER` con `search_path` fijo.
- Contrato de las RPC de snapshot, token, vinculo, lease y cursor;
  restricciones de unicidad, FK, NOT NULL, CHECK, cascada e idempotencia.
- Cross-user: el usuario 2002 no ve el vinculo del usuario 2001 y no puede
  reclamar su miembro.
- Pausa finita sin recorte hasta el maximo de integer y pausa indefinida con
  `next_allowed_at = 'infinity'`.
- Round-trip opaco de bytes cifrados ficticios y preservacion de snapshot.
- RLS activado y sin politicas publicas en Kubios; en users/salud, T025/T053
  reales aplicadas sobre un fixture con exposicion heredada, con permisos
  efectivos de tabla y columna antes/despues, RLS, policies y secuencias.
- Cursor: lectura/escritura, ACL, fence owner/lease, validacion de argumentos y
  un lock real con `dblink`.

No probado o limitado (no se declara aprobado):

1. **Sin PostgREST/Data API**: no se prueba la exposicion HTTP, la configuracion
   `[api] schemas`, el 401/403 de la API ni el pooler. Solo privilegios SQL.
2. **Sin GoTrue/JWT**: no hay claims, sesion real ni `auth.uid()`. `SET ROLE`
   sustituye a la sesion autenticada. Las tablas privadas Kubios no tienen
   politicas por diseno; users/salud solo tienen la policy `service_role` creada
   por T025/T053.
3. **`public.users` y salud son fixtures minimos**, no el esquema real: se
   aplican los SQL reales de T025/T053 y se prueban privilegios de tabla y
   columna, ACL de PUBLIC, RLS, policies y secuencias, pero no triggers,
   constraints, columnas ni datos de produccion. No sustituye staging.
4. **Roles sinteticos**: atributos (`NOLOGIN`, `NOINHERIT`, `BYPASSRLS`) y
   concesiones imitan Supabase, pero no se reproducen `ALTER DEFAULT PRIVILEGES`,
   el esquema `extensions`, `vault`, `pg_cron` ni el resto del entorno Supabase.
5. **No se prueba la ruta Next ni el cron**: el fail-closed del cron se verifica
   en `tests/kubios-cron-sql.k43.test.mjs` con stubs de `cron`, `net` y `vault`.

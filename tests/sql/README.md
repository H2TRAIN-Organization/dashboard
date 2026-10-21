# T-054 portable SQL validation harness (real PostgreSQL)

Validates the actual auth schema and migrations against an isolated local
PostgreSQL 16 container. No HTTP stand-ins, no remote Supabase, no real
credentials, no PII. Synthetic fixture data only.

## Inputs (read-only)

| Input | Default relative to repo root |
| --- | --- |
| auth SQL | `src/server/infrastructure/auth/supabase-auth-schema.sql` |
| migrations | `supabase/migrations/*.sql` (sorted) |
| schema snapshot | `tests/sql/fixtures/schema-metadata.json` |
| PostgreSQL | `127.0.0.1:15432`, user `postgres`, db `postgres` |

Overrides: `T014_AUTH_SQL`, `T014_MIGRATIONS_DIR`, `T014_METADATA`,
`T014_PG_USER`, `T014_PG_PASSWORD`. The runner refuses any host other than
`127.0.0.1` and any port other than `15432`. Databases are prefixed `t014_`
and dropped at the end (`T014_KEEP_DBS=1` keeps them). It never stops
containers or deletes directories it does not own.

Portable migration order is fixed in the runner:

`M1 health/username integrity -> M2 admin RPCs -> M3 PasswordHash grants -> M4
health privacy -> M5 users privacy`.

## Run after clone

```powershell
docker run -d --name dashboard-sql-validation `
  -e POSTGRES_PASSWORD=synthetic_local_only `
  -e POSTGRES_DB=t009_validation `
  -p 127.0.0.1:15432:5432 postgres:16-alpine

docker exec dashboard-sql-validation pg_isready -U postgres -d t009_validation
docker inspect dashboard-sql-validation --format '{{.Id}}'

npm install --prefix tests/sql --no-audit --no-fund
node tests/sql/run-sql-validation.mjs
```

Check the container name/port are yours before cleanup:

```powershell
docker rm -f dashboard-sql-validation
```

No absolute user paths are required. `tests/sql/.gitignore` ignores
`node_modules/`, logs, `last-run.json`, `artifacts/` and `.tmp*`.

### Pre-merge verification with donor worktrees

Use relative paths from the integration checkout. The M1-M4 donor and M5 donor
must be exact bytes; the runner hashes what it executes and does not patch SQL.

```powershell
$env:T014_AUTH_SQL = (Resolve-Path "..\auth\src\server\infrastructure\auth\supabase-auth-schema.sql").Path
$env:T014_MIGRATIONS_DIR = (Resolve-Path "..\users-privacy\supabase\migrations").Path
node tests/sql/run-sql-validation.mjs
```

If the default product SQL is not merged yet, it fails fast with a clear
"not found" error. Do not create patched SQL copies; copy exact bytes only when
a donor split is unavoidable.

## Evidence

T-028 accepted result: **59/59 PASS** with M1-M4.

T-054 final result: **65/65 PASS, 0 FAIL, 0 WARN, 0 SKIP** on fresh PostgreSQL
16.15 with all five original migrations, including the frozen M5. Six new
checks cover users privacy.

| SQL | SHA-256 canonical LF |
| --- | --- |
| auth | `c95e17029d18a5d5abcc3ff52de9b3a13da864ee6f15bda8212888289690763a` |
| M1 | `b1d58d5b6c13bf03266ce37981eb9786db939ed86aa4158e2fa6907d0ba2924f` |
| M2 | `0f55c74874d675c5b61b2b23df8333fb55f189d5070f7c4befe8add99d7d39a2` |
| M3 | `5333bf80d056baa7fef34267b7e01555c40de90868c61bd5de9bd3677e461524` |
| M4 | `85fb8356c7a94bac6e76402addd51436b3e182514daa7da4ae56bb7a41eade52` |
| **M5** | **`d24f8c7098ffc2c1d1eea304f114b1609a9e39dda178b8d5c6eba0323b6c1b6b`** |

Raw CRLF bytes seen in the donor checkout: M1 `3e1d0585…`, M2 `3d548221…`,
M3 `b2b73fee…`, M4 `b5f7b7ab…`; M5 is LF exact as above. Auth raw CRLF:
`360fc78c…`; canonical LF is `c95e1702…`.

## Fixture provenance

`fixtures/001_metadata_schema.sql` is generated from the committed sanitized
snapshot: table/column names, PostgreSQL formats, lengths, nullability
(`required`) and defaults. A drift check compares every fixture column, type,
length and nullability with the snapshot. The snapshot contains no host, keys,
counts, row values or PII.

Not claimed as remote facts: FKs, unique constraints, RLS, policies, grants,
sequence ownership/default privileges. Roles `anon`, `authenticated`,
`service_role` (BYPASSRLS), custom-role policies and legacy wide grants are
local/test-only setup. The fixture deliberately reproduces legacy exposure so
the real M4/M5 migrations must close it.

Migration 1 is exercised both with no legacy UserID default (auto-created
sequence, ownership and grants) and with a pre-existing serial default.

## Coverage

- M1: duplicate preflight/rollback, unique Username, sequence/ownership/grants,
  six FKs, legacy orphan tolerance, idempotent reapply.
- M2: fail-closed without FKs, rename/role/GDPR RPC, six health tables, conflict
  and trigger rollback, injection/validation, UUID/GDPR.
- M3: PasswordHash column protection, RLS, service policy, RPC grants.
- M4 health privacy: all six health tables revoke table/column privileges and
  legacy permissive policies; service_role DML preserved; rows/ciphertext/
  columns unchanged; idempotent; rename/delete RPCs still work.
- **M5 users privacy**, with legacy `PUBLIC`/`anon`/`authenticated` policies and
  table/column CRUD grants installed before M3/M5:
  - reproduces pre-M5 profile exposure;
  - removes all PUBLIC/anon/authenticated policies, preserving custom-role-only
    policies;
  - revokes table/column read/write/hash access, including actual `42501` for
    profile UUID/GDPR and PasswordHash;
  - preserves rows, UUID/GDPR values, columns and schema digest;
  - service_role retains CRUD and `UserID` sequence allocation;
  - custom policy/access survives;
  - reapply is idempotent and keeps rows/schema/policies stable;
  - M5 static check: fixed `public.users`, access-exclusive lock, `%I` quoting,
    local search_path, sequence via `pg_get_serial_sequence`/`pg_depend`, no
    SECURITY DEFINER.
- Auth sessions: integer FK cascade, expiry CHECK, cleanup retention, legacy
  text→integer conversion, rate-limit concurrency.
- Deletes and races: FK/`USER_HAS_DATA` behavior, insert/delete races, session
  cascade.

## Deployment warnings

- **Users are server-only after M5.** Direct anon/authenticated reads of
  `users` stop; the backend must use service_role. Legacy browser read paths
  must move behind the server API.
- **Anon ingestion clients** (for example `pi-mqtt-agent` or Uploader) need a
  separately reviewed identity/policy; no client code is changed here.
- M4/M5 were applied only to disposable local engines. This harness does not
  prove remote Supabase RLS/grant state and does not authorize remote
  application.
- `auth_cleanup_expired` is privileged but not scheduled; an external scheduler
  is required.

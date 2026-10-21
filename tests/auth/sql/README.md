# Local SQL invariants (T-020)

`auth-schema-invariants.sql` is a synthetic, rollback-only PostgreSQL 16 check
for:

- `auth_sessions.user_id integer` FK to `public.users("UserID")`
  `ON UPDATE CASCADE ON DELETE CASCADE`;
- `CHECK (expires_at > issued_at)`;
- TTL cleanup of expired/revoked sessions and idle login-limit rows, while
  keeping active sessions and future blocks;
- idempotent second cleanup.

Do not run against Supabase. It requires the T-014 synthetic fixture
`public.users` and the auth schema already applied in an isolated local
database. The harness runner is `validation/tests/sql/run-sql-validation.mjs`;
this file is a supplemental fixture only and is not edited by it.

Example with the isolated Docker database from the T-014 README:

```powershell
docker cp tests/auth/sql/auth-schema-invariants.sql dashboard-sql-validation:/tmp/
docker exec -i dashboard-sql-validation psql -U postgres -d postgres `
  -v ON_ERROR_STOP=1 -f /tmp/auth-schema-invariants.sql
```

The transaction ends with `ROLLBACK`; no data is retained.

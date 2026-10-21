-- T-020 local SQL invariants fixture.
-- Run only against an isolated local PostgreSQL 16 database, after:
--   1) validation fixture 001_metadata_schema.sql (public.users exists)
--   2) src/server/infrastructure/auth/supabase-auth-schema.sql
-- The transaction rolls back. Synthetic data only; no remote project.
--
-- Example:
--   docker exec -i dashboard-sql-validation psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f /tmp/auth-schema-invariants.sql

begin;

insert into public.users ("UserID", "Username", "PasswordHash", "role")
values
  (9001, 't020-cascade', 'synthetic-not-a-real-hash', 'user'),
  (9002, 't020-cleanup', 'synthetic-not-a-real-hash', 'user');

-- CHECK expires_at > issued_at
do $$
begin
  begin
    insert into public.auth_sessions
      (sid_hash, user_id, method, issued_at, expires_at)
    values
      (repeat('c', 64), 9001, 'username', now(), now());
    raise exception 'T020_CHECK_NOT_ENFORCED';
  exception
    when check_violation then null;
  end;
end;
$$;

-- FK to public.users ("UserID")
do $$
begin
  begin
    insert into public.auth_sessions
      (sid_hash, user_id, method, issued_at, expires_at)
    values
      (repeat('d', 64), 999999, 'username', now(), now() + interval '1 hour');
    raise exception 'T020_FK_NOT_ENFORCED';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;

insert into public.auth_sessions
  (sid_hash, user_id, method, issued_at, expires_at)
values
  (repeat('a', 64), 9001, 'username', now(), now() + interval '1 hour');

-- ON DELETE CASCADE: deleting the user removes the active session.
delete from public.users where "UserID" = 9001;
do $$
begin
  if exists (
    select 1 from public.auth_sessions where user_id = 9001
  ) then
    raise exception 'T020_CASCADE_NOT_ENFORCED';
  end if;
end;
$$;

-- Sessions: expired-beyond-retention + old-revoked must be removed; active kept.
insert into public.auth_sessions
  (sid_hash, user_id, method, issued_at, expires_at, revoked_at)
values
  (repeat('b', 64), 9002, 'username', now() - interval '10 days', now() - interval '9 days', null),
  (repeat('e', 64), 9002, 'username', now() - interval '20 days', now() + interval '1 day', now() - interval '10 days'),
  (repeat('f', 64), 9002, 'email', now(), now() + interval '1 hour', null);

-- Login limits: old idle row removed; old row with future block kept.
insert into public.auth_login_limits
  (key_hash, window_started_at, failures, blocked_until, updated_at)
values
  (repeat('1', 64), now() - interval '11 days', 2, null, now() - interval '10 days'),
  (repeat('2', 64), now() - interval '11 days', 3, now() + interval '1 hour', now() - interval '10 days');

select *
from public.auth_cleanup_expired(interval '7 days', interval '7 days');

do $$
declare
  v_sessions bigint;
  v_limits bigint;
begin
  select count(*) into v_sessions
    from public.auth_sessions
   where sid_hash in (repeat('b', 64), repeat('e', 64));
  if v_sessions <> 0 then
    raise exception 'T020_SESSION_TTL_NOT_ENFORCED';
  end if;

  select count(*) into v_sessions
    from public.auth_sessions
   where sid_hash = repeat('f', 64);
  if v_sessions <> 1 then
    raise exception 'T020_ACTIVE_SESSION_REMOVED';
  end if;

  select count(*) into v_limits
    from public.auth_login_limits
   where key_hash = repeat('1', 64);
  if v_limits <> 0 then
    raise exception 'T020_LOGIN_LIMIT_TTL_NOT_ENFORCED';
  end if;

  select count(*) into v_limits
    from public.auth_login_limits
   where key_hash = repeat('2', 64);
  if v_limits <> 1 then
    raise exception 'T020_FUTURE_BLOCK_REMOVED';
  end if;

  -- Idempotent second run deletes nothing.
  select sessions_deleted, login_limits_deleted
    into v_sessions, v_limits
    from public.auth_cleanup_expired(interval '7 days', interval '7 days');
  if v_sessions <> 0 or v_limits <> 0 then
    raise exception 'T020_CLEANUP_NOT_IDEMPOTENT';
  end if;
end;
$$;

rollback;

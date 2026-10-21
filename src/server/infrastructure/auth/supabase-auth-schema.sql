-- T-008/T-020 authentication/session persistence for Supabase.
-- Apply this migration as a privileged database owner (Supabase SQL editor or
-- migration pipeline). It is intentionally not executed by the application.
-- Prerequisite: public.users ("UserID" integer primary key) already exists.
--
-- Tables live in the exposed `public` schema because the legacy `users` table
-- is there. PostgREST requests from src/server/infrastructure/auth use:
--   Accept-Profile: public
--   Content-Profile: public
--
-- T-020 integrity: auth_sessions.user_id is an integer FK to public.users with
-- ON DELETE CASCADE. Deleting a user therefore removes all of that user's
-- sessions in the same transaction, so an id reused later cannot inherit an
-- old session. Session TTL cleanup is a privileged, idempotent function; this
-- migration does not schedule a remote job.

create table if not exists public.auth_sessions (
  sid_hash text primary key,
  -- Domain/User.id remains a canonical string at the application boundary.
  -- The database stores the real integer key to enforce referential integrity.
  user_id integer not null,
  method text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_sessions_method_check
    check (method in ('email', 'username')),
  constraint auth_sessions_expiry_after_issue_check
    check (expires_at > issued_at),
  constraint auth_sessions_user_id_fkey
    foreign key (user_id) references public.users ("UserID")
    on update cascade on delete cascade
);

create index if not exists auth_sessions_user_id_idx
  on public.auth_sessions (user_id);
create index if not exists auth_sessions_expires_at_idx
  on public.auth_sessions (expires_at);

-- Idempotent repair for databases where an earlier draft created user_id as
-- text or without the FK/CHECK. The table is not deployed remotely yet; this
-- block keeps local re-applies safe and explicit.
do $$
declare
  v_type text;
  v_fk record;
begin
  select data_type
    into v_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'auth_sessions'
     and column_name = 'user_id';

  if v_type is null then
    raise exception 'auth_sessions.user_id is missing';
  end if;

  if v_type in ('text', 'character varying', 'character') then
    -- Only canonical numeric UserIDs can satisfy the integer FK. Session rows
    -- with malformed IDs are orphaned authentication state, not user data.
    delete from public.auth_sessions where user_id !~ '^-?[0-9]+$';
    alter table public.auth_sessions
      alter column user_id type integer using user_id::integer;
  elsif v_type <> 'integer' then
    raise exception 'auth_sessions.user_id must be integer, found %', v_type;
  end if;

  delete from public.auth_sessions
   where user_id is null
      or issued_at is null
      or expires_at is null;

  alter table public.auth_sessions alter column user_id set not null;
  alter table public.auth_sessions alter column issued_at set not null;
  alter table public.auth_sessions alter column expires_at set not null;

  -- Remove orphaned sessions left by a previous no-FK draft. These sessions
  -- can never authenticate: getSession also reloads public.users and fails
  -- closed, but the database must not keep active orphan state.
  delete from public.auth_sessions as s
   where not exists (
     select 1
       from public.users as u
      where u."UserID" = s.user_id
   );

  -- Invalid time ranges are unusable; remove them before enforcing the CHECK.
  delete from public.auth_sessions where expires_at <= issued_at;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.auth_sessions'::regclass
       and conname = 'auth_sessions_expiry_after_issue_check'
  ) then
    alter table public.auth_sessions
      add constraint auth_sessions_expiry_after_issue_check
      check (expires_at > issued_at);
  end if;

  for v_fk in
    select conname
      from pg_constraint
     where conrelid = 'public.auth_sessions'::regclass
       and conname = 'auth_sessions_expiry_after_issue_check'
       and not convalidated
  loop
    execute format(
      'alter table public.auth_sessions validate constraint %I',
      v_fk.conname
    );
  end loop;

  -- Replace any pre-existing FK to users that does not have the required
  -- cascade actions. A correctly configured FK is left untouched.
  for v_fk in
    select conname
      from pg_constraint
     where conrelid = 'public.auth_sessions'::regclass
       and contype = 'f'
       and confrelid = 'public.users'::regclass
       and (confdeltype <> 'c' or confupdtype <> 'c')
  loop
    execute format(
      'alter table public.auth_sessions drop constraint %I',
      v_fk.conname
    );
  end loop;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.auth_sessions'::regclass
       and contype = 'f'
       and confrelid = 'public.users'::regclass
       and confdeltype = 'c'
       and confupdtype = 'c'
  ) then
    alter table public.auth_sessions
      add constraint auth_sessions_user_id_fkey
      foreign key (user_id) references public.users ("UserID")
      on update cascade on delete cascade;
  end if;

  for v_fk in
    select conname
      from pg_constraint
     where conrelid = 'public.auth_sessions'::regclass
       and contype = 'f'
       and confrelid = 'public.users'::regclass
       and confdeltype = 'c'
       and confupdtype = 'c'
       and not convalidated
  loop
    execute format(
      'alter table public.auth_sessions validate constraint %I',
      v_fk.conname
    );
  end loop;
end;
$$;

alter table public.auth_sessions enable row level security;
revoke all on table public.auth_sessions from anon, authenticated;
grant select, insert, update, delete on table public.auth_sessions to service_role;

create table if not exists public.auth_login_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  failures integer not null default 0 check (failures >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists auth_login_limits_updated_at_idx
  on public.auth_login_limits (updated_at);

alter table public.auth_login_limits enable row level security;
revoke all on table public.auth_login_limits from anon, authenticated;
grant select, insert, update, delete on table public.auth_login_limits to service_role;

-- Atomically consumes one login attempt for a hashed identifier. A successful
-- login calls auth_login_reset(); failed logins leave the counter incremented.
create or replace function public.auth_login_consume(
  p_key_hash text,
  p_window_seconds integer,
  p_max_attempts integer,
  p_block_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.auth_login_limits%rowtype;
  v_failures integer;
begin
  if p_key_hash is null or length(p_key_hash) < 16 then
    raise exception 'invalid rate-limit key';
  end if;
  if p_window_seconds < 1 or p_max_attempts < 1 or p_block_seconds < 1 then
    raise exception 'invalid rate-limit policy';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));

  select *
    into v_row
    from public.auth_login_limits
   where key_hash = p_key_hash
   for update;

  if not found then
    insert into public.auth_login_limits (
      key_hash, window_started_at, failures, blocked_until, updated_at
    )
    values (p_key_hash, v_now, 1, null, v_now);

    return query select true, 0, greatest(p_max_attempts - 1, 0);
    return;
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query
      select
        false,
        ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer,
        0;
    return;
  end if;

  if v_row.blocked_until is not null
     or v_row.window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    update public.auth_login_limits
       set window_started_at = v_now,
           failures = 1,
           blocked_until = null,
           updated_at = v_now
     where key_hash = p_key_hash;

    return query select true, 0, greatest(p_max_attempts - 1, 0);
    return;
  end if;

  v_failures := v_row.failures + 1;

  if v_failures >= p_max_attempts then
    update public.auth_login_limits
       set failures = v_failures,
           blocked_until = v_now + make_interval(secs => p_block_seconds),
           updated_at = v_now
     where key_hash = p_key_hash;

    return query select false, p_block_seconds, 0;
  else
    update public.auth_login_limits
       set failures = v_failures,
           updated_at = v_now
     where key_hash = p_key_hash;

    return query select true, 0, greatest(p_max_attempts - v_failures, 0);
  end if;
end;
$$;

create or replace function public.auth_login_reset(p_key_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.auth_login_limits where key_hash = p_key_hash;
$$;

-- Privileged, idempotent TTL cleanup. Operators may run it manually or from an
-- external scheduler/pg_cron. No remote cron is created by this migration.
-- Sessions are removed after expiry (or after revocation) beyond the retention
-- window. Login-limit rows are removed only when not currently blocked.
create or replace function public.auth_cleanup_expired(
  p_session_retention interval default interval '7 days',
  p_login_limit_retention interval default interval '7 days'
)
returns table (
  sessions_deleted bigint,
  login_limits_deleted bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions bigint;
  v_limits bigint;
begin
  if p_session_retention < interval '0'
     or p_login_limit_retention < interval '0' then
    raise exception 'invalid retention interval';
  end if;

  delete from public.auth_sessions as s
   where s.expires_at < now() - p_session_retention
      or (s.revoked_at is not null
          and s.revoked_at < now() - p_session_retention);
  get diagnostics v_sessions = row_count;

  delete from public.auth_login_limits as l
   where l.updated_at < now() - p_login_limit_retention
     and (l.blocked_until is null or l.blocked_until < now());
  get diagnostics v_limits = row_count;

  return query select v_sessions, v_limits;
end;
$$;

revoke all on function public.auth_login_consume(text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.auth_login_reset(text)
  from public, anon, authenticated;
revoke all on function public.auth_cleanup_expired(interval, interval)
  from public, anon, authenticated;
grant execute on function public.auth_login_consume(text, integer, integer, integer)
  to service_role;
grant execute on function public.auth_login_reset(text)
  to service_role;
grant execute on function public.auth_cleanup_expired(interval, interval)
  to service_role;

comment on table public.auth_sessions is
  'Opaque app sessions. Stores only SHA-256(sid); tokens remain encrypted in HttpOnly cookies. user_id FK to users ON DELETE CASCADE.';
comment on table public.auth_login_limits is
  'Persistent per-identifier login throttling for serverless deployments.';
comment on function public.auth_cleanup_expired(interval, interval) is
  'Idempotent privileged TTL cleanup for auth_sessions and auth_login_limits; no scheduler is installed.';

-- T-053: make public.users server-only at the database boundary.
--
-- Context: M3 enabled RLS and removed the PasswordHash grant, but legacy
-- PUBLIC/anon/authenticated policies still allow direct PostgREST reads of
-- UUID/GDPR columns. M4 hardened the six health tables but intentionally did
-- not change public.users. This migration closes that remaining path.
--
-- Security contract:
--   * Enable RLS on public.users.
--   * Remove every policy that includes PUBLIC, anon or authenticated. Policies
--     restricted to separately reviewed custom roles are preserved.
--   * Revoke table and column privileges from PUBLIC, anon and authenticated.
--   * Revoke privileges on the real users.UserID sequence from those roles.
--   * Re-assert service_role CRUD, sequence allocation and an explicit
--     service_role policy for the server-side API.
--
-- Data/schema safety:
--   * No table, column, row, UUID, GDPR, hash or legacy value is modified.
--   * No sequence is created or regenerated; the real sequence is discovered
--     with pg_get_serial_sequence and a pg_depend fallback, never a fixed name.
--   * Transactional and idempotent: REVOKE/GRANT and DROP POLICY IF EXISTS are
--     repeatable. The users table is locked to avoid a concurrent policy/grant
--     window during the migration.
--
-- WARNING: not applied remotely from this worktree. Validate on disposable
-- PostgreSQL/staging before deployment.

begin;

set local search_path = pg_catalog, public, pg_temp;

-- Freeze policy/grant DDL for the duration of this transaction. ALTER TABLE
-- would take a strong lock anyway; taking it first makes the intent explicit.
lock table public.users in access exclusive mode;

alter table public.users enable row level security;

-- Table-level privileges override column grants, so revoke them first.
revoke all privileges on table public.users
  from public, anon, authenticated;

-- Column-level grants are independent from table grants. Revoke every column
-- privilege that PostgREST could use directly. This includes PasswordHash and
-- legacy copied data columns without altering any of them.
do $$
declare
  v_column record;
begin
  for v_column in
    select a.attname
    from pg_attribute a
    where a.attrelid = 'public.users'::regclass
      and a.attnum > 0
      and not a.attisdropped
  loop
    execute format(
      'revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on table public.users from public, anon, authenticated',
      v_column.attname
    );
  end loop;
end
$$;

-- Drop any policy that could reopen public.users to PUBLIC/anon/authenticated.
-- Custom-role-only policies are left untouched.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select p.policyname
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'users'
      and (
        p.roles is null
        or cardinality(p.roles) = 0
        or 'public' = any (p.roles)
        or 'anon' = any (p.roles)
        or 'authenticated' = any (p.roles)
      )
  loop
    execute format(
      'drop policy if exists %I on public.users',
      v_policy.policyname
    );
  end loop;
end
$$;

-- The private backend uses service_role (BYPASSRLS). Keep CRUD explicit in case
-- default privileges or prior column grants are incomplete.
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.users to service_role;

-- Re-create our own service policy idempotently. Existing service-role-only
-- policies (for example t009_service_role_all) are preserved.
drop policy if exists t053_users_service_role_all on public.users;
create policy t053_users_service_role_all on public.users
  for all
  to service_role
  using (true)
  with check (true);

-- Grant the actual sequence behind users.UserID, whichever name it has. The
-- pg_depend fallback covers legacy nextval defaults without OWNED BY.
do $$
declare
  v_sequence text;
begin
  select pg_get_serial_sequence('public.users', 'UserID')
    into v_sequence;

  if v_sequence is null then
    select c.oid::regclass::text
      into v_sequence
    from pg_attrdef d
    join pg_depend dep
      on dep.classid = 'pg_attrdef'::regclass
     and dep.objid = d.oid
     and dep.refclassid = 'pg_class'::regclass
    join pg_class c
      on c.oid = dep.refobjid
     and c.relkind = 'S'
    where d.adrelid = 'public.users'::regclass
      and d.adnum = (
        select a.attnum
        from pg_attribute a
        where a.attrelid = 'public.users'::regclass
          and a.attname = 'UserID'
          and not a.attisdropped
      )
    limit 1;
  end if;

  if v_sequence is not null then
    execute format(
      'revoke all privileges on sequence %s from public, anon, authenticated',
      v_sequence
    );
    execute format(
      'grant usage, select on sequence %s to service_role',
      v_sequence
    );
  end if;
end
$$;

-- Refresh PostgREST's schema/privilege cache when the API is running.
notify pgrst, 'reload schema';

commit;

-- T-025 privacy hardening for the six health tables.
--
-- WARNING: authored in an isolated worktree and applied ONLY to a disposable
-- local PostgreSQL engine during validation. NEVER apply this to the remote
-- Supabase project from this task.
--
-- Purpose: the publishable/anon credential could count and read every row in
-- the health tables. M3 protected public.users/PasswordHash; this migration
-- closes the direct REST path for health data as well, so a browser/anon key
-- cannot bypass the dashboard's user-scoped API.
--
-- It preserves tables, columns, rows and encrypted values. It does not add an
-- ingestion API. External ingestion clients that rely on anon
-- (for example pi-mqtt-agent or Uploader) will stop working until they receive
-- a separately reviewed identity/policy. Those clients and their code are out
-- of scope and must not be modified here.
--
-- Idempotent by construction: REVOKE/GRANT/ALTER ... ENABLE RLS are repeatable,
-- policies are dropped with IF EXISTS and recreated, and loops touch only the
-- six verified tables.
--
-- The backend uses service_role (BYPASSRLS) and the T-009 RPCs are SECURITY
-- DEFINER; both keep working. No permissive policy is left for PUBLIC/anon/
-- authenticated.

begin;

set local search_path = pg_catalog, public, pg_temp;

grant usage on schema public to service_role;

-- Keep the private backend's user CRUD explicit as well; M3 already covers
-- PasswordHash reads, this covers inserts/updates/clears/deletes.
grant select, insert, update, delete on table public.users to service_role;

do $$
declare
  v_table text;
  v_column record;
  v_policy record;
  v_sequence text;
begin
  foreach v_table in array array[
    'insulindata',
    'fooddata',
    'exercisedata',
    'periodrecords',
    'mooddata',
    'polar_data'
  ]
  loop
    -- Table-level privileges (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/...).
    execute format(
      'revoke all privileges on table public.%I from public, anon, authenticated',
      v_table
    );

    -- Column-level grants are separate from table grants; revoke every column
    -- privilege that can be used directly through PostgREST.
    for v_column in
      select a.attname
      from pg_attribute a
      where a.attrelid = format('public.%I', v_table)::regclass
        and a.attnum > 0
        and not a.attisdropped
    loop
      execute format(
        'revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on table public.%2$I from public, anon, authenticated',
        v_column.attname,
        v_table
      );
    end loop;

    -- Remove any existing policy that would reopen access to PUBLIC/anon/
    -- authenticated. Policies for separately reviewed custom roles are kept.
    for v_policy in
      select p.policyname
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = v_table
        and (
          p.roles is null
          or cardinality(p.roles) = 0
          or 'public' = any (p.roles)
          or 'anon' = any (p.roles)
          or 'authenticated' = any (p.roles)
        )
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        v_policy.policyname,
        v_table
      );
    end loop;

    execute format(
      'alter table public.%I enable row level security',
      v_table
    );

    -- Explicit private-backend access. service_role normally bypasses RLS; the
    -- policy is a second line of defense if that attribute ever changes.
    execute format(
      'grant all privileges on table public.%I to service_role',
      v_table
    );
    execute format(
      'drop policy if exists %I on public.%I',
      't025_service_role_all',
      v_table
    );
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      't025_service_role_all',
      v_table
    );

    -- Preserve/grant real sequences if a health table ever uses identity/serial.
    v_sequence := pg_get_serial_sequence(format('public.%I', v_table), 'id');
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
  end loop;
end
$$;

-- Ask PostgREST to refresh its schema/privilege cache when present.
notify pgrst, 'reload schema';

commit;

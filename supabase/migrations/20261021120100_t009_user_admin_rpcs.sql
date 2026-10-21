-- T-009 transactional admin functions.
-- WARNING: authored in an isolated worktree and NOT applied remotely.
--
-- These functions are the only supported path for username renames and user
-- deletes. They lock the health tables in SHARE ROW EXCLUSIVE mode, verify the
-- real FKs from migration 1, and perform the mutation in one transaction.
-- Execute is restricted to service_role.

begin;

create or replace function public.t009_assert_username_fks_ready()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table text;
  v_exists boolean;
  v_bad boolean;
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
    select exists (
      select 1
      from pg_constraint c
      join pg_class src on src.oid = c.conrelid
      join pg_namespace n on n.oid = src.relnamespace
      where n.nspname = 'public'
        and src.relname = v_table
        and c.contype = 'f'
        and c.confrelid = 'public.users'::regclass
        and c.conkey = array[
          (select a.attnum
           from pg_attribute a
           where a.attrelid = src.oid
             and a.attname = 'username'
             and not a.attisdropped)
        ]
        and c.confkey = array[
          (select a.attnum
           from pg_attribute a
           where a.attrelid = 'public.users'::regclass
             and a.attname = 'Username'
             and not a.attisdropped)
        ]
    ) into v_exists;

    if not v_exists then
      raise exception using
        errcode = 'P0001',
        message = 'PERSISTENCE_MIGRATION_REQUIRED';
    end if;

    select exists (
      select 1
      from pg_constraint c
      join pg_class src on src.oid = c.conrelid
      join pg_namespace n on n.oid = src.relnamespace
      where n.nspname = 'public'
        and src.relname = v_table
        and c.contype = 'f'
        and c.confrelid = 'public.users'::regclass
        and c.conkey = array[
          (select a.attnum
           from pg_attribute a
           where a.attrelid = src.oid
             and a.attname = 'username'
             and not a.attisdropped)
        ]
        and c.confkey = array[
          (select a.attnum
           from pg_attribute a
           where a.attrelid = 'public.users'::regclass
             and a.attname = 'Username'
             and not a.attisdropped)
        ]
        and c.confupdtype <> 'c'
    ) into v_bad;

    if v_bad then
      raise exception using
        errcode = 'P0001',
        message = 'PERSISTENCE_MIGRATION_REQUIRED';
    end if;
  end loop;
end;
$$;

create or replace function public.t009_update_user(
  p_user_id bigint,
  p_username text default null,
  p_role text default null,
  p_gdpr_consent boolean default null
)
returns table (
  "UserID" integer,
  "Username" character varying,
  "UUID" character varying,
  "GDPRConsent" boolean,
  "GDPRConsentDate" timestamp without time zone,
  role text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_username text;
  v_new_username text;
  v_current_role text;
  v_current_gdpr boolean;
  v_current_date timestamp without time zone;
begin
  if p_role is not null and p_role not in ('admin', 'doctor', 'user') then
    raise exception using errcode = '22023', message = 'INVALID_ROLE';
  end if;

  v_new_username := nullif(btrim(p_username), '');
  if p_username is not null and v_new_username is null then
    raise exception using errcode = '22023', message = 'INVALID_USERNAME';
  end if;
  if v_new_username is not null and char_length(v_new_username) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_USERNAME';
  end if;

  -- Lock health writers before touching the user row. This is the same order
  -- used by t009_delete_user, avoiding lock-order inversion.
  lock table public.insulindata, public.fooddata, public.exercisedata,
             public.periodrecords, public.mooddata, public.polar_data
    in share row exclusive mode;

  perform public.t009_assert_username_fks_ready();

  select u."Username", u.role, u."GDPRConsent", u."GDPRConsentDate"
    into v_old_username, v_current_role, v_current_gdpr, v_current_date
  from public.users u
  where u."UserID" = p_user_id
  for update;

  if not found then
    return;
  end if;

  if v_new_username is not null and v_new_username <> v_old_username then
    -- Qualify UserID/Username: RETURNS TABLE exposes output parameters with the
    -- same names and unqualified references are ambiguous in PL/pgSQL.
    update public.users as u
      set "Username" = v_new_username
      where u."UserID" = p_user_id;

    -- With the cascade FK these are no-ops. The helper above refuses to run if
    -- the real FK is missing, so new writes cannot bypass the rename window.
    update public.insulindata as d set username = v_new_username where d.username = v_old_username;
    update public.fooddata as d set username = v_new_username where d.username = v_old_username;
    update public.exercisedata as d set username = v_new_username where d.username = v_old_username;
    update public.periodrecords as d set username = v_new_username where d.username = v_old_username;
    update public.mooddata as d set username = v_new_username where d.username = v_old_username;
    update public.polar_data as d set username = v_new_username where d.username = v_old_username;
  end if;

  if p_role is not null and p_role <> v_current_role then
    update public.users as u
      set role = p_role
      where u."UserID" = p_user_id;
  end if;

  if p_gdpr_consent is not null
     and (
       p_gdpr_consent is distinct from v_current_gdpr
       or (p_gdpr_consent and v_current_date is null)
       or (not p_gdpr_consent and v_current_date is not null)
     ) then
    update public.users as u
      set "GDPRConsent" = p_gdpr_consent,
          "GDPRConsentDate" = case
            when p_gdpr_consent then (now() at time zone 'UTC')
            else null
          end
      where u."UserID" = p_user_id;
  end if;

  return query
    select u."UserID", u."Username", u."UUID", u."GDPRConsent",
           u."GDPRConsentDate", u.role
    from public.users u
    where u."UserID" = p_user_id;
end;
$$;

create or replace function public.t009_delete_user(p_user_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text;
  v_has_data boolean;
  v_deleted integer;
begin
  lock table public.insulindata, public.fooddata, public.exercisedata,
             public.periodrecords, public.mooddata, public.polar_data
    in share row exclusive mode;

  perform public.t009_assert_username_fks_ready();

  select u."Username"
    into v_username
  from public.users u
  where u."UserID" = p_user_id
  for update;

  if not found then
    return false;
  end if;

  select
    exists (select 1 from public.insulindata where username = v_username)
    or exists (select 1 from public.fooddata where username = v_username)
    or exists (select 1 from public.exercisedata where username = v_username)
    or exists (select 1 from public.periodrecords where username = v_username)
    or exists (select 1 from public.mooddata where username = v_username)
    or exists (select 1 from public.polar_data where username = v_username)
    into v_has_data;

  if v_has_data then
    raise exception using errcode = 'P0001', message = 'USER_HAS_DATA';
  end if;

  delete from public.users as u where u."UserID" = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

create or replace function public.t009_user_has_health_data(p_user_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    where u."UserID" = p_user_id
      and (
        exists (select 1 from public.insulindata d where d.username = u."Username")
        or exists (select 1 from public.fooddata d where d.username = u."Username")
        or exists (select 1 from public.exercisedata d where d.username = u."Username")
        or exists (select 1 from public.periodrecords d where d.username = u."Username")
        or exists (select 1 from public.mooddata d where d.username = u."Username")
        or exists (select 1 from public.polar_data d where d.username = u."Username")
      )
  );
$$;

-- Functions are security definer; only service_role may execute them.
revoke all on function public.t009_assert_username_fks_ready() from public, anon, authenticated;
revoke all on function public.t009_update_user(bigint, text, text, boolean) from public, anon, authenticated;
revoke all on function public.t009_delete_user(bigint) from public, anon, authenticated;
revoke all on function public.t009_user_has_health_data(bigint) from public, anon, authenticated;

grant execute on function public.t009_assert_username_fks_ready() to service_role;
grant execute on function public.t009_update_user(bigint, text, text, boolean) to service_role;
grant execute on function public.t009_delete_user(bigint) to service_role;
grant execute on function public.t009_user_has_health_data(bigint) to service_role;

commit;

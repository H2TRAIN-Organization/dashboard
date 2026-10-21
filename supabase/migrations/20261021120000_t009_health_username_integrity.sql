-- T-009 persistence hardening.
-- WARNING: this migration was authored in an isolated worktree and was NOT
-- applied to the remote Supabase project. Review it against staging before use.
--
-- Verified schema facts used here (PostgREST OpenAPI, public schema):
--   users.UserID       integer primary key
--   users.Username     varchar(100)
--   health tables      id integer primary key, username text/varchar
-- FK/unique/RLS details were NOT verified remotely. This migration adds the
-- constraints and reports preflight failures instead of assuming them.

begin;

-- Fail with a count (never values) if duplicate usernames would make the
-- unique index impossible.
do $$
declare
  duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select "Username"
    from public.users
    where "Username" is not null
    group by "Username"
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'T009_PREFLIGHT: %s duplicate Username values in public.users; resolve them before applying this migration',
        duplicate_count
      );
  end if;
end
$$;

create unique index if not exists users_username_key
  on public.users ("Username");

-- Use the real sequence/identity. Runtime code never computes max+1; if the
-- legacy table has no default, initialize one once from the current maximum.
do $$
declare
  v_identity text;
  v_has_default boolean;
  v_default_expression text;
  v_sequence text;
begin
  select a.attidentity::text, a.atthasdef,
         pg_get_expr(d.adbin, d.adrelid)
    into v_identity, v_has_default, v_default_expression
  from pg_attribute a
  left join pg_attrdef d
    on d.adrelid = a.attrelid
   and d.adnum = a.attnum
  where a.attrelid = 'public.users'::regclass
    and a.attname = 'UserID'
    and not a.attisdropped;

  if v_identity is not null and v_identity <> '' then
    return; -- identity column: INSERT without UserID is correct
  end if;

  if coalesce(v_has_default, false) then
    if v_default_expression is null
       or position('nextval' in v_default_expression) = 0 then
      raise exception using
        errcode = 'P0001',
        message = 'T009_PREFLIGHT: users.UserID has a default that is not a sequence; resolve it before applying this migration';
    end if;
    return; -- existing sequence default: INSERT without UserID is correct
  end if;

  select pg_get_serial_sequence('public.users', 'UserID') into v_sequence;
  if v_sequence is null then
    create sequence if not exists public.users_userid_seq;
    -- Two-part schema-qualified name. A schema.table.sequence combination is a
    -- three-part relation reference and fails with 0A000.
    v_sequence := 'public.users_userid_seq';
  end if;

  execute format(
    'alter table public.users alter column "UserID" set default nextval(%L::regclass)',
    v_sequence
  );
  execute format(
    'select setval(%L::regclass, coalesce((select max("UserID") from public.users), 0) + 1, false)',
    v_sequence
  );
  -- Attach ownership so pg_get_serial_sequence and normal serial semantics work.
  execute format(
    'alter sequence %s owned by public.users."UserID"',
    v_sequence
  );
end
$$;

-- Grant on the real sequence, whether it was pre-existing, created above, or
-- belongs to an identity column. Do not rely on Supabase default privileges.
-- pg_depend covers legacy defaults that use nextval() without OWNED BY.
do $$
declare
  v_sequence text;
begin
  select pg_get_serial_sequence('public.users', 'UserID') into v_sequence;

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
      'grant usage, select on sequence %s to service_role',
      v_sequence
    );
  end if;
end
$$;

-- Add real FK protection for every health table. NOT VALID avoids a long scan
-- and tolerates legacy orphan rows, while new inserts/updates are enforced
-- immediately. Validate after cleaning any existing orphans:
--   alter table public.<table> validate constraint <table>_username_fkey;
do $$
declare
  v_table text;
  v_constraint record;
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
    for v_constraint in
      select c.conname
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
    loop
      execute format(
        'alter table public.%I drop constraint %I',
        v_table,
        v_constraint.conname
      );
    end loop;

    execute format(
      'alter table public.%I drop constraint if exists %I',
      v_table,
      v_table || '_username_fkey'
    );
    execute format(
      'alter table public.%I add constraint %I foreign key (username) references public.users ("Username") on update cascade on delete restrict not valid',
      v_table,
      v_table || '_username_fkey'
    );
    execute format(
      'create index if not exists %I on public.%I (username)',
      v_table || '_username_idx',
      v_table
    );
  end loop;
end
$$;

commit;

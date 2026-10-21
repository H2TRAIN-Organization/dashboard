-- T-014/T-034 SQL validation fixture.
-- SYNTHETIC schema generated from the sanitized schema snapshot
-- (tests/sql/fixtures/schema-metadata.json). No host, keys, counts, production
-- data, real credentials or PII.
--
-- What is verified by the snapshot:
--   * table names, column names, column types/formats, max lengths,
--     nullability (OpenAPI "required"), defaults and observed PK notes.
-- What is NOT verified (do not claim remote parity):
--   * actual FK/unique/check constraints, RLS state, policies, grants,
--     sequences/identity attributes and default privileges.
-- PK columns follow the metadata's observed <pk/> note only. No SQL type or
-- format for FKs is inferred from PK metadata; FKs are added by migrations and
-- all grants/RLS/policies/sequences in this fixture are local test-only setup.
-- The fixture starts in a deliberately "legacy + wide grants" state so the
-- T-009/T-025 migrations must establish the protections themselves.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Minimal Supabase auth schema. The T-009 SQL under test does not call these
-- helpers, but a real Supabase database always exposes them.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.uid()
returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role()
returns text language sql stable as $$ select null::text $$;
create or replace function auth.email()
returns text language sql stable as $$ select null::text $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant execute on function auth.email() to anon, authenticated, service_role;

-- public.users: exact metadata columns. No unique Username and no UserID
-- default on purpose (migration 1 must provide them).
create table public.users (
  "UserID" integer primary key,
  "Username" character varying(100) not null,
  "PasswordHash" character varying(255) not null,
  "UUID" character varying(255),
  "GDPRConsent" boolean default false,
  "GDPRConsentDate" timestamp without time zone,
  "sexo" character varying(10),
  "bomba_insulina" boolean default false,
  "role" text default 'user'
);

create table public.insulindata (
  id integer primary key,
  username character varying(100),
  "insulinType" character varying(100),
  dose text,
  date_time timestamp without time zone,
  "actualDateTime" timestamp without time zone,
  iv text,
  insulintype_iv text,
  dose_iv text
);

create table public.fooddata (
  id integer primary key,
  username character varying(100) not null,
  food_type character varying(50) not null,
  quantity text not null,
  carbs text not null,
  date_time timestamp without time zone not null,
  iv text,
  food_type_iv text,
  quantity_iv text,
  carbs_iv text
);

create table public.exercisedata (
  id integer primary key,
  username character varying(100) not null,
  exercise_type character varying(50) not null,
  intensity smallint not null,
  exercise_start_time timestamp without time zone not null,
  exercise_end_time timestamp without time zone not null,
  exercise_description text,
  date_time timestamp without time zone not null,
  iv text,
  exercise_type_iv text,
  exercise_description_iv text
);

create table public.periodrecords (
  id integer primary key,
  username character varying(255) not null,
  "startDate" timestamp without time zone not null,
  "endDate" timestamp without time zone,
  intensity text,
  symptoms text[],
  notes text,
  date_time timestamp without time zone default now(),
  iv text,
  intensity_iv text,
  symptoms_iv text[],
  notes_iv text
);

create table public.mooddata (
  id integer primary key,
  username text not null,
  mood_value integer not null,
  out_of_routine boolean not null,
  routine_description text,
  emotions text[] not null,
  other_emotion text,
  date_time timestamp with time zone default now(),
  iv text,
  routine_description_iv text,
  emotions_iv text[],
  other_emotion_iv text
);

create table public.polar_data (
  id integer primary key,
  username text not null,
  "timestamp" timestamp with time zone not null,
  heart_rate integer not null,
  rri_data jsonb,
  device_id text default 'polar_h10',
  data_type text default 'heart_rate_reading',
  created_at timestamp with time zone default now()
);

-- Deliberately permissive legacy grants (Supabase-style public schema grants).
-- The migrations under test must revoke the PasswordHash projection.
grant all on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;

-- No default privileges for future sequences/objects: this makes the harness
-- able to detect migration-created objects that are not explicitly granted.

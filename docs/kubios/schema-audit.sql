-- Auditoria de SOLO LECTURA: no devuelve registros de usuarios ni datos clinicos.
-- Ejecutar en el SQL Editor del proyecto utilizado por el dashboard antes de
-- aplicar las migraciones Kubios. Todas las sentencias son SELECT.

select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where (table_schema = 'public' and table_name in
  ('users', 'insulindata', 'fooddata', 'exercisedata', 'periodrecords', 'mooddata'))
   or table_schema = 'kubios_private'
order by table_schema, table_name, ordinal_position;

select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and ((n.nspname = 'public' and c.relname in
    ('users', 'insulindata', 'fooddata', 'exercisedata', 'periodrecords', 'mooddata'))
    or n.nspname = 'kubios_private')
order by schema_name, table_name;

select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  and ((table_schema = 'public' and table_name in
    ('users', 'insulindata', 'fooddata', 'exercisedata', 'periodrecords', 'mooddata'))
    or table_schema = 'kubios_private')
order by table_schema, table_name, grantee, privilege_type;

select table_schema, table_name, column_name, grantee, privilege_type
from information_schema.role_column_grants
where grantee in ('PUBLIC', 'anon', 'authenticated')
  and ((table_schema = 'public' and table_name in
    ('users', 'insulindata', 'fooddata', 'exercisedata', 'periodrecords', 'mooddata'))
    or table_schema = 'kubios_private')
order by table_schema, table_name, column_name, grantee, privilege_type;

select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where (schemaname = 'public' and tablename in
  ('users', 'insulindata', 'fooddata', 'exercisedata', 'periodrecords', 'mooddata'))
  or schemaname = 'kubios_private'
order by schemaname, tablename, policyname;

select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'kubios\_%' escape '\'
order by function_name, arguments;

select extname, extversion from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault')
order by extname;

select to_regclass('cron.job') is not null as cron_catalog_available,
       to_regclass('vault.decrypted_secrets') is not null as vault_available;

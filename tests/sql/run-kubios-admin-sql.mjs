// Local isolated PostgreSQL only: synthetic users, no exposed port, volume or remote access.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const container = `dashboard-kubios-admin-validation-${process.pid}`
const root = new URL('../../', import.meta.url)
function command(args, input) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...(input ? { input } : {}) })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Docker failed')
  return result.stdout.trim()
}
const sql = text => command(['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'], text)
let created = false
try {
  command(['run','--detach','--rm','--network','none','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine']); created = true
  let ready = false
  for (let i=0;i<40;i++) {
    if (spawnSync('docker',['exec',container,'pg_isready','-U','postgres'],{encoding:'utf8'}).status === 0) {ready=true;break}
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  assert(ready)
  sql(`create role anon; create role authenticated; create role authenticator; create role service_role bypassrls;
    create table public.users("UserID" integer primary key,"Username" text not null,"PasswordHash" text);
    insert into public.users select n,'synthetic-'||n,'never-exported' from generate_series(1,205) n;`)
  sql(readFileSync(new URL('supabase/migrations/20261103100413_kubios_production_core.sql',root),'utf8'))
  const migration=readFileSync(new URL('supabase/migrations/20261104120000_kubios_admin_read.sql',root),'utf8')
  sql(migration);sql(migration)
  sql(`insert into kubios_private.user_member_links(user_id,team_id,kubios_member_id)
    select n,'11111111-1111-4111-8111-111111111111'::uuid,md5(n::text)::uuid from generate_series(1,205) n;`)
  assert.equal(sql(`set role service_role; select count(*) from public.kubios_admin_list_links(0,100);`),'SET\n100')
  assert.equal(sql(`set role service_role; select min(user_id)||'|'||max(user_id)||'|'||count(*) from public.kubios_admin_list_links(100,100);`),'SET\n101|200|100')
  assert.equal(sql(`set role service_role; select count(*) from public.kubios_admin_list_links(200,100);`),'SET\n5')
  assert.equal(sql(`set role service_role; select user_id||'|'||username from public.kubios_admin_list_links(204,1);`),'SET\n205|synthetic-205')
  assert.equal(sql(`set role service_role; select count(*) from public.kubios_admin_list_links(0,100000);`),'SET\n100')
  assert.equal(sql(`select has_function_privilege('anon','public.kubios_admin_list_links(integer,integer)','execute')`),'f')
  assert.equal(sql(`select has_function_privilege('authenticated','public.kubios_admin_list_links(integer,integer)','execute')`),'f')
  assert.equal(sql(`select has_column_privilege('service_role','public.users','PasswordHash','select')`),'f')
  assert.equal(sql(`set role service_role; select public.kubios_admin_page_links('SYNTHETIC-',200,100)->>'total';`),'SET\n205')
  assert.equal(sql(`set role service_role; select jsonb_array_length(public.kubios_admin_page_links('SYNTHETIC-',200,100)->'links');`),'SET\n5')
  assert.equal(sql(`set role service_role; select public.kubios_admin_page_links('does-not-exist',0,25)->>'total';`),'SET\n0')
  assert.equal(sql(`set role service_role; select user_id||'|'||username from public.kubios_admin_get_link(42);`),'SET\n42|synthetic-42')
  assert.equal(sql(`select has_function_privilege('anon','public.kubios_admin_page_links(text,integer,integer)','execute')`),'f')
  assert.equal(sql(`select has_function_privilege('authenticated','public.kubios_admin_get_link(integer)','execute')`),'f')
  assert.throws(()=>sql(`set role anon; select * from public.kubios_admin_list_links(0,100);`),/permission denied/)
  console.log('PASS: migration twice, real keyset pagination 205 users, username join, bounded page, service-only RPC, credential column denied.')
} finally { if (created) command(['rm','--force',container]) }

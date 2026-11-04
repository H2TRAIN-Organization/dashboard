// Real PostgreSQL 16, isolated synthetic container; no ports, volumes or network.
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const container = `dashboard-privacy-validation-${process.pid}`
const root = new URL('../../../', import.meta.url)
const migration = readFileSync(new URL('supabase/migrations/20261104121000_session_privacy.sql', root), 'utf8')
const version = '2026-11-04-draft-1'
const hash = '279bdc6c40df59a0224017a4e3ad012b2fe042bf0ef562da3206f296f26ae64c'
const sid = 'synthetic-privacy-sid'
function command(args, input) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...(input ? { input } : {}) })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Docker failed')
  return result.stdout.trim()
}
function sql(text) { return command(['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], text) }
function rpc(surface, decision, requestId, extra = '') {
  return `select * from public.auth_privacy_decide('${sid}',42,'${version}','${hash}','${surface}','${decision}','es','${requestId}');${extra}`
}
const ids = Array.from({ length: 9 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`)
function expectSqlError(text, fragment) {
  assert.throws(() => sql(text), (error) => String(error).includes(fragment))
}
async function concurrentSql(text) {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'])
    let stdout = '', stderr = ''
    proc.stdout.on('data', (data) => { stdout += data })
    proc.stderr.on('data', (data) => { stderr += data })
    proc.on('error', reject)
    proc.on('close', (status) => resolve({ status, stdout, stderr }))
    proc.stdin.end(text)
  })
}

let created = false
try {
  command(['run', '--detach', '--rm', '--network', 'none', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine'])
  created = true
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' })
    if (result.status === 0) { ready = true; break }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(ready, 'Isolated PostgreSQL ready')
  sql(`create role anon; create role authenticated; create role service_role;
    create table public.users("UserID" integer primary key, "GDPRConsent" boolean default true);
    insert into public.users values(42,true);
    create table public.auth_sessions(sid_hash text primary key,user_id integer,expires_at timestamptz,revoked_at timestamptz);
    insert into public.auth_sessions values('${sid}',42,now()+interval '1 day',null),('other-session',42,now()+interval '1 day',null);`)
  sql(migration)
  sql(migration) // migration is idempotent
  expectSqlError(rpc('banner', 'accept', ids[0]), 'out of order')
  assert.equal(sql(rpc('login', 'accept', ids[0])), '1|f')
  assert.equal(sql(rpc('login', 'accept', ids[0])), '1|f')
  assert.equal(sql('select count(*) from public.auth_privacy_decisions'), '1')
  assert.equal(sql(rpc('login', 'accept', ids[5])), '1|f')
  expectSqlError(rpc('login', 'reject', ids[0]), 'Idempotency key reused')
  assert.equal(sql(rpc('banner', 'accept', ids[1])), '2|f')
  assert.equal(sql(`select "GDPRConsent" from public.users where "UserID"=42`), 't')
  expectSqlError(rpc('login', 'accept', ids[2]).replace(version, 'obsolete'), 'policy version')
  // New policy version cannot inherit complete: emulate a legacy session version.
  sql(`update public.auth_sessions set privacy_version='old'`)
  expectSqlError(rpc('banner', 'accept', ids[2]), 'out of order')
  assert.equal(sql(rpc('login', 'accept', ids[2])), '1|f')
  // Transaction rollback must roll back both the rejection record and revocation.
  sql(`begin;${rpc('banner', 'reject', ids[3])}rollback;`)
  assert.equal(sql(`select revoked_at is null from public.auth_sessions where sid_hash='${sid}'`), 't')
  assert.equal(sql(`select count(*) from public.auth_privacy_decisions where request_id='${ids[3]}'`), '0')
  // Lock the rejection before releasing the competing accept. Both calls are real.
  const reject = concurrentSql(`begin;${rpc('banner', 'reject', ids[3])} select pg_sleep(0.6); commit;`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const accept = concurrentSql(rpc('banner', 'accept', ids[4]))
  const [rejected, accepted] = await Promise.all([reject, accept])
  assert.equal(rejected.status, 0)
  assert.notEqual(accepted.status, 0)
  assert.match(accepted.stderr, /revoked/)
  assert.equal(sql(`select revoked_at is not null from public.auth_sessions where sid_hash='${sid}'`), 't')
  assert.equal(sql(rpc('banner', 'reject', ids[3])), '1|t')
  expectSqlError(rpc('login', 'accept', ids[0]), 'revoked')
  expectSqlError(rpc('banner', 'accept', ids[6]), 'revoked')
  assert.equal(sql(`select revoked_at is null and privacy_stage=0 from public.auth_sessions where sid_hash='other-session'`), 't')
  assert.equal(sql(`select count(*) from public.auth_privacy_decisions where decision='reject' and user_id=42 and policy_version='${version}' and policy_hash='${hash}' and surface='banner' and language='es' and decided_at between now()-interval '1 minute' and now()`), '1')
  assert.equal(sql(`select "GDPRConsent" from public.users where "UserID"=42`), 't')
  assert.equal(sql(`select has_function_privilege('anon','public.auth_privacy_decide(text,integer,text,text,text,text,text,uuid)','execute')`), 'f')
  assert.equal(sql(`select has_table_privilege('authenticated','public.auth_privacy_decisions','select')`), 'f')
  console.log('PASS: migration twice; stage order; idempotency; key conflict; stale version; rollback; concurrent terminal reject; consent unchanged; private grants.')
} finally {
  if (created) command(['rm', '--force', container])
}

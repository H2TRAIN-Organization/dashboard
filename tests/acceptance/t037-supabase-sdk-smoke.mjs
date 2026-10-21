import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const baseUrl = process.env.STANDIN_SUPABASE_URL ?? 'http://127.0.0.1:4900/supabase'
const publishable = 'sb_publishable_synthetic'
const serviceRole = makeJwt({ role: 'service_role', ref: 'synthetic', iss: 'supabase' })
const users = createClient(baseUrl, publishable, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const admin = createClient(baseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function makeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.synthetic`
}

async function reset() {
  const response = await fetch(`${baseUrl}/__reset`, { method: 'POST' })
  assert.equal(response.status, 204)
}

await reset()

const login = await users.auth.signInWithPassword({
  email: 'admin.acceptance@example.test',
  password: 'Acceptance-Admin-1!',
})
assert.equal(login.error, null)
assert.ok(login.data.session?.access_token)
assert.equal(login.data.user?.app_metadata?.role, 'admin')
assert.equal(login.data.user?.app_metadata?.app_user_id, '1')

const verified = await users.auth.getUser(login.data.session.access_token)
assert.equal(verified.error, null)
assert.equal(verified.data.user?.id, login.data.user?.id)

const credential = await users
  .from('users')
  .select('UserID,Username,PasswordHash,role')
  .eq('Username', 'admin.acceptance@example.test')
  .limit(2)
assert.equal(credential.error, null)
assert.equal(credential.data?.length, 1)
assert.equal(credential.data[0].UserID, 1)

const count = await admin.from('users').select('*', { count: 'exact', head: true })
assert.equal(count.error, null)
assert.equal(count.count, 3)

const created = await admin
  .from('users')
  .insert({
    Username: 'sdk.smoke',
    PasswordHash: '$2b$10$' + 'x'.repeat(53),
    role: 'user',
    GDPRConsent: false,
    GDPRConsentDate: null,
  })
  .select('UserID,Username,role')
  .single()
assert.equal(created.error, null)
assert.equal(created.data.Username, 'sdk.smoke')
const newId = created.data.UserID

const updated = await admin
  .from('users')
  .update({ role: 'doctor' })
  .match({ UserID: newId })
  .select('UserID,Username,role')
assert.equal(updated.error, null)
assert.equal(updated.data[0].role, 'doctor')

const hasData = await admin.rpc('t009_user_has_health_data', { p_user_id: newId })
assert.equal(hasData.error, null)
assert.equal(hasData.data, false)

const renamed = await admin.rpc('t009_update_user', {
  p_user_id: newId,
  p_username: 'sdk.smoke.renamed',
  p_role: 'user',
  p_gdpr_consent: true,
})
assert.equal(renamed.error, null)
assert.equal(Array.isArray(renamed.data), true)
assert.equal(renamed.data[0].Username, 'sdk.smoke.renamed')

const deleted = await admin.rpc('t009_delete_user', { p_user_id: newId })
assert.equal(deleted.error, null)
assert.equal(deleted.data, true)

const session = await admin.rpc('auth_login_consume', {
  p_key_hash: 'f'.repeat(64),
  p_window_seconds: 900,
  p_max_attempts: 10,
  p_block_seconds: 900,
})
assert.equal(session.error, null)
assert.equal(Array.isArray(session.data), true)
assert.equal(session.data[0].allowed, true)

const resetLimit = await admin.rpc('auth_login_reset', { p_key_hash: 'f'.repeat(64) })
assert.equal(resetLimit.error, null)

await reset()
console.log('T037 SDK smoke PASS: auth, select, count, insert, update, t009 RPC, auth_login RPC')

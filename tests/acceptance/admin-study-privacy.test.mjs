import assert from 'node:assert/strict'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { before, describe, test } from 'node:test'
import { enabled, request, loginEmail, loginUsername, logout } from './support/http.mjs'
import { admin, bcryptUser } from './support/fixtures.mjs'

const suite = enabled && process.env.ACCEPTANCE_RESET_URL ? describe : describe.skip
const rawAdmin = () => request('/api/auth/login', { method: 'POST', body: admin })
const decide = (login, surface, decision = 'accept', extra = {}) => request('/api/privacy/decision', {
  method: 'POST', cookie: login.cookie,
  body: { policyVersion: login.body.privacy.policyVersion, language: 'es', requestId: crypto.randomUUID(), surface, decision, ...extra },
})

suite('Administration, Study and Privacy: real backend / synthetic dependency', () => {
  before(async () => {
    const reset = new URL(process.env.ACCEPTANCE_RESET_URL)
    assert.ok(['localhost', '127.0.0.1'].includes(reset.hostname))
    assert.equal((await fetch(reset, { method: 'POST' })).status, 204)
  })

  test('all private routes block a new session until the first notice', async () => {
    const login = await rawAdmin()
    assert.equal(login.status, 200)
    assert.equal(login.body.privacy.state, 'initial')
    for (const path of ['/api/users', '/api/decrypted-data', '/api/admin/database/tables', '/api/kubios/me', '/api/kubios/hrv-results', '/api/kubios/export', '/api/admin/kubios/participants', '/api/study']) {
      const blocked = await request(path, { cookie: login.cookie })
      assert.equal(blocked.status, 403, path)
      assert.equal(blocked.body.error.code, 'PRIVACY_ACTION_REQUIRED', path)
      assert.match(blocked.headers.get('cache-control'), /private.*no-store/)
    }
    assert.equal((await request('/privacy')).status, 200)
    assert.equal((await decide(login, 'login', 'accept', { policyVersion: 'obsolete' })).status, 409)
    const first = await decide(login, 'login')
    assert.equal(first.status, 200)
    assert.equal(first.body.state, 'complete')
    assert.equal((await request('/api/users', { cookie: login.cookie })).status, 200)
    const requestId = crypto.randomUUID()
    assert.equal((await decide(login, 'login', 'accept', { requestId })).status, 200)
    assert.equal((await decide(login, 'login', 'accept', { requestId })).status, 200)
    const restored = await request('/api/auth/session', { cookie: login.cookie })
    assert.equal(restored.body.privacy.state, 'complete')
    assert.equal(restored.body.user.gdprConsent, login.body.user.gdprConsent)
  })

  test('the acceptance persists per user: the next login is never asked again', async () => {
    const next = await rawAdmin()
    assert.equal(next.status, 200)
    assert.equal(next.body.privacy.state, 'complete')
    assert.equal((await request('/api/users', { cookie: next.cookie })).status, 200)
    assert.equal(next.body.user.gdprConsent, (await request('/api/auth/session', { cookie: next.cookie })).body.user.gdprConsent)
  })

  test('rejection revokes the session and the next login is asked again', async () => {
    const login = await rawAdmin()
    assert.equal(login.body.privacy.state, 'complete')
    const rejection = await decide(login, 'login', 'reject')
    assert.equal(rejection.status, 200)
    assert.equal(rejection.body.rejected, true)
    assert.match(rejection.headers.get('set-cookie'), /Max-Age=0/i)
    assert.equal((await request('/api/auth/session', { cookie: login.cookie })).status, 401)
    assert.equal((await request('/api/decrypted-data', { cookie: login.cookie })).status, 401)
    // The rejection removed the per-user acknowledgement (MT49): the fresh
    // session starts at the notice instead of skipping it.
    const next = await rawAdmin()
    assert.equal(next.body.privacy.state, 'initial')
    assert.equal((await request('/api/users', { cookie: next.cookie })).status, 403)
    assert.equal((await request('/api/users', { cookie: next.cookie })).body.error.code, 'PRIVACY_ACTION_REQUIRED')
    // Accepting again restores the per-user acknowledgement and the access.
    assert.equal((await decide(next, 'login')).body.state, 'complete')
    assert.equal((await request('/api/users', { cookie: next.cookie })).status, 200)
    await logout(next.cookie)
  })

  test('admin without a personal link reads participant Kubios and Study; regular actor is denied', async () => {
    const login = await loginEmail(admin.email, admin.password)
    assert.equal(login.status, 200)
    const own = await request('/api/kubios/me', { cookie: login.cookie })
    assert.equal(own.body.status, 'unlinked')
    const list = await request('/api/admin/kubios/participants?search=bcrypt&page=1&pageSize=10', { cookie: login.cookie })
    assert.equal(list.status, 200)
    assert.equal(list.body.total, 1)
    assert.equal(list.body.participants[0].userId, 3)
    const details = await request('/api/admin/kubios/participants/3', { cookie: login.cookie })
    assert.equal(details.status, 200)
    assert.equal(details.body.results.length, 3)
    assert.doesNotMatch(details.text, /internal_secret|must-not-be-exported|ciphertext|nonce|team_id/)
    const study = await request('/api/study?period=365d', { cookie: login.cookie })
    assert.equal(study.status, 200)
    assert.equal(study.body.records.kubios, 3)
    assert.equal(study.body.sources.kubios, 'ready')
    const user = await loginUsername(bcryptUser.username, bcryptUser.password)
    assert.equal((await request('/api/admin/kubios/participants', { cookie: user.cookie })).status, 403)
    assert.equal((await request('/api/study', { cookie: user.cookie })).status, 403)
  })

  test('database pagination and downloads return full sanitized data', async () => {
    const login = await loginEmail(admin.email, admin.password)
    const cookie = login.cookie
    const reset = new URL(process.env.ACCEPTANCE_RESET_URL)
    const tableUrl = reset.href.replace(/\/__reset$/, '/rest/v1/insulindata')
    const records = Array.from({ length: 1005 }, (_, i) => ({ id: `asp-${String(i).padStart(4, '0')}`, username: bcryptUser.username, insulinType: '__PLAIN__synthetic', dose: '__PLAIN__0', date_time: '2026-11-01T08:00:00.000Z', dose_iv: null, insulintype_iv: null }))
    assert.equal((await fetch(tableUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(records) })).status, 201)
    const page = await request('/api/admin/database/table-data?table=insulindata&limit=10&offset=1000', { cookie })
    assert.equal(page.status, 200)
    assert.ok(page.body.data.length > 0)
    const download = await request('/api/admin/database/export?table=insulindata&format=json', { cookie })
    assert.equal(download.status, 200)
    assert.doesNotMatch(download.body.content, /PasswordHash|_iv|ciphertext/)
    const rows = JSON.parse(download.body.content)
    assert.equal((Array.isArray(rows) ? rows : rows.records ?? rows.data).length, page.body.totalRecords)
    const backup = await request('/api/admin/database/logical-backup', {
      method: 'POST', cookie,
      // The browser derives the key; here Node simulates the same PBKDF2 profile.
      body: (() => {
        const salt = randomBytes(32)
        const key = pbkdf2Sync('Synthetic-Download-Password-1!', salt, 600000, 32, 'sha256')
        return { salt: salt.toString('base64'), key: key.toString('base64') }
      })(),
    })
    assert.equal(backup.status, 200)
    assert.doesNotMatch(backup.text, /Synthetic-Download-Password|__PLAIN__|acceptance\.bcrypt|PasswordHash|internal_secret/)
  })
})

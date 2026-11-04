import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { enabled, loginEmail, loginUsername, request } from './support/http.mjs'
import { admin, bcryptUser } from './support/fixtures.mjs'

const suite = enabled && process.env.ACCEPTANCE_RESET_URL ? describe : describe.skip

suite('Dashboard Remaking: real backend against disposable Supabase HTTP simulation', () => {
  let adminCookie
  let userCookie
  before(async () => {
    const reset = new URL(process.env.ACCEPTANCE_RESET_URL)
    assert.ok(['localhost', '127.0.0.1'].includes(reset.hostname), 'Fixture writes require a local disposable stand-in')
    assert.equal((await fetch(reset, { method: 'POST' })).status, 204)
    const standin = reset.href.replace(/\/__reset$/, '')
    async function seed(table, rows) {
      const response = await fetch(`${standin}/rest/v1/${table}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rows) })
      assert.equal(response.status, 201)
    }
    await seed('users', Array.from({ length: 32 }, (_, i) => ({ UserID: 100 + i, Username: `dr.member${String(i + 1).padStart(2, '0')}`, PasswordHash: 'a'.repeat(64), role: 'user' })))
    await seed('insulindata', Array.from({ length: 1005 }, (_, i) => ({ id: `dr-insulin-${String(i).padStart(4, '0')}`, username: i % 4 === 0 ? bcryptUser.username : `dr.member0${i % 4}`, insulinType: '__PLAIN__synthetic', dose: '__PLAIN__0', date_time: '2026-11-01T08:00:00.000Z', dose_iv: null, insulintype_iv: null })))
    const a = await loginEmail(admin.email, admin.password)
    assert.equal(a.status, 200)
    adminCookie = a.cookie
    const u = await loginUsername(bcryptUser.username, bcryptUser.password)
    assert.equal(u.status, 200)
    userCookie = u.cookie
  })

  test('filters before paging and reports a stable total over more than three users', async () => {
    const first = await request('/api/users?search=dr.member&page=1&pageSize=25', { cookie: adminCookie })
    const second = await request('/api/users?search=dr.member&page=2&pageSize=25', { cookie: adminCookie })
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(first.body.total, 32)
    assert.equal(second.body.total, 32)
    assert.equal(first.body.users.length, 25)
    assert.equal(second.body.users.length, 7)
    assert.equal(new Set([...first.body.users, ...second.body.users].map(u => u.id)).size, 32)
    const last = await request('/api/users?search=dr.member&page=4&pageSize=10', { cookie: adminCookie })
    assert.equal(last.body.users.length, 2)
    assert.equal(last.body.total, 32)
    const invalid = await request('/api/users?page=1&pageSize=25&limit=10', { cookie: adminCookie })
    assert.equal(invalid.status, 400)
  })

  test('retrieves all 1011 health records across PostgREST pages and isolates the owner', async () => {
    const query = '/api/decrypted-data?selectedUser=all&timeRange=all&selectedDataType=all'
    const global = await request(query, { cookie: adminCookie })
    assert.equal(global.status, 200)
    assert.equal(global.body.insulinData.length, 1011)
    assert.ok(new Set(global.body.insulinData.map(r => r.username)).size > 3)
    assert.ok(global.body.insulinData.every(r => !('dose_iv' in r) && !('PasswordHash' in r)))
    const own = await request(query, { cookie: userCookie })
    assert.equal(own.status, 200)
    assert.equal(own.body.insulinData.length, 256)
    assert.ok(own.body.insulinData.every(r => r.username === bcryptUser.username))
    const selected = await request('/api/decrypted-data?selectedUser=dr.member01&timeRange=all&selectedDataType=all', { cookie: adminCookie })
    assert.equal(selected.status, 200)
    assert.equal(selected.body.insulinData.length, 251)
  })

  test('preserves an email-shaped legacy username through the common login contract', async () => {
    const created = await request('/api/users', { method: 'POST', cookie: adminCookie, body: { username: 'legacy.dr@example.test', password: 'Disposable-DR-1!', role: 'user', gdprConsent: false } })
    assert.equal(created.status, 201)
    const login = await loginEmail('legacy.dr@example.test', 'Disposable-DR-1!')
    assert.equal(login.status, 200)
    assert.equal(login.body.method, 'username')
    assert.equal(login.body.user.role, 'user')
    assert.ok(login.setCookies.every(cookie => cookie.httpOnly))
    assert.equal('token' in login.body, false)
  })
})

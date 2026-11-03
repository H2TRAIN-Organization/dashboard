import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'

export const BATCH = 'DR-20261103-v1'
export const TARGET = 'jiahao.yang@ulpgc.es'
const TABLES = ['exercisedata', 'fooddata', 'insulindata']
const FIELDS = {
  exercisedata: { exercise_type: 'exercise_type_iv', exercise_description: 'exercise_description_iv' },
  fooddata: { food_type: 'food_type_iv', quantity: 'quantity_iv', carbs: 'carbs_iv' },
  insulindata: { insulinType: 'insulintype_iv', dose: 'dose_iv' },
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function encrypt(value, keyHex) {
  assert(/^[a-f0-9]{64}$/i.test(keyHex ?? ''), 'Missing or invalid encryption configuration')
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), iv)
  return { text: cipher.update(String(value), 'utf8', 'hex') + cipher.final('hex'), iv: iv.toString('hex') }
}

export function decrypt(value, iv, keyHex) {
  const cipher = createDecipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'hex'))
  return cipher.update(value, 'hex', 'utf8') + cipher.final('utf8')
}

export function expectedBatch(username) {
  return Object.fromEntries(TABLES.map((table, category) => [table, Array.from({ length: 8 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 10, 3, 9 + category * 2, index * 15)).toISOString().replace('Z', '')
    const common = { id: -2026110301 - category * 8 - index, username, date_time: date }
    if (table === 'exercisedata') return { ...common, exercise_type: `DRtest${index + 1}`, intensity: index % 4, exercise_start_time: date, exercise_end_time: new Date(Date.parse(date + 'Z') + 30 * 60_000).toISOString().replace('Z', ''), exercise_description: `${BATCH}: ejercicio sintético ${index + 1}` }
    if (table === 'fooddata') return { ...common, food_type: `DRtest${index + 1}`, quantity: String(index + 1), carbs: String(index * 5) }
    return { ...common, insulinType: `DRtest${index + 1}`, dose: String(index / 2), actualDateTime: date }
  })]))
}

export function encryptRow(table, row, keyHex) {
  const result = { ...row }
  for (const [field, ivField] of Object.entries(FIELDS[table])) {
    const encrypted = encrypt(row[field], keyHex)
    result[field] = encrypted.text
    result[ivField] = encrypted.iv
  }
  return result
}

export function matchesExpected(table, actual, expected, keyHex) {
  try {
    for (const [field, value] of Object.entries(expected)) {
      if (FIELDS[table][field]) {
        if (decrypt(actual[field], actual[FIELDS[table][field]], keyHex) !== value) return false
      } else if (field.includes('time') || field === 'actualDateTime') {
        if (Date.parse(actual[field] + (/Z$|[+-]\d\d:\d\d$/.test(actual[field]) ? '' : 'Z')) !== Date.parse(value + 'Z')) return false
      } else if (actual[field] !== value) return false
    }
    return true
  } catch { return false }
}

export async function resolveTarget(client) {
  const normalize = value => String(value).trim().normalize('NFC').toLowerCase()
  const { data: candidates, error } = await client.from('users').select('UserID,Username,UUID,role').ilike('Username', TARGET).limit(2)
  assert(!error, 'Unable to inspect the target account')
  const direct = candidates.filter(row => normalize(row.Username) === normalize(TARGET))
  assert(direct.length <= 1, 'Ambiguous target username; no data changed')
  let authMatch = null
  for (let page = 1; ; page += 1) {
    const result = await client.auth.admin.listUsers({ page, perPage: 1000 })
    assert(!result.error, 'Unable to verify the target Auth identity')
    for (const user of result.data.users) {
      if (normalize(user.email ?? '') === normalize(TARGET)) {
        assert(!authMatch, 'Ambiguous target Auth identity; no data changed')
        authMatch = user
      }
    }
    if (result.data.users.length < 1000) break
  }
  const accountConfirmed = Boolean(authMatch?.email_confirmed_at)
  assert(accountConfirmed, 'No confirmed Auth identity for the exact target; no data changed')
  let target = direct[0] ?? null
  if (authMatch) {
    const linked = authMatch.app_metadata?.app_user_id
    if (linked !== undefined && linked !== null) {
      assert(typeof linked === 'string' || Number.isSafeInteger(linked), 'Invalid target Auth link; no data changed')
      const { data: linkedRows, error: linkError } = await client.from('users').select('UserID,Username,UUID,role').eq('UserID', linked).limit(2)
      assert(!linkError && linkedRows.length === 1, 'Target Auth identity has no unique application account')
      assert(!target || String(target.UserID) === String(linkedRows[0].UserID), 'Target username and Auth link disagree; no data changed')
      target = linkedRows[0]
    } else {
      assert(authMatch.email_confirmed_at && target, 'No confirmed unique application account; no data changed')
      const { data: uuidRows, error: uuidError } = await client.from('users').select('UserID').eq('UUID', authMatch.id).limit(2)
      assert(!uuidError && uuidRows.length <= 1, 'Ambiguous target UUID; no data changed')
      assert(uuidRows.length === 0 || String(uuidRows[0].UserID) === String(target.UserID), 'Target email and UUID identify different accounts; no data changed')
    }
  }
  assert(target && typeof target.Username === 'string', 'Exact target account not found; no data changed')
  return { target, accountConfirmed }
}

export async function runBatch(client, keyHex, mode = 'plan') {
  assert(['plan', 'apply', 'verify', 'remove'].includes(mode), 'Use plan, apply, verify or remove')
  const { target, accountConfirmed } = await resolveTarget(client)
  const expected = expectedBatch(target.Username)
  const observed = {}
  const before = {}
  // Inspect all reserved IDs before making any mutation. Never overwrite a collision.
  for (const table of TABLES) {
    const result = await client.from(table).select('*').in('id', expected[table].map(r => r.id))
    assert(!result.error, `Unable to inspect ${table}; no new mutation attempted`)
    observed[table] = result.data
    before[table] = result.data.length
    for (const row of result.data) {
      const wanted = expected[table].find(r => r.id === row.id)
      assert(wanted && matchesExpected(table, row, wanted, keyHex), `Reserved ID collision or modified batch in ${table}; refusing mutation`)
    }
  }
  for (const table of TABLES) {
    if (mode === 'apply') {
      const present = new Set(observed[table].map(r => r.id))
      const missing = expected[table].filter(r => !present.has(r.id))
      if (missing.length) {
        const { error } = await client.from(table).insert(missing.map(row => encryptRow(table, row, keyHex)))
        assert(!error, `Insert failed or has uncertain outcome in ${table}; rerun plan to reconcile before apply`)
      }
    } else if (mode === 'remove' && observed[table].length) {
      const { error } = await client.from(table).delete().eq('username', target.Username).in('id', observed[table].map(r => r.id))
      assert(!error, `Selective removal failed or has uncertain outcome in ${table}; rerun plan to reconcile`)
    }
  }
  const after = {}
  for (const table of TABLES) {
    const result = await client.from(table).select('*').in('id', expected[table].map(r => r.id))
    assert(!result.error, `Unable to verify ${table}; reconcile before any retry`)
    after[table] = result.data.length
    for (const row of result.data) assert(matchesExpected(table, row, expected[table].find(r => r.id === row.id), keyHex), `Batch verification failed in ${table}`)
    if (mode === 'apply' || mode === 'verify') assert(after[table] === 8, `Expected exactly eight batch rows in ${table}`)
    if (mode === 'remove') assert(after[table] === 0, `Batch rows remain in ${table}`)
  }
  return { batch: BATCH, mode, accountConfirmed, before, after, added: Object.fromEntries(TABLES.map(t => [t, Math.max(0, after[t] - before[t])])), total: Object.values(after).reduce((a, b) => a + b, 0), encryptionVerified: true }
}

async function main() {
  const require = createRequire(import.meta.url)
  const { loadEnvConfig } = require('@next/env')
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} })
  const { createClient } = require('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  assert(url && key, 'Missing server-side Supabase configuration')
  const encryptionKey = process.env.ENCRYPTION_SECRET_KEY
  assert(/^[a-f0-9]{64}$/i.test(encryptionKey ?? ''), 'Missing or invalid encryption configuration')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const report = await runBatch(client, encryptionKey, process.argv[2] ?? 'plan')
  const reportIndex = process.argv.indexOf('--report')
  if (reportIndex !== -1) await writeFile(process.argv[reportIndex + 1], JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  console.log(JSON.stringify(report))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}

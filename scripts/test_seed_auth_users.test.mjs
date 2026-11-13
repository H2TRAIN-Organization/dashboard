/**
 * Pruebas de MT45 · siembra de identidades en Supabase Auth.
 *
 * Sin red: todas las funciones son puras y el cliente admin se inyecta.
 * Ejecutar con: node --test scripts/test_seed_auth_users.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SYNTHETIC_EMAIL_DOMAIN,
  applySeedPlan,
  assertServiceRoleKey,
  buildSeedPlan,
  classifyPasswordHash,
  deriveEmail,
  normalizeIdentity,
} from './seed-auth-users.mjs'

const BCRYPT_OK = '$2b$10$abcdefghijklmnopqrstuv'
const BCRYPT_HIGH_COST = '$2b$15$abcdefghijklmnopqrstuv'
const SHA256_STYLE = 'a'.repeat(64)

function appUser(overrides = {}) {
  return {
    UserID: 1,
    Username: 'participante-uno',
    UUID: null,
    role: 'user',
    PasswordHash: BCRYPT_OK,
    ...overrides,
  }
}

test('classifyPasswordHash marca bcrypt importable y el resto fail-closed', () => {
  assert.deepEqual(classifyPasswordHash(BCRYPT_OK), { kind: 'bcrypt', importable: true })
  assert.equal(classifyPasswordHash(BCRYPT_HIGH_COST).importable, false)
  assert.equal(classifyPasswordHash(SHA256_STYLE).kind, 'unsupported')
  assert.equal(classifyPasswordHash('').kind, 'missing')
  assert.equal(classifyPasswordHash(undefined).kind, 'missing')
})

test('deriveEmail usa el username como email real o un sintético .invalid', () => {
  const real = deriveEmail({ username: '  Jiahao.Yang@ULPGC.es ' })
  assert.equal(real.email, 'jiahao.yang@ulpgc.es')
  assert.equal(real.synthetic, false)

  const synthetic = deriveEmail({ username: 'Ana María P.' })
  assert.equal(synthetic.email, `ana-maria-p@${SYNTHETIC_EMAIL_DOMAIN}`)
  assert.equal(synthetic.synthetic, true)

  const empty = deriveEmail({ username: '***' })
  assert.equal(empty.email, `user@${SYNTHETIC_EMAIL_DOMAIN}`)
})

test('buildSeedPlan clasifica 17 bcrypt importables y 4 resets', () => {
  const appUsers = Array.from({ length: 21 }, (_, index) =>
    appUser({
      UserID: index + 1,
      Username: `user-${index + 1}`,
      PasswordHash: index < 17 ? BCRYPT_OK : SHA256_STYLE,
    }),
  )

  const plan = buildSeedPlan({ appUsers, authUsers: [] })
  assert.equal(plan.summary.total, 21)
  assert.equal(plan.summary.create, 21)
  assert.equal(plan.summary.importable, 17)
  assert.equal(plan.summary.resetRequired, 4)
  assert.equal(plan.summary.alreadyLinked, 0)
  assert.equal(plan.summary.errors, 0)

  const resetEntries = plan.entries.filter((entry) => entry.resetRequired)
  assert.equal(resetEntries.length, 4)
  assert.ok(resetEntries.every((entry) => entry.synthetic === true))
})

test('buildSeedPlan salta cuentas ya vinculadas y marca conflictos', () => {
  const plan = buildSeedPlan({
    appUsers: [
      appUser({ UserID: 1, Username: 'linked-id' }),
      appUser({ UserID: 2, Username: 'user@ulpgc.es' }),
      appUser({ UserID: 3, Username: 'previa' }),
      appUser({ UserID: 4, Username: 'dupe' }),
      appUser({ UserID: 4, Username: 'dupe' }),
    ],
    authUsers: [
      { id: 'uuid-a', email: 'other@x.test', app_metadata: { app_user_id: 1, role: 'user' } },
      { id: 'uuid-b', email: 'user@ulpgc.es' },
      { id: 'uuid-c', email: 'previa@users.h2train.invalid' },
    ],
  })

  // Vinculadas: por app_user_id, por email==username y por email sintético
  // de una siembra anterior (reconciliación idempotente).
  assert.equal(plan.summary.alreadyLinked, 3)
  // Conflicto: UserID duplicado en public.users.
  assert.equal(plan.summary.errors, 1)
  assert.equal(plan.summary.create, 1)
  const errors = plan.entries.filter((entry) => entry.action === 'error')
  assert.ok(errors.every((entry) => entry.reason.includes('UserID duplicado')))
})

test('buildSeedPlan es idempotente tras la primera siembra', () => {
  const appUsers = Array.from({ length: 3 }, (_, index) => appUser({ UserID: index + 1 }))
  const first = buildSeedPlan({ appUsers, authUsers: [] })

  const seeded = first.entries.map((entry) => ({
    id: `uuid-${entry.userId}`,
    email: entry.email,
    app_metadata: { app_user_id: Number(entry.userId), role: entry.role },
  }))
  const second = buildSeedPlan({ appUsers, authUsers: seeded })

  assert.equal(second.summary.create, 0)
  assert.equal(second.summary.alreadyLinked, 3)
})

test('applySeedPlan crea con password_hash solo lo importable y reporta el resto', async () => {
  const appUsers = [
    appUser({ UserID: 1, Username: 'uno', PasswordHash: BCRYPT_OK }),
    appUser({ UserID: 2, Username: 'dos', PasswordHash: SHA256_STYLE }),
    appUser({ UserID: 3, Username: 'tres' }),
  ]
  const plan = buildSeedPlan({
    appUsers,
    authUsers: [{ id: 'uuid-3', email: 'x@y.test', app_metadata: { app_user_id: 3 } }],
  })

  const created = []
  const admin = {
    createUser: async (attributes) => {
      created.push(attributes)
      return { data: { user: { id: `uuid-${created.length}` } }, error: null }
    },
  }

  const outcome = await applySeedPlan(plan, admin)
  assert.equal(created.length, 2)
  assert.ok(created[0].password_hash.startsWith('$2b$'))
  assert.equal(created[1].password_hash, undefined)
  assert.ok(created.every((attributes) => attributes.email_confirm === true))
  assert.deepEqual(created[0].app_metadata, { app_user_id: 1, role: 'user' })

  assert.deepEqual(outcome.counts, { created: 2, 'already-linked': 1 })
  assert.ok(outcome.report.find((item) => item.userId === '2').resetRequired === true)
})

test('applySeedPlan reporta fallos del admin sin interrumpir el resto', async () => {
  const plan = buildSeedPlan({
    appUsers: [
      appUser({ UserID: 1, Username: 'uno' }),
      appUser({ UserID: 2, Username: 'dos' }),
    ],
  })
  const admin = {
    createUser: async ({ email }) =>
      email.startsWith('uno')
        ? { data: null, error: { message: 'ya registrado' } }
        : { data: { user: { id: 'ok' } }, error: null },
  }
  const outcome = await applySeedPlan(plan, admin)
  assert.deepEqual(outcome.counts, { created: 1, failed: 1 })
  assert.equal(outcome.report[0].action, 'failed')
})

test('assertServiceRoleKey acepta service_role y rechaza anon', () => {
  const jwt = (role) => {
    const payload = Buffer.from(JSON.stringify({ role })).toString('base64url')
    return `header.${payload}.signature`
  }
  assert.doesNotThrow(() => assertServiceRoleKey(jwt('service_role')))
  assert.throws(() => assertServiceRoleKey(jwt('anon')), /service_role/)
  assert.throws(() => assertServiceRoleKey('no-es-jwt'), /JWT/)
})

test('normalizeIdentity coincide con la del gateway (trim + NFC + minúsculas)', () => {
  assert.equal(normalizeIdentity('  Ána  '), 'ána')
  assert.equal(normalizeIdentity('USER@ULPGC.ES'), 'user@ulpgc.es')
})

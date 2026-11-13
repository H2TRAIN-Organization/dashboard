/**
 * Pruebas de MT56 · reset controlado de contraseña en GoTrue.
 * Sin red: funciones puras y cliente admin inyectado.
 * Ejecutar con: node --test scripts/test_reset_auth_password.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyResetPlan,
  buildResetPlan,
  findAuthUserByAppUserId,
} from './reset-auth-password.mjs'
import { SYNTHETIC_EMAIL_DOMAIN } from './seed-auth-users.mjs'

const APP_USERS = [
  { UserID: 13, Username: 'b', role: 'user' },
  { UserID: 17, Username: 'ggilbordon@gmail.com', role: 'user' },
  { UserID: 21, Username: 'gabriel.gil@ulpgc.es', role: 'admin' },
]

test('findAuthUserByAppUserId enlaza por app_metadata y falla sin ella', () => {
  const authUsers = [
    { id: 'uuid-a', app_metadata: { app_user_id: 21, role: 'admin' } },
    { id: 'uuid-b', app_metadata: { app_user_id: '17', role: 'user' } },
  ]
  assert.equal(findAuthUserByAppUserId(authUsers, 21).id, 'uuid-a')
  assert.equal(findAuthUserByAppUserId(authUsers, '17').id, 'uuid-b')
  assert.equal(findAuthUserByAppUserId(authUsers, 99), null)
})

test('buildResetPlan rechaza usuario desconocido y contraseña débil', () => {
  const plan1 = buildResetPlan({
    appUsers: APP_USERS, authUsers: [], targetUserId: 99, newPassword: 'larga-suficiente',
  })
  assert.equal(plan1.action, 'error')
  assert.match(plan1.reason, /UNKNOWN_APP_USER/)

  const plan2 = buildResetPlan({
    appUsers: APP_USERS, authUsers: [], targetUserId: 13, newPassword: 'corta',
  })
  assert.equal(plan2.action, 'error')
  assert.match(plan2.reason, /WEAK_PASSWORD/)
})

test('buildResetPlan falla cerrado si no existe la identidad GoTrue', () => {
  const plan = buildResetPlan({
    appUsers: APP_USERS, authUsers: [], targetUserId: 13, newPassword: 'larga-suficiente',
  })
  assert.equal(plan.action, 'error')
  assert.match(plan.reason, /NO_AUTH_IDENTITY/)
})

test('buildResetPlan localiza la identidad por vínculo, email real o sintético', () => {
  const authUsers = [
    { id: 'uuid-link', app_metadata: { app_user_id: 13, role: 'user' } },
    { id: 'uuid-email', email: 'ggilbordon@gmail.com' },
  ]
  const byLink = buildResetPlan({
    appUsers: APP_USERS, authUsers, targetUserId: 13, newPassword: 'larga-suficiente',
  })
  assert.equal(byLink.authUserId, 'uuid-link')
  // Sin app_user_id (needsLink) porque el rol debe coincidir: ya coincide aquí.
  assert.equal(byLink.needsLink, false)

  const byRealEmail = buildResetPlan({
    appUsers: APP_USERS, authUsers, targetUserId: 17, newPassword: 'larga-suficiente',
  })
  assert.equal(byRealEmail.authUserId, 'uuid-email')
  assert.equal(byRealEmail.needsLink, true)

  const synthetic = buildResetPlan({
    appUsers: APP_USERS,
    authUsers: [{ id: 'uuid-syn', email: `b@${SYNTHETIC_EMAIL_DOMAIN}` }],
    targetUserId: 13,
    newPassword: 'larga-suficiente',
  })
  assert.equal(synthetic.authUserId, 'uuid-syn')
})

test('applyResetPlan aplica contraseña y vínculo; el informe no contiene la contraseña', async () => {
  const plan = buildResetPlan({
    appUsers: APP_USERS,
    authUsers: [{ id: 'uuid-email', email: 'ggilbordon@gmail.com' }],
    targetUserId: 17,
    newPassword: 'nueva-larga-2026',
  })
  const calls = []
  const admin = {
    updateUserById: async (id, attributes) => {
      calls.push({ id, attributes })
      return { error: null }
    },
  }
  const outcome = await applyResetPlan(plan, admin)

  assert.deepEqual(calls, [{
    id: 'uuid-email',
    attributes: {
      password: 'nueva-larga-2026',
      app_metadata: { app_user_id: 17, role: 'user' },
    },
  }])
  assert.equal(outcome.report.action, 'reset')
  assert.equal(outcome.report.linkFixed, true)
  assert.equal(JSON.stringify(outcome).includes('nueva-larga-2026'), false)
})

test('applyResetPlan con vínculo correcto no toca app_metadata', async () => {
  const plan = buildResetPlan({
    appUsers: APP_USERS,
    authUsers: [{ id: 'uuid-link', app_metadata: { app_user_id: 13, role: 'user' } }],
    targetUserId: 13,
    newPassword: 'larga-suficiente',
  })
  const calls = []
  const admin = {
    updateUserById: async (id, attributes) => {
      calls.push({ id, attributes })
      return { error: null }
    },
  }
  const outcome = await applyResetPlan(plan, admin)
  assert.deepEqual(calls[0].attributes, { password: 'larga-suficiente' })
  assert.equal(outcome.report.linkFixed, false)
})

test('applyResetPlan reporta fallos del admin sin interrumpir', async () => {
  const plan = buildResetPlan({
    appUsers: APP_USERS,
    authUsers: [{ id: 'uuid-link', app_metadata: { app_user_id: 13, role: 'user' } }],
    targetUserId: 13,
    newPassword: 'larga-suficiente',
  })
  const admin = {
    updateUserById: async () => ({ error: { message: 'rate limited' } }),
  }
  const outcome = await applyResetPlan(plan, admin)
  assert.equal(outcome.report.action, 'failed')
  assert.match(outcome.report.reason, /rate limited/)
})

/**
 * Pruebas de MT56 · borrado controlado de cuentas residuales.
 * Ejecutar con: node --test scripts/test_remove_auth_accounts.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyRemovalPlan,
  buildRemovalPlan,
} from './remove-auth-accounts.mjs'
import { SYNTHETIC_EMAIL_DOMAIN } from './seed-auth-users.mjs'

const APP_USERS = [
  { UserID: 7, Username: 'test', role: 'user' },
  { UserID: 19, Username: 'H2TRAIN-Participant12', role: 'user' },
  { UserID: 23, Username: 'auth_99c02838-uuid', role: 'user' },
]

test('buildRemovalPlan empareja identidad por vínculo o email sintético', () => {
  const authUsers = [
    { id: 'uuid-7', app_metadata: { app_user_id: 7, role: 'user' } },
    { id: 'uuid-23', email: `auth_99c02838-uuid@${SYNTHETIC_EMAIL_DOMAIN}` },
  ]
  const plan = buildRemovalPlan({
    appUsers: APP_USERS,
    authUsers,
    targetUserIds: [7, 19, 23],
  })
  assert.equal(plan.errors.length, 1)
  assert.deepEqual(plan.errors[0], { userId: '19', reason: 'NO_AUTH_IDENTITY' })
  assert.equal(plan.targets[0].userId, '7')
  assert.equal(plan.targets[0].authUserId, 'uuid-7')
  assert.equal(plan.targets[1].userId, '23')
  assert.equal(plan.targets[1].authUserId, 'uuid-23')
})

test('buildRemovalPlan marca usuarios desconocidos', () => {
  const plan = buildRemovalPlan({
    appUsers: APP_USERS,
    authUsers: [],
    targetUserIds: [99],
  })
  assert.deepEqual(plan.errors, [{ userId: '99', reason: 'UNKNOWN_APP_USER' }])
  assert.equal(plan.targets.length, 0)
})

test('applyRemovalPlan falla cerrado con datos y borra las dos capas sin ellos', async () => {
  const plan = buildRemovalPlan({
    appUsers: APP_USERS,
    authUsers: [
      { id: 'uuid-7', app_metadata: { app_user_id: 7, role: 'user' } },
      { id: 'uuid-23', email: `auth_99c02838-uuid@${SYNTHETIC_EMAIL_DOMAIN}` },
    ],
    targetUserIds: [7, 23],
  })
  const calls = []
  const gateway = {
    deleteAppUser: async (userId) => {
      calls.push({ step: 'app', userId })
      return userId === '7' // test: sin datos; 23: tiene datos
    },
    deleteAuthIdentity: async (authUserId) => {
      calls.push({ step: 'identity', authUserId })
      return { error: null }
    },
  }
  const outcome = await applyRemovalPlan(plan, gateway)

  // UserID 7: ambas capas.
  assert.deepEqual(calls[0], { step: 'app', userId: '7' })
  assert.deepEqual(calls[1], { step: 'identity', authUserId: 'uuid-7' })
  assert.equal(outcome.report[0].action, 'removed')
  // UserID 23: el RPC falla cerrado y la identidad GoTrue NO se toca.
  assert.deepEqual(calls[2], { step: 'app', userId: '23' })
  assert.equal(calls.length, 3)
  assert.equal(outcome.report[1].action, 'skipped')
  assert.equal(outcome.report[1].reason, 'USER_HAS_DATA')
})

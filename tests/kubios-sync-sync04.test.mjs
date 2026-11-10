/**
 * Pruebas sintÃ©ticas del refresco dirigido de un miembro (subtarea SYNC-04).
 *
 * No usan red, ni Supabase remoto, ni credenciales reales: las RPC, los dos
 * `fetch`, el reloj y el UUID se inyectan, igual que en `kubios-sync.k14`.
 * Reutiliza el loader de K14 para resolver los imports relativos sin extensiÃ³n.
 *
 * Ejecutar desde la raÃ­z del repositorio:
 *
 *   node --conditions=react-server \
 *     --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --test tests/kubios-sync-sync04.test.mjs
 */

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./kubios-sync.k14.loader.mjs', import.meta.url))

const { runKubiosMemberRefresh, runKubiosSync } = await import('../src/lib/kubios-sync.ts')
const { encryptKubiosToken } = await import('../src/lib/kubios-crypto.ts')

const TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MEMBER_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MEMBER_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOW_MS = 1_800_000_000_000

const SYNC_ENV = Object.freeze({
  KUBIOS_USERNAME: 'usuario.sintetico@example.invalid',
  KUBIOS_PASSWORD: ' contraseÃ±a sintÃ©tica con espacios ',
  KUBIOS_CLIENT_ID: 'cliente-sintetico',
  KUBIOS_TEAM_ID: TEAM_ID,
  KUBIOS_ENCRYPTION_KEY_V1: Buffer.alloc(32, 0x5a).toString('base64')
})

const SYNC_ENV_WITHOUT_TEAM = Object.freeze(
  Object.fromEntries(
    Object.entries(SYNC_ENV).filter(([name]) => name !== 'KUBIOS_TEAM_ID')
  )
)

/* Utilidades: rÃ©plica reducida del doble de servicio de K14. */

function syntheticJwt(expSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: 'sintetico', exp: expSeconds })).toString('base64url')
  return `${header}.${payload}.firma-sintetica`
}

function seedToken({ expiresAt = NOW_MS + 3_600_000 } = {}) {
  const idToken = syntheticJwt(Math.floor(expiresAt / 1000))
  const envelope = encryptKubiosToken(
    idToken,
    { teamId: TEAM_ID, memberId: TEAM_ID },
    { env: SYNC_ENV }
  )
  const bytes = Buffer.from(envelope, 'base64')
  return {
    idToken,
    row: {
      ciphertext: `\\x${bytes.subarray(29).toString('hex')}`,
      nonce: `\\x${bytes.subarray(1, 13).toString('hex')}`,
      tag: `\\x${bytes.subarray(13, 29).toString('hex')}`,
      key_version: bytes.readUInt8(0),
      expires_at: new Date(expiresAt).toISOString()
    }
  }
}

function createService({ acquire = true, tokenRow = null, finishResult = true } = {}) {
  const state = { tokenRow, snapshots: new Map(), leaseOwner: null, finish: null, cursor: null }
  const calls = []
  const service = {
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'kubios_try_acquire_sync') {
        if (!acquire) return { data: false, error: null }
        state.leaseOwner = args.p_lease_owner
        return { data: true, error: null }
      }
      if (name === 'kubios_get_sync_cursor') {
        if (state.cursor === null) return { data: [], error: null }
        return {
          data: [
            {
              next_member_id: state.cursor.next_member_id,
              attempted_member_ids: [...state.cursor.attempted_member_ids],
              failed_member_ids: [...state.cursor.failed_member_ids]
            }
          ],
          error: null
        }
      }
      if (name === 'kubios_advance_sync_cursor') {
        if (
          state.leaseOwner !== args.p_lease_owner
        ) {
          return { data: false, error: null }
        }
        state.cursor = {
          next_member_id: args.p_next_member_id,
          attempted_member_ids: [...args.p_attempted_member_ids],
          failed_member_ids: [...args.p_failed_member_ids]
        }
        return { data: true, error: null }
      }
      if (name === 'kubios_get_token') {
        return { data: state.tokenRow === null ? [] : [state.tokenRow], error: null }
      }
      if (name === 'kubios_write_token') {
        if (state.leaseOwner !== args.p_lease_owner) {
          return { data: null, error: { message: 'kubios_token_write_denied' } }
        }
        state.tokenRow = {
          ciphertext: args.p_ciphertext,
          nonce: args.p_nonce,
          tag: args.p_tag,
          key_version: args.p_key_version,
          expires_at: args.p_expires_at
        }
        return { data: null, error: null }
      }
      if (name === 'kubios_write_snapshot') {
        if (state.leaseOwner !== args.p_lease_owner) {
          return { data: null, error: { message: 'kubios_sync_lease_owner_mismatch' } }
        }
        state.snapshots.set(`${args.p_team_id}:${args.p_member_id}`, args)
        return { data: '2027-01-01T00:00:00+00:00', error: null }
      }
      if (name === 'kubios_finish_sync') {
        state.finish = args
        if (state.leaseOwner !== args.p_lease_owner) return { data: false, error: null }
        state.leaseOwner = null
        return { data: finishResult, error: null }
      }
      return { data: null, error: { message: 'rpc_no_soportada' } }
    }
  }
  return {
    service,
    state,
    calls,
    callsNamed: (name) => calls.filter((call) => call.name === name)
  }
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: { cancel: async () => {} },
    json: async () => payload
  }
}

function errorResponse(status) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    body: { cancel: async () => {} },
    json: async () => {
      throw new Error('el cuerpo de un error no debe leerse')
    }
  }
}

/**
 * `apiFetch` falso de K13: `/v1/user/self` para el descubrimiento,
 * `/{memberId}` para los resultados del refresco dirigido.
 */
function createApiFetch({ userSelf = null, members = [], results = {} } = {}) {
  const calls = { userSelf: 0, members: 0, results: [] }
  const apiFetch = async (url) => {
    if (url.includes('/v1/user/self')) {
      calls.userSelf += 1
      if (userSelf === null) {
        return jsonResponse({
          user: { teams: [{ team_id: TEAM_ID, name: 'Diabetes Tracker - H2TRAIN' }] }
        })
      }
      return typeof userSelf === 'function' ? userSelf() : jsonResponse(userSelf)
    }
    if (url.includes('/v2/team/team/')) {
      calls.members += 1
      return jsonResponse({ members })
    }
    const memberId = url.slice(url.lastIndexOf('/') + 1)
    calls.results.push(memberId)
    const handler = results[memberId]
    if (typeof handler === 'function') return handler()
    if (handler !== undefined) return jsonResponse({ results: handler })
    return jsonResponse({ results: [] })
  }
  return { apiFetch, calls }
}

function loginRedirect({ idToken }) {
  let calls = 0
  const authFetch = async () => {
    calls += 1
    const location = `https://analysis.kubioscloud.com/v1/portal/login#id_token=${idToken}&token_type=Bearer`
    return new Response(null, { status: 302, headers: { location } })
  }
  return {
    authFetch,
    count: () => calls
  }
}

/* ---------------------------------------------------------------- *
 * 1. Ã‰xito del refresco dirigido
 * ---------------------------------------------------------------- */

test('SYNC-04 Ã©xito: sincroniza solo el miembro objetivo y no toca el cursor', async () => {
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch, calls } = createApiFetch({
    results: {
      [MEMBER_A]: [
        { result_id: 'sintetico', synthetic_metric: 7, measured_timestamp: '2026-11-09T12:00:00.000Z' }
      ]
    }
  })

  const login = loginRedirect({ idToken: syntheticJwt(1) })

  const result = await runKubiosMemberRefresh(MEMBER_A, {
    service,
    env: SYNC_ENV,
    apiFetch,
    authFetch: login.authFetch,
    now: () => NOW_MS
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0, memberSynced: true })
  assert.equal(login.count(), 0, 'un token vigente no debe provocar login')
  assert.deepEqual(calls.results, [MEMBER_A], 'solo el miembro objetivo se descarga')

  const writes = callsNamed('kubios_write_snapshot')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].args.p_member_id, MEMBER_A)

  const finish = callsNamed('kubios_finish_sync')
  assert.equal(finish.length, 1)
  assert.equal(finish[0].args.p_success, true)

  // El plan durable del cron no se adelanta ni se rearma con un refresco manual.
  assert.equal(callsNamed('kubios_get_sync_cursor').length, 0)
  assert.equal(callsNamed('kubios_advance_sync_cursor').length, 0)
  assert.equal(state.snapshots.size, 1)
})

test('SYNC-04 sin KUBIOS_TEAM_ID descubre el equipo y persiste el token bajo el lease', async () => {
  const { service, callsNamed } = createService({ tokenRow: null })
  const { apiFetch, calls } = createApiFetch({
    results: { [MEMBER_A]: [{ result_id: 'sintetico-descubierto' }] }
  })

  const idToken = syntheticJwt(Math.floor((NOW_MS + 3_600_000) / 1000))
  const login = loginRedirect({ idToken })

  const result = await runKubiosMemberRefresh(MEMBER_A, {
    service,
    env: SYNC_ENV_WITHOUT_TEAM,
    apiFetch,
    authFetch: login.authFetch,
    now: () => NOW_MS
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.memberSynced, true)
  assert.equal(login.count(), 1)
  assert.equal(callsNamed('kubios_write_token').length, 1, 'el token descubierto se persiste fenced')
  assert.equal(calls.userSelf, 1)
  assert.deepEqual(calls.results, [MEMBER_A])
})

test('SYNC-04 lease ocupado: locked, sin descarga y sin finish propio', async () => {
  const { service, callsNamed } = createService({ acquire: false })
  const { apiFetch, calls } = createApiFetch({})

  const result = await runKubiosMemberRefresh(MEMBER_A, {
    service,
    env: SYNC_ENV,
    apiFetch,
    now: () => NOW_MS
  })

  assert.deepEqual(result, { status: 'locked', synced: 0, failed: 0, memberSynced: false, errorCode: 'lease.unavailable' })
  assert.equal(calls.results.length, 0)
  assert.equal(callsNamed('kubios_finish_sync').length, 0)
})

test('SYNC-04 miembro con fallo HTTP: partial fail-closed y cierre con error', async () => {
  const seeded = seedToken()
  const { service, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch } = createApiFetch({
    results: { [MEMBER_A]: () => errorResponse(404) }
  })

  const result = await runKubiosMemberRefresh(MEMBER_A, {
    service,
    env: SYNC_ENV,
    apiFetch,
    now: () => NOW_MS
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1, memberSynced: false, errorCode: 'members.partial' })
  const finish = callsNamed('kubios_finish_sync')
  assert.equal(finish.length, 1)
  assert.equal(finish[0].args.p_success, false)
})

test('SYNC-04 identificador no UUID: fallo sin descargar y cierre completo', async () => {
  const seeded = seedToken()
  const { service, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch, calls } = createApiFetch({})

  const result = await runKubiosMemberRefresh('no-es-un-uuid', {
    service,
    env: SYNC_ENV,
    apiFetch,
    now: () => NOW_MS
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1, memberSynced: false, errorCode: 'members.partial' })
  assert.equal(calls.results.length, 0)
  assert.equal(callsNamed('kubios_finish_sync').length, 1)
})

test('SYNC-04 cierre fallido degrada el resultado: nunca ok sin confirmaciÃ³n', async () => {
  const seeded = seedToken()
  const { service } = createService({ tokenRow: seeded.row, finishResult: false })
  const { apiFetch } = createApiFetch({
    results: { [MEMBER_A]: [{ result_id: 'sintetico' }] }
  })

  const result = await runKubiosMemberRefresh(MEMBER_A, {
    service,
    env: SYNC_ENV,
    apiFetch,
    now: () => NOW_MS
  })

  assert.equal(result.status, 'partial')
  assert.equal(result.memberSynced, false)
})

test('la pasada por equipo del cron sigue intacta tras el refactor de preparaciÃ³n', async () => {
  const seeded = seedToken()
  const { service, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }, { team_user_id: MEMBER_B }],
    results: {
      [MEMBER_A]: [{ result_id: 'sintetico-a' }],
      [MEMBER_B]: [{ result_id: 'sintetico-b' }]
    }
  })

  const result = await runKubiosSync({
    service,
    env: SYNC_ENV,
    apiFetch,
    now: () => NOW_MS
  })

  assert.deepEqual(result, { status: 'ok', synced: 2, failed: 0 })
  assert.equal(callsNamed('kubios_get_sync_cursor').length, 1)
  assert.equal(callsNamed('kubios_advance_sync_cursor').length, 1)
  assert.equal(callsNamed('kubios_finish_sync').length, 1)
})

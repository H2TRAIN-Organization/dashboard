/**
 * Pruebas sintéticas de src/lib/kubios-sync.ts (subtarea K14).
 *
 * No usan red, ni Supabase remoto, ni credenciales reales: todas las RPC, los
 * dos `fetch`, el reloj y el generador de UUID se inyectan. Los datos son
 * ficticios (`example.invalid`, UUID sintéticos y una clave AES de 32 bytes
 * conocida).
 *
 * Ejecutar desde la raíz del repositorio:
 *
 *   node --conditions=react-server \
 *     --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --test tests/kubios-sync.k14.test.mjs
 *
 * Las pruebas registran `tests/kubios-sync.k14.loader.mjs` para resolver los
 * imports relativos sin extensión del código de producción, tal como hace
 * Next.js. No se modifica ningún import de producción.
 */

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./kubios-sync.k14.loader.mjs', import.meta.url))

const {
  runKubiosSync,
  DEFAULT_KUBIOS_SYNC_BUDGET_MS,
  DEFAULT_KUBIOS_SYNC_FINISH_RESERVE_MS,
  DEFAULT_KUBIOS_SYNC_RESPONSE_RESERVE_MS
} = await import('../src/lib/kubios-sync.ts')
const { decryptKubiosSnapshot, decryptKubiosToken, encryptKubiosToken } = await import(
  '../src/lib/kubios-crypto.ts'
)

const TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_TEAM_ID = '99999999-9999-4999-8999-999999999999'
const MEMBER_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MEMBER_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEMBER_C = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const MEMBER_D = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const PREVIOUS_OWNER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const NOW = 1_800_000_000_000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY = Buffer.alloc(32, 0x5a)

const ENV = Object.freeze({
  KUBIOS_USERNAME: 'usuario.sintetico@example.invalid',
  KUBIOS_PASSWORD: ' contraseña sintética con espacios ',
  KUBIOS_CLIENT_ID: 'cliente-sintetico',
  KUBIOS_TEAM_ID: TEAM_ID,
  KUBIOS_ENCRYPTION_KEY_V1: KEY.toString('base64')
})

// Sin KUBIOS_TEAM_ID: el sync debe descubrir y seleccionar el equipo por nombre.
const ENV_WITHOUT_TEAM = Object.freeze({
  KUBIOS_USERNAME: ENV.KUBIOS_USERNAME,
  KUBIOS_PASSWORD: ENV.KUBIOS_PASSWORD,
  KUBIOS_CLIENT_ID: ENV.KUBIOS_CLIENT_ID,
  KUBIOS_ENCRYPTION_KEY_V1: ENV.KUBIOS_ENCRYPTION_KEY_V1
})

const CRYPTO_OPTIONS = Object.freeze({ env: ENV })
const CRYPTO_OPTIONS_WITHOUT_TEAM = Object.freeze({ env: ENV_WITHOUT_TEAM })

/* ------------------------------------------------------------------------- *
 * Utilidades sintéticas
 * ------------------------------------------------------------------------- */

function syntheticJwt(expSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ sub: 'synthetic-subject', exp: expSeconds })
  ).toString('base64url')
  const signature = Buffer.from('synthetic-signature').toString('base64url')
  return `${header}.${payload}.${signature}`
}

function rowFromEnvelope(envelope, expiresAt) {
  const bytes = Buffer.from(envelope, 'base64')
  return {
    ciphertext: `\\x${bytes.subarray(29).toString('hex')}`,
    nonce: `\\x${bytes.subarray(1, 13).toString('hex')}`,
    tag: `\\x${bytes.subarray(13, 29).toString('hex')}`,
    key_version: bytes.readUInt8(0),
    expires_at: new Date(expiresAt).toISOString()
  }
}

function seedToken({ expiresAt = NOW + 3_600_000 } = {}) {
  const idToken = syntheticJwt(Math.floor(expiresAt / 1000))
  const envelope = encryptKubiosToken(
    idToken,
    { teamId: TEAM_ID, memberId: TEAM_ID },
    CRYPTO_OPTIONS
  )
  return { idToken, row: rowFromEnvelope(envelope, expiresAt) }
}

function envelopeFromArgs(args) {
  assert.match(args.p_nonce, /^\\x[0-9a-f]+$/)
  assert.match(args.p_tag, /^\\x[0-9a-f]+$/)
  assert.match(args.p_ciphertext, /^\\x[0-9a-f]+$/)

  return Buffer.concat([
    Buffer.from([args.p_key_version]),
    Buffer.from(args.p_nonce.slice(2), 'hex'),
    Buffer.from(args.p_tag.slice(2), 'hex'),
    Buffer.from(args.p_ciphertext.slice(2), 'hex')
  ]).toString('base64')
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

function errorResponse(status, headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  )

  return {
    ok: false,
    status,
    headers: { get: (name) => normalized[String(name).toLowerCase()] ?? null },
    body: { cancel: async () => {} },
    json: async () => {
      throw new Error('el cuerpo de un error no debe leerse')
    }
  }
}

/**
 * Servicio falso con las RPC de K10/K35/K36/K38/K44 en memoria. Aplica el
 * fence del lease: una escritura con otro owner devuelve error o false y no
 * toca el estado. El cursor K44 se guarda como fila única y solo avanza con el
 * owner vigente.
 */
function createService({
  acquire = true,
  tokenRow = null,
  finishResult = true,
  finishIndefiniteResult = true,
  cursor = null,
  exclusiveLease = false,
  cursorReadFails = false
} = {}) {
  const state = {
    tokenRow,
    snapshots: new Map(),
    leaseOwner: null,
    leaseExpiresAt: null,
    finish: null,
    finishIndefinite: null,
    cursor,
    cursorAdvances: [],
    rejectedCursorAdvances: 0
  }
  const calls = []

  const service = {
    async rpc(name, args) {
      calls.push({ name, args })

      if (name === 'kubios_try_acquire_sync') {
        if (!acquire) return { data: false, error: null }
        if (exclusiveLease && state.leaseOwner !== null) return { data: false, error: null }
        state.leaseOwner = args.p_lease_owner
        state.leaseExpiresAt = NOW + args.p_lease_seconds * 1_000
        return { data: true, error: null }
      }

      if (name === 'kubios_get_sync_cursor') {
        if (cursorReadFails) return { data: null, error: { message: 'cursor_read_failed' } }
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
        state.cursorAdvances.push(args)
        if (
          state.leaseOwner !== args.p_lease_owner ||
          state.leaseExpiresAt === null ||
          state.leaseExpiresAt <= NOW
        ) {
          state.rejectedCursorAdvances += 1
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
          return { data: null, error: { code: 'P0001', message: 'kubios_token_write_denied' } }
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
          return {
            data: null,
            error: { code: 'P0001', message: 'kubios_sync_lease_owner_mismatch' }
          }
        }
        state.snapshots.set(`${args.p_team_id}:${args.p_member_id}`, args)
        return { data: '2027-01-01T00:00:00+00:00', error: null }
      }

      if (name === 'kubios_finish_sync') {
        state.finish = args
        if (state.leaseOwner !== args.p_lease_owner) return { data: false, error: null }
        state.leaseOwner = null
        state.leaseExpiresAt = null
        return { data: finishResult, error: null }
      }

      if (name === 'kubios_finish_sync_indefinite') {
        state.finishIndefinite = args
        if (state.leaseOwner !== args.p_lease_owner) return { data: false, error: null }
        state.leaseOwner = null
        state.leaseExpiresAt = null
        return { data: finishIndefiniteResult, error: null }
      }

      return { data: null, error: { message: 'rpc_no_soportada' } }
    }
  }

  const expireLease = () => {
    state.leaseOwner = null
    state.leaseExpiresAt = null
  }

  return {
    service,
    state,
    calls,
    expireLease,
    callsNamed: (name) => calls.filter((call) => call.name === name)
  }
}

/**
 * `apiFetch` falso. Los resultados de cada miembro se declaran como array (JSON
 * 200), como función (respuesta o error propio) o se omiten (lista vacía).
 */
function createApiFetch({
  members = [],
  results = {},
  userSelf = {
    user: {
      teams: [{ team_id: TEAM_ID, name: 'Diabetes Tracker - H2TRAIN' }]
    }
  }
} = {}) {
  const calls = { team: 0, userSelf: 0, results: [] }

  const apiFetch = async (url) => {
    if (url.includes('/v1/user/self')) {
      calls.userSelf += 1
      if (typeof userSelf === 'function') return userSelf()
      return jsonResponse(userSelf)
    }

    if (url.includes('/v2/team/team/')) {
      calls.team += 1
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

function createLoginAuthFetch({ idToken, status = 302 } = {}) {
  const calls = []

  const authFetch = async (url, init) => {
    calls.push({ url, init })

    const location = `https://analysis.kubioscloud.com/v1/portal/login#id_token=${idToken}&token_type=Bearer`
    return new Response(null, { status, headers: { location } })
  }

  return { authFetch, calls }
}

function assertDecryptionFails(operation) {
  assert.throws(operation, (error) => {
    assert.equal(error.name, 'KubiosCryptoError')
    assert.equal(error.code, 'decryption_failed')
    return true
  })
}

/* ------------------------------------------------------------------------- *
 * 1. Éxito
 * ------------------------------------------------------------------------- */

test('éxito: token K36 sembrado, dos snapshots, ok 2/0 y finish de éxito', async () => {
  const seeded = seedToken()
  const { service, state, calls, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }, { team_user_id: MEMBER_B }],
    results: {
      [MEMBER_A]: [{ result_id: 'sintetico-a', synthetic_metric: 1 }],
      [MEMBER_B]: [{ result_id: 'sintetico-b', synthetic_metric: 2 }]
    }
  })

  let authCalls = 0
  const authFetch = async () => {
    authCalls += 1
    throw new Error('no debe llamarse al login si el token guardado es válido')
  }

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 2, failed: 0 })
  assert.equal(authCalls, 0, 'un token válido no debe provocar login')
  assert.equal(state.snapshots.size, 2)

  const [acquire] = calls
  assert.equal(acquire.name, 'kubios_try_acquire_sync')
  assert.equal(acquire.args.p_team_id, TEAM_ID)
  assert.equal(acquire.args.p_lease_seconds, 120)
  assert.match(acquire.args.p_lease_owner, UUID_PATTERN)

  assert.deepEqual(
    callsNamed('kubios_get_token').map((call) => call.args),
    [{ p_team_id: TEAM_ID }]
  )

  const writes = callsNamed('kubios_write_snapshot')
  assert.equal(writes.length, 2)
  for (const write of writes) {
    assert.equal(write.args.p_team_id, TEAM_ID)
    assert.equal(write.args.p_lease_owner, acquire.args.p_lease_owner)
    assert.equal(write.args.p_key_version, 1)
    assert.match(write.args.p_nonce, /^\\x[0-9a-f]{24}$/)
    assert.match(write.args.p_tag, /^\\x[0-9a-f]{32}$/)
    assert.match(write.args.p_ciphertext, /^\\x[0-9a-f]+$/)
  }
  assert.deepEqual(
    new Set(writes.map((write) => write.args.p_member_id)),
    new Set([MEMBER_A, MEMBER_B])
  )

  const finish = calls.at(-1)
  assert.equal(finish.name, 'kubios_finish_sync')
  assert.deepEqual(finish.args, {
    p_team_id: TEAM_ID,
    p_lease_owner: acquire.args.p_lease_owner,
    p_success: true,
    p_error_code: null,
    p_retry_after_seconds: null
  })
})

/* ------------------------------------------------------------------------- *
 * 2. Vacíos legítimos
 * ------------------------------------------------------------------------- */

test('equipo sin miembros: ok 0/0, sin snapshots y finish de éxito', async () => {
  const seeded = seedToken()
  const { service, state, calls } = createService({ tokenRow: seeded.row })
  const { apiFetch, calls: apiCalls } = createApiFetch({ members: [] })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 0, failed: 0 })
  assert.equal(apiCalls.team, 1)
  assert.deepEqual(apiCalls.results, [])
  assert.equal(state.snapshots.size, 0)

  const finish = calls.at(-1)
  assert.equal(finish.name, 'kubios_finish_sync')
  assert.equal(finish.args.p_success, true)
  assert.equal(finish.args.p_error_code, null)
  assert.equal(finish.args.p_retry_after_seconds, null)
})

test('miembro con results vacío: snapshot exacto {"results":[]} y ok 1/0', async () => {
  const seeded = seedToken()
  const { service, calls, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: [] }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })

  const [write] = callsNamed('kubios_write_snapshot')
  assert.deepEqual(Object.keys(write.args).sort(), [
    'p_ciphertext',
    'p_key_version',
    'p_lease_owner',
    'p_member_id',
    'p_nonce',
    'p_tag',
    'p_team_id'
  ])

  const plaintext = decryptKubiosSnapshot(
    envelopeFromArgs(write.args),
    { teamId: TEAM_ID, memberId: MEMBER_A },
    CRYPTO_OPTIONS
  )
  assert.equal(plaintext, '{"results":[]}')
  assert.equal(calls.at(-1).name, 'kubios_finish_sync')
})

/* ------------------------------------------------------------------------- *
 * 3. Fallo parcial que conserva el snapshot anterior
 * ------------------------------------------------------------------------- */

test('fallo de red de un miembro: partial 1/1, conserva su snapshot y cierra igual', async () => {
  const seeded = seedToken()
  const { service, state, calls, callsNamed } = createService({ tokenRow: seeded.row })

  const previousSnapshot = {
    p_team_id: TEAM_ID,
    p_member_id: MEMBER_B,
    p_lease_owner: PREVIOUS_OWNER,
    p_ciphertext: '\\xdeadbeef',
    p_nonce: `\\x${'11'.repeat(12)}`,
    p_tag: `\\x${'22'.repeat(16)}`,
    p_key_version: 1
  }
  state.snapshots.set(`${TEAM_ID}:${MEMBER_B}`, previousSnapshot)

  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }, { team_user_id: MEMBER_B }],
    results: {
      [MEMBER_A]: [{ synthetic: true }],
      [MEMBER_B]: () => {
        throw new TypeError('fallo de red sintético')
      }
    }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 1, failed: 1 })
  assert.equal(
    state.snapshots.get(`${TEAM_ID}:${MEMBER_B}`),
    previousSnapshot,
    'el snapshot previo del miembro fallido no debe cambiar'
  )

  const writes = callsNamed('kubios_write_snapshot')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].args.p_member_id, MEMBER_A)

  const finish = calls.at(-1)
  assert.equal(finish.name, 'kubios_finish_sync')
  assert.deepEqual(finish.args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_success: false,
    p_error_code: 'members.partial',
    p_retry_after_seconds: null
  })
})

/* ------------------------------------------------------------------------- *
 * 4. Lease ocupado
 * ------------------------------------------------------------------------- */

test('lease ocupado: locked 0/0 sin token, sin API, sin escrituras y sin finish', async () => {
  const { service, calls } = createService({ acquire: false })

  let apiCalls = 0
  let authCalls = 0

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async () => {
      apiCalls += 1
      return jsonResponse({ members: [] })
    },
    authFetch: async () => {
      authCalls += 1
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'locked', synced: 0, failed: 0 })
  assert.equal(apiCalls, 0)
  assert.equal(authCalls, 0)
  assert.deepEqual(
    calls.map((call) => call.name),
    ['kubios_try_acquire_sync']
  )
})

/* ------------------------------------------------------------------------- *
 * 5. 429 global y persistencia de la pausa
 * ------------------------------------------------------------------------- */

test('429 de un miembro: throttled 0/1 con Retry-After=3 y pausa persistida', async () => {
  const seeded = seedToken()
  const { service, state, calls } = createService({ tokenRow: seeded.row })
  const { apiFetch, calls: apiCalls } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: {
      [MEMBER_A]: () => errorResponse(429, { 'Retry-After': '3' })
    }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryAfterSeconds: 3
  })
  assert.deepEqual(apiCalls.results, [MEMBER_A])
  assert.equal(state.snapshots.size, 0)

  const finish = calls.at(-1)
  assert.equal(finish.name, 'kubios_finish_sync')
  assert.deepEqual(finish.args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_success: false,
    p_error_code: 'rate_limited',
    p_retry_after_seconds: 3
  })
})

test('429 detiene la programación de miembros nuevos', async () => {
  const seeded = seedToken()
  const { service } = createService({ tokenRow: seeded.row })
  const requested = []

  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      return jsonResponse({
        members: [
          { team_user_id: MEMBER_A },
          { team_user_id: MEMBER_B },
          { team_user_id: MEMBER_C }
        ]
      })
    }

    const memberId = url.slice(url.lastIndexOf('/') + 1)
    requested.push(memberId)

    if (memberId === MEMBER_A) return errorResponse(429, { 'Retry-After': '3' })
    if (memberId === MEMBER_B) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      return jsonResponse({ results: [{ b: true }] })
    }
    return jsonResponse({ results: [{ c: true }] })
  }

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 1,
    failed: 2,
    retryAfterSeconds: 3
  })
  assert.ok(requested.includes(MEMBER_A))
  assert.ok(requested.includes(MEMBER_B))
  assert.ok(!requested.includes(MEMBER_C), 'el miembro posterior al 429 no debe programarse')
})

/* ------------------------------------------------------------------------- *
 * 6. Conversión bytea y mismo owner
 * ------------------------------------------------------------------------- */

test('conversión: token y snapshot en \\x hex reconstruyen el sobre y descifran igual', async () => {
  const idToken = syntheticJwt(Math.floor((NOW + 7_200_000) / 1000))
  const auth = createLoginAuthFetch({ idToken })
  const results = [{ result_id: 'r1' }, { result_id: 'r2', nested: { x: [1, 2] } }]

  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: results }
  })
  const { service, state, calls, callsNamed } = createService()

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: auth.authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })
  assert.equal(auth.calls.length, 1)
  assert.equal(auth.calls[0].init.method, 'POST')
  assert.equal(auth.calls[0].init.redirect, 'manual')
  assert.ok(
    auth.calls[0].init.signal instanceof AbortSignal,
    'el login debe recibir una señal de cancelación'
  )

  const [acquire] = calls
  const [tokenWrite] = callsNamed('kubios_write_token')
  const [snapshotWrite] = callsNamed('kubios_write_snapshot')

  assert.ok(tokenWrite, 'el login debe persistir el token cifrado')
  assert.equal(tokenWrite.args.p_team_id, TEAM_ID)
  assert.equal(tokenWrite.args.p_lease_owner, acquire.args.p_lease_owner)
  assert.equal(tokenWrite.args.p_key_version, 1)
  assert.match(tokenWrite.args.p_nonce, /^\\x[0-9a-f]{24}$/)
  assert.match(tokenWrite.args.p_tag, /^\\x[0-9a-f]{32}$/)
  assert.match(tokenWrite.args.p_ciphertext, /^\\x[0-9a-f]+$/)
  assert.equal(
    tokenWrite.args.p_expires_at,
    new Date(Math.floor((NOW + 7_200_000) / 1000) * 1000).toISOString()
  )

  assert.equal(
    decryptKubiosToken(
      envelopeFromArgs(tokenWrite.args),
      { teamId: TEAM_ID, memberId: TEAM_ID },
      CRYPTO_OPTIONS
    ),
    idToken
  )

  assert.equal(snapshotWrite.args.p_lease_owner, acquire.args.p_lease_owner)
  assert.equal(snapshotWrite.args.p_team_id, TEAM_ID)
  assert.equal(snapshotWrite.args.p_member_id, MEMBER_A)
  assert.equal(
    decryptKubiosSnapshot(
      envelopeFromArgs(snapshotWrite.args),
      { teamId: TEAM_ID, memberId: MEMBER_A },
      CRYPTO_OPTIONS
    ),
    JSON.stringify({ results })
  )
  assert.equal(state.snapshots.size, 1)
})

/* ------------------------------------------------------------------------- *
 * 7. Aislamiento del cifrado
 * ------------------------------------------------------------------------- */

test('aislamiento: el snapshot no descifra con otro miembro/equipo y el token exige memberId=teamId', async () => {
  const idToken = syntheticJwt(Math.floor((NOW + 7_200_000) / 1000))
  const auth = createLoginAuthFetch({ idToken })
  const results = [{ synthetic_metric: 3 }]

  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: results }
  })
  const { service, callsNamed } = createService()

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: auth.authFetch,
    now: () => NOW
  })
  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })

  const tokenEnvelope = envelopeFromArgs(callsNamed('kubios_write_token')[0].args)
  const snapshotEnvelope = envelopeFromArgs(callsNamed('kubios_write_snapshot')[0].args)

  assert.equal(
    decryptKubiosToken(tokenEnvelope, { teamId: TEAM_ID, memberId: TEAM_ID }, CRYPTO_OPTIONS),
    idToken
  )
  assertDecryptionFails(() =>
    decryptKubiosToken(tokenEnvelope, { teamId: TEAM_ID, memberId: MEMBER_A }, CRYPTO_OPTIONS)
  )
  assertDecryptionFails(() =>
    decryptKubiosToken(tokenEnvelope, { teamId: OTHER_TEAM_ID, memberId: OTHER_TEAM_ID }, CRYPTO_OPTIONS)
  )

  assert.equal(
    decryptKubiosSnapshot(
      snapshotEnvelope,
      { teamId: TEAM_ID, memberId: MEMBER_A },
      CRYPTO_OPTIONS
    ),
    JSON.stringify({ results })
  )
  assertDecryptionFails(() =>
    decryptKubiosSnapshot(
      snapshotEnvelope,
      { teamId: TEAM_ID, memberId: MEMBER_B },
      CRYPTO_OPTIONS
    )
  )
  assertDecryptionFails(() =>
    decryptKubiosSnapshot(
      snapshotEnvelope,
      { teamId: OTHER_TEAM_ID, memberId: MEMBER_A },
      CRYPTO_OPTIONS
    )
  )
})

/* ------------------------------------------------------------------------- *
 * 8. Concurrencia máxima 2
 * ------------------------------------------------------------------------- */

test('concurrencia: cuatro miembros con respuestas diferidas, máximo 2 en vuelo', async () => {
  const seeded = seedToken()
  const { service } = createService({ tokenRow: seeded.row })
  const members = [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D]

  let inFlight = 0
  let maxInFlight = 0
  let started = 0

  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      return jsonResponse({ members: members.map((teamUserId) => ({ team_user_id: teamUserId })) })
    }

    started += 1
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)

    try {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return jsonResponse({ results: [{ synthetic: true }] })
    } finally {
      inFlight -= 1
    }
  }

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 4, failed: 0 })
  assert.equal(started, 4)
  assert.equal(maxInFlight, 2, 'nunca debe haber más de dos fetches de resultados en vuelo')
})

/* ------------------------------------------------------------------------- *
 * 9. 401 individual
 * ------------------------------------------------------------------------- */

test('401 de un miembro: partial 1/1, sin reautenticar y sin bucle', async () => {
  const idToken = syntheticJwt(Math.floor((NOW + 7_200_000) / 1000))
  const auth = createLoginAuthFetch({ idToken })

  const { apiFetch, calls: apiCalls } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }, { team_user_id: MEMBER_B }],
    results: {
      [MEMBER_A]: () => errorResponse(401),
      [MEMBER_B]: [{ fine: true }]
    }
  })

  const { service, calls } = createService()

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: auth.authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 1, failed: 1 })
  assert.equal(auth.calls.length, 1, 'un 401 de miembro no debe reautenticar')
  assert.equal(
    apiCalls.results.filter((memberId) => memberId === MEMBER_A).length,
    1,
    'un 401 de miembro no debe reintentarse'
  )
  assert.equal(calls.at(-1).name, 'kubios_finish_sync')
  assert.equal(calls.at(-1).args.p_error_code, 'members.partial')
})

/* ------------------------------------------------------------------------- *
 * 10. Fetch de token acotado
 * ------------------------------------------------------------------------- */

test('login que nunca responde: el timeout acota, devuelve partial y cierra el lease', async () => {
  const { service, calls } = createService()

  const authFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(new Error('abortado'))
        return
      }
      signal?.addEventListener('abort', () => reject(new Error('abortado')), { once: true })
    })

  let apiCalls = 0
  const started = Date.now()
  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async () => {
      apiCalls += 1
      return jsonResponse({ members: [] })
    },
    authFetch,
    now: () => NOW,
    timeoutMs: 25
  })
  const elapsed = Date.now() - started

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.ok(elapsed < 2_000, `el timeout tardó demasiado: ${elapsed} ms`)
  assert.equal(apiCalls, 0, 'sin token no se llama a la API de datos')

  const finish = calls.at(-1)
  assert.equal(finish.name, 'kubios_finish_sync')
  assert.deepEqual(finish.args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_success: false,
    p_error_code: 'token.unavailable',
    p_retry_after_seconds: null
  })
})

/* ------------------------------------------------------------------------- *
 * Casos límite adicionales
 * ------------------------------------------------------------------------- */

test('teamId que no es UUID: partial 0/1 sin tocar la base', async () => {
  const { service, calls } = createService()

  const result = await runKubiosSync({
    service,
    env: { ...ENV, KUBIOS_TEAM_ID: 'equipo-sin-uuid' },
    apiFetch: async () => jsonResponse({ members: [] }),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(calls.length, 0)
})

test('sin URL ni clave de servicio: partial 0/1 sin red ni fetch global', async () => {
  const originalFetch = globalThis.fetch
  let globalFetchCalls = 0
  globalThis.fetch = async () => {
    globalFetchCalls += 1
    throw new Error('sin red permitida')
  }

  try {
    const result = await runKubiosSync({
      env: ENV,
      apiFetch: async () => {
        globalFetchCalls += 1
        return jsonResponse({ members: [] })
      },
      authFetch: async () => {
        globalFetchCalls += 1
        throw new Error('sin red permitida')
      }
    })
    assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
    assert.equal(globalFetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fallo de la RPC de lease: partial 0/1 sin finish', async () => {
  const calls = []
  const service = {
    async rpc(name, args) {
      calls.push({ name, args })
      throw new Error('fallo sintético de base')
    }
  }

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async () => jsonResponse({ members: [] }),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.deepEqual(
    calls.map((call) => call.name),
    ['kubios_try_acquire_sync']
  )
})

test('finish no confirmado tras ok: degrada a partial sin retryAfterSeconds', async () => {
  const seeded = seedToken()
  const { service, calls } = createService({ tokenRow: seeded.row, finishResult: false })
  const { apiFetch } = createApiFetch({ members: [] })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal('retryAfterSeconds' in result, false)
  assert.equal(calls.at(-1).name, 'kubios_finish_sync')
})

test('fila K36 inválida: falla cerrado, no reautentica y no la sobrescribe', async () => {
  const corruptRow = {
    ciphertext: `\\x${'aa'.repeat(10)}`,
    nonce: `\\x${'bb'.repeat(5)}`,
    tag: `\\x${'cc'.repeat(16)}`,
    key_version: 1,
    expires_at: '2027-01-01T00:00:00.000Z'
  }
  const { service, state, calls } = createService({ tokenRow: corruptRow })

  let authCalls = 0
  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async () => jsonResponse({ members: [] }),
    authFetch: async () => {
      authCalls += 1
      throw new Error('no debe reautenticar sobre una fila inválida')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(authCalls, 0)
  assert.equal(state.tokenRow, corruptRow, 'la fila inválida no debe reescribirse')
  assert.equal(calls.at(-1).args.p_error_code, 'token.unavailable')
})

test('429 en el listado de miembros: throttled 0/1 con la pausa persistida', async () => {
  const seeded = seedToken()
  const { service, calls } = createService({ tokenRow: seeded.row })

  const apiFetch = async () => errorResponse(429, { 'Retry-After': '7' })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryAfterSeconds: 7
  })
  assert.deepEqual(calls.at(-1).args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_success: false,
    p_error_code: 'rate_limited',
    p_retry_after_seconds: 7
  })
})

test('429 sin Retry-After usa una pausa prudente de 60 s', async () => {
  const seeded = seedToken()
  const { service, calls } = createService({ tokenRow: seeded.row })
  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async (url) =>
      url.includes('/v2/team/team/')
        ? jsonResponse({ members: [{ team_user_id: MEMBER_A }] })
        : errorResponse(429),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryAfterSeconds: 60
  })
  assert.equal(calls.at(-1).name, 'kubios_finish_sync')
  assert.equal(calls.at(-1).args.p_retry_after_seconds, 60)
})

test('429 con Retry-After mayor de un día se persiste exacto, sin recortar a 86400', async () => {
  for (const seconds of [86_401, 100_000, 999_999]) {
    const seeded = seedToken()
    const { service, calls } = createService({ tokenRow: seeded.row })
    const { apiFetch } = createApiFetch({
      members: [{ team_user_id: MEMBER_A }],
      results: { [MEMBER_A]: () => errorResponse(429, { 'Retry-After': String(seconds) }) }
    })

    const result = await runKubiosSync({
      service,
      env: ENV,
      apiFetch,
      authFetch: async () => {
        throw new Error('sin login esperado')
      },
      now: () => NOW
    })

    assert.deepEqual(result, {
      status: 'throttled',
      synced: 0,
      failed: 1,
      retryAfterSeconds: seconds
    })
    assert.deepEqual(calls.at(-1).args, {
      p_team_id: TEAM_ID,
      p_lease_owner: calls[0].args.p_lease_owner,
      p_success: false,
      p_error_code: 'rate_limited',
      p_retry_after_seconds: seconds
    })
  }
})

test('429 con fecha HTTP de tres días se persiste como pausa finita equivalente', async () => {
  const seeded = seedToken()
  const { service, calls } = createService({ tokenRow: seeded.row })
  const retryAt = new Date(Date.now() + 3 * 86_400_000).toUTCString()
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: () => errorResponse(429, { 'Retry-After': retryAt }) }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.equal(result.status, 'throttled')
  assert.equal(result.synced, 0)
  assert.equal(result.failed, 1)
  assert.equal('retryIndefinite' in result, false)
  assert.ok(
    result.retryAfterSeconds >= 3 * 86_400 - 2 && result.retryAfterSeconds <= 3 * 86_400,
    `pausa fuera de rango: ${result.retryAfterSeconds}`
  )
  assert.equal(
    calls.at(-1).args.p_retry_after_seconds,
    result.retryAfterSeconds,
    'la RPC debe recibir exactamente los segundos publicados'
  )
})

test('Retry-After en el máximo int4 es finite; un segundo más usa la pausa indefinida', async () => {
  const MAX_INT4 = 2_147_483_647

  const seeded = seedToken()
  const finite = createService({ tokenRow: seeded.row })
  const { apiFetch: finiteFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: () => errorResponse(429, { 'Retry-After': String(MAX_INT4) }) }
  })
  const finiteResult = await runKubiosSync({
    service: finite.service,
    env: ENV,
    apiFetch: finiteFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })
  assert.deepEqual(finiteResult, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryAfterSeconds: MAX_INT4
  })
  assert.equal(finite.calls.at(-1).args.p_retry_after_seconds, MAX_INT4)

  const above = createService({ tokenRow: seeded.row })
  const { apiFetch: aboveFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: {
      [MEMBER_A]: () => errorResponse(429, { 'Retry-After': String(MAX_INT4 + 1) })
    }
  })
  const aboveResult = await runKubiosSync({
    service: above.service,
    env: ENV,
    apiFetch: aboveFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })
  assert.deepEqual(aboveResult, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryIndefinite: true
  })
  assert.equal(above.callsNamed('kubios_finish_sync').length, 0)
  assert.equal(above.callsNamed('kubios_finish_sync_indefinite').length, 1)
})

test('429 con Retry-After desbordado usa la RPC indefinida y no cae a 60 s', async () => {
  const seeded = seedToken()
  const { service, state, calls, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: {
      [MEMBER_A]: () => errorResponse(429, { 'Retry-After': '999999999999999999999' })
    }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryIndefinite: true
  })
  assert.equal('retryAfterSeconds' in result, false)
  assert.equal(callsNamed('kubios_finish_sync').length, 0, 'no debe usarse la pausa finite')
  assert.equal(state.finish, null)

  const [indefinite] = callsNamed('kubios_finish_sync_indefinite')
  assert.ok(indefinite, 'debe invocarse la RPC de pausa indefinida')
  assert.deepEqual(indefinite.args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_error_code: 'rate_limited'
  })
  assert.equal(state.leaseOwner, null)
})

test('429 del login con Retry-After desbordado también usa la pausa indefinida', async () => {
  const { service, calls, callsNamed } = createService()

  let apiCalls = 0
  const authFetch = async () =>
    new Response(null, {
      status: 429,
      headers: { 'Retry-After': '999999999999999999999' }
    })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async () => {
      apiCalls += 1
      return jsonResponse({ members: [] })
    },
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryIndefinite: true
  })
  assert.equal(apiCalls, 0, 'sin token no se llama a la API de datos')
  assert.equal(callsNamed('kubios_finish_sync').length, 0)
  assert.deepEqual(callsNamed('kubios_finish_sync_indefinite')[0].args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_error_code: 'rate_limited'
  })
})

test('pausa indefinida no confirmada: degrada a partial sin fingir plazo', async () => {
  const seeded = seedToken()
  const { service, calls } = createService({
    tokenRow: seeded.row,
    finishIndefiniteResult: false
  })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: {
      [MEMBER_A]: () => errorResponse(429, { 'Retry-After': '999999999999999999999' })
    }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal('retryAfterSeconds' in result, false)
  assert.equal('retryIndefinite' in result, false)
  assert.equal(calls.at(-1).name, 'kubios_finish_sync_indefinite')
})

test('finish no confirmado tras throttled: partial sin retryAfterSeconds engañoso', async () => {
  const seeded = seedToken()
  const { service } = createService({ tokenRow: seeded.row, finishResult: false })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async (url) =>
      url.includes('/v2/team/team/')
        ? jsonResponse({ members: [{ team_user_id: MEMBER_A }] })
        : errorResponse(429, { 'Retry-After': '3' }),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal('retryAfterSeconds' in result, false)
})

test('429 del login: throttled 0/1 con la pausa del token persistida', async () => {
  const { service, calls } = createService()

  let apiCalls = 0
  const authFetch = async () =>
    new Response(null, { status: 429, headers: { 'Retry-After': '12' } })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async () => {
      apiCalls += 1
      return jsonResponse({ members: [] })
    },
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryAfterSeconds: 12
  })
  assert.equal(apiCalls, 0, 'sin token no se llama a la API de datos')
  assert.deepEqual(calls.at(-1).args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_success: false,
    p_error_code: 'rate_limited',
    p_retry_after_seconds: 12
  })
})

/* ------------------------------------------------------------------------- *
 * K43 - Presupuesto global, plazos y fence del lease
 * ------------------------------------------------------------------------- */

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const K43_BUDGET = Object.freeze({
  budgetMs: 260,
  finishReserveMs: 90,
  responseReserveMs: 20
})

test('K43 defaults: 21 s de trabajo + 4 s de cierre + 1 s de respuesta', () => {
  assert.equal(DEFAULT_KUBIOS_SYNC_BUDGET_MS, 26_000)
  assert.equal(DEFAULT_KUBIOS_SYNC_FINISH_RESERVE_MS, 4_000)
  assert.equal(DEFAULT_KUBIOS_SYNC_RESPONSE_RESERVE_MS, 1_000)
  assert.equal(
    DEFAULT_KUBIOS_SYNC_BUDGET_MS -
      DEFAULT_KUBIOS_SYNC_FINISH_RESERVE_MS -
      DEFAULT_KUBIOS_SYNC_RESPONSE_RESERVE_MS,
    21_000
  )
  assert.ok(DEFAULT_KUBIOS_SYNC_BUDGET_MS < 30_000, 'debe quedar bajo el timeout de pg_net')
})

test('K43 fetch de miembros que ignora AbortSignal: corta por presupuesto y cierra', async () => {
  const seeded = seedToken()
  const { service, calls } = createService({ tokenRow: seeded.row })
  const started = Date.now()

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: () => new Promise(() => {}),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K43_BUDGET
  })
  const elapsed = Date.now() - started

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.ok(elapsed < 1_500, `el presupuesto tardó demasiado: ${elapsed} ms`)

  const finish = calls.at(-1)
  assert.equal(finish.name, 'kubios_finish_sync')
  assert.deepEqual(finish.args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_success: false,
    p_error_code: 'sync.deadline_exceeded',
    p_retry_after_seconds: null
  })
})

test('K43 fetch de login que ignora AbortSignal: corta por presupuesto y cierra', async () => {
  const { service, calls } = createService()
  const started = Date.now()

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async () => {
      throw new Error('sin token no debe llamarse a la API de datos')
    },
    authFetch: () => new Promise(() => {}),
    now: () => NOW,
    ...K43_BUDGET
  })
  const elapsed = Date.now() - started

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.ok(elapsed < 1_500, `el presupuesto tardó demasiado: ${elapsed} ms`)
  assert.equal(calls.at(-1).name, 'kubios_finish_sync')
  assert.equal(calls.at(-1).args.p_error_code, 'sync.deadline_exceeded')
})

test('K43 RPC de token que nunca resuelve: partial y finish acotado', async () => {
  const calls = []
  let leaseOwner = null
  const service = {
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'kubios_try_acquire_sync') {
        leaseOwner = args.p_lease_owner
        return { data: true, error: null }
      }
      if (name === 'kubios_get_token') return new Promise(() => {})
      if (name === 'kubios_finish_sync') {
        if (leaseOwner !== args.p_lease_owner) return { data: false, error: null }
        leaseOwner = null
        return { data: true, error: null }
      }
      return { data: null, error: null }
    }
  }

  const started = Date.now()
  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async () => {
      throw new Error('sin token no debe llamarse a la API de datos')
    },
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K43_BUDGET
  })
  const elapsed = Date.now() - started

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.ok(elapsed < 1_500, `el presupuesto tardó demasiado: ${elapsed} ms`)
  assert.equal(calls.at(-1).name, 'kubios_finish_sync')
  assert.equal(calls.at(-1).args.p_error_code, 'sync.deadline_exceeded')
  assert.equal(leaseOwner, null, 'el cierre confirmado debe liberar el lease')
})

test('K43 RPC de lease que nunca resuelve: partial sin finish de un lease incierto', async () => {
  const calls = []
  const service = {
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'kubios_try_acquire_sync') return new Promise(() => {})
      return { data: null, error: null }
    }
  }

  const started = Date.now()
  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async () => jsonResponse({ members: [] }),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K43_BUDGET
  })
  const elapsed = Date.now() - started

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.ok(elapsed < 1_500, `el presupuesto tardó demasiado: ${elapsed} ms`)
  assert.deepEqual(
    calls.map((call) => call.name),
    ['kubios_try_acquire_sync'],
    'sin respuesta del lease no se cierra un intento ajeno'
  )
})

test('K43 salida parcial: deja de programar miembros y cuenta solo synced reales', async () => {
  const seeded = seedToken()
  const { service } = createService({ tokenRow: seeded.row })
  const requested = []

  // A termina rápido y su worker toma C; B y C se quedan colgados hasta el
  // plazo, de modo que ambos workers están ocupados cuando el presupuesto se
  // agota y D nunca llega a programarse.
  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      return jsonResponse({
        members: [
          { team_user_id: MEMBER_A },
          { team_user_id: MEMBER_B },
          { team_user_id: MEMBER_C },
          { team_user_id: MEMBER_D }
        ]
      })
    }

    const memberId = url.slice(url.lastIndexOf('/') + 1)
    requested.push(memberId)

    if (memberId === MEMBER_A) return jsonResponse({ results: [{ a: true }] })
    return new Promise(() => {})
  }

  const started = Date.now()
  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K43_BUDGET
  })
  const elapsed = Date.now() - started

  assert.deepEqual(result, { status: 'partial', synced: 1, failed: 3 })
  assert.ok(elapsed < 1_500, `el presupuesto tardó demasiado: ${elapsed} ms`)
  assert.deepEqual(new Set(requested), new Set([MEMBER_A, MEMBER_B, MEMBER_C]))
  assert.ok(!requested.includes(MEMBER_D), 'no se programa un miembro nuevo tras agotar el presupuesto')
})

test('K43 finish que nunca resuelve: parcial, nunca ok, dentro de la reserva', async () => {
  const seeded = seedToken()
  const calls = []
  let leaseOwner = null
  const service = {
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'kubios_try_acquire_sync') {
        leaseOwner = args.p_lease_owner
        return { data: true, error: null }
      }
      if (name === 'kubios_get_token') return { data: [seeded.row], error: null }
      if (name === 'kubios_finish_sync') return new Promise(() => {})
      return { data: null, error: null }
    }
  }

  const started = Date.now()
  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async (url) =>
      url.includes('/v2/team/team/') ? jsonResponse({ members: [] }) : jsonResponse({ results: [] }),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K43_BUDGET
  })
  const elapsed = Date.now() - started

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.ok(elapsed < 1_500, `la reserva de cierre tardó demasiado: ${elapsed} ms`)
  assert.equal(calls.at(-1).name, 'kubios_finish_sync')
})

test('K43 promesa abandonada: un snapshot tardío no escribe tras liberar el lease', async () => {
  const seeded = seedToken()
  const calls = []
  const snapshots = new Map()
  let leaseOwner = null
  const service = {
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'kubios_try_acquire_sync') {
        leaseOwner = args.p_lease_owner
        return { data: true, error: null }
      }
      if (name === 'kubios_get_token') return { data: [seeded.row], error: null }
      // Cursor nuevo explícito (`[]`): SYNC-03 ya no acepta `data: null` como
      // equipo sin cursor, y este caso prueba la promesa abandonada, no el
      // contrato del cursor.
      if (name === 'kubios_get_sync_cursor') return { data: [], error: null }
      if (name === 'kubios_write_snapshot') {
        if (args.p_member_id === MEMBER_B) await delay(160)
        if (leaseOwner !== args.p_lease_owner) {
          return { data: null, error: { message: 'kubios_sync_lease_owner_mismatch' } }
        }
        snapshots.set(args.p_member_id, args)
        return { data: '2027-01-01T00:00:00+00:00', error: null }
      }
      if (name === 'kubios_finish_sync') {
        if (leaseOwner !== args.p_lease_owner) return { data: false, error: null }
        leaseOwner = null
        return { data: true, error: null }
      }
      return { data: null, error: null }
    }
  }

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async (url) => {
      if (url.includes('/v2/team/team/')) {
        return jsonResponse({
          members: [{ team_user_id: MEMBER_A }, { team_user_id: MEMBER_B }]
        })
      }
      return jsonResponse({ results: [{ synthetic: true }] })
    },
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    budgetMs: 220,
    finishReserveMs: 100,
    responseReserveMs: 20
  })

  assert.deepEqual(result, { status: 'partial', synced: 1, failed: 1 })
  assert.equal(leaseOwner, null, 'el finish debe haber liberado el lease')

  await delay(220)
  assert.equal(
    snapshots.has(MEMBER_B),
    false,
    'el snapshot abandonado debe rechazarse por el fence owner/lease'
  )
})

test('K43 rechazo tardío de un fetch abandonado no produce unhandledRejection', async () => {
  const seeded = seedToken()
  const { service } = createService({ tokenRow: seeded.row })
  const unhandled = []
  const onUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)

  try {
    const result = await runKubiosSync({
      service,
      env: ENV,
      apiFetch: async (url) => {
        if (url.includes('/v2/team/team/')) {
          return jsonResponse({ members: [{ team_user_id: MEMBER_A }] })
        }
        return delay(160).then(() => {
          throw new Error('fallo tardío sintético')
        })
      },
      authFetch: async () => {
        throw new Error('sin login esperado')
      },
      now: () => NOW,
      budgetMs: 160,
      finishReserveMs: 80,
      responseReserveMs: 20
    })

    assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
    await delay(220)
    assert.deepEqual(unhandled, [], 'el rechazo tardío debe quedar observado')
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('K43 lease caducado: no se cierra como propio y el resultado no es ok', async () => {
  const seeded = seedToken()
  const { service, state, calls, callsNamed } = createService({ tokenRow: seeded.row })
  let clock = NOW

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async (url) => {
      if (url.includes('/v2/team/team/')) {
        return jsonResponse({ members: [{ team_user_id: MEMBER_A }] })
      }
      clock += 200_000
      return jsonResponse({ results: [{ a: true }] })
    },
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => clock,
    // createService aplica el fence del lease: el snapshot se escribe antes de
    // que el reloj avance y el cierre finito debe rechazarse localmente.
    leaseSeconds: 120
  })

  assert.deepEqual(result, { status: 'partial', synced: 1, failed: 1 })
  assert.equal(
    callsNamed('kubios_finish_sync').length,
    0,
    'un lease caducado no se cierra con la RPC finita'
  )
  assert.equal(calls.at(-1).name, 'kubios_write_snapshot')
  assert.equal(state.cursor, null, 'un lease caducado no puede mover el cursor')
  assert.equal(callsNamed('kubios_advance_sync_cursor').length, 0)
})

test('K43 lease efectivo: cubre el presupuesto aunque se pida uno corto', async () => {
  const seeded = seedToken()
  const { service, calls } = createService({ tokenRow: seeded.row })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async (url) =>
      url.includes('/v2/team/team/') ? jsonResponse({ members: [] }) : jsonResponse({ results: [] }),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    budgetMs: 20_000,
    leaseSeconds: 5
  })

  assert.deepEqual(result, { status: 'ok', synced: 0, failed: 0 })
  const [acquire] = calls
  assert.equal(acquire.name, 'kubios_try_acquire_sync')
  assert.equal(
    acquire.args.p_lease_seconds,
    35,
    'el lease debe cubrir 20 s de presupuesto + 15 s de margen'
  )
})

test('fila K36 con bytea de dos barras invertidas también se acepta', async () => {
  const seeded = seedToken()
  const doublePrefixed = (value) => `\\${value}`
  const doubleRow = {
    ...seeded.row,
    ciphertext: doublePrefixed(seeded.row.ciphertext),
    nonce: doublePrefixed(seeded.row.nonce),
    tag: doublePrefixed(seeded.row.tag)
  }

  const { service, callsNamed } = createService({ tokenRow: doubleRow })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: [{ synthetic: true }] }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })
  const [write] = callsNamed('kubios_write_snapshot')
  assert.equal(
    decryptKubiosSnapshot(
      envelopeFromArgs(write.args),
      { teamId: TEAM_ID, memberId: MEMBER_A },
      CRYPTO_OPTIONS
    ),
    '{"results":[{"synthetic":true}]}'
  )
})

/* ------------------------------------------------------------------------- *
 * K44 - cursor durable por equipo, fence de lease y reparto justo
 * ------------------------------------------------------------------------- */

const K44_BUDGET = Object.freeze({
  budgetMs: 260,
  finishReserveMs: 90,
  responseReserveMs: 20
})

const K44_SHORT_BUDGET = Object.freeze({
  budgetMs: 150,
  finishReserveMs: 70,
  responseReserveMs: 20
})

const K44_OWNER_ONE = '12121212-1212-4212-8212-121212121212'
const K44_OWNER_TWO = '34343434-3434-4434-8434-343434343434'

function k44Member(index) {
  return `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function neverResolves() {
  return new Promise(() => {})
}

function assertCursorRow(state, expected) {
  assert.ok(state.cursor !== null, 'el cursor debe existir')
  assert.equal(state.cursor.next_member_id, expected.next, 'next_member_id del cursor')
  assert.deepEqual(
    [...state.cursor.attempted_member_ids].sort(),
    [...expected.attempted].sort(),
    'attempted_member_ids del cursor'
  )
  assert.deepEqual(
    [...state.cursor.failed_member_ids].sort(),
    [...expected.failed].sort(),
    'failed_member_ids del cursor'
  )
}

test('K44 11 miembros: tres pasadas con presupuesto, empiezan por el no intentado y completan una vez', async () => {
  const ids = Array.from({ length: 11 }, (_, index) => k44Member(index + 1))
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({ tokenRow: seeded.row })
  const blocked = new Set()
  const requested = []

  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      // El proveedor entrega el orden inverso: el sincronizador debe imponer el
      // orden estable por UUID, no confiar en el orden de la respuesta.
      return jsonResponse({ members: [...ids].reverse().map((id) => ({ team_user_id: id })) })
    }

    const memberId = url.slice(url.lastIndexOf('/') + 1)
    requested.push(memberId)
    if (blocked.has(memberId)) return neverResolves()
    return jsonResponse({ results: [{ synthetic_member: memberId }] })
  }

  blocked.clear()
  blocked.add(ids[4])
  blocked.add(ids[5])
  const first = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K44_BUDGET
  })

  assert.deepEqual(first, { status: 'partial', synced: 4, failed: 7 })
  assert.deepEqual(requested.slice(0, 4), ids.slice(0, 4), 'los cuatro primeros en orden UUID')
  assertCursorRow(state, {
    next: ids[4],
    attempted: ids.slice(0, 4),
    failed: []
  })

  blocked.clear()
  blocked.add(ids[8])
  blocked.add(ids[9])
  requested.length = 0
  const second = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K44_BUDGET
  })

  assert.deepEqual(second, { status: 'partial', synced: 4, failed: 7 })
  assert.equal(requested[0], ids[4], 'la segunda pasada empieza por el primer no intentado')
  assertCursorRow(state, {
    next: ids[8],
    attempted: ids.slice(0, 8),
    failed: []
  })

  blocked.clear()
  requested.length = 0
  const third = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K44_BUDGET
  })

  assert.deepEqual(third, { status: 'ok', synced: 3, failed: 0 })
  assert.equal(requested[0], ids[8], 'la tercera pasada sigue en el primero no intentado')
  assertCursorRow(state, { next: null, attempted: [], failed: [] })
  assert.equal(state.snapshots.size, 11)
  assert.equal(callsNamed('kubios_advance_sync_cursor').length, 3)

  const writtenMembers = [...state.snapshots.keys()].map((key) => key.split(':')[1])
  assert.equal(new Set(writtenMembers).size, 11, 'cada miembro se sincronizó una sola vez')
})

test('K44 respuesta lenta: no se intenta un miembro sin presupuesto y el cursor no lo salta', async () => {
  const seeded = seedToken()
  const { service, state } = createService({ tokenRow: seeded.row })
  const requested = []

  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      return jsonResponse({
        members: [
          { team_user_id: MEMBER_A },
          { team_user_id: MEMBER_B },
          { team_user_id: MEMBER_C }
        ]
      })
    }

    requested.push(url.slice(url.lastIndexOf('/') + 1))
    return neverResolves()
  }

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K44_SHORT_BUDGET
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 3 })
  assert.deepEqual(new Set(requested), new Set([MEMBER_A, MEMBER_B]))
  assert.equal(requested.includes(MEMBER_C), false, 'sin presupuesto no se inicia otro miembro')
  assertCursorRow(state, { next: MEMBER_A, attempted: [], failed: [] })
})

test('K44 429: detiene la pasada, conserva el snapshot y deja el cursor en el limitado', async () => {
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({ tokenRow: seeded.row })
  const requested = []

  const previousSnapshot = {
    p_team_id: TEAM_ID,
    p_member_id: MEMBER_A,
    p_lease_owner: PREVIOUS_OWNER,
    p_ciphertext: '\\xdeadbeef',
    p_nonce: `\\x${'11'.repeat(12)}`,
    p_tag: `\\x${'22'.repeat(16)}`,
    p_key_version: 1
  }
  state.snapshots.set(`${TEAM_ID}:${MEMBER_A}`, previousSnapshot)

  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      return jsonResponse({
        members: [
          { team_user_id: MEMBER_A },
          { team_user_id: MEMBER_B },
          { team_user_id: MEMBER_C }
        ]
      })
    }

    const memberId = url.slice(url.lastIndexOf('/') + 1)
    requested.push(memberId)
    if (memberId === MEMBER_A) return errorResponse(429, { 'Retry-After': '3' })
    if (memberId === MEMBER_B) {
      await new Promise((resolve) => setTimeout(resolve, 40))
      return jsonResponse({ results: [{ b: true }] })
    }
    return jsonResponse({ results: [{ c: true }] })
  }

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K44_BUDGET
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 1,
    failed: 2,
    retryAfterSeconds: 3
  })
  assert.equal(requested.includes(MEMBER_C), false, 'no hay nuevos intentos tras el 429')
  assert.equal(state.snapshots.get(`${TEAM_ID}:${MEMBER_A}`), previousSnapshot)
  assert.equal(state.snapshots.has(`${TEAM_ID}:${MEMBER_C}`), false)
  assertCursorRow(state, { next: MEMBER_A, attempted: [MEMBER_B], failed: [] })

  const finish = callsNamed('kubios_finish_sync').at(-1)
  assert.equal(finish.args.p_error_code, 'rate_limited')
  assert.equal(finish.args.p_retry_after_seconds, 3)
})

test('K44 idempotencia: repetir una pasada completada no duplica snapshots ni retrocede el cursor', async () => {
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }, { team_user_id: MEMBER_B }],
    results: {
      [MEMBER_A]: [{ synthetic: 'a' }],
      [MEMBER_B]: [{ synthetic: 'b' }]
    }
  })

  const first = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(first, { status: 'ok', synced: 2, failed: 0 })
  assertCursorRow(state, { next: null, attempted: [], failed: [] })
  assert.equal(state.snapshots.size, 2)

  const second = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(second, { status: 'ok', synced: 2, failed: 0 })
  assert.equal(state.snapshots.size, 2, 'el upsert no duplica snapshots')
  assertCursorRow(state, { next: null, attempted: [], failed: [] })
  assert.equal(callsNamed('kubios_advance_sync_cursor').length, 2)
})

test('K44 error de miembro: no sobrescribe su snapshot, no da ok y permite reintento', async () => {
  const seeded = seedToken()
  const { service, state } = createService({ tokenRow: seeded.row })
  let failMemberA = true

  const previousSnapshot = {
    p_team_id: TEAM_ID,
    p_member_id: MEMBER_A,
    p_lease_owner: PREVIOUS_OWNER,
    p_ciphertext: '\\xcafebabe',
    p_nonce: `\\x${'33'.repeat(12)}`,
    p_tag: `\\x${'44'.repeat(16)}`,
    p_key_version: 1
  }
  state.snapshots.set(`${TEAM_ID}:${MEMBER_A}`, previousSnapshot)

  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      return jsonResponse({
        members: [
          { team_user_id: MEMBER_A },
          { team_user_id: MEMBER_B },
          { team_user_id: MEMBER_C }
        ]
      })
    }

    const memberId = url.slice(url.lastIndexOf('/') + 1)
    if (memberId === MEMBER_A && failMemberA) {
      throw new TypeError('fallo sintético de miembro')
    }
    return jsonResponse({ results: [{ synthetic_member: memberId }] })
  }

  const first = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(first, { status: 'partial', synced: 2, failed: 1 })
  assert.equal(
    state.snapshots.get(`${TEAM_ID}:${MEMBER_A}`),
    previousSnapshot,
    'el snapshot del miembro fallido no debe cambiar'
  )
  assertCursorRow(state, { next: MEMBER_A, attempted: [], failed: [] })

  failMemberA = false
  const second = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(second, { status: 'ok', synced: 3, failed: 0 })
  assert.notEqual(state.snapshots.get(`${TEAM_ID}:${MEMBER_A}`), previousSnapshot)
  assertCursorRow(state, { next: null, attempted: [], failed: [] })
})

test('K44 fallo en pasada parcial: el cursor avanza sin dar ok y el fallo se reintenta', async () => {
  const seeded = seedToken()
  const { service, state } = createService({ tokenRow: seeded.row })
  const ids = [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D]
  const blocked = new Set()
  let failMemberA = true

  const previousSnapshot = {
    p_team_id: TEAM_ID,
    p_member_id: MEMBER_A,
    p_lease_owner: PREVIOUS_OWNER,
    p_ciphertext: '\\xfeedface',
    p_nonce: `\\x${'55'.repeat(12)}`,
    p_tag: `\\x${'66'.repeat(16)}`,
    p_key_version: 1
  }
  state.snapshots.set(`${TEAM_ID}:${MEMBER_A}`, previousSnapshot)

  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      return jsonResponse({ members: ids.map((id) => ({ team_user_id: id })) })
    }

    const memberId = url.slice(url.lastIndexOf('/') + 1)
    if (blocked.has(memberId)) return neverResolves()
    if (memberId === MEMBER_A && failMemberA) {
      throw new TypeError('fallo sintético de miembro')
    }
    return jsonResponse({ results: [{ synthetic_member: memberId }] })
  }

  blocked.add(MEMBER_B)
  blocked.add(MEMBER_C)
  const first = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K44_SHORT_BUDGET
  })

  assert.deepEqual(first, { status: 'partial', synced: 0, failed: 4 })
  assert.equal(
    state.snapshots.get(`${TEAM_ID}:${MEMBER_A}`),
    previousSnapshot,
    'el fallo no sobrescribe el snapshot'
  )
  assertCursorRow(state, { next: MEMBER_B, attempted: [MEMBER_A], failed: [MEMBER_A] })

  blocked.clear()
  const second = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(second, { status: 'partial', synced: 3, failed: 1 })
  assertCursorRow(state, { next: MEMBER_A, attempted: [], failed: [] })
  assert.equal(state.snapshots.get(`${TEAM_ID}:${MEMBER_A}`), previousSnapshot)

  failMemberA = false
  const third = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(third, { status: 'ok', synced: 4, failed: 0 })
  assert.notEqual(state.snapshots.get(`${TEAM_ID}:${MEMBER_A}`), previousSnapshot)
  assertCursorRow(state, { next: null, attempted: [], failed: [] })
})

test('K44 grupo cambiante: baja del cursor, alta y reordenación avanzan sin repetir sin fin', async () => {
  const seeded = seedToken()
  const { service, state } = createService({ tokenRow: seeded.row })
  const initialMembers = [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D]
  const memberE = k44Member(5)
  let currentMembers = initialMembers
  const blocked = new Set()
  const requested = []

  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      return jsonResponse({
        members: currentMembers.map((teamUserId) => ({ team_user_id: teamUserId }))
      })
    }

    const memberId = url.slice(url.lastIndexOf('/') + 1)
    requested.push(memberId)
    if (blocked.has(memberId)) return neverResolves()
    return jsonResponse({ results: [{ synthetic_member: memberId }] })
  }

  blocked.add(MEMBER_C)
  blocked.add(MEMBER_D)
  const first = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K44_SHORT_BUDGET
  })

  assert.deepEqual(first, { status: 'partial', synced: 2, failed: 2 })
  assertCursorRow(state, {
    next: MEMBER_C,
    attempted: [MEMBER_A, MEMBER_B],
    failed: []
  })

  // Baja del miembro del cursor (C), alta de E y reordenación del proveedor.
  currentMembers = [memberE, MEMBER_D, MEMBER_B, MEMBER_A]
  blocked.clear()
  requested.length = 0

  const second = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    ...K44_BUDGET
  })

  assert.deepEqual(second, { status: 'ok', synced: 2, failed: 0 })
  assert.deepEqual(requested, [MEMBER_D, memberE], 'reanuda en el sucesor determinista de C')
  assert.equal(requested.includes(MEMBER_A), false, 'no repite los ya intentados')
  assertCursorRow(state, { next: null, attempted: [], failed: [] })
})

test('K44 dos owners: solo el owner vigente avanza el cursor; el stale no mueve estado', async () => {
  const seeded = seedToken()
  const { service, state } = createService({ tokenRow: seeded.row, exclusiveLease: true })
  const owners = [K44_OWNER_ONE, K44_OWNER_TWO]
  let firstMemberCall = true
  let releaseFirstMember
  let signalFirstMember
  const firstMemberGate = new Promise((resolve) => {
    releaseFirstMember = resolve
  })
  const firstMemberStarted = new Promise((resolve) => {
    signalFirstMember = resolve
  })

  const apiFetch = async (url) => {
    if (url.includes('/v2/team/team/')) {
      return jsonResponse({
        members: [{ team_user_id: MEMBER_A }, { team_user_id: MEMBER_B }]
      })
    }

    const memberId = url.slice(url.lastIndexOf('/') + 1)
    if (memberId === MEMBER_A && firstMemberCall) {
      firstMemberCall = false
      signalFirstMember()
      await firstMemberGate
    }
    return jsonResponse({ results: [{ synthetic_member: memberId }] })
  }

  const firstRun = runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    randomUUID: () => owners.shift(),
    timeoutMs: 5_000
  })

  await firstMemberStarted
  await new Promise((resolve) => setTimeout(resolve, 20))

  // El lease del owner1 se pierde y el owner2 lo toma antes de que el primero
  // persista su cursor.
  state.leaseOwner = null
  state.leaseExpiresAt = null
  const secondRun = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW,
    randomUUID: () => owners.shift(),
    timeoutMs: 5_000
  })

  assert.deepEqual(secondRun, { status: 'ok', synced: 2, failed: 0 })
  assertCursorRow(state, { next: null, attempted: [], failed: [] })
  const cursorAfterSecondRun = JSON.stringify(state.cursor)

  releaseFirstMember()
  const firstResult = await firstRun

  assert.notEqual(firstResult.status, 'ok', 'un owner reemplazado no puede declarar ok')
  assert.equal(state.rejectedCursorAdvances, 1, 'el avance del owner stale debe rechazarse')
  assert.equal(
    state.cursorAdvances.at(-1).p_lease_owner,
    K44_OWNER_ONE,
    'el ultimo intento de avance es del owner stale'
  )
  assert.equal(JSON.stringify(state.cursor), cursorAfterSecondRun, 'el cursor no cambia')
})

test('K44 equipo vacío: ok 0/0 y no mueve un cursor existente', async () => {
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({
    tokenRow: seeded.row,
    cursor: {
      next_member_id: MEMBER_B,
      attempted_member_ids: [MEMBER_A],
      failed_member_ids: []
    }
  })
  const before = JSON.stringify(state.cursor)

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async (url) =>
      url.includes('/v2/team/team/') ? jsonResponse({ members: [] }) : jsonResponse({ results: [] }),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 0, failed: 0 })
  assert.equal(JSON.stringify(state.cursor), before, 'el cursor no se mueve con el equipo vacío')
  assert.equal(callsNamed('kubios_get_sync_cursor').length, 0)
  assert.equal(callsNamed('kubios_advance_sync_cursor').length, 0)
})

test('K44 cursor no disponible: falla cerrado sin snapshots ni ok', async () => {
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({
    tokenRow: seeded.row,
    cursorReadFails: true
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch: async (url) =>
      url.includes('/v2/team/team/')
        ? jsonResponse({ members: [{ team_user_id: MEMBER_A }] })
        : jsonResponse({ results: [{ a: true }] }),
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(state.snapshots.size, 0)
  assert.equal(callsNamed('kubios_write_snapshot').length, 0)
  assert.equal(callsNamed('kubios_advance_sync_cursor').length, 0)
  assert.equal(callsNamed('kubios_finish_sync').at(-1).args.p_error_code, 'cursor.unavailable')
})

/* ------------------------------------------------------------------------- *
 * SYNC-01/SYNC-02/SYNC-03 y Retry-After - endurecimiento de la sincronización
 * ------------------------------------------------------------------------- */

/**
 * Envuelve el doble sintético para sustituir la respuesta de una única RPC.
 * Permite simular respuestas anómalas (data nula, cursor nulo, timestamp no
 * escalar) sin alterar el resto del comportamiento del doble ni la contabilidad
 * de llamadas.
 */
function withRpcResponse(base, name, handler) {
  const responses = []
  const service = {
    async rpc(rpcName, args) {
      if (rpcName === name) {
        base.calls.push({ name: rpcName, args })
        const response = await handler(args)
        responses.push(response)
        return response
      }
      return base.service.rpc(rpcName, args)
    }
  }
  return { service, responses }
}

function expectNoLogin() {
  throw new Error('sin login esperado')
}

test('SYNC-01 lista mixta: sincroniza los UUID válidos y cada inválido cuenta como fallo', async () => {
  // Previene el falso éxito: antes los miembros sin UUID se descartaban en
  // silencio y la pasada podía terminar ok con failed 0.
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch, calls: apiCalls } = createApiFetch({
    members: [
      { team_user_id: MEMBER_A },
      { team_user_id: 'miembro-sin-uuid' },
      { team_user_id: MEMBER_B },
      // Cadena no vacía que el cliente K13 acepta pero que no es un UUID.
      { team_user_id: '00000000-0000-4000-8000-00000000000Z' }
    ],
    results: {
      [MEMBER_A]: [{ synthetic: 'a' }],
      [MEMBER_B]: [{ synthetic: 'b' }]
    }
  })

  const first = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: expectNoLogin,
    now: () => NOW
  })

  assert.deepEqual(first, { status: 'partial', synced: 2, failed: 2 })
  assert.equal('retryAfterSeconds' in first, false)
  assert.equal(state.snapshots.size, 2, 'los dos UUID válidos sí se sincronizan')
  assert.deepEqual([...apiCalls.results].sort(), [MEMBER_A, MEMBER_B])
  assert.equal(callsNamed('kubios_write_snapshot').length, 2)

  const finish = callsNamed('kubios_finish_sync').at(-1)
  assert.equal(finish.args.p_success, false)
  assert.equal(finish.args.p_error_code, 'members.partial')

  // Los inválidos no caben en el cursor `uuid[]`: se recuentan en cada pasada
  // desde el listado del proveedor, sin bucle dentro de una misma pasada.
  const second = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: expectNoLogin,
    now: () => NOW
  })

  assert.deepEqual(second, { status: 'partial', synced: 2, failed: 2 })
  assert.equal(apiCalls.results.length, 4, 'cada pasada procesa cada UUID válido una sola vez')
  assert.equal(callsNamed('kubios_write_snapshot').length, 4)
})

test('SYNC-01 todos inválidos: partial con un fallo por miembro y cero escrituras', async () => {
  // Previene escribir snapshots o cursor cuando no hay ningún UUID que procesar.
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch, calls: apiCalls } = createApiFetch({
    members: [
      { team_user_id: 'no-es-uuid' },
      { team_user_id: '12345' },
      { team_user_id: 'uuid-invalido' },
      { team_user_id: '00000000-0000-4000-8000-00000000000Z' }
    ]
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: expectNoLogin,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 4 })
  assert.deepEqual(apiCalls.results, [])
  assert.equal(state.snapshots.size, 0)
  assert.equal(callsNamed('kubios_write_snapshot').length, 0)
  assert.equal(callsNamed('kubios_advance_sync_cursor').length, 0)
  assert.equal(callsNamed('kubios_finish_sync').at(-1).args.p_error_code, 'members.partial')
})

test('SYNC-01 UUID repetido: se procesa una vez y no degrada el resultado a partial', async () => {
  // Previene contar duplicados como fallos: `members.length - synced` los
  // convertía en un failed fantasma y rompía el `ok` de un equipo consistente.
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch, calls: apiCalls } = createApiFetch({
    members: [
      { team_user_id: MEMBER_A },
      { team_user_id: MEMBER_A },
      { team_user_id: MEMBER_B },
      { team_user_id: MEMBER_B }
    ],
    results: {
      [MEMBER_A]: [{ synthetic: 'a' }],
      [MEMBER_B]: [{ synthetic: 'b' }]
    }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: expectNoLogin,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 2, failed: 0 })
  assert.equal(apiCalls.results.filter((id) => id === MEMBER_A).length, 1)
  assert.equal(apiCalls.results.filter((id) => id === MEMBER_B).length, 1)
  assert.equal(state.snapshots.size, 2)
  assert.equal(callsNamed('kubios_write_snapshot').length, 2)
  assert.equal(callsNamed('kubios_finish_sync').at(-1).args.p_success, true)
})

test('SYNC-01 integración con el cliente K13 real: página mixta guarda los UUID válidos y cuenta los inválidos', async (t) => {
  // F1: el cliente real `fetchKubiosTeamMembers` acepta miembros sin
  // `team_user_id` string; el sincronizador los cuenta como fallo y sigue con
  // los UUID válidos. Solo se sustituye `fetch`, no el cliente.
  const seeded = seedToken()
  const { service, state, callsNamed } = createService({ tokenRow: seeded.row })

  const memberAName = 'Miembro Sintético A'
  const memberAEmail = 'miembro.a@example.invalid'
  const memberBName = 'Miembro Sintético B'
  const memberBEmail = 'miembro.b@example.invalid'
  const invalidName = 'Miembro Sintético Sin Identificador'
  const invalidEmail = 'sin.identificador@example.invalid'

  const members = [
    { team_user_id: MEMBER_A, name: memberAName, email: memberAEmail },
    { team_user_id: null, name: invalidName, email: invalidEmail },
    {},
    { team_user_id: MEMBER_B, name: memberBName, email: memberBEmail }
  ]

  const base = createApiFetch({
    members,
    results: {
      [MEMBER_A]: [{ synthetic: 'a' }],
      [MEMBER_B]: [{ synthetic: 'b' }]
    }
  })
  const observed = []
  const apiFetch = async (url, init) => {
    observed.push({ url, init })
    return base.apiFetch(url, init)
  }

  const logs = []
  const levels = ['log', 'info', 'warn', 'error', 'debug']
  for (const level of levels) {
    t.mock.method(console, level, (...args) => {
      logs.push(args.map((value) => (typeof value === 'string' ? value : String(value))).join(' '))
    })
  }

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: expectNoLogin,
    now: () => NOW
  })

  // A y B se sincronizan; null y {} cuentan como fallos y nunca hay `ok`.
  assert.deepEqual(result, { status: 'partial', synced: 2, failed: 2 })
  assert.notEqual(result.status, 'ok')
  assert.deepEqual(
    [...state.snapshots.keys()].sort(),
    [`${TEAM_ID}:${MEMBER_A}`, `${TEAM_ID}:${MEMBER_B}`].sort(),
    'solo se escriben snapshots de los UUID válidos'
  )
  assert.deepEqual(
    callsNamed('kubios_write_snapshot')
      .map((call) => call.args.p_member_id)
      .sort(),
    [MEMBER_A, MEMBER_B].sort()
  )
  assert.deepEqual(base.calls.results.slice().sort(), [MEMBER_A, MEMBER_B].sort())
  assert.equal(base.calls.team, 1)

  const finish = callsNamed('kubios_finish_sync').at(-1)
  assert.equal(finish.args.p_success, false)
  assert.equal(finish.args.p_error_code, 'members.partial')

  // PII sintética y token: ni en logs, ni en el resultado, ni en URLs, ni en
  // cuerpos, ni en los argumentos RPC (los snapshots van cifrados).
  const pii = [
    memberAName,
    memberAEmail,
    memberBName,
    memberBEmail,
    invalidName,
    invalidEmail,
    seeded.idToken
  ]
  const surfaces = [
    ['logs', logs.join('\n')],
    ['resultado', JSON.stringify(result)],
    ['urls', observed.map((call) => call.url).join('\n')],
    [
      'argumentos RPC',
      callsNamed('kubios_write_snapshot')
        .map((call) => JSON.stringify(call.args))
        .join('\n')
    ],
    ['cursor', JSON.stringify(state.cursor ?? {})]
  ]
  for (const [label, surface] of surfaces) {
    for (const marker of pii) {
      assert.ok(!surface.includes(marker), `${label} no debe incluir PII: ${marker}`)
    }
  }
  for (const call of observed) {
    assert.equal(call.init.body, undefined, 'las peticiones GET no llevan cuerpo')
    assert.equal(call.init.headers.Authorization, seeded.idToken)
  }
})

test('SYNC-02 respuesta sin timestamp escalar: falla el miembro y conserva el snapshot previo', async () => {
  // Previene contar `{ data: null, error: null }` como guardado: la RPC declara
  // `returns timestamptz` y cualquier otra forma debe fallar cerrado.
  const invalidResponses = [
    ['data null', null],
    ['data undefined', undefined],
    ['número', 42],
    ['booleano', true],
    ['array', ['2026-10-27T16:00:00+00:00']],
    ['objeto', { updated_at: '2026-10-27T16:00:00+00:00' }],
    ['cadena vacía', ''],
    ['cadena sin zona', '2026-10-27T16:00:00'],
    ['solo fecha', '2026-10-27'],
    ['fecha imposible', '2026-13-45T99:99:99+00:00'],
    ['fuera de rango', '0001-01-01T00:00:00+00:00']
  ]

  for (const [label, data] of invalidResponses) {
    const seeded = seedToken()
    const base = createService({ tokenRow: seeded.row })
    const previousSnapshot = {
      p_team_id: TEAM_ID,
      p_member_id: MEMBER_A,
      p_lease_owner: PREVIOUS_OWNER,
      p_ciphertext: '\\xdeadbeef',
      p_nonce: `\\x${'11'.repeat(12)}`,
      p_tag: `\\x${'22'.repeat(16)}`,
      p_key_version: 1
    }
    base.state.snapshots.set(`${TEAM_ID}:${MEMBER_A}`, previousSnapshot)

    const { service, responses } = withRpcResponse(base, 'kubios_write_snapshot', () => ({
      data,
      error: null
    }))
    const { apiFetch } = createApiFetch({
      members: [{ team_user_id: MEMBER_A }],
      results: { [MEMBER_A]: [{ synthetic: true }] }
    })

    const result = await runKubiosSync({
      service,
      env: ENV,
      apiFetch,
      authFetch: expectNoLogin,
      now: () => NOW
    })

    assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 }, label)
    assert.equal(responses.length, 1, `no debe repetirse la escritura (${label})`)
    assert.equal(
      base.state.snapshots.get(`${TEAM_ID}:${MEMBER_A}`),
      previousSnapshot,
      `el snapshot previo sigue intacto (${label})`
    )
    assert.equal(base.callsNamed('kubios_write_snapshot').length, 1)
    assert.equal(
      base.state.cursor?.next_member_id,
      MEMBER_A,
      `el cursor queda en el miembro fallido, no avanza como éxito (${label})`
    )
    assert.equal(
      base.callsNamed('kubios_finish_sync').at(-1).args.p_error_code,
      'members.partial',
      `la pasada no puede ser ok (${label})`
    )
  }
})

test('SYNC-02 timestamp ISO con zona válido: el miembro cuenta como synced', async () => {
  // Previene rechazar una respuesta legítima de `kubios_write_snapshot`.
  const accepted = [
    '2026-10-27T16:00:00+00:00',
    '2026-10-27T16:00:00Z',
    '2026-10-27T16:00:00.123456+00:00',
    '9999-12-31T23:59:59+00:00'
  ]

  for (const data of accepted) {
    const seeded = seedToken()
    const base = createService({ tokenRow: seeded.row })
    const { service, responses } = withRpcResponse(base, 'kubios_write_snapshot', () => ({
      data,
      error: null
    }))
    const { apiFetch } = createApiFetch({
      members: [{ team_user_id: MEMBER_A }],
      results: { [MEMBER_A]: [{ synthetic: true }] }
    })

    const result = await runKubiosSync({
      service,
      env: ENV,
      apiFetch,
      authFetch: expectNoLogin,
      now: () => NOW
    })

    assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 }, data)
    assert.equal(responses.length, 1)
    assert.equal(base.callsNamed('kubios_finish_sync').at(-1).args.p_success, true)
  }
})

test('SYNC-02 timestamp con calendario, hora o zona imposibles: falla sin normalizar y conserva el snapshot previo', async () => {
  // F3: `Date.parse` normalizaba 30 de febrero, 24:00 o +00:60 y contaba la
  // RPC como éxito. Ahora se valida cada componente antes de construir el
  // instante; el snapshot previo sigue intacto y la pasada no puede ser ok.
  const invalidTimestamps = [
    ['30 de febrero', '2026-02-30T00:00:00+00:00'],
    ['31 de abril', '2026-04-31T00:00:00+00:00'],
    ['29 de febrero no bisiesto', '2025-02-29T00:00:00+00:00'],
    ['hora 24', '2026-10-27T24:00:00+00:00'],
    ['minuto 60', '2026-10-27T16:60:00+00:00'],
    ['segundo 60', '2026-10-27T16:00:60+00:00'],
    ['offset +24:00', '2026-10-27T16:00:00+24:00'],
    ['offset +00:60', '2026-10-27T16:00:00+00:60'],
    ['mes 13', '2026-13-01T00:00:00+00:00'],
    ['día 0', '2026-10-00T00:00:00+00:00']
  ]

  for (const [label, data] of invalidTimestamps) {
    const seeded = seedToken()
    const base = createService({ tokenRow: seeded.row })
    const previousSnapshot = {
      p_team_id: TEAM_ID,
      p_member_id: MEMBER_A,
      p_lease_owner: PREVIOUS_OWNER,
      p_ciphertext: '\\xdeadbeef',
      p_nonce: `\\x${'11'.repeat(12)}`,
      p_tag: `\\x${'22'.repeat(16)}`,
      p_key_version: 1
    }
    base.state.snapshots.set(`${TEAM_ID}:${MEMBER_A}`, previousSnapshot)

    const { service, responses } = withRpcResponse(base, 'kubios_write_snapshot', () => ({
      data,
      error: null
    }))
    const { apiFetch } = createApiFetch({
      members: [{ team_user_id: MEMBER_A }],
      results: { [MEMBER_A]: [{ synthetic: true }] }
    })

    const result = await runKubiosSync({
      service,
      env: ENV,
      apiFetch,
      authFetch: expectNoLogin,
      now: () => NOW
    })

    assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 }, label)
    assert.equal(responses.length, 1, `no debe repetirse la escritura (${label})`)
    assert.equal(
      base.state.snapshots.get(`${TEAM_ID}:${MEMBER_A}`),
      previousSnapshot,
      `el snapshot previo sigue intacto (${label})`
    )
    assert.equal(base.callsNamed('kubios_write_snapshot').length, 1)
    assert.equal(
      base.state.cursor?.next_member_id,
      MEMBER_A,
      `el cursor queda en el miembro fallido (${label})`
    )
    const finish = base.callsNamed('kubios_finish_sync').at(-1)
    assert.equal(finish.args.p_success, false, `la pasada no puede ser ok (${label})`)
    assert.equal(finish.args.p_error_code, 'members.partial', label)
  }
})

test('SYNC-02 calendario bisiesto, 23:59:59, fracción larga y zonas válidas: synced', async () => {
  // F3: la validación estricta no debe rechazar instantes ISO legítimos.
  const accepted = [
    '2024-02-29T00:00:00Z',
    '2026-10-27T23:59:59+00:00',
    '2026-10-27T16:00:00.123456789Z',
    '2026-10-27T16:00:00+05:30',
    '2026-10-27T16:00:00-03:00'
  ]

  for (const data of accepted) {
    const seeded = seedToken()
    const base = createService({ tokenRow: seeded.row })
    const { service, responses } = withRpcResponse(base, 'kubios_write_snapshot', () => ({
      data,
      error: null
    }))
    const { apiFetch } = createApiFetch({
      members: [{ team_user_id: MEMBER_A }],
      results: { [MEMBER_A]: [{ synthetic: true }] }
    })

    const result = await runKubiosSync({
      service,
      env: ENV,
      apiFetch,
      authFetch: expectNoLogin,
      now: () => NOW
    })

    assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 }, data)
    assert.equal(responses.length, 1)
    assert.equal(base.callsNamed('kubios_finish_sync').at(-1).args.p_success, true)
  }
})

test('SYNC-03 cursor nulo, indefinido o no-array: partial cursor.unavailable sin escrituras', async () => {
  // Previene interpretar una lectura incompleta como equipo sin cursor y
  // avanzar snapshots y cursor sin evidencia.
  const invalidCursors = [
    ['null', null],
    ['undefined', undefined],
    ['objeto', { next_member_id: null }],
    ['cadena', '[]'],
    ['booleano', false]
  ]

  for (const [label, data] of invalidCursors) {
    const seeded = seedToken()
    const base = createService({ tokenRow: seeded.row })
    const { service, responses } = withRpcResponse(base, 'kubios_get_sync_cursor', () => ({
      data,
      error: null
    }))
    const { apiFetch } = createApiFetch({
      members: [{ team_user_id: MEMBER_A }],
      results: { [MEMBER_A]: [{ synthetic: true }] }
    })

    const result = await runKubiosSync({
      service,
      env: ENV,
      apiFetch,
      authFetch: expectNoLogin,
      now: () => NOW
    })

    assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 }, label)
    assert.equal(responses.length, 1)
    assert.equal(base.state.snapshots.size, 0, label)
    assert.equal(base.callsNamed('kubios_write_snapshot').length, 0, label)
    assert.equal(base.callsNamed('kubios_advance_sync_cursor').length, 0, label)
    assert.equal(
      base.callsNamed('kubios_finish_sync').at(-1).args.p_error_code,
      'cursor.unavailable',
      label
    )
  }
})

test('SYNC-03 regresión: cursor [] sigue equivaliendo a un cursor nuevo', async () => {
  const seeded = seedToken()
  const base = createService({ tokenRow: seeded.row })
  const { service, responses } = withRpcResponse(base, 'kubios_get_sync_cursor', () => ({
    data: [],
    error: null
  }))
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: [{ synthetic: true }] }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: expectNoLogin,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })
  assert.equal(responses.length, 1)
  assert.equal(base.callsNamed('kubios_advance_sync_cursor').length, 1)
})

test('Retry-After desbordado a Infinity: pausa indefinida, nunca 60 s ni RPC finita', async () => {
  // Previene que un entero gigante se degrade a la espera por defecto.
  const seeded = seedToken()
  const { service, state, calls, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: {
      [MEMBER_A]: () => errorResponse(429, { 'Retry-After': '9'.repeat(400) })
    }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: expectNoLogin,
    now: () => NOW
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryIndefinite: true
  })
  assert.equal('retryAfterSeconds' in result, false, 'no debe prometer un plazo finito')
  assert.equal(callsNamed('kubios_finish_sync').length, 0)
  assert.equal(state.finish, null)
  assert.deepEqual(callsNamed('kubios_finish_sync_indefinite')[0].args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_error_code: 'rate_limited'
  })
})

test('Retry-After 0 se redondea a la pausa mínima persistible de 1 s', async () => {
  // Previene persistir 0 segundos, que no es un plazo válido de la RPC.
  const seeded = seedToken()
  const { service, calls, callsNamed } = createService({ tokenRow: seeded.row })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: () => errorResponse(429, { 'Retry-After': '0' }) }
  })

  const result = await runKubiosSync({
    service,
    env: ENV,
    apiFetch,
    authFetch: expectNoLogin,
    now: () => NOW
  })

  assert.deepEqual(result, {
    status: 'throttled',
    synced: 0,
    failed: 1,
    retryAfterSeconds: 1
  })
  const finish = callsNamed('kubios_finish_sync').at(-1)
  assert.deepEqual(finish.args, {
    p_team_id: TEAM_ID,
    p_lease_owner: calls[0].args.p_lease_owner,
    p_success: false,
    p_error_code: 'rate_limited',
    p_retry_after_seconds: 1
  })
})

/* ------------------------------------------------------------------------- *
 * K02/K31: descubrimiento por /v1/user/self cuando falta KUBIOS_TEAM_ID
 * ------------------------------------------------------------------------- */

test('sin KUBIOS_TEAM_ID: elige Diabetes Tracker - H2TRAIN por nombre y persiste token/snapshot bajo ese equipo', async () => {
  const { service, calls, state, callsNamed } = createService()
  const idToken = syntheticJwt(Math.floor((NOW + 3_600_000) / 1000))
  const { authFetch } = createLoginAuthFetch({ idToken })
  const { apiFetch, calls: apiCalls } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: [{ result_id: 'sintetico-k02-k31' }] },
    userSelf: {
      user: {
        teams: [
          { team_id: OTHER_TEAM_ID, name: 'Otro equipo' },
          { team_id: TEAM_ID, name: 'Diabetes Tracker - H2TRAIN' }
        ]
      }
    }
  })

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    cryptoOptions: CRYPTO_OPTIONS_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })
  assert.equal(apiCalls.userSelf, 1, 'debe consultar /v1/user/self')
  assert.equal(apiCalls.team, 1)

  const lease = calls[0]
  assert.equal(lease.name, 'kubios_try_acquire_sync')
  assert.equal(lease.args.p_team_id, TEAM_ID, 'el lease usa el equipo elegido, no el primero')
  assert.equal(callsNamed('kubios_get_token').length, 0)

  const [tokenWrite] = callsNamed('kubios_write_token')
  assert.equal(tokenWrite.args.p_team_id, TEAM_ID)
  assert.equal(
    decryptKubiosToken(
      envelopeFromArgs(tokenWrite.args),
      { teamId: TEAM_ID, memberId: TEAM_ID },
      CRYPTO_OPTIONS_WITHOUT_TEAM
    ),
    idToken
  )
  assert.equal(state.tokenRow !== null, true)

  const [snapshot] = callsNamed('kubios_write_snapshot')
  assert.equal(snapshot.args.p_team_id, TEAM_ID)
  assert.equal(snapshot.args.p_member_id, MEMBER_A)
  assert.deepEqual(
    JSON.parse(
      decryptKubiosSnapshot(
        envelopeFromArgs(snapshot.args),
        { teamId: TEAM_ID, memberId: MEMBER_A },
        CRYPTO_OPTIONS_WITHOUT_TEAM
      )
    ),
    { results: [{ result_id: 'sintetico-k02-k31' }] }
  )

  assertDecryptionFails(() =>
    decryptKubiosSnapshot(
      envelopeFromArgs(snapshot.args),
      { teamId: OTHER_TEAM_ID, memberId: MEMBER_A },
      CRYPTO_OPTIONS_WITHOUT_TEAM
    )
  )

  const finish = calls.at(-1)
  assert.equal(finish.name, 'kubios_finish_sync')
  assert.equal(finish.args.p_team_id, TEAM_ID)
})

test('sin KUBIOS_TEAM_ID y sin el equipo objetivo: partial sin lease, token ni snapshot', async () => {
  const { service, calls, state } = createService()
  const idToken = syntheticJwt(Math.floor((NOW + 3_600_000) / 1000))
  const { authFetch } = createLoginAuthFetch({ idToken })
  const { apiFetch, calls: apiCalls } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    userSelf: {
      user: { teams: [{ team_id: OTHER_TEAM_ID, name: 'Otro equipo' }] }
    }
  })

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    cryptoOptions: CRYPTO_OPTIONS_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(apiCalls.userSelf, 1)
  assert.equal(calls.length, 0, 'sin equipo válido no se toca ninguna RPC')
  assert.equal(state.tokenRow, null)
  assert.equal(state.snapshots.size, 0)
})

test('sin KUBIOS_TEAM_ID y nombre ambiguo: partial sin lease, token ni snapshot', async () => {
  const { service, calls, state } = createService()
  const idToken = syntheticJwt(Math.floor((NOW + 3_600_000) / 1000))
  const { authFetch } = createLoginAuthFetch({ idToken })
  const { apiFetch } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }],
    userSelf: {
      user: {
        teams: [
          { team_id: TEAM_ID, name: 'Diabetes Tracker - H2TRAIN' },
          { team_id: OTHER_TEAM_ID, name: 'Diabetes Tracker - H2TRAIN' }
        ]
      }
    }
  })

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    cryptoOptions: CRYPTO_OPTIONS_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(calls.length, 0)
  assert.equal(state.tokenRow, null)
  assert.equal(state.snapshots.size, 0)
})

test('con KUBIOS_TEAM_ID explícito no consulta /v1/user/self y usa el override', async () => {
  const env = Object.freeze({ ...ENV_WITHOUT_TEAM, KUBIOS_TEAM_ID: OTHER_TEAM_ID })
  const { service, calls, callsNamed } = createService()
  const idToken = syntheticJwt(Math.floor((NOW + 3_600_000) / 1000))
  const { authFetch } = createLoginAuthFetch({ idToken })
  const { apiFetch, calls: apiCalls } = createApiFetch({
    members: [{ team_user_id: MEMBER_A }]
  })

  const result = await runKubiosSync({
    service,
    env,
    cryptoOptions: { env },
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })
  assert.equal(apiCalls.userSelf, 0, 'el override evita la consulta de equipos')
  assert.equal(calls[0].args.p_team_id, OTHER_TEAM_ID)
  assert.equal(callsNamed('kubios_write_token')[0].args.p_team_id, OTHER_TEAM_ID)
  assert.equal(callsNamed('kubios_write_snapshot')[0].args.p_team_id, OTHER_TEAM_ID)
})

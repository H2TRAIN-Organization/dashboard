/**
 * Pruebas sintéticas de la resolución opcional de equipo de Kubios
 * (K02/K31): configuración, `GET /v1/user/self`, cliente de autenticación sin
 * persistencia y sincronización sin `KUBIOS_TEAM_ID`.
 *
 * El criterio de selección es el nombre exacto `Diabetes Tracker - H2TRAIN`
 * (comparación case-insensitive y espacios normalizados), tal como lo cubre
 * `tests/kubios-team.k02-k31.test.mjs`. Aquí no se duplica esa suite: solo se
 * comprueba la integración con el sincronizador y el override explícito.
 *
 * No usan red, Supabase remoto ni credenciales reales: todos los `fetch`, RPC,
 * relojes y UUID son inyectados y los datos son ficticios. Ejecutar desde la
 * raíz del repositorio:
 *
 *   node --conditions=react-server \
 *     --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --test tests/kubios-team-resolution.k02-k31.test.mjs
 */

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./kubios-sync.k14.loader.mjs', import.meta.url))

const { KubiosConfigError, getKubiosConfig } = await import('../src/lib/kubios-config.ts')
const {
  KUBIOS_API_ORIGIN,
  KUBIOS_USER_SELF_PATH,
  KubiosApiError,
  fetchKubiosUserSelf
} = await import('../src/lib/kubios-api-client.ts')
const { KubiosAuthClient } = await import('../src/lib/kubios-auth-client.ts')
const { runKubiosSync } = await import('../src/lib/kubios-sync.ts')
const { decryptKubiosToken, encryptKubiosToken } = await import('../src/lib/kubios-crypto.ts')

const TARGET_TEAM_NAME = 'Diabetes Tracker - H2TRAIN'
const TEAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TEAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MEMBER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOW = 1_800_000_000_000
const KEY = Buffer.alloc(32, 0x6b)
const TOKEN = 'synthetic-id-token-for-team-resolution-tests'

const BASE_ENV = Object.freeze({
  KUBIOS_USERNAME: 'usuario.sintetico@example.invalid',
  KUBIOS_PASSWORD: ' contraseña sintética con espacios ',
  KUBIOS_CLIENT_ID: 'cliente-sintetico',
  KUBIOS_ENCRYPTION_KEY_V1: KEY.toString('base64')
})

const ENV_WITHOUT_TEAM = BASE_ENV
const ENV_WITH_TEAM = Object.freeze({ ...BASE_ENV, KUBIOS_TEAM_ID: TEAM_A })
const CRYPTO_OPTIONS = Object.freeze({ env: BASE_ENV })

/* ------------------------------------------------------------------------- *
 * Utilidades sintéticas
 * ------------------------------------------------------------------------- */

function jwt(expSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ sub: 'synthetic-subject', exp: expSeconds })
  ).toString('base64url')
  const signature = Buffer.from('synthetic-signature').toString('base64url')
  return `${header}.${payload}.${signature}`
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

function loginResponse(idToken) {
  const fragment = new URLSearchParams({
    access_token: 'synthetic-access-token',
    token_type: 'Bearer',
    id_token: idToken
  }).toString()

  return new Response(null, {
    status: 302,
    headers: { location: `https://analysis.kubioscloud.com/v1/portal/login#${fragment}` }
  })
}

class MemoryStore {
  constructor() {
    this.records = new Map()
    this.writes = []
    this.readCount = 0
    this.failRead = false
    this.failWrite = false
  }

  key(scope) {
    return `${scope.teamId}\u0000${scope.memberId}`
  }

  async read(scope) {
    this.readCount += 1
    if (this.failRead) throw new Error('fallo de lectura sintético')
    return this.records.get(this.key(scope)) ?? null
  }

  async write(scope, token) {
    this.writes.push({ scope, token })
    if (this.failWrite) throw new Error('fallo de escritura sintético')
    this.records.set(this.key(scope), token)
  }
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

function createFetchMock(handler) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { calls, fetch }
}

async function expectApiError(promise, code) {
  let caught
  try {
    await promise
  } catch (error) {
    caught = error
  }

  assert.ok(caught, `se esperaba un error con código ${code}`)
  assert.ok(caught instanceof KubiosApiError, 'el error debe ser KubiosApiError')
  assert.equal(caught.code, code)
  return caught
}

function createService({ tokenRow = null } = {}) {
  const state = {
    tokenRow,
    snapshots: new Map(),
    leaseOwner: null,
    leaseExpiresAt: null,
    finish: null,
    tokenReads: 0,
    tokenWrites: 0
  }
  const calls = []

  const service = {
    async rpc(name, args) {
      calls.push({ name, args })

      if (name === 'kubios_try_acquire_sync') {
        state.leaseOwner = args.p_lease_owner
        state.leaseExpiresAt = NOW + args.p_lease_seconds * 1_000
        return { data: true, error: null }
      }

      if (name === 'kubios_get_sync_cursor') {
        return { data: [], error: null }
      }

      if (name === 'kubios_get_token') {
        state.tokenReads += 1
        return { data: state.tokenRow === null ? [] : [state.tokenRow], error: null }
      }

      if (name === 'kubios_write_token') {
        if (state.leaseOwner !== args.p_lease_owner) {
          return { data: null, error: { message: 'kubios_token_write_denied' } }
        }
        state.tokenWrites += 1
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

      if (name === 'kubios_advance_sync_cursor') {
        return { data: true, error: null }
      }

      if (name === 'kubios_finish_sync') {
        state.finish = args
        if (state.leaseOwner !== args.p_lease_owner) return { data: false, error: null }
        state.leaseOwner = null
        state.leaseExpiresAt = null
        return { data: true, error: null }
      }

      if (name === 'kubios_finish_sync_indefinite') {
        return { data: true, error: null }
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

function createApiFetch({ teams = [], members = [], results = {}, userSelf } = {}) {
  const calls = { userSelf: 0, team: 0, results: [] }

  const apiFetch = async (url, init) => {
    if (url.endsWith(KUBIOS_USER_SELF_PATH)) {
      calls.userSelf += 1
      if (typeof userSelf === 'function') return userSelf(url, init)
      if (userSelf !== undefined) return userSelf
      return jsonResponse({ user: { teams } })
    }

    if (url.includes('/v2/team/team/')) {
      calls.team += 1
      return jsonResponse({ members })
    }

    const memberId = url.slice(url.lastIndexOf('/') + 1)
    calls.results.push(memberId)
    const handler = results[memberId]
    if (typeof handler === 'function') return handler()
    return jsonResponse({ results: handler ?? [] })
  }

  return { apiFetch, calls }
}

function createLoginAuthFetch(idToken) {
  const calls = []
  const authFetch = async (url, init) => {
    calls.push({ url, init })
    return loginResponse(idToken)
  }
  return { authFetch, calls }
}

/* ------------------------------------------------------------------------- *
 * 1. Configuración opcional
 * ------------------------------------------------------------------------- */

test('getKubiosConfig: KUBIOS_TEAM_ID es opcional y un valor vacío se considera ausente', () => {
  const withoutTeam = getKubiosConfig({
    KUBIOS_USERNAME: 'usuario',
    KUBIOS_PASSWORD: ' contraseña exacta ',
    KUBIOS_CLIENT_ID: 'cliente'
  })

  assert.deepEqual(withoutTeam, {
    username: 'usuario',
    password: ' contraseña exacta ',
    clientId: 'cliente'
  })
  assert.equal('teamId' in withoutTeam, false)

  for (const empty of ['', '   ']) {
    const config = getKubiosConfig({
      KUBIOS_USERNAME: 'usuario',
      KUBIOS_PASSWORD: 'contraseña',
      KUBIOS_CLIENT_ID: 'cliente',
      KUBIOS_TEAM_ID: empty
    })
    assert.equal(config.teamId, undefined)
  }

  const trimmed = getKubiosConfig({
    KUBIOS_USERNAME: ' usuario ',
    KUBIOS_PASSWORD: '  clave  ',
    KUBIOS_CLIENT_ID: ' cliente ',
    KUBIOS_TEAM_ID: ` ${TEAM_A} `
  })
  assert.equal(trimmed.username, 'usuario')
  assert.equal(trimmed.password, '  clave  ')
  assert.equal(trimmed.clientId, 'cliente')
  assert.equal(trimmed.teamId, TEAM_A)
})

test('getKubiosConfig: siguen faltando username, password y clientId; el error solo nombra variables', () => {
  const secretPassword = 'contraseña-que-no-debe-aparecer'
  const secretClient = 'cliente-que-no-debe-aparecer'

  assert.throws(
    () =>
      getKubiosConfig({
        KUBIOS_PASSWORD: secretPassword,
        KUBIOS_CLIENT_ID: secretClient
      }),
    (error) => {
      assert.ok(error instanceof KubiosConfigError)
      assert.deepEqual([...error.missingVariables], ['KUBIOS_USERNAME'])
      assert.match(error.message, /KUBIOS_USERNAME/)
      assert.ok(!error.message.includes(secretPassword))
      assert.ok(!error.message.includes(secretClient))
      return true
    }
  )

  assert.throws(
    () => getKubiosConfig({ KUBIOS_PASSWORD: secretPassword }),
    (error) => {
      assert.ok(error instanceof KubiosConfigError)
      assert.deepEqual([...error.missingVariables], ['KUBIOS_USERNAME', 'KUBIOS_CLIENT_ID'])
      assert.match(error.message, /KUBIOS_USERNAME/)
      assert.match(error.message, /KUBIOS_CLIENT_ID/)
      assert.ok(!error.message.includes(secretPassword))
      return true
    }
  )
})

/* ------------------------------------------------------------------------- *
 * 2. GET /v1/user/self
 * ------------------------------------------------------------------------- */

test('fetchKubiosUserSelf: GET fijo al origen, cabeceras correctas y equipos completos preservados', async () => {
  const teamA = { team_id: TEAM_A, name: 'Sintético A', extra: { nested: true } }
  const payload = {
    user: {
      id: 'synthetic-user',
      teams: [teamA],
      extra: 'se conserva'
    }
  }
  const { calls, fetch } = createFetchMock(() => jsonResponse(payload))

  const page = await fetchKubiosUserSelf(TOKEN, { fetch })

  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(call.url, `${KUBIOS_API_ORIGIN}${KUBIOS_USER_SELF_PATH}`)
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.headers.Authorization, TOKEN)
  assert.equal(call.init.headers.Accept, 'application/json')
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.init.cache, 'no-store')
  assert.ok(call.init.signal instanceof AbortSignal)

  assert.deepEqual(page.user.teams, [teamA])
  assert.equal(page.user.teams[0], teamA, 'los objetos de equipo no se copian')
  assert.equal(page.user.extra, 'se conserva')
})

test('fetchKubiosUserSelf: una lista vacía es válida', async () => {
  const { fetch } = createFetchMock(() => jsonResponse({ user: { teams: [] } }))
  const page = await fetchKubiosUserSelf(TOKEN, { fetch })
  assert.deepEqual(page.user.teams, [])
})

test('fetchKubiosUserSelf: cuerpo o team_id inválido devuelve invalid_response_shape', async () => {
  const invalidBodies = [
    null,
    {},
    { user: null },
    { user: {} },
    { user: { teams: null } },
    { user: { teams: {} } },
    { user: { teams: [null] } },
    { user: { teams: [[]] } },
    { user: { teams: [{ team_id: '' }] } },
    { user: { teams: [{ team_id: ' equipo' }] } },
    { user: { teams: [{ team_id: 'equipo ' }] } },
    { user: { teams: [{ team_id: 'equi\u0000po' }] } },
    { user: { teams: [{ team_id: 123 }] } },
    { user: { teams: [{ team_id: 'a'.repeat(257) }] } }
  ]

  for (const body of invalidBodies) {
    const { fetch } = createFetchMock(() => jsonResponse(body))
    const error = await expectApiError(fetchKubiosUserSelf(TOKEN, { fetch }), 'invalid_response_shape')
    assert.equal(error.endpoint, 'user-self')
    assert.equal(error.status, 200)
    assert.ok(!error.message.includes(TOKEN))
    assert.ok(!JSON.stringify(error).includes(TOKEN))
  }
})

test('fetchKubiosUserSelf: 401 y 429 conservan sus códigos y no filtran el token', async () => {
  const { fetch: unauthorizedFetch } = createFetchMock(() => errorResponse(401))
  const unauthorized = await expectApiError(
    fetchKubiosUserSelf(TOKEN, { fetch: unauthorizedFetch }),
    'unauthorized'
  )
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.endpoint, 'user-self')
  assert.ok(!unauthorized.message.includes(TOKEN))

  const { fetch: limitedFetch } = createFetchMock(() =>
    errorResponse(429, { 'retry-after': '7' })
  )
  const limited = await expectApiError(
    fetchKubiosUserSelf(TOKEN, { fetch: limitedFetch }),
    'rate_limited'
  )
  assert.equal(limited.status, 429)
  assert.equal(limited.retryAfterMs, 7_000)
  assert.ok(!limited.message.includes(TOKEN))
})

/* ------------------------------------------------------------------------- *
 * 3. Cliente de autenticación sin persistencia y persistencia explícita
 * ------------------------------------------------------------------------- */

test('auth sin equipo y persistLogin:false no lee ni escribe el store y devuelve el login', async () => {
  const token = jwt(NOW / 1000 + 600)
  const store = new MemoryStore()
  const { calls, fetch } = createFetchMock(() => loginResponse(token))

  const client = new KubiosAuthClient({
    store,
    fetch,
    now: () => NOW,
    env: ENV_WITHOUT_TEAM,
    cryptoOptions: CRYPTO_OPTIONS,
    persistLogin: false
  })

  const result = await client.getToken()

  assert.deepEqual(result, {
    ok: true,
    idToken: token,
    expiresAt: (NOW / 1000 + 600) * 1000,
    source: 'login'
  })
  assert.equal(calls.length, 1)
  assert.equal(store.readCount, 0)
  assert.equal(store.writes.length, 0)
})

test('auth sin equipo y persistLogin:false funciona sin store inyectado', async () => {
  const token = jwt(NOW / 1000 + 600)
  const { fetch } = createFetchMock(() => loginResponse(token))

  const client = new KubiosAuthClient({
    fetch,
    now: () => NOW,
    env: ENV_WITHOUT_TEAM,
    cryptoOptions: CRYPTO_OPTIONS,
    persistLogin: false
  })

  const result = await client.getToken()
  assert.equal(result.ok, true)
  assert.equal(result.source, 'login')
  assert.equal(result.idToken, token)
})

test('persistToken: escribe con scope {teamId, memberId:teamId} y el sobre descifra', async () => {
  const token = jwt(NOW / 1000 + 600)
  const store = new MemoryStore()
  const client = new KubiosAuthClient({
    teamId: TEAM_A,
    store,
    now: () => NOW,
    env: ENV_WITH_TEAM,
    cryptoOptions: CRYPTO_OPTIONS
  })

  const result = await client.persistToken(TEAM_A, {
    idToken: token,
    expiresAt: (NOW / 1000 + 600) * 1000
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(store.writes.length, 1)
  assert.equal(store.writes[0].scope.teamId, TEAM_A)
  assert.equal(store.writes[0].scope.memberId, TEAM_A)

  const decrypted = decryptKubiosToken(
    store.writes[0].token.envelope,
    { teamId: TEAM_A, memberId: TEAM_A },
    CRYPTO_OPTIONS
  )
  assert.equal(decrypted, token)
})

test('persistToken: fallo de escritura y opciones inválidas usan códigos fijos', async () => {
  const token = jwt(NOW / 1000 + 600)
  const failingStore = new MemoryStore()
  failingStore.failWrite = true

  const failingClient = new KubiosAuthClient({
    teamId: TEAM_A,
    store: failingStore,
    now: () => NOW,
    env: ENV_WITH_TEAM,
    cryptoOptions: CRYPTO_OPTIONS
  })

  assert.deepEqual(
    await failingClient.persistToken(TEAM_A, {
      idToken: token,
      expiresAt: (NOW / 1000 + 600) * 1000
    }),
    { ok: false, code: 'store_write_failed' }
  )

  const client = new KubiosAuthClient({
    teamId: TEAM_A,
    store: new MemoryStore(),
    now: () => NOW,
    env: ENV_WITH_TEAM,
    cryptoOptions: CRYPTO_OPTIONS
  })

  assert.deepEqual(
    await client.persistToken('   ', {
      idToken: token,
      expiresAt: (NOW / 1000 + 600) * 1000
    }),
    { ok: false, code: 'invalid_options' }
  )
  assert.deepEqual(
    await client.persistToken(TEAM_A, { idToken: '', expiresAt: NOW }),
    { ok: false, code: 'invalid_options' }
  )
})

test('auth sin equipo y persistencia por defecto falla cerrado sin login ni store', async () => {
  const store = new MemoryStore()
  const { calls, fetch } = createFetchMock(() => loginResponse(jwt(NOW / 1000 + 600)))

  const client = new KubiosAuthClient({
    store,
    fetch,
    now: () => NOW,
    env: ENV_WITHOUT_TEAM,
    cryptoOptions: CRYPTO_OPTIONS
  })

  const result = await client.getToken()

  assert.deepEqual(result, { ok: false, code: 'config_unavailable' })
  assert.equal(calls.length, 0)
  assert.equal(store.readCount, 0)
  assert.equal(store.writes.length, 0)
})

/* ------------------------------------------------------------------------- *
 * 4. Sincronización sin KUBIOS_TEAM_ID (selección por nombre esperado)
 * ------------------------------------------------------------------------- */

test('sync sin KUBIOS_TEAM_ID: un equipo con el nombre esperado sincroniza bajo su team_id', async () => {
  const idToken = jwt(NOW / 1000 + 3_600)
  const { service, state, callsNamed } = createService()
  const { apiFetch, calls: apiCalls } = createApiFetch({
    teams: [{ team_id: TEAM_A, name: TARGET_TEAM_NAME }],
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: [{ synthetic_metric: 1 }] }
  })
  const { authFetch, calls: authCalls } = createLoginAuthFetch(idToken)

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })
  assert.equal(authCalls.length, 1)
  assert.equal(apiCalls.userSelf, 1)
  assert.equal(apiCalls.team, 1)
  assert.deepEqual(apiCalls.results, [MEMBER_A])

  // La fase de descubrimiento no lee el store: usa el token del login.
  assert.equal(callsNamed('kubios_get_token').length, 0)

  const [lease] = callsNamed('kubios_try_acquire_sync')
  assert.equal(lease.args.p_team_id, TEAM_A)

  const [tokenWrite] = callsNamed('kubios_write_token')
  assert.equal(tokenWrite.args.p_team_id, TEAM_A)
  assert.equal(
    decryptKubiosToken(
      envelopeFromArgs(tokenWrite.args),
      { teamId: TEAM_A, memberId: TEAM_A },
      CRYPTO_OPTIONS
    ),
    idToken
  )
  assert.equal(state.tokenWrites, 1)

  const [snapshot] = callsNamed('kubios_write_snapshot')
  assert.equal(snapshot.args.p_team_id, TEAM_A)
  assert.equal(snapshot.args.p_member_id, MEMBER_A)
  assert.equal(snapshot.args.p_lease_owner, lease.args.p_lease_owner)

  const finish = callsNamed('kubios_finish_sync').at(-1)
  assert.equal(finish.args.p_team_id, TEAM_A)
  assert.equal(finish.args.p_success, true)
})

test('sync sin KUBIOS_TEAM_ID: varios equipos elige el esperado aunque no sea el primero', async () => {
  const idToken = jwt(NOW / 1000 + 3_600)
  const { service, callsNamed } = createService()
  const { apiFetch } = createApiFetch({
    teams: [
      { team_id: TEAM_B, name: 'Otro equipo' },
      { team_id: TEAM_A, name: TARGET_TEAM_NAME }
    ],
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: [] }
  })
  const { authFetch } = createLoginAuthFetch(idToken)

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })
  assert.equal(callsNamed('kubios_get_token').length, 0)
  assert.equal(callsNamed('kubios_try_acquire_sync')[0].args.p_team_id, TEAM_A)
  assert.equal(callsNamed('kubios_write_token')[0].args.p_team_id, TEAM_A)
  assert.equal(callsNamed('kubios_write_snapshot')[0].args.p_team_id, TEAM_A)
  assert.equal(callsNamed('kubios_finish_sync').at(-1).args.p_team_id, TEAM_A)
})

test('sync sin KUBIOS_TEAM_ID: varios equipos sin el esperado fallan cerrado sin RPC', async () => {
  const { service, calls, callsNamed } = createService()
  const { apiFetch, calls: apiCalls } = createApiFetch({
    teams: [
      { team_id: TEAM_A, name: 'Otro equipo A' },
      { team_id: TEAM_B, name: 'Otro equipo B' }
    ]
  })
  const { authFetch } = createLoginAuthFetch(jwt(NOW / 1000 + 3_600))

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(calls.length, 0)
  assert.equal(apiCalls.userSelf, 1)
  assert.equal(apiCalls.team, 0)
  assert.equal(callsNamed('kubios_write_token').length, 0)
  assert.equal(callsNamed('kubios_write_snapshot').length, 0)
  assert.equal(callsNamed('kubios_finish_sync').length, 0)
})

test('sync sin KUBIOS_TEAM_ID: cero equipos devuelve partial sin RPC', async () => {
  const { service, calls } = createService()
  const { apiFetch } = createApiFetch({ teams: [] })
  const { authFetch } = createLoginAuthFetch(jwt(NOW / 1000 + 3_600))

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(calls.length, 0)
})

test('sync sin KUBIOS_TEAM_ID: nombre esperado duplicado con IDs distintos falla cerrado', async () => {
  const { service, calls } = createService()
  const { apiFetch } = createApiFetch({
    teams: [
      { team_id: TEAM_A, name: TARGET_TEAM_NAME },
      { team_id: TEAM_B, name: TARGET_TEAM_NAME }
    ]
  })
  const { authFetch } = createLoginAuthFetch(jwt(NOW / 1000 + 3_600))

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(calls.length, 0)
})

test('sync sin KUBIOS_TEAM_ID: un 429 de user/self devuelve partial sin RPC ni pausa', async () => {
  const { service, calls } = createService()
  const { apiFetch } = createApiFetch({
    userSelf: () => errorResponse(429, { 'retry-after': '10' })
  })
  const { authFetch } = createLoginAuthFetch(jwt(NOW / 1000 + 3_600))

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal('retryAfterSeconds' in result, false)
  assert.equal(calls.length, 0)
})

test('sync sin KUBIOS_TEAM_ID: el equipo esperado con team_id no UUID falla cerrado sin RPC', async () => {
  const { service, calls } = createService()
  const { apiFetch } = createApiFetch({
    teams: [{ team_id: 'equipo-sin-uuid', name: TARGET_TEAM_NAME }]
  })
  const { authFetch } = createLoginAuthFetch(jwt(NOW / 1000 + 3_600))

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(calls.length, 0)
})

test('sync sin KUBIOS_TEAM_ID: respuesta malformada falla cerrado sin RPC', async () => {
  const { service, calls } = createService()
  const { apiFetch } = createApiFetch({
    // Falta `name`: el cliente de API acepta el team_id, pero el parser de
    // equipos invalida la respuesta completa.
    teams: [{ team_id: TEAM_A }]
  })
  const { authFetch } = createLoginAuthFetch(jwt(NOW / 1000 + 3_600))

  const result = await runKubiosSync({
    service,
    env: ENV_WITHOUT_TEAM,
    apiFetch,
    authFetch,
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(calls.length, 0)
})

test('sync con KUBIOS_TEAM_ID conserva el flujo actual y no llama a /v1/user/self', async () => {
  const idToken = jwt(NOW / 1000 + 3_600)
  const envelope = encryptKubiosToken(
    idToken,
    { teamId: TEAM_A, memberId: TEAM_A },
    CRYPTO_OPTIONS
  )
  const { service, callsNamed } = createService({
    tokenRow: rowFromEnvelope(envelope, (NOW / 1000 + 3_600) * 1000)
  })

  let userSelfCalls = 0
  const { apiFetch } = createApiFetch({
    userSelf: () => {
      userSelfCalls += 1
      return jsonResponse({ user: { teams: [{ team_id: TEAM_A, name: TARGET_TEAM_NAME }] } })
    },
    members: [{ team_user_id: MEMBER_A }],
    results: { [MEMBER_A]: [] }
  })

  const result = await runKubiosSync({
    service,
    env: ENV_WITH_TEAM,
    apiFetch,
    authFetch: async () => {
      throw new Error('sin login esperado')
    },
    now: () => NOW
  })

  assert.deepEqual(result, { status: 'ok', synced: 1, failed: 0 })
  assert.equal(userSelfCalls, 0)
  assert.equal(callsNamed('kubios_get_token').length, 1)
  assert.equal(callsNamed('kubios_write_token').length, 0)
  assert.equal(callsNamed('kubios_try_acquire_sync')[0].args.p_team_id, TEAM_A)
})

/* ------------------------------------------------------------------------- *
 * 5. Sin logs con datos sensibles en las rutas nuevas
 * ------------------------------------------------------------------------- */

test('las rutas nuevas no escriben credenciales, tokens, IDs ni HRV en consola', async () => {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  }
  const logged = []
  for (const key of Object.keys(original)) {
    console[key] = (...args) => logged.push({ key, args })
  }

  try {
    const idToken = jwt(NOW / 1000 + 3_600)

    const success = createService()
    const successApi = createApiFetch({
      teams: [{ team_id: TEAM_A, name: TARGET_TEAM_NAME }],
      members: [{ team_user_id: MEMBER_A }],
      results: { [MEMBER_A]: [{ synthetic_metric: 1 }] }
    })
    await runKubiosSync({
      service: success.service,
      env: ENV_WITHOUT_TEAM,
      apiFetch: successApi.apiFetch,
      authFetch: createLoginAuthFetch(idToken).authFetch,
      now: () => NOW
    })

    const failure = createService()
    const failureApi = createApiFetch({
      teams: [
        { team_id: TEAM_A, name: 'Otro equipo A' },
        { team_id: TEAM_B, name: 'Otro equipo B' }
      ]
    })
    await runKubiosSync({
      service: failure.service,
      env: ENV_WITHOUT_TEAM,
      apiFetch: failureApi.apiFetch,
      authFetch: createLoginAuthFetch(idToken).authFetch,
      now: () => NOW
    })
  } finally {
    for (const key of Object.keys(original)) console[key] = original[key]
  }

  assert.deepEqual(logged, [])
})

/**
 * Pruebas locales del cliente de autenticación de Kubios (K12).
 *
 * No realizan peticiones de red: `fetch` y el reloj están inyectados y todos
 * los JWT son ficticios. Ejecutar con:
 *
 *   node --conditions=react-server --test scripts/test_kubios_auth_client.test.mjs
 *
 * `--conditions=react-server` resuelve el marcador `server-only` a su módulo
 * vacío, igual que el runtime de servidor de Next.js.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { Buffer } from 'node:buffer'
import { registerHooks } from 'node:module'

// Los módulos del proyecto importan rutas relativas sin extensión (convención
// de Next.js); el cargador nativo de Node exige extensión en ESM. El hook
// resuelve esas rutas a `.ts` sin modificar el código de producción.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.[cm]?[jt]s$/.test(specifier)
    ) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        // Sin extensión `.ts`: se intenta la resolución normal.
      }
    }

    return nextResolve(specifier, context)
  }
})

const {
  KUBIOS_LOGIN_TIMEOUT_MS,
  KUBIOS_MEMBER_UNAUTHORIZED_STATUS,
  KUBIOS_TOKEN_EXPIRY_MARGIN_MS,
  KubiosAuthClient,
  isKubiosMemberUnauthorized
} = await import('../src/lib/kubios-auth-client.ts')
const { decryptKubiosToken, encryptKubiosToken } = await import('../src/lib/kubios-crypto.ts')

const TEAM_ID = 'team-fixture'
const MEMBER_ID = 'member-fixture'
const OTHER_MEMBER_ID = 'other-member-fixture'
const NOW = 1_800_000_000_000
const NOW_SECONDS = NOW / 1000
const REDIRECT_URI = 'https://analysis.kubioscloud.com/v1/portal/login'
const LOGIN_URL = 'https://kubioscloud.auth.eu-west-1.amazoncognito.com/login'

const ENV = {
  KUBIOS_USERNAME: 'kubios-user-fixture',
  KUBIOS_PASSWORD: 'kubios-password-fixture',
  KUBIOS_CLIENT_ID: 'kubios-client-fixture',
  KUBIOS_TEAM_ID: TEAM_ID,
  KUBIOS_ENCRYPTION_KEY_V1: Buffer.alloc(32, 0x2a).toString('base64')
}

const SCOPE = { teamId: TEAM_ID, memberId: MEMBER_ID }

function jwt(expSeconds, extraClaims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ sub: 'synthetic-subject', exp: expSeconds, ...extraClaims })
  ).toString('base64url')
  const signature = Buffer.from('synthetic-signature').toString('base64url')
  return `${header}.${payload}.${signature}`
}

function encryptedRecord(token, expiresAt, memberId = MEMBER_ID) {
  return {
    envelope: encryptKubiosToken(token, { teamId: TEAM_ID, memberId }, { env: ENV }),
    expiresAt
  }
}

function loginResponse(token) {
  const fragment = new URLSearchParams({
    access_token: 'synthetic-access-token',
    token_type: 'Bearer',
    id_token: token
  }).toString()

  return new Response(null, {
    status: 302,
    headers: { location: `${REDIRECT_URI}#${fragment}` }
  })
}

function responseWithLocation(location, status = 302) {
  return new Response(null, {
    status,
    headers: location === null ? {} : { location }
  })
}

function tamperEnvelope(envelope) {
  const index = Math.floor(envelope.length / 2)
  const replacement = envelope[index] === 'A' ? 'B' : 'A'
  return envelope.slice(0, index) + replacement + envelope.slice(index + 1)
}

class MemoryStore {
  constructor() {
    this.records = new Map()
    this.writes = []
    this.readCount = 0
    this.deleteCount = 0
    this.failRead = false
    this.failWrite = false
    this.failDelete = false
  }

  _key(scope) {
    return `${scope.teamId}\u0000${scope.memberId}`
  }

  async read(scope) {
    this.readCount += 1
    if (this.failRead) throw new Error('fallo de lectura sintético')
    return this.records.get(this._key(scope)) ?? null
  }

  async write(scope, token) {
    this.writes.push({ scope, token })
    if (this.failWrite) throw new Error('fallo de escritura sintético')
    this.records.set(this._key(scope), token)
  }

  async delete(scope) {
    this.deleteCount += 1
    if (this.failDelete) throw new Error('fallo de borrado sintético')
    this.records.delete(this._key(scope))
  }

  seed(scope, token) {
    this.records.set(this._key(scope), token)
  }

  peek(scope) {
    return this.records.get(this._key(scope)) ?? null
  }
}

function createClient(overrides = {}) {
  const calls = []
  const queue = overrides.responses ?? []

  const fetchImpl = async (input, init) => {
    calls.push({ input, init })
    const next = queue.shift()
    if (next === undefined) throw new Error('petición no esperada')
    if (next instanceof Error) throw next
    return next
  }

  const client = new KubiosAuthClient({
    memberId: overrides.memberId ?? MEMBER_ID,
    store: overrides.store ?? new MemoryStore(),
    fetch: fetchImpl,
    now: overrides.now ?? (() => NOW),
    env: overrides.env ?? ENV,
    cryptoOptions: { env: overrides.env ?? ENV },
    expiryMarginMs: overrides.marginMs
  })

  return { client, calls, store: overrides.store ?? null }
}

function expectFailure(result, code) {
  assert.equal(result.ok, false)
  assert.deepEqual(Object.keys(result).sort(), ['code', 'ok'])
  assert.equal(result.code, code)

  const serialized = JSON.stringify(result)
  assert.ok(!serialized.includes('http'))
  assert.ok(!serialized.includes('id_token'))
  assert.ok(!serialized.includes('password'))
  assert.ok(!serialized.includes('envelope'))
  assert.ok(!serialized.includes('Location'))
}

/** Comprueba `redirect_invalid` y que el resultado no filtre los valores hostiles. */
function expectRedirectInvalid(result, forbidden = []) {
  expectFailure(result, 'redirect_invalid')
  assert.ok(!('idToken' in result))

  const serialized = JSON.stringify(result)
  for (const value of forbidden) {
    assert.ok(!serialized.includes(value), `el resultado no debe contener "${value}"`)
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('login correcto: POST form-urlencoded con CSRF, redirect manual y persistencia cifrada', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  const { client, calls } = createClient({ store, responses: [loginResponse(token)] })

  const result = await client.getToken()

  assert.equal(result.ok, true)
  assert.equal(result.source, 'login')
  assert.equal(result.expiresAt, (NOW_SECONDS + 600) * 1000)
  assert.ok(result.idToken === token)

  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(call.input, LOGIN_URL)
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.redirect, 'manual')

  const headers = call.init.headers
  assert.equal(headers['Content-Type'], 'application/x-www-form-urlencoded')

  const body = call.init.body
  assert.ok(body instanceof URLSearchParams)
  assert.equal(body.get('client_id'), ENV.KUBIOS_CLIENT_ID)
  assert.equal(body.get('username'), ENV.KUBIOS_USERNAME)
  assert.equal(body.get('response_type'), 'token')
  assert.equal(body.get('scope'), 'openid')
  assert.equal(body.get('redirect_uri'), REDIRECT_URI)
  assert.ok(body.get('password') === ENV.KUBIOS_PASSWORD)

  const csrf = body.get('_csrf')
  assert.ok(typeof csrf === 'string' && csrf.length > 0)
  assert.equal(headers.Cookie, `XSRF-TOKEN=${csrf}`)

  assert.equal(store.writes.length, 1)
  assert.equal(store.writes[0].scope.teamId, TEAM_ID)
  assert.equal(store.writes[0].scope.memberId, MEMBER_ID)
  assert.deepEqual(Object.keys(store.writes[0].token).sort(), ['envelope', 'expiresAt'])
  assert.equal(store.writes[0].token.expiresAt, (NOW_SECONDS + 600) * 1000)
  assert.ok(store.writes[0].token.envelope !== token)
  assert.ok(!store.writes[0].token.envelope.includes(token))

  const persisted = JSON.stringify(store.peek(SCOPE))
  assert.ok(!persisted.includes(token))
  assert.ok(!persisted.includes('synthetic-access-token'))

  const decrypted = decryptKubiosToken(store.writes[0].token.envelope, SCOPE, { env: ENV })
  assert.ok(decrypted === token)

  // El AAD incluye teamId/memberId: otro miembro no puede descifrar el sobre.
  assert.throws(() =>
    decryptKubiosToken(
      store.writes[0].token.envelope,
      { teamId: TEAM_ID, memberId: OTHER_MEMBER_ID },
      { env: ENV }
    )
  )
})

test('token válido en store: se reutiliza sin autenticar', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  store.seed(SCOPE, encryptedRecord(token, (NOW_SECONDS + 600) * 1000))
  const { client, calls } = createClient({ store, responses: [] })

  const result = await client.getToken()

  assert.equal(result.ok, true)
  assert.equal(result.source, 'store')
  assert.ok(result.idToken === token)
  assert.equal(result.expiresAt, (NOW_SECONDS + 600) * 1000)
  assert.equal(calls.length, 0)
  assert.equal(store.writes.length, 0)
})

test('token caducado: autentica una vez y después reutiliza el nuevo token', async () => {
  const oldToken = jwt(NOW_SECONDS - 10)
  const newToken = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  store.seed(SCOPE, encryptedRecord(oldToken, (NOW_SECONDS + 600) * 1000))
  const { client, calls } = createClient({ store, responses: [loginResponse(newToken)] })

  const first = await client.getToken()
  assert.equal(first.ok, true)
  assert.equal(first.source, 'login')
  assert.ok(first.idToken === newToken)

  const second = await client.getToken()
  assert.equal(second.ok, true)
  assert.equal(second.source, 'store')
  assert.ok(second.idToken === newToken)

  assert.equal(calls.length, 1)
  assert.equal(store.writes.length, 1)
})

test('token dentro del margen de seguridad: se renueva antes de expirar', async () => {
  const nearToken = jwt(NOW_SECONDS + 30)
  const newToken = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  store.seed(SCOPE, encryptedRecord(nearToken, (NOW_SECONDS + 30) * 1000))
  const { client, calls } = createClient({ store, responses: [loginResponse(newToken)] })

  const result = await client.getToken()

  assert.equal(result.ok, true)
  assert.equal(result.source, 'login')
  assert.equal(calls.length, 1)
})

test('margen configurable: con margen cero se reutiliza un token aún vigente', async () => {
  const token = jwt(NOW_SECONDS + 30)
  const store = new MemoryStore()
  store.seed(SCOPE, encryptedRecord(token, (NOW_SECONDS + 30) * 1000))
  const { client, calls } = createClient({ store, responses: [], marginMs: 0 })

  const result = await client.getToken()

  assert.equal(result.ok, true)
  assert.equal(result.source, 'store')
  assert.equal(calls.length, 0)
})

test('el reloj inyectado decide la reutilización y la reautenticación', async () => {
  let currentNow = NOW
  const token = jwt(NOW_SECONDS + 120)
  const newToken = jwt(NOW_SECONDS + 900)
  const store = new MemoryStore()
  store.seed(SCOPE, encryptedRecord(token, (NOW_SECONDS + 120) * 1000))
  const { client, calls } = createClient({
    store,
    now: () => currentNow,
    responses: [loginResponse(newToken)]
  })

  const whileValid = await client.getToken()
  assert.equal(whileValid.ok, true)
  assert.equal(whileValid.source, 'store')
  assert.equal(calls.length, 0)

  // A 30 segundos de expirar entra dentro del margen de 60 segundos.
  currentNow = (NOW_SECONDS + 90) * 1000
  const nearExpiry = await client.getToken()
  assert.equal(nearExpiry.ok, true)
  assert.equal(nearExpiry.source, 'login')
  assert.equal(calls.length, 1)
})

test('expiración persistida manipulada: prevalece la expiración real del JWT', async () => {
  const expiredToken = jwt(NOW_SECONDS - 10)
  const newToken = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  store.seed(SCOPE, encryptedRecord(expiredToken, (NOW_SECONDS + 3600) * 1000))
  const { client, calls } = createClient({ store, responses: [loginResponse(newToken)] })

  const result = await client.getToken()

  assert.equal(result.ok, true)
  assert.equal(result.source, 'login')
  assert.equal(calls.length, 1)
})

test('sobre cifrado manipulado: se descarta y se autentica de nuevo', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const newToken = jwt(NOW_SECONDS + 900)
  const store = new MemoryStore()
  const valid = encryptedRecord(token, (NOW_SECONDS + 600) * 1000)
  store.seed(SCOPE, { ...valid, envelope: tamperEnvelope(valid.envelope) })
  const { client, calls } = createClient({ store, responses: [loginResponse(newToken)] })

  const result = await client.getToken()

  assert.equal(result.ok, true)
  assert.equal(result.source, 'login')
  assert.ok(result.idToken === newToken)
  assert.equal(calls.length, 1)
  assert.ok(store.deleteCount >= 1)
  assert.equal(store.writes.length, 1)
})

test('302 sin token en el fragmento → token_missing', async () => {
  const store = new MemoryStore()
  const { client, calls } = createClient({
    store,
    responses: [responseWithLocation(REDIRECT_URI)]
  })

  expectFailure(await client.getToken(), 'token_missing')

  assert.equal(calls.length, 1)
  assert.equal(store.writes.length, 0)
})

test('302 sin Location → redirect_missing', async () => {
  const { client } = createClient({ responses: [responseWithLocation(null)] })

  expectFailure(await client.getToken(), 'redirect_missing')
})

test('Location no absoluta → redirect_invalid', async () => {
  const { client } = createClient({
    responses: [responseWithLocation('analysis.kubioscloud.com/v1/portal/login#id_token=sintetico')]
  })

  expectFailure(await client.getToken(), 'redirect_invalid')
})

test('Location de otro host con id_token válido → redirect_invalid sin persistir ni devolver token', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  const attacker = 'attacker.example'
  const { client, calls } = createClient({
    store,
    responses: [
      responseWithLocation(
        `https://${attacker}/v1/portal/login#access_token=synthetic-access&id_token=${token}`
      )
    ]
  })

  const result = await client.getToken()

  expectRedirectInvalid(result, [attacker, token, 'synthetic-access'])
  assert.equal(calls.length, 1)
  assert.equal(store.writes.length, 0)
  assert.equal(store.peek(SCOPE), null)
})

test('Location con sufijo de host ajeno → redirect_invalid', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  const attacker = 'analysis.kubioscloud.com.attacker.example'
  const { client } = createClient({
    store,
    responses: [responseWithLocation(`https://${attacker}/v1/portal/login#id_token=${token}`)]
  })

  expectRedirectInvalid(await client.getToken(), [attacker, token])
  assert.equal(store.writes.length, 0)
})

test('Location con protocolo no seguro o esquema no navegable → redirect_invalid', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const locations = [
    `http://analysis.kubioscloud.com/v1/portal/login#id_token=${token}`,
    `javascript:alert(1)#id_token=${token}`,
    `data:text/html,hostile#id_token=${token}`
  ]

  for (const location of locations) {
    const store = new MemoryStore()
    const { client } = createClient({ store, responses: [responseWithLocation(location)] })

    expectRedirectInvalid(await client.getToken(), [token, 'analysis.kubioscloud.com'])
    assert.equal(store.writes.length, 0)
  }
})

test('Location con ruta distinta → redirect_invalid, con o sin id_token', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const locations = [
    `https://analysis.kubioscloud.com/v1/portal/logout#id_token=${token}`,
    'https://analysis.kubioscloud.com/v1/portal/logout',
    `https://analysis.kubioscloud.com/v1/portal/login/#id_token=${token}`
  ]

  for (const location of locations) {
    const store = new MemoryStore()
    const { client } = createClient({ store, responses: [responseWithLocation(location)] })

    expectRedirectInvalid(await client.getToken(), [token, 'logout'])
    assert.equal(store.writes.length, 0)
  }
})

test('Location con credenciales embebidas → redirect_invalid', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  const { client } = createClient({
    store,
    responses: [
      responseWithLocation(
        `https://fixture-user:fixture-secret@analysis.kubioscloud.com/v1/portal/login#id_token=${token}`
      )
    ]
  })

  expectRedirectInvalid(await client.getToken(), [token, 'fixture-secret', 'fixture-user'])
  assert.equal(store.writes.length, 0)
})

test('Location con puerto no estándar → redirect_invalid', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  const { client } = createClient({
    store,
    responses: [
      responseWithLocation(`https://analysis.kubioscloud.com:8443/v1/portal/login#id_token=${token}`)
    ]
  })

  expectRedirectInvalid(await client.getToken(), [token, '8443'])
  assert.equal(store.writes.length, 0)
})

test('Location con query inesperada → redirect_invalid aunque el fragmento traiga un JWT válido', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  const attacker = 'attacker.example'
  const { client } = createClient({
    store,
    responses: [
      responseWithLocation(
        `https://analysis.kubioscloud.com/v1/portal/login?next=https://${attacker}#id_token=${token}`
      )
    ]
  })

  expectRedirectInvalid(await client.getToken(), [token, 'next', attacker])
  assert.equal(store.writes.length, 0)
})

test('estado distinto de 302 → login_rejected', async () => {
  const store = new MemoryStore()
  const { client } = createClient({
    store,
    responses: [new Response('cuerpo sintético', { status: 200 })]
  })

  expectFailure(await client.getToken(), 'login_rejected')
  assert.equal(store.writes.length, 0)
})

test('fragmento con error de Cognito → login_rejected sin exponer el valor', async () => {
  const { client } = createClient({
    responses: [responseWithLocation(`${REDIRECT_URI}#error=access_denied&state=sintetico`)]
  })

  expectFailure(await client.getToken(), 'login_rejected')
})

test('JWT malformado → token_malformed', async () => {
  const { client } = createClient({
    responses: [loginResponse('cabecera.payload.sin-firma-valida')]
  })

  expectFailure(await client.getToken(), 'token_malformed')
})

test('JWT sin exp → token_malformed', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: 'sin-exp' })).toString('base64url')
  const token = `${header}.${payload}.${Buffer.from('firma').toString('base64url')}`
  const { client } = createClient({ responses: [loginResponse(token)] })

  expectFailure(await client.getToken(), 'token_malformed')
})

test('JWT ya expirado en la redirección → token_expired', async () => {
  const token = jwt(NOW_SECONDS - 1)
  const { client } = createClient({ responses: [loginResponse(token)] })

  expectFailure(await client.getToken(), 'token_expired')
})

test('fallo de red o excepción de fetch → login_request_failed sin filtrar el mensaje', async () => {
  const leak = `${REDIRECT_URI}#id_token=no-debe-filtrarse`
  const { client } = createClient({
    responses: [new Error(`fallo sintético con Location ${leak} y credenciales sintéticas`)]
  })

  const result = await client.getToken()

  expectFailure(result, 'login_request_failed')
  assert.ok(!JSON.stringify(result).includes(leak))
})

test('fetch que lanza de forma síncrona → login_request_failed sin exponer el mensaje', async () => {
  const store = new MemoryStore()
  const client = new KubiosAuthClient({
    memberId: MEMBER_ID,
    store,
    fetch: () => {
      throw new Error('fallo síncrono sintético con password=no-debe-filtrarse')
    },
    now: () => NOW,
    env: ENV,
    cryptoOptions: { env: ENV }
  })

  const result = await client.getToken()

  expectFailure(result, 'login_request_failed')
  assert.ok(!JSON.stringify(result).includes('no-debe-filtrarse'))
  assert.equal(store.writes.length, 0)
})

test('login sin respuesta: el timeout acota la espera y aborta la señal enviada', async () => {
  let signal
  const store = new MemoryStore()
  const client = new KubiosAuthClient({
    memberId: MEMBER_ID,
    store,
    fetch: (_input, init) => {
      signal = init.signal
      return new Promise(() => {})
    },
    now: () => NOW,
    env: ENV,
    cryptoOptions: { env: ENV },
    loginTimeoutMs: 20
  })

  const startedAt = Date.now()
  const result = await client.getToken()
  const elapsed = Date.now() - startedAt

  expectFailure(result, 'login_request_failed')
  assert.ok(elapsed < 5_000, `debe cortar en el timeout configurado, tardó ${elapsed} ms`)
  assert.ok(signal instanceof AbortSignal)
  assert.equal(signal.aborted, true)
  assert.equal(store.writes.length, 0)
})

test('fetch que resuelve tarde ignorando la señal: timeout sin escritura ni token', async () => {
  const late = deferred()
  let signal
  const store = new MemoryStore()
  const client = new KubiosAuthClient({
    memberId: MEMBER_ID,
    store,
    fetch: (_input, init) => {
      signal = init.signal
      return late.promise
    },
    now: () => NOW,
    env: ENV,
    cryptoOptions: { env: ENV },
    loginTimeoutMs: 20
  })

  const startedAt = Date.now()
  const result = await client.getToken()
  const elapsed = Date.now() - startedAt

  expectFailure(result, 'login_request_failed')
  assert.ok(elapsed < 5_000, `debe cortar en el timeout configurado, tardó ${elapsed} ms`)
  assert.equal(signal.aborted, true)

  // La respuesta tardía se descarta: no hay segunda escritura ni token devuelto.
  late.resolve(loginResponse(jwt(NOW_SECONDS + 600)))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(store.writes.length, 0)
  assert.equal(store.peek(SCOPE), null)
})

test('fetch que rechaza después del timeout no deja un rechazo sin manejar', async () => {
  const late = deferred()
  const store = new MemoryStore()
  const client = new KubiosAuthClient({
    memberId: MEMBER_ID,
    store,
    fetch: () => late.promise,
    now: () => NOW,
    env: ENV,
    cryptoOptions: { env: ENV },
    loginTimeoutMs: 20
  })

  expectFailure(await client.getToken(), 'login_request_failed')

  late.reject(new Error('fallo tardío sintético con credenciales ficticias'))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(store.writes.length, 0)
})

test('loginTimeoutMs inválido → invalid_options sin tocar store ni fetch', async () => {
  const invalidValues = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1000']

  for (const loginTimeoutMs of invalidValues) {
    const store = new MemoryStore()
    const calls = []
    const client = new KubiosAuthClient({
      memberId: MEMBER_ID,
      store,
      fetch: async () => {
        calls.push('fetch')
        return loginResponse(jwt(NOW_SECONDS + 600))
      },
      now: () => NOW,
      env: ENV,
      cryptoOptions: { env: ENV },
      loginTimeoutMs
    })

    expectFailure(await client.getToken(), 'invalid_options')
    assert.equal(calls.length, 0)
    assert.equal(store.readCount, 0)
  }
})

test('configuración incompleta → config_unavailable', async () => {
  const store = new MemoryStore()
  const { client, calls } = createClient({ store, env: {}, responses: [] })

  expectFailure(await client.getToken(), 'config_unavailable')
  assert.equal(calls.length, 0)
  assert.equal(store.readCount, 0)
})

test('fallo al leer el store → store_read_failed', async () => {
  const store = new MemoryStore()
  store.failRead = true
  const { client, calls } = createClient({ store, responses: [] })

  expectFailure(await client.getToken(), 'store_read_failed')
  assert.equal(calls.length, 0)
})

test('fallo al escribir el store → store_write_failed y sin token devuelto', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  store.failWrite = true
  const { client } = createClient({ store, responses: [loginResponse(token)] })

  const result = await client.getToken()

  expectFailure(result, 'store_write_failed')
  assert.ok(!('idToken' in result))
})

test('clave de cifrado ausente → crypto_failed', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const envWithoutKey = {
    KUBIOS_USERNAME: ENV.KUBIOS_USERNAME,
    KUBIOS_PASSWORD: ENV.KUBIOS_PASSWORD,
    KUBIOS_CLIENT_ID: ENV.KUBIOS_CLIENT_ID,
    KUBIOS_TEAM_ID: ENV.KUBIOS_TEAM_ID
  }
  const store = new MemoryStore()
  const { client } = createClient({
    store,
    env: envWithoutKey,
    responses: [loginResponse(token)]
  })

  expectFailure(await client.getToken(), 'crypto_failed')
  assert.equal(store.writes.length, 0)
})

test('opciones inválidas → invalid_options sin tocar store ni fetch', async () => {
  const store = new MemoryStore()
  const client = new KubiosAuthClient({
    memberId: '   ',
    store,
    fetch: async () => loginResponse(jwt(NOW_SECONDS + 600)),
    now: () => NOW,
    env: ENV,
    cryptoOptions: { env: ENV }
  })

  expectFailure(await client.getToken(), 'invalid_options')
  assert.equal(store.readCount, 0)
})

test('401 de miembro: no se confunde con caducidad ni dispara reautenticación', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  store.seed(SCOPE, encryptedRecord(token, (NOW_SECONDS + 600) * 1000))
  const { client, calls } = createClient({ store, responses: [] })

  const first = await client.getToken()
  assert.equal(first.ok, true)
  assert.equal(first.source, 'store')

  assert.equal(KUBIOS_MEMBER_UNAUTHORIZED_STATUS, 401)
  assert.equal(isKubiosMemberUnauthorized(401), true)
  assert.equal(isKubiosMemberUnauthorized(403), false)
  assert.equal(isKubiosMemberUnauthorized(500), false)

  // El llamador propaga el 401; volver a pedir el token no reautentica.
  const afterUnauthorized = await client.getToken()
  assert.equal(afterUnauthorized.ok, true)
  assert.equal(afterUnauthorized.source, 'store')
  assert.equal(calls.length, 0)
  assert.equal(store.writes.length, 0)
})

test('llamadas concurrentes comparten una única autenticación', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  const { client, calls } = createClient({ store, responses: [loginResponse(token)] })

  const [first, second] = await Promise.all([client.getToken(), client.getToken()])

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(first.source, 'login')
  assert.equal(second.source, 'login')
  assert.equal(calls.length, 1)
  assert.equal(store.writes.length, 1)
})

test('nunca escribe en consola durante login ni errores', async () => {
  const token = jwt(NOW_SECONDS + 600)
  const store = new MemoryStore()
  const { client } = createClient({ store, responses: [loginResponse(token)] })

  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  }
  const calls = []
  for (const key of Object.keys(original)) {
    console[key] = (...args) => calls.push({ key, args })
  }

  let success
  let failureResult
  try {
    success = await client.getToken()
    const failing = createClient({
      store: new MemoryStore(),
      responses: [new Response('cuerpo sintético', { status: 500 })]
    })
    failureResult = await failing.client.getToken()
  } finally {
    for (const key of Object.keys(original)) console[key] = original[key]
  }

  assert.equal(calls.length, 0)
  assert.equal(success.ok, true)
  assert.equal(failureResult.ok, false)
  assert.ok(!JSON.stringify(failureResult).includes(token))
})

test('constantes públicas del contrato', () => {
  assert.equal(KUBIOS_LOGIN_TIMEOUT_MS, 30_000)
  assert.equal(KUBIOS_TOKEN_EXPIRY_MARGIN_MS, 60_000)
  assert.equal(KUBIOS_MEMBER_UNAUTHORIZED_STATUS, 401)
})

// Pruebas locales del cliente de la API de Kubios (sin red real).
// Ejecutar desde la raíz del repositorio:
//   node --test --conditions=react-server tests/kubios-api-client.k13.test.mjs
// Requiere un Node con type stripping nativo (22.18+/24). El flag
// --conditions=react-server resuelve `server-only` como en el servidor de Next.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  KUBIOS_API_ORIGIN,
  KubiosApiError,
  fetchKubiosHrvResults,
  fetchKubiosTeamMembers,
  parseRetryAfterHeader
} from '../src/lib/kubios-api-client.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOKEN = 'synthetic-id-token-for-tests-only'
const TEAM_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'

// Reloj sintético de K38: 2026-10-27T12:00:00Z. La asctime
// "Wed Oct 28 12:00:00 2026" queda exactamente a 24 h.
const FIXED_NOW = Date.parse('2026-10-27T12:00:00.000Z')
const CLIENT_MODULE_URL = pathToFileURL(
  join(HERE, '..', 'src', 'lib', 'kubios-api-client.ts')
).href

/**
 * Ejecuta el parser en un proceso hijo con `TZ` forzada. En Windows cambiar
 * `process.env.TZ` en el proceso actual no basta: el runtime fija la zona al
 * arrancar. La salida incluye `getTimezoneOffset` como prueba de que la zona
 * se aplicó de verdad (Tokio -540, Nueva York 240, UTC 0).
 */
function parseAsctimeInChild(timeZone) {
  const script = [
    `Date.now = () => ${FIXED_NOW}`,
    `const { parseRetryAfterHeader } = await import(${JSON.stringify(CLIENT_MODULE_URL)})`,
    `const value = parseRetryAfterHeader('Wed Oct 28 12:00:00 2026')`,
    `const offsetMinutes = new Date('2026-10-28T12:00:00.000Z').getTimezoneOffset()`,
    `process.stdout.write(JSON.stringify({ value, offsetMinutes }))`
  ].join('\n')

  return spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--input-type=module',
      '--eval',
      script
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, TZ: timeZone },
      timeout: 30_000
    }
  )
}

function rawJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload
  }
}

function statusResponse(status, headers = {}) {
  return new Response(null, { status, headers })
}

function textResponse(status, text, headers = {}) {
  return new Response(text, { status, headers })
}

function createFetchMock(handler) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { calls, fetch }
}

async function expectKubiosError(promise, code, check = () => {}) {
  let caught
  try {
    await promise
  } catch (error) {
    caught = error
  }

  assert.ok(caught, `se esperaba un error con código ${code}`)
  assert.ok(caught instanceof KubiosApiError, 'el error debe ser KubiosApiError')
  assert.equal(caught.code, code)
  assert.equal(typeof caught.message, 'string')
  check(caught)
  return caught
}

function hangingFetch() {
  return (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener(
        'abort',
        () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        },
        { once: true }
      )
    })
}

function teamFixture() {
  return {
    members: [
      {
        team_user_id: MEMBER_ID,
        name: 'Miembro Sintético A',
        email: 'miembro.a@example.invalid',
        synthetic_nested: { level: 1 }
      },
      {
        team_user_id: '33333333-3333-4333-8333-333333333333',
        name: 'Miembro Sintético B'
      }
    ],
    team_name: 'Equipo Sintético'
  }
}

function resultsFixture() {
  return {
    results: [
      {
        result_id: 'result-synthetic-1',
        measured_at: '2026-01-01T00:00:00Z',
        synthetic_metric: 42,
        nested: { sample: [1, 2, 3] }
      },
      {
        result_id: 'result-synthetic-2',
        arbitrary_payload: ['sin', 'interpretar', null]
      }
    ]
  }
}

test('team members: URL fija, token en cabecera y objetos preservados', async () => {
  const payload = teamFixture()
  const { calls, fetch } = createFetchMock(() => rawJsonResponse(payload))

  const page = await fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch })

  assert.equal(calls.length, 1)
  const [{ url, init }] = calls
  assert.equal(
    url,
    `${KUBIOS_API_ORIGIN}/v2/team/team/${TEAM_ID}?members=yes`
  )
  assert.ok(!url.includes(TOKEN), 'el token no debe aparecer en la URL')
  assert.equal(init.method, 'GET')
  assert.equal(init.headers.Authorization, TOKEN)
  assert.equal(init.headers.Accept, 'application/json')
  assert.equal(init.redirect, 'error')
  assert.equal(init.cache, 'no-store')
  assert.ok(init.signal instanceof AbortSignal)
  assert.equal(page.members, payload.members)
  assert.equal(page.members[0], payload.members[0])
  assert.equal(page.members[1], payload.members[1])
})

test('results: URL fija, token en cabecera y registros sin transformar', async () => {
  const payload = resultsFixture()
  const { calls, fetch } = createFetchMock(() => rawJsonResponse(payload))

  const page = await fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch })

  assert.equal(calls.length, 1)
  const [{ url, init }] = calls
  assert.equal(url, `${KUBIOS_API_ORIGIN}/v1/result/${MEMBER_ID}`)
  assert.ok(!url.includes(TOKEN), 'el token no debe aparecer en la URL')
  assert.equal(init.headers.Authorization, TOKEN)
  assert.equal(page.results, payload.results)
  assert.equal(page.results[0], payload.results[0])
  assert.deepEqual(Object.keys(page.results[0]), Object.keys(payload.results[0]))
})

test('listas vacías son respuestas válidas, no errores', async () => {
  const teamFetch = createFetchMock(() => rawJsonResponse({ members: [] }))
  const teamPage = await fetchKubiosTeamMembers(TEAM_ID, TOKEN, {
    fetch: teamFetch.fetch
  })
  assert.deepEqual(teamPage.members, [])

  const resultsFetch = createFetchMock(() => rawJsonResponse({ results: [] }))
  const resultsPage = await fetchKubiosHrvResults(MEMBER_ID, TOKEN, {
    fetch: resultsFetch.fetch
  })
  assert.deepEqual(resultsPage.results, [])
})

test('miembros sin team_user_id string se aceptan y se preservan sin modificar', async () => {
  // F1: la página no se rechaza por miembros sin identificador válido. El
  // sincronizador K14 los cuenta como fallo y sigue con los UUID válidos.
  const payload = {
    members: [
      { team_user_id: MEMBER_ID, name: 'Miembro Sintético A' },
      { team_user_id: null, name: 'Miembro Sintético Sin Id' },
      {},
      { team_user_id: '', name: 'Miembro Sintético Vacío' },
      { team_user_id: 42 },
      { team_user_id: '33333333-3333-4333-8333-333333333333', name: 'Miembro Sintético B' }
    ],
    team_name: 'Equipo Sintético'
  }
  const { calls, fetch } = createFetchMock(() => rawJsonResponse(payload))

  const page = await fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch })

  assert.equal(calls.length, 1)
  assert.equal(page.members, payload.members, 'debe conservarse la misma página')
  for (let index = 0; index < payload.members.length; index += 1) {
    assert.equal(page.members[index], payload.members[index], `mismo objeto en ${index}`)
  }
  // No se normaliza ni se completa ninguna propiedad.
  assert.deepEqual(Object.keys(page.members[1]), ['team_user_id', 'name'])
  assert.deepEqual(Object.keys(page.members[2]), [])
  assert.equal(page.members[1].team_user_id, null)
  assert.equal(page.members[2].team_user_id, undefined)
})

test('JSON inválido falla cerrado', async () => {
  const { fetch } = createFetchMock(() =>
    textResponse(200, '{"members": [', {
      'content-type': 'application/json'
    })
  )

  await expectKubiosError(
    fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch }),
    'invalid_json'
  )
})

test('estructuras no esperadas fallan cerrado', async () => {
  const invalidMembers = [
    {},
    [],
    { members: null },
    { members: {} },
    { members: 'texto' },
    { members: ['texto'] },
    { members: [null] },
    { members: [42] },
    { members: [[]] }
  ]

  for (const payload of invalidMembers) {
    const { calls, fetch } = createFetchMock(() => rawJsonResponse(payload))
    await expectKubiosError(
      fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch }),
      'invalid_response_shape',
      (error) => assert.equal(error.endpoint, 'team-members')
    )
    assert.equal(calls.length, 1)
  }

  const invalidResults = [
    {},
    [],
    { results: null },
    { results: {} },
    { results: ['texto'] },
    { results: [null] },
    { results: [[]] }
  ]

  for (const payload of invalidResults) {
    const { calls, fetch } = createFetchMock(() => rawJsonResponse(payload))
    await expectKubiosError(
      fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch }),
      'invalid_response_shape',
      (error) => assert.equal(error.endpoint, 'hrv-results')
    )
    assert.equal(calls.length, 1)
  }
})

test('401 no reautentica ni reintenta, descarta el cuerpo y no filtra el token', async () => {
  let canceled = 0
  let bodyRead = 0
  const unauthorizedResponse = {
    ok: false,
    status: 401,
    headers: { get: () => null },
    body: {
      cancel: async () => {
        canceled += 1
      }
    },
    json: async () => {
      bodyRead += 1
      throw new Error('el cuerpo de error no debe leerse')
    }
  }
  const { calls, fetch } = createFetchMock(() => unauthorizedResponse)

  const error = await expectKubiosError(
    fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch }),
    'unauthorized'
  )

  assert.equal(calls.length, 1)
  assert.equal(canceled, 1)
  assert.equal(bodyRead, 0)
  assert.equal(error.status, 401)
  assert.equal(error.endpoint, 'team-members')
  assert.ok(!error.message.includes(TOKEN))
  assert.ok(!JSON.stringify(error).includes(TOKEN))
  assert.ok(!String(error.stack || '').includes(TOKEN))
})

test('429 expone Retry-After en segundos', async () => {
  const { fetch } = createFetchMock(() =>
    statusResponse(429, { 'Retry-After': '120' })
  )

  const error = await expectKubiosError(
    fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch }),
    'rate_limited'
  )

  assert.equal(error.status, 429)
  assert.equal(error.retryAfterMs, 120_000)
})

test('429 expone Retry-After como fecha HTTP', async () => {
  const retryAt = new Date(Date.now() + 90_000).toUTCString()
  const { fetch } = createFetchMock(() =>
    statusResponse(429, { 'Retry-After': retryAt })
  )

  const error = await expectKubiosError(
    fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch }),
    'rate_limited'
  )

  assert.ok(
    error.retryAfterMs >= 85_000 && error.retryAfterMs <= 95_000,
    `retryAfterMs fuera de rango: ${error.retryAfterMs}`
  )
})

test('429 expone un Retry-After largo sin recortarlo', async () => {
  const { fetch } = createFetchMock(() =>
    statusResponse(429, { 'Retry-After': '100000' })
  )

  const error = await expectKubiosError(
    fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch }),
    'rate_limited'
  )

  assert.equal(error.retryAfterMs, 100_000_000)

  const longDate = new Date(Date.now() + 3 * 86_400_000).toUTCString()
  const dateFetch = createFetchMock(() =>
    statusResponse(429, { 'Retry-After': longDate })
  )
  const dateError = await expectKubiosError(
    fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch: dateFetch.fetch }),
    'rate_limited'
  )
  assert.ok(
    dateError.retryAfterMs >= 3 * 86_400_000 - 2_000 &&
      dateError.retryAfterMs <= 3 * 86_400_000,
    `fecha HTTP larga fuera de rango: ${dateError.retryAfterMs}`
  )
})

test('429 con Retry-After desbordado expone Infinity, no null ni ausencia', async () => {
  const { fetch } = createFetchMock(() =>
    statusResponse(429, { 'Retry-After': '999999999999999999999' })
  )

  const error = await expectKubiosError(
    fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch }),
    'rate_limited'
  )

  assert.equal(error.retryAfterMs, Number.POSITIVE_INFINITY)
  assert.notEqual(error.retryAfterMs, null)

  // La misma cabecera ausente sí es null: la distinción se conserva.
  const missing = createFetchMock(() => statusResponse(429))
  const missingError = await expectKubiosError(
    fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch: missing.fetch }),
    'rate_limited'
  )
  assert.equal(missingError.retryAfterMs, null)
})

test('429 sin Retry-After o con valor inválido no inventa espera', async () => {
  const missing = createFetchMock(() => statusResponse(429))
  const missingError = await expectKubiosError(
    fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch: missing.fetch }),
    'rate_limited'
  )
  assert.equal(missingError.retryAfterMs, null)

  const invalid = createFetchMock(() =>
    statusResponse(429, { 'Retry-After': 'más tarde' })
  )
  const invalidError = await expectKubiosError(
    fetchKubiosHrvResults(MEMBER_ID, TOKEN, { fetch: invalid.fetch }),
    'rate_limited'
  )
  assert.equal(invalidError.retryAfterMs, null)
})

test('parseRetryAfterHeader acepta segundos, fechas y rechaza el resto', () => {
  assert.equal(parseRetryAfterHeader(null), null)
  assert.equal(parseRetryAfterHeader(undefined), null)
  assert.equal(parseRetryAfterHeader(''), null)
  assert.equal(parseRetryAfterHeader('   '), null)
  assert.equal(parseRetryAfterHeader('0'), 0)
  assert.equal(parseRetryAfterHeader('45'), 45_000)
  assert.equal(parseRetryAfterHeader(' 45 '), 45_000)
  assert.equal(parseRetryAfterHeader('-5'), null)
  assert.equal(parseRetryAfterHeader('1.5'), null)
  assert.equal(parseRetryAfterHeader('abc'), null)
  assert.equal(parseRetryAfterHeader('Oct'), null)
  assert.equal(parseRetryAfterHeader('2026-10-27T00:00:00Z'), null)

  const past = new Date(Date.now() - 60_000).toUTCString()
  assert.equal(parseRetryAfterHeader(past), 0)
  assert.equal(parseRetryAfterHeader('Wed, 21 Oct 2015 07:28:00 GMT'), 0)
  assert.equal(parseRetryAfterHeader('Sunday, 06-Nov-94 08:49:37 GMT'), 0)
  assert.equal(parseRetryAfterHeader('Sun Nov  6 08:49:37 1994'), 0)

  const future = new Date(Date.now() + 60_000).toUTCString()
  const parsed = parseRetryAfterHeader(future)
  assert.ok(parsed !== null && parsed >= 55_000 && parsed <= 65_000)
})

test('parseRetryAfterHeader conserva plazos largos y marca el overflow con Infinity', () => {
  // Mas de un dia: se conserva exacto, sin clamp.
  assert.equal(parseRetryAfterHeader('86401'), 86_401_000)
  assert.equal(parseRetryAfterHeader('100000'), 100_000_000)
  assert.equal(parseRetryAfterHeader('999999'), 999_999_000)

  const longDate = new Date(Date.now() + 3 * 86_400_000).toUTCString()
  const parsedDate = parseRetryAfterHeader(longDate)
  assert.ok(
    parsedDate >= 3 * 86_400_000 - 2_000 && parsedDate <= 3 * 86_400_000,
    `fecha HTTP a tres dias fuera de rango: ${parsedDate}`
  )

  // Overflow explicito: ni null (ausente/invalida) ni un valor recortado.
  assert.equal(parseRetryAfterHeader('999999999999999999999'), Number.POSITIVE_INFINITY)
  assert.equal(parseRetryAfterHeader('99999999999999999'), Number.POSITIVE_INFINITY)
  assert.equal(parseRetryAfterHeader('9'.repeat(400)), Number.POSITIVE_INFINITY)

  // Un digito mas alla del maximo seguro por segundo tambien desborda.
  assert.equal(
    parseRetryAfterHeader(String(Number.MAX_SAFE_INTEGER)),
    Number.POSITIVE_INFINITY
  )
})

test('asctime se mide desde un reloj sintético y el día de la semana es etiqueta', (t) => {
  t.mock.method(Date, 'now', () => FIXED_NOW)

  // 2026-10-28 es miércoles; con `now` fijo la espera es exactamente 24 h.
  assert.equal(parseRetryAfterHeader('Wed Oct 28 12:00:00 2026'), 86_400_000)
  // Una etiqueta de día errónea no invalida una fecha de calendario válida.
  assert.equal(parseRetryAfterHeader('Sat Oct 28 12:00:00 2026'), 86_400_000)
  assert.equal(parseRetryAfterHeader('Thu Oct 29 12:00:00 2026'), 2 * 86_400_000)
  // Más de un día: sin recorte.
  assert.equal(parseRetryAfterHeader('Fri Oct 30 12:00:00 2026'), 3 * 86_400_000)
  // Mismo instante y fechas pasadas: 0.
  assert.equal(parseRetryAfterHeader('Tue Oct 27 12:00:00 2026'), 0)
  assert.equal(parseRetryAfterHeader('Sun Nov  6 08:49:37 1994'), 0)
  // 2000 y 2028 son bisiestos; 2028 además es futuro.
  assert.equal(parseRetryAfterHeader('Tue Feb 29 12:00:00 2000'), 0)
  assert.equal(
    parseRetryAfterHeader('Tue Feb 29 12:00:00 2028'),
    Date.UTC(2028, 1, 29, 12) - FIXED_NOW
  )
  // El overflow de segundos conserva su semántica explícita.
  assert.equal(
    parseRetryAfterHeader('999999999999999999999'),
    Number.POSITIVE_INFINITY
  )
})

test('asctime da el mismo instante UTC en UTC, Asia/Tokyo y America/New_York', () => {
  const expectedOffsets = new Map([
    ['UTC', 0],
    ['Asia/Tokyo', -540],
    ['America/New_York', 240]
  ])

  for (const [timeZone, expectedOffset] of expectedOffsets) {
    const result = parseAsctimeInChild(timeZone)
    assert.equal(
      result.status,
      0,
      `TZ=${timeZone}: el proceso hijo falló: ${result.stderr}`
    )

    let output
    try {
      output = JSON.parse(result.stdout)
    } catch {
      assert.fail(
        `TZ=${timeZone}: salida no JSON del proceso hijo: ${result.stdout}`
      )
    }

    assert.equal(
      output.offsetMinutes,
      expectedOffset,
      `TZ=${timeZone}: la zona no se aplicó al proceso hijo`
    )
    assert.equal(
      output.value,
      86_400_000,
      `TZ=${timeZone}: asctime debe ser 24 h exactas desde el reloj fijo`
    )
  }
})

test('asctime imposible o fuera de rango devuelve null, sin normalizar', () => {
  const invalidAsctime = [
    'Wed Apr 31 12:00:00 2026',
    'Fri Feb 30 12:00:00 2026',
    'Sun Feb 29 12:00:00 2026',
    'Sat Feb 29 12:00:00 1900',
    'Wed Oct  0 12:00:00 2026',
    'Wed Oct 32 12:00:00 2026',
    'Wed Oct 28 24:00:00 2026',
    'Wed Oct 28 12:60:00 2026',
    'Wed Oct 28 12:00:60 2026',
    'Wed Oct 28 12:00:00 0000',
    'Wed Foo 28 12:00:00 2026',
    'Wed Oct 28 12:00:00 2026 GMT',
    'Wed Oct 28 12:00:00 26'
  ]

  for (const value of invalidAsctime) {
    assert.equal(parseRetryAfterHeader(value), null, `debía ser null: ${value}`)
  }
})

test('el timeout aborta la petición y devuelve un error tipado', async () => {
  let calls = 0
  const fetch = (url, init) => {
    calls += 1
    return hangingFetch()(url, init)
  }

  const started = Date.now()
  const error = await expectKubiosError(
    fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch, timeoutMs: 25 }),
    'timeout'
  )
  const elapsed = Date.now() - started

  assert.equal(calls, 1)
  assert.equal(error.status, null)
  assert.ok(elapsed < 2_000, `el timeout tardó demasiado: ${elapsed} ms`)
})

test('la cancelación externa se distingue del timeout', async () => {
  const controller = new AbortController()
  const promise = fetchKubiosHrvResults(MEMBER_ID, TOKEN, {
    fetch: hangingFetch(),
    timeoutMs: 5_000,
    signal: controller.signal
  })
  setTimeout(() => controller.abort(), 20)

  const error = await expectKubiosError(promise, 'aborted')
  assert.equal(error.status, null)
})

test('una señal ya cancelada no emite petición', async () => {
  const controller = new AbortController()
  controller.abort()
  let called = false
  const fetch = () => {
    called = true
    return rawJsonResponse({ members: [] })
  }

  await expectKubiosError(
    fetchKubiosTeamMembers(TEAM_ID, TOKEN, {
      fetch,
      signal: controller.signal
    }),
    'aborted'
  )
  assert.equal(called, false)
})

test('una cancelación durante el registro del listener no se pierde', async () => {
  const racingSignal = {
    aborted: false,
    addEventListener() {
      this.aborted = true
    },
    removeEventListener() {}
  }
  const fetch = (url, init) =>
    new Promise((resolve, reject) => {
      if (init.signal.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
        return
      }
      init.signal.addEventListener(
        'abort',
        () => reject(new DOMException('The operation was aborted.', 'AbortError')),
        { once: true }
      )
    })

  await expectKubiosError(
    fetchKubiosTeamMembers(TEAM_ID, TOKEN, {
      fetch,
      signal: racingSignal
    }),
    'aborted'
  )
})

test('los identificadores se codifican sin alterar origen, ruta ni query', async () => {
  const identifiers = [
    '../../v1/user/self',
    '//evil.example.com',
    '@evil.example.com',
    'abc?members=no',
    'abc#fragment',
    'evil.example.com/x',
    'a/b',
    'a\\b',
    'a b',
    'a&b=c',
    'a%2Fb'
  ]

  for (const identifier of identifiers) {
    const { calls, fetch } = createFetchMock(() =>
      rawJsonResponse({ results: [] })
    )
    await fetchKubiosHrvResults(identifier, TOKEN, { fetch })

    const url = new URL(calls[0].url)
    assert.equal(url.origin, KUBIOS_API_ORIGIN)
    assert.equal(
      url.pathname,
      `/v1/result/${encodeURIComponent(identifier)}`
    )
    assert.equal(url.search, '')
    assert.equal(url.hash, '')
    assert.ok(!calls[0].url.includes(TOKEN))
  }

  const { calls, fetch } = createFetchMock(() =>
    rawJsonResponse({ members: [] })
  )
  await fetchKubiosTeamMembers('abc?members=no&extra=1', TOKEN, { fetch })
  const teamUrl = new URL(calls[0].url)
  assert.equal(teamUrl.origin, KUBIOS_API_ORIGIN)
  assert.equal(
    teamUrl.pathname,
    `/v2/team/team/${encodeURIComponent('abc?members=no&extra=1')}`
  )
  assert.equal(teamUrl.search, '?members=yes')
  assert.deepEqual(teamUrl.searchParams.getAll('members'), ['yes'])
  assert.equal(teamUrl.searchParams.get('extra'), null)
})

test('identificadores que intentan salir de la ruta se rechazan', async () => {
  const invalidIdentifiers = [
    '',
    '   ',
    ' con-espacio-inicial',
    'con-espacio-final ',
    '..',
    '.',
    'a\r\nb',
    'a\u0000b',
    'x'.repeat(257)
  ]

  for (const identifier of invalidIdentifiers) {
    let called = false
    const fetch = () => {
      called = true
      return rawJsonResponse({ results: [] })
    }

    await expectKubiosError(
      fetchKubiosHrvResults(identifier, TOKEN, { fetch }),
      'invalid_input'
    )
    assert.equal(called, false)
  }
})

test('entradas no válidas fallan antes de la red', async () => {
  let called = false
  const fetch = () => {
    called = true
    return rawJsonResponse({ members: [] })
  }

  for (const identifier of [undefined, null, 42, {}]) {
    await expectKubiosError(
      fetchKubiosTeamMembers(identifier, TOKEN, { fetch }),
      'invalid_input'
    )
  }

  for (const token of ['', '  ', ' token', 'token ', 'a\nb', 'x'.repeat(16_385)]) {
    await expectKubiosError(
      fetchKubiosTeamMembers(TEAM_ID, token, { fetch }),
      'invalid_input'
    )
  }

  for (const timeoutMs of [0, -1, Infinity, NaN, 120_001, '100']) {
    await expectKubiosError(
      fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch, timeoutMs }),
      'invalid_input'
    )
  }

  await expectKubiosError(
    fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch: 42 }),
    'invalid_input'
  )
  await expectKubiosError(
    fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch, signal: {} }),
    'invalid_input'
  )

  assert.equal(called, false)
})

test('otros estados HTTP y fallos de red usan códigos fijos', async () => {
  const mappings = [
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'http_error'],
    [503, 'http_error']
  ]

  for (const [status, code] of mappings) {
    const { fetch } = createFetchMock(() => statusResponse(status))
    const error = await expectKubiosError(
      fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch }),
      code
    )
    assert.equal(error.status, status)
  }

  const { fetch } = createFetchMock(() => {
    throw new TypeError('fallo de red sintético')
  })
  const error = await expectKubiosError(
    fetchKubiosTeamMembers(TEAM_ID, TOKEN, { fetch }),
    'network_error'
  )
  assert.ok(!error.message.includes('sintético'))
  assert.ok(!JSON.stringify(error).includes('sintético'))
})

test('el cliente es server-only y no registra ni persiste el token', async () => {
  const source = await readFile(
    join(HERE, '..', 'src', 'lib', 'kubios-api-client.ts'),
    'utf8'
  )

  assert.ok(source.startsWith('import "server-only"'))
  assert.equal(source.includes('console.'), false)
  assert.equal(source.includes('process.env'), false)
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(source), false)
  assert.ok(source.includes('encodeURIComponent'))
  assert.ok(source.includes(KUBIOS_API_ORIGIN))
})

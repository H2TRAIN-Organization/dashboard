/**
 * Pruebas sintéticas de la subtarea K15: POST /api/cron/kubios-sync.
 *
 * Todo es local y determinista: no hay red, Supabase, Kubios ni credenciales
 * reales. El sincronizador (`@/lib/kubios-sync`) se virtualiza y el secreto del
 * cron es ficticio.
 *
 * Ejecución (Node 24 hace type stripping del TypeScript):
 *
 *   node --conditions=react-server \
 *     --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --test tests/kubios-cron.k15.test.mjs
 *
 * El cargador inline (URL `data:`) solo resuelve `next/server` como lo hace
 * Next.js y sustituye el módulo del sincronizador por un doble controlado
 * mediante `globalThis`. No se crean archivos auxiliares ni se modifican los
 * imports de producción.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { after, describe, it } from 'node:test'

const RUN_KEY = Symbol.for('k15.cron.kubios-sync.run')

const VIRTUAL_SYNC_URL =
  'data:text/javascript,' +
  encodeURIComponent(`
// El módulo real exporta el default que la ruta importa dinámicamente como
// presupuesto; el doble debe exponerlo para reproducir ese contrato.
export const DEFAULT_KUBIOS_SYNC_BUDGET_MS = 26000

export async function runKubiosSync(options) {
  return globalThis[Symbol.for('k15.cron.kubios-sync.run')](options)
}
`)

const HOOK_SOURCE = `
const VIRTUAL_SYNC_URL = ${JSON.stringify(VIRTUAL_SYNC_URL)}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') {
    return nextResolve('next/server.js', context)
  }
  if (specifier === '@/lib/kubios-sync') {
    return { url: VIRTUAL_SYNC_URL, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
`

register('data:text/javascript,' + encodeURIComponent(HOOK_SOURCE))

const { NextRequest } = await import('next/server.js')
const routeModule = await import('../src/app/api/cron/kubios-sync/route.ts')
const { POST, runtime, maxDuration } = routeModule

/**
 * Exports que Next.js acepta en un `route.ts`. Replican el chequeo de tipos
 * del plugin de Next (`next-types-plugin`): metodos HTTP, configuracion de
 * segmento y `maxDuration`. Cualquier otro export hace fallar el build.
 */
const NEXT_ROUTE_EXPORTS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'config',
  'generateStaticParams',
  'revalidate',
  'dynamic',
  'dynamicParams',
  'fetchCache',
  'preferredRegion',
  'runtime',
  'maxDuration'
])

const EXPECTED_SYNC_BUDGET_MS = 26_000

const SECRET = 'synthetic-k15-cron-secret-0123456789'
const ENDPOINT = 'https://dashboard.invalid/api/cron/kubios-sync'
const AUTHORIZED_HEADERS = Object.freeze({ authorization: `Bearer ${SECRET}` })
const UNAVAILABLE_BODY = Object.freeze({ error: 'Error interno del servidor' })

const MEMBER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const EMAIL = 'sintetico.k15@example.invalid'
const TOKEN = 'synthetic-k15-token'
const INTERNAL_MESSAGE = 'detalle-interno-sintetico-k15'

const UNAUTHORIZED_BODY = Object.freeze({ error: 'No autorizado' })

/* ------------------------------------------------------------------------- *
 * Utilidades
 * ------------------------------------------------------------------------- */

function setEnvironmentSecret(secret) {
  if (secret === null) {
    delete process.env.KUBIOS_CRON_SECRET
    return
  }
  process.env.KUBIOS_CRON_SECRET = secret
}

/**
 * Ejecuta el POST con un doble del sincronizador y devuelve la respuesta real
 * de `NextResponse` junto con los registros de `console.error` de la petición.
 */
async function invokeRoute(options = {}) {
  const {
    headers = AUTHORIZED_HEADERS,
    secret = SECRET,
    fake = () => ({ status: 'ok', synced: 0, failed: 0 })
  } = options

  setEnvironmentSecret(secret)

  let calls = 0
  let syncOptions = null
  globalThis[RUN_KEY] = async (options) => {
    calls += 1
    syncOptions = options
    return fake(options)
  }

  const request = new NextRequest(ENDPOINT, { method: 'POST', headers })
  const logs = []
  const originalError = console.error
  console.error = (...args) => {
    logs.push(args.map((value) => String(value)).join(' '))
  }

  try {
    const response = await POST(request)
    const body = await response.json()

    return {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      retryAfter: response.headers.get('retry-after'),
      body,
      serializedBody: JSON.stringify(body),
      logs,
      calls,
      syncOptions
    }
  } finally {
    console.error = originalError
  }
}

function assertNoStore(result) {
  assert.equal(result.cacheControl, 'no-store', 'Cache-Control debe ser no-store')
}

function assertNoRetryAfter(result) {
  assert.equal(result.retryAfter, null, 'la respuesta no debe llevar Retry-After')
}

function assertNoForbidden(result, forbidden) {
  for (const marker of forbidden) {
    assert.ok(
      !result.serializedBody.includes(marker),
      `el cuerpo no debe incluir el dato interno ${marker}`
    )
    for (const line of result.logs) {
      assert.ok(!line.includes(marker), `el registro no debe incluir el dato interno ${marker}`)
    }
  }
}

function assertGenericUnavailable(result, forbidden = []) {
  assert.equal(result.status, 503)
  assert.deepEqual(result.body, UNAVAILABLE_BODY)
  assertNoStore(result)
  assertNoRetryAfter(result)
  assert.equal('status' in result.body, false)
  assertNoForbidden(result, forbidden)
}

/** Añade datos internos solo cuando el resultado simulado es un objeto plano. */
function withInternalMarkers(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  return { ...value, memberId: MEMBER_ID, error: INTERNAL_MESSAGE }
}

async function assertUnauthorized(options) {
  const result = await invokeRoute({
    ...options,
    fake: () => {
      throw new Error('el sincronizador no debe ejecutarse sin autorización')
    }
  })

  assert.equal(result.status, 401)
  assert.deepEqual(result.body, UNAUTHORIZED_BODY)
  assert.equal(result.calls, 0, 'runKubiosSync no debe invocarse')
  assertNoStore(result)
  assertNoRetryAfter(result)

  return result
}

/* ------------------------------------------------------------------------- *
 * 1. Superficie del módulo
 * ------------------------------------------------------------------------- */

describe('superficie del módulo', () => {
  it("mantiene runtime = 'nodejs'", () => {
    assert.equal(runtime, 'nodejs')
  })

  it('declara maxDuration conservador (60 s) compatible con Hobby sin fluid', () => {
    assert.equal(maxDuration, 60)
  })

  it('solo exporta campos permitidos por Next (sin constantes arbitrarias)', () => {
    const exported = Object.keys(routeModule)
    const forbidden = exported.filter((name) => !NEXT_ROUTE_EXPORTS.has(name))

    assert.deepEqual(forbidden, [], `exports no permitidos por Next: ${forbidden.join(', ')}`)
    assert.ok(
      !exported.includes('KUBIOS_SYNC_BUDGET_MS'),
      'el presupuesto no debe exportarse desde el route handler'
    )
    assert.ok(exported.includes('POST'))
    assert.ok(exported.includes('runtime'))
    assert.ok(exported.includes('maxDuration'))
  })

  it('el presupuesto interno deja margen frente a pg_net y maxDuration', () => {
    assert.equal(EXPECTED_SYNC_BUDGET_MS, 26_000)
    assert.ok(EXPECTED_SYNC_BUDGET_MS > 0)
    assert.ok(
      EXPECTED_SYNC_BUDGET_MS < 30_000,
      'el presupuesto debe terminar antes del timeout de pg_net (30 s)'
    )
    assert.ok(
      EXPECTED_SYNC_BUDGET_MS < maxDuration * 1_000,
      'el presupuesto debe caber en maxDuration'
    )
  })

  it('pasa el presupuesto interno 26_000 al sincronizador', async () => {
    const result = await invokeRoute({
      fake: () => ({ status: 'ok', synced: 0, failed: 0 })
    })

    assert.equal(result.status, 200)
    assert.deepEqual(result.syncOptions, { budgetMs: EXPECTED_SYNC_BUDGET_MS })

    const budgetMs = result.syncOptions.budgetMs
    assert.ok(budgetMs > 0)
    assert.ok(budgetMs < 30_000, 'el presupuesto inyectado debe terminar antes de pg_net (30 s)')
    assert.ok(budgetMs < maxDuration * 1_000, 'el presupuesto inyectado debe caber en maxDuration')
  })
})

/* ------------------------------------------------------------------------- *
 * 2. Autorización
 * ------------------------------------------------------------------------- */

describe('autorización Bearer', () => {
  it('secreto de entorno ausente: 401 sin invocar el sincronizador', async () => {
    await assertUnauthorized({ secret: null })
  })

  it('cabecera Authorization ausente: 401 sin invocar el sincronizador', async () => {
    await assertUnauthorized({ headers: {} })
  })

  it('esquema distinto de Bearer: 401 sin invocar el sincronizador', async () => {
    const headers = [
      { authorization: `Basic ${SECRET}` },
      { authorization: `Token ${SECRET}` },
      { authorization: `bearer ${SECRET}` },
      { authorization: 'Bearer' },
      { authorization: 'Bearer ' }
    ]

    for (const entries of headers) {
      await assertUnauthorized({ headers: entries })
    }
  })

  it('secreto incorrecto de igual y distinta longitud: 401 sin invocar el sincronizador', async () => {
    const sameLength = `${SECRET.slice(0, -1)}${SECRET.endsWith('9') ? '8' : '9'}`
    assert.equal(sameLength.length, SECRET.length)
    assert.notEqual(sameLength, SECRET)

    const headers = [
      { authorization: `Bearer ${sameLength}` },
      { authorization: `Bearer ${SECRET}x` },
      { authorization: `Bearer ${SECRET.slice(0, -1)}` },
      { authorization: `Bearer ${SECRET.toUpperCase()}` }
    ]

    for (const entries of headers) {
      await assertUnauthorized({ headers: entries })
    }
  })
})

/* ------------------------------------------------------------------------- *
 * 3. Respuestas legítimas
 * ------------------------------------------------------------------------- */

describe('resultados legítimos', () => {
  it('ok: 200 con solo status/synced/failed y descarte de campos internos', async () => {
    const result = await invokeRoute({
      fake: () => ({
        status: 'ok',
        synced: 2,
        failed: 0,
        retryAfterSeconds: 45,
        memberId: MEMBER_ID,
        email: EMAIL,
        token: TOKEN,
        error: INTERNAL_MESSAGE
      })
    })

    assert.equal(result.status, 200)
    assert.deepEqual(result.body, { status: 'ok', synced: 2, failed: 0 })
    assert.equal(result.calls, 1)
    assertNoStore(result)
    assertNoRetryAfter(result)
    assertNoForbidden(result, [MEMBER_ID, EMAIL, TOKEN, INTERNAL_MESSAGE])
  })

  it('ok con failed > 0 es incoherente: 503 genérico sin Retry-After ni resultado crudo', async () => {
    // Previene publicar un 200 que afirme éxito cuando el sincronizador ya
    // contó fallos pendientes.
    const result = await invokeRoute({
      fake: () => ({
        status: 'ok',
        synced: 2,
        failed: 1,
        memberId: MEMBER_ID,
        error: INTERNAL_MESSAGE
      })
    })

    assertGenericUnavailable(result, [MEMBER_ID, INTERNAL_MESSAGE])
    assert.equal(result.calls, 1)
  })

  it('locked: 202 con solo status/synced/failed, sin Retry-After', async () => {
    const result = await invokeRoute({
      fake: () => ({
        status: 'locked',
        synced: 0,
        failed: 0,
        retryAfterSeconds: 9,
        memberId: MEMBER_ID,
        email: EMAIL
      })
    })

    assert.equal(result.status, 202)
    assert.deepEqual(result.body, { status: 'locked', synced: 0, failed: 0 })
    assert.equal(result.calls, 1)
    assertNoStore(result)
    assertNoRetryAfter(result)
    assertNoForbidden(result, [MEMBER_ID, EMAIL])
  })

  it('partial: 503 con el resultado público exacto y sin datos sensibles', async () => {
    const result = await invokeRoute({
      fake: () => ({
        status: 'partial',
        synced: 1,
        failed: 2,
        retryAfterSeconds: 9,
        memberId: MEMBER_ID,
        email: EMAIL,
        token: TOKEN,
        error: INTERNAL_MESSAGE,
        message: INTERNAL_MESSAGE
      })
    })

    assert.equal(result.status, 503)
    assert.deepEqual(result.body, { status: 'partial', synced: 1, failed: 2 })
    assert.equal(result.calls, 1)
    assertNoStore(result)
    assertNoRetryAfter(result)
    assertNoForbidden(result, [MEMBER_ID, EMAIL, TOKEN, INTERNAL_MESSAGE])
  })

  it('throttled válido: 429 con Retry-After decimal exacto para 0, 120 y el máximo seguro', async () => {
    // El máximo seguro publicable es el `integer` de PostgreSQL (2147483647);
    // el máximo entero de JavaScript ya no se acepta (véase el caso rechazado).
    const cases = [
      ['cero', 0],
      ['normal', 120],
      ['más de un día', 86_401],
      ['máximo int4 de K38', 2_147_483_647]
    ]

    for (const [label, retryAfterSeconds] of cases) {
      const result = await invokeRoute({
        fake: () => ({
          status: 'throttled',
          synced: 0,
          failed: 1,
          retryAfterSeconds,
          memberId: MEMBER_ID
        })
      })

      assert.equal(result.status, 429, `throttled ${label} debe responder 429`)
      assert.equal(
        result.retryAfter,
        String(retryAfterSeconds),
        `Retry-After exacto para ${label}`
      )
      assert.equal(result.retryAfter, String(Number.parseInt(result.retryAfter, 10)))
      assert.deepEqual(result.body, { status: 'throttled', synced: 0, failed: 1 })
      assert.equal(result.calls, 1)
      assertNoStore(result)
      assertNoForbidden(result, [MEMBER_ID])
    }
  })
})

/* ------------------------------------------------------------------------- *
 * 4. Pausa indefinida K38 y resultado parcial
 * ------------------------------------------------------------------------- */

describe('pausa indefinida K38', () => {
  it('throttled con retryIndefinite: 429 sin Retry-After', async () => {
    const result = await invokeRoute({
      fake: () => ({
        status: 'throttled',
        synced: 2,
        failed: 1,
        retryIndefinite: true,
        memberId: MEMBER_ID,
        error: INTERNAL_MESSAGE
      })
    })

    assert.equal(result.status, 429)
    assert.equal(result.retryAfter, null, 'una pausa sin plazo no debe llevar Retry-After')
    assert.deepEqual(result.body, { status: 'throttled', synced: 2, failed: 1 })
    assertNoStore(result)
    assertNoForbidden(result, [MEMBER_ID, INTERNAL_MESSAGE])
  })

  it('overflow de Retry-After representado como pausa indefinida: 429 sin Retry-After', async () => {
    // Previene degradar el overflow a una pausa finita de 60 s o publicar una
    // cabecera que no corresponde a la pausa persistida `infinity`.
    const result = await invokeRoute({
      fake: () => ({
        status: 'throttled',
        synced: 0,
        failed: 1,
        retryIndefinite: true
      })
    })

    assert.equal(result.status, 429)
    assertNoRetryAfter(result)
    assert.deepEqual(result.body, { status: 'throttled', synced: 0, failed: 1 })
    assertNoStore(result)
  })

  it('retryIndefinite con retryAfterSeconds es ambiguo: 503 genérico', async () => {
    const result = await invokeRoute({
      fake: () => ({
        status: 'throttled',
        synced: 0,
        failed: 1,
        retryIndefinite: true,
        retryAfterSeconds: 60
      })
    })

    assertGenericUnavailable(result)
  })

  it('retryIndefinite no booleano no habilita la pausa indefinida', async () => {
    const result = await invokeRoute({
      fake: () => ({
        status: 'throttled',
        synced: 0,
        failed: 1,
        retryIndefinite: 'true'
      })
    })

    assertGenericUnavailable(result)
  })

  it('retryIndefinite false exige una pausa finita válida', async () => {
    const result = await invokeRoute({
      fake: () => ({
        status: 'throttled',
        synced: 0,
        failed: 1,
        retryIndefinite: false
      })
    })

    assertGenericUnavailable(result)
  })
})

describe('resultado parcial', () => {
  it('partial con conteos reales: 503, nunca 504 de plataforma', async () => {
    const result = await invokeRoute({
      fake: () => ({ status: 'partial', synced: 3, failed: 4 })
    })

    assert.equal(result.status, 503)
    assert.notEqual(result.status, 504)
    assert.deepEqual(result.body, { status: 'partial', synced: 3, failed: 4 })
    assertNoRetryAfter(result)
    assertNoStore(result)
  })

  it('fallo de finish representado como partial: 503 sin fingir ok/throttled', async () => {
    const result = await invokeRoute({
      fake: () => ({ status: 'partial', synced: 0, failed: 1, retryAfterSeconds: 30 })
    })

    assert.equal(result.status, 503)
    assert.deepEqual(result.body, { status: 'partial', synced: 0, failed: 1 })
    assertNoRetryAfter(result)
  })

  it('partial con failed 0 es incoherente: 503 genérico sin cuerpo partial ni Retry-After', async () => {
    // F2: una pasada partial siempre cuenta al menos un fallo; publicar el
    // cuerpo partial con failed 0 daría una lectura contradictoria.
    const result = await invokeRoute({
      fake: () => ({
        status: 'partial',
        synced: 0,
        failed: 0,
        retryAfterSeconds: 30,
        memberId: MEMBER_ID,
        email: EMAIL,
        token: TOKEN,
        error: INTERNAL_MESSAGE
      })
    })

    assertGenericUnavailable(result, [MEMBER_ID, EMAIL, TOKEN, INTERNAL_MESSAGE])
    assert.equal(result.calls, 1)
  })

  it('partial con synced > 0 y failed 0 también es incoherente: 503 genérico', async () => {
    const result = await invokeRoute({
      fake: () => ({
        status: 'partial',
        synced: 2,
        failed: 0,
        memberId: MEMBER_ID,
        error: INTERNAL_MESSAGE
      })
    })

    assertGenericUnavailable(result, [MEMBER_ID, INTERNAL_MESSAGE])
    assert.equal(result.calls, 1)
  })
})

/* ------------------------------------------------------------------------- *
 * 5. Resultado no válido y errores
 * ------------------------------------------------------------------------- */

describe('throttled sin pausa válida', () => {
  const invalidCases = [
    ['ausente', {}],
    ['null', { retryAfterSeconds: null }],
    ['negativo', { retryAfterSeconds: -1 }],
    ['negativo grande', { retryAfterSeconds: -Number.MAX_SAFE_INTEGER }],
    ['fraccionario', { retryAfterSeconds: 1.5 }],
    ['string', { retryAfterSeconds: '3' }],
    ['NaN', { retryAfterSeconds: Number.NaN }],
    ['Infinity', { retryAfterSeconds: Number.POSITIVE_INFINITY }],
    ['-Infinity', { retryAfterSeconds: Number.NEGATIVE_INFINITY }],
    ['fuera del entero seguro', { retryAfterSeconds: Number.MAX_SAFE_INTEGER + 1 }],
    ['objeto número', { retryAfterSeconds: new Number(3) }],
    // Un retry finito por encima del máximo `integer` de PostgreSQL no pudo
    // persistirse nunca: publicarlo como 429 prometería una pausa falsa.
    ['un segundo por encima del máximo int4', { retryAfterSeconds: 2_147_483_648 }],
    ['máximo entero seguro', { retryAfterSeconds: Number.MAX_SAFE_INTEGER }]
  ]

  for (const [label, extra] of invalidCases) {
    it(`${label}: 503 genérico sin Retry-After`, async () => {
      const result = await invokeRoute({
        fake: () => ({
          status: 'throttled',
          synced: 0,
          failed: 1,
          ...extra,
          memberId: MEMBER_ID,
          error: INTERNAL_MESSAGE
        })
      })

      assertGenericUnavailable(result, [MEMBER_ID, INTERNAL_MESSAGE])
    })
  }
})

describe('resultado global no válido', () => {
  const invalidResults = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'ok'],
    ['número', 1],
    ['booleano', true],
    ['array', []],
    ['status desconocido', { status: 'unknown', synced: 0, failed: 0 }],
    ['status null', { status: null, synced: 0, failed: 0 }],
    ['status en mayúsculas', { status: 'OK', synced: 0, failed: 0 }],
    ['status numérico', { status: 200, synced: 0, failed: 0 }],
    ['synced ausente', { status: 'ok', failed: 0 }],
    ['failed ausente', { status: 'ok', synced: 0 }],
    ['synced null', { status: 'ok', synced: null, failed: 0 }],
    ['failed null', { status: 'ok', synced: 0, failed: null }],
    ['synced string', { status: 'ok', synced: '2', failed: 0 }],
    ['failed string', { status: 'ok', synced: 0, failed: '1' }],
    ['synced negativo', { status: 'ok', synced: -1, failed: 0 }],
    ['failed negativo', { status: 'ok', synced: 0, failed: -2 }],
    ['synced fraccionario', { status: 'ok', synced: 1.5, failed: 0 }],
    ['failed fraccionario', { status: 'ok', synced: 0, failed: 0.5 }],
    ['synced NaN', { status: 'ok', synced: Number.NaN, failed: 0 }],
    ['failed Infinity', { status: 'ok', synced: 0, failed: Number.POSITIVE_INFINITY }],
    ['synced fuera del entero seguro', { status: 'ok', synced: Number.MAX_SAFE_INTEGER + 1, failed: 0 }],
    ['failed fuera del entero seguro', { status: 'ok', synced: 0, failed: Number.MAX_SAFE_INTEGER + 1 }]
  ]

  for (const [label, raw] of invalidResults) {
    it(`${label}: 503 genérico sin Retry-After`, async () => {
      const result = await invokeRoute({
        fake: () => withInternalMarkers(raw)
      })

      assertGenericUnavailable(result, [MEMBER_ID, INTERNAL_MESSAGE])
    })
  }
})

describe('excepción del sincronizador', () => {
  it('fallo síncrono: 503 genérico sin filtrar el mensaje interno', async () => {
    const result = await invokeRoute({
      fake: () => {
        throw new Error(INTERNAL_MESSAGE)
      }
    })

    assertGenericUnavailable(result, [INTERNAL_MESSAGE])
  })

  it('promesa rechazada: 503 genérico sin filtrar el mensaje interno', async () => {
    const result = await invokeRoute({
      fake: () => Promise.reject(new Error(INTERNAL_MESSAGE))
    })

    assertGenericUnavailable(result, [INTERNAL_MESSAGE])
  })
})

/* ------------------------------------------------------------------------- *
 * 5. Cabeceras transversales
 * ------------------------------------------------------------------------- */

describe('Cache-Control', () => {
  const scenarios = [
    [
      '200 ok',
      200,
      () => ({ status: 'ok', synced: 1, failed: 0 }),
      AUTHORIZED_HEADERS
    ],
    [
      '202 locked',
      202,
      () => ({ status: 'locked', synced: 0, failed: 0 }),
      AUTHORIZED_HEADERS
    ],
    [
      '401',
      401,
      () => ({ status: 'ok', synced: 0, failed: 0 }),
      { authorization: `Bearer ${SECRET}x` }
    ],
    [
      '429 throttled',
      429,
      () => ({ status: 'throttled', synced: 0, failed: 1, retryAfterSeconds: 30 }),
      AUTHORIZED_HEADERS
    ],
    [
      '503 resultado inválido',
      503,
      () => ({ status: 'partial', synced: -1, failed: 0 }),
      AUTHORIZED_HEADERS
    ]
  ]

  for (const [label, expectedStatus, fake, headers] of scenarios) {
    it(`${label}: no-store en la respuesta ${expectedStatus}`, async () => {
      const result = await invokeRoute({ fake, headers })

      assert.equal(result.status, expectedStatus)
      assertNoStore(result)
    })
  }

  it('el 503 por resultado inválido no expone el resultado crudo', async () => {
    const raw = {
      status: 'ok',
      synced: MEMBER_ID,
      failed: 0,
      memberId: MEMBER_ID,
      email: EMAIL,
      token: TOKEN,
      error: INTERNAL_MESSAGE
    }

    const result = await invokeRoute({ fake: () => raw })

    assertGenericUnavailable(result, [MEMBER_ID, EMAIL, TOKEN, INTERNAL_MESSAGE])
    assert.ok(!result.serializedBody.includes(JSON.stringify(raw)))
  })
})

after(() => {
  delete process.env.KUBIOS_CRON_SECRET
  delete globalThis[RUN_KEY]
})

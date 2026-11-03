/**
 * Pruebas deterministas de K02/K31: parseo de `user.teams[]`, selección
 * explícita del equipo y cliente de `GET /v1/user/self`.
 *
 * No hay red real, secretos ni `.env`: todas las respuestas y tokens son
 * sintéticos y `fetch` se inyecta. Ejecutar desde la raíz del repositorio:
 *
 *   node --conditions=react-server \
 *     --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --test tests/kubios-team.k02-k31.test.mjs
 */
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { describe, it } from 'node:test'

import {
  KUBIOS_TARGET_TEAM_NAME,
  parseKubiosUserTeams,
  resolveKubiosTeamFromUserInfo,
  selectKubiosTeam
} from '../src/lib/kubios-team.ts'

// El cliente importa `./kubios-team` sin extensión, como el resto del código
// Next.js. El loader solo resuelve especificadores relativos en estas pruebas.
register(new URL('./kubios-sync.k14.loader.mjs', import.meta.url))

const overviewModule = await import('../src/lib/kubios-team-overview.ts')

const {
  KUBIOS_USER_SELF_URL,
  fetchKubiosTeamOverview,
  resolveKubiosTeam
} = overviewModule

const TOKEN = 'synthetic.k02-k31.token'
const TEAM_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222'
const THIRD_TEAM_ID = '33333333-3333-4333-8333-333333333333'

const TARGET_TEAM = Object.freeze({
  team_id: TEAM_ID,
  name: KUBIOS_TARGET_TEAM_NAME
})
const OTHER_TEAM = Object.freeze({
  team_id: OTHER_TEAM_ID,
  name: 'Otro equipo'
})

function selfBody(teams) {
  return { user: { teams } }
}

function jsonResponse(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] ?? null
      }
    },
    json: async () => payload
  }
}

function recordingFetch(response, calls = []) {
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return response
    }
  }
}

describe('parseKubiosUserTeams', () => {
  it('extrae user.teams[] en orden y recorta el nombre', () => {
    const body = selfBody([
      { ...OTHER_TEAM },
      { team_id: TEAM_ID, name: `  ${KUBIOS_TARGET_TEAM_NAME}  ` }
    ])

    assert.deepEqual(parseKubiosUserTeams(body), {
      ok: true,
      teams: [
        { teamId: OTHER_TEAM_ID, name: 'Otro equipo' },
        { teamId: TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME }
      ]
    })
  })

  it('acepta una lista vacía como respuesta válida', () => {
    assert.deepEqual(parseKubiosUserTeams(selfBody([])), {
      ok: true,
      teams: []
    })
  })

  it('falla cerrado ante cualquier entrada mal formada', () => {
    const invalidBodies = [
      null,
      undefined,
      [],
      'texto',
      {},
      { user: null },
      { user: {} },
      { user: { teams: {} } },
      { user: { teams: [null] } },
      { user: { teams: [[]] } },
      { user: { teams: [{ name: 'sin id' }] } },
      { user: { teams: [{ team_id: '', name: 'vacío' }] } },
      { user: { teams: [{ team_id: '  id  ', name: 'espacios' }] } },
      { user: { teams: [{ team_id: TEAM_ID }] } },
      { user: { teams: [{ team_id: TEAM_ID, name: '   ' }] } },
      { user: { teams: [{ team_id: TEAM_ID, name: 7 }] } },
      { user: { teams: [{ team_id: TEAM_ID, name: 'x\u0000y' }] } }
    ]

    for (const body of invalidBodies) {
      assert.deepEqual(
        parseKubiosUserTeams(body),
        { ok: false, reason: 'invalid_response_shape' },
        `cuerpo inesperadamente válido: ${JSON.stringify(body)}`
      )
    }
  })
})

describe('selectKubiosTeam', () => {
  it('selecciona el equipo objetivo aunque no sea el primero', () => {
    const teams = [
      { teamId: OTHER_TEAM_ID, name: 'Otro equipo' },
      { teamId: TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME },
      { teamId: THIRD_TEAM_ID, name: 'Tercero' }
    ]

    assert.deepEqual(selectKubiosTeam(teams), {
      ok: true,
      team: { teamId: TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME }
    })
  })

  it('falla cerrado si el equipo objetivo no existe; no usa el primero', () => {
    assert.deepEqual(selectKubiosTeam([{ teamId: OTHER_TEAM_ID, name: 'Otro' }]), {
      ok: false,
      reason: 'team_not_found'
    })

    assert.deepEqual(selectKubiosTeam([]), {
      ok: false,
      reason: 'team_not_found'
    })
  })

  it('no confunde nombres parecidos con el objetivo', () => {
    const teams = [
      { teamId: OTHER_TEAM_ID, name: `${KUBIOS_TARGET_TEAM_NAME} (antiguo)` },
      { teamId: THIRD_TEAM_ID, name: 'Diabetes Tracker' }
    ]

    assert.deepEqual(selectKubiosTeam(teams), {
      ok: false,
      reason: 'team_not_found'
    })
  })

  it('normaliza extremos, espacios internos y mayúsculas al comparar', () => {
    const teams = [
      {
        teamId: TEAM_ID,
        name: '  diabetes   tracker - h2train  '
      }
    ]

    assert.deepEqual(selectKubiosTeam(teams), {
      ok: true,
      team: { teamId: TEAM_ID, name: '  diabetes   tracker - h2train  ' }
    })
  })

  it('falla por ambigüedad si hay dos equipos con el mismo nombre e ids distintos', () => {
    const teams = [
      { teamId: TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME },
      { teamId: OTHER_TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME }
    ]

    assert.deepEqual(selectKubiosTeam(teams), {
      ok: false,
      reason: 'team_ambiguous'
    })
  })

  it('acepta duplicados idénticos del mismo equipo', () => {
    const teams = [
      { teamId: TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME },
      { teamId: TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME }
    ]

    assert.deepEqual(selectKubiosTeam(teams), {
      ok: true,
      team: { teamId: TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME }
    })
  })

  it('rechaza un nombre objetivo vacío o caracteres de control', () => {
    for (const target of ['', '   ', 'x\u0000y']) {
      assert.deepEqual(selectKubiosTeam([], target), {
        ok: false,
        reason: 'invalid_target'
      })
    }
  })

  it('rechaza una lista con entradas inválidas', () => {
    assert.deepEqual(selectKubiosTeam([{ teamId: '', name: 'x' }]), {
      ok: false,
      reason: 'invalid_teams'
    })

    assert.deepEqual(selectKubiosTeam('no-es-array'), {
      ok: false,
      reason: 'invalid_teams'
    })
  })

  it('permite un nombre objetivo alternativo explícito', () => {
    assert.deepEqual(
      selectKubiosTeam(
        [{ teamId: OTHER_TEAM_ID, name: 'Equipo de pruebas' }],
        'Equipo de pruebas'
      ),
      {
        ok: true,
        team: { teamId: OTHER_TEAM_ID, name: 'Equipo de pruebas' }
      }
    )
  })
})

describe('resolveKubiosTeamFromUserInfo', () => {
  it('combina parseo y selección sin red', () => {
    assert.deepEqual(
      resolveKubiosTeamFromUserInfo(selfBody([OTHER_TEAM, TARGET_TEAM])),
      {
        ok: true,
        team: { teamId: TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME }
      }
    )
  })

  it('propaga la forma inválida y la ausencia del equipo', () => {
    assert.deepEqual(resolveKubiosTeamFromUserInfo({ user: {} }), {
      ok: false,
      reason: 'invalid_response_shape'
    })

    assert.deepEqual(resolveKubiosTeamFromUserInfo(selfBody([OTHER_TEAM])), {
      ok: false,
      reason: 'team_not_found'
    })
  })
})

describe('cliente GET /v1/user/self', () => {
  it('usa teamIdOverride sin hacer red', async () => {
    let called = false
    const result = await resolveKubiosTeam(TOKEN, {
      teamIdOverride: TEAM_ID,
      fetch: async () => {
        called = true
        throw new Error('no debe llamarse')
      }
    })

    assert.equal(called, false)
    assert.deepEqual(result, {
      ok: true,
      teamId: TEAM_ID,
      teamName: null,
      source: 'override'
    })
  })

  it('rechaza un override vacío antes de hacer red', async () => {
    for (const override of ['', '   ', `x\u0000y`]) {
      let called = false
      const result = await resolveKubiosTeam(TOKEN, {
        teamIdOverride: override,
        fetch: async () => {
          called = true
          return jsonResponse(selfBody([TARGET_TEAM]))
        }
      })

      assert.equal(called, false)
      assert.equal(result.ok, false)
      assert.equal(result.code, 'invalid_input')
    }
  })

  it('consulta la URL fija y envía el token solo en Authorization', async () => {
    const recorder = recordingFetch(jsonResponse(selfBody([OTHER_TEAM, TARGET_TEAM])))
    const result = await resolveKubiosTeam(TOKEN, { fetch: recorder.fetch })

    assert.deepEqual(result, {
      ok: true,
      teamId: TEAM_ID,
      teamName: KUBIOS_TARGET_TEAM_NAME,
      source: 'overview'
    })

    assert.equal(recorder.calls.length, 1)
    assert.equal(recorder.calls[0].url, KUBIOS_USER_SELF_URL)
    assert.equal(recorder.calls[0].url.includes(TOKEN), false)
    assert.deepEqual(recorder.calls[0].init, {
      method: 'GET',
      headers: {
        Authorization: TOKEN,
        Accept: 'application/json',
        'User-Agent': 'DiabetesTracker 1.0'
      },
      signal: recorder.calls[0].init.signal,
      redirect: 'error',
      cache: 'no-store'
    })
  })

  it('devuelve la lista validada desde fetchKubiosTeamOverview', async () => {
    const recorder = recordingFetch(jsonResponse(selfBody([TARGET_TEAM])))
    const result = await fetchKubiosTeamOverview(TOKEN, { fetch: recorder.fetch })

    assert.deepEqual(result, {
      ok: true,
      teams: [{ teamId: TEAM_ID, name: KUBIOS_TARGET_TEAM_NAME }]
    })
  })

  it('falla cerrado si la respuesta no contiene el equipo objetivo', async () => {
    const recorder = recordingFetch(jsonResponse(selfBody([OTHER_TEAM])))
    const result = await resolveKubiosTeam(TOKEN, { fetch: recorder.fetch })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'team_not_found')
    assert.equal(result.status, 200)
  })

  it('falla cerrado ante una respuesta con forma inválida', async () => {
    const recorder = recordingFetch(jsonResponse({ user: { teams: [{}] } }))
    const result = await resolveKubiosTeam(TOKEN, { fetch: recorder.fetch })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid_response_shape')
    assert.equal(result.status, 200)
  })

  it('mapea estados HTTP sin exponer el cuerpo', async () => {
    const cases = [
      [401, 'unauthorized', 401],
      [403, 'forbidden', 403],
      [404, 'not_found', 404],
      [500, 'http_error', 500]
    ]

    for (const [status, code, expectedStatus] of cases) {
      const recorder = recordingFetch(jsonResponse({ secret: 'no-leer' }, status))
      const result = await resolveKubiosTeam(TOKEN, { fetch: recorder.fetch })

      assert.equal(result.ok, false)
      assert.equal(result.code, code)
      assert.equal(result.status, expectedStatus)
      assert.equal(JSON.stringify(result).includes('no-leer'), false)
    }
  })

  it('expone Retry-After en 429', async () => {
    const recorder = recordingFetch(
      jsonResponse({}, 429, { 'retry-after': '2' })
    )
    const result = await resolveKubiosTeam(TOKEN, { fetch: recorder.fetch })

    assert.deepEqual(result, {
      ok: false,
      code: 'rate_limited',
      status: 429,
      retryAfterMs: 2000
    })
  })

  it('mapea JSON inválido, error de red y timeout', async () => {
    const invalidJson = await resolveKubiosTeam(TOKEN, {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => {
          throw new SyntaxError('json roto')
        }
      })
    })
    assert.equal(invalidJson.ok, false)
    assert.equal(invalidJson.code, 'invalid_json')

    const networkError = await resolveKubiosTeam(TOKEN, {
      fetch: async () => {
        throw new TypeError('sin red')
      }
    })
    assert.equal(networkError.ok, false)
    assert.equal(networkError.code, 'network_error')

    const timedOut = await resolveKubiosTeam(TOKEN, {
      timeoutMs: 5,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('abortado')), {
            once: true
          })
        })
    })
    assert.equal(timedOut.ok, false)
    assert.equal(timedOut.code, 'timeout')
  })

  it('respeta una señal ya abortada sin llamar a fetch', async () => {
    const controller = new AbortController()
    controller.abort()

    let called = false
    const result = await resolveKubiosTeam(TOKEN, {
      signal: controller.signal,
      fetch: async () => {
        called = true
        return jsonResponse(selfBody([TARGET_TEAM]))
      }
    })

    assert.equal(called, false)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'aborted')
  })

  it('rechaza token y timeout inválidos antes de hacer red', async () => {
    const invalidToken = await resolveKubiosTeam('   ', {
      fetch: async () => jsonResponse(selfBody([TARGET_TEAM]))
    })
    assert.equal(invalidToken.ok, false)
    assert.equal(invalidToken.code, 'invalid_input')

    const invalidTimeout = await resolveKubiosTeam(TOKEN, {
      timeoutMs: 0,
      fetch: async () => jsonResponse(selfBody([TARGET_TEAM]))
    })
    assert.equal(invalidTimeout.ok, false)
    assert.equal(invalidTimeout.code, 'invalid_input')
  })

  it('permite un nombre objetivo alternativo explícito', async () => {
    const recorder = recordingFetch(
      jsonResponse(selfBody([{ team_id: OTHER_TEAM_ID, name: 'Equipo de pruebas' }]))
    )
    const result = await resolveKubiosTeam(TOKEN, {
      targetTeamName: 'Equipo de pruebas',
      fetch: recorder.fetch
    })

    assert.deepEqual(result, {
      ok: true,
      teamId: OTHER_TEAM_ID,
      teamName: 'Equipo de pruebas',
      source: 'overview'
    })
  })
})

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ServerApplication } from '@/server/composition/container'
import { registerServerRuntime } from '@/server/composition/runtime'
import { UnauthorizedError } from '@/server/domain/errors'
import { KUBIOS_ENCRYPTION_KEY_ENV, encryptKubiosSnapshot } from '@/lib/kubios-crypto'
import { GET as getMe } from '@/app/api/kubios/me/route'
import { GET as getHrvResults } from '@/app/api/kubios/hrv-results/route'

vi.mock('server-only', () => ({}))

const TEAM_A = '11111111-1111-4111-8111-111111111111'
const MEMBER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MEMBER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER_A = 42
const USER_B = 43
const KEY_B64 = Buffer.alloc(32, 0x5a).toString('base64')

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

function bytea(buffer: Buffer): string {
  return `\\x${buffer.toString('hex')}`
}

function snapshotRow(memberId = MEMBER_A, resultId = 'synthetic-route-result') {
  const result = {
    result_id: resultId,
    measured_timestamp: '2026-11-03T11:30:00.000Z',
    result: { readiness: 80, freq_domain: { HF_power: 1.5 } }
  }
  const payload = encryptKubiosSnapshot(
    JSON.stringify({ results: [result] }),
    { teamId: TEAM_A, memberId },
    { env: { [KUBIOS_ENCRYPTION_KEY_ENV]: KEY_B64 } }
  )
  const envelope = Buffer.from(payload, 'base64')
  return {
    ciphertext: bytea(envelope.subarray(29)),
    nonce: bytea(envelope.subarray(1, 13)),
    tag: bytea(envelope.subarray(13, 29)),
    key_version: 1,
    updated_at: new Date(Date.now() - 60_000).toISOString()
  }
}

const LINK_ROW = {
  user_id: USER_A,
  team_id: TEAM_A,
  kubios_member_id: MEMBER_A
}

const getSession = vi.fn(async () => ({ user: { id: String(USER_A), role: 'admin' } }))
const fetchMock = vi.fn()
const rpcCalls: { name: string; body: Record<string, unknown> }[] = []

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function installRuntime(): void {
  registerServerRuntime(
    async () =>
      ({
        useCases: { auth: { getSession } }
      }) as unknown as ServerApplication
  )
}

function cookieRequest(path: string): NextRequest {
  return new NextRequest(`https://dashboard.invalid${path}`, {
    headers: { cookie: 'dashboard_session=synthetic-valid-session' }
  })
}

beforeEach(() => {
  rpcCalls.length = 0
  getSession.mockReset()
  getSession.mockResolvedValue({ user: { id: String(USER_A), role: 'admin' } })

  vi.stubEnv('SUPABASE_URL', 'https://synthetic.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', jwt({ role: 'service_role', ref: 'synthetic' }))
  vi.stubEnv(KUBIOS_ENCRYPTION_KEY_ENV, KEY_B64)

  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const match = /\/rest\/v1\/rpc\/([^?]+)/.exec(url)
    if (match === null) {
      return new Response('unexpected fetch', { status: 404 })
    }

    const name = match[1] ?? ''
    const rawBody = typeof init?.body === 'string' ? init.body : '{}'
    const body = JSON.parse(rawBody) as Record<string, unknown>
    rpcCalls.push({ name, body })

    if (name === 'kubios_get_user_member_link') return jsonResponse([LINK_ROW])
    if (name === 'kubios_get_snapshot') return jsonResponse([snapshotRow()])
    return new Response('unexpected rpc', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)

  installRuntime()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('K50 route wiring', () => {
  it('reads the HttpOnly cookie, reloads the session and serves only own data', async () => {
    const response = await getMe(cookieRequest('/api/kubios/me?user_id=999&team_id=other'))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body).toMatchObject({
      status: 'ready',
      measurement_count: 1,
      latest_result: { result_id: 'synthetic-route-result' }
    })
    expect(getSession).toHaveBeenCalledWith('synthetic-valid-session')
    expect(rpcCalls.map((call) => call.name)).toEqual([
      'kubios_get_user_member_link',
      'kubios_get_snapshot'
    ])
    expect(rpcCalls[0]?.body).toEqual({ p_user_id: USER_A })
    expect(rpcCalls[1]?.body).toEqual({ p_team_id: TEAM_A, p_member_id: MEMBER_A })
  })

  it('denies a request that only presents a bearer header with 401', async () => {
    const request = new NextRequest('https://dashboard.invalid/api/kubios/me', {
      headers: { authorization: 'Bearer synthetic-only' }
    })
    const response = await getMe(request)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(getSession).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps two session cookies isolated and rechecks a revoked session before any RPC', async () => {
    getSession.mockImplementation(async (token?: string) => {
      if (token === 'session-a') return { user: { id: String(USER_A), role: 'admin' } }
      if (token === 'session-b') return { user: { id: String(USER_B), role: 'user' } }
      throw new UnauthorizedError('Sesión revocada')
    })
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.includes('/kubios_get_user_member_link')) {
        const userId = body.p_user_id
        if (userId !== USER_A && userId !== USER_B) return jsonResponse([])
        return jsonResponse([{
          user_id: userId,
          team_id: TEAM_A,
          kubios_member_id: userId === USER_A ? MEMBER_A : MEMBER_B,
        }])
      }
      if (url.includes('/kubios_get_snapshot')) {
        expect(body.p_team_id).toBe(TEAM_A)
        const memberId = body.p_member_id
        if (memberId === MEMBER_A) return jsonResponse([snapshotRow(MEMBER_A, 'result-a')])
        if (memberId === MEMBER_B) return jsonResponse([snapshotRow(MEMBER_B, 'result-b')])
      }
      throw new Error('Unexpected RPC')
    })
    const request = (token: string) => new NextRequest(
      'https://dashboard.invalid/api/kubios/me?user_id=999',
      { headers: { cookie: `dashboard_session=${token}` } },
    )

    const responses = await Promise.all([
      getMe(request('session-a')),
      getMe(request('session-b')),
    ])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    const [ownA, ownB] = await Promise.all(responses.map(response => response.json()))
    expect(ownA.latest_result.result_id).toBe('result-a')
    expect(ownB.latest_result.result_id).toBe('result-b')
    expect(JSON.stringify(ownA)).not.toContain('result-b')
    expect(JSON.stringify(ownB)).not.toContain('result-a')

    getSession.mockRejectedValueOnce(new UnauthorizedError('Sesión revocada'))
    fetchMock.mockClear()
    const revoked = await getMe(request('session-a'))
    expect(revoked.status).toBe(401)
    expect(await revoked.json()).toEqual({ error: 'unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('denies an expired or revoked session with 401', async () => {
    getSession.mockRejectedValueOnce(new UnauthorizedError('Sesión inválida o caducada'))

    const response = await getMe(cookieRequest('/api/kubios/me'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects client identity selectors on hrv-results with 400', async () => {
    const response = await getHrvResults(
      cookieRequest('/api/kubios/hrv-results?user_id=999&team_id=other')
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_query' })
    // La identidad se resuelve antes de validar la query, pero nunca se lee el
    // snapshot cuando la query es inválida.
    expect(rpcCalls.map((call) => call.name)).toEqual(['kubios_get_user_member_link'])
  })

  it('returns unavailable when the private service configuration is absent', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')

    const response = await getMe(cookieRequest('/api/kubios/me'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { ServerApplication } from '@/server/composition/container'
import { registerServerRuntime } from '@/server/composition/runtime'
import { KUBIOS_ENCRYPTION_KEY_ENV } from '@/lib/kubios-crypto'
import { GET as getParticipants } from '@/app/api/admin/kubios/participants/route'
import { GET as getMeasurements } from '@/app/api/admin/kubios/measurements/route'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '@/server/domain/privacy'

const KEY_B64 = Buffer.alloc(32, 0x5a).toString('base64')

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

const getSession = vi.fn()
const fetchMock = vi.fn()
const rpcCalls: { name: string; body: Record<string, unknown> }[] = []

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function cookieRequest(path: string, token = 'synthetic-admin-session'): NextRequest {
  return new NextRequest(`https://dashboard.invalid${path}`, {
    headers: { cookie: `dashboard_session=${token}` },
  })
}

function installRuntime(): void {
  registerServerRuntime(
    async () =>
      ({
        useCases: { auth: { getSession } },
      }) as unknown as ServerApplication,
  )
}

beforeEach(() => {
  rpcCalls.length = 0
  getSession.mockReset()
  getSession.mockResolvedValue({
    user: { id: '1', username: 'admin', role: 'admin' },
    privacy: {
      policyVersion: PRIVACY_POLICY_VERSION,
      policyHash: PRIVACY_POLICY_HASH,
      state: 'complete',
    },
  })

  vi.stubEnv('SUPABASE_URL', 'https://synthetic.supabase.co')
  vi.stubEnv(
    'SUPABASE_SERVICE_ROLE_KEY',
    jwt({ role: 'service_role', ref: 'synthetic' }),
  )
  vi.stubEnv(KUBIOS_ENCRYPTION_KEY_ENV, KEY_B64)

  fetchMock.mockReset()
  fetchMock.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
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

      if (name === 'kubios_admin_list_participants') {
        return jsonResponse([{ user_id: 1, username: 'alpha' }])
      }
      return new Response('unexpected rpc', { status: 404 })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  installRuntime()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('AK-02 administrative Kubios routes', () => {
  it('rejects a missing session with 401 before runtime or service', async () => {
    const response = await getParticipants(
      new NextRequest(
        'https://dashboard.invalid/api/admin/kubios/participants',
      ),
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(getSession).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects doctor and user sessions with 403 before the service call', async () => {
    for (const role of ['doctor', 'user'] as const) {
      getSession.mockResolvedValueOnce({
        user: { id: '2', username: role, role },
        privacy: {
          policyVersion: PRIVACY_POLICY_VERSION,
          policyHash: PRIVACY_POLICY_HASH,
          state: 'complete',
        },
      })
      const response = await getParticipants(
        cookieRequest('/api/admin/kubios/participants'),
      )

      expect(response.status).toBe(403)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(fetchMock).not.toHaveBeenCalled()
    }

    getSession.mockResolvedValueOnce({
      user: { id: '3', username: 'user', role: 'user' },
      privacy: {
        policyVersion: PRIVACY_POLICY_VERSION,
        policyHash: PRIVACY_POLICY_HASH,
        state: 'complete',
      },
    })
    const measurements = await getMeasurements(
      cookieRequest('/api/admin/kubios/measurements?userId=1'),
    )
    expect(measurements.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves the exact participants shape after the real admin guard', async () => {
    const response = await getParticipants(
      cookieRequest('/api/admin/kubios/participants'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      participants: [{ userId: 1, username: 'alpha' }],
      nextCursor: null,
    })
    expect(getSession).toHaveBeenCalledWith('synthetic-admin-session')
    expect(rpcCalls).toEqual([
      {
        name: 'kubios_admin_list_participants',
        body: { p_after_user_id: null, p_limit: 100 },
      },
    ])
  })

  it('rejects an invalid query with 400 without calling the service', async () => {
    const response = await getMeasurements(
      cookieRequest('/api/admin/kubios/measurements?userId=1&userId=2'),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { privacyPolicy, PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '@/lib/privacy-policy'
import { assertPrivacyAcknowledged, initialPrivacyStatus, type PrivacyDecision } from '@/server/domain/privacy'
import { SupabaseAuthStore } from '@/server/infrastructure/auth/supabase-auth-store'
import { createAuthGateway } from '@/server/infrastructure/auth/auth-gateway'
import { createSessionTokenCodec } from '@/server/infrastructure/auth/session-token'
import { createAuthUseCases } from '@/server/application/auth/auth-use-cases'
import { requireActor } from '@/server/http/handlers/auth'
import { resolveKubiosRequestIdentity } from '@/server/composition/kubios-runtime'
import { registerServerRuntime } from '@/server/composition/runtime'
import type { ServerApplication } from '@/server/composition/container'
import { GET } from '@/app/api/privacy/status/route'
import { POST } from '@/app/api/privacy/decision/route'
import { GET as getKubiosMe } from '@/app/api/kubios/me/route'
import { GET as getKubiosHistory } from '@/app/api/kubios/hrv-results/route'
import { GET as getKubiosExport } from '@/app/api/kubios/export/route'
import { FakeClock, FakeEmailTransport, FakeLimiter, FakePasswordVerifier, FakeSessionStore, FakeUserStore, makeUser, VALID_BCRYPT_HASH } from './doubles'

vi.mock('server-only', () => ({}))
const decision: PrivacyDecision = { policyVersion: PRIVACY_POLICY_VERSION, surface: 'login', decision: 'accept', language: 'es', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const user = makeUser({ id: '42', username: 'alice' })
const initial = initialPrivacyStatus()
const banner = { ...initial, state: 'banner' as const }

function store(fetchImpl: typeof fetch) {
  return new SupabaseAuthStore({ supabaseUrl: 'https://synthetic.invalid', serviceRoleKey: 'sb_secret_synthetic_test_only', fetch: fetchImpl, rateLimit: { windowSeconds: 60, maxAttempts: 3, blockSeconds: 60 } })
}
function setup(privacy?: { readPrivacy: () => Promise<typeof initial>; decidePrivacy: () => Promise<typeof initial & { rejected: boolean }> }) {
  const clock = new FakeClock(new Date('2026-11-04T10:00:00Z'))
  const sessions = new FakeSessionStore()
  const gateway = createAuthGateway({ users: new FakeUserStore([user], new Map([['alice', VALID_BCRYPT_HASH]])),
    passwords: new FakePasswordVerifier(), email: new FakeEmailTransport(), limiter: new FakeLimiter(),
    sessions, tokens: createSessionTokenCodec(Buffer.alloc(32, 7), { now: () => clock.now() }), clock,
    ...(privacy ? { privacy } : {}),
  })
  return { gateway, sessions }
}

describe('privacy policy and access', () => {
  it('binds both full translations to the audited hash', () => {
    expect(createHash('sha256').update(JSON.stringify(privacyPolicy)).digest('hex')).toBe(PRIVACY_POLICY_HASH)
    for (const text of Object.values(privacyPolicy)) {
      expect(text.paragraphs.join(' ')).toContain('htrain@proton.me')
      expect(text.paragraphs.join(' ')).toContain('Supabase')
    }
  })
  it('fails closed for missing, initial, obsolete and malformed state; permits banner and complete', () => {
    for (const privacy of [undefined, initial, { ...banner, policyVersion: 'obsolete' }, { ...banner, policyHash: 'wrong' }]) {
      expect(() => assertPrivacyAcknowledged({ privacy })).toThrow(expect.objectContaining({ code: 'PRIVACY_ACTION_REQUIRED', statusCode: 403 }))
    }
    expect(() => assertPrivacyAcknowledged({ privacy: banner })).not.toThrow()
    expect(() => assertPrivacyAcknowledged({ privacy: { ...initial, state: 'complete' } })).not.toThrow()
  })
  it('new authenticated sessions default initial and cannot call shared data guard', async () => {
    const { gateway } = setup()
    const session = await gateway.authenticateByUsername('alice', 'correct')
    expect(session?.privacy).toEqual(initial)
    await expect(requireActor(createAuthUseCases(gateway), session!.token)).rejects.toMatchObject({ statusCode: 403, code: 'PRIVACY_ACTION_REQUIRED' })
  })
  it('reloads privacy on every session read and propagates unavailable storage', async () => {
    const readPrivacy = vi.fn().mockResolvedValue(banner)
    const { gateway } = setup({ readPrivacy, decidePrivacy: vi.fn() })
    const session = await gateway.authenticateByUsername('alice', 'correct')
    expect((await gateway.getSession(session!.token))?.privacy).toEqual(banner)
    readPrivacy.mockRejectedValueOnce(new Error('synthetic unavailable'))
    await expect(gateway.getSession(session!.token)).rejects.toThrow()
  })
  it('does not call any Kubios service while first acknowledgement is pending', async () => {
    const createService = vi.fn()
    const getRuntime = async () => ({ useCases: { auth: { getSession: async () => ({ user, privacy: initial }) } } }) as unknown as ServerApplication
    await expect(resolveKubiosRequestIdentity('synthetic', { getRuntime, createService })).rejects.toMatchObject({ statusCode: 403, code: 'PRIVACY_ACTION_REQUIRED' })
    expect(createService).not.toHaveBeenCalled()
  })
  it('allows a banner-stage Kubios request to resolve its own link', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const getRuntime = async () => ({ useCases: { auth: { getSession: async () => ({ user, privacy: banner }) } } }) as unknown as ServerApplication
    expect(await resolveKubiosRequestIdentity('synthetic', { getRuntime, createService: () => ({ rpc }) })).toEqual({ status: 'unlinked' })
    expect(rpc).toHaveBeenCalledWith('kubios_get_user_member_link', { p_user_id: 42 })
  })
})

describe('privacy persistence adapter', () => {
  it('reads the current stage and resets an old policy to initial', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json([{ privacy_version: PRIVACY_POLICY_VERSION, privacy_hash: PRIVACY_POLICY_HASH, privacy_stage: 1 }]))
      .mockResolvedValueOnce(Response.json([{ privacy_version: 'old', privacy_hash: 'old', privacy_stage: 2 }]))
    const adapter = store(fetchImpl)
    expect(await adapter.readPrivacy('sid-hash', '42')).toEqual(banner)
    expect(await adapter.readPrivacy('sid-hash', '42')).toEqual(initial)
    expect(fetchImpl.mock.calls[0]![0]).toContain('user_id=eq.42')
  })
  it('never authorizes malformed, missing or unavailable persistence', async () => {
    for (const response of [Response.json([]), Response.json([{ privacy_version: PRIVACY_POLICY_VERSION, privacy_hash: PRIVACY_POLICY_HASH, privacy_stage: 3 }]), new Response('', { status: 503 })]) {
      await expect(store(vi.fn().mockResolvedValue(response)).readPrivacy('sid-hash', '42')).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it('submits exactly the audited fields to one atomic RPC without tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json([{ stage: 1, rejected: false }]))
    expect(await store(fetchImpl).decidePrivacy('hashed-sid', '42', decision)).toEqual({ ...banner, rejected: false })
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ p_sid_hash: 'hashed-sid', p_user_id: 42, p_policy_version: PRIVACY_POLICY_VERSION, p_policy_hash: PRIVACY_POLICY_HASH, p_surface: 'login', p_decision: 'accept', p_language: 'es', p_request_id: decision.requestId })
  })
  it('fails closed when RPC returns an outcome inconsistent with the decision', async () => {
    for (const row of [{ stage: 0, rejected: false }, { stage: 1, rejected: true }]) {
      await expect(store(vi.fn().mockResolvedValue(Response.json([row]))).decidePrivacy('hashed-sid', '42', decision)).rejects.toMatchObject({ statusCode: 503 })
    }
    await expect(store(vi.fn().mockResolvedValue(Response.json([{ stage: 1, rejected: false }]))).decidePrivacy('hashed-sid', '42', { ...decision, decision: 'reject' })).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('mounted privacy APIs with synthetic runtime', () => {
  function runtime() {
    const decidePrivacy = vi.fn().mockImplementation(async (_token, value) => ({ ...banner, rejected: value.decision === 'reject' }))
    registerServerRuntime(() => ({ useCases: { auth: { getSession: async () => ({ user, privacy: initial }), decidePrivacy } } } as unknown as ServerApplication))
    return decidePrivacy
  }
  function request(body: unknown, origin = 'http://localhost:3000') {
    return new NextRequest('http://localhost:3000/api/privacy/decision', { method: 'POST', headers: { cookie: 'dashboard_session=synthetic-session', origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }
  it('exposes only own initial privacy status with private/no-store', async () => {
    runtime()
    const response = await GET(new NextRequest('http://localhost:3000/api/privacy/status', { headers: { cookie: 'dashboard_session=synthetic-session' } }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(await response.json()).toEqual(initial)
    expect((await GET(new NextRequest('http://localhost:3000/api/privacy/status'))).status).toBe(401)
  })
  it('rejects obsolete versions, invalid input and cross-origin writes without persistence', async () => {
    const persist = runtime()
    expect((await POST(request({ ...decision, policyVersion: 'obsolete' }))).status).toBe(409)
    expect((await POST(request({ ...decision, userId: 99 }))).status).toBe(400)
    expect((await POST(request(decision, 'https://untrusted.invalid'))).status).toBe(403)
    expect(persist).not.toHaveBeenCalled()
  })
  it('persists refusal through the session method and clears the cookie', async () => {
    const persist = runtime()
    const response = await POST(request({ ...decision, decision: 'reject' }))
    expect(response.status).toBe(200)
    expect(persist).toHaveBeenCalledWith('synthetic-session', { ...decision, decision: 'reject' })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
  it('mounted personal Kubios routes return the actionable 403 before any service access', async () => {
    runtime()
    for (const [path, handler] of [['me', getKubiosMe], ['hrv-results', getKubiosHistory], ['export', getKubiosExport]] as const) {
      const response = await handler(new NextRequest(`http://localhost:3000/api/kubios/${path}`, { headers: { cookie: 'dashboard_session=synthetic-session' } }))
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code: 'PRIVACY_ACTION_REQUIRED' } })
      expect(response.headers.get('Cache-Control')).toContain('no-store')
    }
  })
})

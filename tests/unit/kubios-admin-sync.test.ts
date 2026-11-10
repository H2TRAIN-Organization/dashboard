import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { afterEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/server/composition/runtime', () => ({
  getServerRuntime: async () => ({ useCases: { auth: { getSession: mocks.getSession } } }),
}))
vi.mock('@/server/composition/kubios-runtime', () => ({
  createKubiosRpcClient: () => ({ rpc: mocks.rpc }),
}))
vi.mock('@/lib/kubios-sync', () => ({
  DEFAULT_KUBIOS_SYNC_BUDGET_MS: 26_000,
  runKubiosMemberRefresh: mocks.refresh,
}))
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '@/server/domain/privacy'
import { POST as syncRoute } from '@/app/api/admin/kubios/participants/[userId]/sync/route'
import { syncAdminKubiosMember } from '@/server/composition/kubios-admin-sync-runtime'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}))

const session = (role = 'admin', state = 'complete') => ({
  user: { id: '999', username: 'root', role },
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state },
})

const LINK = {
  user_id: 2,
  username: 'javier',
  team_id: '11111111-1111-4111-8111-111111111111',
  kubios_member_id: '22222222-2222-4222-8222-222222222222',
}

function cookieRequest(
  path = '/api/admin/kubios/participants/2/sync',
  { method = 'POST', origin = true } = {},
): NextRequest {
  return new NextRequest(`https://dashboard.test${path}`, {
    method,
    headers: {
      cookie: 'dashboard_session=opaque',
      ...(origin ? { Origin: 'https://dashboard.test', 'Sec-Fetch-Site': 'same-origin' } : {}),
    },
  })
}

const context = { params: Promise.resolve({ userId: '2' }) }

beforeEach(() => {
  mocks.getSession.mockReset()
  mocks.rpc.mockReset()
  mocks.refresh.mockReset()
  mocks.getSession.mockResolvedValue(session())
  mocks.rpc.mockResolvedValue({ data: [LINK], error: null })
  mocks.refresh.mockResolvedValue({ status: 'ok', synced: 1, failed: 0, memberSynced: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('syncAdminKubiosMember (SYNC-04)', () => {
  it('resuelve el vÃ­nculo verificado y lanza el refresco con el memberId de Kubios', async () => {
    const result = await syncAdminKubiosMember('opaque', '2')

    expect(result).toEqual({
      status: 'ok',
      memberSynced: true,
      synced: 1,
      failed: 0,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('kubios_admin_get_link', { p_user_id: 2 })
    expect(mocks.refresh).toHaveBeenCalledWith(LINK.kubios_member_id, expect.anything())
    const deps = mocks.refresh.mock.calls[0]?.[1] as { env: unknown; budgetMs: number }
    expect(deps.env).toBe(process.env)
    expect(deps.budgetMs).toBe(26_000)
  })

  it('prohÃ­be doctor, usuario y sesiones sin primer reconocimiento', async () => {
    mocks.getSession.mockResolvedValue(session('doctor'))
    await expect(syncAdminKubiosMember('opaque', '2')).rejects.toMatchObject({ code: "FORBIDDEN" })

    mocks.getSession.mockResolvedValue(session('admin', 'initial'))
    await expect(syncAdminKubiosMember('opaque', '2')).rejects.toMatchObject({
      code: 'PRIVACY_ACTION_REQUIRED',
    })

    await expect(syncAdminKubiosMember(undefined, '2')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  it('responde 404 sin vÃ­nculo verificable y 503 con Kubios indisponible', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(syncAdminKubiosMember('opaque', '2')).rejects.toMatchObject({ code: 'NOT_FOUND' })

    mocks.rpc.mockRejectedValue(new Error('secreto-interno-de-la-bd'))
    await expect(syncAdminKubiosMember('opaque', '2')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })

  it('no sincroniza un participante con identificador malformado', async () => {
    await expect(syncAdminKubiosMember('opaque', '0')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(syncAdminKubiosMember('opaque', 'no-es-id')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('preserva locked y el Retry-After finito de una pausa Kubios', async () => {
    mocks.refresh.mockResolvedValue({
      status: 'throttled',
      synced: 0,
      failed: 1,
      memberSynced: false,
      retryAfterSeconds: 86401,
    })
    const throttled = await syncAdminKubiosMember('opaque', '2')
    expect(throttled).toEqual({
      status: 'throttled',
      memberSynced: false,
      synced: 0,
      failed: 1,
      retryAfterSeconds: 86401,
    })

    mocks.refresh.mockResolvedValue({ status: 'locked', synced: 0, failed: 0, memberSynced: false })
    const locked = await syncAdminKubiosMember('opaque', '2')
    expect(locked).toEqual({
      status: 'locked',
      memberSynced: false,
      synced: 0,
      failed: 0,
    })
  })

  it('expone solo la categoría del fallo con partial y nunca con ok', async () => {
    mocks.refresh.mockResolvedValue({
      status: 'partial',
      synced: 0,
      failed: 1,
      memberSynced: false,
      errorCode: 'config.invalid',
    })
    const partial = await syncAdminKubiosMember('opaque', '2')
    expect(partial).toEqual({
      status: 'partial',
      memberSynced: false,
      synced: 0,
      failed: 1,
      errorCode: 'config.invalid',
    })

    mocks.refresh.mockResolvedValue({
      status: 'ok',
      synced: 1,
      failed: 0,
      memberSynced: true,
      errorCode: 'sync.internal',
    })
    const ok = await syncAdminKubiosMember('opaque', '2')
    expect(ok).toEqual({
      status: 'ok',
      memberSynced: true,
      synced: 1,
      failed: 0,
    })
  })
})

describe('POST /api/admin/kubios/participants/[userId]/sync', () => {
  it('aplica CSRF y sesiones reales antes de tocar el servicio', async () => {
    const withoutCsrf = await syncRoute(cookieRequest(undefined, { origin: false }), context)
    expect(withoutCsrf.status).toBe(403)
    expect(withoutCsrf.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.refresh).not.toHaveBeenCalled()

    mocks.getSession.mockResolvedValue(null)
    const withoutSession = await syncRoute(cookieRequest(), context)
    expect(withoutSession.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('devuelve el estado saneado del refresco privado y sin cachÃ©', async () => {
    const response = await syncRoute(cookieRequest(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      status: 'ok',
      memberSynced: true,
      synced: 1,
      failed: 0,
    })
  })

  it('traduce un vÃ­nculo ausente en 404 y un fallo de disponibilidad en 503', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const notFound = await syncRoute(cookieRequest(), context)
    expect(notFound.status).toBe(404)
    expect(await notFound.text()).not.toContain('kubios_member_id')

    mocks.rpc.mockRejectedValue(new Error('private-secret'))
    const unavailable = await syncRoute(cookieRequest(), context)
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('private-secret')
  })
})


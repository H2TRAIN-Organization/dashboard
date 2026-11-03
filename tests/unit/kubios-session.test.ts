import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

import type { ServerApplication } from '@/server/composition/container'
import { ServiceUnavailableError, UnauthorizedError } from '@/server/domain/errors'
import { sessionTokenFrom } from '@/server/http/next/route-bridge'
import {
  KubiosAuthError,
  resolveKubiosIdentity,
  type KubiosAuthzDeps,
  type KubiosRpcClient,
  type KubiosSessionGetter
} from '@/lib/kubios-authz'
import { resolveKubiosRequestIdentity } from '@/server/composition/kubios-runtime'

vi.mock('server-only', () => ({}))

const USER_A = 42
const USER_B = 43
const TEAM_A = '11111111-1111-4111-8111-111111111111'
const MEMBER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TEAM_B = '22222222-2222-4222-8222-222222222222'
const MEMBER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TOKEN = 'synthetic-session-token'
const OTHER_UUID = '99999999-9999-4999-8999-999999999999'

function linkRow(userId = USER_A, teamId = TEAM_A, memberId = MEMBER_A) {
  return {
    user_id: userId,
    team_id: teamId,
    kubios_member_id: memberId
  }
}

function depsWith(options: {
  getSession?: KubiosSessionGetter
  session?: { user: { id: string } } | unknown
  sessionError?: unknown
  rpc?: (name: string, args: Readonly<Record<string, unknown>>) => unknown
  rpcResponse?: unknown
  rpcError?: unknown
  createServiceError?: unknown
} = {}): {
  deps: KubiosAuthzDeps
  getSession: ReturnType<typeof vi.fn>
  createService: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
  stats: { serviceCreated: number }
} {
  const stats = { serviceCreated: 0 }
  const hasRpcResponse = Object.prototype.hasOwnProperty.call(options, 'rpcResponse')
  const rpc = vi.fn(async (name: string, args: Readonly<Record<string, unknown>>) => {
    if (options.rpc !== undefined) return options.rpc(name, args)
    if (options.rpcError !== undefined) throw options.rpcError
    return hasRpcResponse ? options.rpcResponse : { data: [linkRow()], error: null }
  })

  const getSession = vi.fn(async () => {
    if (options.sessionError !== undefined) throw options.sessionError
    return options.session ?? { user: { id: String(USER_A), role: 'user', uuid: OTHER_UUID } }
  }) as unknown as KubiosSessionGetter

  const createService = vi.fn((): KubiosRpcClient => {
    stats.serviceCreated += 1
    if (options.createServiceError !== undefined) throw options.createServiceError
    return { rpc }
  })

  return {
    deps: {
      getSession: options.getSession ?? getSession,
      createService
    },
    getSession: getSession as unknown as ReturnType<typeof vi.fn>,
    createService,
    rpc,
    stats
  }
}

async function expectAuthError(promise: Promise<unknown>, status: 401 | 503) {
  await expect(promise).rejects.toMatchObject({
    name: 'KubiosAuthError',
    status
  })
}

describe('K50 identity exclusively from the production session', () => {
  it('reads only the HttpOnly session cookie and never falls back to Bearer', () => {
    const cookieRequest = new NextRequest('http://localhost/api/kubios/me', {
      headers: { cookie: 'dashboard_session=cookie-token; other=1' }
    })
    expect(sessionTokenFrom(cookieRequest)).toBe('cookie-token')

    const bearerRequest = new NextRequest('http://localhost/api/kubios/me', {
      headers: { authorization: 'Bearer synthetic-jwt' }
    })
    expect(sessionTokenFrom(bearerRequest)).toBeUndefined()
  })

  it('uses Number(session.user.id) and queries the link RPC with an integer', async () => {
    const harness = depsWith()

    await expect(resolveKubiosIdentity(TOKEN, harness.deps)).resolves.toEqual({
      status: 'linked',
      teamId: TEAM_A,
      memberId: MEMBER_A
    })

    expect(harness.getSession).toHaveBeenCalledWith(TOKEN)
    expect(harness.stats.serviceCreated).toBe(1)
    expect(harness.rpc).toHaveBeenCalledWith('kubios_get_user_member_link', {
      p_user_id: USER_A
    })
  })

  it('ignores role, uuid, username and email; admin only resolves its own link', async () => {
    const harness = depsWith({
      session: {
        user: {
          id: String(USER_A),
          role: 'admin',
          uuid: OTHER_UUID,
          username: 'someone-else',
          email: 'attacker@example.invalid'
        }
      },
      rpcResponse: { data: [linkRow(USER_A)], error: null }
    })

    await expect(resolveKubiosIdentity(TOKEN, harness.deps)).resolves.toMatchObject({
      status: 'linked',
      teamId: TEAM_A,
      memberId: MEMBER_A
    })
    expect(harness.rpc).toHaveBeenCalledWith('kubios_get_user_member_link', {
      p_user_id: USER_A
    })

    const other = depsWith({
      session: { user: { id: String(USER_B), role: 'user', uuid: OTHER_UUID } },
      rpcResponse: { data: [linkRow(USER_B, TEAM_B, MEMBER_B)], error: null }
    })
    await expect(resolveKubiosIdentity(TOKEN, other.deps)).resolves.toMatchObject({
      status: 'linked',
      teamId: TEAM_B,
      memberId: MEMBER_B
    })
    expect(other.rpc).toHaveBeenCalledWith('kubios_get_user_member_link', {
      p_user_id: USER_B
    })
  })

  it('rejects an absent, empty or non-string session token with 401 before any dependency', async () => {
    for (const token of [null, undefined, '']) {
      const harness = depsWith()
      await expectAuthError(resolveKubiosIdentity(token, harness.deps), 401)
      expect(harness.getSession).not.toHaveBeenCalled()
      expect(harness.createService).not.toHaveBeenCalled()
    }
  })

  it('maps an expired or revoked session to 401 without creating the service', async () => {
    const harness = depsWith({
      sessionError: new UnauthorizedError('Sesión inválida o caducada')
    })

    await expectAuthError(resolveKubiosIdentity(TOKEN, harness.deps), 401)
    expect(harness.getSession).toHaveBeenCalledWith(TOKEN)
    expect(harness.createService).not.toHaveBeenCalled()
  })

  it('maps a session dependency failure to 503', async () => {
    const harness = depsWith({ sessionError: new ServiceUnavailableError() })
    await expectAuthError(resolveKubiosIdentity(TOKEN, harness.deps), 503)
    expect(harness.createService).not.toHaveBeenCalled()
  })

  it('fails closed when the verified session id is not a canonical PostgreSQL integer', async () => {
    const invalidIds = [
      '0042',
      '+42',
      ' 42',
      '42 ',
      '42.0',
      '4e1',
      'abc',
      OTHER_UUID,
      '',
      '-0'
    ]

    for (const id of invalidIds) {
      const harness = depsWith({ session: { user: { id } } })
      await expectAuthError(resolveKubiosIdentity(TOKEN, harness.deps), 503)
      expect(harness.createService).not.toHaveBeenCalled()
    }
  })

  it('treats only an empty RPC data array as unlinked', async () => {
    const harness = depsWith({ rpcResponse: { data: [], error: null } })
    await expect(resolveKubiosIdentity(TOKEN, harness.deps)).resolves.toEqual({
      status: 'unlinked'
    })
  })

  it('fails closed when the link row belongs to another integer user', async () => {
    const harness = depsWith({
      rpcResponse: { data: [linkRow(USER_B, TEAM_B, MEMBER_B)], error: null }
    })

    await expectAuthError(resolveKubiosIdentity(TOKEN, harness.deps), 503)
    expect(harness.rpc).toHaveBeenCalledWith('kubios_get_user_member_link', {
      p_user_id: USER_A
    })
  })

  it('rejects a string, missing or non-integer user_id in the link row', async () => {
    const rows = [
      { user_id: String(USER_A), team_id: TEAM_A, kubios_member_id: MEMBER_A },
      { team_id: TEAM_A, kubios_member_id: MEMBER_A },
      { user_id: 42.5, team_id: TEAM_A, kubios_member_id: MEMBER_A },
      { user_id: null, team_id: TEAM_A, kubios_member_id: MEMBER_A }
    ]

    for (const row of rows) {
      const harness = depsWith({ rpcResponse: { data: [row], error: null } })
      await expectAuthError(resolveKubiosIdentity(TOKEN, harness.deps), 503)
    }
  })

  it('rejects malformed team/member ids and malformed RPC envelopes', async () => {
    const invalidRows = [
      { ...linkRow(), team_id: 'not-a-uuid' },
      { ...linkRow(), team_id: null },
      { ...linkRow(), kubios_member_id: 'not-a-uuid' },
      { ...linkRow(), kubios_member_id: undefined }
    ]

    for (const row of invalidRows) {
      const harness = depsWith({ rpcResponse: { data: [row], error: null } })
      await expectAuthError(resolveKubiosIdentity(TOKEN, harness.deps), 503)
    }

    const malformed = [
      null,
      undefined,
      42,
      'data',
      [],
      {},
      { data: undefined, error: null },
      { data: null, error: null },
      { data: {}, error: null },
      { data: [linkRow(), linkRow()], error: null },
      { data: [linkRow()], error: { message: 'synthetic' } }
    ]

    for (const response of malformed) {
      const harness = depsWith({ rpcResponse: response })
      await expectAuthError(resolveKubiosIdentity(TOKEN, harness.deps), 503)
    }
  })

  it('fails closed when the service factory or RPC throws', async () => {
    const factory = depsWith({ createServiceError: new Error('synthetic config') })
    await expectAuthError(resolveKubiosIdentity(TOKEN, factory.deps), 503)
    expect(factory.stats.serviceCreated).toBe(1)

    const rpc = depsWith({ rpcError: new Error('synthetic rpc') })
    await expectAuthError(resolveKubiosIdentity(TOKEN, rpc.deps), 503)
  })

  it('does not leak identifiers or secrets in the generic error', async () => {
    const harness = depsWith({
      rpcResponse: { data: [linkRow(USER_B, TEAM_B, MEMBER_B)], error: null }
    })

    let caught: unknown
    try {
      await resolveKubiosIdentity(TOKEN, harness.deps)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(KubiosAuthError)
    const surface = JSON.stringify(caught)
    for (const forbidden of [TOKEN, String(USER_A), String(USER_B), TEAM_A, TEAM_B, MEMBER_A, MEMBER_B]) {
      expect(surface).not.toContain(forbidden)
    }
  })
})

describe('K50 composition with getServerRuntime', () => {
  function fakeApplication(getSession: KubiosSessionGetter): ServerApplication {
    return {
      useCases: { auth: { getSession } }
    } as unknown as ServerApplication
  }

  it('uses the runtime session method and the lazy service factory', async () => {
    const getSession = vi.fn(async () => ({ user: { id: String(USER_A) } }))
    const rpc = vi.fn(async () => ({ data: [linkRow()], error: null }))
    const createService = vi.fn((): KubiosRpcClient => ({ rpc }))
    const getRuntime = vi.fn(async () => fakeApplication(getSession))

    await expect(
      resolveKubiosRequestIdentity(TOKEN, { getRuntime, createService })
    ).resolves.toMatchObject({ status: 'linked' })

    expect(getRuntime).toHaveBeenCalledTimes(1)
    expect(getSession).toHaveBeenCalledWith(TOKEN)
    expect(createService).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('kubios_get_user_member_link', {
      p_user_id: USER_A
    })
  })

  it('does not build the runtime or service without a session token', async () => {
    const getRuntime = vi.fn(async () => fakeApplication(vi.fn()))
    const createService = vi.fn()

    await expectAuthError(
      resolveKubiosRequestIdentity(null, { getRuntime, createService }),
      401
    )
    expect(getRuntime).not.toHaveBeenCalled()
    expect(createService).not.toHaveBeenCalled()
  })

  it('maps runtime configuration failures to 503', async () => {
    const getRuntime = vi.fn(async () => {
      throw new ServiceUnavailableError()
    })
    const createService = vi.fn()

    await expectAuthError(
      resolveKubiosRequestIdentity(TOKEN, { getRuntime, createService }),
      503
    )
    expect(createService).not.toHaveBeenCalled()
  })
})

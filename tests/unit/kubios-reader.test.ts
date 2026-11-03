import { describe, expect, it, vi } from 'vitest'

import {
  KUBIOS_ENCRYPTION_KEY_ENV,
  decryptKubiosSnapshot,
  encryptKubiosSnapshot
} from '@/lib/kubios-crypto'
import {
  handleKubiosExportRequest,
  handleKubiosHrvResultsRequest,
  handleKubiosMeRequest,
  type KubiosHrvResultsBody,
  type KubiosMeBody,
  type KubiosMeDeps,
  type KubiosMeIdentity,
  type KubiosMeServiceClient
} from '@/lib/kubios-snapshot-reader'
import { KubiosAuthError } from '@/lib/kubios-authz'

vi.mock('server-only', () => ({}))

const TEAM_A = '11111111-1111-4111-8111-111111111111'
const MEMBER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TEAM_B = '22222222-2222-4222-8222-222222222222'
const MEMBER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const SESSION_A = 'synthetic-session-a'
const SESSION_B = 'synthetic-session-b'
const ENDPOINT = 'https://dashboard.invalid/api/kubios'
const NOW_MS = Date.parse('2026-11-03T12:00:00.000Z')
const TEN_MINUTES_MS = 10 * 60 * 1000

const KEY = Buffer.alloc(32, 0x5a)
const KEY_B64 = KEY.toString('base64')
const OTHER_KEY_B64 = Buffer.alloc(32, 0x6c).toString('base64')
const ENV = Object.freeze({ [KUBIOS_ENCRYPTION_KEY_ENV]: KEY_B64 })
const OTHER_ENV = Object.freeze({ [KUBIOS_ENCRYPTION_KEY_ENV]: OTHER_KEY_B64 })

const LINKED_A: KubiosMeIdentity = Object.freeze({
  status: 'linked',
  teamId: TEAM_A,
  memberId: MEMBER_A
})
const LINKED_B: KubiosMeIdentity = Object.freeze({
  status: 'linked',
  teamId: TEAM_B,
  memberId: MEMBER_B
})
const UNLINKED: KubiosMeIdentity = Object.freeze({ status: 'unlinked' })

const SCOPE_A = Object.freeze({ teamId: TEAM_A, memberId: MEMBER_A })
const SCOPE_B = Object.freeze({ teamId: TEAM_B, memberId: MEMBER_B })

interface RpcCall {
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
}

function atOffset(offsetMs: number): string {
  return new Date(NOW_MS + offsetMs).toISOString()
}

function bytea(buffer: Buffer): string {
  return `\\x${buffer.toString('hex')}`
}

function rowFromPayload(payload: string, updatedAt: string) {
  const envelope = Buffer.from(payload, 'base64')
  expect(envelope.readUInt8(0)).toBe(1)

  return {
    ciphertext: bytea(envelope.subarray(29)),
    nonce: bytea(envelope.subarray(1, 13)),
    tag: bytea(envelope.subarray(13, 29)),
    key_version: 1,
    updated_at: updatedAt
  }
}

function rowForPlaintext(
  plaintext: string,
  options: {
    updatedAt?: string
    scope?: { teamId: string; memberId: string }
    env?: Record<string, string | undefined>
  } = {}
) {
  const {
    updatedAt = atOffset(-60_000),
    scope = SCOPE_A,
    env = ENV
  } = options
  return rowFromPayload(encryptKubiosSnapshot(plaintext, scope, { env }), updatedAt)
}

function rowForResults(
  results: readonly Record<string, unknown>[],
  options: Parameters<typeof rowForPlaintext>[1] & { extraRoot?: Record<string, unknown> } = {}
) {
  const { extraRoot, ...rowOptions } = options
  const root = extraRoot === undefined ? { results } : { results, ...extraRoot }
  return rowForPlaintext(JSON.stringify(root), rowOptions)
}

function scopeKey(scope: { teamId: string; memberId: string }): string {
  return `${scope.teamId}:${scope.memberId}`
}

function createServiceMock(
  handler: (name: string, args: Readonly<Record<string, unknown>>) => unknown
): KubiosMeServiceClient & { calls: RpcCall[] } {
  const calls: RpcCall[] = []
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args })
      return handler(name, args)
    }
  }
}

function serviceForRows(rowsByScope: Record<string, unknown[]>) {
  return createServiceMock((name, args) => {
    if (name !== 'kubios_get_snapshot') {
      return { data: null, error: { message: 'unexpected rpc' } }
    }
    const rows = rowsByScope[`${String(args.p_team_id)}:${String(args.p_member_id)}`]
    return { data: rows ?? [], error: null }
  })
}

function serviceForRow(row: unknown) {
  return createServiceMock(() => ({ data: [row], error: null }))
}

function serviceForData(data: unknown) {
  return createServiceMock(() => ({ data, error: null }))
}

interface HarnessOptions {
  identity?: KubiosMeIdentity
  identityError?: unknown
  service?: KubiosMeServiceClient
  serviceError?: unknown
  env?: Record<string, string | undefined>
  now?: number
}

interface Harness {
  readonly deps: KubiosMeDeps
  readonly stats: {
    readonly sessionTokens: (string | null)[]
    createServiceCalls: number
  }
}

function createHarness(options: HarnessOptions = {}): Harness {
  const {
    identity = UNLINKED,
    identityError,
    service,
    serviceError,
    env = ENV,
    now = NOW_MS
  } = options

  const stats = { sessionTokens: [] as (string | null)[], createServiceCalls: 0 }

  return {
    stats,
    deps: {
      resolveIdentity: async (sessionToken) => {
        stats.sessionTokens.push(sessionToken)
        // Modela el contrato real de authz: sin cookie no hay identidad.
        if (sessionToken === null) throw new KubiosAuthError(401)
        if (identityError !== undefined) throw identityError
        return identity
      },
      createService: () => {
        stats.createServiceCalls += 1
        if (serviceError !== undefined) throw serviceError
        if (service === undefined) throw new Error('service missing in test')
        return service
      },
      decryptSnapshot: decryptKubiosSnapshot,
      cryptoEnv: env,
      now: () => new Date(now)
    }
  }
}

async function callMe(
  options: HarnessOptions = {},
  request: { sessionToken?: string | null } = {}
) {
  const harness = createHarness(options)
  const result = await handleKubiosMeRequest(
    { sessionToken: request.sessionToken === undefined ? SESSION_A : request.sessionToken },
    harness.deps
  )
  return { ...result, harness }
}

async function callHrv(
  options: HarnessOptions = {},
  request: { sessionToken?: string | null; path?: string } = {}
) {
  const harness = createHarness(options)
  const result = await handleKubiosHrvResultsRequest(
    {
      sessionToken: request.sessionToken === undefined ? SESSION_A : request.sessionToken,
      url: `${ENDPOINT}/hrv-results${request.path ?? ''}`
    },
    harness.deps
  )
  return { ...result, harness }
}

async function callExport(
  options: HarnessOptions = {},
  request: { sessionToken?: string | null; path?: string } = {}
) {
  const harness = createHarness(options)
  const result = await handleKubiosExportRequest(
    {
      sessionToken: request.sessionToken === undefined ? SESSION_A : request.sessionToken,
      url: `${ENDPOINT}/export${request.path ?? ''}`
    },
    harness.deps
  )
  return { ...result, harness }
}

const SUCCESS_KEYS = ['latest_result', 'measurement_count', 'status', 'synced_at']
const HRV_KEYS = ['results', 'status', 'synced_at']

function assertNoStore(headers: Readonly<Record<string, string>>) {
  expect(headers['Cache-Control']).toBe('private, no-store')
}

function resultA(id = 'synthetic-a-1', measuredAt = atOffset(-3 * 3600 * 1000)) {
  return { result_id: id, measured_timestamp: measuredAt, hrv_score: 61 }
}

function resultB(id = 'synthetic-b-1', measuredAt = atOffset(-2 * 3600 * 1000)) {
  return { result_id: id, measured_timestamp: measuredAt, hrv_score: 74 }
}

describe('K50 snapshot reader', () => {
  describe('me', () => {
    it('returns the own snapshot with the agreed four keys', async () => {
      const older = resultA('synthetic-a-older', atOffset(-3 * 3600 * 1000))
      const newer = resultA('synthetic-a-newer', atOffset(-30 * 60 * 1000))
      const row = rowForResults([older, newer])
      const service = serviceForRows({ [scopeKey(SCOPE_A)]: [row] })

      const response = await callMe({ identity: LINKED_A, service })

      expect(response.status).toBe(200)
      assertNoStore(response.headers)
      expect(Object.keys(response.body).sort()).toEqual(SUCCESS_KEYS)
      expect(response.body).toEqual({
        status: 'ready',
        measurement_count: 2,
        synced_at: atOffset(-60_000),
        latest_result: newer
      })
      expect(response.harness.stats.sessionTokens).toEqual([SESSION_A])
      expect(response.harness.stats.createServiceCalls).toBe(1)
      expect(service.calls).toEqual([
        {
          name: 'kubios_get_snapshot',
          args: { p_team_id: TEAM_A, p_member_id: MEMBER_A }
        }
      ])
    })

    it('isolates two integer users by their verified team/member link', async () => {
      const rowA = rowForResults([resultA()])
      const rowB = rowForResults([resultB('synthetic-b-1'), resultB('synthetic-b-2', atOffset(-10 * 60 * 1000))], {
        scope: SCOPE_B,
        updatedAt: atOffset(-120_000)
      })
      const service = serviceForRows({
        [scopeKey(SCOPE_A)]: [rowA],
        [scopeKey(SCOPE_B)]: [rowB]
      })

      const responseA = await callMe({ identity: LINKED_A, service })
      const responseB = await callMe({ identity: LINKED_B, service }, { sessionToken: SESSION_B })

      expect((responseA.body as KubiosMeBody).latest_result).toEqual(resultA())
      expect((responseB.body as KubiosMeBody).latest_result).toEqual(
        resultB('synthetic-b-2', atOffset(-10 * 60 * 1000))
      )
      expect(service.calls.map((call) => call.args)).toEqual([
        { p_team_id: TEAM_A, p_member_id: MEMBER_A },
        { p_team_id: TEAM_B, p_member_id: MEMBER_B }
      ])
    })

    it('answers unlinked without creating the service', async () => {
      const response = await callMe({ identity: UNLINKED })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        status: 'unlinked',
        measurement_count: 0,
        synced_at: null,
        latest_result: null
      })
      expect(response.harness.stats.createServiceCalls).toBe(0)
    })

    it('maps only an empty RPC data array to pending', async () => {
      for (const data of [[], undefined, null, {}, 'data', 0]) {
        const response = await callMe({
          identity: LINKED_A,
          service: serviceForData(data)
        })

        if (Array.isArray(data)) {
          expect(response.status).toBe(200)
          expect(response.body).toMatchObject({
            status: 'pending',
            measurement_count: 0,
            synced_at: null
          })
        } else {
          expect(response.status).toBe(503)
          expect(response.body).toEqual({ error: 'unavailable' })
        }
      }
    })

    it('maps an empty decrypted result list to empty with synced_at', async () => {
      const row = rowForResults([], {
        updatedAt: atOffset(-120_000),
        extraRoot: { secret_root: 'SYNTHETIC_ROOT_SECRET' }
      })
      const response = await callMe({ identity: LINKED_A, service: serviceForRow(row) })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        status: 'empty',
        measurement_count: 0,
        synced_at: atOffset(-120_000),
        latest_result: null
      })
      expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_ROOT_SECRET')
    })

    it('marks ready up to ten minutes inclusive and stale afterwards', async () => {
      const readyRow = rowForResults([resultA()], { updatedAt: atOffset(-TEN_MINUTES_MS) })
      const ready = await callMe({ identity: LINKED_A, service: serviceForRow(readyRow) })
      expect((ready.body as KubiosMeBody).status).toBe('ready')

      const staleRow = rowForResults([resultA()], {
        updatedAt: atOffset(-TEN_MINUTES_MS - 1)
      })
      const stale = await callMe({ identity: LINKED_A, service: serviceForRow(staleRow) })
      expect((stale.body as KubiosMeBody).status).toBe('stale')
    })

    it('preserves the real nested result object as latest_result', async () => {
      const nested = {
        result_id: 'synthetic-nested',
        measured_timestamp: atOffset(-2 * 60 * 1000),
        daily_result: 'good',
        result: {
          readiness: 82,
          freq_domain: { HF_power: 1.5, LF_power: 2.5 }
        },
        user_happiness: 8
      }
      const row = rowForResults([nested])
      const response = await callMe({ identity: LINKED_A, service: serviceForRow(row) })

      expect((response.body as KubiosMeBody).latest_result).toEqual(nested)
    })

    it('fails closed on AAD mismatch, wrong key and corrupted ciphertext', async () => {
      const row = rowForResults([resultA()])

      const wrongScope = await callMe({
        identity: LINKED_A,
        service: serviceForRow(rowForResults([resultB()], { scope: SCOPE_B }))
      })
      expect(wrongScope.status).toBe(503)

      const wrongKey = await callMe({
        identity: LINKED_A,
        service: serviceForRow(row),
        env: OTHER_ENV
      })
      expect(wrongKey.status).toBe(503)

      const tamperedBytes = Buffer.from(row.ciphertext.slice(2), 'hex')
      const lastIndex = tamperedBytes.length - 1
      tamperedBytes[lastIndex] = (tamperedBytes[lastIndex] ?? 0) ^ 0x01
      const tampered = await callMe({
        identity: LINKED_A,
        service: serviceForRow({ ...row, ciphertext: bytea(tamperedBytes) })
      })
      expect(tampered.status).toBe(503)
    })

    it('maps an absent, invalid or revoked session to 401 without service', async () => {
      const missing = await callMe({}, { sessionToken: null })
      expect(missing.status).toBe(401)
      expect(missing.body).toEqual({ error: 'unauthorized' })
      expect(missing.harness.stats.sessionTokens).toEqual([null])
      expect(missing.harness.stats.createServiceCalls).toBe(0)

      for (const identityError of [
        new KubiosAuthError(401),
        new Error('synthetic session failure')
      ]) {
        const response = await callMe({ identity: LINKED_A, identityError })
        expect(response.status).toBe(identityError instanceof KubiosAuthError ? 401 : 503)
        expect(response.harness.stats.createServiceCalls).toBe(0)
      }
    })
  })

  describe('hrv-results', () => {
    it('returns own results sorted by date with exactly three keys', async () => {
      const older = resultA('synthetic-old', '2026-11-01T10:00:00.000Z')
      const newer = resultA('synthetic-new', '2026-11-03T10:00:00.000Z')
      const middle = resultA('synthetic-middle', '2026-11-02T10:00:00.000Z')
      const row = rowForResults([older, newer, middle])
      const response = await callHrv({
        identity: LINKED_A,
        service: serviceForRow(row)
      })

      expect(response.status).toBe(200)
      assertNoStore(response.headers)
      expect(Object.keys(response.body).sort()).toEqual(HRV_KEYS)
      expect(response.body).toEqual({
        status: 'ready',
        results: [newer, middle, older],
        synced_at: atOffset(-60_000)
      })
    })

    it('filters inclusively by from/to ISO dates and preserves nested results', async () => {
      const dayOne = {
        ...resultA('synthetic-day-1', '2026-11-01T10:00:00.000Z'),
        result: { readiness: 60, freq_domain: { HF_power: 3 } }
      }
      const dayTwo = resultA('synthetic-day-2', '2026-11-02T10:00:00.000Z')
      const dayThree = resultA('synthetic-day-3', '2026-11-03T10:00:00.000Z')
      const row = rowForResults([dayOne, dayTwo, dayThree])

      const response = await callHrv(
        { identity: LINKED_A, service: serviceForRow(row) },
        { path: '?from=2026-11-01&to=2026-11-02' }
      )

      const body = response.body as KubiosHrvResultsBody
      expect(response.status).toBe(200)
      expect(body.status).toBe('ready')
      expect(body.results).toEqual([dayTwo, dayOne])
    })

    it('accepts the UI date aliases and rejects ambiguous duplicates', async () => {
      const row = rowForResults([resultA()])

      const alias = await callHrv(
        { identity: LINKED_A, service: serviceForRow(row) },
        { path: '?from_date=2026-11-01&to_date=2026-11-03' }
      )
      expect(alias.status).toBe(200)

      const ambiguous = await callHrv(
        { identity: LINKED_A, service: serviceForRow(row) },
        { path: '?from=2026-11-01&from_date=2026-11-01' }
      )
      expect(ambiguous.status).toBe(400)
      expect(ambiguous.body).toEqual({ error: 'invalid_query' })
    })

    it('rejects client user/team/member selectors and malformed dates with 400', async () => {
      const row = rowForResults([resultA()])
      const attacks = [
        '?user_id=43',
        '?team_id=22222222-2222-4222-8222-222222222222',
        '?member_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '?from=2026-11-01&to=2026-11-02&user_id=43',
        '?from=2026-02-30',
        '?from=2026-11-03&to=2026-11-01',
        '?from=2026-11-01T10:00:00',
        '?from=2026-11-01&from=2026-11-02'
      ]

      for (const path of attacks) {
        const response = await callHrv(
          { identity: LINKED_A, service: serviceForRow(row) },
          { path }
        )
        expect(response.status, path).toBe(400)
        expect(response.body).toEqual({ error: 'invalid_query' })
        assertNoStore(response.headers)
      }
    })

    it('checks identity before query and service, keeping 401/400 generic', async () => {
      const unauthorized = await callHrv(
        { identityError: new KubiosAuthError(401) },
        { path: '?user_id=43' }
      )
      expect(unauthorized.status).toBe(401)
      expect(unauthorized.body).toEqual({ error: 'unauthorized' })

      const invalidQuery = await callHrv(
        { identity: UNLINKED },
        { path: '?user_id=43' }
      )
      expect(invalidQuery.status).toBe(400)
      expect(invalidQuery.harness.stats.createServiceCalls).toBe(0)

      const unlinked = await callHrv({ identity: UNLINKED })
      expect(unlinked.status).toBe(200)
      expect(unlinked.body).toEqual({
        status: 'unlinked',
        results: [],
        synced_at: null
      })
      expect(unlinked.harness.stats.createServiceCalls).toBe(0)
    })

    it('maps pending, empty and unavailable snapshots', async () => {
      const pending = await callHrv({
        identity: LINKED_A,
        service: serviceForData([])
      })
      expect(pending.body).toEqual({ status: 'pending', results: [], synced_at: null })

      const empty = await callHrv({
        identity: LINKED_A,
        service: serviceForRow(rowForResults([]))
      })
      expect(empty.body).toEqual({
        status: 'empty',
        results: [],
        synced_at: atOffset(-60_000)
      })

      const unavailable = await callHrv({
        identity: LINKED_A,
        service: serviceForData(null)
      })
      expect(unavailable.status).toBe(503)
      expect(unavailable.body).toEqual({ error: 'unavailable' })
    })
  })

  describe('export', () => {
    it('returns a safe text/csv of the own snapshot without IDs or formulas', async () => {
      const row = {
        result_id: 'SECRET_RESULT_ID',
        measure_id: 'SECRET_MEASURE_ID',
        user_id: 999,
        user_name: 'Other User',
        email: 'other@example.invalid',
        measured_timestamp: '2026-11-02T10:00:00.000Z',
        daily_result: '=1+1',
        result: {
          readiness: 80,
          mean_hr_bpm: 62,
          rmssd_ms: 42.5,
          pns_index: 75,
          sns_index: 25,
          physiological_age: 35,
          respiratory_rate: 14,
          stress_index: 30,
          artefact_level: '@cmd',
          freq_domain: {
            HF_power: 1.5,
            LF_power: 2.5,
            VLF_power: 3.5,
            tot_power: 7.5
          }
        }
      }
      const response = await callExport({
        identity: LINKED_A,
        service: serviceForRow(rowForResults([row]))
      })

      expect(response.status).toBe(200)
      expect(response.headers['Content-Type']).toBe('text/csv; charset=utf-8')
      expect(response.headers['Cache-Control']).toBe('private, no-store')
      expect(response.headers['Content-Disposition']).toContain('attachment; filename="kubios-hrv-')
      expect(response.body).toContain('Fecha,Resultado diario,Readiness')
      expect(response.body).toContain("'=1+1")
      expect(response.body).toContain("'@cmd")
      expect(response.body).toContain('80,62,42.5')
      expect(response.body).not.toContain('SECRET_RESULT_ID')
      expect(response.body).not.toContain('SECRET_MEASURE_ID')
      expect(response.body).not.toContain('Other User')
      expect(response.body).not.toContain('other@example.invalid')
    })

    it('applies the same date filters and returns an empty CSV without results', async () => {
      const dayOne = resultA('synthetic-day-1', '2026-11-01T10:00:00.000Z')
      const dayTwo = resultA('synthetic-day-2', '2026-11-02T10:00:00.000Z')
      const row = rowForResults([dayOne, dayTwo])

      const filtered = await callExport(
        { identity: LINKED_A, service: serviceForRow(row) },
        { path: '?from=2026-11-02&to=2026-11-02' }
      )
      expect(filtered.status).toBe(200)
      expect(filtered.body).toContain('2026-11-02T10:00:00.000Z')
      expect(filtered.body).not.toContain('2026-11-01T10:00:00.000Z')

      const empty = await callExport({
        identity: LINKED_A,
        service: serviceForData([])
      })
      expect(empty.status).toBe(200)
      expect(empty.body).toBe('')
    })

    it('rejects identity selectors in the export query with 400', async () => {
      const response = await callExport(
        { identity: LINKED_A, service: serviceForRow(rowForResults([resultA()])) },
        { path: '?team_id=22222222-2222-4222-8222-222222222222' }
      )
      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'invalid_query' })
      expect(response.headers['Cache-Control']).toBe('private, no-store')
    })

    it('maps missing session to 401 and never creates the service', async () => {
      const response = await callExport({ identity: LINKED_A }, { sessionToken: null })
      expect(response.status).toBe(401)
      expect(response.body).toEqual({ error: 'unauthorized' })
      expect(response.harness.stats.createServiceCalls).toBe(0)
    })
  })
})

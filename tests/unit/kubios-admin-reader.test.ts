import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  KUBIOS_ENCRYPTION_KEY_ENV,
  decryptKubiosSnapshot,
  encryptKubiosSnapshot,
} from '@/lib/kubios-crypto'
import {
  listKubiosAdminMeasurements,
  listKubiosAdminParticipants,
  type KubiosAdminDeps,
} from '@/lib/kubios-admin-reader'
import type { ActiveActor } from '@/server/domain/user'

const TEAM_ID = '11111111-1111-4111-8111-111111111111'
const KEY_B64 = Buffer.alloc(32, 0x5a).toString('base64')
const NOW = new Date('2026-11-09T12:00:00.000Z')
const FRESH_AT = new Date(NOW.getTime() - 60_000).toISOString()
const STALE_AT = new Date(NOW.getTime() - 20 * 60_000).toISOString()

const ADMIN: ActiveActor = {
  userId: '1',
  username: 'admin',
  role: 'admin',
}

function memberId(userId: number): string {
  return `00000000-0000-4000-8000-${String(userId).padStart(12, '0')}`
}

function bytea(buffer: Buffer): string {
  return `\\x${buffer.toString('hex')}`
}

function envelopeFor(
  results: readonly Record<string, unknown>[],
  teamId: string,
  member: string,
): Record<string, unknown> {
  const payload = encryptKubiosSnapshot(
    JSON.stringify({ results }),
    { teamId, memberId: member },
    { env: { [KUBIOS_ENCRYPTION_KEY_ENV]: KEY_B64 } },
  )
  const envelope = Buffer.from(payload, 'base64')
  return {
    ciphertext: bytea(envelope.subarray(29)),
    nonce: bytea(envelope.subarray(1, 13)),
    tag: bytea(envelope.subarray(13, 29)),
    key_version: 1,
  }
}

interface SnapshotRowOptions {
  readonly userId: number
  readonly username: string
  readonly results: readonly Record<string, unknown>[]
  readonly updatedAt?: string
  readonly teamId?: string
  readonly member?: string
}

function snapshotRow(options: SnapshotRowOptions): Record<string, unknown> {
  const teamId = options.teamId ?? TEAM_ID
  const member = options.member ?? memberId(options.userId)
  return {
    user_id: options.userId,
    username: options.username,
    team_id: teamId,
    member_id: member,
    ...envelopeFor(options.results, teamId, member),
    updated_at: options.updatedAt ?? FRESH_AT,
  }
}

/** Fixture exacta del LEFT JOIN: el vínculo pendiente llega con todo a NULL. */
function pendingRow(userId: number, username: string): Record<string, unknown> {
  return {
    user_id: userId,
    username,
    team_id: null,
    member_id: null,
    ciphertext: null,
    nonce: null,
    tag: null,
    key_version: null,
    updated_at: null,
  }
}

function tamperCiphertext(row: Record<string, unknown>): void {
  const value = row.ciphertext
  if (typeof value !== 'string' || !value.startsWith('\\x')) {
    throw new Error('fixture sin ciphertext')
  }
  const bytes = Buffer.from(value.slice(2), 'hex')
  const last = bytes.length - 1
  bytes.writeUInt8((bytes[last] ?? 0) ^ 0xff, last)
  row.ciphertext = bytea(bytes)
}

function resultRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    measured_timestamp: '2026-11-09T11:00:00.000Z',
    daily_result: 'synthetic-daily',
    result_id: 'raw-result-id',
    result: {
      readiness: 80,
      mean_hr_bpm: 62,
      rmssd_ms: 42.5,
      pns_index: 1.25,
      sns_index: 2.5,
      physiological_age: 35,
      respiratory_rate: 14,
      stress_index: 20,
      artefact_level: 'raw-artefact',
      private_metric: 123,
      freq_domain: {
        HF_power: 1.5,
        LF_power: 2.5,
        VLF_power: 3.5,
        tot_power: 7.5,
        private_frequency: 999,
      },
    },
    ...overrides,
  }
}

function series(count: number): Record<string, unknown>[] {
  const base = Date.parse('2026-11-09T11:00:00.000Z')
  return Array.from({ length: count }, (_, index) =>
    resultRow({
      measured_timestamp: new Date(base - index * 60_000).toISOString(),
      result: {
        readiness: 100 - index,
        mean_hr_bpm: 60 + index,
        rmssd_ms: 40 + index,
        freq_domain: {
          HF_power: 1 + index,
          LF_power: 2 + index,
          VLF_power: 3 + index,
          tot_power: 6 + index,
        },
      },
    }),
  )
}

type RpcHandler = (
  name: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>

function createDeps(handler: RpcHandler): {
  deps: KubiosAdminDeps
  rpc: ReturnType<typeof vi.fn>
  createService: ReturnType<typeof vi.fn>
} {
  const rpc = vi.fn(async (name: string, args: Readonly<Record<string, unknown>>) =>
    handler(name, args),
  )
  const createService = vi.fn(() => ({ rpc }))
  const deps: KubiosAdminDeps = {
    createService,
    decryptSnapshot: decryptKubiosSnapshot,
    cryptoEnv: { [KUBIOS_ENCRYPTION_KEY_ENV]: KEY_B64 },
    now: () => NOW,
  }
  return { deps, rpc, createService }
}

function adminUrl(path: string, query: Record<string, string> = {}): string {
  const url = new URL(`https://dashboard.invalid${path}`)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function participantsHandler(
  rows: readonly Record<string, unknown>[],
): RpcHandler {
  return async (name, args) => {
    expect(name).toBe('kubios_admin_list_participants')
    const after = args.p_after_user_id
    const limit = typeof args.p_limit === 'number' ? args.p_limit : 100
    const filtered = rows
      .filter((row) =>
        typeof after === 'number'
          ? Number(row.user_id) > after
          : true,
      )
      .slice(0, limit)
    return { data: filtered }
  }
}

function snapshotsHandler(
  rows: readonly Record<string, unknown>[],
): RpcHandler {
  return async (name, args) => {
    expect(name).toBe('kubios_admin_list_snapshots')
    const requestedUserId = args.p_user_id
    const startUserId = args.p_start_user_id
    const limit = typeof args.p_limit === 'number' ? args.p_limit : 16
    const filtered = rows
      .filter((row) =>
        typeof requestedUserId === 'number'
          ? row.user_id === requestedUserId
          : true,
      )
      .filter((row) =>
        typeof startUserId === 'number'
          ? Number(row.user_id) >= startUserId
          : true,
      )
      .sort((left, right) => Number(left.user_id) - Number(right.user_id))
      .slice(0, limit)
    return { data: filtered }
  }
}

async function expectFailure(
  promise: Promise<unknown>,
  statusCode: number,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ statusCode, code })
}

describe('AK-02 administrative Kubios reader', () => {
  it('rejects doctor and user actors before creating the service', async () => {
    for (const role of ['doctor', 'user'] as const) {
      const createService = vi.fn(() => ({ rpc: vi.fn() }))
      const deps: KubiosAdminDeps = {
        createService,
        decryptSnapshot: vi.fn(),
        cryptoEnv: {},
        now: () => NOW,
      }
      const actor: ActiveActor = { userId: '2', username: role, role }

      await expectFailure(
        listKubiosAdminParticipants(
          { actor, url: adminUrl('/api/admin/kubios/participants') },
          deps,
        ),
        403,
        'FORBIDDEN',
      )
      await expectFailure(
        listKubiosAdminMeasurements(
          { actor, url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }) },
          deps,
        ),
        403,
        'FORBIDDEN',
      )
      expect(createService).not.toHaveBeenCalled()
    }
  })

  it('lists participants with only userId and username', async () => {
    const rows = [
      { user_id: 1, username: 'alpha', team_id: 'hidden' },
      { user_id: 2, username: 'beta' },
    ]
    const { deps, rpc } = createDeps(participantsHandler(rows))

    const body = await listKubiosAdminParticipants(
      { actor: ADMIN, url: adminUrl('/api/admin/kubios/participants') },
      deps,
    )

    expect(body).toEqual({
      participants: [
        { userId: 1, username: 'alpha' },
        { userId: 2, username: 'beta' },
      ],
      nextCursor: null,
    })
    expect(JSON.stringify(body)).not.toContain('team_id')
    expect(JSON.stringify(body)).not.toContain('hidden')
    expect(rpc).toHaveBeenCalledWith('kubios_admin_list_participants', {
      p_after_user_id: null,
      p_limit: 100,
    })
  })

  it('pages participants after the exclusive cursor and binds the anchor', async () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      user_id: index + 1,
      username: `user${index + 1}`,
    }))
    const { deps, rpc } = createDeps(participantsHandler(rows))

    const first = await listKubiosAdminParticipants(
      { actor: ADMIN, url: adminUrl('/api/admin/kubios/participants') },
      deps,
    )
    expect(first.participants).toHaveLength(100)
    expect(first.participants[0]).toEqual({ userId: 1, username: 'user1' })
    expect(first.participants[99]).toEqual({ userId: 100, username: 'user100' })
    if (first.nextCursor === null) {
      throw new Error('se esperaba nextCursor')
    }

    const second = await listKubiosAdminParticipants(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/participants', {
          cursor: first.nextCursor,
        }),
      },
      deps,
    )

    expect(second.participants).toHaveLength(50)
    expect(second.participants[0]).toEqual({ userId: 101, username: 'user101' })
    expect(second.nextCursor).toBeNull()
    expect(rpc).toHaveBeenCalledWith('kubios_admin_list_participants', {
      p_after_user_id: 99,
      p_limit: 1,
    })
  })

  it('returns 409 when the participant anchor changed', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      user_id: index + 1,
      username: `user${index + 1}`,
    }))
    const { deps } = createDeps(participantsHandler(rows))
    const first = await listKubiosAdminParticipants(
      { actor: ADMIN, url: adminUrl('/api/admin/kubios/participants') },
      deps,
    )
    if (first.nextCursor === null) {
      throw new Error('se esperaba nextCursor')
    }

    rows[99] = { user_id: 100, username: 'renamed' }
    const changed = createDeps(participantsHandler(rows))

    await expectFailure(
      listKubiosAdminParticipants(
        {
          actor: ADMIN,
          url: adminUrl('/api/admin/kubios/participants', {
            cursor: first.nextCursor,
          }),
        },
        changed.deps,
      ),
      409,
      'CONFLICT',
    )
  })

  it('returns only allowlisted nested metrics and never raw payload', async () => {
    const row = snapshotRow({
      userId: 7,
      username: 'alice',
      results: [resultRow()],
    })
    const { deps } = createDeps(snapshotsHandler([row]))

    const body = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }),
      },
      deps,
    )

    expect(body).toEqual({
      measurements: [
        {
          userId: 7,
          username: 'alice',
          measuredTimestamp: '2026-11-09T11:00:00.000Z',
          metrics: {
            readiness: 80,
            mean_hr_bpm: 62,
            rmssd_ms: 42.5,
            pns_index: 1.25,
            sns_index: 2.5,
            physiological_age: 35,
            respiratory_rate: 14,
            stress_index: 20,
            HF_power: 1.5,
            LF_power: 2.5,
            VLF_power: 3.5,
            tot_power: 7.5,
          },
          syncedAt: FRESH_AT,
          status: 'ready',
        },
      ],
      nextCursor: null,
      status: 'ready',
      unavailableCount: 0,
    })

    const serialized = JSON.stringify(body)
    for (const forbidden of [
      'raw-result-id',
      'synthetic-daily',
      'raw-artefact',
      'private_metric',
      'private_frequency',
      'ciphertext',
      'nonce',
      'team_id',
      'member_id',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('marks a selected snapshot stale by its updated_at', async () => {
    const row = snapshotRow({
      userId: 7,
      username: 'alice',
      results: [resultRow()],
      updatedAt: STALE_AT,
    })
    const { deps } = createDeps(snapshotsHandler([row]))

    const body = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }),
      },
      deps,
    )

    expect(body.status).toBe('stale')
    expect(body.measurements[0]?.status).toBe('stale')
  })

  it('recognizes a linked pending row with every snapshot column null', async () => {
    const { deps } = createDeps(snapshotsHandler([pendingRow(7, 'alice')]))

    const body = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }),
      },
      deps,
    )

    expect(body).toEqual({
      measurements: [],
      nextCursor: null,
      status: 'pending',
      unavailableCount: 0,
    })
  })

  it('returns empty and unlinked scopes without inventing measurements', async () => {
    const empty = snapshotRow({ userId: 7, username: 'alice', results: [] })
    const { deps } = createDeps(snapshotsHandler([empty]))
    const emptyBody = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }),
      },
      deps,
    )
    expect(emptyBody.status).toBe('empty')
    expect(emptyBody.measurements).toEqual([])
    expect(emptyBody.nextCursor).toBeNull()

    const unlinked = createDeps(snapshotsHandler([]))
    const unlinkedBody = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }),
      },
      unlinked.deps,
    )
    expect(unlinkedBody).toEqual({
      measurements: [],
      nextCursor: null,
      status: 'unlinked',
      unavailableCount: 0,
    })
  })

  it('returns 503 when the selected snapshot cannot be decrypted', async () => {
    const row = snapshotRow({
      userId: 7,
      username: 'alice',
      results: [resultRow()],
    })
    tamperCiphertext(row)
    const { deps } = createDeps(snapshotsHandler([row]))

    await expectFailure(
      listKubiosAdminMeasurements(
        {
          actor: ADMIN,
          url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }),
        },
        deps,
      ),
      503,
      'SERVICE_UNAVAILABLE',
    )
  })

  it('returns 409 when a selected cursor sees a revoked link', async () => {
    const row = snapshotRow({
      userId: 7,
      username: 'alice',
      results: series(51),
    })
    const firstDeps = createDeps(snapshotsHandler([row]))
    const first = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }),
      },
      firstDeps.deps,
    )
    expect(first.measurements).toHaveLength(50)
    if (first.nextCursor === null) {
      throw new Error('se esperaba nextCursor')
    }

    const revoked = createDeps(snapshotsHandler([]))
    await expectFailure(
      listKubiosAdminMeasurements(
        {
          actor: ADMIN,
          url: adminUrl('/api/admin/kubios/measurements', {
            userId: '7',
            cursor: first.nextCursor,
          }),
        },
        revoked.deps,
      ),
      409,
      'CONFLICT',
    )
  })

  it('returns 409 when the selected snapshot or link changed', async () => {
    const row = snapshotRow({
      userId: 7,
      username: 'alice',
      results: series(51),
    })
    const { deps } = createDeps(snapshotsHandler([row]))
    const first = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }),
      },
      deps,
    )
    if (first.nextCursor === null) {
      throw new Error('se esperaba nextCursor')
    }

    const changedSnapshot = snapshotRow({
      userId: 7,
      username: 'alice',
      results: series(51),
      updatedAt: new Date(NOW.getTime() - 120_000).toISOString(),
    })
    await expectFailure(
      listKubiosAdminMeasurements(
        {
          actor: ADMIN,
          url: adminUrl('/api/admin/kubios/measurements', {
            userId: '7',
            cursor: first.nextCursor,
          }),
        },
        createDeps(snapshotsHandler([changedSnapshot])).deps,
      ),
      409,
      'CONFLICT',
    )

    const changedLink = snapshotRow({
      userId: 7,
      username: 'alice',
      member: memberId(77),
      results: series(51),
    })
    await expectFailure(
      listKubiosAdminMeasurements(
        {
          actor: ADMIN,
          url: adminUrl('/api/admin/kubios/measurements', {
            userId: '7',
            cursor: first.nextCursor,
          }),
        },
        createDeps(snapshotsHandler([changedLink])).deps,
      ),
      409,
      'CONFLICT',
    )
  })

  it('rejects cursors from another scope or a changed userId', async () => {
    const row = snapshotRow({
      userId: 7,
      username: 'alice',
      results: series(51),
    })
    const { deps } = createDeps(snapshotsHandler([row]))
    const first = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', { userId: '7' }),
      },
      deps,
    )
    if (first.nextCursor === null) {
      throw new Error('se esperaba nextCursor')
    }

    await expectFailure(
      listKubiosAdminMeasurements(
        {
          actor: ADMIN,
          url: adminUrl('/api/admin/kubios/measurements', {
            cursor: first.nextCursor,
          }),
        },
        deps,
      ),
      400,
      'VALIDATION_ERROR',
    )

    await expectFailure(
      listKubiosAdminMeasurements(
        {
          actor: ADMIN,
          url: adminUrl('/api/admin/kubios/measurements', {
            userId: '8',
            cursor: first.nextCursor,
          }),
        },
        deps,
      ),
      400,
      'VALIDATION_ERROR',
    )
  })

  it('pages global results by userId and measured timestamp descending', async () => {
    const user10 = snapshotRow({
      userId: 10,
      username: 'ten',
      results: series(30),
    })
    const user20 = snapshotRow({
      userId: 20,
      username: 'twenty',
      results: series(30),
    })
    const { deps } = createDeps(snapshotsHandler([user20, user10]))

    const first = await listKubiosAdminMeasurements(
      { actor: ADMIN, url: adminUrl('/api/admin/kubios/measurements') },
      deps,
    )

    expect(first.measurements).toHaveLength(50)
    expect(first.status).toBe('ready')
    expect(first.measurements.slice(0, 30).every((row) => row.userId === 10)).toBe(
      true,
    )
    const user20FirstPage = first.measurements.slice(30)
    expect(user20FirstPage.every((row) => row.userId === 20)).toBe(true)
    expect(first.measurements[0]?.metrics.mean_hr_bpm).toBe(60)
    expect(user20FirstPage[0]?.metrics.mean_hr_bpm).toBe(60)
    expect(user20FirstPage[19]?.metrics.mean_hr_bpm).toBe(79)
    if (first.nextCursor === null) {
      throw new Error('se esperaba nextCursor')
    }

    const second = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', {
          cursor: first.nextCursor,
        }),
      },
      deps,
    )

    expect(second.measurements).toHaveLength(10)
    expect(second.measurements.every((row) => row.userId === 20)).toBe(true)
    expect(second.measurements[0]?.metrics.mean_hr_bpm).toBe(80)
    expect(second.measurements[9]?.metrics.mean_hr_bpm).toBe(89)
    expect(second.nextCursor).toBeNull()

    const firstPageKeys = new Set(
      first.measurements.map((row) => `${row.userId}:${row.measuredTimestamp}`),
    )
    for (const row of second.measurements) {
      expect(firstPageKeys.has(`${row.userId}:${row.measuredTimestamp}`)).toBe(
        false,
      )
    }
  })

  it('returns a continuation even when the scanned batch is sparse', async () => {
    const rows: Record<string, unknown>[] = []
    for (let userId = 1; userId <= 8; userId += 1) {
      rows.push(
        snapshotRow({ userId, username: `user${userId}`, results: [] }),
      )
    }
    rows.push(
      snapshotRow({
        userId: 9,
        username: 'user9',
        results: [resultRow()],
      }),
    )
    const { deps } = createDeps(snapshotsHandler(rows))

    const first = await listKubiosAdminMeasurements(
      { actor: ADMIN, url: adminUrl('/api/admin/kubios/measurements') },
      deps,
    )
    expect(first.measurements).toEqual([])
    expect(first.status).toBe('empty')
    expect(first.unavailableCount).toBe(0)
    if (first.nextCursor === null) {
      throw new Error('se esperaba nextCursor con lote disperso')
    }

    const second = await listKubiosAdminMeasurements(
      {
        actor: ADMIN,
        url: adminUrl('/api/admin/kubios/measurements', {
          cursor: first.nextCursor,
        }),
      },
      deps,
    )
    expect(second.measurements).toHaveLength(1)
    expect(second.measurements[0]?.userId).toBe(9)
    expect(second.status).toBe('ready')
    expect(second.nextCursor).toBeNull()
  })

  it('skips corrupt global snapshots and counts them', async () => {
    const healthyFirst = snapshotRow({
      userId: 1,
      username: 'one',
      results: [resultRow()],
    })
    const corrupt = snapshotRow({
      userId: 2,
      username: 'two',
      results: [resultRow()],
    })
    tamperCiphertext(corrupt)
    const healthyLast = snapshotRow({
      userId: 3,
      username: 'three',
      results: [resultRow({ measured_timestamp: '2026-11-09T10:00:00.000Z' })],
    })
    const { deps } = createDeps(
      snapshotsHandler([healthyFirst, corrupt, healthyLast]),
    )

    const body = await listKubiosAdminMeasurements(
      { actor: ADMIN, url: adminUrl('/api/admin/kubios/measurements') },
      deps,
    )

    expect(body.measurements.map((row) => row.userId)).toEqual([1, 3])
    expect(body.unavailableCount).toBe(1)
    expect(body.status).toBe('ready')
    expect(JSON.stringify(body)).not.toContain('ciphertext')
  })

  it('returns 409 when a global cursor snapshot changed', async () => {
    const rows: Record<string, unknown>[] = []
    for (let userId = 1; userId <= 8; userId += 1) {
      rows.push(
        snapshotRow({ userId, username: `user${userId}`, results: [] }),
      )
    }
    rows.push(
      snapshotRow({
        userId: 9,
        username: 'user9',
        results: [resultRow()],
      }),
    )
    const { deps } = createDeps(snapshotsHandler(rows))
    const first = await listKubiosAdminMeasurements(
      { actor: ADMIN, url: adminUrl('/api/admin/kubios/measurements') },
      deps,
    )
    if (first.nextCursor === null) {
      throw new Error('se esperaba nextCursor')
    }

    const changed = rows.slice()
    changed[7] = snapshotRow({
      userId: 8,
      username: 'user8',
      results: [],
      updatedAt: new Date(NOW.getTime() - 180_000).toISOString(),
    })
    await expectFailure(
      listKubiosAdminMeasurements(
        {
          actor: ADMIN,
          url: adminUrl('/api/admin/kubios/measurements', {
            cursor: first.nextCursor,
          }),
        },
        createDeps(snapshotsHandler(changed)).deps,
      ),
      409,
      'CONFLICT',
    )
  })

  it('rejects invalid or ambiguous queries with 400', async () => {
    const { deps } = createDeps(snapshotsHandler([]))

    for (const url of [
      adminUrl('/api/admin/kubios/measurements', { userId: '0' }),
      adminUrl('/api/admin/kubios/measurements', { userId: '-1' }),
      'https://dashboard.invalid/api/admin/kubios/measurements?userId=7&userId=8',
      'https://dashboard.invalid/api/admin/kubios/measurements?unknown=1',
      adminUrl('/api/admin/kubios/measurements', { cursor: 'not-a-cursor' }),
      adminUrl('/api/admin/kubios/participants', { cursor: 'not-a-cursor' }),
    ]) {
      await expectFailure(
        listKubiosAdminMeasurements({ actor: ADMIN, url }, deps),
        400,
        'VALIDATION_ERROR',
      )
    }
  })
})

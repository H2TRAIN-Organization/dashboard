import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api-client'
import { hasPermission } from '@/lib/permissions'
import {
  buildKubiosHrvResultsQuery,
  classifyKubiosError,
  formatKubiosDate,
  formatKubiosMetric,
  isKubiosPersonalVisible,
  parseKubiosDate,
  parseKubiosHrvResultsResponse,
  parseKubiosMeResponse,
  sortKubiosResults,
  type KubiosLatestResult,
} from '@/lib/kubios-personal'

const readyResult = {
  measured_timestamp: '2026-11-01T08:30:00Z',
  daily_result: 'normal',
  result: {
    readiness: 72,
    mean_hr_bpm: 58,
    rmssd_ms: 44.2,
    pns_index: 1.5,
    freq_domain: { HF_power: 1200, LF_power: 800, tot_power: 2000 },
  },
}

describe('Kubios personal response parsing', () => {
  it('accepts a ready summary and preserves the latest result', () => {
    const parsed = parseKubiosMeResponse({
      status: 'ready',
      measurement_count: 12,
      synced_at: '2026-11-03T10:00:00.000Z',
      latest_result: readyResult,
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.status).toBe('ready')
    expect(parsed?.measurement_count).toBe(12)
    expect(parsed?.synced_at).toBe('2026-11-03T10:00:00.000Z')
    expect(parsed?.latest_result?.measured_timestamp).toBe(
      '2026-11-01T08:30:00Z',
    )
    expect(parsed?.latest_result?.result.readiness).toBe(72)
  })

  it('rejects unknown statuses and invalid measurement counts', () => {
    expect(
      parseKubiosMeResponse({
        status: 'linked',
        measurement_count: 1,
        synced_at: null,
        latest_result: null,
      }),
    ).toBeNull()
    expect(
      parseKubiosMeResponse({
        status: 'ready',
        measurement_count: -1,
        synced_at: null,
        latest_result: null,
      }),
    ).toBeNull()
    expect(
      parseKubiosMeResponse({
        status: 'ready',
        measurement_count: 1.5,
        synced_at: null,
        latest_result: null,
      }),
    ).toBeNull()
  })

  it('keeps missing metrics absent instead of filling zeroes', () => {
    const parsed = parseKubiosHrvResultsResponse({
      status: 'ready',
      synced_at: '2026-11-03T10:00:00.000Z',
      results: [
        {
          measured_timestamp: '2026-11-01T08:30:00Z',
          daily_result: null,
          result: { readiness: 0 },
        },
        {
          measured_timestamp: null,
          daily_result: 'manual',
          result: {},
        },
      ],
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.results).toHaveLength(2)
    expect(parsed?.results[0]?.result.readiness).toBe(0)
    expect(parsed?.results[0]?.result.rmssd_ms).toBeUndefined()
    expect(parsed?.results[1]?.measured_timestamp).toBeNull()
    expect(parsed?.results[1]?.result.mean_hr_bpm).toBeUndefined()
  })

  it('marks malformed results payloads as invalid', () => {
    expect(
      parseKubiosHrvResultsResponse({
        status: 'ready',
        synced_at: null,
        results: 'not-an-array',
      }),
    ).toBeNull()
    expect(
      parseKubiosHrvResultsResponse({
        status: 'ready',
        synced_at: null,
        results: [null],
      }),
    ).toBeNull()
    expect(
      parseKubiosHrvResultsResponse({
        status: 'unknown',
        synced_at: null,
        results: [],
      }),
    ).toBeNull()
  })
})

describe('Kubios date filters and formatting', () => {
  it('builds only from/to ISO date query values', () => {
    expect(buildKubiosHrvResultsQuery({ from: '', to: '' })).toBe('')
    expect(
      buildKubiosHrvResultsQuery({
        from: '2026-11-01',
        to: '2026-11-03',
      }),
    ).toBe('?from=2026-11-01&to=2026-11-03')
    expect(
      buildKubiosHrvResultsQuery({ from: '2026-11-01', to: '' }),
    ).toBe('?from=2026-11-01')
  })

  it('rejects impossible, reversed and non-ISO ranges', () => {
    expect(
      buildKubiosHrvResultsQuery({ from: '2026-02-30', to: '' }),
    ).toBeNull()
    expect(
      buildKubiosHrvResultsQuery({ from: '2026-11-05', to: '2026-11-01' }),
    ).toBeNull()
    expect(
      buildKubiosHrvResultsQuery({ from: '01/11/2026', to: '' }),
    ).toBeNull()
    expect(
      buildKubiosHrvResultsQuery({ from: '2026-11-01T00:00:00Z', to: '' }),
    ).toBeNull()
  })

  it('does not normalize an impossible calendar date', () => {
    expect(parseKubiosDate('2026-02-30')).toBeNull()
    expect(parseKubiosDate('2026-13-01')).toBeNull()
    expect(parseKubiosDate('2026-11-03')).not.toBeNull()
    expect(parseKubiosDate('2026-11-03T09:15:00Z')).not.toBeNull()
  })

  it('formats missing metrics and dates as the provided fallback', () => {
    expect(formatKubiosMetric(null, 1, 'N/D')).toBe('N/D')
    expect(formatKubiosMetric(Number.NaN, 1, 'N/D')).toBe('N/D')
    expect(formatKubiosMetric('12', 1, 'N/D')).toBe('N/D')
    expect(formatKubiosMetric(0, 1, 'N/D')).toBe('0.0')
    expect(formatKubiosMetric(-2.25, 1, 'N/D')).toBe('-2.3')
    expect(formatKubiosDate('not-a-date', 'es', 'N/D')).toBe('N/D')
    expect(formatKubiosDate('2026-11-03', 'es', 'N/D')).not.toBe('N/D')
  })
})

describe('Kubios personal visibility and ordering', () => {
  it('shows the personal section only for ready/stale with measurements', () => {
    expect(isKubiosPersonalVisible('ready', 3)).toBe(true)
    expect(isKubiosPersonalVisible('stale', 1)).toBe(true)
    expect(isKubiosPersonalVisible('ready', 0)).toBe(false)
    expect(isKubiosPersonalVisible('empty', 0)).toBe(false)
    expect(isKubiosPersonalVisible('unlinked', 10)).toBe(false)
    expect(isKubiosPersonalVisible('pending', 10)).toBe(false)
  })

  it('sorts newest first and leaves invalid dates at the end', () => {
    const invalid: KubiosLatestResult = {
      measured_timestamp: null,
      daily_result: null,
      result: {},
    }
    const older: KubiosLatestResult = {
      measured_timestamp: '2026-10-01T08:00:00Z',
      daily_result: null,
      result: {},
    }
    const newer: KubiosLatestResult = {
      measured_timestamp: '2026-11-01T08:00:00Z',
      daily_result: null,
      result: {},
    }

    const sorted = sortKubiosResults([older, invalid, newer])
    expect(sorted).toHaveLength(3)
    expect(sorted[0]).toBe(newer)
    expect(sorted[1]).toBe(older)
    expect(sorted[2]).toBe(invalid)
  })
})

describe('Kubios error classification and permissions', () => {
  it('maps HTTP failures to honest UI states', () => {
    expect(classifyKubiosError(new ApiError(401, 'UNAUTHORIZED', 'x'))).toBe(
      'unauthorized',
    )
    expect(classifyKubiosError(new ApiError(503, 'UNAVAILABLE', 'x'))).toBe(
      'unavailable',
    )
    expect(classifyKubiosError(new ApiError(400, 'INVALID_QUERY', 'x'))).toBe(
      'invalid-query',
    )
    expect(classifyKubiosError(new ApiError(0, 'NETWORK_ERROR', 'x'))).toBe(
      'network',
    )
    expect(classifyKubiosError(new ApiError(0, 'CONTRACT_ERROR', 'x'))).toBe(
      'contract',
    )
  })

  it('gives every role access to own Kubios without widening other user limits', () => {
    expect(hasPermission('user', 'view_own_kubios')).toBe(true)
    expect(hasPermission('doctor', 'view_own_kubios')).toBe(true)
    expect(hasPermission('admin', 'view_own_kubios')).toBe(true)
    expect(hasPermission('user', 'view_kubios')).toBe(false)
    expect(hasPermission('user', 'view_all_data')).toBe(false)
    expect(hasPermission('user', 'manage_users')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  deriveKubiosPersonalView,
  type KubiosMeView,
  type KubiosResultsView,
} from '@/hooks/useKubiosPersonal'
import type { KubiosHrvResults, KubiosMe } from '@/lib/kubios-personal'

const latestResult = {
  measured_timestamp: '2026-11-01T08:30:00Z',
  daily_result: 'normal',
  result: { readiness: 72, mean_hr_bpm: 58 },
}

const meReady: KubiosMe = {
  status: 'ready',
  measurement_count: 2,
  synced_at: '2026-11-03T10:00:00.000Z',
  latest_result: latestResult,
}

const resultsReady: KubiosHrvResults = {
  status: 'ready',
  synced_at: '2026-11-03T10:00:00.000Z',
  results: [
    latestResult,
    {
      measured_timestamp: '2026-10-31T08:30:00Z',
      daily_result: 'normal',
      result: { readiness: 64 },
    },
  ],
}

function meView(data: KubiosMe | null): KubiosMeView {
  return data === null
    ? { phase: 'error', data: null, error: 'unavailable' }
    : { phase: 'data', data, error: null }
}

function resultsView(data: KubiosHrvResults | null): KubiosResultsView {
  return data === null
    ? { phase: 'error', data: null, error: 'unavailable' }
    : { phase: 'data', data, error: null }
}

describe('Kubios personal availability shared by card and page', () => {
  it('uses the results series and the global summary together when ready', () => {
    const view = deriveKubiosPersonalView(
      meView(meReady),
      resultsView(resultsReady),
      false,
    )

    expect(view.phase).toBe('data')
    expect(view.status).toBe('ready')
    expect(view.source).toBe('results')
    expect(view.available).toBe(true)
    expect(view.hasResults).toBe(true)
    expect(view.results).toHaveLength(2)
    expect(view.measurementCount).toBe(2)
    expect(view.latest).toBe(latestResult)
    expect(view.error).toBeNull()
    expect(view.stale).toBe(false)
  })

  it('keeps stale results visible and marks the stale state', () => {
    const view = deriveKubiosPersonalView(
      meView({ ...meReady, status: 'stale' }),
      resultsView({ ...resultsReady, status: 'stale' }),
      false,
    )

    expect(view.phase).toBe('data')
    expect(view.status).toBe('stale')
    expect(view.available).toBe(true)
    expect(view.stale).toBe(true)
    expect(view.results).toHaveLength(2)
    expect(view.error).toBeNull()
  })

  it('presents the cached summary next to a results error', () => {
    const view = deriveKubiosPersonalView(
      meView({ ...meReady, status: 'stale' }),
      resultsView(null),
      false,
    )

    expect(view.phase).toBe('data')
    expect(view.status).toBe('stale')
    expect(view.source).toBe('summary')
    expect(view.available).toBe(true)
    expect(view.hasResults).toBe(false)
    expect(view.results).toHaveLength(0)
    expect(view.measurementCount).toBe(2)
    expect(view.latest).toBe(latestResult)
    expect(view.error).toBe('unavailable')
    expect(view.stale).toBe(true)
  })

  it('uses the summary when the stale series has no rows', () => {
    const view = deriveKubiosPersonalView(
      meView({ ...meReady, status: 'stale' }),
      resultsView({
        status: 'stale',
        synced_at: '2026-11-03T10:00:00.000Z',
        results: [],
      }),
      false,
    )

    expect(view.phase).toBe('data')
    expect(view.status).toBe('stale')
    expect(view.source).toBe('summary')
    expect(view.available).toBe(true)
    expect(view.results).toHaveLength(0)
    expect(view.measurementCount).toBe(2)
    expect(view.latest).toBe(latestResult)
    expect(view.error).toBeNull()
    expect(view.stale).toBe(true)
  })

  it('does not assign global summary metrics to a failed active date filter', () => {
    const view = deriveKubiosPersonalView(meView(meReady), resultsView(null), true)
    expect(view.phase).toBe('error')
    expect(view.available).toBe(false)
    expect(view.measurementCount).toBe(0)
    expect(view.latest).toBeNull()
    expect(view.results).toHaveLength(0)
    expect(view.error).toBe('unavailable')
  })

  it('does not invent a summary for an empty account', () => {
    const empty: KubiosMe = {
      status: 'empty',
      measurement_count: 0,
      synced_at: null,
      latest_result: null,
    }
    const view = deriveKubiosPersonalView(
      meView(empty),
      resultsView({ status: 'empty', synced_at: null, results: [] }),
      false,
    )

    expect(view.phase).toBe('data')
    expect(view.status).toBe('empty')
    expect(view.source).toBe('none')
    expect(view.available).toBe(false)
    expect(view.measurementCount).toBe(0)
    expect(view.latest).toBeNull()
    expect(view.error).toBeNull()
  })

  it('reports the service error when neither endpoint has a summary', () => {
    const view = deriveKubiosPersonalView(
      meView({
        status: 'empty',
        measurement_count: 0,
        synced_at: null,
        latest_result: null,
      }),
      resultsView(null),
      false,
    )

    expect(view.phase).toBe('error')
    expect(view.available).toBe(false)
    expect(view.error).toBe('unavailable')
    expect(view.latest).toBeNull()
  })

  it('keeps the series when only /me fails', () => {
    const view = deriveKubiosPersonalView(
      meView(null),
      resultsView(resultsReady),
      false,
    )

    expect(view.phase).toBe('data')
    expect(view.status).toBe('ready')
    expect(view.source).toBe('results')
    expect(view.available).toBe(true)
    expect(view.results).toHaveLength(2)
    expect(view.error).toBeNull()
  })

  it('uses the filtered series for count and latest when a range is active', () => {
    const view = deriveKubiosPersonalView(
      meView(meReady),
      resultsView({
        status: 'ready',
        synced_at: '2026-11-03T10:00:00.000Z',
        results: [
          {
            measured_timestamp: '2026-10-15T12:00:00Z',
            daily_result: 'normal',
            result: { readiness: 55 },
          },
        ],
      }),
      true,
    )

    expect(view.available).toBe(true)
    expect(view.measurementCount).toBe(1)
    expect(view.latest?.result.readiness).toBe(55)
  })
})

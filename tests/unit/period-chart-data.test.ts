import { describe, expect, it } from 'vitest'
import { periodDurationChartRows } from '@/lib/period-chart-data'

describe('periodDurationChartRows', () => {
  const labelAt = (ms: number) => new Date(ms).toISOString().slice(0, 10)

  it('orders valid periods and counts both start and end dates', () => {
    const rows = periodDurationChartRows(
      [
        { startDate: '2026-02-10T00:00:00.000Z', endDate: '2026-02-14T00:00:00.000Z' },
        { startDate: '2026-01-03T00:00:00.000Z', endDate: '2026-01-03T00:00:00.000Z' },
      ],
      labelAt,
    )

    expect(rows).toEqual([
      { date: '2026-01-03', days: 1 },
      { date: '2026-02-10', days: 5 },
    ])
  })

  it('omits invalid and reversed ranges', () => {
    const rows = periodDurationChartRows(
      [
        { startDate: 'invalid', endDate: '2026-01-02' },
        { startDate: '2026-01-03', endDate: 'invalid' },
        { startDate: '2026-01-04', endDate: '2026-01-03' },
      ],
      labelAt,
    )

    expect(rows).toEqual([])
  })
})

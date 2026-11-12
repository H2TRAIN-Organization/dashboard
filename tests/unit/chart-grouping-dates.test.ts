import { describe, expect, it } from 'vitest'
import {
  countByDate,
  countByField,
  countByLevel,
  dailyChartRows,
  mergeDailyCounts,
  sortByValueDescending,
  type DailyCount,
} from '@/lib/chart-grouping'

const labelAt = (ms: number) => `etiqueta ${ms}`

describe('countByDate', () => {
  it('groups by millisecond and sorts chronologically, not by label', () => {
    const rows = [
      { date_time: '2026-01-03T10:00:00Z' },
      { date_time: '2026-01-01T08:00:00Z' },
      { date_time: '2026-01-02T09:00:00Z' },
    ]
    const grouped = countByDate(
      rows,
      (row) => new Date(row.date_time).getTime(),
      labelAt,
    )

    expect(grouped.map((entry) => entry.ms)).toEqual(
      grouped.map((entry) => entry.ms).sort((a, b) => a - b),
    )
    expect(grouped.map((entry) => entry.count)).toEqual([1, 1, 1])
  })

  it('skips rows with an invalid date instead of crashing or counting them', () => {
    const grouped = countByDate(
      [{ date_time: 'not-a-date' }, { date_time: '2026-01-01T08:00:00Z' }],
      (row) => new Date(row.date_time).getTime(),
      labelAt,
    )
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.count).toBe(1)
  })

  it('aggregates rows sharing the same millisecond', () => {
    const ms = new Date('2026-01-01T08:00:00Z').getTime()
    const grouped = countByDate(
      [{ at: ms }, { at: ms }, { at: ms }],
      (row) => row.at,
      labelAt,
    )
    expect(grouped).toEqual([{ ms, label: labelAt(ms), count: 3 }])
  })
})

describe('mergeDailyCounts', () => {
  it('sums counts of the same day across series and keeps chronology', () => {
    const insulin: DailyCount[] = [
      { ms: 1000, label: 'a', count: 2 },
      { ms: 3000, label: 'c', count: 1 },
    ]
    const meals: DailyCount[] = [
      { ms: 2000, label: 'b', count: 3 },
      { ms: 3000, label: 'c', count: 4 },
    ]

    const merged = mergeDailyCounts([insulin, meals])
    expect(merged.map((entry) => entry.ms)).toEqual([1000, 2000, 3000])
    expect(merged[2]).toEqual({ ms: 3000, label: 'c', count: 5 })
  })

  it('orders by ms even when labels do not parse as dates', () => {
    const merged = mergeDailyCounts([
      [{ ms: 2000, label: '12 nov', count: 1 }],
      [{ ms: 1000, label: '3 nov', count: 2 }],
    ])
    expect(merged.map((entry) => entry.label)).toEqual(['3 nov', '12 nov'])
  })

  it('returns an empty series with no input', () => {
    expect(mergeDailyCounts([])).toEqual([])
  })
})

describe('dailyChartRows', () => {
  it('maps localized labels to the `date` axis key recharts consumes', () => {
    expect(
      dailyChartRows([
        { ms: 1000, label: '3 nov', count: 2 },
        { ms: 2000, label: '12 nov', count: 5 },
      ]),
    ).toEqual([
      { date: '3 nov', count: 2 },
      { date: '12 nov', count: 5 },
    ])
  })

  it('keeps chronology and zero counts untouched', () => {
    expect(dailyChartRows([{ ms: 1000, label: '3 nov', count: 0 }])).toEqual([
      { date: '3 nov', count: 0 },
    ])
  })

  it('returns an empty series with no input', () => {
    expect(dailyChartRows([])).toEqual([])
  })
})

describe('countByField', () => {
  it('counts by field and falls back to the reserve name for empty values', () => {
    const rows = [
      { food_type: 'Cena' },
      { food_type: 'Cena' },
      { food_type: 'Desayuno' },
      { food_type: '' },
    ]
    expect(countByField(rows, (row) => row.food_type, 'Sin datos')).toEqual([
      { name: 'Cena', value: 2 },
      { name: 'Desayuno', value: 1 },
      { name: 'Sin datos', value: 1 },
    ])
  })
})

describe('sortByValueDescending', () => {
  it('returns a new array ordered from highest to lowest value', () => {
    const sorted = sortByValueDescending([
      { name: 'b', value: 1 },
      { name: 'a', value: 3 },
      { name: 'c', value: 2 },
    ])
    expect(sorted.map((entry) => entry.name)).toEqual(['a', 'c', 'b'])
  })
})

describe('countByLevel', () => {
  it('returns every level of the range in order, with zeros included', () => {
    expect(countByLevel([1, 3, 3], 1, 5)).toEqual([
      { level: 1, count: 1 },
      { level: 2, count: 0 },
      { level: 3, count: 2 },
      { level: 4, count: 0 },
      { level: 5, count: 0 },
    ])
  })

  it('covers the full 0-10 ordinal mood scale', () => {
    const levels = countByLevel([10, 0, 5], 0, 10)
    expect(levels).toHaveLength(11)
    expect(levels[0]).toEqual({ level: 0, count: 1 })
    expect(levels[5]).toEqual({ level: 5, count: 1 })
    expect(levels[10]).toEqual({ level: 10, count: 1 })
  })

  it('returns only zeros for an empty series', () => {
    expect(countByLevel([], 0, 2)).toEqual([
      { level: 0, count: 0 },
      { level: 1, count: 0 },
      { level: 2, count: 0 },
    ])
  })
})

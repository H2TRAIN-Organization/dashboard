import { describe, expect, it } from 'vitest'
import {
  averageOfChartKey,
  buildHrvChartRows,
} from '@/lib/hrv-chart-rows'

const es = 'es-ES'

describe('buildHrvChartRows', () => {
  it('builds rows with a short axis label and a long tooltip date', () => {
    const ms = new Date('2026-11-01T08:30:00Z').getTime()
    const rows = buildHrvChartRows(
      [
        {
          time: ms,
          metrics: { readiness: 72, rmssd_ms: 44.2 },
        },
      ],
      es,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.time).toBe(ms)
    expect(rows[0]?.date).toBe(new Date(ms).toLocaleDateString(es, { month: 'short', day: 'numeric' }))
    expect(rows[0]?.dateLong).toBe(
      new Date(ms).toLocaleString(es, { dateStyle: 'long', timeStyle: 'short' }),
    )
  })

  it('keeps missing metrics as gaps instead of zeroes', () => {
    const rows = buildHrvChartRows(
      [{ time: 1000, metrics: { readiness: 60 } }],
      es,
    )
    expect(rows[0]?.readiness).toBe(60)
    expect(rows[0]?.rmssd).toBeNull()
    expect(rows[0]?.pnsIndex).toBeNull()
    expect(rows[0]?.snsIndex).toBeNull()
    expect(rows[0]?.heartRate).toBeNull()
    expect(rows[0]?.hfPower).toBeNull()
    expect(rows[0]?.lfPower).toBeNull()
    expect(rows[0]?.vlfPower).toBeNull()
  })

  it('rejects non-numeric and non-finite metric values', () => {
    const rows = buildHrvChartRows(
      [
        {
          time: 1000,
          metrics: { readiness: 'high', rmssd_ms: Number.NaN, mean_hr_bpm: 58 },
        },
      ],
      es,
    )
    expect(rows[0]?.readiness).toBeNull()
    expect(rows[0]?.rmssd).toBeNull()
    expect(rows[0]?.heartRate).toBe(58)
  })

  it('reads spectral powers from flat metric keys', () => {
    const rows = buildHrvChartRows(
      [
        {
          time: 1000,
          metrics: { HF_power: 1200, LF_power: 800, VLF_power: 400 },
        },
      ],
      es,
    )
    expect(rows[0]?.hfPower).toBe(1200)
    expect(rows[0]?.lfPower).toBe(800)
    expect(rows[0]?.vlfPower).toBe(400)
  })

  it('sorts rows chronologically by millisecond', () => {
    const rows = buildHrvChartRows(
      [
        { time: 3000, metrics: {} },
        { time: 1000, metrics: {} },
        { time: 2000, metrics: {} },
      ],
      es,
    )
    expect(rows.map((row) => row.time)).toEqual([1000, 2000, 3000])
  })
})

describe('averageOfChartKey', () => {
  it('averages only numeric values, ignoring gaps', () => {
    const [first, second, third] = buildHrvChartRows(
      [
        { time: 1000, metrics: { readiness: 60 } },
        { time: 2000, metrics: {} },
        { time: 3000, metrics: { readiness: 80 } },
      ],
      es,
    )
    const rows = [first, second, third].filter(
      (row): row is NonNullable<typeof row> => row !== undefined,
    )
    expect(averageOfChartKey(rows, 'readiness')).toBe(70)
  })

  it('returns null when the series has no numeric values', () => {
    const [first] = buildHrvChartRows([{ time: 1000, metrics: {} }], es)
    expect(first).toBeDefined()
    expect(averageOfChartKey([first as NonNullable<typeof first>], 'rmssd')).toBeNull()
  })

  it('does not average text keys such as the date labels', () => {
    const [first, second] = buildHrvChartRows(
      [
        { time: 1000, metrics: {} },
        { time: 2000, metrics: {} },
      ],
      es,
    )
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    // Los campos de texto nunca llegan aquí por tipado; el acceso se limita a
    // las métricas numéricas de la fila.
    expect(averageOfChartKey([first as NonNullable<typeof first>, second as NonNullable<typeof second>], 'pnsIndex')).toBeNull()
  })
})

export interface PeriodDurationChartRow {
  readonly date: string
  readonly days: number
}

interface PeriodDateRecord {
  readonly startDate?: unknown
  readonly endDate?: unknown
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Prepare valid cycle durations for a chronological chart. End dates are
 * treated as inclusive calendar days; malformed or reversed ranges are
 * omitted rather than represented as zero-length cycles.
 */
export function periodDurationChartRows<T extends PeriodDateRecord>(
  records: readonly T[],
  labelOf: (ms: number) => string,
): PeriodDurationChartRow[] {
  return records
    .flatMap((record) => {
      const startMs = timestamp(record.startDate)
      const endMs = timestamp(record.endDate)
      if (startMs === null || endMs === null || endMs < startMs) return []

      const start = new Date(startMs)
      const end = new Date(endMs)
      const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
      const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())

      return [{ startMs, date: labelOf(startMs), days: (endDay - startDay) / 86_400_000 + 1 }]
    })
    .sort((a, b) => a.startMs - b.startMs)
    .map(({ date, days }) => ({ date, days }))
}

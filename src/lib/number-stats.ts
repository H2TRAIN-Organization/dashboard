/**
 * Tolerant numeric parsing for derived dashboard statistics (MT41).
 *
 * Health records come from several uploaders and may carry empty strings or
 * non-numeric values in numeric fields. A raw `parseFloat` then leaks `NaN`
 * into averages that would otherwise have a coherent value.
 */

/**
 * Parses a finite decimal number or returns `null`. Unlike `parseFloat`,
 * empty, undefined, non-finite and textual values never produce `NaN`.
 */
export function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** `parseFloat` replacement that treats invalid input as zero. */
export function parseFiniteNumberOrZero(value: unknown): number {
  return parseFiniteNumber(value) ?? 0
}

/** Arithmetic mean of finite numbers, or `null` when there is none. */
export function finiteAverage(values: readonly unknown[]): number | null {
  const finite = values
    .map((value) => parseFiniteNumber(value))
    .filter((value): value is number => value !== null)
  if (finite.length === 0) return null

  const sum = finite.reduce((total, value) => total + value, 0)
  return Math.round((sum / finite.length) * 10) / 10
}

/**
 * The newest valid date of a list, or `null` when no value parses. Invalid
 * dates (broken or empty timestamps) are skipped instead of poisoning the
 * maximum with `NaN`.
 */
export function latestValidDate(values: readonly unknown[]): Date | null {
  let latestMs: number | null = null
  for (const value of values) {
    if (!(value instanceof Date)) continue
    const ms = value.getTime()
    if (!Number.isFinite(ms)) continue
    if (latestMs === null || ms > latestMs) latestMs = ms
  }
  return latestMs === null ? null : new Date(latestMs)
}

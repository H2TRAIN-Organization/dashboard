/**
 * Filtros con alcance de un solo gráfico (MT69).
 *
 * Regla de honestidad: un filtro propio solo puede ESTRECHAR la ventana de
 * datos que la página ya tiene cargada; nunca vuelve a pedir datos al
 * servidor ni puede ampliarse más allá de lo cargado. Por eso trabaja sobre
 * las filas crudas en memoria y, con un rango activo, excluye las filas cuya
 * fecha no se puede interpretar: una fila sin fecha no puede demostrar que
 * entra en el rango, y mostrarla sería inventar datos.
 */

/** Ventana de fechas inclusiva en milisegundos. */
export interface ScopedRangeMs {
  readonly fromMs: number
  readonly toMs: number
}

/** Milisegundo de un valor de fecha; `null` cuando no es interpretable. */
export function recordTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime()
  }
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Fecha de un registro de salud: `date_time` o, en su defecto, `startDate`. */
export function healthRecordTimestamp(row: {
  readonly date_time?: unknown
  readonly startDate?: unknown
}): number | null {
  return recordTimestamp(row.date_time) ?? recordTimestamp(row.startDate)
}

/** Comienzo del día local (00:00:00.000) que contiene `nowMs`. */
export function startOfLocalDay(nowMs: number): number {
  const date = new Date(nowMs)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Rango de los últimos `days` días naturales, hoy incluido:
 * desde las 00:00 locales de hace `days - 1` días hasta `nowMs`.
 */
export function lastDaysRange(days: number, nowMs: number): ScopedRangeMs {
  const fromMs = startOfLocalDay(nowMs - (days - 1) * 24 * 60 * 60 * 1000)
  return { fromMs, toMs: nowMs }
}

/**
 * Aplica el rango propio de un gráfico sobre sus filas.
 *
 * Con `range === null` (sin filtro propio) devuelve las mismas filas; con
 * rango activo devuelve las filas cuya fecha cae dentro, excluyendo las que
 * no tienen fecha interpretable.
 */
export function recordsWithinRange<T>(
  records: readonly T[],
  range: ScopedRangeMs | null,
  getTimestamp: (row: T) => number | null,
): T[] {
  if (range === null) return [...records]
  return records.filter((row) => {
    const ms = getTimestamp(row)
    return ms !== null && ms >= range.fromMs && ms <= range.toMs
  })
}

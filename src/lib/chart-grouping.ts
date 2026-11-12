/**
 * Recuento por fecha cronológico: agrupa por milisegundo (orden real), genera
 * la etiqueta localizada al final y descarta las filas con fecha inválida.
 * Ordenar etiquetas ya localizadas no parsea degradando el orden al de
 * inserción, así que la clave siempre es el ms de la fecha (MT38).
 */
export interface DailyCount {
  readonly ms: number
  readonly label: string
  readonly count: number
}

export function countByDate<T>(
  data: readonly T[],
  timeOf: (row: T) => number,
  labelOf: (ms: number) => string,
): DailyCount[] {
  const grouped = new Map<number, { label: string; count: number }>()
  for (const row of data) {
    const ms = timeOf(row)
    if (!Number.isFinite(ms)) continue
    const entry = grouped.get(ms) ?? { label: labelOf(ms), count: 0 }
    entry.count++
    grouped.set(ms, entry)
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, entry]) => ({ ms, label: entry.label, count: entry.count }))
}

/** Fila lista para los gráficos temporales de recharts: eje X = `date`. */
export interface DailyChartRow {
  readonly date: string
  readonly count: number
}

/**
 * Convierte un recuento diario en filas para recharts: los gráficos
 * temporales consumen `date` (etiqueta localizada) y `count`. La conversión
 * vive aquí para que la clave del eje (`date`) coincida siempre con el campo
 * de la fila: una clave que no existe en los datos hace que recharts
 * descarte la serie y dibuje solo el marco del gráfico (T11).
 */
export function dailyChartRows(
  series: readonly DailyCount[],
): DailyChartRow[] {
  return series.map((entry) => ({ date: entry.label, count: entry.count }))
}

/**
 * Fusiona varios recuentos diarios en una sola serie cronológica: agrupa por
 * ms y ordena por ms, nunca por etiqueta localizada.
 */
export function mergeDailyCounts(
  series: ReadonlyArray<readonly DailyCount[]>,
): DailyCount[] {
  const merged = new Map<number, { label: string; count: number }>()
  for (const rows of series) {
    for (const row of rows) {
      const entry = merged.get(row.ms) ?? { label: row.label, count: 0 }
      entry.count += row.count
      merged.set(row.ms, entry)
    }
  }

  return [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, entry]) => ({ ms, label: entry.label, count: entry.count }))
}

export interface NamedValue {
  readonly name: string
  readonly value: number
}

export interface PieSlices {
  /** Nombres principales conservados, ordenados de mayor a menor valor. */
  readonly slices: NamedValue[]
  /** Cola agregada en una sola entrada; null cuando ya caben en los principales. */
  readonly others: NamedValue | null
  /** Nombres agregados en others, ordenados de mayor a menor valor. */
  readonly othersBreakdown: NamedValue[]
}

const byValueDescending = (a: NamedValue, b: NamedValue): number => b.value - a.value

function sumAll(entries: readonly NamedValue[], name: string): NamedValue {
  return { name, value: entries.reduce((total, entry) => total + entry.value, 0) }
}

/**
 * Agrupa los nombres menos representativos de un pie chart en una única
 * entrada "Otros" con el porcentaje/valor sumado, para que el gráfico siga
 * siendo legible cuando hay demasiados tipos. Solo los `topCount` primeros
 * nombres se muestran individualmente; el resto se devuelve en `others`
 * junto con su desglose para poder mostrarlo en un desplegable.
 */
export function aggregatePieTail(
  entries: readonly NamedValue[],
  topCount: number,
  othersName: string,
): PieSlices {
  const sorted = [...entries].sort(byValueDescending)
  const kept = sorted.slice(0, Math.max(0, topCount))
  const tail = sorted.slice(kept.length)
  return {
    slices: kept,
    others: tail.length > 0 ? sumAll(tail, othersName) : null,
    othersBreakdown: tail,
  }
}

/** Porcentaje mínimo (sobre el total, 0-100) para dibujar la etiqueta
 * exterior de un sector: las etiquetas de sectores diminotos se solapan
 * entre sí y no aportan nada. */
export const PIE_LABEL_MIN_PERCENT = 5

/** Decide si un sector del pie chart lleva etiqueta. `percent` es la fracción
 * del total (0-1), igual que en recharts. Los sectores bajo el umbral siguen
 * accesibles por tooltip (y, en el pie de insulina, por el desplegable de
 * "Otros"). */
export function shouldLabelPieSlice(percent: number): boolean {
  return Number.isFinite(percent) && percent * 100 >= PIE_LABEL_MIN_PERCENT
}

/** Texto estándar de la etiqueta de un sector: "Rápida 66%". */
export function pieLabelText(name: string, percent: number): string {
  return `${name} ${(percent * 100).toFixed(0)}%`
}

/**
 * Cuenta registros por valor de un campo de tipo (p. ej. tipo de comida o de
 * insulina). Los campos vacíos caen en el nombre de reserva (`noData`).
 */
export function countByField<T>(
  data: readonly T[],
  fieldOf: (row: T) => string,
  fallbackName: string,
): NamedValue[] {
  const grouped = data.reduce<Record<string, number>>((acc, row) => {
    const type = fieldOf(row) || fallbackName
    acc[type] = (acc[type] ?? 0) + 1
    return acc
  }, {})

  return Object.entries(grouped).map(([name, value]) => ({ name, value }))
}

/** Ordena valores nominales de mayor a menor (anti-patrón 14: barras sin orden). */
export function sortByValueDescending(
  entries: readonly NamedValue[],
): NamedValue[] {
  return [...entries].sort(byValueDescending)
}

export interface LevelCount {
  readonly level: number
  readonly count: number
}

/**
 * Recuento de niveles ordinales completos (p. ej. ánimo 0-10): devuelve todos
 * los niveles del rango en orden, incluso los que cuentan 0, para que la
 * escala del eje sea la real y no la de los valores presentes (anti-patrón 16:
 * usar el gráfico equivocado para la pregunta de distribución).
 */
export function countByLevel(
  levels: readonly number[],
  minLevel: number,
  maxLevel: number,
): LevelCount[] {
  const counts = new Map<number, number>()
  for (const level of levels) {
    counts.set(level, (counts.get(level) ?? 0) + 1)
  }

  const ordered: LevelCount[] = []
  for (let level = minLevel; level <= maxLevel; level++) {
    ordered.push({ level, count: counts.get(level) ?? 0 })
  }
  return ordered
}

export interface DailyDoseSummary {
  readonly date: string
  /** Registros (inyecciones) de ese día. */
  readonly injections: number
  /** Promedio de dosis del día, redondeado a 1 decimal; 0 sin registros válidos. */
  readonly averageDose: number
}

/**
 * Resume dosis por día: nº de registros (inyecciones) y promedio de la dosis
 * administrada (suma de dosis / nº de registros, redondeada a 1 decimal como
 * el resto de promedios del dashboard). Las filas con dosis ausente o no
 * numérica cuentan como dosis 0. El resultado queda ordenado por fecha.
 */
export function summarizeDosesByDate<T>(
  data: readonly T[],
  dateOf: (row: T) => string,
  doseOf: (row: T) => number,
): DailyDoseSummary[] {
  const grouped = new Map<string, { injections: number; total: number }>()
  for (const row of data) {
    const date = dateOf(row)
    const dose = doseOf(row)
    const summary = grouped.get(date) ?? { injections: 0, total: 0 }
    summary.injections += 1
    summary.total += Number.isFinite(dose) ? dose : 0
    grouped.set(date, summary)
  }
  return [...grouped.entries()]
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([date, summary]) => ({
      date,
      injections: summary.injections,
      averageDose: Math.round((summary.total / summary.injections) * 10) / 10,
    }))
}

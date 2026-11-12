/**
 * Filas del gráfico HRV compartidas por la vista personal (/kubios) y la
 * administración (/admin/kubios, MT42). La construcción es pura y está fuera
 * de los componentes para que ambos dibujen con las mismas filas y pueda
 * testearse sin renderizar Recharts.
 */

export interface HrvChartRow {
  /** Milisegundo de la medición (clave cronológica). */
  time: number
  /** Etiqueta corta localizada para el eje X. */
  date: string
  /** Fecha completa localizada (título del tooltip). */
  dateLong: string
  readiness: number | null
  rmssd: number | null
  pnsIndex: number | null
  snsIndex: number | null
  heartRate: number | null
  hfPower: number | null
  lfPower: number | null
  vlfPower: number | null
}

/** Medida ya normalizada para una fila: métricas planas + ms de la fecha. */
export interface HrvMeasurementInput {
  time: number
  metrics: Readonly<Record<string, unknown>>
}

function numericMetric(
  metrics: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const value = metrics[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Construye las filas del gráfico: fecha corta para el eje, fecha completa
 * para el tooltip, métricas ausentes como huecos (`null`, nunca 0) y orden
 * cronológico real por milisegundo. Las filas con fecha inválida no llegan
 * aquí: el llamador las descarta al parsear la fecha.
 */
export function buildHrvChartRows(
  inputs: readonly HrvMeasurementInput[],
  locale: string,
): HrvChartRow[] {
  const rows = inputs.map(({ time, metrics }) => ({
    time,
    date: new Date(time).toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    dateLong: new Date(time).toLocaleString(locale, {
      dateStyle: 'long',
      timeStyle: 'short',
    }),
    readiness: numericMetric(metrics, 'readiness'),
    rmssd: numericMetric(metrics, 'rmssd_ms'),
    pnsIndex: numericMetric(metrics, 'pns_index'),
    snsIndex: numericMetric(metrics, 'sns_index'),
    heartRate: numericMetric(metrics, 'mean_hr_bpm'),
    hfPower: numericMetric(metrics, 'HF_power'),
    lfPower: numericMetric(metrics, 'LF_power'),
    vlfPower: numericMetric(metrics, 'VLF_power'),
  }))

  rows.sort((a, b) => a.time - b.time)
  return rows
}

/**
 * Media de una métrica de la serie, ignorando huecos (`null`) y filas de
 * texto (time/date/dateLong). `null` sin valores numéricos: no se dibuja la
 * línea de referencia.
 */
export function averageOfChartKey(
  rows: readonly HrvChartRow[],
  key: keyof Omit<HrvChartRow, 'time' | 'date' | 'dateLong'>,
): number | null {
  const values: number[] = []
  for (const row of rows) {
    const value = row[key]
    if (value !== null && Number.isFinite(value)) values.push(value)
  }
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

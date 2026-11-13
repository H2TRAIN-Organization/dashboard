/**
 * Tokens de presentación para todos los gráficos del dashboard.
 *
 * Único origen de verdad para la paleta de series, el grid, los ejes y el
 * tooltip: ninguna página/componente debe hardcodear hex de gráficos. La
 * paleta categórica reutiliza los matices ya presentes en la app (Recharts
 * está en dependencias; no se añaden librerías nuevas).
 *
 * Los valores están pensados para fondos claros (las tarjetas del dashboard
 * son blancas/blanco-roto), con contraste verificado para ticks y etiquetas.
 */

/** Color primario de la paleta (primera serie, azul de la app). */
export const CHART_PRIMARY_COLOR = '#3B82F6' // blue-500

/** Paleta categórica de series: ≤8 matices de luminosidad similar. */
export const CHART_SERIES_COLORS = [
  CHART_PRIMARY_COLOR,
  '#10B981', // emerald-500
  '#F59E0B', // amber-500
  '#EF4444', // red-500
  '#8B5CF6', // violet-500
  '#EC4899', // pink-500
  '#06B6D4', // cyan-500
  '#6366F1', // indigo-500
] as const

/** Color reservado para la cola agregada ("Otros") de un pie chart. */
export const CHART_OTHERS_COLOR = '#94A3B8' // slate-400

/**
 * Colores semánticos por métrica HRV, compartidos por la vista personal
 * (HRVCharts) y la vista admin (AdminKubiosCharts). Único lugar donde se
 * decide qué color recibe cada métrica.
 */
export const HRV_METRIC_COLORS = {
  readiness: '#10B981', // emerald-500
  heartRate: '#EF4444', // red-500
  rmssd: CHART_PRIMARY_COLOR,
  pns: '#8B5CF6', // violet-500
  sns: '#F59E0B', // amber-500
  hf: '#06B6D4', // cyan-500
  lf: '#8B5CF6', // violet-500
  vlf: '#F97316', // orange-500
} as const

/** Color de la línea de referencia (media/objetivo) sobre la serie. */
export const CHART_REFERENCE_COLOR = '#334155' // slate-700

/** Color de relleno del degradado de área bajo una línea de serie. */
export const CHART_AREA_FILL = '#8B5CF6'

/** Estilo del grid: claro sobre fondo de tarjeta, sin robar tinta de datos. */
export const CHART_GRID_STROKE = '#E2E8F0' // slate-200
export const CHART_GRID_DASH = '3 3'

/** Ticks y línea de eje: slate-600/400 pasan contraste sobre blanco. */
export const CHART_TICK_STYLE = { fill: '#475569', fontSize: 12 } as const
export const CHART_AXIS_LINE_STYLE = { stroke: '#94A3B8' } as const
export const CHART_TICK_LINE_STYLE = { stroke: '#94A3B8' } as const

/** Estilo de la etiqueta de eje rotada (Y) o inferior (X). */
export const CHART_AXIS_LABEL_STYLE = {
  fill: '#475569',
  fontSize: 12,
  textAnchor: 'middle',
} as const

/** Tooltip claro compartido por todos los gráficos del dashboard. */
export const CHART_TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'rgba(255, 255, 255, 0.97)',
  border: '1px solid rgba(59, 130, 246, 0.3)',
  borderRadius: '12px',
  color: '#1e293b',
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
} as const
export const CHART_TOOLTIP_ITEM_STYLE = { color: '#1e293b' } as const
export const CHART_TOOLTIP_LABEL_STYLE = { color: '#1e293b' } as const

/** Color de la serie `index` (cíclico; la paleta tiene 8 matices). */
export function seriesColor(index: number): string {
  const palette = CHART_SERIES_COLORS
  const offset =
    ((index % palette.length) + palette.length) % palette.length
  return palette[offset] ?? CHART_PRIMARY_COLOR
}

/** Etiqueta de eje Y rotada lista para el prop `label` de Recharts. */
export function yAxisLabel(value: string): {
  value: string
  angle: number
  position: 'insideLeft'
  style: typeof CHART_AXIS_LABEL_STYLE
} {
  return {
    value,
    angle: -90,
    position: 'insideLeft',
    style: { ...CHART_AXIS_LABEL_STYLE },
  }
}

/** Etiqueta de eje X inferior lista para el prop `label` de Recharts. */
export function xAxisLabel(value: string): {
  value: string
  position: 'insideBottom'
  offset: number
  style: typeof CHART_AXIS_LABEL_STYLE
} {
  return {
    value,
    position: 'insideBottom',
    offset: -5,
    style: { ...CHART_AXIS_LABEL_STYLE },
  }
}

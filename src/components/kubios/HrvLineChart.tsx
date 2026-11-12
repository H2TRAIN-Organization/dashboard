'use client'

/**
 * Shared HRV line chart used by the personal view (/kubios) and the admin
 * participant view (/admin/kubios, MT42). Kept separate so both surfaces draw
 * with the same visual language and behavior.
 *
 * The chart itself does not own a `ResponsiveContainer`: both call sites wrap
 * it in `ScrollableChart`, which provides the single measuring container.
 * Nesting two responsive containers collapses the inner one to zero and
 * renders only the empty frame.
 */

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CHART_AXIS_LABEL_STYLE,
  CHART_AXIS_LINE_STYLE,
  CHART_GRID_DASH,
  CHART_GRID_STROKE,
  CHART_TICK_LINE_STYLE,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
} from '@/components/analytics/chart-theme'
import {
  averageOfChartKey,
  type HrvChartRow,
} from '@/lib/hrv-chart-rows'

export type ChartRow = HrvChartRow

export interface ChartLine {
  dataKey: keyof ChartRow
  name: string
  color: string
  dashed?: boolean
  /** Unidad para tooltip y etiqueta de referencia (p. ej. 'ms', 'bpm', '%'). */
  unit?: string
}

interface TooltipPayloadEntry {
  dataKey?: unknown
  name?: unknown
  value?: unknown
  color?: string
  /** Fila de datos original (ChartRow) del punto activo. */
  payload?: { dateLong?: string }
}

interface HrvChartTooltipProps {
  /** Series activas: resuelve la unidad de cada entrada del tooltip. */
  lines?: ChartLine[]
  /** Recharts inyecta estas props al clonar el elemento content. */
  active?: boolean
  payload?: readonly TooltipPayloadEntry[]
}

function formatTooltipValue(value: unknown, unit: string | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return unit === undefined ? `${value}` : `${value} ${unit}`
}

/**
 * Tooltip propio: fecha completa localizada y cada métrica con su unidad. El
 * valor medio no depende del hover: se dibuja como línea de referencia.
 */
function HrvChartTooltip({ lines, active, payload }: HrvChartTooltipProps) {
  if (active !== true || payload === undefined) return null
  const entries = payload.filter(
    (entry) => typeof entry.value === 'number' && Number.isFinite(entry.value),
  )
  if (entries.length === 0) return null
  const dateLong = entries[0]?.payload?.dateLong

  const unitOf = (entry: TooltipPayloadEntry): string | undefined =>
    lines?.find((line) => String(line.dataKey) === String(entry.dataKey))?.unit

  return (
    <div style={CHART_TOOLTIP_CONTENT_STYLE} className="px-3 py-2 text-xs">
      {dateLong !== undefined && (
        <p className="mb-1 font-semibold" style={CHART_TOOLTIP_LABEL_STYLE}>
          {dateLong}
        </p>
      )}
      {entries.map((entry) => (
        <p key={String(entry.dataKey)} style={CHART_TOOLTIP_ITEM_STYLE} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
          <span>{String(entry.name)}</span>
          <span className="font-semibold">
            {formatTooltipValue(entry.value, unitOf(entry))}
          </span>
        </p>
      ))}
    </div>
  )
}

export default function HrvLineChart({
  rows,
  lines,
  yLabel,
  domain,
  width,
  height,
}: {
  rows: ChartRow[]
  lines: ChartLine[]
  yLabel: string
  domain?: [number, number]
  /**
   * Tamaño impuesto por el contenedor: `ScrollableChart` envuelve el gráfico
   * en un único `ResponsiveContainer` que clona al hijo con el ancho y alto
   * reales calculados. Sin ellos `LineChart` no llega a montarse, así que
   * este gráfico solo se usa dentro de `ScrollableChart`.
   */
  width?: number
  height?: number
}) {
  // Con muchas mediciones los puntos fijos se encogen; el punto activo sigue
  // destacándose al pasar el ratón.
  const dotRadius = rows.length > 40 ? 1.5 : 3

  return (
    <LineChart data={rows} width={width} height={height} margin={{ top: 16, right: 24, left: 8, bottom: 32 }}>
      <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
      <XAxis
        dataKey="date"
        tick={CHART_TICK_STYLE}
        axisLine={CHART_AXIS_LINE_STYLE}
        tickLine={CHART_TICK_LINE_STYLE}
      />
      <YAxis
        domain={domain}
        tick={CHART_TICK_STYLE}
        axisLine={CHART_AXIS_LINE_STYLE}
        tickLine={CHART_TICK_LINE_STYLE}
        label={{
          value: yLabel,
          angle: -90,
          position: 'insideLeft',
          style: { ...CHART_AXIS_LABEL_STYLE },
        }}
      />
      <Tooltip
        content={<HrvChartTooltip lines={lines} />}
      />
      <Legend wrapperStyle={{ paddingTop: '12px', fontSize: '13px' }} />
      {lines.map((line) => {
        // Línea de referencia con la media de la serie (huecos excluidos);
        // sin valores numéricos no se dibuja nada extra.
        const average = averageOfChartKey(
          rows,
          line.dataKey as Exclude<keyof ChartRow, 'time' | 'date' | 'dateLong'>,
        )
        if (average === null) return null
        return (
          <ReferenceLine
            key={`reference-${String(line.dataKey)}-${line.name}`}
            y={average}
            stroke={line.color}
            strokeOpacity={0.55}
            strokeDasharray="4 4"
            label={{
              value: `${line.name}: ${average.toFixed(1)}${line.unit ?? ''}`,
              position: 'insideTopRight',
              style: { fill: line.color, fontSize: 10 },
            }}
          />
        )
      })}
      {lines.map((line) => (
        <Line
          key={`${String(line.dataKey)}-${line.name}`}
          type="monotone"
          dataKey={line.dataKey}
          name={line.name}
          stroke={line.color}
          strokeWidth={2.5}
          strokeDasharray={line.dashed ? '6 4' : undefined}
          dot={{ r: dotRadius, strokeWidth: 1 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
      ))}
    </LineChart>
  )
}

'use client'

import { pieLabelText, shouldLabelPieSlice } from '@/lib/chart-grouping'

const RADIAN = Math.PI / 180

export interface PieSliceLabelProps {
  /** Geometría y datos que recharts inyecta al clonar la etiqueta. */
  readonly cx?: number
  readonly cy?: number
  readonly midAngle?: number
  readonly outerRadius?: number
  /** Fracción del total (0-1) que ocupa el sector. */
  readonly percent?: number
  readonly name?: string
  /** Color del sector, que recharts inyecta con la etiqueta. */
  readonly fill?: string
  /** Variante del texto; por defecto "Nombre NN%". */
  readonly format?: (name: string, percent: number) => string
}

/**
 * Etiqueta exterior de un sector del pie chart: solo se dibuja para sectores
 * de al menos PIE_LABEL_MIN_PERCENT, porque las etiquetas de sectores
 * diminotos se solapan entre sí en el borde. Los datos de esos sectores siguen
 * accesibles por el tooltip y, en el pie de insulina, por el desplegable de
 * «Otros».
 */
export default function PieSliceLabel(props: PieSliceLabelProps) {
  const { cx, cy, midAngle, outerRadius, percent } = props
  if (cx === undefined || cy === undefined || midAngle === undefined || outerRadius === undefined || percent === undefined || !shouldLabelPieSlice(percent)) return null
  const sin = Math.sin(-midAngle * RADIAN)
  const cos = Math.cos(-midAngle * RADIAN)
  const radius = outerRadius + 14
  const x = cx + radius * cos
  const y = cy + radius * sin
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor={cos >= 0 ? 'start' : 'end'}
      fill={props.fill ?? '#64748B'}
      fontSize={13}
      fontWeight={600}
    >
      {(props.format ?? pieLabelText)(props.name ?? '', percent)}
    </text>
  )
}

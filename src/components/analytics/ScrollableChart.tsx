'use client'

import { ResponsiveContainer } from 'recharts'

interface ScrollableChartProps {
  children: React.ReactElement
  /** Altura visible del contenedor; el interior se desplaza si necesita más. */
  height: number
  /** Ancho mínimo del interior; el wrapper habilita scroll horizontal cuando lo supera. */
  minInnerWidth?: number
  /** Alto mínimo del interior; el wrapper habilita scroll vertical cuando lo supera. */
  minInnerHeight?: number
}

/**
 * Contenedor de gráficos con scroll en ambos ejes: cuando hay demasiados
 * datos para el espacio visible, el interior crece según `minInnerWidth` /
 * `minInnerHeight` y el wrapper se puede deslizar horizontal y verticalmente.
 */
export default function ScrollableChart({ children, height, minInnerWidth = 0, minInnerHeight = 0 }: ScrollableChartProps) {
  return (
    <div className="overflow-auto rounded-xl border border-slate-100 bg-white/60" style={{ maxHeight: height }}>
      <div style={{ minWidth: minInnerWidth > 0 ? minInnerWidth : undefined, minHeight: minInnerHeight > 0 ? minInnerHeight : undefined }}>
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

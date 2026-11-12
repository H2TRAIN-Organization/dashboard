'use client'

import { sparklinePath, sparklinePoints } from '@/lib/sparkline'

interface ReadinessSparklineProps {
  /** Serie de readiness (con huecos `null`) en orden cronológico. */
  values: ReadonlyArray<number | null>
  /** Color de la línea; por defecto el índigo de la tarjeta resumen. */
  color?: string
  ariaLabel?: string
}

const WIDTH = 220
const HEIGHT = 40

/**
 * Mini-tendencia de readiness para la tarjeta resumen: contexto visual del
 * número grande (anti-patrón "big-number tile without context"), sin hover ni
 * leyenda; el valor exacto está en la propia tarjeta. Accesible por el
 * aria-label y sin saturar: solo la línea y el último punto.
 */
export default function ReadinessSparkline({ values, color = '#4F46E5', ariaLabel }: ReadinessSparklineProps) {
  const points = sparklinePoints(values, WIDTH, HEIGHT)
  if (points.length === 0) return null

  const last = points[points.length - 1]!

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label={ariaLabel}
      className="mt-1"
    >
      <polyline
        points={sparklinePath(points)}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={3} fill={color} />
    </svg>
  )
}

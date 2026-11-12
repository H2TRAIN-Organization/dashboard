/**
 * Geometría de sparklines (mini-series decorativas dentro de tarjetas).
 * Pura y sin dependencias de Recharts: una sparkline es contexto, no un
 * gráfico interactivo, así que se pinta con SVG mínimo.
 */

export interface SparklinePoint {
  readonly x: number
  readonly y: number
}

/**
 * Convierte una serie (con huecos `null`) en puntos de un polígono SVG.
 * Solo los valores numéricos finitos participan; se reparten por orden de
 * aparición de izquierda a derecha con un padding interior. Devuelve vacío si
 * no hay valores válidos y no produce NaN con series de un solo valor
 * (punto centrado verticalmente).
 */
export function sparklinePoints(
  values: readonly (number | null)[],
  width: number,
  height: number,
  padding = 2,
): SparklinePoint[] {
  const valid = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
  if (valid.length === 0 || width <= 0 || height <= 0) return []

  const innerWidth = Math.max(width - padding * 2, 0)
  const innerHeight = Math.max(height - padding * 2, 0)
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const span = max - min

  return valid.map((value, index) => {
    const x =
      valid.length === 1
        ? padding + innerWidth / 2
        : padding + (innerWidth * index) / (valid.length - 1)
    const y =
      span === 0
        ? padding + innerHeight / 2
        : padding + innerHeight - (innerHeight * (value - min)) / span
    return { x, y }
  })
}

/** Ruta SVG ("x,y x,y …") a partir de los puntos calculados. */
export function sparklinePath(points: readonly SparklinePoint[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
}

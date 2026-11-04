/**
 * Reglas de presentación para no anunciar métricas que no existen.
 *
 * Un valor `0`, `false` o una cadena con contenido son datos reales y deben
 * mostrarse; `null`, `undefined`, `NaN` y una cadena vacía significan ausencia
 * de dato y permiten ocultar la tarjeta. La carga y el error se representan
 * fuera de estas funciones para no confundirlos con un vacío legítimo.
 */
export function hasMetricValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

export function countRecords(
  ...collections: ReadonlyArray<readonly unknown[]>
): number {
  return collections.reduce((total, collection) => total + collection.length, 0)
}

export function hasAnyRecords(
  ...collections: ReadonlyArray<readonly unknown[]>
): boolean {
  return collections.some((collection) => collection.length > 0)
}

/**
 * Forma de una fila del snapshot cifrado de Kubios y su normalización a la
 * forma canónica actual: `measured_timestamp` como fecha-hora verificable y
 * `result` como objeto con las métricas anidadas.
 *
 * Los snapshots escritos por sincronizaciones anteriores pueden traer las
 * métricas serializadas como cadena JSON y marcas de tiempo como época
 * numérica. Normalizar cada fila en un único punto evita que la vista
 * personal y la administrativa interpreten el mismo snapshot de forma
 * distinta (marcos sin datos, gráficas vacías) y lo hace comprobable con
 * tests unitarios puros.
 *
 * Este módulo es puro y no usa `server-only`: también lo consume el cliente
 * como defensa en profundidad cuando una respuesta ya serializada contiene
 * una fila con la forma legada.
 */

export type UnknownRecord = Record<string, unknown>

/** Épocas en ms arrancan en ~2001; por debajo se interpretan como segundos. */
const EPOCH_MS_CUTOFF = 1e12

export function isPlainRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Interpreta una cadena como JSON estricto de objeto. Devuelve `null` para
 * cadenas vacías, JSON inválido o JSON que no sea un objeto plano.
 */
export function tryParseJsonObject(text: unknown): UnknownRecord | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0 || !trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isPlainRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Fecha-hora canónica ISO de un valor de marca de tiempo: cadenas que
 * `Date.parse` acepta se redondean a ISO UTC y las épocas numéricas (s o ms)
 * se convierten. Devuelve `null` para cualquier valor no verificable.
 */
export function canonicalTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    if (value.trim().length === 0) return null
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) >= EPOCH_MS_CUTOFF ? value : value * 1000
    return new Date(ms).toISOString()
  }
  return null
}

/**
 * Normaliza una fila del snapshot a la forma canónica sin descartar campos
 * extra: las métricas legadas en cadena JSON se recuperan una vez y la marca
 * de tiempo se rellena desde el alias `timestamp` cuando falta o no es
 * verificable. La fila original no se modifica.
 */
export function normalizeSnapshotRow(row: UnknownRecord): UnknownRecord {
  const normalized: UnknownRecord = { ...row }

  if (typeof normalized.result === 'string') {
    const parsed = tryParseJsonObject(normalized.result)
    if (parsed !== null) normalized.result = parsed
  }

  const measured = canonicalTimestamp(normalized.measured_timestamp)
  if (measured !== null) {
    normalized.measured_timestamp = measured
  } else {
    const alias = canonicalTimestamp(normalized.timestamp)
    if (alias !== null) normalized.measured_timestamp = alias
  }

  return normalized
}

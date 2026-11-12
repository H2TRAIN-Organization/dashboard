import { ApiError, apiRequest } from './api-client'
import { tryParseJsonObject } from './kubios-snapshot-shape'

/**
 * Contrato de presentación del Kubios personal.
 *
 * La identidad del usuario no viaja en la petición: las rutas leen la sesión
 * HttpOnly en el servidor. Estas funciones solo validan y preparan la respuesta
 * para la UI; no leen tokens, almacenamiento ni datos de otros usuarios.
 */

export const KUBIOS_ME_PATH = '/api/kubios/me'
export const KUBIOS_HRV_RESULTS_PATH = '/api/kubios/hrv-results'

export type KubiosStatus = 'unlinked' | 'pending' | 'empty' | 'ready' | 'stale'

export type KubiosErrorKind =
  | 'unauthorized'
  | 'unavailable'
  | 'invalid-query'
  | 'network'
  | 'contract'
  | 'server'
  | 'aborted'

export interface KubiosLatestResult {
  measured_timestamp: string | null
  daily_result: string | null
  result: Record<string, unknown>
}

export interface KubiosMe {
  status: KubiosStatus
  measurement_count: number
  synced_at: string | null
  latest_result: KubiosLatestResult | null
}

export interface KubiosHrvResults {
  status: KubiosStatus
  results: KubiosLatestResult[]
  synced_at: string | null
}

export interface KubiosDateFilter {
  from: string
  to: string
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isKubiosStatus(value: unknown): value is KubiosStatus {
  return (
    value === 'unlinked' ||
    value === 'pending' ||
    value === 'empty' ||
    value === 'ready' ||
    value === 'stale'
  )
}

export function isKubiosDataStatus(value: unknown): value is 'ready' | 'stale' {
  return value === 'ready' || value === 'stale'
}

/**
 * Una cabecera y una navegación pueden mostrarse solo cuando la respuesta
 * propia indica mediciones disponibles. Un `ready` con cero mediciones no se
 * considera visible para no anunciar una sección vacía.
 */
export function isKubiosPersonalVisible(
  status: unknown,
  measurementCount: unknown,
): boolean {
  return (
    isKubiosDataStatus(status) &&
    typeof measurementCount === 'number' &&
    Number.isInteger(measurementCount) &&
    measurementCount > 0
  )
}

function readSyncedAt(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? value : null
}

/**
 * Normaliza una fila a la forma de presentación. Las métricas deben llegar
 * como objeto anidado; un snapshot legado puede traerlas serializadas como
 * cadena JSON, y se recuperan aquí para que ni las tarjetas ni las gráficas
 * queden en "sin datos" con una fila válida. Una cadena que no sea un JSON de
 * objeto no aporta métricas verificables y se trata como ausentes.
 */
function normalizeResultRow(value: unknown): KubiosLatestResult | null {
  if (!isRecord(value)) return null

  const measuredTimestamp =
    typeof value.measured_timestamp === 'string' &&
    value.measured_timestamp.trim().length > 0
      ? value.measured_timestamp
      : null
  const dailyResult =
    typeof value.daily_result === 'string' &&
    value.daily_result.trim().length > 0
      ? value.daily_result
      : null
  const result = isRecord(value.result)
    ? value.result
    : (tryParseJsonObject(value.result) ?? {})

  return {
    measured_timestamp: measuredTimestamp,
    daily_result: dailyResult,
    result,
  }
}

/**
 * Valida la respuesta de GET /api/kubios/me. `latest_result` puede faltar o
 * ser inválido sin invalidar el resumen: se muestra como no disponible, nunca
 * se rellena con valores de ejemplo.
 */
export function parseKubiosMeResponse(payload: unknown): KubiosMe | null {
  if (!isRecord(payload) || !isKubiosStatus(payload.status)) return null

  const measurementCount = payload.measurement_count
  if (
    typeof measurementCount !== 'number' ||
    !Number.isInteger(measurementCount) ||
    measurementCount < 0
  ) {
    return null
  }

  if (payload.synced_at !== null && payload.synced_at !== undefined) {
    if (typeof payload.synced_at !== 'string') return null
  }

  const latestResult =
    payload.latest_result === null || payload.latest_result === undefined
      ? null
      : normalizeResultRow(payload.latest_result)

  return {
    status: payload.status,
    measurement_count: measurementCount,
    synced_at: readSyncedAt(payload.synced_at),
    latest_result: latestResult,
  }
}

/**
 * Valida la respuesta de GET /api/kubios/hrv-results. Para `ready` y `stale`
 * `results` debe ser un array; cada fila se conserva aunque Kubios omita
 * métricas. Una fila que no sea un objeto invalida la respuesta completa para
 * no presentar datos parciales como si fueran la lista real.
 */
export function parseKubiosHrvResultsResponse(
  payload: unknown,
): KubiosHrvResults | null {
  if (!isRecord(payload) || !isKubiosStatus(payload.status)) return null
  if (!Array.isArray(payload.results)) return null
  if (payload.synced_at !== null && payload.synced_at !== undefined) {
    if (typeof payload.synced_at !== 'string') return null
  }

  const results: KubiosLatestResult[] = []
  for (const item of payload.results) {
    const normalized = normalizeResultRow(item)
    if (normalized === null) return null
    results.push(normalized)
  }

  return {
    status: payload.status,
    results,
    synced_at: readSyncedAt(payload.synced_at),
  }
}

/** Clave estable de un filtro para descartar respuestas de otro rango. */
export function buildKubiosFilterKey(filter: KubiosDateFilter): string {
  return JSON.stringify([filter.from, filter.to])
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?$/
const OFFSET_PATTERN = /^([+-])(\d{2}):?(\d{2})$/

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false

  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/**
 * Parser estricto de fechas de presentación. Acepta `YYYY-MM-DD` o una
 * fecha-hora con zona opcional; valida los componentes antes de construir el
 * `Date` para que `2026-02-30` no se convierta en marzo en silencio. Devuelve
 * `null` para cualquier valor no verificable.
 */
export function parseKubiosDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length === 0) return null

  const dateOnly = DATE_ONLY_PATTERN.exec(text)
  if (dateOnly !== null) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    if (!isRealCalendarDate(year, month, day)) return null

    const date = new Date(0)
    date.setFullYear(year, month - 1, day)
    date.setHours(0, 0, 0, 0)
    return date
  }

  const dateTime = DATE_TIME_PATTERN.exec(text)
  if (dateTime === null) return null

  const year = Number(dateTime[1])
  const month = Number(dateTime[2])
  const day = Number(dateTime[3])
  const hour = Number(dateTime[4])
  const minute = Number(dateTime[5])
  const second = dateTime[6] === undefined ? 0 : Number(dateTime[6])
  const fraction = dateTime[7]
  const zone = dateTime[8]

  if (!isRealCalendarDate(year, month, day)) return null
  if (hour > 23 || minute > 59 || second > 59) return null

  const milliseconds =
    fraction === undefined ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3))

  if (zone === undefined) {
    // Fecha local sin zona: se construye componente a componente y se comprueba
    // que no haya normalización.
    const date = new Date(year, month - 1, day, hour, minute, second, milliseconds)
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute ||
      date.getSeconds() !== second
    ) {
      return null
    }
    return date
  }

  let offsetMinutes = 0
  if (zone !== 'Z') {
    const offset = OFFSET_PATTERN.exec(zone)
    if (offset === null) return null
    const offsetHours = Number(offset[2])
    const offsetMinutesPart = Number(offset[3])
    if (offsetHours > 23 || offsetMinutesPart > 59) return null
    const sign = offset[1] === '-' ? -1 : 1
    offsetMinutes = sign * (offsetHours * 60 + offsetMinutesPart)
  }

  const utc = new Date(0)
  utc.setUTCFullYear(year, month - 1, day)
  utc.setUTCHours(hour, minute, second, milliseconds)
  const date = new Date(utc.getTime() - offsetMinutes * 60_000)

  return Number.isNaN(date.getTime()) ? null : date
}

/** Fecha de filtro aceptada por la query: solo `YYYY-MM-DD` real. */
export function isKubiosDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return DATE_ONLY_PATTERN.test(value) && parseKubiosDate(value) !== null
}

/**
 * Construye la query del contrato (`from`/`to`). Devuelve `null` si alguno de
 * los valores presentes no es una fecha ISO válida o si el rango está
 * invertido. Sin fechas devuelve cadena vacía.
 */
export function buildKubiosHrvResultsQuery(
  filter: KubiosDateFilter,
): string | null {
  const from = filter.from.trim()
  const to = filter.to.trim()

  if (from.length > 0 && !isKubiosDateOnly(from)) return null
  if (to.length > 0 && !isKubiosDateOnly(to)) return null
  if (from.length > 0 && to.length > 0 && from > to) return null

  const params = new URLSearchParams()
  if (from.length > 0) params.set('from', from)
  if (to.length > 0) params.set('to', to)
  const query = params.toString()
  return query.length > 0 ? `?${query}` : ''
}

export function formatKubiosMetric(
  value: unknown,
  digits: number,
  fallback: string,
): string {
  if (!isFiniteNumber(value)) return fallback
  return value.toFixed(digits)
}

export function formatKubiosText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  return text.length > 0 ? text : fallback
}

export function formatKubiosDate(
  value: unknown,
  language: 'es' | 'en',
  fallback: string,
): string {
  const date = parseKubiosDate(value)
  if (date === null) return fallback

  return date.toLocaleDateString(language === 'en' ? 'en-US' : 'es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function resultTime(result: KubiosLatestResult): number | null {
  const date = parseKubiosDate(result.measured_timestamp)
  return date === null ? null : date.getTime()
}

/**
 * Ordena de más reciente a más antiguo sin descartar filas con fecha inválida:
 * esas quedan al final en el orden original. No modifica la entrada.
 */
export function sortKubiosResults(
  results: readonly KubiosLatestResult[],
): KubiosLatestResult[] {
  return results
    .map((result, index) => ({ result, index, time: resultTime(result) }))
    .sort((a, b) => {
      if (a.time === null && b.time === null) return a.index - b.index
      if (a.time === null) return 1
      if (b.time === null) return -1
      return b.time - a.time || a.index - b.index
    })
    .map((entry) => entry.result)
}

export function getKubiosFreqDomain(
  result: KubiosLatestResult,
): Record<string, unknown> | null {
  const freq = result.result.freq_domain
  return isRecord(freq) ? freq : null
}

export async function fetchKubiosMe(
  options: { signal?: AbortSignal } = {},
): Promise<KubiosMe> {
  const raw = await apiRequest<unknown>(KUBIOS_ME_PATH, {
    signal: options.signal,
  })
  const parsed = parseKubiosMeResponse(raw)
  if (parsed === null) {
    throw new ApiError(
      0,
      'CONTRACT_ERROR',
      'La respuesta de Kubios no tiene el formato esperado',
    )
  }
  return parsed
}

export async function fetchKubiosHrvResults(
  filter: KubiosDateFilter,
  options: { signal?: AbortSignal } = {},
): Promise<KubiosHrvResults> {
  const query = buildKubiosHrvResultsQuery(filter)
  if (query === null) {
    throw new ApiError(400, 'INVALID_QUERY', 'El rango de fechas no es válido')
  }

  const raw = await apiRequest<unknown>(`${KUBIOS_HRV_RESULTS_PATH}${query}`, {
    signal: options.signal,
  })
  const parsed = parseKubiosHrvResultsResponse(raw)
  if (parsed === null) {
    throw new ApiError(
      0,
      'CONTRACT_ERROR',
      'La respuesta de Kubios no tiene el formato esperado',
    )
  }
  return parsed
}

export function classifyKubiosError(error: unknown): KubiosErrorKind {
  if (error instanceof Error && error.name === 'AbortError') return 'aborted'
  if (error instanceof ApiError) {
    if (error.status === 401) return 'unauthorized'
    if (error.status === 503) return 'unavailable'
    if (error.status === 400) return 'invalid-query'
    if (error.status === 0) {
      return error.code === 'CONTRACT_ERROR' ? 'contract' : 'network'
    }
    return 'server'
  }
  return 'server'
}

/**
 * Serializador CSV local de los resultados HRV propios (K40).
 *
 * Módulo puro: sin React, sin Next, sin red, sin I/O y sin dependencias.
 * La página construye la descarga con un Blob a partir de este texto; aquí no
 * se accede a la sesión, al almacenamiento ni a ningún servicio externo.
 *
 * El CSV solo incluye las columnas que la página ya muestra. No exporta
 * identificadores de resultado/medida, recuperación, PRC efectivo, felicidad
 * del usuario ni datos de usuario, equipo, correo o token.
 */

/** Cabeceras del CSV propio, en el orden exacto que consume la página. */
export const KUBIOS_CSV_HEADERS = [
  'Fecha',
  'Resultado diario',
  'Readiness (%)',
  'FC media (bpm)',
  'RMSSD (ms)',
  'Índice PNS',
  'Índice SNS',
  'Edad fisiológica (años)',
  'Frecuencia respiratoria (rpm)',
  'Índice de estrés',
  'Nivel de artefactos',
  'HF (ms²)',
  'LF (ms²)',
  'VLF (ms²)',
  'Potencia total (ms²)'
] as const

export type KubiosCsvHeader = (typeof KUBIOS_CSV_HEADERS)[number]

/** Dominio de frecuencia de un resultado HRV; todos los campos son opcionales. */
export interface KubiosCsvFreqDomain {
  HF_power?: number | null
  LF_power?: number | null
  VLF_power?: number | null
  tot_power?: number | null
}

/** Subconjunto mostrado de `HRVResult.result`; tolera campos ausentes o nulos. */
export interface KubiosCsvResult {
  readiness?: number | null
  mean_hr_bpm?: number | null
  rmssd_ms?: number | null
  pns_index?: number | null
  sns_index?: number | null
  physiological_age?: number | null
  respiratory_rate?: number | null
  stress_index?: number | null
  artefact_level?: string | null
  freq_domain?: KubiosCsvFreqDomain | null
}

/**
 * Forma estructural mínima de una fila.
 *
 * Es asignable desde el `HRVResult` de la página: los campos extra del objeto
 * real se ignoran. Deliberadamente no declara result_id, measure_id, recovery,
 * effective_prc ni user_happiness para que no puedan llegar al CSV.
 */
export interface KubiosCsvRow {
  measured_timestamp?: string | null
  daily_result?: string | null
  result?: KubiosCsvResult | null
}

/** Entradas del gating de exportación. */
export interface KubiosCsvExportGate {
  hasAccessToken: boolean
  loading: boolean
  ownerUserId: string | null
  sessionUserId: string | null
  resultCount: number
}

/**
 * Prefijo de fórmula reconocido por hojas de cálculo. Se aplica solo a texto:
 * si tras espacios (incluidos tabs, saltos y NBSP) aparece `=`, `+`, `-` o `@`,
 * la celda se exporta con un apóstrofo inicial para que Excel/Sheets la trate
 * como texto y no la evalúe. Los números negativos no pasan por aquí.
 */
const FORMULA_PREFIX = /^[\s\u00A0]*[=+\-@]/u

const CSV_ROW_TERMINATOR = '\r\n'

function asObject<T extends object>(value: T | null | undefined): T | null {
  return typeof value === 'object' && value !== null ? value : null
}

/**
 * Convierte un número a texto crudo. Solo acepta números finitos reales:
 * `0` se emite como `0`, `-0` como `0`, los negativos conservan su signo y
 * null/undefined/NaN/Infinity/strings quedan como celda vacía.
 */
function formatNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return Object.is(value, -0) ? '0' : String(value)
}

/**
 * Convierte texto a celda. Los valores que no son string quedan vacíos (nunca
 * `[object Object]`). El apóstrofo de neutralización se añade antes del valor
 * original, de modo que también cubre espacios o saltos previos.
 */
function formatText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}

/** Cita la celda solo cuando contiene comilla, coma o salto de línea. */
function escapeCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function formatRow(row: KubiosCsvRow): string {
  const result = asObject(row.result)
  const freqDomain = asObject(result?.freq_domain)

  const cells = [
    formatText(row.measured_timestamp),
    formatText(row.daily_result),
    formatNumber(result?.readiness),
    formatNumber(result?.mean_hr_bpm),
    formatNumber(result?.rmssd_ms),
    formatNumber(result?.pns_index),
    formatNumber(result?.sns_index),
    formatNumber(result?.physiological_age),
    formatNumber(result?.respiratory_rate),
    formatNumber(result?.stress_index),
    formatText(result?.artefact_level),
    formatNumber(freqDomain?.HF_power),
    formatNumber(freqDomain?.LF_power),
    formatNumber(freqDomain?.VLF_power),
    formatNumber(freqDomain?.tot_power)
  ]

  return cells.map(escapeCsvCell).join(',')
}

/**
 * Serializa las filas a CSV (coma, CRLF, UTF-8 sin BOM y sin salto final).
 * Sin filas devuelve cadena vacía. Es determinista y no modifica la entrada.
 */
export function buildKubiosCsv(rows: readonly KubiosCsvRow[]): string {
  if (rows.length === 0) return ''

  const header = KUBIOS_CSV_HEADERS.map(escapeCsvCell).join(',')
  return [header, ...rows.map(formatRow)].join(CSV_ROW_TERMINATOR)
}

/**
 * Nombre de archivo local, sin PII: `kubios-hrv-YYYY-MM-DD.csv`.
 * Usa la fecha local del navegador, no UTC.
 */
export function buildKubiosCsvFilename(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RangeError('buildKubiosCsvFilename requiere una fecha válida')
  }

  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `kubios-hrv-${year}-${month}-${day}.csv`
}

/**
 * Permite exportar solo los resultados de la sesión actual ya cargados.
 *
 * Exige token, ausencia de carga, al menos un resultado y que el dueño de los
 * datos sea el usuario de la sesión. Así se impide construir el CSV con el
 * array de una sesión anterior: durante el cambio de sesión `ownerUserId` deja
 * de coincidir con `sessionUserId` (y la página ya vacía `hrvResults`) hasta
 * que la nueva carga termina.
 */
export function canExportKubiosCsv(gate: KubiosCsvExportGate): boolean {
  const { hasAccessToken, loading, ownerUserId, sessionUserId, resultCount } = gate

  return (
    hasAccessToken === true &&
    loading === false &&
    typeof resultCount === 'number' &&
    Number.isFinite(resultCount) &&
    resultCount > 0 &&
    typeof ownerUserId === 'string' &&
    ownerUserId.length > 0 &&
    ownerUserId === sessionUserId
  )
}

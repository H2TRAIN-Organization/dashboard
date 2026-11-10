import 'server-only'

import { Buffer } from 'node:buffer'

import {
  buildKubiosCsv,
  buildKubiosCsvFilename,
  type KubiosCsvResult,
  type KubiosCsvRow
} from './kubios-csv'

/**
 * K50 - Lógica pura de `GET /api/kubios/me`,
 * `GET /api/kubios/hrv-results` y `GET /api/kubios/export`.
 *
 * Los adaptadores de Next inyectan la resolución de identidad desde la cookie
 * de sesión de producción, la fábrica perezosa del cliente de servicio y el
 * descifrado. Este módulo no lee cookies ni variables de entorno, no crea
 * clientes y no usa APIs de Next. Tampoco registra nada.
 *
 * Contrato común:
 *   * La única entrada de identidad es el token de sesión que el adaptador
 *     extrae de la cookie HttpOnly y que authz verifica recargando el usuario
 *     y sus roles. Se ignoran por completo las cabeceras de autenticación, la
 *     query y los selectores de identidad del cliente. El team/member procede
 *     del vínculo verificado.
 *   * Se llama exactamente a `kubios_get_snapshot` con el team/member
 *     verificado. La tabla privada no se consulta directamente.
 *   * Solo un sobre `{ data: [] }` de la RPC significa `pending`. Cualquier
 *     otro sobre (nulo, primitivo, array, sin `data` propia o con `data` no
 *     array) se responde 503 genérico, sin eco del payload.
 *   * El sobre cifrado se reconstruye en el formato propio de K25
 *     (`[version=1][nonce 12][tag 16][ciphertext]`) y se descifra con el mismo
 *     team/member como contexto autenticado.
 *
 * `me`: 200 con exactamente cuatro claves (`status`, `measurement_count`,
 * `synced_at`, `latest_result`); 401/503 genéricos.
 *
 * `hrv-results`: tras resolver la identidad y validar la query, 200 con
 * exactamente tres claves (`status`, `results`, `synced_at`); 400
 * (`invalid_query`), 401 (`unauthorized`) y 503 (`unavailable`) sin detalle.
 *
 * `export`: solo el CSV propio del snapshot, con serializador seguro (sin IDs
 * ajenos, sin fórmulas), `text/csv`, sin caché. Las respuestas son siempre
 * privadas y sin caché.
 */

const SNAPSHOT_RPC = 'kubios_get_snapshot'
const CACHE_CONTROL_NO_STORE = 'private, no-store'
const STALE_AFTER_MS = 10 * 60 * 1000

const KEY_VERSION = 1
const NONCE_BYTES = 12
const AUTH_TAG_BYTES = 16

const HEX_PATTERN = /^[0-9a-fA-F]+$/
const UPDATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/

/** Identidad con vínculo verificado (misma forma que `KubiosIdentityResult`). */
export interface KubiosMeLinkedIdentity {
  readonly status: 'linked'
  readonly teamId: string
  readonly memberId: string
}

/** Usuario verificado sin vínculo Kubios. */
export interface KubiosMeUnlinkedIdentity {
  readonly status: 'unlinked'
}

export type KubiosMeIdentity = KubiosMeLinkedIdentity | KubiosMeUnlinkedIdentity

/**
 * Cliente de servicio mínimo e inyectable. La respuesta de la RPC es `unknown`
 * a propósito: es un dato no confiable que el lector valida en tiempo de
 * ejecución antes de interpretarlo.
 */
export interface KubiosMeServiceClient {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<unknown>
}

/** Fuente de variables de entorno para el descifrado. */
export type KubiosMeCryptoEnv = Record<string, string | undefined>

/** Contexto autenticado que debe coincidir con el usado al cifrar. */
export interface KubiosMeSnapshotScope {
  readonly teamId: string
  readonly memberId: string
}

/** Opciones del descifrado; la clave la resuelve el módulo de criptografía. */
export interface KubiosMeDecryptOptions {
  readonly env: KubiosMeCryptoEnv
}

export type KubiosMeDecrypt = (
  envelope: string,
  scope: KubiosMeSnapshotScope,
  options: KubiosMeDecryptOptions
) => string

/** Dependencias inyectadas por el adaptador de Next o por las pruebas. */
export interface KubiosMeDeps {
  /** Recibe el token de la cookie de sesión, ya extraído por el adaptador. */
  readonly resolveIdentity: (sessionToken: string | null) => Promise<KubiosMeIdentity>
  readonly createService: () => KubiosMeServiceClient
  readonly decryptSnapshot: KubiosMeDecrypt
  readonly cryptoEnv: KubiosMeCryptoEnv
  readonly now?: () => Date
}

export type KubiosMeStatus = 'unlinked' | 'pending' | 'empty' | 'ready' | 'stale'

/** Cuerpo de éxito: ni una clave más que las cuatro del contrato. */
export interface KubiosMeBody {
  readonly status: KubiosMeStatus
  readonly measurement_count: number
  readonly synced_at: string | null
  readonly latest_result: Record<string, unknown> | null
}

/** Cuerpo de error genérico, sin detalle ni datos de la petición. */
export interface KubiosPrivacyError { readonly code: 'PRIVACY_ACTION_REQUIRED'; readonly message: string }

function privacyResponse() {
  return { status: 403, body: { error: { code: 'PRIVACY_ACTION_REQUIRED' as const, message: 'Debes leer y aceptar la politica de privacidad' } }, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } }
}

export interface KubiosMeErrorBody {
  readonly error: KubiosPrivacyError | 'unauthorized' | 'unavailable'
}

/** Resultado plano que el adaptador convierte en `NextResponse`. */
export interface KubiosMeResult {
  readonly status: number
  readonly body: KubiosMeBody | KubiosMeErrorBody
  readonly headers: Record<string, string>
}

/** Forma mínima de la petición; el adaptador construye solo el token. */
export interface KubiosMeRequestLike {
  readonly sessionToken: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function successResponse(
  status: KubiosMeStatus,
  measurementCount: number,
  syncedAt: string | null,
  latestResult: Record<string, unknown> | null
): KubiosMeResult {
  return {
    status: 200,
    body: {
      status,
      measurement_count: measurementCount,
      synced_at: syncedAt,
      latest_result: latestResult
    },
    headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE }
  }
}

function unauthorizedResponse(): KubiosMeResult {
  return {
    status: 401,
    body: { error: 'unauthorized' },
    headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE }
  }
}

function unavailableResponse(): KubiosMeResult {
  return {
    status: 503,
    body: { error: 'unavailable' },
    headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE }
  }
}

/**
 * Reconoce el error tipado de authz sin importarlo en runtime. El contrato
 * (K18) fija `name === 'KubiosAuthError'` y `status` 401 o 503; cualquier otra
 * excepción se trata como 503.
 */
function authErrorStatus(error: unknown): 401 | 503 | null {
  if (!isRecord(error) || error.name !== 'KubiosAuthError') {
    return null
  }

  if (error.status === 401) return 401
  if (error.status === 503) return 503
  return null
}

/**
 * Convierte el `bytea` que devuelve PostgREST (string hexadecimal con prefijo
 * `\x`) en Buffer. Se rechaza base64, texto plano, longitud impar, contenido no
 * hexadecimal y el valor vacío.
 */
function parseBytea(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !value.startsWith('\\x')) {
    return null
  }

  const hex = value.slice(2)
  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
    return null
  }

  const buffer = Buffer.from(hex, 'hex')
  if (buffer.length !== hex.length / 2) {
    buffer.fill(0)
    return null
  }

  return buffer
}

/**
 * Valida `updated_at` como fecha-hora ISO/Postgres y la normaliza a ISO. La
 * forma completa evita aceptar cadenas numéricas que `Date.parse` interpreta
 * como años.
 */
function parseUpdatedAt(value: unknown): { readonly ms: number; readonly iso: string } | null {
  if (typeof value !== 'string') {
    return null
  }

  const raw = value.trim()
  if (!UPDATED_AT_PATTERN.test(raw)) {
    return null
  }

  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) {
    return null
  }

  return { ms, iso: new Date(ms).toISOString() }
}

interface ValidSnapshotRow {
  readonly envelope: string
  readonly updatedAtMs: number
  readonly syncedAt: string
}

/**
 * Reuse export for the administrative reader. Does not change the personal
 * contract: the same validated envelope and timestamps are exposed.
 */
export type KubiosValidatedSnapshotRow = ValidSnapshotRow

/** Ventana de frescura compartida con el lector personal. */
export const KUBIOS_SNAPSHOT_STALE_AFTER_MS = STALE_AFTER_MS

/**
 * Valida la única fila esperada de `kubios_get_snapshot` y reconstruye el sobre
 * del cifrado. `key_version` debe ser exactamente el número 1 y las longitudes
 * de nonce, tag y ciphertext deben respetar el formato de K25.
 */
function parseSnapshotRow(row: unknown): ValidSnapshotRow | null {
  if (!isRecord(row)) {
    return null
  }

  if (row.key_version !== KEY_VERSION) {
    return null
  }

  const nonce = parseBytea(row.nonce)
  const tag = parseBytea(row.tag)
  const ciphertext = parseBytea(row.ciphertext)
  if (nonce === null || tag === null || ciphertext === null) {
    return null
  }

  if (
    nonce.length !== NONCE_BYTES ||
    tag.length !== AUTH_TAG_BYTES ||
    ciphertext.length < 1
  ) {
    return null
  }

  const updatedAt = parseUpdatedAt(row.updated_at)
  if (updatedAt === null) {
    return null
  }

  const envelope = Buffer.concat([
    Buffer.from([KEY_VERSION]),
    nonce,
    tag,
    ciphertext
  ]).toString('base64')

  return {
    envelope,
    updatedAtMs: updatedAt.ms,
    syncedAt: updatedAt.iso
  }
}

/**
 * Parsea el texto plano descifrado como JSON estricto con forma
 * `{ results: object[] }`. Se descartan los campos extra del objeto raíz.
 */
function parseSnapshotPayload(plaintext: string): Record<string, unknown>[] | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(plaintext)
  } catch {
    return null
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return null
  }

  const results: Record<string, unknown>[] = []
  for (const item of parsed.results) {
    if (!isRecord(item)) {
      return null
    }

    results.push(item)
  }

  return results
}

function readTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }

  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Momento de una medición: `measured_timestamp` y, solo si falta o no es una
 * fecha válida, el alias `timestamp` que usa el servicio de Kubios.
 */
function resultTimestamp(result: Record<string, unknown>): number | null {
  const measured = readTimestamp(result.measured_timestamp)
  if (measured !== null) {
    return measured
  }

  return readTimestamp(result.timestamp)
}

/** Wrapper de reutilización admin; misma validación que el lector personal. */
export function parseKubiosValidatedSnapshotRow(
  row: unknown
): KubiosValidatedSnapshotRow | null {
  return parseSnapshotRow(row)
}

/** Wrapper de reutilización admin; mismo JSON estricto que el lector personal. */
export function parseKubiosSnapshotPayload(
  plaintext: string
): Record<string, unknown>[] | null {
  return parseSnapshotPayload(plaintext)
}

/** Wrapper de reutilización admin; `measured_timestamp` o alias `timestamp`. */
export function readKubiosResultTimestamp(result: Record<string, unknown>): number | null {
  return resultTimestamp(result)
}

/**
 * Elección de `latest_result`:
 *   * Un único resultado es el último sin asumir ningún orden ni timestamp.
 *   * Con varios, se elige el mayor `measured_timestamp` válido (o el alias
 *     `timestamp` cuando el primero falta o es inválido).
 *   * Si ninguno tiene timestamp válido, se devuelve `null`: no se usa la
 *     posición del array como orden implícito. Ante un empate exacto de
 *     timestamps se conserva el primero encontrado, sin inferir más orden.
 */
function selectLatestResult(
  results: readonly Record<string, unknown>[]
): Record<string, unknown> | null {
  if (results.length === 1) {
    return results[0] ?? null
  }

  let latest: Record<string, unknown> | null = null
  let latestMs = Number.NEGATIVE_INFINITY

  for (const result of results) {
    const ms = resultTimestamp(result)
    if (ms === null) {
      continue
    }

    if (ms > latestMs) {
      latestMs = ms
      latest = result
    }
  }

  return latest
}

function currentTimeMs(deps: KubiosMeDeps): number {
  const value = deps.now ? deps.now() : new Date()
  const ms = value instanceof Date ? value.getTime() : Number.NaN
  return Number.isFinite(ms) ? ms : Date.now()
}

function isLinkedIdentity(identity: KubiosMeIdentity): identity is KubiosMeLinkedIdentity {
  return (
    identity.status === 'linked' &&
    isNonEmptyString(identity.teamId) &&
    isNonEmptyString(identity.memberId)
  )
}

/** Sobre RPC ya validado: no hay snapshot todavía o hay una única fila. */
type SnapshotEnvelope =
  | { readonly kind: 'pending' }
  | { readonly kind: 'row'; readonly row: unknown }

/**
 * Valida el sobre de `kubios_get_snapshot` sin confiar en su forma.
 *
 * Solo `{ data: [] }` (propiedad propia `data` con un array vacío) significa
 * `pending`. Se rechaza cualquier otro sobre: respuesta nula, primitiva o
 * array, objeto sin la propiedad propia `data`, `data` que no sea array y
 * `data` con más de una fila. El llamador responde 503 genérico y nunca
 * reutiliza valores del sobre.
 */
function readSnapshotEnvelope(response: unknown): SnapshotEnvelope | null {
  if (!isRecord(response)) {
    return null
  }

  if (response.error !== null && response.error !== undefined) {
    return null
  }

  if (!Object.prototype.hasOwnProperty.call(response, 'data')) {
    return null
  }

  const data = response.data
  if (!Array.isArray(data) || data.length > 1) {
    return null
  }

  return data.length === 0 ? { kind: 'pending' } : { kind: 'row', row: data[0] }
}

/** Resultado de resolver la identidad sin lanzar hacia el adaptador. */
type ResolvedRequestIdentity =
  | { readonly ok: true; readonly identity: KubiosMeIdentity }
  | { readonly ok: false; readonly status: 401 | 403 | 503 }

/**
 * Extrae el token de sesión y resuelve la identidad. Un token ausente o vacío
 * se normaliza a `null`; no se consulta ninguna otra cabecera, cookie o query.
 */
async function resolveRequestIdentity(
  requestLike: KubiosMeRequestLike,
  deps: KubiosMeDeps
): Promise<ResolvedRequestIdentity> {
  const sessionToken =
    typeof requestLike.sessionToken === 'string' && requestLike.sessionToken.length > 0
      ? requestLike.sessionToken
      : null

  try {
    const identity = await deps.resolveIdentity(sessionToken)
    return { ok: true, identity }
  } catch (error) {
    if (isRecord(error) && error.code === 'PRIVACY_ACTION_REQUIRED' && error.statusCode === 403) return { ok: false, status: 403 }
    return { ok: false, status: authErrorStatus(error) === 401 ? 401 : 503 }
  }
}

/** Snapshot propio ya validado, listo para una respuesta pública. */
type LoadedSnapshot =
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'snapshot'
      readonly status: 'empty' | 'ready' | 'stale'
      readonly results: readonly Record<string, unknown>[]
      readonly syncedAt: string
    }
  | { readonly kind: 'unavailable' }

/**
 * Carga y descifra el snapshot del vínculo verificado. El cliente de servicio
 * se crea de forma perezosa y solo después de validar la identidad vinculada.
 */
async function loadLinkedSnapshot(
  identity: KubiosMeLinkedIdentity,
  deps: KubiosMeDeps
): Promise<LoadedSnapshot> {
  try {
    const service = deps.createService()
    const response = await service.rpc(SNAPSHOT_RPC, {
      p_team_id: identity.teamId,
      p_member_id: identity.memberId
    })

    const rpcEnvelope = readSnapshotEnvelope(response)
    if (rpcEnvelope === null) {
      return { kind: 'unavailable' }
    }

    if (rpcEnvelope.kind === 'pending') {
      return { kind: 'pending' }
    }

    const snapshot = parseSnapshotRow(rpcEnvelope.row)
    if (snapshot === null) {
      return { kind: 'unavailable' }
    }

    let plaintext: string
    try {
      plaintext = deps.decryptSnapshot(
        snapshot.envelope,
        { teamId: identity.teamId, memberId: identity.memberId },
        { env: deps.cryptoEnv }
      )
    } catch {
      return { kind: 'unavailable' }
    }

    const results = parseSnapshotPayload(plaintext)
    if (results === null) {
      return { kind: 'unavailable' }
    }

    if (results.length === 0) {
      return {
        kind: 'snapshot',
        status: 'empty',
        results: [],
        syncedAt: snapshot.syncedAt
      }
    }

    const status: 'ready' | 'stale' =
      currentTimeMs(deps) - snapshot.updatedAtMs <= STALE_AFTER_MS ? 'ready' : 'stale'

    return {
      kind: 'snapshot',
      status,
      results,
      syncedAt: snapshot.syncedAt
    }
  } catch {
    return { kind: 'unavailable' }
  }
}

/**
 * Ejecuta la lectura del snapshot propio y devuelve una respuesta plana.
 *
 * @param requestLike Solo contiene el token de la cookie de sesión.
 * @param deps Implementaciones reales inyectadas por el adaptador de Next.
 */
export async function handleKubiosMeRequest(
  requestLike: KubiosMeRequestLike,
  deps: KubiosMeDeps
): Promise<KubiosMeResult> {
  const resolved = await resolveRequestIdentity(requestLike, deps)
  if (!resolved.ok) {
    if (resolved.status === 403) return privacyResponse()
    return resolved.status === 401 ? unauthorizedResponse() : unavailableResponse()
  }

  const identity = resolved.identity
  if (!isRecord(identity) || typeof identity.status !== 'string') {
    return unavailableResponse()
  }

  if (identity.status === 'unlinked') {
    return successResponse('unlinked', 0, null, null)
  }

  if (!isLinkedIdentity(identity)) {
    return unavailableResponse()
  }

  const loaded = await loadLinkedSnapshot(identity, deps)
  if (loaded.kind === 'unavailable') {
    return unavailableResponse()
  }

  if (loaded.kind === 'pending') {
    return successResponse('pending', 0, null, null)
  }

  if (loaded.status === 'empty') {
    return successResponse('empty', 0, loaded.syncedAt, null)
  }

  return successResponse(
    loaded.status,
    loaded.results.length,
    loaded.syncedAt,
    selectLatestResult(loaded.results)
  )
}

/* ------------------------------------------------------------------------- */
/* K20 - GET /api/kubios/hrv-results                                         */
/* ------------------------------------------------------------------------- */

/**
 * Lista blanca de filtros de fecha. `from`/`to` son los nombres canónicos;
 * `from_date`/`to_date` y `start_date`/`end_date` se conservan como alias de
 * compatibilidad. En cada grupo solo puede aparecer un nombre: la ambigüedad
 * se rechaza aunque los valores coincidan. No existe ningún parámetro de
 * identidad (user/team/member) ni de orden.
 */
const HRV_QUERY_KEYS: ReadonlySet<string> = new Set([
  'from',
  'to',
  'start_date',
  'end_date',
  'from_date',
  'to_date'
])

const HRV_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const HRV_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/
const HRV_OFFSET_PATTERN = /^[+-](\d{2}):(\d{2})$/

export type KubiosHrvResultsStatus = 'unlinked' | 'pending' | 'empty' | 'ready' | 'stale'

/** Cliente de servicio mínimo; misma forma que el del contrato K19. */
export type KubiosHrvResultsServiceClient = KubiosMeServiceClient

/** Dependencias inyectadas; misma forma que las del contrato K19. */
export type KubiosHrvResultsDeps = KubiosMeDeps

/** Forma mínima de la petición; el adaptador construye token y URL. */
export interface KubiosHrvResultsRequestLike extends KubiosMeRequestLike {
  readonly url: string
}

/** Cuerpo de éxito: ni una clave más que las tres del contrato K20. */
export interface KubiosHrvResultsBody {
  readonly status: KubiosHrvResultsStatus
  readonly results: readonly Record<string, unknown>[]
  readonly synced_at: string | null
}

/** Cuerpo de error genérico, sin detalle ni datos de la petición. */
export interface KubiosHrvResultsErrorBody {
  readonly error: KubiosPrivacyError | 'unauthorized' | 'unavailable' | 'invalid_query'
}

/** Resultado plano que el adaptador convierte en `NextResponse`. */
export interface KubiosHrvResultsResult {
  readonly status: number
  readonly body: KubiosHrvResultsBody | KubiosHrvResultsErrorBody
  readonly headers: Record<string, string>
}

interface KubiosHrvResultsRange {
  readonly startMs: number | null
  readonly endMs: number | null
}

function hrvResultsSuccess(
  status: KubiosHrvResultsStatus,
  results: readonly Record<string, unknown>[],
  syncedAt: string | null
): KubiosHrvResultsResult {
  return {
    status: 200,
    body: { status, results, synced_at: syncedAt },
    headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE }
  }
}

function hrvResultsError(
  status: 400 | 401 | 503,
  error: 'unauthorized' | 'unavailable' | 'invalid_query'
): KubiosHrvResultsResult {
  return {
    status,
    body: { error },
    headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE }
  }
}

/**
 * Comprueba que año/mes/día forman una fecha real del calendario UTC. Evita
 * que `Date` normalice valores imposibles como 2026-02-30 o 2026-13-01.
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }

  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/** Fecha sola `YYYY-MM-DD`: inicio (00:00:00.000Z) o fin (23:59:59.999Z) del día. */
function parseHrvDateOnly(value: string, endOfDay: boolean): number | null {
  const match = HRV_DATE_ONLY_PATTERN.exec(value)
  if (match === null) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!isRealCalendarDate(year, month, day)) {
    return null
  }

  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  if (endOfDay) {
    date.setUTCHours(23, 59, 59, 999)
  } else {
    date.setUTCHours(0, 0, 0, 0)
  }

  const ms = date.getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Fecha-hora ISO-8601 con zona explícita (`Z` o `±HH:MM`). */
function parseHrvDateTime(value: string): number | null {
  const match = HRV_DATE_TIME_PATTERN.exec(value)
  if (match === null) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hours = Number(match[4])
  const minutes = Number(match[5])
  const seconds = Number(match[6])
  const zone = match[8]
  if (zone === undefined) {
    return null
  }

  if (!isRealCalendarDate(year, month, day)) {
    return null
  }

  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null
  }

  if (zone !== 'Z') {
    const offset = HRV_OFFSET_PATTERN.exec(zone)
    if (offset === null) {
      return null
    }

    const offsetHours = offset[1] === undefined ? Number.NaN : Number(offset[1])
    const offsetMinutes = offset[2] === undefined ? Number.NaN : Number(offset[2])
    if (
      !Number.isFinite(offsetHours) ||
      !Number.isFinite(offsetMinutes) ||
      offsetHours > 23 ||
      offsetMinutes > 59
    ) {
      return null
    }
  }

  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Límite de la query: fecha sola (día completo) o fecha-hora exacta con zona. */
function parseHrvBound(value: string, endOfDay: boolean): number | null {
  if (value.length === 0 || value.trim() !== value) {
    return null
  }

  if (HRV_DATE_ONLY_PATTERN.test(value)) {
    return parseHrvDateOnly(value, endOfDay)
  }

  return parseHrvDateTime(value)
}

/**
 * Valida la query con lista blanca estricta. Devuelve `null` para cualquier
 * entrada inválida: parámetro desconocido, repetido, vacío, alias ambiguo,
 * fecha imposible, fecha-hora sin zona o rango invertido. Nunca expone el
 * valor recibido.
 */
function parseHrvResultsQuery(url: unknown): KubiosHrvResultsRange | null {
  if (typeof url !== 'string') {
    return null
  }

  let params: URLSearchParams
  try {
    params = new URL(url).searchParams
  } catch {
    return null
  }

  for (const key of new Set(params.keys())) {
    if (!HRV_QUERY_KEYS.has(key)) {
      return null
    }

    const values = params.getAll(key)
    const value = values[0]
    if (values.length > 1 || value === undefined || value.length === 0) {
      return null
    }
  }

  const startNames = ['from', 'start_date', 'from_date'] as const
  const endNames = ['to', 'end_date', 'to_date'] as const

  function pickSingle(names: readonly string[]): { present: boolean; value: string | null } {
    const values = names
      .map((name) => params.get(name))
      .filter((value): value is string => value !== null)

    // Canónico y alias son equivalentes: su coexistencia es ambigua aunque el
    // valor coincida.
    if (values.length > 1) {
      return { present: true, value: null }
    }

    return { present: values.length === 1, value: values[0] ?? null }
  }

  const start = pickSingle(startNames)
  const end = pickSingle(endNames)
  if ((start.present && start.value === null) || (end.present && end.value === null)) {
    return null
  }

  const startRaw = start.value
  const endRaw = end.value

  const startMs = startRaw === null ? null : parseHrvBound(startRaw, false)
  const endMs = endRaw === null ? null : parseHrvBound(endRaw, true)

  if ((startRaw !== null && startMs === null) || (endRaw !== null && endMs === null)) {
    return null
  }

  if (startMs !== null && endMs !== null && startMs > endMs) {
    return null
  }

  return { startMs, endMs }
}

/**
 * Filtra por límites inclusivos y ordena por timestamp descendente. Los
 * empates conservan el orden del payload. Sin límites se conservan también las
 * filas sin fecha válida, al final y en orden del payload; con algún límite se
 * excluyen.
 */
function filterHrvResults(
  results: readonly Record<string, unknown>[],
  range: KubiosHrvResultsRange
): Record<string, unknown>[] {
  const startMs = range.startMs
  const endMs = range.endMs
  const hasBounds = startMs !== null || endMs !== null

  const decorated: {
    readonly result: Record<string, unknown>
    readonly index: number
    readonly ms: number | null
  }[] = []

  for (const [index, result] of results.entries()) {
    const ms = resultTimestamp(result)

    if (ms === null) {
      if (hasBounds) {
        continue
      }
    } else {
      if (startMs !== null && ms < startMs) {
        continue
      }

      if (endMs !== null && ms > endMs) {
        continue
      }
    }

    decorated.push({ result, index, ms })
  }

  decorated.sort((left, right) => {
    if (left.ms !== null && right.ms !== null) {
      if (left.ms !== right.ms) {
        return right.ms - left.ms
      }

      return left.index - right.index
    }

    if (left.ms === null && right.ms === null) {
      return left.index - right.index
    }

    return left.ms === null ? 1 : -1
  })

  return decorated.map((entry) => entry.result)
}

/**
 * Ejecuta la lectura del snapshot propio y devuelve una respuesta plana para
 * `GET /api/kubios/hrv-results`.
 *
 * Orden obligatorio: resolver identidad (401/503), validar query (400),
 * responder `unlinked` sin servicio, y solo entonces crear el cliente y llamar
 * a la RPC con los ids verificados.
 *
 * @param requestLike Contiene solo el token de sesión; la URL se usa
 *   exclusivamente para los filtros de fecha.
 * @param deps Implementaciones reales inyectadas por el adaptador de Next.
 */
export async function handleKubiosHrvResultsRequest(
  requestLike: KubiosHrvResultsRequestLike,
  deps: KubiosHrvResultsDeps
): Promise<KubiosHrvResultsResult> {
  const resolved = await resolveRequestIdentity(requestLike, deps)
  if (!resolved.ok) {
    if (resolved.status === 403) return privacyResponse()
    return resolved.status === 401
      ? hrvResultsError(401, 'unauthorized')
      : hrvResultsError(503, 'unavailable')
  }

  const identity = resolved.identity
  if (!isRecord(identity) || typeof identity.status !== 'string') {
    return hrvResultsError(503, 'unavailable')
  }

  const linked = isLinkedIdentity(identity) ? identity : null
  if (identity.status !== 'unlinked' && linked === null) {
    return hrvResultsError(503, 'unavailable')
  }

  const range = parseHrvResultsQuery(requestLike.url)
  if (range === null) {
    return hrvResultsError(400, 'invalid_query')
  }

  if (identity.status === 'unlinked') {
    return hrvResultsSuccess('unlinked', [], null)
  }

  if (linked === null) {
    return hrvResultsError(503, 'unavailable')
  }

  const loaded = await loadLinkedSnapshot(linked, deps)
  if (loaded.kind === 'unavailable') {
    return hrvResultsError(503, 'unavailable')
  }

  if (loaded.kind === 'pending') {
    return hrvResultsSuccess('pending', [], null)
  }

  if (loaded.status === 'empty') {
    return hrvResultsSuccess('empty', [], loaded.syncedAt)
  }

  return hrvResultsSuccess(
    loaded.status,
    filterHrvResults(loaded.results, range),
    loaded.syncedAt
  )
}

/* ------------------------------------------------------------------------- */
/* K50 - GET /api/kubios/export                                                */
/* ------------------------------------------------------------------------- */

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
const CSV_HEADERS_BASE: Readonly<Record<string, string>> = {
  'Cache-Control': CACHE_CONTROL_NO_STORE,
  'Content-Type': CSV_CONTENT_TYPE,
  'X-Content-Type-Options': 'nosniff'
}

/** Cuerpo de error del export; nunca incluye detalles ni identificadores. */
export interface KubiosExportErrorBody {
  readonly error: KubiosPrivacyError | 'unauthorized' | 'unavailable' | 'invalid_query'
}

/** Resultado plano del export; el adaptador decide texto o JSON. */
export interface KubiosExportResult {
  readonly status: number
  readonly body: string | KubiosExportErrorBody
  readonly headers: Readonly<Record<string, string>>
}

/**
 * Convierte los resultados reales al subconjunto que exporta el serializador.
 * Se leen solo campos conocidos; cualquier ID o dato de usuario se descarta
 * antes de llegar al CSV.
 */
function toCsvRows(results: readonly Record<string, unknown>[]): KubiosCsvRow[] {
  return results.map((row) => ({
    measured_timestamp: typeof row.measured_timestamp === 'string' ? row.measured_timestamp : null,
    daily_result: typeof row.daily_result === 'string' ? row.daily_result : null,
    result: isRecord(row.result) ? (row.result as unknown as KubiosCsvResult) : null
  }))
}

function exportFilename(deps: KubiosMeDeps): string {
  try {
    const now = deps.now ? deps.now() : new Date()
    return buildKubiosCsvFilename(now)
  } catch {
    return 'kubios-hrv.csv'
  }
}

function csvSuccess(rows: readonly KubiosCsvRow[], deps: KubiosMeDeps): KubiosExportResult {
  return {
    status: 200,
    body: buildKubiosCsv(rows),
    headers: {
      ...CSV_HEADERS_BASE,
      'Content-Disposition': `attachment; filename="${exportFilename(deps)}"`
    }
  }
}

function exportError(
  status: 400 | 401 | 503,
  error: KubiosExportErrorBody['error']
): KubiosExportResult {
  return {
    status,
    body: { error },
    headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE }
  }
}

/**
 * Exporta únicamente el snapshot propio a CSV. Mismo orden de autorización que
 * `hrv-results`: identidad (401/503), query de fechas (400), `unlinked` sin
 * servicio y, por último, lectura/descifrado del snapshot vinculado. El CSV se
 * construye con el serializador local: columnas fijas, sin IDs y con
 * neutralización de fórmulas.
 */
export async function handleKubiosExportRequest(
  requestLike: KubiosHrvResultsRequestLike,
  deps: KubiosHrvResultsDeps
): Promise<KubiosExportResult> {
  const resolved = await resolveRequestIdentity(requestLike, deps)
  if (!resolved.ok) {
    if (resolved.status === 403) return privacyResponse()
    return resolved.status === 401
      ? exportError(401, 'unauthorized')
      : exportError(503, 'unavailable')
  }

  const identity = resolved.identity
  if (!isRecord(identity) || typeof identity.status !== 'string') {
    return exportError(503, 'unavailable')
  }

  const linked = isLinkedIdentity(identity) ? identity : null
  if (identity.status !== 'unlinked' && linked === null) {
    return exportError(503, 'unavailable')
  }

  const range = parseHrvResultsQuery(requestLike.url)
  if (range === null) {
    return exportError(400, 'invalid_query')
  }

  if (identity.status === 'unlinked') {
    return csvSuccess([], deps)
  }

  if (linked === null) {
    return exportError(503, 'unavailable')
  }

  const loaded = await loadLinkedSnapshot(linked, deps)
  if (loaded.kind === 'unavailable') {
    return exportError(503, 'unavailable')
  }

  if (loaded.kind === 'pending' || loaded.status === 'empty') {
    return csvSuccess([], deps)
  }

  const filtered = filterHrvResults(loaded.results, range)
  return csvSuccess(toCsvRows(filtered), deps)
}

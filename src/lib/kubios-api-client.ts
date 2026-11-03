import "server-only"

/**
 * Cliente exclusivo de servidor para la API REST de Kubios Cloud.
 *
 * Propiedades de este módulo:
 * - No guarda estado: el `id_token` se recibe en cada llamada y solo viaja en
 *   la cabecera `Authorization`. Nunca se registra, persiste ni se incluye en
 *   URLs, mensajes de error o cuerpos de respuesta.
 * - Solo usa URLs fijas del proveedor. Los identificadores se codifican con
 *   `encodeURIComponent` y la URL construida se verifica antes de usarla.
 * - No decide políticas de sincronización: no reintenta, no reautentica y no
 *   espera tras un `429`. Expone el estado y `Retry-After` para que el
 *   sincronizador decida.
 * - No transforma ni completa datos: devuelve los objetos recibidos tal cual,
 *   sin fabricar métricas ni valores por defecto.
 *
 * Nota de contexto (K05): se observaron 11 miembros con `team_user_id`;
 * 10 respuestas `200` sin resultados y una `401`. No hay un registro de
 * resultado real confirmado, por lo que las estructuras de miembros y
 * resultados son PROVISIONALES y se validan de forma conservadora.
 */

/** Origen fijo del proveedor. No se acepta otro origen en ninguna llamada. */
export const KUBIOS_API_ORIGIN = 'https://analysis.kubioscloud.com'

/** Ruta fija del listado de miembros de un equipo. */
export const KUBIOS_TEAM_MEMBERS_PATH = '/v2/team/team'

/** Ruta fija de resultados HRV de un miembro del equipo. */
export const KUBIOS_RESULTS_PATH = '/v1/result'

/** Ruta fija de la información del usuario autenticado. */
export const KUBIOS_USER_SELF_PATH = '/v1/user/self'

/** Tiempo máximo por defecto de una llamada, en milisegundos. */
export const DEFAULT_KUBIOS_TIMEOUT_MS = 15_000

/** Cota superior admitida para el timeout configurable. */
export const MAX_KUBIOS_TIMEOUT_MS = 120_000

const MAX_IDENTIFIER_LENGTH = 256
const MAX_TOKEN_LENGTH = 16_384
const KUBIOS_USER_AGENT = 'DiabetesTracker 1.0'
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/
// Formatos HTTP-date de RFC 9110 con `GMT` explícito: IMF-fixdate y RFC 850.
const GMT_DATE_PATTERNS: readonly RegExp[] = [
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/
]

// asctime no lleva sufijo de zona: por definición del formato es GMT. Se
// extraen sus componentes para construir el instante en UTC sin depender de la
// zona local del proceso ni de la heurística de `Date.parse`.
const ASCTIME_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/

const MONTH_INDEX: Readonly<Record<string, number>> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/** Endpoint lógico al que pertenece una llamada o un error. */
export type KubiosApiEndpoint = 'team-members' | 'hrv-results' | 'user-self'

/** Códigos de error fijos y estables para el sincronizador. */
export const KUBIOS_API_ERROR_CODES = [
  'invalid_input',
  'timeout',
  'aborted',
  'network_error',
  'invalid_json',
  'invalid_response_shape',
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'http_error'
] as const

export type KubiosApiErrorCode = (typeof KUBIOS_API_ERROR_CODES)[number]

const KUBIOS_ERROR_MESSAGES: Record<KubiosApiErrorCode, string> = {
  invalid_input: 'Entrada no válida para la API de Kubios',
  timeout: 'Tiempo de espera agotado al llamar a la API de Kubios',
  aborted: 'Llamada a la API de Kubios cancelada',
  network_error: 'Error de red al llamar a la API de Kubios',
  invalid_json: 'La API de Kubios devolvió JSON no válido',
  invalid_response_shape: 'La API de Kubios devolvió una estructura no esperada',
  unauthorized: 'La API de Kubios rechazó la autenticación (401)',
  forbidden: 'La API de Kubios denegó el acceso (403)',
  not_found: 'La API de Kubios no encontró el recurso (404)',
  rate_limited: 'La API de Kubios limitó la tasa de peticiones (429)',
  http_error: 'La API de Kubios devolvió un estado HTTP no satisfactorio'
}

export interface KubiosApiErrorInit {
  readonly code: KubiosApiErrorCode
  readonly endpoint: KubiosApiEndpoint
  readonly status?: number | null
  /**
   * Espera observada. `null` significa ausente o no válida; `Infinity` es un
   * overflow explícito de `Retry-After` (véase `parseRetryAfterHeader`).
   */
  readonly retryAfterMs?: number | null
}

/**
 * Error tipado del cliente. `message` es siempre una cadena fija de
 * `KUBIOS_ERROR_MESSAGES`: nunca incluye el token, la URL ni el cuerpo de la
 * respuesta del proveedor.
 *
 * `retryAfterMs` vale `null` si la cabecera falta o no es válida, un número
 * finito si es representable y `Infinity` si el valor desborda: el consumidor
 * debe distinguir ese caso de una cabecera ausente.
 */
export class KubiosApiError extends Error {
  override readonly name = 'KubiosApiError'
  readonly code: KubiosApiErrorCode
  readonly endpoint: KubiosApiEndpoint
  readonly status: number | null
  readonly retryAfterMs: number | null

  constructor(init: KubiosApiErrorInit) {
    super(KUBIOS_ERROR_MESSAGES[init.code])
    this.code = init.code
    this.endpoint = init.endpoint
    this.status = init.status ?? null
    this.retryAfterMs = init.retryAfterMs ?? null
  }
}

/**
 * Miembro del equipo según `GET /v2/team/team/{team_id}?members=yes`.
 *
 * PROVISIONAL: K05 observó `team_user_id` en los 11 miembros, pero el cliente
 * no exige esa propiedad para aceptar la página: un miembro es un objeto plano
 * opaco y `team_user_id` puede faltar o no ser una cadena. La validación de
 * identificadores corresponde al sincronizador (K14), que cuenta esas entradas
 * como fallos sin descartar al resto. El resto de campos se conserva sin
 * interpretarlo; no se normalizan nombres, correos ni métricas.
 */
export interface KubiosTeamMember {
  readonly team_user_id?: unknown
  readonly [key: string]: unknown
}

export interface KubiosTeamMembersPage {
  readonly members: KubiosTeamMember[]
}

/**
 * Equipo devuelto por `GET /v1/user/self`. Solo se exige `team_id` como cadena
 * segura; el resto del objeto se conserva completo y opaco.
 */
export interface KubiosUserSelfTeam {
  readonly team_id: string
  readonly [key: string]: unknown
}

/** Información del usuario autenticado, con los equipos completos. */
export interface KubiosUserSelfPage {
  readonly user: {
    readonly teams: KubiosUserSelfTeam[]
    readonly [key: string]: unknown
  }
}

/**
 * Registro de resultado HRV tal como lo entrega Kubios.
 *
 * El 2026-11-03 se confirmó el contrato con dos resultados autorizados:
 * measured_timestamp y métricas anidadas en result. Se conserva el objeto
 * completo y opaco para admitir métricas opcionales sin fabricarlas; la capa
 * de presentación valida los campos que utiliza.
 */
export type KubiosHrvResult = Record<string, unknown>

export interface KubiosHrvResultsPage {
  readonly results: KubiosHrvResult[]
}

/** Respuesta HTTP mínima que el cliente necesita consumir. */
export interface KubiosHttpResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: {
    get(name: string): string | null
  }
  /**
   * Cuerpo opcional. Solo se usa para descartarlo en respuestas de error; su
   * contenido nunca se lee, se registra ni se expone.
   */
  readonly body?: {
    cancel(reason?: unknown): Promise<void> | void
  } | null
  json(): Promise<unknown>
}

/** Petición que el cliente emite; deliberadamente estrecha y sin cuerpo. */
export interface KubiosApiRequestInit {
  readonly method: 'GET'
  readonly headers: Readonly<Record<string, string>>
  readonly signal: AbortSignal
  readonly redirect: 'error'
  readonly cache: 'no-store'
}

/** `fetch` inyectable para pruebas o para el runtime del servidor. */
export type KubiosApiFetch = (
  url: string,
  init: KubiosApiRequestInit
) => Promise<KubiosHttpResponse>

export interface KubiosRequestOptions {
  /** Implementación de `fetch`. Por defecto, la global del servidor. */
  readonly fetch?: KubiosApiFetch
  /** Timeout finito en milisegundos. Por defecto `DEFAULT_KUBIOS_TIMEOUT_MS`. */
  readonly timeoutMs?: number
  /** Cancelación externa opcional, además del timeout. */
  readonly signal?: AbortSignal
}

function invalidInput(endpoint: KubiosApiEndpoint): KubiosApiError {
  return new KubiosApiError({ code: 'invalid_input', endpoint })
}

function invalidShape(
  endpoint: KubiosApiEndpoint,
  status: number
): KubiosApiError {
  return new KubiosApiError({
    code: 'invalid_response_shape',
    endpoint,
    status
  })
}

function assertIdentifier(
  value: unknown,
  endpoint: KubiosApiEndpoint
): string {
  if (typeof value !== 'string') throw invalidInput(endpoint)
  if (value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) {
    throw invalidInput(endpoint)
  }
  if (value !== value.trim()) throw invalidInput(endpoint)
  if (CONTROL_CHARACTERS.test(value)) throw invalidInput(endpoint)
  return value
}

function assertIdToken(value: unknown, endpoint: KubiosApiEndpoint): string {
  if (typeof value !== 'string') throw invalidInput(endpoint)
  if (value.length === 0 || value.length > MAX_TOKEN_LENGTH) {
    throw invalidInput(endpoint)
  }
  if (value !== value.trim()) throw invalidInput(endpoint)
  if (CONTROL_CHARACTERS.test(value)) throw invalidInput(endpoint)
  return value
}

function resolveFetch(
  candidate: KubiosApiFetch | undefined,
  endpoint: KubiosApiEndpoint
): KubiosApiFetch {
  const implementation =
    candidate ?? (globalThis.fetch as unknown as KubiosApiFetch | undefined)
  if (typeof implementation !== 'function') throw invalidInput(endpoint)
  return implementation
}

function resolveTimeout(
  timeoutMs: number | undefined,
  endpoint: KubiosApiEndpoint
): number {
  if (timeoutMs === undefined) return DEFAULT_KUBIOS_TIMEOUT_MS
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_KUBIOS_TIMEOUT_MS
  ) {
    throw invalidInput(endpoint)
  }
  return Math.floor(timeoutMs)
}

function resolveSignal(
  candidate: AbortSignal | undefined,
  endpoint: KubiosApiEndpoint
): AbortSignal | undefined {
  if (candidate === undefined) return undefined
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.aborted !== 'boolean' ||
    typeof candidate.addEventListener !== 'function' ||
    typeof candidate.removeEventListener !== 'function'
  ) {
    throw invalidInput(endpoint)
  }
  return candidate
}

/**
 * Construye la URL fija del endpoint y verifica que la codificación del
 * identificador no altere origen, ruta ni query.
 */
function buildKubiosUrl(
  endpoint: KubiosApiEndpoint,
  resourceId: string
): string {
  const identifier = assertIdentifier(resourceId, endpoint)
  const encodedId = encodeURIComponent(identifier)
  let pathPrefix: string
  if (endpoint === 'team-members') pathPrefix = KUBIOS_TEAM_MEMBERS_PATH
  else if (endpoint === 'hrv-results') pathPrefix = KUBIOS_RESULTS_PATH
  else throw invalidInput(endpoint)
  const expectedPath = `${pathPrefix}/${encodedId}`
  const expectedSearch = endpoint === 'team-members' ? '?members=yes' : ''
  const url = new URL(`${expectedPath}${expectedSearch}`, KUBIOS_API_ORIGIN)

  if (
    url.origin !== KUBIOS_API_ORIGIN ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== expectedPath ||
    url.search !== expectedSearch
  ) {
    throw invalidInput(endpoint)
  }

  return url.toString()
}

/** Construye y verifica la URL fija de `GET /v1/user/self`. */
function buildKubiosUserSelfUrl(endpoint: KubiosApiEndpoint): string {
  const url = new URL(KUBIOS_USER_SELF_PATH, KUBIOS_API_ORIGIN)
  if (
    url.origin !== KUBIOS_API_ORIGIN ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== KUBIOS_USER_SELF_PATH ||
    url.search !== ''
  ) {
    throw invalidInput(endpoint)
  }
  return url.toString()
}

function readHeader(
  response: KubiosHttpResponse,
  name: string
): string | null {
  try {
    const value = response.headers.get(name)
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/**
 * Descarta el cuerpo de una respuesta de error sin leerlo. Evita retener la
 * conexión cuando el sincronizador recibe muchos 401/429. Un fallo al
 * descartar no altera el error tipado que se devuelve.
 */
async function discardResponseBody(
  response: KubiosHttpResponse
): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // El cuerpo es opaco para el cliente; no se propaga ni se registra.
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  if (month === 1 && isLeapYear(year)) return 29
  return DAYS_IN_MONTH[month] ?? 0
}

/**
 * Convierte una fecha asctime (siempre GMT) a un instante UTC. Devuelve `null`
 * si algún componente está fuera de rango o la fecha no existe en el
 * calendario, sin normalizar por desbordamiento (31 de abril, 29 de febrero en
 * año no bisiesto, hora 24, minuto o segundo 60). El día de la semana es solo
 * una etiqueta del formato y no se usa para rechazar una fecha válida.
 */
function parseAsctimeUtc(value: string): number | null {
  const match = ASCTIME_PATTERN.exec(value)
  if (match === null) return null

  const monthName = match[1]
  if (monthName === undefined) return null
  const month = MONTH_INDEX[monthName]
  if (month === undefined) return null
  const day = Number(match[2])
  const hours = Number(match[3])
  const minutes = Number(match[4])
  const seconds = Number(match[5])
  const year = Number(match[6])

  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hours > 23 || minutes > 59 || seconds > 59) return null

  const timestamp = Date.UTC(year, month, day, hours, minutes, seconds)
  // `Date.UTC` mapea los años 0-99 a 1900-1999 y normaliza el desbordamiento
  // de calendario; la ida y vuelta por campos UTC descarta ambos casos.
  const date = new Date(timestamp)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hours ||
    date.getUTCMinutes() !== minutes ||
    date.getUTCSeconds() !== seconds
  ) {
    return null
  }

  return timestamp
}

/** Milisegundos hasta `timestamp`; `0` si ya pasó e `Infinity` si no cabe. */
function retryDelayFromTimestamp(timestamp: number): number {
  const delay = timestamp - Date.now()
  if (!Number.isSafeInteger(delay)) return Number.POSITIVE_INFINITY
  return Math.max(0, delay)
}

/**
 * Convierte `Retry-After` (segundos o fecha HTTP) en milisegundos.
 *
 * - Cabecera ausente o vacía: `null`.
 * - Formato no válido o fecha asctime imposible: `null` (se trata igual que
 *   ausente; el sincronizador aplica su espera prudente por defecto).
 * - Valor válido y representable: milisegundos finitos, sin ningún tope; una
 *   fecha pasada se normaliza a `0`.
 * - Segundos válidos que no se pueden representar como entero seguro o que
 *   desbordan al multiplicar: `Infinity`. Es un overflow explícito, distinto de
 *   ausente o inválido; el sincronizador lo traduce a una pausa indefinida y
 *   nunca a la espera por defecto.
 *
 * La forma asctime se interpreta explícitamente como UTC/GMT (así lo define
 * RFC 9110), no en la zona local del proceso.
 */
export function parseRetryAfterHeader(
  value: string | null | undefined
): number | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    // Un número de dígitos suficientemente largo desborda a `Infinity`; otros
    // quedan como enteros no seguros. Ambos son overflow: no hay plazo
    // representable que se pueda prometer sin mentir.
    if (!Number.isFinite(seconds) || !Number.isSafeInteger(seconds)) {
      return Number.POSITIVE_INFINITY
    }
    if (seconds > Number.MAX_SAFE_INTEGER / 1000) {
      return Number.POSITIVE_INFINITY
    }
    return seconds * 1000
  }

  // asctime se resuelve aparte, en UTC, sin `Date.parse` y sin aceptar fechas
  // de calendario imposibles que el parser normalizaría en silencio.
  if (ASCTIME_PATTERN.test(trimmed)) {
    const timestamp = parseAsctimeUtc(trimmed)
    return timestamp === null ? null : retryDelayFromTimestamp(timestamp)
  }

  // IMF-fixdate y RFC 850 incluyen `GMT` explícito, así que `Date.parse` no
  // depende de la zona local. Aun así se exige el formato completo porque
  // `Date.parse` es demasiado permisivo con cadenas que no son HTTP-date
  // ("-5", "1.5", "Oct").
  if (!GMT_DATE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return null
  }

  const timestamp = Date.parse(trimmed)
  if (!Number.isFinite(timestamp)) return null
  return retryDelayFromTimestamp(timestamp)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Página de miembros con forma aceptable. Un miembro solo tiene que ser un
 * objeto plano seguro: `team_user_id` puede faltar o no ser una cadena, porque
 * descartar la página entera impediría al sincronizador contar esa entrada como
 * fallo y procesar los identificadores válidos. La comprobación no copia ni
 * normaliza: el array y sus objetos se devuelven con la misma identidad.
 */
function isTeamMembersPageBody(
  value: unknown
): value is { members: KubiosTeamMember[] } {
  if (!isPlainRecord(value) || !Array.isArray(value.members)) return false
  // `for...of` también recorre huecos como `undefined`, a diferencia de
  // `Array.prototype.every`, que los omitiría y dejaría pasar un elemento que
  // no es un objeto seguro.
  for (const member of value.members) {
    if (!isPlainRecord(member)) return false
  }
  return true
}

function parseTeamMembers(
  body: unknown,
  endpoint: KubiosApiEndpoint,
  status: number
): KubiosTeamMembersPage {
  if (!isTeamMembersPageBody(body)) throw invalidShape(endpoint, status)
  return { members: body.members }
}

/**
 * `team_id` de `/v1/user/self`: cadena no vacía, acotada, sin espacios en los
 * extremos y sin caracteres de control. No se exige formato UUID aquí; el
 * sincronizador valida el equipo resuelto antes de usar las RPC `uuid`.
 */
function isUserSelfTeamId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) return false
  if (value !== value.trim()) return false
  return !CONTROL_CHARACTERS.test(value)
}

/**
 * Valida `body.user.teams` como array de objetos planos con `team_id` seguro.
 * Los objetos de equipo se conservan completos y con la misma identidad; una
 * lista vacía es una respuesta válida.
 */
function parseUserSelf(
  body: unknown,
  endpoint: KubiosApiEndpoint,
  status: number
): KubiosUserSelfPage {
  if (!isPlainRecord(body) || !isPlainRecord(body.user)) {
    throw invalidShape(endpoint, status)
  }

  const teams = body.user.teams
  if (!Array.isArray(teams)) throw invalidShape(endpoint, status)

  for (const team of teams) {
    if (!isPlainRecord(team) || !isUserSelfTeamId(team.team_id)) {
      throw invalidShape(endpoint, status)
    }
  }

  return { user: body.user as KubiosUserSelfPage['user'] }
}

function parseHrvResults(
  body: unknown,
  endpoint: KubiosApiEndpoint,
  status: number
): KubiosHrvResultsPage {
  if (!isPlainRecord(body) || !Array.isArray(body.results)) {
    throw invalidShape(endpoint, status)
  }

  const results = body.results
  for (const result of results) {
    if (!isPlainRecord(result)) throw invalidShape(endpoint, status)
  }

  return { results: results as KubiosHrvResult[] }
}

interface KubiosJsonResponse {
  readonly body: unknown
  readonly status: number
}

function transportError(
  timedOut: boolean,
  externalSignal: AbortSignal | undefined,
  endpoint: KubiosApiEndpoint
): KubiosApiError {
  if (timedOut) return new KubiosApiError({ code: 'timeout', endpoint })
  if (externalSignal?.aborted) {
    return new KubiosApiError({ code: 'aborted', endpoint })
  }
  return new KubiosApiError({ code: 'network_error', endpoint })
}

async function requestKubiosJson(
  url: string,
  idToken: string,
  endpoint: KubiosApiEndpoint,
  options: KubiosRequestOptions
): Promise<KubiosJsonResponse> {
  const token = assertIdToken(idToken, endpoint)
  const fetchImpl = resolveFetch(options.fetch, endpoint)
  const timeoutMs = resolveTimeout(options.timeoutMs, endpoint)
  const externalSignal = resolveSignal(options.signal, endpoint)

  if (externalSignal?.aborted) {
    throw new KubiosApiError({ code: 'aborted', endpoint })
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort()

  externalSignal?.addEventListener('abort', abortFromCaller, { once: true })
  // Cierra la carrera entre la comprobación previa y el registro del listener:
  // si la señal ya estaba abortada, el evento no se repetirá.
  if (externalSignal?.aborted) controller.abort()
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    let response: KubiosHttpResponse
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: token,
          Accept: 'application/json',
          'User-Agent': KUBIOS_USER_AGENT
        },
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store'
      })
    } catch {
      throw transportError(timedOut, externalSignal, endpoint)
    }

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterHeader(
        readHeader(response, 'retry-after')
      )
      await discardResponseBody(response)
      throw new KubiosApiError({
        code: 'rate_limited',
        endpoint,
        status: 429,
        retryAfterMs
      })
    }

    if (response.status === 401) {
      await discardResponseBody(response)
      throw new KubiosApiError({
        code: 'unauthorized',
        endpoint,
        status: 401
      })
    }

    if (response.status === 403) {
      await discardResponseBody(response)
      throw new KubiosApiError({
        code: 'forbidden',
        endpoint,
        status: 403
      })
    }

    if (response.status === 404) {
      await discardResponseBody(response)
      throw new KubiosApiError({
        code: 'not_found',
        endpoint,
        status: 404
      })
    }

    if (!response.ok) {
      await discardResponseBody(response)
      throw new KubiosApiError({
        code: 'http_error',
        endpoint,
        status: response.status
      })
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      if (timedOut) {
        throw new KubiosApiError({ code: 'timeout', endpoint })
      }
      if (externalSignal?.aborted) {
        throw new KubiosApiError({ code: 'aborted', endpoint })
      }
      await discardResponseBody(response)
      throw new KubiosApiError({
        code: 'invalid_json',
        endpoint,
        status: response.status
      })
    }

    if (timedOut) {
      throw new KubiosApiError({ code: 'timeout', endpoint })
    }
    if (externalSignal?.aborted) {
      throw new KubiosApiError({ code: 'aborted', endpoint })
    }

    return { body, status: response.status }
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromCaller)
  }
}

/**
 * Obtiene los miembros de un equipo:
 * `GET /v2/team/team/{team_id}?members=yes`.
 *
 * Una lista vacía es una respuesta válida. Un `401` no provoca
 * reautenticación ni reintento: se devuelve `KubiosApiError` con
 * `code: 'unauthorized'`. Un `429` expone `retryAfterMs`.
 */
export async function fetchKubiosTeamMembers(
  teamId: string,
  idToken: string,
  options: KubiosRequestOptions = {}
): Promise<KubiosTeamMembersPage> {
  const endpoint: KubiosApiEndpoint = 'team-members'
  const url = buildKubiosUrl(endpoint, teamId)
  const response = await requestKubiosJson(url, idToken, endpoint, options)
  return parseTeamMembers(response.body, endpoint, response.status)
}

/**
 * Obtiene la información del usuario autenticado:
 * `GET /v1/user/self`.
 *
 * Devuelve los equipos completos del usuario. Una lista vacía es válida; la
 * decisión de qué equipo usar corresponde al selector de `kubios-team`, nunca a
 * este cliente. Un `401` no reautentica y un `429` expone `retryAfterMs`.
 */
export async function fetchKubiosUserSelf(
  idToken: string,
  options: KubiosRequestOptions = {}
): Promise<KubiosUserSelfPage> {
  const endpoint: KubiosApiEndpoint = 'user-self'
  const url = buildKubiosUserSelfUrl(endpoint)
  const response = await requestKubiosJson(url, idToken, endpoint, options)
  return parseUserSelf(response.body, endpoint, response.status)
}

/**
 * Obtiene los resultados de un miembro:
 * `GET /v1/result/{team_user_id}`.
 *
 * Una lista vacía es una respuesta válida, distinta de un error. Los objetos
 * de resultado se devuelven sin transformar. Un `401` no reautentica y un
 * `429` expone `retryAfterMs`.
 */
export async function fetchKubiosHrvResults(
  teamUserId: string,
  idToken: string,
  options: KubiosRequestOptions = {}
): Promise<KubiosHrvResultsPage> {
  const endpoint: KubiosApiEndpoint = 'hrv-results'
  const url = buildKubiosUrl(endpoint, teamUserId)
  const response = await requestKubiosJson(url, idToken, endpoint, options)
  return parseHrvResults(response.body, endpoint, response.status)
}

import 'server-only'

/**
 * Cliente de autenticación de Kubios Cloud exclusivo de servidor.
 *
 * Reproduce el flujo Cognito ya usado por el servicio: un POST
 * `application/x-www-form-urlencoded` con cookie CSRF, sin seguir redirecciones
 * (`redirect: 'manual'`) y extrayendo el `id_token` del fragmento de la
 * redirección. Ni la URL de redirección ni el token se registran o se incluyen
 * en los errores.
 *
 * La redirección se valida antes de leer el fragmento: debe ser una URL
 * absoluta `https:` sin credenciales, con el origen y la ruta exactos de
 * `KUBIOS_REDIRECT_URI` y sin query. Cualquier otra `Location` es
 * `redirect_invalid`, de modo que un extremo hostil no pueda inyectar un token.
 *
 * El POST de login tiene timeout propio (`loginTimeoutMs`, por defecto
 * `KUBIOS_LOGIN_TIMEOUT_MS`) con `AbortController`; si vence, el resultado es
 * `login_request_failed` aunque el `fetch` inyectado ignore la señal.
 *
 * Persistencia: con `persistLogin` activo (por defecto), el token solo se
 * entrega a un `KubiosTokenStore` inyectado, siempre dentro de un sobre cifrado
 * por `kubios-crypto` y junto a su fecha de expiración. Con `persistLogin:
 * false`, `getToken` solo autentica y el llamador puede persistir el token
 * después con `persistToken`, bajo el equipo que haya resuelto. Este módulo no
 * escribe archivos, bases de datos ni logs; el adaptador concreto
 * (RPC/PostgreSQL) queda fuera de este archivo.
 *
 * Reutilización: se descifra el token guardado y se reutiliza mientras el reloj
 * inyectado siga por debajo de `exp` (JWT) y de la expiración persistida, menos
 * un margen de seguridad. Si expiró, se autentica una única vez; las llamadas
 * concurrentes comparten la misma promesa.
 *
 * Alcance: este cliente no realiza peticiones a la API de datos de Kubios y no
 * implementa reintentos. Un 401 de un miembro (`KUBIOS_MEMBER_UNAUTHORIZED_STATUS`)
 * debe propagarse desde el cliente de datos y nunca reautenticar aquí.
 *
 * AAD: el módulo `kubios-crypto` autentica el contexto estable
 * `{ teamId, memberId, purpose: 'token' }`, con su propio prefijo de versión y
 * `purpose` `token`. El espacio de nombres `kubios-auth` no forma parte del
 * formato AAD que expone `kubios-crypto`, por lo que no se añade un segmento
 * artificial que rompería la interoperabilidad con `decryptKubiosToken`.
 *
 * Firma del JWT: no se verifica criptográficamente (no hay JWKS ni acceso a
 * red en este módulo); el token se usa como credencial opaca recibida por TLS.
 * Solo se exige estructura JWT, `exp` numérico y vigencia, y el sobre guardado
 * queda autenticado por AES-256-GCM.
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import {
  decryptKubiosToken,
  encryptKubiosToken,
  type KubiosCryptoOptions
} from './kubios-crypto'
import { getKubiosConfig, type KubiosConfig, type KubiosEnvSource } from './kubios-config'

/** Margen por defecto antes de `exp` para no reutilizar un token a punto de caducar. */
export const KUBIOS_TOKEN_EXPIRY_MARGIN_MS = 60_000

/** Timeout por defecto del POST de login; acota una espera que podría colgarse. */
export const KUBIOS_LOGIN_TIMEOUT_MS = 30_000

/**
 * Estado HTTP con el que Kubios indica que un miembro no está autorizado para
 * un recurso concreto. No es un fallo de autenticación del servicio: el
 * cliente de datos debe propagarlo sin volver a autenticarse.
 */
export const KUBIOS_MEMBER_UNAUTHORIZED_STATUS = 401

const KUBIOS_LOGIN_URL = 'https://kubioscloud.auth.eu-west-1.amazoncognito.com/login'
const KUBIOS_REDIRECT_URI = 'https://analysis.kubioscloud.com/v1/portal/login'
/** Origen y ruta exactos que debe tener la redirección de Cognito. */
const KUBIOS_REDIRECT_URL = new URL(KUBIOS_REDIRECT_URI)
const KUBIOS_RESPONSE_TYPE = 'token'
const KUBIOS_SCOPE = 'openid'
const KUBIOS_USER_AGENT = 'DiabetesTracker 1.0'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

/** Equipo y miembro que delimitan el contexto cifrado del token. */
export interface KubiosTokenScope {
  readonly teamId: string
  readonly memberId: string
}

/**
 * Registro persistido de un token. `envelope` es el sobre base64 producido por
 * `kubios-crypto` y `expiresAt` es la fecha de expiración en milisegundos
 * desde la época Unix, derivada de `exp`.
 */
export interface KubiosStoredToken {
  readonly envelope: string
  readonly expiresAt: number
}

/**
 * Persistencia inyectada del token cifrado. El adaptador RPC/PostgreSQL se
 * implementa fuera de este módulo; aquí solo se exige leer y escribir el sobre
 * cifrado con su expiración. `delete` es opcional y se usa para descartar
 * registros corruptos, manipulados o caducados.
 */
export interface KubiosTokenStore {
  read(scope: KubiosTokenScope): Promise<KubiosStoredToken | null>
  write(scope: KubiosTokenScope, token: KubiosStoredToken): Promise<void>
  delete?(scope: KubiosTokenScope): Promise<void>
}

/** `fetch` inyectable; recibe la URL de login y las opciones de la petición. */
export type KubiosFetch = (input: string, init: RequestInit) => Promise<Response>

/** Opciones del cliente de autenticación. */
export interface KubiosAuthClientOptions {
  /**
   * Miembro al que se asocia el token en el store y en el AAD. Opcional: si
   * falta, se usa el equipo resuelto (`memberId = teamId`).
   */
  readonly memberId?: string
  /**
   * Equipo del token. Opcional: si falta, se usa `config.teamId`. Sin ninguno
   * de los dos, solo se puede autenticar con `persistLogin: false`.
   */
  readonly teamId?: string
  /**
   * Persistencia cifrada. Obligatoria cuando `persistLogin` es `true`; con
   * `persistLogin: false` puede omitirse porque el store no se toca.
   */
  readonly store?: KubiosTokenStore
  /** `fetch` inyectable para pruebas; por defecto el global del runtime. */
  readonly fetch?: KubiosFetch
  /** Reloj inyectable en milisegundos desde la época Unix; por defecto `Date.now`. */
  readonly now?: () => number
  /** Fuente de variables de entorno para la configuración; por defecto `process.env`. */
  readonly env?: KubiosEnvSource
  /** Opciones de cifrado; permite inyectar el entorno en pruebas. */
  readonly cryptoOptions?: KubiosCryptoOptions
  /** Margen de seguridad antes de `exp`; por defecto `KUBIOS_TOKEN_EXPIRY_MARGIN_MS`. */
  readonly expiryMarginMs?: number
  /** Timeout del POST de login en milisegundos; por defecto `KUBIOS_LOGIN_TIMEOUT_MS`. */
  readonly loginTimeoutMs?: number
  /**
   * Si es `true` (por defecto), `getToken` lee y escribe el token cifrado en el
   * store. Con `false`, solo autentica: el llamador debe persistir el token
   * después con `persistToken` bajo el equipo que resuelva.
   */
  readonly persistLogin?: boolean
}

/** Códigos de error fijos: nunca describen body, claves, credenciales ni `Location`. */
export type KubiosAuthErrorCode =
  | 'invalid_options'
  | 'config_unavailable'
  | 'store_read_failed'
  | 'store_write_failed'
  | 'login_request_failed'
  | 'login_rejected'
  | 'redirect_missing'
  | 'redirect_invalid'
  | 'token_missing'
  | 'token_malformed'
  | 'token_expired'
  | 'crypto_failed'
  | 'internal_error'

/** Resultado correcto: el token en claro solo vive en memoria para el llamador. */
export interface KubiosAuthSuccess {
  readonly ok: true
  readonly idToken: string
  readonly expiresAt: number
  readonly source: 'store' | 'login'
}

/** Resultado fallido: únicamente un código fijo, sin valores externos. */
export interface KubiosAuthFailure {
  readonly ok: false
  readonly code: KubiosAuthErrorCode
}

/** Resultado del cliente de autenticación. */
export type KubiosAuthResult = KubiosAuthSuccess | KubiosAuthFailure

/** Resultado de persistir explícitamente un token ya autenticado. */
export type KubiosPersistTokenResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: KubiosAuthErrorCode }

/** Token en claro que el llamador persiste tras resolver el equipo. */
export interface KubiosPersistTokenInput {
  readonly idToken: string
  readonly expiresAt: number
}

interface KubiosLoginSuccess {
  readonly ok: true
  readonly idToken: string
  readonly expiresAt: number
}

type KubiosLoginResult = KubiosLoginSuccess | KubiosAuthFailure

type StoredTokenStatus =
  | { readonly kind: 'missing' }
  | { readonly kind: 'usable'; readonly idToken: string; readonly expiresAt: number }
  | { readonly kind: 'error'; readonly code: KubiosAuthErrorCode }

function failure(code: KubiosAuthErrorCode): KubiosAuthFailure {
  return { ok: false, code }
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateOptions(options: KubiosAuthClientOptions): KubiosAuthErrorCode | null {
  if (options === null || options === undefined || typeof options !== 'object') {
    return 'invalid_options'
  }
  if (options.memberId !== undefined && !isNonBlankString(options.memberId)) {
    return 'invalid_options'
  }
  if (options.teamId !== undefined && !isNonBlankString(options.teamId)) {
    return 'invalid_options'
  }

  if (options.persistLogin !== undefined && typeof options.persistLogin !== 'boolean') {
    return 'invalid_options'
  }
  const persistLogin = options.persistLogin ?? true

  const store = options.store
  if (persistLogin || store !== undefined) {
    if (
      store === null ||
      store === undefined ||
      typeof store.read !== 'function' ||
      typeof store.write !== 'function'
    ) {
      return 'invalid_options'
    }
  }

  if (options.fetch !== undefined && typeof options.fetch !== 'function') return 'invalid_options'
  if (options.now !== undefined && typeof options.now !== 'function') return 'invalid_options'

  const margin = options.expiryMarginMs ?? KUBIOS_TOKEN_EXPIRY_MARGIN_MS
  if (typeof margin !== 'number' || !Number.isFinite(margin) || margin < 0) {
    return 'invalid_options'
  }

  const loginTimeout = options.loginTimeoutMs ?? KUBIOS_LOGIN_TIMEOUT_MS
  if (typeof loginTimeout !== 'number' || !Number.isFinite(loginTimeout) || loginTimeout <= 0) {
    return 'invalid_options'
  }

  return null
}

/**
 * Acepta únicamente la redirección exacta de Cognito: HTTPS, sin credenciales
 * embebidas, mismo origen (host y puerto) y ruta que `KUBIOS_REDIRECT_URI`, y
 * sin query. El fragmento se permite porque transporta los tokens. No expone ni
 * registra la URL recibida.
 */
function isExpectedRedirect(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.origin === KUBIOS_REDIRECT_URL.origin &&
    url.pathname === KUBIOS_REDIRECT_URL.pathname &&
    url.search === ''
  )
}

/** Decodifica un segmento base64url de JWT y lo interpreta como JSON. */
function parseJwtSegment(segment: string): unknown | null {
  if (segment.length === 0 || !BASE64URL_PATTERN.test(segment)) return null

  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Extrae la expiración de un JWT sin verificar su firma. Devuelve `null` si la
 * estructura o `exp` no son válidos. Nunca incluye el token en el resultado.
 */
function readJwtExpiry(token: unknown): number | null {
  if (typeof token !== 'string') return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  if (!parts.every((part) => part.length > 0 && BASE64URL_PATTERN.test(part))) return null

  const payloadSegment = parts[1]
  if (payloadSegment === undefined) return null
  const payload = parseJwtSegment(payloadSegment)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null

  const exp = (payload as { exp?: unknown }).exp
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null

  const expiresAt = exp * 1000
  return Number.isSafeInteger(expiresAt) ? expiresAt : null
}

/**
 * Cliente de autenticación con dependencias inyectadas. No registra nada y no
 * expone detalles de la respuesta de Cognito en los errores.
 */
export class KubiosAuthClient {
  private readonly options: KubiosAuthClientOptions
  private readonly optionsError: KubiosAuthErrorCode | null
  private readonly marginMs: number
  private readonly loginTimeoutMs: number
  private readonly persistLogin: boolean
  private readonly fetchImpl: KubiosFetch | null
  private config: KubiosConfig | null = null
  private inFlight: Promise<KubiosAuthResult> | null = null

  constructor(options: KubiosAuthClientOptions) {
    this.options = options
    this.optionsError = validateOptions(options)
    this.marginMs = options?.expiryMarginMs ?? KUBIOS_TOKEN_EXPIRY_MARGIN_MS
    this.loginTimeoutMs = options?.loginTimeoutMs ?? KUBIOS_LOGIN_TIMEOUT_MS
    this.persistLogin = options?.persistLogin ?? true

    const injectedFetch = options?.fetch
    if (typeof injectedFetch === 'function') {
      this.fetchImpl = injectedFetch
    } else {
      this.fetchImpl = typeof fetch === 'function' ? fetch : null
    }
  }

  /**
   * Devuelve un `id_token` vigente. Con persistencia activa (por defecto)
   * reutiliza el token cifrado del store o autentica y lo guarda. Con
   * `persistLogin: false` solo autentica y no toca el store.
   */
  async getToken(): Promise<KubiosAuthResult> {
    if (this.optionsError !== null) return failure(this.optionsError)
    if (this.inFlight !== null) return this.inFlight

    const pending = this.resolveToken().catch((): KubiosAuthResult => failure('internal_error'))
    this.inFlight = pending

    try {
      return await pending
    } finally {
      if (this.inFlight === pending) this.inFlight = null
    }
  }

  private async resolveToken(): Promise<KubiosAuthResult> {
    const config = this.readConfig()
    if (config === null) return failure('config_unavailable')

    // Sin persistencia no se necesita equipo ni store: el llamador guardará el
    // token después de resolver el equipo.
    if (!this.persistLogin) return this.loginWithoutPersistence(config)

    const teamId = this.options.teamId ?? config.teamId
    if (teamId === undefined) {
      // Sin equipo no hay scope seguro para el store; nunca se inventa uno.
      return failure('config_unavailable')
    }

    const scope: KubiosTokenScope = {
      teamId,
      memberId: this.options.memberId ?? teamId
    }

    const now = this.readNow()
    if (now === null) return failure('internal_error')

    const stored = await this.loadStoredToken(scope, now)
    if (stored.kind === 'error') return failure(stored.code)
    if (stored.kind === 'usable') {
      return {
        ok: true,
        idToken: stored.idToken,
        expiresAt: stored.expiresAt,
        source: 'store'
      }
    }

    const loggedIn = await this.login(config)
    if (!loggedIn.ok) return loggedIn

    const persisted = await this.writeEncryptedToken(scope, {
      idToken: loggedIn.idToken,
      expiresAt: loggedIn.expiresAt
    })
    if (!persisted.ok) return persisted

    return {
      ok: true,
      idToken: loggedIn.idToken,
      expiresAt: loggedIn.expiresAt,
      source: 'login'
    }
  }

  /** Login sin persistencia: no lee, cifra ni escribe el token. */
  private async loginWithoutPersistence(config: KubiosConfig): Promise<KubiosAuthResult> {
    const loggedIn = await this.login(config)
    if (!loggedIn.ok) return loggedIn

    return {
      ok: true,
      idToken: loggedIn.idToken,
      expiresAt: loggedIn.expiresAt,
      source: 'login'
    }
  }

  /**
   * Persiste un token ya autenticado bajo el equipo indicado. El AAD usa
   * `{ teamId, memberId: options.memberId ?? teamId }`, igual que `getToken`.
   * No registra nada y devuelve solo códigos fijos.
   */
  async persistToken(
    teamId: string,
    token: KubiosPersistTokenInput
  ): Promise<KubiosPersistTokenResult> {
    if (this.optionsError !== null) return { ok: false, code: 'invalid_options' }
    if (!isNonBlankString(teamId)) return { ok: false, code: 'invalid_options' }
    if (token === null || typeof token !== 'object') {
      return { ok: false, code: 'invalid_options' }
    }
    if (
      typeof token.idToken !== 'string' ||
      token.idToken.length === 0 ||
      typeof token.expiresAt !== 'number' ||
      !Number.isFinite(token.expiresAt)
    ) {
      return { ok: false, code: 'invalid_options' }
    }

    const scope: KubiosTokenScope = {
      teamId,
      memberId: this.options.memberId ?? teamId
    }
    return this.writeEncryptedToken(scope, {
      idToken: token.idToken,
      expiresAt: token.expiresAt
    })
  }

  /** Cifra y escribe el token; nunca propaga errores ni valores externos. */
  private async writeEncryptedToken(
    scope: KubiosTokenScope,
    token: KubiosPersistTokenInput
  ): Promise<KubiosPersistTokenResult> {
    const store = this.options.store
    if (store === undefined) return { ok: false, code: 'invalid_options' }

    let envelope: string
    try {
      envelope = encryptKubiosToken(token.idToken, scope, this.options.cryptoOptions)
    } catch {
      return { ok: false, code: 'crypto_failed' }
    }

    try {
      await store.write(scope, { envelope, expiresAt: token.expiresAt })
    } catch {
      return { ok: false, code: 'store_write_failed' }
    }

    return { ok: true }
  }

  private readConfig(): KubiosConfig | null {
    if (this.config !== null) return this.config

    try {
      const config = getKubiosConfig(this.options.env)
      this.config = config
      return config
    } catch {
      // KubiosConfigError solo nombra variables ausentes; no se propaga el mensaje.
      return null
    }
  }

  private readNow(): number | null {
    try {
      const now = this.options.now ? this.options.now() : Date.now()
      return typeof now === 'number' && Number.isFinite(now) ? now : null
    } catch {
      return null
    }
  }

  private async loadStoredToken(
    scope: KubiosTokenScope,
    now: number
  ): Promise<StoredTokenStatus> {
    const store = this.options.store
    if (store === undefined) return { kind: 'error', code: 'invalid_options' }

    let stored: KubiosStoredToken | null
    try {
      stored = await store.read(scope)
    } catch {
      return { kind: 'error', code: 'store_read_failed' }
    }

    if (stored === null || stored === undefined) return { kind: 'missing' }

    const isInvalidRecord =
      typeof stored !== 'object' ||
      typeof stored.envelope !== 'string' ||
      stored.envelope.length === 0 ||
      typeof stored.expiresAt !== 'number' ||
      !Number.isFinite(stored.expiresAt)

    if (isInvalidRecord) {
      await this.forget(scope)
      return { kind: 'missing' }
    }

    let idToken: string
    try {
      idToken = decryptKubiosToken(stored.envelope, scope, this.options.cryptoOptions)
    } catch {
      await this.forget(scope)
      return { kind: 'missing' }
    }

    const tokenExpiresAt = readJwtExpiry(idToken)
    if (tokenExpiresAt === null) {
      await this.forget(scope)
      return { kind: 'missing' }
    }

    // La expiración persistida nunca puede ampliar la vigencia real del JWT.
    const expiresAt = Math.min(stored.expiresAt, tokenExpiresAt)
    if (!(now < expiresAt - this.marginMs)) {
      await this.forget(scope)
      return { kind: 'missing' }
    }

    return { kind: 'usable', idToken, expiresAt }
  }

  /** Descarta un registro inválido; un fallo al borrar no impide reintentar el login. */
  private async forget(scope: KubiosTokenScope): Promise<void> {
    const store = this.options.store
    if (store === undefined) return
    const remove = store.delete
    if (typeof remove !== 'function') return

    try {
      await remove.call(store, scope)
    } catch {
      // El siguiente login sobrescribe el registro si el borrado no fue posible.
    }
  }

  /**
   * Ejecuta el POST de login con un timeout acotado. Pasa un `AbortSignal`
   * propio y corta la espera por carrera, de modo que un `fetch` inyectado que
   * ignore la señal tampoco deje la autenticación colgada. Devuelve `null` si
   * venció el plazo o si la petición falló; nunca propaga el error.
   */
  private async requestLogin(init: RequestInit): Promise<Response | null> {
    const fetchImpl = this.fetchImpl
    if (fetchImpl === null) return null

    const controller = new AbortController()

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort()
        resolve(null)
      }, this.loginTimeoutMs)
    })

    // La función `async` convierte un lanzamiento síncrono en rechazo; el
    // `.catch` observa el rechazo aunque la carrera ya haya terminado por timeout.
    const request = (async () =>
      fetchImpl(KUBIOS_LOGIN_URL, { ...init, signal: controller.signal }))()
    request.catch(() => {})

    try {
      return await Promise.race([request, timeout])
    } catch {
      return null
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }

  private async login(config: KubiosConfig): Promise<KubiosLoginResult> {
    if (this.fetchImpl === null) return failure('login_request_failed')

    const csrfToken = randomUUID()
    const body = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: KUBIOS_REDIRECT_URI,
      username: config.username,
      password: config.password,
      response_type: KUBIOS_RESPONSE_TYPE,
      scope: KUBIOS_SCOPE,
      _csrf: csrfToken
    })

    const response: Response | null = await this.requestLogin({
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `XSRF-TOKEN=${csrfToken}`,
        'User-Agent': KUBIOS_USER_AGENT
      },
      body,
      redirect: 'manual'
    })
    if (response === null || typeof response !== 'object' || typeof response.status !== 'number') {
      return failure('login_request_failed')
    }
    if (response.status !== 302) return failure('login_rejected')

    let location: string | null
    try {
      location = response.headers.get('location')
    } catch {
      return failure('redirect_missing')
    }
    if (typeof location !== 'string' || location.length === 0) return failure('redirect_missing')

    // La URL se valida por completo antes de leer el fragmento: un `Location`
    // de otro origen, esquema, ruta o con query no puede inyectar un token.
    let redirectUrl: URL
    try {
      redirectUrl = new URL(location)
    } catch {
      return failure('redirect_invalid')
    }
    if (!isExpectedRedirect(redirectUrl)) return failure('redirect_invalid')

    let fragment: string
    try {
      fragment = redirectUrl.hash.length > 1 ? redirectUrl.hash.slice(1) : ''
    } catch {
      return failure('redirect_invalid')
    }

    let params: URLSearchParams
    try {
      params = new URLSearchParams(fragment)
    } catch {
      return failure('redirect_invalid')
    }

    // Un fragmento con `error` indica rechazo de Cognito; el valor no se expone.
    if (params.has('error')) return failure('login_rejected')

    const idToken = params.get('id_token')
    if (typeof idToken !== 'string' || idToken.length === 0) return failure('token_missing')

    const expiresAt = readJwtExpiry(idToken)
    if (expiresAt === null) return failure('token_malformed')

    const now = this.readNow()
    if (now === null) return failure('internal_error')
    if (!(now < expiresAt)) return failure('token_expired')

    // El cifrado se hace solo al persistir; un login sin persistencia no toca
    // el store ni construye un sobre.
    return { ok: true, idToken, expiresAt }
  }
}

/**
 * Indica si un estado HTTP es el 401 específico de un miembro de Kubios. Los
 * llamadores deben propagarlo sin invocar de nuevo al login; este cliente solo
 * renueva el token por caducidad.
 */
export function isKubiosMemberUnauthorized(status: number): boolean {
  return status === KUBIOS_MEMBER_UNAUTHORIZED_STATUS
}

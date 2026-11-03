import 'server-only'

/**
 * K50 - Resolución server-side de la identidad Kubios a partir de la sesión
 * actual del dashboard de producción.
 *
 * La única fuente de identidad es la cookie HttpOnly `dashboard_session`,
 * verificada por `getServerRuntime().useCases.auth.getSession(token)`. Ese
 * método recarga el usuario y sus roles desde `public.users` en cada petición.
 * No se acepta ninguna cabecera de portador, JWT de Supabase, UUID, username,
 * email, rol ni selector user/team/member procedente del cliente.
 *
 * Con el `Session.user.id` verificado (cadena entera canónica de
 * `public.users.UserID`) se consulta, mediante un cliente de servicio perezoso,
 * la RPC `kubios_get_user_member_link(p_user_id integer)`. Solo un array vacío
 * significa «sin vínculo». Cualquier respuesta distinta de cero o una fila
 * incoherente (user_id no numérico o distinto, team/member no UUID, error de
 * RPC) falla cerrado con 503.
 *
 * El rol del usuario nunca amplía el alcance: todos los roles, incluido admin,
 * solo pueden resolver su propio vínculo y leer su propio snapshot.
 *
 * Inyección: `KubiosAuthzDeps` permite probar sin red ni credenciales. No hay
 * URL ni clave por defecto, este módulo no lee el entorno, no crea clientes y
 * no registra nada.
 */

/** Estado HTTP propio del contrato de autorización. */
export type KubiosAuthErrorStatus = 401 | 503

const UNAUTHORIZED_MESSAGE = 'Sesión ausente o no válida'
const SERVICE_UNAVAILABLE_MESSAGE = 'No se pudo verificar la identidad Kubios'

/** Error tipado del contrato; el mensaje es siempre genérico. */
export class KubiosAuthError extends Error {
  readonly status: KubiosAuthErrorStatus

  constructor(status: KubiosAuthErrorStatus) {
    super(status === 401 ? UNAUTHORIZED_MESSAGE : SERVICE_UNAVAILABLE_MESSAGE)
    this.name = 'KubiosAuthError'
    this.status = status
  }
}

/** Vínculo explícito del UserID verificado con un team/member de Kubios. */
export interface KubiosLinkedIdentity {
  readonly status: 'linked'
  readonly teamId: string
  readonly memberId: string
}

/** Usuario verificado sin vínculo Kubios asignado. */
export interface KubiosUnlinkedIdentity {
  readonly status: 'unlinked'
}

export type KubiosIdentityResult = KubiosLinkedIdentity | KubiosUnlinkedIdentity

/**
 * Forma mínima de la sesión de producción. Solo se consume `user.id`; el rol,
 * `uuid`, username y email se ignoran deliberadamente.
 */
export interface KubiosSession {
  readonly user: {
    readonly id: string
  }
}

/** Método existente del runtime que recarga la sesión desde la base. */
export type KubiosSessionGetter = (token: string) => Promise<KubiosSession>

/** Cliente de servicio inyectable, compatible con `supabase.rpc`. */
export interface KubiosRpcClient {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<unknown>
}

/** Dependencias inyectables para probar sin red ni credenciales. */
export interface KubiosAuthzDeps {
  readonly getSession: KubiosSessionGetter
  /**
   * Fábrica perezosa: solo se invoca después de verificar la sesión y antes de
   * consultar el vínculo. Un fallo de configuración se convierte en 503.
   */
  readonly createService: () => KubiosRpcClient
}

const MEMBER_LINK_RPC = 'kubios_get_user_member_link'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Representación canónica de un entero de PostgreSQL: sin espacios, sin `+`,
 * sin ceros a la izquierda y con `-` solo para negativos reales. `-0` no es
 * canónico y se rechaza.
 */
const CANONICAL_INTEGER_PATTERN = /^(?:0|-?[1-9]\d{0,9})$/
const POSTGRES_INTEGER_MIN = -2_147_483_648
const POSTGRES_INTEGER_MAX = 2_147_483_647

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isKubiosAuthError(error: unknown): error is KubiosAuthError {
  return (
    error instanceof KubiosAuthError ||
    (isRecord(error) && error.name === 'KubiosAuthError' && (error.status === 401 || error.status === 503))
  )
}

/**
 * Reconoce el 401 del método de sesión (`UnauthorizedError`) sin acoplarse a su
 * clase: cualquier otro fallo es una dependencia no disponible (503).
 */
function isUnauthorizedSessionError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false
  }

  return (
    error.name === 'UnauthorizedError' ||
    error.statusCode === 401 ||
    error.code === 'UNAUTHORIZED'
  )
}

function parseCanonicalUserId(value: unknown): number | null {
  if (typeof value !== 'string' || !CANONICAL_INTEGER_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < POSTGRES_INTEGER_MIN ||
    parsed > POSTGRES_INTEGER_MAX
  ) {
    return null
  }

  return parsed
}

function normalizeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null
}

async function readVerifiedUserId(
  sessionToken: string | null | undefined,
  getSession: KubiosSessionGetter
): Promise<number> {
  if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
    throw new KubiosAuthError(401)
  }

  let session: KubiosSession
  try {
    session = await getSession(sessionToken)
  } catch (error) {
    if (isKubiosAuthError(error)) {
      throw error
    }
    throw new KubiosAuthError(isUnauthorizedSessionError(error) ? 401 : 503)
  }

  if (!isRecord(session) || !isRecord(session.user)) {
    throw new KubiosAuthError(503)
  }

  const userId = parseCanonicalUserId(session.user.id)
  if (userId === null) {
    throw new KubiosAuthError(503)
  }

  return userId
}

/**
 * Consulta el vínculo con el UserID ya verificado. La RPC recibe un entero,
 * nunca el UUID de Auth ni un identificador del cliente.
 */
async function fetchMemberLink(
  userId: number,
  createService: () => KubiosRpcClient
): Promise<KubiosIdentityResult> {
  let service: KubiosRpcClient

  try {
    service = createService()
  } catch (error) {
    if (isKubiosAuthError(error)) {
      throw error
    }
    throw new KubiosAuthError(503)
  }

  let response: unknown
  try {
    response = await service.rpc(MEMBER_LINK_RPC, { p_user_id: userId })
  } catch (error) {
    if (isKubiosAuthError(error)) {
      throw error
    }
    throw new KubiosAuthError(503)
  }

  // `RETURNS TABLE`: una respuesta válida es un objeto con `data` array.
  // Cualquier otra forma es un fallo del servicio, nunca «sin vínculo».
  if (!isRecord(response)) {
    throw new KubiosAuthError(503)
  }

  if (response.error !== null && response.error !== undefined) {
    throw new KubiosAuthError(503)
  }

  if (!Object.prototype.hasOwnProperty.call(response, 'data')) {
    throw new KubiosAuthError(503)
  }

  const rows = response.data
  if (!Array.isArray(rows)) {
    throw new KubiosAuthError(503)
  }

  if (rows.length === 0) {
    return { status: 'unlinked' }
  }

  if (rows.length !== 1) {
    throw new KubiosAuthError(503)
  }

  const row = rows[0]
  if (!isRecord(row)) {
    throw new KubiosAuthError(503)
  }

  // La RPC devuelve `user_id integer`; debe coincidir exactamente con el
  // UserID verificado. Un UUID, cadena numérica u otro usuario es incoherente.
  if (
    typeof row.user_id !== 'number' ||
    !Number.isSafeInteger(row.user_id) ||
    row.user_id !== userId
  ) {
    throw new KubiosAuthError(503)
  }

  // Columnas documentadas: no se aceptan alias ni datos anidados.
  const teamId = normalizeUuid(row.team_id)
  const memberId = normalizeUuid(row.kubios_member_id)
  if (teamId === null || memberId === null) {
    throw new KubiosAuthError(503)
  }

  return { status: 'linked', teamId, memberId }
}

/**
 * Resuelve la identidad Kubios de una petición server-side.
 *
 * @param sessionToken Valor de la cookie HttpOnly ya leída por el adaptador.
 * @param deps Método de sesión del runtime y fábrica perezosa del cliente.
 * @throws {KubiosAuthError} 401 si falta la sesión o no es válida/caducada;
 *   503 si falla el runtime, la RPC, la configuración o la respuesta no cumple
 *   el contrato.
 */
export async function resolveKubiosIdentity(
  sessionToken: string | null | undefined,
  deps: KubiosAuthzDeps
): Promise<KubiosIdentityResult> {
  const userId = await readVerifiedUserId(sessionToken, deps.getSession)
  return fetchMemberLink(userId, deps.createService)
}

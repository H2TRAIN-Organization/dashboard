import 'server-only'

/**
 * K14 - Orquestador server-only de una sincronización de Kubios por equipo.
 *
 * Flujo de una pasada:
 *   1. Configuración privada (`getKubiosConfig`). Si `KUBIOS_TEAM_ID` existe,
 *      se valida como UUID. Si falta, se autentica sin persistencia, se
 *      consulta `/v1/user/self` y se selecciona explícitamente el equipo
 *      `Diabetes Tracker - H2TRAIN` antes del lease; ausencia, ambigüedad o
 *      entradas inválidas fallan cerrado sin elegir el primero.
 *   2. Lease de un único trabajador por equipo (`kubios_try_acquire_sync`).
 *   3. `id_token` cifrado (K12/K36) con AAD `{ teamId, memberId: teamId }`.
 *      Si el equipo se descubrió, el token se persiste después del lease bajo
 *      ese equipo resuelto.
 *   4. Listado de miembros y lectura del cursor durable por equipo (K44).
 *   5. Resultados HRV (K13) y snapshot cifrado por miembro (K07/K10) con el
 *      `memberId` real, empezando por el primer miembro no intentado.
 *   6. Persistencia del cursor bajo el fence owner/lease (K44), antes del
 *      cierre del intento en `finally` (`kubios_finish_sync`).
 *
 * Estado PROVISIONAL: no hay mediciones reales confirmadas. `team_user_id` es
 * el único identificador de miembro observado (K05) y aquí debe ser un UUID
 * porque las RPC K10/K35/K36 usan `uuid`; el mapeo de identificadores de Kubios
 * a UUID queda pendiente de los contratos reales y se limita a rechazar los que
 * no encajan. Un miembro rechazado cuenta como fallo y hace que la pasada sea
 * `partial` (nunca `ok`), sin impedir que los UUID válidos se sincronicen. La
 * forma de `results` también es PROVISIONAL: se guarda
 * exactamente `JSON.stringify({ results })` con los objetos tal como los
 * entrega el proveedor, sin extraer métricas, sin inventar campos de usuario,
 * sin añadir claves y sin reordenar. Una lista vacía se guarda como
 * `{"results":[]}` (vacío legítimo, distinto de un error).
 *
 * Contextos de cifrado (no se cruzan): el token usa `memberId = teamId` porque
 * es un secreto del equipo; cada snapshot usa el `memberId` real del miembro.
 *
 * Concurrencia y cierre: un solo trabajador por equipo mediante lease con
 * `owner` UUID aleatorio y caducidad prudente; todas las escrituras de token y
 * snapshot van fenceadas con ese `owner`, y el cierre
 * (`kubios_finish_sync` o `kubios_finish_sync_indefinite`) se ejecuta siempre en
 * `finally` cuando el lease se adquirió.
 *
 * Cursor durable por equipo (K44): cada pasada empieza por `next_member_id` y
 * recorre como máximo una vez cada miembro vigente. El orden se deriva solo de
 * los UUID que entrega el proveedor para el equipo (orden ascendente estable),
 * nunca de la sesión, del cliente ni de la petición. Al agotarse el presupuesto
 * o tras un 429, el cursor queda en el primer miembro no procesado (un miembro
 * que agotó su plazo no se considera intentado). Los fallos individuales se
 * registran en `failed_member_ids` y el cursor continúa para no bloquear al
 * resto; al completar el ciclo, el siguiente empieza por el primer fallo (puede
 * repetir miembros ya sincronizados; el upsert es idempotente). Una pasada solo
 * devuelve `ok` si todos los miembros vigentes quedaron sincronizados y no queda
 * ningún fallo pendiente. El avance se persiste antes de `kubios_finish_sync`,
 * dentro de la reserva de cierre y con un plazo máximo de 1 s, mediante una RPC
 * `security definer` que bloquea el estado del equipo y exige el mismo `owner` y
 * un lease vigente: un owner caducado o reemplazado no puede mover el cursor. Si
 * el cursor no se confirma, la pasada no puede devolver `ok`.
 *
 * Miembros no identificables (SYNC-01): un miembro cuyo `team_user_id` falta o
 * no es un UUID no se puede sincronizar ni representar en el cursor durable
 * (`uuid[]`). No aborta la pasada: los UUID válidos se procesan igual y cada
 * entrada no identificable cuenta como fallo, de modo que el resultado es
 * `partial` con `members.partial` y nunca `ok`. Como el cursor solo admite
 * UUIDs, estas entradas no se persisten: se recuentan en cada pasada a partir
 * del listado del proveedor y se reintentan (sin bucle dentro de la misma
 * pasada) mientras el proveedor las siga devolviendo. Los UUID válidos
 * conservan su ciclo normal; como la pasada no puede ser `ok`, al completarse
 * el ciclo se reinicia y se repiten en pasadas posteriores (el upsert es
 * idempotente), sin corromper el cursor ni omitir a los válidos. Un UUID
 * repetido no es un miembro no identificable: se procesa una sola vez y no
 * cuenta como fallo.
 *
 * Lectura del cursor (SYNC-03): solo un array vacío equivale a un equipo sin
 * cursor. Una respuesta nula, indefinida o con forma desconocida (sin error de
 * RPC) falla cerrado: `partial` con `cursor.unavailable`, sin snapshots ni
 * avance de cursor, porque no se puede distinguir de una lectura incompleta.
 *
 * Contrato de `kubios_write_snapshot` (SYNC-02): la RPC declara
 * `returns timestamptz`, por lo que el éxito exige un escalar de tipo cadena
 * con un instante ISO-8601 que incluya zona (`Z` o `±hh:mm`) y que `Date.parse`
 * convierta en un epoch finito dentro del rango 1970..9999. Cualquier otra
 * respuesta (incluido `{ data: null, error: null }`) es un fallo del miembro:
 * no se marca `synced`, no se repite la escritura, no se borra el snapshot
 * previo y la pasada no puede declararse `ok`.
 *
 * Presupuesto global (K43): `runKubiosSync` recibe un `budgetMs` total y dos
 * reservas (`finishReserveMs` y `responseReserveMs`). Toda espera que pueda
 * bloquear (fetch de autenticacion, listado de miembros, HRV, RPC de lease,
 * token, snapshot y finish) se ejecuta con una carrera contra el plazo
 * restante, ademas del timeout propio del cliente. El plazo de trabajo termina
 * antes de la reserva de cierre, y esta antes de la reserva de respuesta, de
 * modo que el `finally` siempre dispone de tiempo acotado. Un fetch o RPC que
 * ignore `AbortSignal` no bloquea la pasada: la promesa se abandona con su
 * rechazo observado y el fence owner/lease de las RPC impide que una escritura
 * tardia se aplique tras liberar el lease o con otro owner.
 *
 * Relacion por defecto (documentada tambien en `supabase/cron/README.md`):
 *   * `pg_net.timeout_milliseconds = 30 s` es el plazo del cliente HTTP, no un
 *     limite de la funcion Vercel.
 *   * presupuesto total 26 s = 21 s de trabajo + 4 s de cierre + 1 s de
 *     respuesta; queda margen frente a los 30 s de pg_net.
 *   * lease por defecto 120 s; ademas se amplia como minimo a
 *     `ceil(budgetMs/1000) + 15 s` para que sobreviva al presupuesto de trabajo.
 *   * `maxDuration` se declara en la ruta; el limite real depende del plan y de
 *     fluid compute y no se asume aqui.
 *
 * Política de errores: un 401/403/404 de un miembro es un fallo individual (no
 * se reautentica, no se reintenta y no se entra en bucles); un 429 es global,
 * detiene la programación de miembros nuevos y persiste la pausa. Este módulo
 * no registra logs y no incluye tokens, claves, cuerpos, URLs, identificadores
 * ni mensajes de error externos en sus resultados.
 *
 * Política de pausa tras un 429:
 *   * `Retry-After` válido y representable: se persiste exacto mediante
 *     `kubios_finish_sync` hasta el máximo de `integer` (2147483647 s). Nunca se
 *     acorta para que quepa en un día.
 *   * `Retry-After` desbordado (`Infinity` en K13) o superior a ese máximo: se
 *     persiste una pausa indefinida (`next_allowed_at = 'infinity'`) mediante
 *     `kubios_finish_sync_indefinite`. No se usa ningún número centinela ni se
 *     degrada a la espera por defecto.
 *   * Cabecera ausente o con formato inválido: pausa prudente de 60 s.
 *   La única forma de reanudar una pausa indefinida es la limpieza
 *   administrativa documentada en la migración K38.
 *
 * Inyección: `KubiosSyncDeps` permite probar todo el flujo sin red. Sin
 * `service`, se crea un cliente con la clave de servicio a partir de
 * `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`; si
 * faltan o no cumplen el contrato (HTTPS, HTTP solo local, sin credenciales en
 * la URL y clave `service_role`), la respuesta es `partial` sin hacer red ni
 * crear el cliente. No hay URL ni clave por defecto y no se importa el cliente
 * admin compartido.
 *
 * Importaciones relativas sin extensión: las pruebas Node resuelven esos
 * especificadores con un loader propio; no se usan alias `@/lib/...`.
 */

import { Buffer } from 'node:buffer'
import { randomUUID as generateRandomUuid } from 'node:crypto'

import {
  DEFAULT_KUBIOS_TIMEOUT_MS,
  MAX_KUBIOS_TIMEOUT_MS,
  fetchKubiosHrvResults,
  fetchKubiosTeamMembers,
  parseRetryAfterHeader,
  type KubiosApiFetch,
  type KubiosTeamMember
} from './kubios-api-client'
import {
  KubiosAuthClient,
  type KubiosFetch,
  type KubiosStoredToken,
  type KubiosTokenScope,
  type KubiosTokenStore
} from './kubios-auth-client'
import {
  getKubiosConfig,
  type KubiosConfig,
  type KubiosEnvSource
} from './kubios-config'
import { resolveKubiosTeam } from './kubios-team-overview'
import { resolveKubiosSupabaseConfig } from './kubios-supabase-url'
import {
  KUBIOS_AUTH_TAG_BYTES,
  KUBIOS_KEY_VERSION,
  KUBIOS_NONCE_BYTES,
  encryptKubiosSnapshot,
  type KubiosCryptoOptions
} from './kubios-crypto'

/** Estado de una pasada de sincronización. */
export type KubiosSyncStatus = 'ok' | 'locked' | 'throttled' | 'partial'

/**
 * Resultado público: solo estos campos. `retryAfterSeconds` aparece únicamente
 * cuando `status === 'throttled'` y la pausa persistida es finita. Si la pausa
 * es indefinida se omite `retryAfterSeconds` y se marca `retryIndefinite`: un
 * número finito ahí mentiría sobre cuándo se puede reanudar.
 */
export interface KubiosSyncResult {
  status: KubiosSyncStatus
  synced: number
  failed: number
  retryAfterSeconds?: number
  /** Presente y `true` solo cuando la pausa persistida no tiene plazo. */
  retryIndefinite?: true
}

/** Respuesta mínima de una RPC de Supabase. */
export interface KubiosSyncRpcResponse {
  readonly data?: unknown
  readonly error?: unknown
}

/** Cliente de servicio inyectable, compatible con `supabase.rpc`. */
export interface KubiosSyncRpcClient {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<KubiosSyncRpcResponse>
}

/** Dependencias inyectables para probar el flujo completo sin red. */
export interface KubiosSyncDeps {
  /** Cliente de servicio; sin él se crea de forma perezosa desde el entorno. */
  readonly service?: KubiosSyncRpcClient
  /** Entorno de configuración y de clave de cifrado; por defecto `process.env`. */
  readonly env?: KubiosEnvSource
  /** Opciones de cifrado; si faltan se derivan de `env`. */
  readonly cryptoOptions?: KubiosCryptoOptions
  /** `fetch` del login de Kubios; se envuelve con un timeout acotado. */
  readonly authFetch?: KubiosFetch
  /** `fetch` de datos de Kubios; el cliente K13 aplica su propio timeout. */
  readonly apiFetch?: KubiosApiFetch
  /** Reloj inyectable en milisegundos desde la época Unix. */
  readonly now?: () => number
  /** Generador de UUID para el `owner` del lease. */
  readonly randomUUID?: () => string
  /**
   * Timeout de cada llamada; por defecto 15 s y máximo 120 s. Se recorta al
   * plazo de trabajo restante, que nunca se excede.
   */
  readonly timeoutMs?: number
  /**
   * Presupuesto total de la pasada en milisegundos, incluidas la reserva de
   * cierre y la de respuesta. Por defecto 26 s.
   */
  readonly budgetMs?: number
  /** Parte final del presupuesto reservada para `finish`; por defecto 4 s. */
  readonly finishReserveMs?: number
  /** Parte final reservada para construir/enviar la respuesta; por defecto 1 s. */
  readonly responseReserveMs?: number
  /**
   * Duración mínima del lease en segundos; por defecto 120 y rango 5..3600.
   * El valor efectivo nunca es menor que el presupuesto de trabajo más un
   * margen, para que el lease sobreviva a la pasada.
   */
  readonly leaseSeconds?: number
}

const LEASE_RPC = 'kubios_try_acquire_sync'
const FINISH_RPC = 'kubios_finish_sync'
const FINISH_INDEFINITE_RPC = 'kubios_finish_sync_indefinite'
const TOKEN_READ_RPC = 'kubios_get_token'
const TOKEN_WRITE_RPC = 'kubios_write_token'
const SNAPSHOT_WRITE_RPC = 'kubios_write_snapshot'
const CURSOR_READ_RPC = 'kubios_get_sync_cursor'
const CURSOR_ADVANCE_RPC = 'kubios_advance_sync_cursor'

/** Presupuesto total por defecto: 21 s de trabajo + 4 s de cierre + 1 s de respuesta. */
export const DEFAULT_KUBIOS_SYNC_BUDGET_MS = 26_000
export const DEFAULT_KUBIOS_SYNC_FINISH_RESERVE_MS = 4_000
export const DEFAULT_KUBIOS_SYNC_RESPONSE_RESERVE_MS = 1_000
const MIN_KUBIOS_SYNC_BUDGET_MS = 50
const MAX_KUBIOS_SYNC_BUDGET_MS = 600_000

const DEFAULT_LEASE_SECONDS = 120
const MIN_LEASE_SECONDS = 5
const MAX_LEASE_SECONDS = 3_600
/** Margen añadido al presupuesto para que el lease no caduque durante la pasada. */
const LEASE_SAFETY_MARGIN_SECONDS = 15
/** Margen local conservador antes de dar por caducado el lease. */
const LEASE_EXPIRY_SAFETY_MS = 1_000
const DEFAULT_RETRY_AFTER_SECONDS = 60
const MIN_RETRY_AFTER_SECONDS = 1
/**
 * Máximo `integer` de PostgreSQL y, por tanto, máximo plazo finito que la RPC
 * de pausa puede persistir con seguridad. Por encima (o con overflow) la pausa
 * debe ser indefinida, nunca un valor recortado.
 */
const MAX_PERSISTABLE_RETRY_AFTER_SECONDS = 2_147_483_647
const MAX_CONCURRENT_MEMBERS = 2
const MAX_CURSOR_MEMBERS = 10_000
/**
 * Plazo máximo de la persistencia del cursor dentro de la reserva de cierre.
 * Deja margen para `kubios_finish_sync`/`kubios_finish_sync_indefinite` aunque
 * la RPC del cursor no responda.
 */
const CURSOR_PERSIST_TIMEOUT_MS = 1_000
const MIN_TIMESTAMP_YEAR = 1970
const MAX_TIMESTAMP_YEAR = 9999
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

const RATE_LIMITED_ERROR_CODE = 'rate_limited'

const TOKEN_STORE_INVALID = 'kubios_sync_token_store_invalid'
const TOKEN_STORE_UNAVAILABLE = 'kubios_sync_token_store_unavailable'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const BYTEA_HEX_PATTERN = /^\\{1,2}x([0-9a-fA-F]*)$/
const BYTEA_HEX_PREFIX = '\\x'
/**
 * Instante ISO-8601 con zona obligatoria, tal como PostgREST serializa un
 * `timestamptz`: `YYYY-MM-DDTHH:mm:ss[.fracción](Z|±hh:mm)`. Se exige la zona
 * porque una cadena sin ella se interpretaría en la zona local del proceso y
 * no representa el instante que devolvió la base. Los componentes se capturan
 * por separado para validarlos antes de construir el instante, sin depender de
 * la normalización permisiva de `Date.parse`.
 */
const ISO_TIMESTAMP_WITH_ZONE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/

/**
 * Códigos de error agregados que se persisten en `kubios_finish_sync`. Cumplen
 * el formato de K09 (`^[a-z0-9]+([._:-][a-z0-9]+)*$`, máximo 64 caracteres) y
 * nunca contienen valores externos.
 */
type KubiosSyncErrorCode =
  | 'config.invalid'
  | 'service.unavailable'
  | 'lease.unavailable'
  | 'token.unavailable'
  | 'team.unavailable'
  | 'team_members.unavailable'
  | 'members.partial'
  | 'cursor.unavailable'
  | 'cursor.persist_failed'
  | 'finish.failed'
  | 'sync.deadline_exceeded'
  | 'sync.internal'

interface OkOutcome {
  readonly status: 'ok'
  readonly synced: number
  readonly failed: number
}

interface LockedOutcome {
  readonly status: 'locked'
}

interface ThrottledOutcome {
  readonly status: 'throttled'
  readonly synced: number
  readonly failed: number
  /** Milisegundos observados; `Infinity` es overflow explícito de K13. */
  readonly retryAfterMs: number | null
}

interface PartialOutcome {
  readonly status: 'partial'
  readonly synced: number
  readonly failed: number
  readonly errorCode: KubiosSyncErrorCode
}

type SyncOutcome = OkOutcome | LockedOutcome | ThrottledOutcome | PartialOutcome

/**
 * Plazos absolutos (epoch ms) derivados del presupuesto total. `work` termina
 * antes de `finish`, y `finish` antes de `hard`, dejando la reserva de
 * respuesta.
 */
interface SyncDeadlines {
  readonly work: number
  readonly finish: number
  readonly hard: number
}

/**
 * Dependencias comunes a toda la pasada, independientes del equipo. La fase de
 * descubrimiento (sin `KUBIOS_TEAM_ID`) las usa antes de adquirir el lease y
 * sin inventar un `teamId` ficticio.
 */
interface SyncCommonContext {
  readonly service: KubiosSyncRpcClient
  readonly owner: string
  readonly env: KubiosEnvSource
  readonly cryptoOptions: KubiosCryptoOptions | undefined
  readonly apiFetch: KubiosApiFetch | undefined
  readonly authFetch: KubiosFetch | undefined
  readonly now: (() => number) | undefined
  readonly timeoutMs: number
  readonly deadlines: SyncDeadlines
  /** Caducidad local estimada del lease; `null` si el reloj no es usable. */
  readonly leaseExpiresAt: number | null
}

interface SyncContext extends SyncCommonContext {
  readonly teamId: string
}

interface RpcOutcome {
  readonly ok: boolean
  readonly data: unknown
  /** La RPC no resolvió antes del plazo; su resultado es desconocido. */
  readonly timedOut: boolean
}

interface RateLimitSignal {
  readonly retryAfterMs: number | null
}

interface ByteaEnvelopeParts {
  readonly keyVersion: number
  readonly nonce: string
  readonly tag: string
  readonly ciphertext: string
}

type MemberSyncOutcome =
  | { readonly kind: 'synced' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'rate_limited'; readonly retryAfterMs: number | null }
  | { readonly kind: 'deadline' }

interface MemberSyncSummary {
  readonly synced: number
  readonly syncedIds: ReadonlySet<string>
  /** Miembros intentados y resueltos como éxito o fallo. */
  readonly attempted: ReadonlySet<string>
  /** Miembros intentados que fallaron (subconjunto de `attempted`). */
  readonly failed: ReadonlySet<string>
  readonly rateLimited: boolean
  readonly retryAfterMs: number | null
  /** Se dejó de programar al menos un miembro por agotar el presupuesto. */
  readonly exhausted: boolean
}

/** Estado durable del cursor, ya normalizado contra el equipo actual. */
interface SyncCursorState {
  readonly nextMemberId: string | null
  readonly attempted: ReadonlySet<string>
  readonly failed: ReadonlySet<string>
}

/** Estado exacto que se persiste al final de la pasada. */
interface SyncCursorTarget {
  readonly nextMemberId: string | null
  readonly attempted: readonly string[]
  readonly failed: readonly string[]
}

type CursorReadOutcome =
  | { readonly ok: true; readonly state: SyncCursorState }
  | { readonly ok: false }

type TokenOutcome =
  | { readonly ok: true; readonly idToken: string }
  | {
      readonly ok: false
      readonly rateLimited: boolean
      readonly retryAfterMs: number | null
      readonly deadlineExceeded: boolean
    }

function internalFailureResult(): KubiosSyncResult {
  return { status: 'partial', synced: 0, failed: 1 }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/* ------------------------------------------------------------------------- *
 * Presupuesto, plazos y carreras acotadas
 * ------------------------------------------------------------------------- */

/**
 * Señal interna de plazo agotado. No se expone al llamador: se traduce a un
 * resultado `partial` con código estático.
 */
class KubiosSyncDeadlineError extends Error {
  readonly code = 'kubios_sync_deadline_exceeded'

  constructor() {
    super('kubios_sync_deadline_exceeded')
    this.name = 'KubiosSyncDeadlineError'
  }
}

function isDeadlineError(error: unknown): boolean {
  return error instanceof KubiosSyncDeadlineError
}

function remainingUntil(deadline: number): number {
  return deadline - Date.now()
}

function hasRemaining(deadline: number): boolean {
  return remainingUntil(deadline) > 0
}

/**
 * Espera una promesa como máximo hasta `deadline` (y opcionalmente hasta un
 * timeout menor). La promesa original queda observada con `.catch` para que un
 * rechazo tardío no se convierta en `unhandledRejection`; si gana el
 * temporizador, se aborta el controlador asociado, aunque la implementación
 * ignore la señal. La escritura que pudiera completarse después queda sujeta
 * al fence owner/lease de las RPC.
 */
async function awaitWithinDeadline<T>(
  operation: PromiseLike<T>,
  deadline: number,
  options: {
    readonly abort?: AbortController
    readonly timeoutMs?: number
  } = {}
): Promise<T> {
  const remaining = remainingUntil(deadline)
  if (!(remaining > 0)) {
    Promise.resolve(operation).catch(() => {})
    throw new KubiosSyncDeadlineError()
  }

  const limit =
    options.timeoutMs === undefined
      ? remaining
      : Math.max(1, Math.min(remaining, Math.floor(options.timeoutMs)))

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        options.abort?.abort()
      } catch {
        // La cancelación es best-effort: el plazo ya decidió la carrera.
      }
      reject(new KubiosSyncDeadlineError())
    }, limit)
  })
  timeout.catch(() => {})

  const observed = Promise.resolve(operation)
  observed.catch(() => {})

  try {
    return await Promise.race([observed, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Presupuesto total acotado a un rango seguro; valores inválidos usan el defecto. */
function resolveBudgetMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_KUBIOS_SYNC_BUDGET_MS
  }
  return Math.min(MAX_KUBIOS_SYNC_BUDGET_MS, Math.max(MIN_KUBIOS_SYNC_BUDGET_MS, Math.floor(value)))
}

/** Reserva acotada al presupuesto disponible; nunca deja plazos negativos. */
function resolveReserveMs(value: unknown, fallback: number, upperBound: number): number {
  const candidate =
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
  return Math.min(Math.max(0, upperBound), candidate)
}

function resolveDeadlines(
  startedAt: number,
  budgetMs: number,
  finishReserveMs: number,
  responseReserveMs: number
): SyncDeadlines {
  const hard = startedAt + budgetMs
  const finish = hard - responseReserveMs
  const work = finish - finishReserveMs
  return { work, finish, hard }
}

/** Reloj de negocio/lease; `null` si el reloj inyectado no devuelve un número. */
function readClock(now: (() => number) | undefined): number | null {
  try {
    const value = now ? now() : Date.now()
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Comprueba localmente que el lease debería seguir vigente. Es una guarda
 * conservadora: la autoridad real es `kubios_finish_sync`, que exige owner y
 * `lease_expires_at > clock_timestamp()`. Si el reloj local no es fiable, se
 * prefiere no cerrar un lease finito antes que atribuirse el de otro.
 */
function leaseIsLikelyValid(context: SyncContext): boolean {
  if (context.leaseExpiresAt === null) return false
  const now = readClock(context.now)
  if (now === null) return false
  return now + LEASE_EXPIRY_SAFETY_MS < context.leaseExpiresAt
}

function resolveEnv(deps: KubiosSyncDeps): KubiosEnvSource {
  if (deps.env !== undefined) return deps.env
  if (typeof process !== 'undefined' && process.env !== undefined) return process.env
  return {}
}

/**
 * `cryptoOptions` inyectadas o, en su defecto, derivadas del mismo `env` con el
 * que se leyó la configuración: nunca se mezclan dos fuentes de clave.
 */
function resolveCryptoOptions(deps: KubiosSyncDeps): KubiosCryptoOptions | undefined {
  if (deps.cryptoOptions !== undefined) return deps.cryptoOptions
  if (deps.env !== undefined) return { env: deps.env }
  return undefined
}

function resolveTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_KUBIOS_TIMEOUT_MS
  }
  return Math.min(MAX_KUBIOS_TIMEOUT_MS, Math.floor(value))
}

/**
 * Lease efectivo: nunca menor que el presupuesto total más un margen. Así el
 * trabajo y la reserva de cierre caben dentro del lease incluso si el llamador
 * pide uno muy corto o inyecta un presupuesto grande (hasta el máximo de la
 * RPC).
 */
function resolveLeaseSeconds(value: unknown, budgetMs: number): number {
  const requested =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_LEASE_SECONDS
  const required = Math.ceil(budgetMs / 1_000) + LEASE_SAFETY_MARGIN_SECONDS
  return Math.min(
    MAX_LEASE_SECONDS,
    Math.max(MIN_LEASE_SECONDS, requested, required)
  )
}

/**
 * Pausa a persistir. `indefinite` no lleva segundos: se representa en la base
 * con `next_allowed_at = 'infinity'`, no con un número centinela.
 */
type RetryAfterPause =
  | { readonly kind: 'finite'; readonly seconds: number }
  | { readonly kind: 'indefinite' }

/**
 * Milisegundos observados -> pausa a persistir.
 *
 * - `null` (cabecera ausente o inválida): pausa prudente por defecto.
 * - `Infinity` (overflow explícito de K13): pausa indefinida, nunca 60 s.
 * - Finito dentro de `integer`: segundos exactos, sin recortar a un día.
 * - Finito fuera de `integer` o no representable con seguridad: indefinida.
 */
function resolveRetryAfterPause(retryAfterMs: number | null): RetryAfterPause {
  if (retryAfterMs === null) {
    return { kind: 'finite', seconds: DEFAULT_RETRY_AFTER_SECONDS }
  }
  if (retryAfterMs === Number.POSITIVE_INFINITY) return { kind: 'indefinite' }
  if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
    // NaN, -Infinity o negativos no provienen de K13; se degradan a la espera
    // prudente en lugar de inventar una pausa indefinida.
    return { kind: 'finite', seconds: DEFAULT_RETRY_AFTER_SECONDS }
  }

  const seconds = Math.ceil(retryAfterMs / 1000)
  if (!Number.isSafeInteger(seconds) || seconds > MAX_PERSISTABLE_RETRY_AFTER_SECONDS) {
    return { kind: 'indefinite' }
  }
  return { kind: 'finite', seconds: Math.max(MIN_RETRY_AFTER_SECONDS, seconds) }
}

/**
 * Conserva la espera mayor observada. `Infinity` es un valor válido y gana a
 * cualquier plazo finito; solo se descartan `null`, negativos y `NaN`.
 */
function maxRetryAfterMs(current: number | null, next: number | null): number | null {
  if (next === null) return current
  if (next !== Number.POSITIVE_INFINITY && (!Number.isFinite(next) || next < 0)) {
    return current
  }
  if (current === null) return next
  return Math.max(current, next)
}

/**
 * Lee `retryAfterMs` de un error 429 de K13. `Infinity` se conserva como
 * overflow explícito: convertirlo en `null` haría que la pausa se degradara a
 * la espera por defecto, que es precisamente el fallo a evitar.
 */
function readRateLimitSignal(error: unknown): RateLimitSignal | null {
  if (!isPlainRecord(error)) return null
  if (error.code !== 'rate_limited') return null

  const candidate = error.retryAfterMs
  let retryAfterMs: number | null = null
  if (candidate === Number.POSITIVE_INFINITY) {
    retryAfterMs = Number.POSITIVE_INFINITY
  } else if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
    retryAfterMs = candidate
  }
  return { retryAfterMs }
}

function readRetryAfterHeader(
  response: { readonly headers?: { get(name: string): string | null } | null } | null | undefined
): number | null {
  try {
    const value = response?.headers?.get('retry-after')
    return parseRetryAfterHeader(typeof value === 'string' ? value : null)
  } catch {
    return null
  }
}

async function callRpc(
  service: KubiosSyncRpcClient,
  name: string,
  args: Readonly<Record<string, unknown>>,
  deadline: number
): Promise<RpcOutcome> {
  try {
    const response = await awaitWithinDeadline(service.rpc(name, args), deadline)
    if (!isPlainRecord(response)) return { ok: false, data: undefined, timedOut: false }
    if (response.error !== null && response.error !== undefined) {
      return { ok: false, data: undefined, timedOut: false }
    }
    return { ok: true, data: response.data, timedOut: false }
  } catch (error) {
    return { ok: false, data: undefined, timedOut: isDeadlineError(error) }
  }
}

function readEnvValue(env: KubiosEnvSource, name: string): string {
  const value = env[name]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Crea el cliente de servicio solo después de validar la URL y la clave. La
 * validación ocurre antes de importar/construir el cliente, de modo que una
 * configuración inválida no envía la credencial ni abre red. No hay valores
 * por defecto y no se lee ningún archivo `.env`.
 */
async function createServiceClient(env: KubiosEnvSource): Promise<KubiosSyncRpcClient | null> {
  const url = readEnvValue(env, 'NEXT_PUBLIC_SUPABASE_URL') || readEnvValue(env, 'SUPABASE_URL')
  const serviceRoleKey = readEnvValue(env, 'SUPABASE_SERVICE_ROLE_KEY')
  const config = resolveKubiosSupabaseConfig(url, serviceRoleKey)
  if (!config.ok) return null

  try {
    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(config.url, config.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    const rpc = (
      client.rpc as unknown as (
        name: string,
        args: Readonly<Record<string, unknown>>
      ) => PromiseLike<KubiosSyncRpcResponse>
    ).bind(client)

    return { rpc }
  } catch {
    return null
  }
}

function createOwner(factory: (() => string) | undefined): string | null {
  try {
    const owner = (factory ?? generateRandomUuid)()
    return isUuid(owner) ? owner : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------------- *
 * Cursor durable por equipo (K44)
 * ------------------------------------------------------------------------- */

function normalizeMemberId(value: string): string {
  return value.toLowerCase()
}

/**
 * Lee un array `uuid[]` de PostgREST. Exige UUID válidos, sin duplicados y sin
 * nulos; cualquier otra forma se rechaza para no persistir un cursor ambiguo.
 */
function readCursorMemberIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (!isUuid(candidate)) return null
    const id = normalizeMemberId(candidate)
    if (seen.has(id)) return null
    seen.add(id)
    normalized.push(id)
  }
  return normalized
}

/**
 * Cursor del equipo. Solo un array vacío (equipo sin fila de cursor) se
 * interpreta como una pasada nueva; `null`, `undefined` o cualquier forma que
 * no sea un array fallan cerrado (SYNC-03): una lectura incompleta no puede
 * confundirse con un cursor recién creado, porque eso saltaría el reparto
 * justo entre pasadas y podría dar `ok` sin evidencia. Un estado incoherente
 * (fallos fuera de los intentados o cursor ya intentado) también falla cerrado:
 * la pasada será `partial` y no moverá el cursor.
 */
async function readSyncCursor(context: SyncContext): Promise<CursorReadOutcome> {
  const response = await callRpc(
    context.service,
    CURSOR_READ_RPC,
    { p_team_id: context.teamId },
    context.deadlines.work
  )
  if (!response.ok) return { ok: false }

  const rows = response.data
  const empty: SyncCursorState = {
    nextMemberId: null,
    attempted: new Set<string>(),
    failed: new Set<string>()
  }
  if (!Array.isArray(rows)) return { ok: false }
  if (rows.length === 0) return { ok: true, state: empty }
  if (rows.length !== 1 || !isPlainRecord(rows[0])) return { ok: false }

  const rawNext = rows[0].next_member_id
  if (rawNext !== null && rawNext !== undefined && !isUuid(rawNext)) {
    return { ok: false }
  }
  const attempted = readCursorMemberIds(rows[0].attempted_member_ids)
  const failed = readCursorMemberIds(rows[0].failed_member_ids)
  if (attempted === null || failed === null) return { ok: false }

  const attemptedSet = new Set(attempted)
  const failedSet = new Set(failed)
  for (const id of failedSet) {
    if (!attemptedSet.has(id)) return { ok: false }
  }

  const nextMemberId = rawNext === null || rawNext === undefined ? null : normalizeMemberId(rawNext)
  if (nextMemberId !== null && attemptedSet.has(nextMemberId)) return { ok: false }

  return {
    ok: true,
    state: { nextMemberId, attempted: attemptedSet, failed: failedSet }
  }
}

/**
 * Persiste el cursor antes de liberar el lease. La RPC bloquea el estado del
 * equipo y exige owner y lease vigente; un `false` (owner caducado, reemplazado
 * o sin lease) no se interpreta como éxito. Además se evita llamar cuando el
 * reloj local ya considera caducado el lease.
 */
async function persistSyncCursor(
  context: SyncContext,
  target: SyncCursorTarget
): Promise<boolean> {
  if (
    target.attempted.length > MAX_CURSOR_MEMBERS ||
    target.failed.length > MAX_CURSOR_MEMBERS
  ) {
    return false
  }
  if (!leaseIsLikelyValid(context)) return false

  // La persistencia no puede consumir toda la reserva de cierre: se acota a
  // 1 s para que finish conserve su margen.
  const cursorDeadline = Math.min(
    context.deadlines.finish,
    Date.now() + CURSOR_PERSIST_TIMEOUT_MS
  )

  const response = await callRpc(
    context.service,
    CURSOR_ADVANCE_RPC,
    {
      p_team_id: context.teamId,
      p_lease_owner: context.owner,
      p_next_member_id: target.nextMemberId,
      p_attempted_member_ids: [...target.attempted],
      p_failed_member_ids: [...target.failed]
    },
    cursorDeadline
  )
  return response.ok && response.data === true
}

/** Miembros del proveedor clasificados para la pasada. */
interface CollectedMemberIds {
  /** UUID únicos y normalizados, en orden lexicográfico estable. */
  readonly ordered: readonly string[]
  /** Entradas sin `team_user_id` o con un valor que no es UUID. */
  readonly invalid: number
}

/**
 * Orden estable del equipo: UUID válidos, únicos y ordenados de forma
 * lexicográfica. El proveedor puede reordenar o repetir; el orden de trabajo no
 * depende de esa respuesta ni de ningún input de sesión.
 *
 * Las entradas cuyo `team_user_id` falta o no es un UUID no se descartan en
 * silencio (SYNC-01): se cuentan aparte para que la pasada no pueda declararse
 * `ok` mientras haya miembros no identificables. Un UUID repetido entra una
 * sola vez en `ordered` y no cuenta como inválido.
 */
function collectOrderedMemberIds(members: readonly KubiosTeamMember[]): CollectedMemberIds {
  const unique = new Set<string>()
  let invalid = 0
  for (const member of members) {
    const candidate = isPlainRecord(member) ? member.team_user_id : undefined
    if (isUuid(candidate)) unique.add(normalizeMemberId(candidate))
    else invalid += 1
  }
  return { ordered: [...unique].sort(), invalid }
}

/**
 * Primer miembro no intentado en orden cíclico. Si el cursor apunta a un
 * miembro que ya no existe, se reanuda por el primer UUID mayor (con vuelta al
 * principio). Si todos los vigentes ya se intentaron, se empieza una pasada
 * nueva por el principio.
 */
function resolveCursorStartIndex(
  ordered: readonly string[],
  cursor: SyncCursorState
): number {
  if (ordered.length === 0) return 0

  let base = 0
  const nextMemberId = cursor.nextMemberId
  if (nextMemberId !== null) {
    const exact = ordered.indexOf(nextMemberId)
    if (exact >= 0) {
      base = exact
    } else {
      const successor = ordered.findIndex((id) => id > nextMemberId)
      base = successor >= 0 ? successor : 0
    }
  }

  for (let offset = 0; offset < ordered.length; offset += 1) {
    const index = (base + offset) % ordered.length
    const memberId = ordered[index]
    if (memberId !== undefined && !cursor.attempted.has(memberId)) return index
  }
  return 0
}

/* ------------------------------------------------------------------------- *
 * Conversión bytea / sobre cifrado
 * ------------------------------------------------------------------------- */

/**
 * Acepta el formato de bytea de PostgREST (`\x...`, con una o dos barras
 * invertidas) y también `Buffer`/`Uint8Array`. Devuelve `null` si no es válido.
 */
function parseBytea(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value.length > 0 ? Buffer.from(value) : null
  if (value instanceof Uint8Array) return value.length > 0 ? Buffer.from(value) : null
  if (typeof value !== 'string') return null

  const match = BYTEA_HEX_PATTERN.exec(value)
  const hex = match?.[1]
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0) return null
  return Buffer.from(hex, 'hex')
}

function readBytea(value: unknown, expectedLength: number | null, minimumLength = 1): Buffer | null {
  const buffer = parseBytea(value)
  if (buffer === null) return null
  if (expectedLength !== null) return buffer.length === expectedLength ? buffer : null
  return buffer.length >= minimumLength ? buffer : null
}

function toByteaHex(bytes: Buffer): string {
  return `${BYTEA_HEX_PREFIX}${bytes.toString('hex')}`
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

/** Días reales del mes `month` (1-12), incluido febrero bisiesto. */
function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29
  return DAYS_IN_MONTH[month - 1] ?? 0
}

/** Rango razonable para fechas persistidas: entero seguro y año 1970..9999. */
function toSafeTimestamp(milliseconds: unknown): number | null {
  if (typeof milliseconds !== 'number' || !Number.isSafeInteger(milliseconds)) return null

  const date = new Date(milliseconds)
  const time = date.getTime()
  if (!Number.isFinite(time)) return null

  const year = date.getUTCFullYear()
  if (!Number.isFinite(year) || year < MIN_TIMESTAMP_YEAR || year > MAX_TIMESTAMP_YEAR) {
    return null
  }

  return time
}

/** `expires_at` de K36 puede llegar como ISO o como `Date`. */
function parseExpiresAt(value: unknown): number | null {
  if (value instanceof Date) return toSafeTimestamp(value.getTime())
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) return null
  return toSafeTimestamp(parsed)
}

/**
 * Valida el escalar que devuelve `kubios_write_snapshot` (`returns
 * timestamptz`). Solo una cadena no vacía con instante ISO-8601 y zona, con
 * año/mes/día reales (bisiestos incluidos), hora 00-23, minuto y segundo
 * 00-59, offset `±hh:mm` sintácticamente válido (horas 00-23, minutos 00-59)
 * y epoch resultante dentro del rango 1970..9999, cuenta como escritura
 * confirmada. Los componentes se validan antes de construir el instante: una
 * fecha imposible no se normaliza ni se acepta por el desbordamiento de
 * `Date.parse`/`Date.UTC`. `null`, `undefined`, números, booleanos, arrays,
 * objetos, cadenas vacías y fechas imposibles se rechazan: un
 * `{ data: null, error: null }` de PostgREST no es una confirmación.
 */
function parseSnapshotTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const match = ISO_TIMESTAMP_WITH_ZONE_PATTERN.exec(trimmed)
  if (match === null) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hours = Number(match[4])
  const minutes = Number(match[5])
  const seconds = Number(match[6])
  const fraction = match[7]

  // El rango 1970..9999 se comprueba antes de `Date.UTC`: así los años de
  // cuatro cifras no pasan por el mapeo 0-99 -> 1900-1999 y ninguna fecha
  // fuera de rango llega a normalizarse.
  if (year < MIN_TIMESTAMP_YEAR || year > MAX_TIMESTAMP_YEAR) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hours > 23 || minutes > 59 || seconds > 59) return null

  let offsetMs = 0
  if (match[8] !== undefined) {
    const offsetHours = Number(match[9])
    const offsetMinutes = Number(match[10])
    // Rango sintáctico de la zona: no se aceptan +24:00 ni +00:60 aunque la
    // fecha sea válida.
    if (offsetHours > 23 || offsetMinutes > 59) return null
    const sign = match[8] === '-' ? -1 : 1
    offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60_000
  }

  // La fracción ISO puede tener 1-9 dígitos; el epoch solo conserva
  // milisegundos, así que se trunca sin redondear (no altera la validez).
  const milliseconds =
    fraction === undefined ? 0 : Number(fraction.slice(0, 3).padEnd(3, '0'))

  const timestamp =
    Date.UTC(year, month - 1, day, hours, minutes, seconds, milliseconds) - offsetMs
  return toSafeTimestamp(timestamp)
}

/** Convierte `expiresAt` a ISO solo después de validar el rango. */
function toIsoTimestamp(milliseconds: unknown): string | null {
  const safe = toSafeTimestamp(milliseconds)
  if (safe === null) return null
  return new Date(safe).toISOString()
}

/**
 * Sobre base64 -> partes bytea `\x` hex. El orden del sobre es
 * `[versión, nonce, tag, ciphertext]`; se validan versión 1, nonce de 12 bytes,
 * tag de 16 y ciphertext no vacío.
 */
function splitEnvelopeForBytea(envelope: unknown): ByteaEnvelopeParts {
  if (
    typeof envelope !== 'string' ||
    envelope.length === 0 ||
    envelope.length % 4 !== 0 ||
    !BASE64_PATTERN.test(envelope)
  ) {
    throw new Error(TOKEN_STORE_INVALID)
  }

  const bytes = Buffer.from(envelope, 'base64')
  if (bytes.toString('base64') !== envelope) throw new Error(TOKEN_STORE_INVALID)

  const minimumLength = 1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES + 1
  if (bytes.length < minimumLength) throw new Error(TOKEN_STORE_INVALID)

  const keyVersion = bytes.readUInt8(0)
  if (keyVersion !== KUBIOS_KEY_VERSION) throw new Error(TOKEN_STORE_INVALID)

  const nonce = bytes.subarray(1, 1 + KUBIOS_NONCE_BYTES)
  const tag = bytes.subarray(
    1 + KUBIOS_NONCE_BYTES,
    1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES
  )
  const ciphertext = bytes.subarray(1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES)

  if (
    nonce.length !== KUBIOS_NONCE_BYTES ||
    tag.length !== KUBIOS_AUTH_TAG_BYTES ||
    ciphertext.length === 0
  ) {
    throw new Error(TOKEN_STORE_INVALID)
  }

  return {
    keyVersion,
    nonce: toByteaHex(nonce),
    tag: toByteaHex(tag),
    ciphertext: toByteaHex(ciphertext)
  }
}

/** Fila K36 -> sobre base64, o error fijo si la fila no es utilizable. */
function rowToStoredToken(row: unknown): KubiosStoredToken {
  if (!isPlainRecord(row)) throw new Error(TOKEN_STORE_INVALID)

  if (row.key_version !== KUBIOS_KEY_VERSION) throw new Error(TOKEN_STORE_INVALID)

  const nonce = readBytea(row.nonce, KUBIOS_NONCE_BYTES)
  const tag = readBytea(row.tag, KUBIOS_AUTH_TAG_BYTES)
  const ciphertext = readBytea(row.ciphertext, null, 1)
  const expiresAt = parseExpiresAt(row.expires_at)

  if (nonce === null || tag === null || ciphertext === null || expiresAt === null) {
    throw new Error(TOKEN_STORE_INVALID)
  }

  const envelope = Buffer.concat([
    Buffer.from([KUBIOS_KEY_VERSION]),
    nonce,
    tag,
    ciphertext
  ]).toString('base64')

  return { envelope, expiresAt }
}

/* ------------------------------------------------------------------------- *
 * Persistencia del token (K36) y del lease
 * ------------------------------------------------------------------------- */

function assertTokenScope(scope: KubiosTokenScope, teamId: string): void {
  if (!isPlainRecord(scope)) throw new Error(TOKEN_STORE_INVALID)
  if (typeof scope.teamId !== 'string' || typeof scope.memberId !== 'string') {
    throw new Error(TOKEN_STORE_INVALID)
  }
  if (scope.memberId !== scope.teamId) throw new Error(TOKEN_STORE_INVALID)
  if (scope.teamId !== teamId) throw new Error(TOKEN_STORE_INVALID)
}

/**
 * `KubiosTokenStore` respaldado por K36. El scope del token exige
 * `memberId === teamId`; un fallo de lectura/escritura se traduce en
 * `store_read_failed`/`store_write_failed` dentro de `KubiosAuthClient`, de
 * modo que una fila inválida nunca se sobrescribe en silencio.
 */
function createTokenStore(context: SyncContext): KubiosTokenStore {
  return {
    async read(scope: KubiosTokenScope): Promise<KubiosStoredToken | null> {
      assertTokenScope(scope, context.teamId)

      const response = await callRpc(
        context.service,
        TOKEN_READ_RPC,
        { p_team_id: scope.teamId },
        context.deadlines.work
      )
      if (!response.ok) throw new Error(TOKEN_STORE_UNAVAILABLE)

      const rows = response.data
      if (rows === null || rows === undefined) return null
      if (!Array.isArray(rows)) throw new Error(TOKEN_STORE_INVALID)
      if (rows.length === 0) return null
      if (rows.length !== 1) throw new Error(TOKEN_STORE_INVALID)

      return rowToStoredToken(rows[0])
    },

    async write(scope: KubiosTokenScope, token: KubiosStoredToken): Promise<void> {
      assertTokenScope(scope, context.teamId)

      if (!isPlainRecord(token)) throw new Error(TOKEN_STORE_INVALID)

      const expiresAt = toIsoTimestamp(token.expiresAt)
      if (expiresAt === null) throw new Error(TOKEN_STORE_INVALID)

      const parts = splitEnvelopeForBytea(token.envelope)

      const response = await callRpc(
        context.service,
        TOKEN_WRITE_RPC,
        {
          p_team_id: scope.teamId,
          p_lease_owner: context.owner,
          p_ciphertext: parts.ciphertext,
          p_nonce: parts.nonce,
          p_tag: parts.tag,
          p_key_version: parts.keyVersion,
          p_expires_at: expiresAt
        },
        context.deadlines.work
      )
      if (!response.ok) throw new Error(TOKEN_STORE_UNAVAILABLE)
    }
  }
}

/* ------------------------------------------------------------------------- *
 * Token (K12) con fetch acotado
 * ------------------------------------------------------------------------- */

/**
 * Envuelve el `fetch` del login con un `AbortController` y una carrera contra
 * el plazo de trabajo. Añade `signal` al `RequestInit`, limpia el temporizador
 * en `finally` y observa un 429 para poder persistir la pausa, sin exponer la
 * respuesta al llamador. Un `fetch` que ignore la señal no alarga la espera:
 * gana el temporizador y el `finally` retira el listener del llamador.
 */
function createBoundedAuthFetch(
  candidate: KubiosFetch | undefined,
  timeoutMs: number,
  deadline: number,
  onRateLimited: (retryAfterMs: number | null) => void
): KubiosFetch | undefined {
  const implementation: KubiosFetch | null =
    typeof candidate === 'function'
      ? candidate
      : typeof globalThis.fetch === 'function'
        ? (globalThis.fetch as unknown as KubiosFetch)
        : null

  if (implementation === null) return undefined

  return async (input: string, init: RequestInit): Promise<Response> => {
    const options: RequestInit = init ?? {}
    const controller = new AbortController()
    const upstream = options.signal ?? null
    const abortFromUpstream = () => controller.abort()

    if (upstream !== null) {
      if (upstream.aborted) controller.abort()
      else upstream.addEventListener('abort', abortFromUpstream, { once: true })
    }

    try {
      const response = await awaitWithinDeadline(
        implementation(input, { ...options, signal: controller.signal }),
        deadline,
        { abort: controller, timeoutMs }
      )

      if (isPlainRecord(response) && response.status === 429) {
        onRateLimited(readRetryAfterHeader(response as { headers?: { get(name: string): string | null } }))
      }

      return response
    } finally {
      if (upstream !== null) upstream.removeEventListener('abort', abortFromUpstream)
    }
  }
}

async function acquireIdToken(context: SyncContext): Promise<TokenOutcome> {
  let rateLimited = false
  let retryAfterMs: number | null = null

  const authFetch = createBoundedAuthFetch(
    context.authFetch,
    context.timeoutMs,
    context.deadlines.work,
    (observed) => {
      rateLimited = true
      retryAfterMs = maxRetryAfterMs(retryAfterMs, observed)
    }
  )

  const client = new KubiosAuthClient({
    memberId: context.teamId,
    store: createTokenStore(context),
    fetch: authFetch,
    now: context.now,
    env: context.env,
    cryptoOptions: context.cryptoOptions,
    // El timeout propio del login nunca debe superar el plazo restante.
    loginTimeoutMs: Math.max(1, remainingUntil(context.deadlines.work))
  })

  let result: Awaited<ReturnType<KubiosAuthClient['getToken']>> | null = null
  try {
    result = await client.getToken()
  } catch {
    return {
      ok: false,
      rateLimited,
      retryAfterMs,
      deadlineExceeded: !hasRemaining(context.deadlines.work)
    }
  }

  if (result !== null && result.ok === true && typeof result.idToken === 'string' && result.idToken.length > 0) {
    return { ok: true, idToken: result.idToken }
  }

  return {
    ok: false,
    rateLimited,
    retryAfterMs,
    deadlineExceeded: !hasRemaining(context.deadlines.work)
  }
}

/* ------------------------------------------------------------------------- *
 * Descubrimiento del equipo sin KUBIOS_TEAM_ID
 * ------------------------------------------------------------------------- */

interface ResolvedTeamToken {
  readonly teamId: string
  readonly idToken: string
  readonly expiresAt: number
}

type ResolvedTeamOutcome =
  | { readonly ok: true; readonly token: ResolvedTeamToken }
  | { readonly ok: false }

/**
 * Fase previa al lease cuando `KUBIOS_TEAM_ID` no está configurado:
 * login sin persistencia, `GET /v1/user/self` y selección explícita de
 * `Diabetes Tracker - H2TRAIN` en `user.teams[]`.
 *
 * No escribe en el store ni llama a ninguna RPC: cualquier fallo (login,
 * user/self, respuesta malformada, equipo objetivo ausente, nombre ambiguo,
 * equipo no UUID, 429 o plazo agotado) devuelve `ok: false` y el llamador
 * responde `partial` sin adquirir lease ni persistir una pausa. Nunca se elige
 * el primer equipo ni uno distinto por conveniencia.
 */
async function resolveTeamAndToken(common: SyncCommonContext): Promise<ResolvedTeamOutcome> {
  if (!hasRemaining(common.deadlines.work)) return { ok: false }

  const authFetch = createBoundedAuthFetch(
    common.authFetch,
    common.timeoutMs,
    common.deadlines.work,
    () => {
      // Un 429 antes del lease no se persiste como pausa: se falla cerrado.
    }
  )

  const authClient = new KubiosAuthClient({
    fetch: authFetch,
    now: common.now,
    env: common.env,
    cryptoOptions: common.cryptoOptions,
    persistLogin: false,
    // El timeout propio del login nunca debe superar el plazo restante.
    loginTimeoutMs: Math.max(1, remainingUntil(common.deadlines.work))
  })

  let authResult: Awaited<ReturnType<KubiosAuthClient['getToken']>>
  try {
    authResult = await authClient.getToken()
  } catch {
    return { ok: false }
  }

  if (
    authResult.ok !== true ||
    typeof authResult.idToken !== 'string' ||
    authResult.idToken.length === 0
  ) {
    return { ok: false }
  }

  if (!hasRemaining(common.deadlines.work)) return { ok: false }

  const requestTimeoutMs = Math.max(
    1,
    Math.min(common.timeoutMs, Math.floor(remainingUntil(common.deadlines.work)))
  )
  const controller = new AbortController()

  let selection: Awaited<ReturnType<typeof resolveKubiosTeam>>
  try {
    selection = await awaitWithinDeadline(
      resolveKubiosTeam(authResult.idToken, {
        fetch: common.apiFetch,
        timeoutMs: requestTimeoutMs,
        signal: controller.signal
      }),
      common.deadlines.work,
      { abort: controller }
    )
  } catch {
    return { ok: false }
  }

  // Sin override, solo se acepta el equipo objetivo por nombre exacto. Una
  // ausencia o ambigüedad falla antes de adquirir el lease.
  if (!selection.ok) return { ok: false }
  // Las RPC K10/K35/K36 declaran `uuid`: no se adquiere lease con otro valor.
  if (!isUuid(selection.teamId)) return { ok: false }

  return {
    ok: true,
    token: {
      teamId: selection.teamId,
      idToken: authResult.idToken,
      expiresAt: authResult.expiresAt
    }
  }
}

/** Persiste el token ya autenticado bajo el equipo resuelto, tras el lease. */
async function persistResolvedToken(
  context: SyncContext,
  resolved: ResolvedTeamToken
): Promise<boolean> {
  const client = new KubiosAuthClient({
    memberId: resolved.teamId,
    teamId: resolved.teamId,
    store: createTokenStore(context),
    now: context.now,
    env: context.env,
    cryptoOptions: context.cryptoOptions
  })

  try {
    const result = await client.persistToken(resolved.teamId, {
      idToken: resolved.idToken,
      expiresAt: resolved.expiresAt
    })
    return result.ok === true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------------- *
 * Miembros y snapshots
 * ------------------------------------------------------------------------- */

async function syncMember(
  context: SyncContext,
  memberId: string,
  idToken: string
): Promise<MemberSyncOutcome> {
  const candidate = memberId
  if (!isUuid(candidate)) return { kind: 'failed' }
  if (!hasRemaining(context.deadlines.work)) return { kind: 'deadline' }

  // El timeout propio de K13 también se recorta al plazo restante para que su
  // temporizador no quede vivo 15 s si gana la carrera externa.
  const requestTimeoutMs = Math.max(
    1,
    Math.min(context.timeoutMs, Math.floor(remainingUntil(context.deadlines.work)))
  )

  let page: Awaited<ReturnType<typeof fetchKubiosHrvResults>>
  const controller = new AbortController()
  try {
    page = await awaitWithinDeadline(
      fetchKubiosHrvResults(candidate, idToken, {
        fetch: context.apiFetch,
        timeoutMs: requestTimeoutMs,
        signal: controller.signal
      }),
      context.deadlines.work,
      { abort: controller }
    )
  } catch (error) {
    const signal = readRateLimitSignal(error)
    if (signal !== null) return { kind: 'rate_limited', retryAfterMs: signal.retryAfterMs }
    if (isDeadlineError(error) || !hasRemaining(context.deadlines.work)) {
      return { kind: 'deadline' }
    }
    // 401/403/404 y cualquier otro fallo de un miembro: fallo individual.
    return { kind: 'failed' }
  }

  const results: unknown = isPlainRecord(page) ? page.results : undefined
  if (!Array.isArray(results) || !results.every(isPlainRecord)) return { kind: 'failed' }
  if (!hasRemaining(context.deadlines.work)) return { kind: 'deadline' }

  let envelope: string
  try {
    envelope = encryptKubiosSnapshot(
      JSON.stringify({ results }),
      { teamId: context.teamId, memberId: candidate },
      context.cryptoOptions
    )
  } catch {
    return { kind: 'failed' }
  }

  let parts: ByteaEnvelopeParts
  try {
    parts = splitEnvelopeForBytea(envelope)
  } catch {
    return { kind: 'failed' }
  }

  const response = await callRpc(
    context.service,
    SNAPSHOT_WRITE_RPC,
    {
      p_team_id: context.teamId,
      p_member_id: candidate,
      p_lease_owner: context.owner,
      p_ciphertext: parts.ciphertext,
      p_nonce: parts.nonce,
      p_tag: parts.tag,
      p_key_version: parts.keyVersion
    },
    context.deadlines.work
  )

  if (response.timedOut) return { kind: 'deadline' }
  if (!response.ok) return { kind: 'failed' }
  // `kubios_write_snapshot` devuelve `timestamptz`: solo un timestamp escalar
  // válido confirma el upsert. Un `{ data: null, error: null }` (o cualquier
  // forma no reconocida) es un fallo, no un snapshot guardado. No se reintenta
  // aquí: una segunda escritura podría duplicar efectos y el snapshot previo se
  // conserva tal cual, porque la RPC no confirmó el reemplazo.
  if (parseSnapshotTimestamp(response.data) === null) return { kind: 'failed' }
  return { kind: 'synced' }
}

/**
 * Pool de como máximo dos workers sobre el orden pendiente de la pasada.
 * Los offsets se reservan de uno en uno. Un miembro reservado se considera
 * intentado salvo que su intento termine por plazo o 429: en esos casos su
 * resultado es desconocido (o la API está limitada) y queda como primer
 * pendiente de la siguiente ejecución. Al detectar un 429 o agotarse el
 * presupuesto se deja de reservar y se espera solo a lo ya iniciado.
 */
async function syncMembers(
  context: SyncContext,
  pending: readonly string[],
  idToken: string
): Promise<MemberSyncSummary> {
  let nextIndex = 0
  let stopped = false
  let synced = 0
  let rateLimited = false
  let retryAfterMs: number | null = null
  let exhausted = false

  const syncedIds = new Set<string>()
  const attempted = new Set<string>()
  const failed = new Set<string>()

  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopped) return
      const index = nextIndex
      // Sin miembros pendientes no se marca agotamiento: el trabajo real
      // terminó, aunque el plazo esté a punto de vencer.
      if (index >= pending.length) return
      if (!hasRemaining(context.deadlines.work)) {
        exhausted = true
        stopped = true
        return
      }
      nextIndex += 1

      const memberId = pending[index]
      if (memberId === undefined) return
      const outcome = await syncMember(context, memberId, idToken)
      if (outcome.kind === 'deadline') {
        // El miembro no se considera intentado: su resultado es desconocido y
        // vuelve a ser el primero pendiente de la siguiente pasada.
        exhausted = true
        stopped = true
        return
      }
      if (outcome.kind === 'rate_limited') {
        // Un 429 detiene la pasada sin nuevos intentos y no avanza como si el
        // miembro se hubiera procesado.
        rateLimited = true
        retryAfterMs = maxRetryAfterMs(retryAfterMs, outcome.retryAfterMs)
        stopped = true
        return
      }

      attempted.add(memberId)
      if (outcome.kind === 'synced') {
        synced += 1
        syncedIds.add(memberId)
      } else {
        failed.add(memberId)
      }
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_MEMBERS, pending.length)
  const workers: Promise<void>[] = []
  for (let index = 0; index < workerCount; index += 1) workers.push(worker())
  await Promise.all(workers)

  return { synced, syncedIds, attempted, failed, rateLimited, retryAfterMs, exhausted }
}

async function synchronize(
  context: SyncContext,
  resolvedToken?: ResolvedTeamToken
): Promise<SyncOutcome> {
  if (!hasRemaining(context.deadlines.work)) {
    return { status: 'partial', synced: 0, failed: 1, errorCode: 'sync.deadline_exceeded' }
  }

  let idToken: string
  if (resolvedToken !== undefined) {
    // Token recién autenticado en la fase de descubrimiento: no se lee el store
    // ni se vuelve a autenticar.
    idToken = resolvedToken.idToken
  } else {
    const token = await acquireIdToken(context)
    if (!token.ok) {
      if (token.rateLimited) {
        return {
          status: 'throttled',
          synced: 0,
          failed: 1,
          retryAfterMs: token.retryAfterMs
        }
      }
      if (token.deadlineExceeded) {
        return { status: 'partial', synced: 0, failed: 1, errorCode: 'sync.deadline_exceeded' }
      }
      return { status: 'partial', synced: 0, failed: 1, errorCode: 'token.unavailable' }
    }
    idToken = token.idToken
  }

  let members: readonly KubiosTeamMember[]
  const controller = new AbortController()
  const requestTimeoutMs = Math.max(
    1,
    Math.min(context.timeoutMs, Math.floor(remainingUntil(context.deadlines.work)))
  )
  try {
    const page = await awaitWithinDeadline(
      fetchKubiosTeamMembers(context.teamId, idToken, {
        fetch: context.apiFetch,
        timeoutMs: requestTimeoutMs,
        signal: controller.signal
      }),
      context.deadlines.work,
      { abort: controller }
    )
    members = page.members
  } catch (error) {
    const signal = readRateLimitSignal(error)
    if (signal !== null) {
      return { status: 'throttled', synced: 0, failed: 1, retryAfterMs: signal.retryAfterMs }
    }
    if (isDeadlineError(error) || !hasRemaining(context.deadlines.work)) {
      return { status: 'partial', synced: 0, failed: 1, errorCode: 'sync.deadline_exceeded' }
    }
    return { status: 'partial', synced: 0, failed: 1, errorCode: 'team_members.unavailable' }
  }

  // Un equipo sin miembros (o con resultados vacíos) es un éxito legítimo y no
  // mueve el cursor durable.
  if (members.length === 0) return { status: 'ok', synced: 0, failed: 0 }

  const cursor = await readSyncCursor(context)
  if (!cursor.ok) {
    // Sin cursor no se puede garantizar el reparto justo entre pasadas: se falla
    // cerrado sin escribir snapshots ni mover el estado.
    return { status: 'partial', synced: 0, failed: 1, errorCode: 'cursor.unavailable' }
  }

  const collected = collectOrderedMemberIds(members)
  const ordered = collected.ordered
  // Las entradas sin UUID no se pueden sincronizar ni persistir en el cursor
  // (`uuid[]`). Se cuentan como fallos de la pasada y se recuentan en cada
  // ejecución a partir del listado del proveedor, sin bucle dentro de esta
  // pasada. Los UUID válidos se procesan con normalidad.
  const unidentifiable = collected.invalid

  if (ordered.length === 0) {
    // Sin UUID válidos no hay cursor posible ni escrituras que hacer. Se
    // conserva el fallo individual por miembro y no se toca el estado durable.
    return {
      status: 'partial',
      synced: 0,
      failed: Math.max(1, members.length),
      errorCode: 'members.partial'
    }
  }

  // Normaliza el estado contra los miembros vigentes: un miembro que ya no
  // existe no bloquea la pasada ni se conserva como fallo pendiente.
  const orderedSet = new Set(ordered)
  const attempted = new Set([...cursor.state.attempted].filter((id) => orderedSet.has(id)))
  const failed = new Set([...cursor.state.failed].filter((id) => attempted.has(id)))
  let nextMemberId = cursor.state.nextMemberId

  // Si una bajada del grupo deja todos los vigentes ya intentados, la pasada
  // anterior está completa para el grupo actual: se reinicia el ciclo. Si había
  // fallos, se reanuda por el primero de ellos.
  if (attempted.size >= ordered.length) {
    if (failed.size > 0) {
      const firstFailed = [...failed].sort()[0]
      if (firstFailed !== undefined) nextMemberId = firstFailed
      attempted.clear()
      failed.clear()
    } else {
      nextMemberId = null
      attempted.clear()
      failed.clear()
    }
  }

  const cursorState: SyncCursorState = { nextMemberId, attempted, failed }
  const startIndex = resolveCursorStartIndex(ordered, cursorState)
  const pending: string[] = []
  for (let offset = 0; offset < ordered.length; offset += 1) {
    const memberId = ordered[(startIndex + offset) % ordered.length]
    if (memberId !== undefined && !attempted.has(memberId)) pending.push(memberId)
  }

  const summary = await syncMembers(context, pending, idToken)

  const attemptedPersist = new Set([...attempted, ...summary.attempted])
  const failedPersist = new Set<string>()
  for (const id of failed) {
    if (!summary.syncedIds.has(id)) failedPersist.add(id)
  }
  for (const id of summary.failed) failedPersist.add(id)
  for (const id of failedPersist) {
    if (!attemptedPersist.has(id)) failedPersist.delete(id)
  }

  const unprocessed = pending.filter((id) => !attemptedPersist.has(id))
  const allAttempted = attemptedPersist.size === ordered.length

  let cursorTarget: SyncCursorTarget
  if (unprocessed.length > 0) {
    // El cursor queda en el primer miembro no procesado (incluye los que
    // agotaron su plazo o recibieron el 429).
    const firstUnprocessed = unprocessed[0] ?? null
    cursorTarget = {
      nextMemberId: firstUnprocessed,
      attempted: [...attemptedPersist].sort(),
      failed: [...failedPersist].sort()
    }
  } else if (failedPersist.size > 0) {
    // La pasada recorrió a todos, pero queda al menos un fallo: la siguiente
    // empieza por el primer fallo y no puede declararse ok.
    const firstFailed =
      pending.find((id) => failedPersist.has(id)) ?? [...failedPersist].sort()[0] ?? null
    cursorTarget = { nextMemberId: firstFailed, attempted: [], failed: [] }
  } else {
    // Pasada completa y sin fallos pendientes: ciclo nuevo desde el principio.
    cursorTarget = { nextMemberId: null, attempted: [], failed: [] }
  }

  const cursorPersisted = await persistSyncCursor(context, cursorTarget)
  // Fallos de la pasada: UUID válidos no sincronizados + entradas no
  // identificables. No se usa `members.length - synced` porque los UUID
  // repetidos inflarían el recuento y un miembro sin UUID nunca aparece en
  // `synced`; el recuento debe ser no negativo y cubrir al menos los inválidos.
  const failedCount = ordered.length - summary.synced + unidentifiable

  if (summary.rateLimited) {
    return {
      status: 'throttled',
      synced: summary.synced,
      failed: failedCount,
      retryAfterMs: summary.retryAfterMs
    }
  }
  if (unidentifiable > 0) {
    // Un solo miembro no identificable impide declarar `ok` aunque todos los
    // UUID válidos se hayan sincronizado: no hay evidencia de éxito completo.
    return {
      status: 'partial',
      synced: summary.synced,
      failed: failedCount,
      errorCode: 'members.partial'
    }
  }
  if (summary.exhausted || unprocessed.length > 0) {
    return {
      status: 'partial',
      synced: summary.synced,
      failed: failedCount,
      errorCode: 'sync.deadline_exceeded'
    }
  }
  if (failedPersist.size > 0 || !allAttempted) {
    return {
      status: 'partial',
      synced: summary.synced,
      failed: Math.max(1, failedCount),
      errorCode: 'members.partial'
    }
  }
  if (!cursorPersisted) {
    // Nunca ok si el avance no se confirmó bajo el fence owner/lease.
    return {
      status: 'partial',
      synced: summary.synced,
      failed: Math.max(1, failedCount),
      errorCode: 'cursor.persist_failed'
    }
  }

  return { status: 'ok', synced: summary.synced, failed: 0 }
}

/* ------------------------------------------------------------------------- *
 * Cierre y resultado
 * ------------------------------------------------------------------------- */

/**
 * Cierra el intento con el `owner` del lease. Nunca lanza.
 *
 * Una pausa indefinida usa la RPC explícita `kubios_finish_sync_indefinite`:
 * no se envía ningún número centinela a `kubios_finish_sync` y, si la RPC falla,
 * se degrada a `finish.failed` en lugar de fingir una pausa finita.
 */
async function finishSync(context: SyncContext, outcome: SyncOutcome): Promise<boolean> {
  let success = false
  let errorCode: string | null = null
  let pause: RetryAfterPause | null = null

  if (outcome.status === 'ok') {
    success = true
  } else if (outcome.status === 'throttled') {
    errorCode = RATE_LIMITED_ERROR_CODE
    pause = resolveRetryAfterPause(outcome.retryAfterMs)
  } else if (outcome.status === 'partial') {
    errorCode = outcome.errorCode
  } else {
    // `locked` no llega aquí: sin lease no se cierra el intento de otro.
    return true
  }

  // Sin tiempo para el cierre no se envía la RPC: el resultado se degradará a
  // partial y el lease caducará solo. Nunca se responde ok/throttled sin cierre.
  if (!hasRemaining(context.deadlines.finish)) return false

  if (pause !== null && pause.kind === 'indefinite') {
    // K38 permite a este mismo owner persistir la pausa indefinida aunque su
    // lease haya caducado y nadie lo haya tomado; si otro owner lo tomó, la RPC
    // devuelve false. La comprobación local de vigencia no se aplica aquí
    // porque la pausa indefinida es la opción fail-closed documentada.
    const response = await callRpc(
      context.service,
      FINISH_INDEFINITE_RPC,
      {
        p_team_id: context.teamId,
        p_lease_owner: context.owner,
        p_error_code: RATE_LIMITED_ERROR_CODE
      },
      context.deadlines.finish
    )
    return response.ok && response.data === true
  }

  // Para un cierre finito se exige que el lease siga vigente también según el
  // reloj local. La autoridad final es la RPC (owner + expiry), pero así no se
  // atribuye un cierre a un lease que ya debería haber caducado.
  if (!leaseIsLikelyValid(context)) return false

  const response = await callRpc(
    context.service,
    FINISH_RPC,
    {
      p_team_id: context.teamId,
      p_lease_owner: context.owner,
      p_success: success,
      p_error_code: errorCode,
      p_retry_after_seconds: pause === null ? null : pause.seconds
    },
    context.deadlines.finish
  )

  return response.ok && response.data === true
}

/**
 * Si `kubios_finish_sync` no confirmó la escritura, el estado no se persistió:
 * nunca se devuelve `ok` ni `throttled` como si lo hubiera hecho.
 */
function degradeAfterFinishFailure(outcome: SyncOutcome): SyncOutcome {
  if (outcome.status === 'locked') return outcome

  return {
    status: 'partial',
    synced: outcome.synced,
    failed: Math.max(1, outcome.failed),
    errorCode: 'finish.failed'
  }
}

function toPublicResult(outcome: SyncOutcome): KubiosSyncResult {
  switch (outcome.status) {
    case 'ok':
      return { status: 'ok', synced: outcome.synced, failed: outcome.failed }
    case 'locked':
      return { status: 'locked', synced: 0, failed: 0 }
    case 'throttled': {
      const pause = resolveRetryAfterPause(outcome.retryAfterMs)
      if (pause.kind === 'indefinite') {
        return {
          status: 'throttled',
          synced: outcome.synced,
          failed: outcome.failed,
          retryIndefinite: true
        }
      }
      return {
        status: 'throttled',
        synced: outcome.synced,
        failed: outcome.failed,
        retryAfterSeconds: pause.seconds
      }
    }
    case 'partial':
    default:
      return { status: 'partial', synced: outcome.synced, failed: outcome.failed }
  }
}

function readConfig(env: KubiosEnvSource): KubiosConfig | null {
  try {
    const config = getKubiosConfig(env)
    // Si el equipo se configuró explícitamente, las RPC K10/K35/K36 declaran
    // `uuid`: un valor que no encaja no llega a red. Sin configurar, la
    // resolución posterior exige UUID antes de adquirir el lease.
    if (config.teamId !== undefined && !isUuid(config.teamId)) return null
    return config
  } catch {
    return null
  }
}

/**
 * Ejecuta una sincronización Kubios por equipo.
 *
 * Sin argumentos usa la configuración y la clave de servicio del entorno; con
 * `deps` permite sustituir RPC, reloj, UUID, cifrado y ambos `fetch` para
 * pruebas sin red. No lanza errores al llamador: cualquier fallo se degrada a
 * `partial` (salvo `locked`, que solo indica que otro trabajador tiene el lease).
 */
export async function runKubiosSync(deps: KubiosSyncDeps = {}): Promise<KubiosSyncResult> {
  const startedAt = Date.now()
  const budgetMs = resolveBudgetMs(deps.budgetMs)
  const responseReserveMs = resolveReserveMs(
    deps.responseReserveMs,
    DEFAULT_KUBIOS_SYNC_RESPONSE_RESERVE_MS,
    budgetMs
  )
  const finishReserveMs = resolveReserveMs(
    deps.finishReserveMs,
    DEFAULT_KUBIOS_SYNC_FINISH_RESERVE_MS,
    budgetMs - responseReserveMs
  )
  const deadlines = resolveDeadlines(startedAt, budgetMs, finishReserveMs, responseReserveMs)

  // Sin tiempo de trabajo no se toca la base: no hay lease que cerrar.
  if (!hasRemaining(deadlines.work)) return internalFailureResult()

  const env = resolveEnv(deps)

  const config = readConfig(env)
  if (config === null) return internalFailureResult()

  let service: KubiosSyncRpcClient | null
  try {
    service = await awaitWithinDeadline(
      Promise.resolve(deps.service ?? createServiceClient(env)),
      deadlines.work
    )
  } catch {
    return internalFailureResult()
  }
  if (service === null) return internalFailureResult()

  const owner = createOwner(deps.randomUUID)
  if (owner === null) return internalFailureResult()

  const common: SyncCommonContext = {
    service,
    owner,
    env,
    cryptoOptions: resolveCryptoOptions(deps),
    apiFetch: deps.apiFetch,
    authFetch: deps.authFetch,
    now: deps.now,
    timeoutMs: resolveTimeoutMs(deps.timeoutMs),
    deadlines,
    leaseExpiresAt: null
  }

  // Con `KUBIOS_TEAM_ID` configurado se conserva el flujo existente: el lease
  // se adquiere antes de autenticar. Sin él, el equipo se descubre y se valida
  // antes de tocar la base; un fallo no adquiere lease ni persiste nada.
  let resolvedToken: ResolvedTeamToken | null = null
  let teamId: string
  if (config.teamId !== undefined) {
    teamId = config.teamId
  } else {
    const resolution = await resolveTeamAndToken(common)
    if (!resolution.ok) {
      // Sin lease no hay finish ni escrituras; un 429 aquí no persiste pausa.
      return toPublicResult({
        status: 'partial',
        synced: 0,
        failed: 1,
        errorCode: 'team.unavailable'
      })
    }
    resolvedToken = resolution.token
    teamId = resolution.token.teamId
  }

  const leaseSeconds = resolveLeaseSeconds(deps.leaseSeconds, budgetMs)
  const lease = await callRpc(
    service,
    LEASE_RPC,
    {
      p_team_id: teamId,
      p_lease_owner: owner,
      p_lease_seconds: leaseSeconds
    },
    deadlines.work
  )

  // Sin un booleano explícito no se sabe si el lease es nuestro: no se cierra
  // un intento ajeno. Si la RPC agotó el plazo, el lease (si se llegó a tomar)
  // caduca solo y ninguna escritura posterior queda autorizada.
  if (!lease.ok || (lease.data !== true && lease.data !== false)) {
    return internalFailureResult()
  }
  if (lease.data === false) return { status: 'locked', synced: 0, failed: 0 }

  const acquiredAt = readClock(deps.now) ?? Date.now()
  const context: SyncContext = {
    ...common,
    teamId,
    leaseExpiresAt: acquiredAt + leaseSeconds * 1_000
  }

  let outcome: SyncOutcome = { status: 'partial', synced: 0, failed: 1, errorCode: 'sync.internal' }
  try {
    if (resolvedToken !== null) {
      // El token se persiste solo después del lease y bajo el equipo resuelto.
      const persisted = await persistResolvedToken(context, resolvedToken)
      outcome = persisted
        ? await synchronize(context, resolvedToken)
        : { status: 'partial', synced: 0, failed: 1, errorCode: 'token.unavailable' }
    } else {
      outcome = await synchronize(context)
    }
  } catch {
    outcome = {
      status: 'partial',
      synced: 0,
      failed: 1,
      errorCode: hasRemaining(deadlines.work) ? 'sync.internal' : 'sync.deadline_exceeded'
    }
  } finally {
    try {
      const finished = await finishSync(context, outcome)
      if (!finished) outcome = degradeAfterFinishFailure(outcome)
    } catch {
      // Un cierre que lanza tampoco confirma la persistencia del estado.
      outcome = degradeAfterFinishFailure(outcome)
    }
  }

  return toPublicResult(outcome)
}

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Limite de duracion de la funcion en Vercel, configurado por export. Es un
 * valor conservador (60 s) que tambien cabe en el maximo de Hobby sin fluid
 * compute. El limite real depende del plan y de fluid compute y no se asume
 * aqui; el presupuesto interno del sincronizador es mucho menor y esta alineado
 * con el timeout de 30 s de pg_net.
 */
export const maxDuration = 60

const CACHE_CONTROL_NO_STORE = 'no-store'
const BEARER_PREFIX = 'Bearer '
const UNAUTHORIZED_MESSAGE = 'No autorizado'
const UNAVAILABLE_MESSAGE = 'Error interno del servidor'

/**
 * Máximo `integer` de PostgreSQL y, por tanto, máximo `retry_after_seconds`
 * finito que el sincronizador puede persistir (K38). Un valor mayor no se puede
 * haber persistido nunca: tratarlo como válido publicaría un `Retry-After` que
 * no corresponde a la pausa real, así que se rechaza como resultado no válido.
 */
const MAX_PERSISTABLE_RETRY_AFTER_SECONDS = 2_147_483_647

type KubiosSyncStatus = 'ok' | 'locked' | 'throttled' | 'partial'

const SYNC_STATUS_HTTP: Record<KubiosSyncStatus, number> = {
  ok: 200,
  locked: 202,
  throttled: 429,
  partial: 503
}

interface SanitizedSyncResult {
  readonly status: KubiosSyncStatus
  readonly synced: number
  readonly failed: number
  readonly retryAfterSeconds: number | null
  /** Pausa `infinity` de K38: se expone como 429 sin `Retry-After`. */
  readonly retryIndefinite: boolean
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...headers, 'Cache-Control': CACHE_CONTROL_NO_STORE }
  })
}

/**
 * Comparación en tiempo constante. `timingSafeEqual` exige buffers de la misma
 * longitud, por lo que las longitudes se comprueban antes de comparar.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (providedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(providedBytes, expectedBytes)
}

function isKubiosSyncStatus(value: unknown): value is KubiosSyncStatus {
  return value === 'ok' || value === 'locked' || value === 'throttled' || value === 'partial'
}

function toNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * Reduce el resultado del sincronizador a los campos públicos permitidos.
 * Descarta cualquier dato adicional (IDs, detalles internos) y exige un
 * contrato válido: si no se reconoce, la respuesta es un 503 genérico.
 *
 * `ok` exige `failed === 0`: un éxito con fallos pendientes es incoherente y
 * no debe publicarse como 200. `partial` también exige `failed > 0`: una
 * pasada parcial sin fallos no tiene una lectura pública coherente y se trata
 * como resultado no válido (503 genérico, sin cuerpo partial ni `Retry-After`).
 * `throttled` admite dos formas excluyentes:
 *   * pausa finita: `retryAfterSeconds` decimal entero y seguro, dentro del
 *     máximo `integer` de PostgreSQL, que se publica exacto en `Retry-After`
 *     (incluidos 0, 86401 y 2147483647); un valor superior no pudo persistirse
 *     y se rechaza;
 *   * pausa indefinida K38: `retryIndefinite === true` y sin
 *     `retryAfterSeconds`; se publica como 429 SIN `Retry-After`, porque no
 *     existe un plazo que prometer.
 * Cualquier mezcla ambigua se rechaza como resultado no válido.
 */
function sanitizeResult(raw: unknown): SanitizedSyncResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  if (!isKubiosSyncStatus(candidate.status)) return null

  const synced = toNonNegativeInteger(candidate.synced)
  const failed = toNonNegativeInteger(candidate.failed)
  if (synced === null || failed === null) return null
  if (candidate.status === 'ok' && failed > 0) return null
  // Una pasada `partial` sin fallos es incoherente: el sincronizador solo la
  // produce con al menos un fallo contado. Publicarla como 503 con cuerpo
  // partial prometería un estado que el propio contrato no sostiene.
  if (candidate.status === 'partial' && failed === 0) return null

  let retryAfterSeconds: number | null = null
  let retryIndefinite = false
  if (candidate.status === 'throttled') {
    if (candidate.retryIndefinite === true) {
      if (candidate.retryAfterSeconds !== undefined && candidate.retryAfterSeconds !== null) {
        return null
      }
      retryIndefinite = true
    } else {
      retryAfterSeconds = toNonNegativeInteger(candidate.retryAfterSeconds)
      if (
        retryAfterSeconds === null ||
        retryAfterSeconds > MAX_PERSISTABLE_RETRY_AFTER_SECONDS
      ) {
        return null
      }
    }
  }

  return { status: candidate.status, synced, failed, retryAfterSeconds, retryIndefinite }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const secret = process.env.KUBIOS_CRON_SECRET
    const authorization = request.headers.get('authorization')

    if (
      !secret ||
      !authorization ||
      !authorization.startsWith(BEARER_PREFIX) ||
      !secretsMatch(authorization.slice(BEARER_PREFIX.length), secret)
    ) {
      return jsonResponse({ error: UNAUTHORIZED_MESSAGE }, 401)
    }

    // Fuente unica del presupuesto: el default del modulo de sincronizacion.
    // No se duplica la constante ni se exportan campos fuera del contrato de
    // Next (metodos HTTP, runtime, maxDuration, etc.).
    const { runKubiosSync, DEFAULT_KUBIOS_SYNC_BUDGET_MS } = await import('@/lib/kubios-sync')
    const result = sanitizeResult(
      await runKubiosSync({ budgetMs: DEFAULT_KUBIOS_SYNC_BUDGET_MS })
    )

    if (!result) {
      console.error('[api/cron/kubios-sync] Resultado no válido del sincronizador')
      return jsonResponse({ error: UNAVAILABLE_MESSAGE }, 503)
    }

    const headers: Record<string, string> = {}
    if (
      result.status === 'throttled' &&
      !result.retryIndefinite &&
      result.retryAfterSeconds !== null
    ) {
      headers['Retry-After'] = String(result.retryAfterSeconds)
    }

    return jsonResponse(
      { status: result.status, synced: result.synced, failed: result.failed },
      SYNC_STATUS_HTTP[result.status],
      headers
    )
  } catch {
    console.error('[api/cron/kubios-sync] Error interno durante la sincronización')
    return jsonResponse({ error: UNAVAILABLE_MESSAGE }, 503)
  }
}

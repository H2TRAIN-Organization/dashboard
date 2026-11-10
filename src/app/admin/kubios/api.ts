import { ApiError, apiRequest, buildQuery } from '@/lib/api-client'

/**
 * Contrato de la vista administrativa de Kubios.
 *
 * Los datos personales de Kubios se leen a través de la sesión y el rol del
 * servidor. Estas funciones solo validan lo recibido; no leen tokens ni
 * almacenan credenciales. Las peticiones usan el cliente común, que ya fuerza
 * `cache: 'no-store'` y `credentials: 'same-origin'`.
 */

export const ADMIN_KUBIOS_PARTICIPANTS_PATH = '/api/admin/kubios/participants'
export const ADMIN_KUBIOS_MEASUREMENTS_PATH = '/api/admin/kubios/measurements'

const CONTRACT_ERROR =
  'La respuesta de Kubios para administración no tiene el formato esperado'

export type AdminKubiosMeasurementStatus = 'ready' | 'stale'
export type AdminKubiosPageStatus =
  | 'ready'
  | 'stale'
  | 'pending'
  | 'empty'
  | 'unlinked'

export interface AdminKubiosParticipant {
  userId: number
  username: string
}

export interface AdminKubiosMeasurementsPage {
  measurements: AdminKubiosMeasurement[]
  nextCursor: string | null
  status: AdminKubiosPageStatus
  unavailableCount: number
}

export interface AdminKubiosMeasurement {
  userId: number
  username: string
  measuredTimestamp: string | null
  metrics: Record<string, number>
  syncedAt: string
  status: AdminKubiosMeasurementStatus
}

export interface AdminKubiosParticipantsPage {
  participants: AdminKubiosParticipant[]
  nextCursor: string | null
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contractError(message = CONTRACT_ERROR): never {
  throw new ApiError(0, 'CONTRACT_ERROR', message)
}

function isPageStatus(value: unknown): value is AdminKubiosPageStatus {
  return (
    value === 'ready' ||
    value === 'stale' ||
    value === 'pending' ||
    value === 'empty' ||
    value === 'unlinked'
  )
}

function isMeasurementStatus(
  value: unknown,
): value is AdminKubiosMeasurementStatus {
  return value === 'ready' || value === 'stale'
}

type ParsedCursor = { ok: true; value: string | null } | { ok: false }

function parseCursor(value: unknown): ParsedCursor {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  const trimmed = value.trim()
  return { ok: true, value: trimmed.length > 0 ? value : null }
}

function parseTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  return value.trim().length > 0 ? value : null
}

function parseMetrics(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null
  const metrics: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      metrics[key] = entry
    }
  }
  return metrics
}

export function parseAdminKubiosParticipantsPage(
  payload: unknown,
): AdminKubiosParticipantsPage | null {
  if (!isRecord(payload) || !Array.isArray(payload.participants)) return null
  const cursor = parseCursor(payload.nextCursor)
  if (!cursor.ok) return null

  const participants: AdminKubiosParticipant[] = []
  for (const entry of payload.participants) {
    if (!isRecord(entry)) return null
    const { userId, username } = entry
    if (typeof userId !== 'number' || !Number.isInteger(userId)) return null
    if (typeof username !== 'string') return null
    participants.push({ userId, username })
  }

  return { participants, nextCursor: cursor.value }
}

export function parseAdminKubiosMeasurementsPage(
  payload: unknown,
): AdminKubiosMeasurementsPage | null {
  if (!isRecord(payload) || !Array.isArray(payload.measurements)) return null
  const cursor = parseCursor(payload.nextCursor)
  if (!cursor.ok) return null
  if (!isPageStatus(payload.status)) return null

  const unavailableCount = payload.unavailableCount
  if (
    typeof unavailableCount !== 'number' ||
    !Number.isInteger(unavailableCount) ||
    unavailableCount < 0
  ) {
    return null
  }

  const measurements: AdminKubiosMeasurement[] = []
  for (const entry of payload.measurements) {
    if (!isRecord(entry)) return null
    const { userId, username, measuredTimestamp, syncedAt, status } = entry
    if (typeof userId !== 'number' || !Number.isInteger(userId)) return null
    if (typeof username !== 'string') return null
    const measured = parseTimestamp(measuredTimestamp)
    if (measured === undefined) return null
    if (typeof syncedAt !== 'string') return null
    if (!isMeasurementStatus(status)) return null
    const metrics = parseMetrics(entry.metrics)
    if (metrics === null) return null

    measurements.push({
      userId,
      username,
      measuredTimestamp: measured,
      metrics,
      syncedAt,
      status,
    })
  }

  return {
    measurements,
    nextCursor: cursor.value,
    status: payload.status,
    unavailableCount,
  }
}

export async function fetchAdminKubiosParticipantsPage(
  cursor: string | null,
  options: { signal?: AbortSignal } = {},
): Promise<AdminKubiosParticipantsPage> {
  const raw = await apiRequest<unknown>(
    `${ADMIN_KUBIOS_PARTICIPANTS_PATH}${buildQuery({
      cursor: cursor ?? undefined,
    })}`,
    { signal: options.signal },
  )
  const parsed = parseAdminKubiosParticipantsPage(raw)
  if (parsed === null) contractError()
  return parsed
}

/**
 * Recorre todas las páginas para que la búsqueda local nunca se limite a la
 * primera página del servidor. Un 409 en un cursor caducado reinicia la
 * lectura desde el principio una sola vez.
 */
export async function fetchAllAdminKubiosParticipants(
  options: { signal?: AbortSignal } = {},
): Promise<AdminKubiosParticipant[]> {
  const byId = new Map<number, AdminKubiosParticipant>()
  const seenCursors = new Set<string>()
  let cursor: string | null = null
  let restarted = false

  for (let pageIndex = 0; pageIndex < 1000; pageIndex += 1) {
    let page: AdminKubiosParticipantsPage
    try {
      page = await fetchAdminKubiosParticipantsPage(cursor, options)
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        !restarted
      ) {
        restarted = true
        cursor = null
        byId.clear()
        seenCursors.clear()
        continue
      }
      throw error
    }

    for (const participant of page.participants) {
      byId.set(participant.userId, participant)
    }

    if (page.nextCursor === null) {
      return Array.from(byId.values())
    }
    if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) {
      contractError('El servidor repitió un cursor de participantes')
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }

  throw new ApiError(
    0,
    'INCOMPLETE_LIST',
    'No se pudo cargar la lista completa de participantes',
  )
}

export interface AdminKubiosMeasurementsQuery {
  userId?: number | null
  cursor?: string | null
}

export async function fetchAdminKubiosMeasurementsPage(
  query: AdminKubiosMeasurementsQuery,
  options: { signal?: AbortSignal } = {},
): Promise<AdminKubiosMeasurementsPage> {
  const raw = await apiRequest<unknown>(
    `${ADMIN_KUBIOS_MEASUREMENTS_PATH}${buildQuery({
      userId: query.userId ?? undefined,
      cursor: query.cursor ?? undefined,
    })}`,
    { signal: options.signal },
  )
  const parsed = parseAdminKubiosMeasurementsPage(raw)
  if (parsed === null) contractError()
  return parsed
}

export interface AdminKubiosVisiblePage {
  page: AdminKubiosMeasurementsPage
  /** Cursor de inicio usado (null si el servidor reinició la primera página). */
  cursor: string | null
}

/**
 * Carga la primera página visible desde `startCursor`. Las páginas sin filas
 * pero con cursor siguiente (lotes dispersos) se saltan para que la tabla no
 * muestre un hueco; la navegación conserva el cursor de inicio para volver.
 * Un 409 reinicia desde la primera página, como exige el contrato.
 */
export async function fetchAdminKubiosVisiblePage(
  userId: number | null,
  startCursor: string | null,
  options: { signal?: AbortSignal } = {},
): Promise<AdminKubiosVisiblePage> {
  let baseCursor = startCursor
  let restarted = false

  for (;;) {
    let cursor = baseCursor
    let unavailableCount = 0
    const seenCursors = new Set<string>()
    try {
      for (let hops = 0; hops < 100; hops += 1) {
        const page = await fetchAdminKubiosMeasurementsPage(
          { userId, cursor },
          options,
        )
        // Los lotes dispersos que se saltan siguen aportando su recuento de
        // mediciones no disponibles a la página visible resultante.
        unavailableCount += page.unavailableCount
        if (page.measurements.length > 0 || page.nextCursor === null) {
          return {
            page: { ...page, unavailableCount },
            cursor: baseCursor,
          }
        }
        if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) {
          contractError('El servidor repitió un cursor de mediciones')
        }
        seenCursors.add(page.nextCursor)
        cursor = page.nextCursor
      }
      contractError('El servidor devolvió demasiados lotes vacíos')
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        !restarted
      ) {
        restarted = true
        baseCursor = null
        // El siguiente intento empieza en la primera página con un recuento
        // nuevo; no se arrastra el de los lotes descartados.
        continue
      }
      throw error
    }
  }
}

export const ADMIN_KUBIOS_SYNC_PATH = '/api/admin/kubios/participants'

export type AdminKubiosSyncStatus = 'ok' | 'partial' | 'locked' | 'throttled'

export interface AdminKubiosSyncResult {
  status: AdminKubiosSyncStatus
  memberSynced: boolean
  synced: number
  failed: number
  retryAfterSeconds?: number
}

function isKubiosSyncStatus(value: unknown): value is AdminKubiosSyncStatus {
  return value === 'ok' || value === 'partial' || value === 'locked' || value === 'throttled'
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

export function parseAdminKubiosSyncResult(
  payload: unknown,
): AdminKubiosSyncResult | null {
  if (!isRecord(payload) || !isKubiosSyncStatus(payload.status)) return null
  const synced = asCount(payload.synced)
  const failed = asCount(payload.failed)
  if (synced === null || failed === null) return null
  if (typeof payload.memberSynced !== 'boolean') return null

  let retryAfterSeconds: number | undefined
  if (payload.retryAfterSeconds !== undefined) {
    const value = asCount(payload.retryAfterSeconds)
    if (value === null) return null
    retryAfterSeconds = value
  }

  return {
    status: payload.status,
    memberSynced: payload.memberSynced,
    synced,
    failed,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  }
}

/**
 * POST de refresco del participante. La copia del servidor se actualiza con la
 * maquinaria completa de sincronización (lease, token, descarga y escritura
 * fenceada) sin adelantar el plan durable del cron; el cuerpo solo contiene el
 * estado saneado del refresco y nunca secretos ni identificadores externos.
 */
export async function syncAdminKubiosParticipant(
  userId: number,
  options: { signal?: AbortSignal } = {},
): Promise<AdminKubiosSyncResult> {
  if (!Number.isInteger(userId) || userId <= 0) {
    contractError('El participante a sincronizar no es válido')
  }
  const raw = await apiRequest<unknown>(
    `${ADMIN_KUBIOS_SYNC_PATH}/${encodeURIComponent(String(userId))}/sync`,
    { method: 'POST', signal: options.signal },
  )
  const parsed = parseAdminKubiosSyncResult(raw)
  if (parsed === null) contractError()
  return parsed
}

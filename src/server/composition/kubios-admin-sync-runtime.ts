import 'server-only'

import { z } from 'zod'
import { canReadAdminDatabase } from '@/server/domain/access-policy'
import {
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '@/server/domain/errors'
import { assertPrivacyAcknowledged } from '@/server/domain/privacy'
import { toActiveActor } from '@/server/domain/session'
import type { ActiveActor } from '@/server/domain/user'
import {
  DEFAULT_KUBIOS_SYNC_BUDGET_MS,
  runKubiosMemberRefresh,
} from '@/lib/kubios-sync'
import { getServerRuntime } from './runtime'
import { createKubiosRpcClient } from './kubios-runtime'

/**
 * SYNC-04 — Refresco dirigido de la copia Kubios de un participante.
 *
 * La vista administrativa lee una copia en caché; sin este flujo solo el cron
 * podía actualizarla, así que el admin contemplaba copias congeladas con el
 * estado `stale` hasta la próxima pasada programada. Aquí el administrador
 * fuerza la descarga de un participante concreto con la maquinaria completa de
 * sincronización (lease, token, descarga K13 y escritura fenceada K10) sin
 * adelantar el plan durable del cron.
 *
 * La única identidad aceptada es la sesión HTTP, ya verificada y con el primer
 * reconocimiento de privacidad cuando `resolveKubiosAdminActor` reservó el
 * guard; aquí el rol admin se vuelve a exigir como defensa en profundidad antes
 * de tocar RPC o red.
 */

const linkSchema = z.object({
  data: z.array(z.object({ kubios_member_id: z.string().uuid() })),
  error: z.null().optional(),
})

const USER_ID_PATTERN = /^[1-9]\d{0,9}$/

export type AdminKubiosSyncStatus = 'ok' | 'partial' | 'locked' | 'throttled'

export interface AdminKubiosSyncResult {
  readonly status: AdminKubiosSyncStatus
  readonly memberSynced: boolean
  readonly synced: number
  readonly failed: number
  /** `Retry-After` finito de la pausa Kubios, en segundos; solo con `throttled`. */
  readonly retryAfterSeconds?: number
}

export interface AdminKubiosMemberSyncDeps {
  /** Cliente de servicio inyectable; por defecto el runtime de composición. */
  readonly createService?: typeof createKubiosRpcClient
  /** Presupuesto del refresco; por defecto el mismo del sincronizador. */
  readonly budgetMs?: number
}

function assertAdmin(actor: ActiveActor): void {
  if (!canReadAdminDatabase(actor)) {
    throw new ForbiddenError('Solo un administrador puede sincronizar Kubios')
  }
}

/** Resuelve el vínculo verificado del usuario; sin él no hay miembro que sincronizar. */
async function resolveKubiosMemberId(
  userId: string,
  deps: AdminKubiosMemberSyncDeps
): Promise<string> {
  const userIdNumber = Number(userId)
  if (
    !USER_ID_PATTERN.test(userId) ||
    !Number.isSafeInteger(userIdNumber) ||
    userIdNumber > 2_147_483_647
  ) {
    throw new ValidationError()
  }

  let service: ReturnType<typeof createKubiosRpcClient>
  try {
    service = (deps.createService ?? createKubiosRpcClient)()
  } catch {
    throw new ServiceUnavailableError('Kubios no disponible')
  }

  let response: unknown
  try {
    response = await service.rpc('kubios_admin_get_link', { p_user_id: userIdNumber })
  } catch {
    throw new ServiceUnavailableError('Kubios no disponible')
  }

  const parsed = linkSchema.safeParse(response)
  if (!parsed.success) throw new ServiceUnavailableError('Kubios no disponible')
  const link = parsed.data.data[0]
  if (!link) throw new NotFoundError()
  return link.kubios_member_id
}

/**
 * Lanza el refresco dirigido y devuelve el resultado saneado: sin vínculo
 * responde 404; sin disponibilidad de Kubios 503; cualquier otro caso expone
 * solo el estado del refresco, si el miembro quedó sincronizado y, bajo una
 * pausa Kubios finita, el `Retry-After` en segundos.
 *
 * @param sessionToken Token de sesión crudo; la identidad y el rol se recargan
 *   siempre desde la base antes de crear cualquier cliente.
 */
export async function syncAdminKubiosMember(
  sessionToken: string | null | undefined,
  userId: string,
  deps: AdminKubiosMemberSyncDeps = {}
): Promise<AdminKubiosSyncResult> {
  if (!sessionToken) throw new UnauthorizedError()
  const session = await (await getServerRuntime()).useCases.auth.getSession(sessionToken)
  if (!session) throw new UnauthorizedError()
  assertPrivacyAcknowledged(session)
  const actor = toActiveActor(session)
  assertAdmin(actor)

  const memberId = await resolveKubiosMemberId(userId, deps)

  const refresh = await runKubiosMemberRefresh(memberId, {
    env: process.env,
    budgetMs: deps.budgetMs ?? DEFAULT_KUBIOS_SYNC_BUDGET_MS,
  })

  const { status, synced, failed } = refresh
  const syncedCount = Number.isInteger(synced) && synced >= 0 ? synced : 0
  const failedCount = Number.isInteger(failed) && failed >= 0 ? failed : 1

  const result: AdminKubiosSyncResult = {
    status,
    memberSynced: status === 'ok' && refresh.memberSynced === true,
    synced: status === 'ok' ? syncedCount : 0,
    failed: failedCount,
    ...(status === 'throttled' && typeof refresh.retryAfterSeconds === 'number'
      ? { retryAfterSeconds: refresh.retryAfterSeconds }
      : {}),
  }
  return result
}

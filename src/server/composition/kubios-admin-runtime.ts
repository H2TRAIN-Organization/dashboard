import 'server-only'

import { canReadAdminDatabase } from '@/server/domain/access-policy'
import {
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
  isAppError,
} from '@/server/domain/errors'
import { toActiveActor } from '@/server/domain/session'
import type { ActiveActor } from '@/server/domain/user'
import { getServerRuntime } from './runtime'

/**
 * Guard server-side real de las rutas administrativas de Kubios.
 *
 * La única fuente de identidad es la cookie HttpOnly de sesión. El runtime
 * recarga el usuario y su rol desde la base en cada petición; después se exige
 * la capacidad administrativa. Ningún rol doctor/user, cabecera, query o
 * selector del cliente puede abrir el listado.
 *
 * Este guard se ejecuta antes de crear cualquier cliente de servicio: sin
 * sesión responde 401 y sin rol admin responde 403, sin consultar Kubios.
 */
export async function resolveKubiosAdminActor(
  sessionToken: string | null | undefined,
): Promise<ActiveActor> {
  const token =
    typeof sessionToken === 'string' && sessionToken.length > 0
      ? sessionToken
      : null

  if (token === null) {
    throw new UnauthorizedError()
  }

  try {
    const application = await getServerRuntime()
    const session = await application.useCases.auth.getSession(token)
    const actor = toActiveActor(session)

    if (!canReadAdminDatabase(actor)) {
      throw new ForbiddenError('Solo un administrador puede consultar Kubios')
    }

    return actor
  } catch (error) {
    if (isAppError(error)) {
      throw error
    }
    throw new ServiceUnavailableError('El servicio de administración no está disponible')
  }
}

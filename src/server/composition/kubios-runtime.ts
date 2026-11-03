import 'server-only'

import { createClient } from '@supabase/supabase-js'

import {
  KubiosAuthError,
  resolveKubiosIdentity,
  type KubiosIdentityResult,
  type KubiosRpcClient,
} from '@/lib/kubios-authz'
import { assertServiceRoleKey } from '@/server/infrastructure/auth/supabase-auth-store'
import type { ServerApplication } from './container'
import { getServerRuntime } from './runtime'

/**
 * K50 - Composición del adaptador HTTP de Kubios con la sesión de producción.
 *
 * Este es el único punto que une:
 *   * `getServerRuntime().useCases.auth.getSession(token)` (sesión y roles
 *     recargados desde la base),
 *   * `resolveKubiosIdentity` (vínculo UserID numérico → team/member), y
 *   * un cliente de servicio perezoso con la clave privada.
 *
 * No lee `.env`, no hay URL/clave por defecto y no se crea ningún cliente al
 * importar el módulo. La fábrica de servicio solo se ejecuta después de que la
 * sesión se haya verificado.
 */

/** Fuente de variables de entorno inyectable en pruebas. */
export type KubiosSupabaseEnv = Record<string, string | undefined>

/**
 * Cliente de servicio mínimo con el esquema `public` fijado. Usa únicamente
 * `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`; no acepta claves públicas ni
 * aliases de entorno públicos.
 */
export function createKubiosRpcClient(
  env: KubiosSupabaseEnv = process.env
): KubiosRpcClient {
  const url = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : ''
  const serviceRoleKey =
    typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string'
      ? env.SUPABASE_SERVICE_ROLE_KEY.trim()
      : ''

  if (url.length === 0 || serviceRoleKey.length === 0) {
    throw new KubiosAuthError(503)
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new KubiosAuthError(503)
  }

  const isLocal =
    parsedUrl.hostname === 'localhost' ||
    parsedUrl.hostname === '127.0.0.1' ||
    parsedUrl.hostname === '::1' ||
    parsedUrl.hostname === '[::1]'

  if (
    parsedUrl.protocol !== 'https:' &&
    !(isLocal && parsedUrl.protocol === 'http:')
  ) {
    throw new KubiosAuthError(503)
  }

  try {
    assertServiceRoleKey(serviceRoleKey)
  } catch {
    throw new KubiosAuthError(503)
  }

  try {
    const client = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      db: { schema: 'public' },
    })

    const rpc = client.rpc.bind(client) as unknown as (
      name: string,
      args: Readonly<Record<string, unknown>>
    ) => PromiseLike<unknown>

    return { rpc }
  } catch {
    throw new KubiosAuthError(503)
  }
}

/** Dependencias inyectables; el adaptador real usa los valores por defecto. */
export interface KubiosRuntimeDeps {
  readonly getRuntime?: () => Promise<ServerApplication>
  readonly createService?: () => KubiosRpcClient
}

/**
 * Resuelve la identidad de una petición a partir del token de la cookie.
 *
 * El token ausente/vacío se rechaza con 401 sin construir el runtime ni el
 * cliente de servicio. Los errores de configuración o del runtime se traducen
 * a 503 dentro de `resolveKubiosIdentity`.
 */
export async function resolveKubiosRequestIdentity(
  sessionToken: string | null | undefined,
  deps: KubiosRuntimeDeps = {}
): Promise<KubiosIdentityResult> {
  const getRuntime = deps.getRuntime ?? getServerRuntime
  const createService = deps.createService ?? createKubiosRpcClient

  return resolveKubiosIdentity(sessionToken, {
    getSession: async (token) => {
      const application = await getRuntime()
      return application.useCases.auth.getSession(token)
    },
    createService,
  })
}

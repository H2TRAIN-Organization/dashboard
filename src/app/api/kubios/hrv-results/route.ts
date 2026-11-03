import { NextResponse, type NextRequest } from 'next/server'

import { decryptKubiosSnapshot } from '@/lib/kubios-crypto'
import { handleKubiosHrvResultsRequest } from '@/lib/kubios-snapshot-reader'
import {
  createKubiosRpcClient,
  resolveKubiosRequestIdentity,
} from '@/server/composition/kubios-runtime'
import { runApiRoute, sessionTokenFrom } from '@/server/http/next/route-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/kubios/hrv-results
 *
 * La identidad se obtiene exclusivamente de la cookie HttpOnly de sesión. La
 * query solo puede contener filtros de fecha (`from`/`to` y alias); cualquier
 * identificador de usuario, equipo o miembro se rechaza. La respuesta es
 * siempre privada y sin caché.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runApiRoute(request, async () => {
    const result = await handleKubiosHrvResultsRequest(
      {
        sessionToken: sessionTokenFrom(request) ?? null,
        url: request.url,
      },
      {
        resolveIdentity: resolveKubiosRequestIdentity,
        createService: createKubiosRpcClient,
        decryptSnapshot: decryptKubiosSnapshot,
        cryptoEnv: process.env,
      },
    )

    return {
      status: result.status,
      body: result.body,
      headers: result.headers,
    }
  })
}

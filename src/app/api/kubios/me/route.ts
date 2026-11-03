import { NextResponse, type NextRequest } from 'next/server'

import { decryptKubiosSnapshot } from '@/lib/kubios-crypto'
import { handleKubiosMeRequest } from '@/lib/kubios-snapshot-reader'
import {
  createKubiosRpcClient,
  resolveKubiosRequestIdentity,
} from '@/server/composition/kubios-runtime'
import { runApiRoute, sessionTokenFrom } from '@/server/http/next/route-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/kubios/me
 *
 * La identidad se obtiene exclusivamente de la cookie HttpOnly de sesión; el
 * endpoint ignora cabeceras de autenticación, query y selectores de identidad.
 * La respuesta es siempre privada y sin caché.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runApiRoute(request, async () => {
    const result = await handleKubiosMeRequest(
      { sessionToken: sessionTokenFrom(request) ?? null },
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

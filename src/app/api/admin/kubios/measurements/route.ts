import { NextResponse, type NextRequest } from 'next/server'

import { decryptKubiosSnapshot } from '@/lib/kubios-crypto'
import { listKubiosAdminMeasurements } from '@/lib/kubios-admin-reader'
import { createKubiosRpcClient } from '@/server/composition/kubios-runtime'
import { resolveKubiosAdminActor } from '@/server/composition/kubios-admin-runtime'
import { runApiRoute, sessionTokenFrom } from '@/server/http/next/route-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/kubios/measurements
 *
 * `userId` selecciona un único vínculo; sin él se recorre el listado global.
 * El cursor queda ligado al ámbito elegido y el servidor solo devuelve las
 * métricas visibles ya serializadas, nunca el sobre cifrado ni el payload
 * crudo. La respuesta es privada y sin caché.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runApiRoute(request, async () => {
    const actor = await resolveKubiosAdminActor(sessionTokenFrom(request))
    const body = await listKubiosAdminMeasurements(
      { actor, url: request.url },
      {
        createService: createKubiosRpcClient,
        decryptSnapshot: decryptKubiosSnapshot,
        cryptoEnv: process.env,
      },
    )

    return {
      status: 200,
      body,
      headers: { 'Cache-Control': 'private, no-store' },
    }
  })
}

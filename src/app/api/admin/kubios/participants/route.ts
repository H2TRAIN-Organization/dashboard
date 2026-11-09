import { NextResponse, type NextRequest } from 'next/server'

import { decryptKubiosSnapshot } from '@/lib/kubios-crypto'
import { listKubiosAdminParticipants } from '@/lib/kubios-admin-reader'
import { createKubiosRpcClient } from '@/server/composition/kubios-runtime'
import { resolveKubiosAdminActor } from '@/server/composition/kubios-admin-runtime'
import { runApiRoute, sessionTokenFrom } from '@/server/http/next/route-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/kubios/participants
 *
 * Solo un administrador con sesión válida puede listar los participantes
 * vinculados. La identidad y el rol se recargan desde la base antes de crear
 * el cliente de servicio. La query solo admite `cursor`; la respuesta es
 * privada y sin caché.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runApiRoute(request, async () => {
    const actor = await resolveKubiosAdminActor(sessionTokenFrom(request))
    const body = await listKubiosAdminParticipants(
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

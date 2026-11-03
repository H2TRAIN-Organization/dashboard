import { NextResponse, type NextRequest } from 'next/server'

import { decryptKubiosSnapshot } from '@/lib/kubios-crypto'
import { handleKubiosExportRequest } from '@/lib/kubios-snapshot-reader'
import {
  createKubiosRpcClient,
  resolveKubiosRequestIdentity,
} from '@/server/composition/kubios-runtime'
import {
  assertRequestCsrf,
  sessionTokenFrom,
  toNextResponse,
} from '@/server/http/next/route-bridge'
import { toProblem } from '@/server/http/problem'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/kubios/export
 *
 * Exporta solo el snapshot propio a CSV. Usa la misma cookie de sesión y los
 * mismos filtros de fecha que `hrv-results`; nunca consulta el proveedor Kubios
 * ni acepta identificadores del cliente. La respuesta es `text/csv`, privada y
 * sin caché.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    assertRequestCsrf(request)

    const result = await handleKubiosExportRequest(
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

    if (typeof result.body === 'string') {
      return new NextResponse(result.body, {
        status: result.status,
        headers: result.headers,
      })
    }

    return NextResponse.json(result.body, {
      status: result.status,
      headers: result.headers,
    })
  } catch (error) {
    return toNextResponse(toProblem(error))
  }
}

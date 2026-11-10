import type { NextRequest } from 'next/server'
import { runApiRoute, assertRequestCsrf, sessionTokenFrom } from '@/server/http/next/route-bridge'
import { z } from 'zod'
import { parseInput } from '@/server/http/problem'
import { syncAdminKubiosMember } from '@/server/composition/kubios-admin-sync-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Igual que el pasada programada: el presupuesto interno del sincronizador
 * (26 s) queda lejos del limite impuesto a la funcion. El valor en Vercel
 * depende del plan y de fluid compute y no se asume aqui.
 */
export const maxDuration = 60

const userIdParamSchema = z.object({ userId: z.string().regex(/^[1-9]\d{0,9}$/) })

/**
 * POST /api/admin/kubios/participants/[userId]/sync
 *
 * Refresca la copia Kubios del participante con la maquinaria completa del
 * sincronizador (lease, token, descarga y escritura fenceada) sin adelantar el
 * plan durable del cron. Solo un admin con el primer reconocimiento de
 * privacidad; el cuerpo expone un estado del refresco saneado y nunca token,
 * secretos ni identificadores externos.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  return runApiRoute(request, async () => {
    assertRequestCsrf(request)
    const params = parseInput(userIdParamSchema, await context.params)
    const body = await syncAdminKubiosMember(sessionTokenFrom(request), params.userId)
    return { status: 200, body, headers: { 'Cache-Control': 'private, no-store' } }
  })
}

import type { NextRequest } from 'next/server'
import { requireAdminKubios, getAdminKubios, adminKubiosDateQuerySchema } from '@/server/composition/kubios-admin-runtime'
import { parseInput } from '@/server/http/problem'
import { runApiRoute, sessionTokenFrom, queryObject } from '@/server/http/next/route-bridge'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  return runApiRoute(request, async () => {
    const actor = await requireAdminKubios(sessionTokenFrom(request))
    const query = parseInput(adminKubiosDateQuerySchema, queryObject(request))
    return { status: 200, body: await getAdminKubios(actor, (await context.params).userId, query) }
  })
}

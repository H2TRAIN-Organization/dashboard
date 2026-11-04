import type { NextRequest } from 'next/server'
import { requireAdminKubios, listAdminKubios, adminKubiosQuerySchema } from '@/server/composition/kubios-admin-runtime'
import { parseInput } from '@/server/http/problem'
import { runApiRoute, sessionTokenFrom, queryObject } from '@/server/http/next/route-bridge'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return runApiRoute(request, async () => {
    const actor = await requireAdminKubios(sessionTokenFrom(request))
    const query = parseInput(adminKubiosQuerySchema, queryObject(request))
    return { status: 200, body: await listAdminKubios(actor, query) }
  })
}

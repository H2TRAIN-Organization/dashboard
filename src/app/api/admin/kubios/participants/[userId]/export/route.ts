import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminKubios, getAdminKubios, adminKubiosDateQuerySchema } from '@/server/composition/kubios-admin-runtime'
import { buildKubiosCsv } from '@/lib/kubios-csv'
import { parseInput, toProblem } from '@/server/http/problem'
import { assertRequestCsrf, sessionTokenFrom, queryObject, toNextResponse } from '@/server/http/next/route-bridge'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  try {
    assertRequestCsrf(request)
    const actor = await requireAdminKubios(sessionTokenFrom(request))
    const query = parseInput(adminKubiosDateQuerySchema, queryObject(request))
    const participant = await getAdminKubios(actor, (await context.params).userId, query)
    return new NextResponse(buildKubiosCsv([...participant.results]), { headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="kubios-user-${participant.userId}.csv"`,
    } })
  } catch (error) { return toNextResponse(toProblem(error)) }
}

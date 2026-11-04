import type { NextRequest } from 'next/server'
import { readStudy, studyQuerySchema } from '@/server/composition/study-runtime'
import { parseInput } from '@/server/http/problem'
import { queryObject, runApiRoute, sessionTokenFrom } from '@/server/http/next/route-bridge'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return runApiRoute(request, async () => {
    const query = parseInput(studyQuerySchema, queryObject(request))
    return { status: 200, body: await readStudy(sessionTokenFrom(request), query.period) }
  })
}

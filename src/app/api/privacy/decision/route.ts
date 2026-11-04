import type { NextRequest } from 'next/server'
import { getServerRuntime } from '@/server/composition/runtime'
import { runApiRoute, sessionTokenFrom, readJsonBody } from '@/server/http/next/route-bridge'
import { privacyDecision } from '@/server/http/handlers/privacy'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) {
  return runApiRoute(request, async () => privacyDecision((await getServerRuntime()).useCases.auth, sessionTokenFrom(request), await readJsonBody(request), process.env.NODE_ENV === 'production'))
}

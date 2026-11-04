import type { NextRequest } from 'next/server'
import { getServerRuntime } from '@/server/composition/runtime'
import { runApiRoute, sessionTokenFrom } from '@/server/http/next/route-bridge'
import { privacyStatus } from '@/server/http/handlers/privacy'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return runApiRoute(request, async () => privacyStatus((await getServerRuntime()).useCases.auth, sessionTokenFrom(request)))
}

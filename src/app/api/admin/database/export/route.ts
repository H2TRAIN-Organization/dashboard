import type { NextRequest } from "next/server";
import { getAdminDatabaseDownloads } from "@/server/composition/admin-database-download-runtime";
import { queryObject, runApiRoute, sessionTokenFrom } from "@/server/http/next/route-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runApiRoute(request, async () => (await getAdminDatabaseDownloads()).exportTable({ sessionToken: sessionTokenFrom(request), query: queryObject(request) }));
}

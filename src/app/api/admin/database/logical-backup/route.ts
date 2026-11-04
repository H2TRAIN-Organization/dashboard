import type { NextRequest } from "next/server";
import { getAdminDatabaseDownloads } from "@/server/composition/admin-database-download-runtime";
import { readJsonBody, runApiRoute, sessionTokenFrom } from "@/server/http/next/route-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runApiRoute(request, async () => (await getAdminDatabaseDownloads()).logicalBackup({ sessionToken: sessionTokenFrom(request), body: await readJsonBody(request) }));
}

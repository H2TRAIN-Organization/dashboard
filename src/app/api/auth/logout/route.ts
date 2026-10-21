import type { NextRequest } from "next/server";
import { getServerRuntime } from "@/server/composition/runtime";
import { runApiRoute, sessionTokenFrom } from "@/server/http/next/route-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runApiRoute(request, async () => {
    const app = await getServerRuntime();
    return app.http.auth.logout({ sessionToken: sessionTokenFrom(request) });
  });
}

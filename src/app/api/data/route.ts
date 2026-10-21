import type { NextRequest } from "next/server";
import { getServerRuntime } from "@/server/composition/runtime";
import {
  queryObject,
  runApiRoute,
  sessionTokenFrom,
} from "@/server/http/next/route-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runApiRoute(request, async () => {
    const app = await getServerRuntime();
    return app.http.data.legacy({
      sessionToken: sessionTokenFrom(request),
      query: queryObject(request),
    });
  });
}

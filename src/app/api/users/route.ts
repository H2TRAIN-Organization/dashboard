import type { NextRequest } from "next/server";
import { getServerRuntime } from "@/server/composition/runtime";
import {
  queryObject,
  readJsonBody,
  runApiRoute,
  sessionTokenFrom,
} from "@/server/http/next/route-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runApiRoute(request, async () => {
    const app = await getServerRuntime();
    return app.http.users.list({
      sessionToken: sessionTokenFrom(request),
      query: queryObject(request),
    });
  });
}

export async function POST(request: NextRequest) {
  return runApiRoute(request, async () => {
    const app = await getServerRuntime();
    return app.http.users.create({
      sessionToken: sessionTokenFrom(request),
      body: await readJsonBody(request),
    });
  });
}

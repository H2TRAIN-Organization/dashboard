import type { NextRequest } from "next/server";
import { getServerRuntime } from "@/server/composition/runtime";
import {
  readJsonBody,
  runApiRoute,
  sessionTokenFrom,
} from "@/server/http/next/route-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return runApiRoute(request, async () => {
    const { id } = await context.params;
    const app = await getServerRuntime();
    return app.http.users.get({ sessionToken: sessionTokenFrom(request), id });
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return runApiRoute(request, async () => {
    const { id } = await context.params;
    const app = await getServerRuntime();
    return app.http.users.update({
      sessionToken: sessionTokenFrom(request),
      id,
      body: await readJsonBody(request),
    });
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return runApiRoute(request, async () => {
    const { id } = await context.params;
    const app = await getServerRuntime();
    return app.http.users.delete({ sessionToken: sessionTokenFrom(request), id });
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { BadRequestError } from "@/server/domain/errors";
import {
  SESSION_COOKIE_NAME,
  type HttpCookie,
} from "../cookies";
import { assertCsrfSafe } from "../security";
import { toProblem, type HttpResult } from "../problem";

function firstHeader(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const first = value.split(",")[0]?.trim();
  return first === undefined || first.length === 0 ? null : first;
}

function requestOrigin(request: NextRequest): string {
  const proto =
    firstHeader(request.headers.get("x-forwarded-proto")) ??
    request.nextUrl.protocol.replace(/:$/, "");
  const host =
    firstHeader(request.headers.get("x-forwarded-host")) ??
    request.headers.get("host") ??
    request.nextUrl.host;
  return `${proto}://${host}`;
}

function configuredOrigins(): readonly string[] {
  const raw = process.env.APP_ORIGIN ?? process.env.APP_ORIGINS ?? "";
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function assertRequestCsrf(request: NextRequest): void {
  assertCsrfSafe({
    method: request.method,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    requestOrigin: requestOrigin(request),
    allowedOrigins: configuredOrigins(),
  });
}

export function sessionTokenFrom(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value;
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadRequestError("El cuerpo JSON no es válido");
  }
}

export function queryObject(request: NextRequest): Record<string, string> {
  return Object.fromEntries(request.nextUrl.searchParams.entries());
}

function applyCookies(response: NextResponse, cookies: readonly HttpCookie[]): void {
  for (const cookie of cookies) {
    response.cookies.set({
      name: cookie.name,
      value: cookie.value,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      path: cookie.path,
      ...(cookie.maxAge === undefined ? {} : { maxAge: cookie.maxAge }),
      ...(cookie.expires === undefined ? {} : { expires: cookie.expires }),
    });
  }
}

export function toNextResponse(result: HttpResult): NextResponse {
  const response =
    result.body === undefined
      ? new NextResponse(null, { status: result.status })
      : NextResponse.json(result.body, { status: result.status });

  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.headers.set(name, value);
  }
  applyCookies(response, result.cookies ?? []);
  return response;
}

/**
 * Shared Next.js adapter: CSRF validation, error mapping, cookies and JSON.
 * Route files supply the runtime-backed operation.
 */
export async function runApiRoute(
  request: NextRequest,
  operation: () => Promise<HttpResult>,
): Promise<NextResponse> {
  try {
    assertRequestCsrf(request);
    return toNextResponse(await operation());
  } catch (error) {
    return toNextResponse(toProblem(error));
  }
}

import { describe, expect, it, afterEach } from "vitest";

import {
  createSessionTokenCodec,
  parseSessionSecret,
} from "@/server/infrastructure/auth/session-token";
import { config, proxy } from "@/proxy";

const SECRET = "a".repeat(48);
const CODEC = createSessionTokenCodec(parseSessionSecret(SECRET));

type ProxyRequest = Parameters<typeof proxy>[0];

function makeRequest(
  pathname: string,
  cookie?: string,
): ProxyRequest {
  const url = new URL(`https://dashboard.test${pathname}`);
  const nextUrl = Object.assign(url, {
    clone: () => new URL(url.href),
  }) as URL & { clone(): URL };
  return {
    nextUrl,
    cookies: {
      get: (name: string) =>
        cookie === undefined ? undefined : { name, value: cookie },
    },
  } as unknown as ProxyRequest;
}

function isRedirectToLogin(response: unknown): boolean {
  const typed = response as { status: number; headers: Headers };
  return typed.status === 307 && typed.headers.get("location")?.startsWith("https://dashboard.test/login") === true;
}

const ENV_KEY = "AUTH_SESSION_SECRET";
let savedSecret: string | undefined;

afterEach(() => {
  if (savedSecret === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = savedSecret;
  }
});

function withSecret(value: string | undefined): void {
  savedSecret = process.env[ENV_KEY];
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
}

describe("proxy guard (MT50)", () => {
  it("responde 404 real en /study", () => {
    withSecret(SECRET);
    const response = proxy(makeRequest("/study/participantes"));
    expect((response as { status: number }).status).toBe(404);
  });

  it("redirige a /login sin cookie de sesión en rutas protegidas", () => {
    withSecret(SECRET);
    expect(isRedirectToLogin(proxy(makeRequest("/data")))).toBe(true);
    expect(isRedirectToLogin(proxy(makeRequest("/admin/kubios")))).toBe(true);
    expect(isRedirectToLogin(proxy(makeRequest("/overview")))).toBe(true);
  });

  it("redirige y limpia la cookie cuando el token está alterado", () => {
    withSecret(SECRET);
    const tampered = `${CODEC.seal({ sid: "s", uid: "1", method: "username", iat: 0, exp: 9e12 })}x`;
    const response = proxy(makeRequest("/users", tampered)) as {
      status: number;
      cookies: { get(name: string): { value: string } | undefined };
    };
    expect(isRedirectToLogin(response)).toBe(true);
    expect(response.cookies.get("dashboard_session")?.value).toBe("");
  });

  it("redirige cuando el token está caducado", () => {
    withSecret(SECRET);
    const expired = CODEC.seal({
      sid: "s",
      uid: "1",
      method: "username",
      iat: 0,
      exp: 1,
    });
    expect(isRedirectToLogin(proxy(makeRequest("/data", expired)))).toBe(true);
  });

  it("deja pasar rutas protegidas con un token válido", () => {
    withSecret(SECRET);
    const valid = CODEC.seal({
      sid: "sid-valor-suficiente-16",
      uid: "42",
      method: "username",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const response = proxy(makeRequest("/data", valid)) as { status: number };
    expect(response.status).toBe(200);
  });

  it("no se activa sin AUTH_SESSION_SECRET (desarrollo efímero y e2e mockeados)", () => {
    withSecret(undefined);
    const response = proxy(makeRequest("/data")) as { status: number };
    expect(response.status).toBe(200);
  });

  it("deja pasar /login aunque esté configurado el secreto", () => {
    withSecret(SECRET);
    const response = proxy(makeRequest("/login")) as { status: number };
    expect(response.status).toBe(200);
  });

  it("el matcher de config y las páginas protegidas están sincronizados", () => {
    const matchers = config.matcher as readonly string[];
    const protectedFromMatcher = matchers
      .filter((entry) => entry !== "/study/:path*")
      .map((entry) => entry.replace(/\/:path\*$/, ""));
    const protectedFromProxy = [
      "/admin",
      "/analytics",
      "/app-dashboard",
      "/data",
      "/kubios",
      "/overview",
      "/users",
      "/privacy",
    ];
    expect(protectedFromMatcher.sort()).toEqual([...protectedFromProxy].sort());
    // /study mantiene su propia regla (404), no es una ruta protegida.
    expect(matchers).toContain("/study/:path*");
  });
});

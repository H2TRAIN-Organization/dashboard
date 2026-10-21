import { describe, expect, it } from "vitest";
import { createAuthRuntime } from "@/server/runtime/auth-runtime";
import { AuthConfigurationError } from "@/server/infrastructure/auth/errors";
import { FakeBcrypt } from "./doubles";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

const SERVICE_KEY = jwt({ role: "service_role", ref: "project" });
const ANON_KEY = jwt({ role: "anon", ref: "project" });
const SESSION_SECRET = "ab".repeat(32);

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    SUPABASE_SECRET_KEY: ANON_KEY,
    AUTH_SESSION_SECRET: SESSION_SECRET,
    ...overrides,
  };
}

describe("auth runtime factory", () => {
  it("builds the runtime from env without exposing secrets", () => {
    const auth = createAuthRuntime({
      environment: environment(),
      bcrypt: new FakeBcrypt(),
      secureCookies: true,
      sessionTtlSeconds: 3600,
    });
    expect(auth.cookies.name).toBe("dashboard_session");
    expect(auth.secureCookies).toBe(true);
    expect(auth.sessionTtlSeconds).toBe(3600);
    expect(auth.gateway).toBeDefined();
    expect(auth.http).toBeDefined();
  });

  it("prefers the valid service_role key over the anon SUPABASE_SECRET_KEY", () => {
    expect(() =>
      createAuthRuntime({
        environment: environment(),
        bcrypt: new FakeBcrypt(),
      }),
    ).not.toThrow();
  });

  it("rejects an anon-only configuration instead of using a public key", () => {
    expect(() =>
      createAuthRuntime({
        environment: environment({
          SUPABASE_SERVICE_ROLE_KEY: undefined,
          SUPABASE_SECRET_KEY: ANON_KEY,
        }),
        bcrypt: new FakeBcrypt(),
      }),
    ).toThrow(AuthConfigurationError);
  });

  it("requires AUTH_SESSION_SECRET in production", () => {
    expect(() =>
      createAuthRuntime({
        environment: environment({ AUTH_SESSION_SECRET: undefined }),
        bcrypt: new FakeBcrypt(),
      }),
    ).toThrow(/AUTH_SESSION_SECRET/);
  });

  it("generates an ephemeral development secret with a warning", () => {
    const warnings: string[] = [];
    const auth = createAuthRuntime({
      environment: environment({
        NODE_ENV: "development",
        AUTH_SESSION_SECRET: undefined,
      }),
      bcrypt: new FakeBcrypt(),
      logger: { warn: (message) => warnings.push(message) },
    });
    expect(auth.secureCookies).toBe(false);
    expect(auth.cookies.name).toBe("dashboard_session");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/AUTH_SESSION_SECRET/);
  });

  it("fails with a clear message when bcrypt is not injected", () => {
    expect(() =>
      createAuthRuntime({
        environment: environment(),
        bcrypt: undefined as unknown as InstanceType<typeof FakeBcrypt>,
      }),
    ).toThrow(/bcrypt/);
  });
});

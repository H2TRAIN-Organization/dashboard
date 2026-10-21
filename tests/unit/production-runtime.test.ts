import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerApplication } from "@/server/composition/container";
import type {
  SupabasePersistence,
  SupabasePersistenceEnvironmentOptions,
} from "@/server/infrastructure/persistence";
import type { AuthRuntime, AuthRuntimeOptions } from "@/server/runtime/auth-runtime";

vi.mock("server-only", () => ({}));

const VALID_BCRYPT_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

const SERVICE_KEY = jwt({ role: "service_role", ref: "synthetic" });
const ANON_KEY = jwt({ role: "anon", ref: "synthetic" });

const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  AUTH_SESSION_SECRET: "ab".repeat(32),
  ENCRYPTION_SECRET_KEY: "cd".repeat(32),
  ENCRYPTION_SECRET_KEY0: "ef".repeat(32),
};

function fakeBcrypt() {
  return {
    compare: async () => true,
    hash: async () => VALID_BCRYPT_HASH,
  };
}

function expectSanitizedServiceUnavailable(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    statusCode: 503,
    code: "SERVICE_UNAVAILABLE",
  });
}

function stubEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string") {
      vi.stubEnv(key, value);
    }
  }
}

function forbiddenFetch() {
  return vi.fn(async () => {
    throw new Error("network access is forbidden in production-runtime tests");
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("production composition root", () => {
  it("does not touch the network just by importing the runtime modules", async () => {
    const fetchSpy = forbiddenFetch();
    vi.stubGlobal("fetch", fetchSpy);

    await import("@/server/composition/runtime");
    await import("@/server/composition/production");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("composes both real auth and persistence factories without remote queries", async () => {
    const fetchSpy = forbiddenFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const { createProductionServerRuntime } = await import(
      "@/server/composition/production"
    );
    const { createAuthRuntime } = await import(
      "@/server/runtime/auth-runtime"
    );
    const { createSupabasePersistenceFromEnvironment } = await import(
      "@/server/infrastructure/persistence"
    );
    const { composeServerApplication } = await import(
      "@/server/composition/container"
    );

    const bcrypt = fakeBcrypt();
    const captured: {
      auth?: AuthRuntime;
      persistence?: SupabasePersistence;
    } = {};
    const authFactory = vi.fn((options: AuthRuntimeOptions) => {
      captured.auth = createAuthRuntime({
        ...options,
        logger: { warn: () => {} },
      });
      return captured.auth;
    });
    const persistenceFactory = vi.fn(
      (options: SupabasePersistenceEnvironmentOptions) => {
        captured.persistence = createSupabasePersistenceFromEnvironment(options);
        return captured.persistence;
      },
    );
    const compose = vi.fn(composeServerApplication);

    const application = createProductionServerRuntime({
      environment: ENV,
      bcrypt,
      createAuth: authFactory,
      createPersistence: persistenceFactory,
      compose,
    });

    expect(authFactory).toHaveBeenCalledTimes(1);
    expect(persistenceFactory).toHaveBeenCalledTimes(1);
    expect(authFactory.mock.calls[0]?.[0]).toMatchObject({
      environment: ENV,
      bcrypt,
    });
    expect(persistenceFactory.mock.calls[0]?.[0]).toMatchObject({
      environment: ENV,
      passwordHasher: expect.objectContaining({
        hash: expect.any(Function),
        verify: expect.any(Function),
      }),
    });

    const auth = captured.auth;
    const store = captured.persistence;
    if (auth === undefined || store === undefined) {
      throw new Error("production runtime did not build both dependencies");
    }
    expect(compose).toHaveBeenCalledTimes(1);
    expect(compose.mock.calls[0]?.[0]).toEqual({
      auth: auth.gateway,
      users: store.users,
      userDataPresence: store.userDataPresence,
      healthData: store.healthData,
      adminDatabase: store.adminDatabase,
    });

    expect(application.http.auth).toBeDefined();
    expect(application.http.users).toBeDefined();
    expect(application.http.data).toBeDefined();
    expect(application.http.adminDatabase).toBeDefined();
    expect(application.useCases.auth).toBeDefined();
    expect(application.useCases.users).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("builds the production default lazily and shares one initialization promise", async () => {
    stubEnvironment(ENV);
    const fetchSpy = forbiddenFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const runtime = await import("@/server/composition/runtime");
    expect(runtime.isServerRuntimeRegistered()).toBe(false);

    const [first, second] = await Promise.all([
      runtime.getServerRuntime(),
      runtime.getServerRuntime(),
    ]);

    expect(first).toBe(second);
    expect(runtime.isServerRuntimeRegistered()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves an explicitly registered test override without clobbering it", async () => {
    const runtime = await import("@/server/composition/runtime");
    const custom = {
      http: {},
      useCases: {},
    } as unknown as ServerApplication;

    runtime.registerServerRuntime(() => custom);

    expect(runtime.isServerRuntimeRegistered()).toBe(true);
    await expect(runtime.getServerRuntime()).resolves.toBe(custom);
  });

  it("returns a sanitized 503 when production environment is missing", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "canary-publishable");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "canary-service");
    vi.stubEnv("SUPABASE_SECRET_KEY", "canary-secret");
    vi.stubEnv("AUTH_SESSION_SECRET", "canary-session");

    const runtime = await import("@/server/composition/runtime");
    const error = await runtime.getServerRuntime().then(
      () => null,
      (caught: unknown) => caught,
    );

    expectSanitizedServiceUnavailable(error);
    expect(String((error as Error).message)).not.toContain("canary");
  });

  it("sanitizes invalid service-role and encryption configuration", async () => {
    const { createProductionServerRuntime } = await import(
      "@/server/composition/production"
    );
    const bcrypt = fakeBcrypt();

    let invalidKeyError: unknown;
    try {
      createProductionServerRuntime({
        environment: {
          ...ENV,
          SUPABASE_SERVICE_ROLE_KEY: ANON_KEY,
          SUPABASE_SECRET_KEY: ANON_KEY,
        },
        bcrypt,
      });
    } catch (error) {
      invalidKeyError = error;
    }
    expectSanitizedServiceUnavailable(invalidKeyError);
    expect(String((invalidKeyError as Error).message)).not.toContain(ANON_KEY);

    let missingEncryptionError: unknown;
    try {
      createProductionServerRuntime({
        environment: {
          ...ENV,
          ENCRYPTION_SECRET_KEY: "",
        },
        bcrypt,
      });
    } catch (error) {
      missingEncryptionError = error;
    }
    expectSanitizedServiceUnavailable(missingEncryptionError);
    expect(String((missingEncryptionError as Error).message)).not.toContain(
      SERVICE_KEY,
    );
  });
});

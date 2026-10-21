import { describe, expect, it } from "vitest";
import {
  assertServiceRoleKey,
  SupabaseAuthStore,
  type FetchLike,
} from "@/server/infrastructure/auth/supabase-auth-store";
import { AuthConfigurationError } from "@/server/infrastructure/auth/errors";
import { VALID_BCRYPT_HASH } from "./doubles";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

const SERVICE_KEY = jwt({ role: "service_role", ref: "project" });
const ANON_KEY = jwt({ role: "anon", ref: "project" });

function storeWith(fetchImpl: FetchLike): SupabaseAuthStore {
  return new SupabaseAuthStore({
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: SERVICE_KEY,
    fetch: fetchImpl,
    rateLimit: { windowSeconds: 900, maxAttempts: 10, blockSeconds: 900 },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("service role key validation", () => {
  it("accepts only a real service_role/secret key", () => {
    expect(() => assertServiceRoleKey(SERVICE_KEY)).not.toThrow();
    expect(() => assertServiceRoleKey("sb_secret_abc")).not.toThrow();
    expect(() => assertServiceRoleKey(ANON_KEY)).toThrow(AuthConfigurationError);
    expect(() => assertServiceRoleKey("sb_publishable_abc")).toThrow(
      AuthConfigurationError,
    );
    expect(() => assertServiceRoleKey("")).toThrow(AuthConfigurationError);
  });
});

describe("SupabaseAuthStore", () => {
  it("reads username credentials from public.users with the public profile", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      requests.push({ url: String(input), init });
      return jsonResponse([
        {
          UserID: "0042",
          Username: "alice",
          PasswordHash: VALID_BCRYPT_HASH,
          UUID: null,
          role: " Admin ",
          GDPRConsent: true,
          GDPRConsentDate: "2026-01-02T03:04:05Z",
        },
      ]);
    };
    const store = storeWith(fetchImpl);
    const credential = await store.findByUsername("alice");

    expect(credential?.user).toEqual({
      id: "42",
      username: "alice",
      email: null,
      role: "admin",
      uuid: null,
      gdprConsent: true,
      gdprConsentAt: "2026-01-02T03:04:05.000Z",
      createdAt: null,
    });
    expect(credential?.passwordHash).toBe(VALID_BCRYPT_HASH);

    const request = requests[0];
    expect(request?.url).toContain("/rest/v1/users?select=");
    expect(request?.url).toContain("Username=eq.alice");
    expect(request?.url).toContain("limit=2");
    const headers = new Headers(request?.init?.headers);
    expect(headers.get("Accept-Profile")).toBe("public");
    expect(headers.get("apikey")).toBe(SERVICE_KEY);
  });

  it("does not select PasswordHash when loading a session user", async () => {
    let capturedUrl = "";
    const fetchImpl: FetchLike = async (input) => {
      capturedUrl = String(input);
      return jsonResponse([
        {
          UserID: 42,
          Username: "alice",
          UUID: "external-uuid",
          role: "user",
          GDPRConsent: false,
          GDPRConsentDate: null,
        },
      ]);
    };
    const store = storeWith(fetchImpl);
    const user = await store.findByUserId("42");
    expect(user?.uuid).toBe("external-uuid");
    expect(user?.email).toBeNull();
    expect(capturedUrl).not.toContain("PasswordHash");
  });

  it("fails closed when public.users has an unknown role", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse([
        {
          UserID: 42,
          Username: "alice",
          role: "owner",
          GDPRConsent: false,
          GDPRConsentDate: null,
        },
      ]);
    const store = storeWith(fetchImpl);
    await expect(store.findByUserId("42")).rejects.toBeInstanceOf(
      AuthConfigurationError,
    );
  });

  it("registers a session without storing the raw token", async () => {
    let body: unknown;
    const fetchImpl: FetchLike = async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(null, { status: 201 });
    };
    const store = storeWith(fetchImpl);
    await store.register({
      sidHash: "a".repeat(64),
      userId: "42",
      method: "username",
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T08:00:00.000Z",
    });
    expect(body).toEqual({
      sid_hash: "a".repeat(64),
      user_id: 42,
      method: "username",
      issued_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-01T08:00:00.000Z",
    });
  });

  it("converts canonical string ids only at the auth_sessions boundary", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      requests.push({ url: String(input), init });
      return jsonResponse([{ sid_hash: "a".repeat(64) }]);
    };
    const store = storeWith(fetchImpl);
    await store.isActive({
      sidHash: "a".repeat(64),
      userId: "0042",
      now: new Date("2026-01-01T01:00:00.000Z"),
    });
    expect(requests[0]?.url).toContain("user_id=eq.42");

    await expect(
      store.register({
        sidHash: "b".repeat(64),
        userId: "not-a-user-id",
        method: "username",
        issuedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T08:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(AuthConfigurationError);
  });

  it("checks revocation and expiry through persisted session state", async () => {
    let capturedUrl = "";
    const fetchImpl: FetchLike = async (input) => {
      capturedUrl = String(input);
      return jsonResponse([{ sid_hash: "a".repeat(64) }]);
    };
    const store = storeWith(fetchImpl);
    const active = await store.isActive({
      sidHash: "a".repeat(64),
      userId: "42",
      now: new Date("2026-01-01T01:00:00.000Z"),
    });
    expect(active).toBe(true);
    expect(capturedUrl).toContain("revoked_at=is.null");
    expect(capturedUrl).toContain("expires_at=gt.");
  });

  it("parses the persistent rate-limit RPC result", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse([
        { allowed: false, retry_after_seconds: 42, remaining: 0 },
      ]);
    const store = storeWith(fetchImpl);
    await expect(store.consume("a".repeat(64))).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 42,
      remaining: 0,
    });
  });

  it("fails closed when the SQL migration is missing", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse([], 404);
    const store = storeWith(fetchImpl);
    await expect(store.consume("a".repeat(64))).rejects.toThrow(
      /HTTP 404/,
    );
  });
});

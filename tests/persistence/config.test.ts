import { describe, expect, it } from "vitest";

import {
  isServiceRoleCredential,
  readSupabasePersistenceConfig,
} from "@/server/infrastructure/persistence/config";

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

const serviceKey = jwt({ role: "service_role" });
const anonKey = jwt({ role: "anon" });

describe("Supabase persistence config", () => {
  it("accepts a service_role JWT", () => {
    expect(isServiceRoleCredential(serviceKey)).toBe(true);
    expect(
      readSupabasePersistenceConfig({
        SUPABASE_URL: "https://example.supabase.co/",
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      }),
    ).toEqual({
      url: "https://example.supabase.co",
      serviceRoleKey: serviceKey,
    });
  });

  it("prefers service_role over an anon SUPABASE_SECRET_KEY", () => {
    const config = readSupabasePersistenceConfig({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    });
    expect(config.serviceRoleKey).toBe(serviceKey);
  });

  it("accepts a new sb_secret_ key", () => {
    expect(isServiceRoleCredential("sb_secret_abcdefghijklmnopqrstuvwxyz")).toBe(true);
  });

  it("fails closed for an anon-only credential without echoing it", () => {
    try {
      readSupabasePersistenceConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: anonKey,
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFIG_INVALID" });
      expect(String(error)).not.toContain(anonKey);
    }
  });

  it("rejects missing URL, invalid URL and insecure remote URL", () => {
    expect(() =>
      readSupabasePersistenceConfig({ SUPABASE_SERVICE_ROLE_KEY: serviceKey }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
    expect(() =>
      readSupabasePersistenceConfig({
        SUPABASE_URL: "not a url",
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
    expect(() =>
      readSupabasePersistenceConfig({
        SUPABASE_URL: "http://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });

  it("allows HTTP only for local development", () => {
    const config = readSupabasePersistenceConfig({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    });
    expect(config.url).toBe("http://127.0.0.1:54321");
  });
});

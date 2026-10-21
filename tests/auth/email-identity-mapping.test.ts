import { describe, expect, it } from "vitest";
import { mapSupabaseAuthUser } from "@/server/infrastructure/auth/supabase-email-transport";
import { createLoginRateLimitKey } from "@/server/infrastructure/auth/rate-limit";

describe("email identity mapping", () => {
  it("uses only app_metadata, never user-editable user_metadata", () => {
    const mapped = mapSupabaseAuthUser({
      id: "auth-user-1",
      email: "Alice@Example.com",
      email_confirmed_at: "2026-01-01T00:00:00Z",
      app_metadata: {
        role: "user",
        app_user_id: 42,
        provider: "email",
      },
      user_metadata: { role: "admin", app_user_id: 1 },
    });
    expect(mapped).toEqual({
      authUserId: "auth-user-1",
      email: "alice@example.com",
      emailConfirmedAt: "2026-01-01T00:00:00.000Z",
      appMetadata: {
        role: "user",
        app_user_id: 42,
        provider: "email",
      },
    });
    expect(mapped?.appMetadata).not.toHaveProperty("user_metadata");
  });

  it("fails closed when app_metadata is missing or not an object", () => {
    expect(
      mapSupabaseAuthUser({
        id: "auth-user-1",
        email: "alice@example.com",
        user_metadata: { role: "admin" },
      }),
    ).toBeNull();
    expect(
      mapSupabaseAuthUser({
        id: "auth-user-1",
        email: "alice@example.com",
        app_metadata: [],
      }),
    ).toBeNull();
    expect(mapSupabaseAuthUser({ email: "alice@example.com" })).toBeNull();
  });
});

describe("rate-limit key", () => {
  it("is stable across case/whitespace and separated by auth method", () => {
    const emailKey = createLoginRateLimitKey("email", " Alice@Example.com ");
    expect(emailKey).toBe(
      createLoginRateLimitKey("email", "alice@example.com"),
    );
    expect(emailKey).not.toBe(
      createLoginRateLimitKey("username", "alice@example.com"),
    );
    expect(emailKey).toMatch(/^[0-9a-f]{64}$/);
  });
});

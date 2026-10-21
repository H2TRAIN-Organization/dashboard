import { describe, expect, it } from "vitest";
import { createAuthCookiePolicy } from "@/server/infrastructure/auth/cookie";
import { createSessionTokenCodec } from "@/server/infrastructure/auth/session-token";
import {
  createAuthHttpBridge,
  toPublicSession,
} from "@/server/infrastructure/auth/public-session";
import { makeUser } from "./doubles";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const EXPIRES = "2026-01-01T08:00:00.000Z";

function makeToken(): string {
  const codec = createSessionTokenCodec(Buffer.alloc(32, 3), {
    now: () => NOW,
  });
  return codec.seal({
    sid: "sid-0123456789abcdef0123456789abcdef",
    uid: "42",
    method: "email",
    iat: Math.floor(NOW.getTime() / 1000),
    exp: Math.floor(Date.parse(EXPIRES) / 1000),
    supabaseAccessToken: "supabase-token",
  });
}

describe("auth cookie policy", () => {
  it("uses the foundation cookie name with secure attributes in production", () => {
    const policy = createAuthCookiePolicy({ secure: true, now: () => NOW });
    const token = makeToken();
    const cookie = policy.serialize(token, EXPIRES, NOW);
    expect(policy.name).toBe("dashboard_session");
    expect(cookie).toContain("dashboard_session=");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=28800");
    expect(cookie).not.toContain("Domain=");
  });

  it("omits Secure only when explicitly disabled for development", () => {
    const policy = createAuthCookiePolicy({ secure: false, now: () => NOW });
    const cookie = policy.serialize(makeToken(), EXPIRES, NOW);
    expect(policy.name).toBe("dashboard_session");
    expect(cookie).not.toContain("; Secure");
  });

  it("reads only its own valid cookie and clears with matching attributes", () => {
    const policy = createAuthCookiePolicy({ secure: true, now: () => NOW });
    const token = makeToken();
    expect(policy.read(`other=1; ${policy.name}=${token}; x=2`)).toBe(token);
    expect(policy.read(`other=${token}`)).toBeNull();
    expect(policy.read(`${policy.name}=not-a-token`)).toBeNull();
    expect(policy.read(undefined)).toBeNull();

    const clear = policy.clear();
    expect(clear).toContain(`${policy.name}=`);
    expect(clear).toContain("Max-Age=0");
    expect(clear).toContain("HttpOnly");
    expect(clear).toContain("Secure");
  });

  it("rejects __Host- names without Secure", () => {
    expect(() =>
      createAuthCookiePolicy({ name: "__Host-x", secure: false }),
    ).toThrow(/__Host-/);
  });
});

describe("public session DTO", () => {
  it("returns method and user without the internal token", () => {
    const token = makeToken();
    const user = makeUser({
      id: "42",
      username: "alice",
      email: "alice@example.com",
      role: "admin",
    });
    const dto = toPublicSession({
      user,
      token,
      method: "email",
      expiresAt: EXPIRES,
    });
    expect(dto).toEqual({
      user,
      method: "email",
      expiresAt: EXPIRES,
    });
    expect(JSON.stringify(dto)).not.toContain(token);
    expect(Object.keys(dto)).not.toContain("token");
  });

  it("bridge sets the cookie and never leaks the token in JSON", () => {
    const policy = createAuthCookiePolicy({ secure: true, now: () => NOW });
    const bridge = createAuthHttpBridge({ cookies: policy });
    const token = makeToken();
    const user = makeUser({ id: "42", username: "alice" });
    const response = bridge.sessionResponse({
      user,
      token,
      method: "email",
      expiresAt: EXPIRES,
    });
    expect(response.status).toBe(200);
    expect(response.body?.method).toBe("email");
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(response.headers["Set-Cookie"]).toContain(`${policy.name}=`);

    const logout = bridge.logoutResponse();
    expect(logout.status).toBe(204);
    expect(logout.headers["Set-Cookie"]).toContain("Max-Age=0");
    expect(bridge.readToken(`${policy.name}=${token}`)).toBe(token);
  });
});

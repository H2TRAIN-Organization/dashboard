import { describe, expect, it } from "vitest";
import { createAuthGateway } from "@/server/infrastructure/auth/auth-gateway";
import { createSessionTokenCodec } from "@/server/infrastructure/auth/session-token";
import {
  FakeClock,
  FakeEmailTransport,
  FakeLimiter,
  FakePasswordVerifier,
  FakeSessionStore,
  FakeUserStore,
  makeUser,
  VALID_BCRYPT_HASH,
} from "./doubles";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function setup() {
  const clock = new FakeClock(NOW);
  const user = makeUser({
    id: "42",
    username: "alice",
    email: null,
    role: "user",
  });
  const users = new FakeUserStore(
    [user],
    new Map([["alice", VALID_BCRYPT_HASH]]),
  );
  const passwords = new FakePasswordVerifier();
  const sessions = new FakeSessionStore();
  const limiter = new FakeLimiter();
  const email = new FakeEmailTransport();
  const codec = createSessionTokenCodec(Buffer.alloc(32, 4), {
    now: () => clock.now(),
  });
  const gateway = createAuthGateway({
    users,
    passwords,
    email,
    sessions,
    limiter,
    tokens: codec,
    clock,
    sessionTtlSeconds: 8 * 60 * 60,
  });
  return {
    clock,
    user,
    users,
    passwords,
    sessions,
    limiter,
    email,
    codec,
    gateway,
  };
}

describe("username authentication", () => {
  it("issues an opaque session for a valid bcrypt credential", async () => {
    const { gateway, sessions, limiter, codec, passwords } = setup();
    const session = await gateway.authenticateByUsername("alice", "correct");

    expect(session).not.toBeNull();
    expect(session?.user).toMatchObject({
      id: "42",
      username: "alice",
      role: "user",
    });
    expect(session?.token.startsWith("v1.")).toBe(true);
    expect(session?.method).toBe("username");
    expect(session?.expiresAt).toBe("2026-01-01T08:00:00.000Z");
    expect(sessions.registerCalls).toHaveLength(1);
    expect(limiter.resetKeys).toHaveLength(1);
    expect(passwords.verifyCalls).toHaveLength(1);

    const payload = codec.open(session?.token ?? "");
    expect(payload?.method).toBe("username");
    expect(payload?.supabaseAccessToken).toBeUndefined();
  });

  it("rejects a wrong password and keeps the failure counted", async () => {
    const { gateway, sessions, limiter } = setup();
    const session = await gateway.authenticateByUsername("alice", "wrong");
    expect(session).toBeNull();
    expect(sessions.size()).toBe(0);
    expect(limiter.resetKeys).toHaveLength(0);
  });

  it("performs a dummy comparison for an unknown username", async () => {
    const { gateway, passwords, sessions } = setup();
    const session = await gateway.authenticateByUsername("nobody", "whatever");
    expect(session).toBeNull();
    expect(passwords.verifyCalls).toHaveLength(0);
    expect(passwords.dummyCalls).toBe(1);
    expect(sessions.size()).toBe(0);
  });

  it("does not query the user store when the persistent limiter blocks", async () => {
    const { gateway, limiter, users, passwords } = setup();
    limiter.allowed = false;
    limiter.retryAfterSeconds = 120;
    const session = await gateway.authenticateByUsername("alice", "correct");
    expect(session).toBeNull();
    expect(users.findByUsernameCalls).toHaveLength(0);
    expect(passwords.verifyCalls).toHaveLength(0);
  });

  it("fails closed for a 64-character non-bcrypt legacy hash", async () => {
    const { gateway, users, sessions, passwords } = setup();
    users.setPasswordHash("alice", "a".repeat(64));
    const session = await gateway.authenticateByUsername("alice", "correct");
    expect(session).toBeNull();
    expect(sessions.size()).toBe(0);
    expect(passwords.dummyCalls).toBe(1);
  });

  it("reloads the current role and user from public.users per session", async () => {
    const { gateway, users } = setup();
    const session = await gateway.authenticateByUsername("alice", "correct");
    const token = session?.token ?? "";
    expect((await gateway.getSession(token))?.user.role).toBe("user");

    users.setRole("42", "doctor");
    const reloaded = await gateway.getSession(token);
    expect(reloaded?.user.role).toBe("doctor");

    users.remove("42");
    expect(await gateway.getSession(token)).toBeNull();
  });

  it("revokes the session on logout", async () => {
    const { gateway, sessions } = setup();
    const session = await gateway.authenticateByUsername("alice", "correct");
    const token = session?.token ?? "";
    expect(await gateway.getSession(token)).not.toBeNull();

    await gateway.revokeSession(token);
    expect(sessions.revokeCalls).toHaveLength(1);
    expect(await gateway.getSession(token)).toBeNull();
  });

  it("rejects tampered and expired tokens", async () => {
    const { gateway, clock } = setup();
    const session = await gateway.authenticateByUsername("alice", "correct");
    const token = session?.token ?? "";
    expect(await gateway.getSession(`${token}x`)).toBeNull();

    clock.advance(8 * 60 * 60 * 1000 + 1000);
    expect(await gateway.getSession(token)).toBeNull();
  });
});

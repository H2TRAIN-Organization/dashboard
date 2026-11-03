import { describe, expect, it } from "vitest";
import { createAuthGateway } from "@/server/infrastructure/auth/auth-gateway";
import { createSessionTokenCodec } from "@/server/infrastructure/auth/session-token";
import { ServiceUnavailableError } from "@/server/domain/errors";
import type { User } from "@/server/domain/user";
import {
  FakeClock,
  FakeEmailTransport,
  FakeLimiter,
  FakePasswordVerifier,
  FakeSessionStore,
  FakeUserStore,
  emailUser,
  makeUser,
  successEmail,
  VALID_BCRYPT_HASH,
} from "./doubles";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function setup(options: {
  appMetadata?: Record<string, unknown>;
  emailAddress?: string;
  userRole?: "admin" | "doctor" | "user";
  userUsername?: string;
  userUuid?: string | null;
  seedUsers?: readonly User[];
  emailLinkIdField?: "UserID" | "UUID";
  resolveVerifiedLink?: (identity: ReturnType<typeof emailUser>) => Promise<{ userId: string } | null>;
} = {}) {
  const clock = new FakeClock(NOW);
  const user = makeUser({
    id: "42",
    username: options.userUsername ?? "alice",
    email: null,
    role: options.userRole ?? "admin",
    uuid: options.userUuid ?? null,
  });
  const seedUsers = options.seedUsers ?? [user];
  const users = new FakeUserStore(seedUsers, new Map([["alice", VALID_BCRYPT_HASH]]));
  const passwords = new FakePasswordVerifier();
  const sessions = new FakeSessionStore();
  const limiter = new FakeLimiter();
  const email = new FakeEmailTransport();
  const emailAddress = options.emailAddress ?? "alice@example.com";
  email.signInResult = successEmail(
    emailUser({
      email: emailAddress,
      appMetadata: options.appMetadata ?? {
        role: "admin",
        app_user_id: "42",
      },
    }),
  );
  email.verifiedUser = emailUser({
    email: emailAddress,
    appMetadata: options.appMetadata ?? {
      role: "admin",
      app_user_id: "42",
    },
  });
  const codec = createSessionTokenCodec(Buffer.alloc(32, 5), {
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
    emailLink: {
      ...(options.emailLinkIdField === undefined
        ? {}
        : { idField: options.emailLinkIdField }),
      ...(options.resolveVerifiedLink === undefined
        ? {}
        : { resolveVerifiedLink: options.resolveVerifiedLink }),
    },
  });
  return { gateway, email, users, sessions, limiter, codec, clock };
}

describe("email authentication", () => {
  it("verifies with getUser and links using explicit app_metadata", async () => {
    const { gateway, email, sessions, codec, limiter } = setup();
    const session = await gateway.authenticateByEmail(
      "Alice@Example.com",
      "correct",
    );

    expect(session).not.toBeNull();
    expect(email.getUserTokens).toEqual([
      "supabase-access-token-secret-value",
    ]);
    expect(session?.user).toMatchObject({
      id: "42",
      username: "alice",
      email: "alice@example.com",
      role: "admin",
    });
    expect(session?.method).toBe("email");
    expect(sessions.registerCalls[0]?.method).toBe("email");
    expect(limiter.resetKeys).toHaveLength(1);

    const token = session?.token ?? "";
    expect(token).not.toContain("supabase-access-token-secret-value");
    const payload = codec.open(token);
    expect(payload?.method).toBe("email");
    expect(payload?.supabaseAccessToken).toBe(
      "supabase-access-token-secret-value",
    );
  });

  it("links a confirmed email to exactly one normalized Username using the users role", async () => {
    const { gateway, sessions } = setup({
      appMetadata: { provider: "email", role: "admin" },
      userUsername: "Alice@Example.com",
      userRole: "doctor",
    });
    const session = await gateway.authenticateByEmail(
      "alice@example.com",
      "correct",
    );

    expect(session?.user).toMatchObject({
      id: "42",
      username: "Alice@Example.com",
      email: "alice@example.com",
      role: "doctor",
    });
    expect(sessions.size()).toBe(1);
  });

  it("links the current operational email jiahao.yang@ulpgc.es to its unique user", async () => {
    const { gateway, sessions } = setup({
      appMetadata: { provider: "email" },
      emailAddress: "jiahao.yang@ulpgc.es",
      userUsername: "jiahao.yang@ulpgc.es",
      userRole: "user",
    });
    const session = await gateway.authenticateByEmail(
      "jiahao.yang@ulpgc.es",
      "correct",
    );

    expect(session?.user).toMatchObject({
      id: "42",
      username: "jiahao.yang@ulpgc.es",
      email: "jiahao.yang@ulpgc.es",
      role: "user",
    });
    expect(session?.method).toBe("email");
    expect(sessions.size()).toBe(1);
  });

  it("denies an ambiguous email/Username match instead of choosing a role", async () => {
    const first = makeUser({
      id: "42",
      username: "alice@example.com",
      role: "user",
    });
    const second = makeUser({
      id: "43",
      username: "ALICE@example.com",
      role: "admin",
    });
    const { gateway, sessions } = setup({
      appMetadata: { provider: "email" },
      seedUsers: [first, second],
    });

    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toThrow(/ambig|vínculo/);
    expect(sessions.size()).toBe(0);
  });

  it("denies an explicit app_user_id that conflicts with the unique Username match", async () => {
    const linked = makeUser({ id: "42", username: "alice", role: "user" });
    const matched = makeUser({
      id: "43",
      username: "alice@example.com",
      role: "admin",
    });
    const { gateway, sessions } = setup({
      appMetadata: { role: "user", app_user_id: "42" },
      seedUsers: [linked, matched],
    });

    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toThrow(/conflicto/);
    expect(sessions.size()).toBe(0);
  });

  it("denies a unique Username link when another user owns the Auth UUID", async () => {
    const target = makeUser({
      id: "42",
      username: "alice@example.com",
      role: "user",
    });
    const uuidOwner = makeUser({
      id: "43",
      username: "other",
      role: "user",
      uuid: "auth-user-1",
    });
    const { gateway, sessions } = setup({
      appMetadata: { provider: "email" },
      seedUsers: [target, uuidOwner],
    });

    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toThrow(/UUID|distintos/);
    expect(sessions.size()).toBe(0);
  });

  it("denies an explicit app_user_id when another user owns the Auth UUID", async () => {
    const linked = makeUser({ id: "42", username: "alice", role: "user" });
    const uuidOwner = makeUser({
      id: "43",
      username: "other",
      role: "user",
      uuid: "auth-user-1",
    });
    const { gateway, sessions } = setup({
      appMetadata: { role: "user", app_user_id: "42" },
      seedUsers: [linked, uuidOwner],
    });

    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toThrow(/UUID|distinto/);
    expect(sessions.size()).toBe(0);
  });

  it("denies a malformed app_user_id even when the email has a unique Username", async () => {
    const { gateway, sessions } = setup({
      appMetadata: { app_user_id: { nested: true } },
      userUsername: "alice@example.com",
    });

    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toThrow(/app_user_id/);
    expect(sessions.size()).toBe(0);
  });

  it("fails closed when a UUID-mode app_user_id does not resolve", async () => {
    const { gateway, sessions } = setup({
      appMetadata: { role: "user", app_user_id: "missing-auth-uuid" },
      emailLinkIdField: "UUID",
    });

    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toThrow(/app_user_id|vínculo/);
    expect(sessions.size()).toBe(0);
  });

  it("fails closed when app_metadata has no link and no unique Username match", async () => {
    const { gateway, sessions } = setup({ appMetadata: { role: "admin" } });
    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toThrow(/vínculo|app_metadata/);
    expect(sessions.size()).toBe(0);
  });

  it("rejects a metadata role that does not match public.users", async () => {
    const { gateway, sessions } = setup({
      appMetadata: { role: "admin", app_user_id: "42" },
      userRole: "user",
    });
    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toThrow(/no coincide/);
    expect(sessions.size()).toBe(0);
  });

  it("rejects unknown roles instead of defaulting to user/admin", async () => {
    const { gateway } = setup({
      appMetadata: { role: "superadmin", app_user_id: "42" },
    });
    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toThrow(/role válido/);
  });

  it("rejects an unconfirmed email identity", async () => {
    const { gateway, email, sessions } = setup();
    email.verifiedUser = emailUser({ emailConfirmedAt: null });
    expect(
      await gateway.authenticateByEmail("alice@example.com", "correct"),
    ).toBeNull();
    expect(sessions.size()).toBe(0);
  });

  it("rejects a getUser identity that differs from the password grant", async () => {
    const { gateway, email } = setup();
    email.verifiedUser = emailUser({ authUserId: "another-auth-id" });
    expect(
      await gateway.authenticateByEmail("alice@example.com", "correct"),
    ).toBeNull();
  });

  it("rejects a verified email that differs from the requested one", async () => {
    const { gateway, email } = setup();
    email.verifiedUser = emailUser({ email: "other@example.com" });
    expect(
      await gateway.authenticateByEmail("alice@example.com", "correct"),
    ).toBeNull();
  });

  it("supports only an explicitly injected verified-link resolver", async () => {
    const { gateway, sessions } = setup({
      appMetadata: { provider: "email" },
      resolveVerifiedLink: async () => ({ userId: "42" }),
    });
    const session = await gateway.authenticateByEmail(
      "alice@example.com",
      "correct",
    );
    expect(session?.user.role).toBe("admin");
    expect(sessions.size()).toBe(1);
  });

  it("returns null for invalid Supabase credentials without issuing a session", async () => {
    const { gateway, email, sessions } = setup();
    email.signInResult = { ok: false, reason: "invalid_credentials" };
    expect(
      await gateway.authenticateByEmail("alice@example.com", "wrong"),
    ).toBeNull();
    expect(email.getUserCalls).toBe(0);
    expect(sessions.size()).toBe(0);
  });

  it("reports a 503-style failure when Supabase is unavailable", async () => {
    const { gateway, email } = setup();
    email.signInResult = { ok: false, reason: "unavailable" };
    await expect(
      gateway.authenticateByEmail("alice@example.com", "correct"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("revokes both the local and Supabase email session on logout", async () => {
    const { gateway, email, sessions } = setup();
    const session = await gateway.authenticateByEmail(
      "alice@example.com",
      "correct",
    );
    const token = session?.token ?? "";
    expect(await gateway.getSession(token)).not.toBeNull();

    await gateway.revokeSession(token);
    expect(sessions.revokeCalls).toHaveLength(1);
    expect(email.revokedTokens).toEqual([
      "supabase-access-token-secret-value",
    ]);
    expect(await gateway.getSession(token)).toBeNull();
  });
});

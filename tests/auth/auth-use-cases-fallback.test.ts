import { describe, expect, it } from "vitest";

import type { AuthGateway } from "@/server/application/ports/auth-gateway";
import { createAuthUseCases } from "@/server/application/auth/auth-use-cases";
import { ServiceUnavailableError } from "@/server/domain/errors";
import type { Session } from "@/server/domain/session";
import { makeUser } from "../helpers/fixtures";

const legacyUser = makeUser({
  id: "42",
  username: "javier.alayón@ulpgc.es",
  role: "user",
});

const emailUser = makeUser({
  id: "7",
  username: "alice",
  email: "alice@example.com",
  role: "user",
});

function sessionFor(user: typeof legacyUser, method: "email" | "username"): Session {
  return {
    user,
    token: `token-${user.id}-${method}`,
    method,
    expiresAt: "2026-12-31T23:59:59.000Z",
  };
}

class FakeGateway implements AuthGateway {
  readonly emailCalls: Array<{ email: string; password: string }> = [];
  readonly usernameCalls: Array<{ username: string; password: string }> = [];
  readonly legacyChecks: string[] = [];
  readonly revokedTokens: string[] = [];

  constructor(
    private readonly emailResult: Session | Error | null,
    private readonly usernameResult: Session | Error | null,
    private readonly legacyExists = false,
  ) {}

  async authenticateByEmail(email: string, password: string): Promise<Session | null> {
    this.emailCalls.push({ email, password });
    if (this.emailResult instanceof Error) {
      throw this.emailResult;
    }
    return this.emailResult;
  }

  async authenticateByUsername(
    username: string,
    password: string,
  ): Promise<Session | null> {
    this.usernameCalls.push({ username, password });
    if (this.usernameResult instanceof Error) {
      throw this.usernameResult;
    }
    return this.usernameResult;
  }

  async hasLegacyUsername(username: string): Promise<boolean> {
    this.legacyChecks.push(username);
    return this.legacyExists;
  }

  async getSession(): Promise<Session | null> {
    return null;
  }

  async revokeSession(token: string): Promise<void> {
    this.revokedTokens.push(token);
  }
}

describe("login identifier fallback", () => {
  it("accepts an email-shaped legacy Username and reports the username method", async () => {
    const gateway = new FakeGateway(
      null,
      sessionFor(legacyUser, "username"),
      true,
    );
    const auth = createAuthUseCases(gateway);

    const session = await auth.login({
      kind: "email",
      email: " javier.alayón@ulpgc.es ",
      password: "legacy-password",
    });

    expect(session).toMatchObject({
      method: "username",
      user: { id: "42", role: "user" },
    });
    expect(gateway.emailCalls).toEqual([
      { email: "javier.alayón@ulpgc.es", password: "legacy-password" },
    ]);
    expect(gateway.usernameCalls).toEqual([
      { username: "javier.alayón@ulpgc.es", password: "legacy-password" },
    ]);
  });

  it("does not probe the legacy credential when no legacy Username exists", async () => {
    const gateway = new FakeGateway(sessionFor(emailUser, "email"), null);
    const auth = createAuthUseCases(gateway);

    const session = await auth.login({
      kind: "email",
      email: "alice@example.com",
      password: "email-password",
    });

    expect(session.method).toBe("email");
    expect(session.user.id).toBe("7");
    expect(gateway.usernameCalls).toHaveLength(0);
  });

  it("denies and revokes both sessions when the identifier maps to two different users", async () => {
    const emailSession = sessionFor(emailUser, "email");
    const legacySession = sessionFor(legacyUser, "username");
    const gateway = new FakeGateway(emailSession, legacySession, true);
    const auth = createAuthUseCases(gateway);

    await expect(
      auth.login({
        kind: "email",
        email: "javier.alayón@ulpgc.es",
        password: "shared-password",
      }),
    ).rejects.toMatchObject({ statusCode: 401, code: "UNAUTHORIZED" });
    expect(gateway.revokedTokens.sort()).toEqual(
      [emailSession.token, legacySession.token].sort(),
    );
  });

  it("keeps the email session when both credentials point to the same user", async () => {
    const emailSession = sessionFor(legacyUser, "email");
    const legacySession = sessionFor(legacyUser, "username");
    const gateway = new FakeGateway(emailSession, legacySession, true);
    const auth = createAuthUseCases(gateway);

    const session = await auth.login({
      kind: "email",
      email: "javier.alayón@ulpgc.es",
      password: "shared-password",
    });

    expect(session.method).toBe("email");
    expect(session.user.id).toBe("42");
    expect(gateway.revokedTokens).toEqual([legacySession.token]);
  });

  it("rejects when neither credential matches", async () => {
    const auth = createAuthUseCases(new FakeGateway(null, null));

    await expect(
      auth.login({
        kind: "email",
        email: "nobody@example.com",
        password: "wrong",
      }),
    ).rejects.toMatchObject({ statusCode: 401, code: "UNAUTHORIZED" });
  });

  it("does not fall back when the email identity fails closed for infrastructure/config reasons", async () => {
    const gateway = new FakeGateway(
      new ServiceUnavailableError("identidad de email no vinculada"),
      sessionFor(legacyUser, "username"),
    );
    const auth = createAuthUseCases(gateway);

    await expect(
      auth.login({
        kind: "email",
        email: "javier.alayón@ulpgc.es",
        password: "legacy-password",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(gateway.usernameCalls).toHaveLength(0);
  });

  it("keeps the explicit username branch independent", async () => {
    const gateway = new FakeGateway(null, sessionFor(legacyUser, "username"));
    const auth = createAuthUseCases(gateway);

    const session = await auth.login({
      kind: "username",
      username: " javier.alayón@ulpgc.es ",
      password: "legacy-password",
    });

    expect(session.method).toBe("username");
    expect(gateway.emailCalls).toHaveLength(0);
    expect(gateway.usernameCalls).toEqual([
      { username: "javier.alayón@ulpgc.es", password: "legacy-password" },
    ]);
  });
});

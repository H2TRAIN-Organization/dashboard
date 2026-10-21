import type { AuthGateway, LoginCredentials } from "@/server/application/ports/auth-gateway";
import type { Session } from "@/server/domain/session";
import type { User } from "@/server/domain/user";

export interface TestAccount {
  readonly user: User;
  readonly password: string;
  readonly token: string;
  readonly method: "email" | "username";
  readonly expiresAt: string;
}

/**
 * Test-only authentication double. Passwords are plain strings in memory and
 * exist solely to exercise the application boundary. It is not a production
 * adapter and is never imported by the composition root.
 */
export class TestAuthGateway implements AuthGateway {
  private readonly accounts: readonly TestAccount[];
  private readonly revoked = new Set<string>();

  constructor(accounts: readonly TestAccount[] = []) {
    this.accounts = accounts;
  }

  private sessionFor(account: TestAccount, method: "email" | "username"): Session {
    return {
      user: account.user,
      token: account.token,
      method,
      expiresAt: account.expiresAt,
    };
  }

  async authenticateByEmail(email: string, password: string): Promise<Session | null> {
    return this.authenticate({ email, password }, "email");
  }

  async authenticateByUsername(
    username: string,
    password: string,
  ): Promise<Session | null> {
    return this.authenticate({ username, password }, "username");
  }

  private async authenticate(
    credentials: LoginCredentials,
    method: "email" | "username",
  ): Promise<Session | null> {
    const account = this.accounts.find((candidate) => {
      const matchesIdentifier =
        (credentials.email !== undefined && candidate.user.email === credentials.email) ||
        (credentials.username !== undefined &&
          candidate.user.username === credentials.username);
      return matchesIdentifier && candidate.password === credentials.password;
    });
    return account === undefined ? null : this.sessionFor(account, method);
  }

  async getSession(token: string): Promise<Session | null> {
    if (this.revoked.has(token)) {
      return null;
    }
    const account = this.accounts.find((candidate) => candidate.token === token);
    return account === undefined
      ? null
      : this.sessionFor(account, account.method);
  }

  async revokeSession(token: string): Promise<void> {
    this.revoked.add(token);
  }
}

import type { Clock } from "@/server/application/ports/clock";
import type {
  AuthCredentialUser,
  AuthSessionRecord,
  AuthSessionStore,
  AuthUserStore,
  EmailAuthTransport,
  EmailPasswordResult,
  LoginRateLimiter,
  PasswordVerification,
  PasswordVerifier,
  RateLimitDecision,
  VerifiedEmailUser,
} from "@/server/infrastructure/auth/contracts";
import type { BcryptLibrary } from "@/server/infrastructure/auth/bcrypt-password-verifier";
import type { User } from "@/server/domain/user";

export const VALID_BCRYPT_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export function makeUser(overrides: Partial<User> & Pick<User, "id" | "username">): User {
  return {
    email: null,
    role: "user",
    uuid: null,
    gdprConsent: false,
    gdprConsentAt: null,
    createdAt: null,
    ...overrides,
  };
}

export class FakeClock implements Clock {
  private currentMs: number;

  constructor(initial: Date) {
    this.currentMs = initial.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  advance(milliseconds: number): void {
    this.currentMs += milliseconds;
  }
}

export class FakeUserStore implements AuthUserStore {
  private users = new Map<string, User>();
  private usernames = new Map<string, string>();
  private hashes = new Map<string, string>();
  readonly findByIdCalls: string[] = [];
  readonly findByUsernameCalls: string[] = [];

  constructor(seed: readonly User[], credentials: ReadonlyMap<string, string>) {
    for (const user of seed) {
      this.users.set(user.id, { ...user });
    }
    for (const [username, hash] of credentials) {
      const user = seed.find((candidate) => candidate.username === username);
      if (user !== undefined) {
        this.usernames.set(username, user.id);
        this.hashes.set(user.id, hash);
      }
    }
  }

  setRole(id: string, role: User["role"]): void {
    const user = this.users.get(id);
    if (user !== undefined) {
      this.users.set(id, { ...user, role });
    }
  }

  remove(id: string): void {
    this.users.delete(id);
  }

  setPasswordHash(username: string, hash: string): void {
    const id = this.usernames.get(username);
    if (id !== undefined) {
      this.hashes.set(id, hash);
    }
  }

  async findByUsername(username: string): Promise<AuthCredentialUser | null> {
    this.findByUsernameCalls.push(username);
    const id = this.usernames.get(username);
    if (id === undefined) {
      return null;
    }
    const user = this.users.get(id);
    if (user === undefined) {
      return null;
    }
    return { user: { ...user }, passwordHash: this.hashes.get(id) ?? "" };
  }

  async findByUserId(id: string): Promise<User | null> {
    this.findByIdCalls.push(id);
    const user = this.users.get(id);
    return user === undefined ? null : { ...user };
  }

  async findByUuid(uuid: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.uuid === uuid) {
        return { ...user };
      }
    }
    return null;
  }
}

interface StoredSession {
  readonly record: AuthSessionRecord;
  revoked: boolean;
}

export class FakeSessionStore implements AuthSessionStore {
  private sessions = new Map<string, StoredSession>();
  readonly registerCalls: AuthSessionRecord[] = [];
  readonly revokeCalls: string[] = [];

  async register(record: AuthSessionRecord): Promise<void> {
    this.registerCalls.push(record);
    this.sessions.set(record.sidHash, { record, revoked: false });
  }

  async isActive(input: {
    readonly sidHash: string;
    readonly userId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const stored = this.sessions.get(input.sidHash);
    if (stored === undefined || stored.revoked) {
      return false;
    }
    return (
      stored.record.userId === input.userId &&
      Date.parse(stored.record.expiresAt) > input.now.getTime()
    );
  }

  async revoke(sidHash: string): Promise<void> {
    this.revokeCalls.push(sidHash);
    const stored = this.sessions.get(sidHash);
    if (stored !== undefined) {
      stored.revoked = true;
    }
  }

  size(): number {
    return this.sessions.size;
  }
}

export class FakeLimiter implements LoginRateLimiter {
  allowed = true;
  retryAfterSeconds = 0;
  readonly consumeKeys: string[] = [];
  readonly resetKeys: string[] = [];

  async consume(keyHash: string): Promise<RateLimitDecision> {
    this.consumeKeys.push(keyHash);
    return {
      allowed: this.allowed,
      retryAfterSeconds: this.retryAfterSeconds,
      remaining: this.allowed ? 9 : 0,
    };
  }

  async reset(keyHash: string): Promise<void> {
    this.resetKeys.push(keyHash);
  }
}

export class FakePasswordVerifier implements PasswordVerifier {
  password = "correct";
  readonly verifyCalls: { password: string; hash: string }[] = [];
  dummyCalls = 0;

  async verify(password: string, hash: string): Promise<PasswordVerification> {
    this.verifyCalls.push({ password, hash });
    if (!hash.startsWith("$2b$")) {
      return { ok: false, cost: null, reason: "malformed" };
    }
    return password === this.password
      ? { ok: true, cost: 10, reason: "ok" }
      : { ok: false, cost: 10, reason: "mismatch" };
  }

  async verifyDummy(): Promise<void> {
    this.dummyCalls += 1;
  }
}

export class FakeEmailTransport implements EmailAuthTransport {
  signInResult: EmailPasswordResult = {
    ok: false,
    reason: "invalid_credentials",
  };
  verifiedUser: VerifiedEmailUser | null = null;
  readonly getUserTokens: string[] = [];
  readonly revokedTokens: string[] = [];
  getUserCalls = 0;

  async signInWithPassword(): Promise<EmailPasswordResult> {
    return this.signInResult;
  }

  async getUser(accessToken: string): Promise<VerifiedEmailUser | null> {
    this.getUserCalls += 1;
    this.getUserTokens.push(accessToken);
    return this.verifiedUser;
  }

  async revokeAccessToken(accessToken: string): Promise<void> {
    this.revokedTokens.push(accessToken);
  }
}

export class FakeBcrypt implements BcryptLibrary {
  compareResult = true;
  readonly comparisons: { data: string; hash: string }[] = [];
  hashCalls = 0;

  async compare(data: string, hash: string): Promise<boolean> {
    this.comparisons.push({ data, hash });
    return this.compareResult;
  }

  async hash(): Promise<string> {
    this.hashCalls += 1;
    return VALID_BCRYPT_HASH;
  }
}

export function emailUser(
  overrides: Partial<VerifiedEmailUser> = {},
): VerifiedEmailUser {
  return {
    authUserId: "auth-user-1",
    email: "alice@example.com",
    emailConfirmedAt: "2026-01-01T00:00:00.000Z",
    appMetadata: { role: "admin", app_user_id: "42" },
    ...overrides,
  };
}

export function successEmail(
  user: VerifiedEmailUser,
): EmailPasswordResult {
  return {
    ok: true,
    session: {
      accessToken: "supabase-access-token-secret-value",
      expiresAt: "2026-01-01T01:00:00.000Z",
      user,
    },
  };
}

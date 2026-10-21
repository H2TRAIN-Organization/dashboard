import type { AuthMethod, PublicSession } from "@/server/domain/session";
import type { User } from "@/server/domain/user";

export type { AuthMethod };
export type PublicSessionDto = PublicSession;

/**
 * Internal credential record. The hash only exists inside the server-side
 * username verifier and is never part of a public DTO.
 */
export interface AuthCredentialUser {
  readonly user: User;
  readonly passwordHash: string;
}

/**
 * Result of Supabase Auth verification. `appMetadata` comes only from
 * `auth.users.app_metadata`, never from user-editable metadata.
 */
export interface VerifiedEmailUser {
  readonly authUserId: string;
  readonly email: string;
  readonly emailConfirmedAt: string | null;
  readonly appMetadata: Readonly<Record<string, unknown>>;
}

export interface EmailPasswordSession {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly user: VerifiedEmailUser;
}

export type EmailPasswordResult =
  | { readonly ok: true; readonly session: EmailPasswordSession }
  | {
      readonly ok: false;
      readonly reason: "invalid_credentials" | "unavailable";
    };

/**
 * Transport abstraction around Supabase Auth. Production uses the official
 * server-side client; tests inject a synthetic double.
 */
export interface EmailAuthTransport {
  signInWithPassword(email: string, password: string): Promise<EmailPasswordResult>;
  /** Re-verifies an access token with the public key and returns its identity. */
  getUser(accessToken: string): Promise<VerifiedEmailUser | null>;
  /** Best-effort Supabase-side revocation during logout. */
  revokeAccessToken(accessToken: string): Promise<void>;
}

export interface AuthUserStore {
  findByUsername(username: string): Promise<AuthCredentialUser | null>;
  findByUserId(id: string): Promise<User | null>;
  findByUuid(uuid: string): Promise<User | null>;
}

export interface AuthSessionRecord {
  readonly sidHash: string;
  readonly userId: string;
  readonly method: AuthMethod;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/**
 * Persistent session registry. It stores only a hash of the random session id,
 * never the cookie token or any Supabase credential.
 */
export interface AuthSessionStore {
  register(record: AuthSessionRecord): Promise<void>;
  isActive(input: {
    readonly sidHash: string;
    readonly userId: string;
    readonly now: Date;
  }): Promise<boolean>;
  revoke(sidHash: string, now: Date): Promise<void>;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

/**
 * Persistent, serverless-safe login limiter. Implementations must not rely on
 * process memory. A failure must throw so authentication fails closed.
 */
export interface LoginRateLimiter {
  consume(keyHash: string): Promise<RateLimitDecision>;
  reset(keyHash: string): Promise<void>;
}

export type PasswordVerificationReason =
  | "ok"
  | "missing"
  | "malformed"
  | "unsupported_cost"
  | "mismatch"
  | "verification_error";

export interface PasswordVerification {
  readonly ok: boolean;
  readonly cost: number | null;
  readonly reason: PasswordVerificationReason;
}

export interface PasswordVerifier {
  verify(password: string, passwordHash: string): Promise<PasswordVerification>;
  /** Constant-work comparison used when the username does not exist. */
  verifyDummy(password: string): Promise<void>;
}

export interface VerifiedEmailLink {
  readonly userId: string;
}

/**
 * Optional escape hatch for an existing, explicitly verified identity link.
 * It must not infer a link from names, emails or an unverified UUID column.
 */
export type VerifiedEmailLinkResolver = (
  identity: VerifiedEmailUser,
) => Promise<VerifiedEmailLink | null>;



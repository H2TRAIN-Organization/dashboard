import { createHash, randomBytes } from "node:crypto";
import type { AuthGateway } from "@/server/application/ports/auth-gateway";
import { systemClock, type Clock } from "@/server/application/ports/clock";
import { isAppError } from "@/server/domain/errors";
import type { Session } from "@/server/domain/session";
import { isUserRole, type User, type UserRole } from "@/server/domain/user";
import type {
  AuthUserStore,
  EmailAuthTransport,
  LoginRateLimiter,
  PasswordVerifier,
  VerifiedEmailLinkResolver,
  VerifiedEmailUser,
  AuthSessionStore,
} from "./contracts";
import { AuthConfigurationError, AuthInfrastructureError } from "./errors";
import {
  createLoginRateLimitKey,
  normalizeEmail,
  normalizeUsername,
} from "./rate-limit";
import type { SessionTokenCodec } from "./session-token";

const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface EmailLinkOptions {
  /**
   * Column used by app_metadata.app_user_id. It must be an explicitly
   * administered value, not an inferred auth UUID. Defaults to UserID.
   */
  readonly idField?: "UserID" | "UUID";
  /**
   * Optional resolver for an already verified existing identity link. It is
   * only called when app_metadata.app_user_id is absent.
   */
  readonly resolveVerifiedLink?: VerifiedEmailLinkResolver;
}

export interface AuthGatewayDependencies {
  readonly users: AuthUserStore;
  readonly passwords: PasswordVerifier;
  readonly email: EmailAuthTransport;
  readonly sessions: AuthSessionStore;
  readonly limiter: LoginRateLimiter;
  readonly tokens: SessionTokenCodec;
  readonly clock?: Clock;
  readonly sessionTtlSeconds?: number;
  readonly emailLink?: EmailLinkOptions;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readMetadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = metadata[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return null;
}

function readMetadataRole(
  metadata: Readonly<Record<string, unknown>>,
): UserRole | null {
  const value = readMetadataString(metadata, "role");
  if (value === null) {
    return null;
  }
  const normalized = value.toLowerCase();
  return isUserRole(normalized) ? normalized : null;
}

function failInfrastructure(error: unknown): never {
  if (isAppError(error)) {
    throw error;
  }
  throw new AuthInfrastructureError();
}

/**
 * AuthGateway implementation:
 * - email: Supabase password grant + getUser() verification + explicit
 *   app_metadata link (or an injected verified link resolver).
 * - username: legacy public.users PasswordHash + bcrypt comparison.
 * - sessions: AES-256-GCM opaque token, persistent sid registry, role reloaded
 *   from public.users on every getSession.
 */
export function createAuthGateway(
  dependencies: AuthGatewayDependencies,
): AuthGateway {
  const {
    users,
    passwords,
    email,
    sessions,
    limiter,
    tokens,
    emailLink,
  } = dependencies;
  const clock = dependencies.clock ?? systemClock;
  const sessionTtlSeconds =
    dependencies.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  if (!Number.isSafeInteger(sessionTtlSeconds) || sessionTtlSeconds < 60) {
    throw new AuthConfigurationError(
      "La duración de sesión configurada no es válida.",
    );
  }

  async function issueSession(
    user: User,
    method: "email" | "username",
    supabaseAccessToken?: string,
  ): Promise<Session> {
    const now = clock.now();
    const issuedAtSeconds = Math.floor(now.getTime() / 1000);
    const expiresAtSeconds = issuedAtSeconds + sessionTtlSeconds;
    const sid = randomBytes(32).toString("base64url");
    const sidHash = sha256Hex(sid);
    const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
    const token = tokens.seal({
      sid,
      uid: user.id,
      method,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
      ...(supabaseAccessToken === undefined ? {} : { supabaseAccessToken }),
    });

    try {
      await sessions.register({
        sidHash,
        userId: user.id,
        method,
        issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
        expiresAt,
      });
    } catch (error) {
      failInfrastructure(error);
    }

    return { user, token, method, expiresAt };
  }

  async function consumeLimit(keyHash: string): Promise<boolean> {
    try {
      const decision = await limiter.consume(keyHash);
      return decision.allowed;
    } catch (error) {
      failInfrastructure(error);
    }
  }

  async function resetLimit(keyHash: string): Promise<void> {
    try {
      await limiter.reset(keyHash);
    } catch {
      // A failed reset only makes the limiter more restrictive. It must not
      // turn a valid credential into an authentication failure.
    }
  }

  async function resolveEmailUser(identity: VerifiedEmailUser): Promise<User> {
    const appUserId = readMetadataString(identity.appMetadata, "app_user_id");
    const appRole = readMetadataRole(identity.appMetadata);

    if (appUserId !== null) {
      if (appRole === null) {
        throw new AuthConfigurationError(
          "La identidad de email tiene app_metadata.app_user_id pero no un app_metadata.role válido (admin|doctor|user).",
        );
      }
      let linkedUser: User | null;
      try {
        linkedUser =
          emailLink?.idField === "UUID"
            ? await users.findByUuid(appUserId)
            : await users.findByUserId(appUserId);
      } catch (error) {
        failInfrastructure(error);
      }
      if (linkedUser === null) {
        throw new AuthConfigurationError(
          "app_metadata.app_user_id no corresponde a ningún usuario de public.users.",
        );
      }
      if (linkedUser.role !== appRole) {
        throw new AuthConfigurationError(
          "app_metadata.role no coincide con el rol de public.users. Corrija el vínculo antes de iniciar sesión.",
        );
      }
      return { ...linkedUser, email: identity.email };
    }

    const resolver = emailLink?.resolveVerifiedLink;
    if (resolver !== undefined) {
      let linked: { userId: string } | null;
      try {
        linked = await resolver(identity);
      } catch (error) {
        failInfrastructure(error);
      }
      if (linked === null) {
        throw new AuthConfigurationError(
          "La identidad de email no tiene un vínculo verificado con public.users.",
        );
      }
      let linkedUser: User | null;
      try {
        linkedUser = await users.findByUserId(linked.userId);
      } catch (error) {
        failInfrastructure(error);
      }
      if (linkedUser === null) {
        throw new AuthConfigurationError(
          "El vínculo verificado apunta a un usuario inexistente en public.users.",
        );
      }
      return { ...linkedUser, email: identity.email };
    }

    throw new AuthConfigurationError(
      "La identidad de email no tiene vínculo explícito. Configure app_metadata.role y app_metadata.app_user_id (o un resolvedor verificado) antes de habilitar el login por email.",
    );
  }

  return {
    async authenticateByEmail(
      emailAddress: string,
      password: string,
    ): Promise<Session | null> {
      const normalized = normalizeEmail(emailAddress);
      if (normalized.length === 0 || password.length === 0) {
        return null;
      }
      const limitKey = createLoginRateLimitKey("email", normalized);
      if (!(await consumeLimit(limitKey))) {
        return null;
      }

      let signed: Awaited<ReturnType<EmailAuthTransport["signInWithPassword"]>>;
      try {
        signed = await email.signInWithPassword(normalized, password);
      } catch (error) {
        failInfrastructure(error);
      }
      if (!signed.ok) {
        if (signed.reason === "unavailable") {
          throw new AuthInfrastructureError(
            "No se pudo verificar la identidad de email.",
          );
        }
        return null;
      }

      let verified: VerifiedEmailUser | null;
      try {
        verified = await email.getUser(signed.session.accessToken);
      } catch (error) {
        failInfrastructure(error);
      }
      if (verified === null) {
        return null;
      }
      if (
        verified.authUserId !== signed.session.user.authUserId ||
        normalizeEmail(verified.email) !== normalized ||
        verified.emailConfirmedAt === null
      ) {
        return null;
      }

      const user = await resolveEmailUser(verified);
      const session = await issueSession(
        user,
        "email",
        signed.session.accessToken,
      );
      await resetLimit(limitKey);
      return session;
    },

    async authenticateByUsername(
      username: string,
      password: string,
    ): Promise<Session | null> {
      const normalized = normalizeUsername(username);
      if (normalized.length === 0 || password.length === 0) {
        return null;
      }
      const limitKey = createLoginRateLimitKey("username", normalized);
      if (!(await consumeLimit(limitKey))) {
        return null;
      }

      let credential: Awaited<ReturnType<AuthUserStore["findByUsername"]>>;
      try {
        credential = await users.findByUsername(normalized);
      } catch (error) {
        failInfrastructure(error);
      }
      if (credential === null) {
        await passwords.verifyDummy(password);
        return null;
      }

      let verification: Awaited<ReturnType<PasswordVerifier["verify"]>>;
      try {
        verification = await passwords.verify(password, credential.passwordHash);
      } catch (error) {
        failInfrastructure(error);
      }
      if (!verification.ok) {
        if (verification.reason !== "mismatch") {
          // Equalize timing for malformed/unsupported legacy hashes.
          await passwords.verifyDummy(password);
        }
        return null;
      }

      const session = await issueSession(credential.user, "username");
      await resetLimit(limitKey);
      return session;
    },

    async getSession(token: string): Promise<Session | null> {
      const now = clock.now();
      const payload = tokens.open(token, now);
      if (payload === null) {
        return null;
      }
      const sidHash = sha256Hex(payload.sid);

      let active: boolean;
      try {
        active = await sessions.isActive({
          sidHash,
          userId: payload.uid,
          now,
        });
      } catch (error) {
        failInfrastructure(error);
      }
      if (!active) {
        return null;
      }

      let user: User | null;
      try {
        user = await users.findByUserId(payload.uid);
      } catch (error) {
        failInfrastructure(error);
      }
      if (user === null) {
        try {
          await sessions.revoke(sidHash, now);
        } catch {
          // The user no longer exists; rejecting the session is already safe.
        }
        return null;
      }

      return {
        user,
        token,
        method: payload.method,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
      };
    },

    async revokeSession(token: string): Promise<void> {
      const now = clock.now();
      const payload = tokens.open(token, now);
      if (payload === null) {
        return;
      }
      try {
        await sessions.revoke(sha256Hex(payload.sid), now);
      } catch (error) {
        failInfrastructure(error);
      }
      if (payload.method === "email" && payload.supabaseAccessToken !== undefined) {
        try {
          await email.revokeAccessToken(payload.supabaseAccessToken);
        } catch {
          // Local revocation is already persistent. Supabase revocation is
          // best effort because the access token may have expired.
        }
      }
    },
  };
}

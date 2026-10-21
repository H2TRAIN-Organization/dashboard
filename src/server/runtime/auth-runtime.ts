import type { AuthGateway } from "@/server/application/ports/auth-gateway";
import type { Clock } from "@/server/application/ports/clock";
import type { PublicSession, Session } from "@/server/domain/session";
import {
  createAuthGateway,
  type EmailLinkOptions,
} from "@/server/infrastructure/auth/auth-gateway";
import {
  createBcryptPasswordVerifier,
  type BcryptLibrary,
} from "@/server/infrastructure/auth/bcrypt-password-verifier";
import {
  createAuthCookiePolicy,
  type AuthCookiePolicy,
} from "@/server/infrastructure/auth/cookie";
import { AuthConfigurationError } from "@/server/infrastructure/auth/errors";
import {
  createAuthHttpBridge,
  toPublicSession,
  type AuthHttpBridge,
} from "@/server/infrastructure/auth/public-session";
import {
  createSessionTokenCodec,
  generateSessionSecret,
  parseSessionSecret,
} from "@/server/infrastructure/auth/session-token";
import {
  assertServiceRoleKey,
  createSupabaseAuthStore,
  type FetchLike,
  type SupabaseRateLimitPolicy,
} from "@/server/infrastructure/auth/supabase-auth-store";
import { createSupabaseEmailTransport } from "@/server/infrastructure/auth/supabase-email-transport";
import type { VerifiedEmailLinkResolver } from "@/server/infrastructure/auth/contracts";

const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_RATE_LIMIT: SupabaseRateLimitPolicy = {
  windowSeconds: 15 * 60,
  maxAttempts: 10,
  blockSeconds: 15 * 60,
};

export interface AuthRuntimeLogger {
  warn(message: string): void;
}

export interface AuthRuntimeOptions {
  readonly environment?: NodeJS.ProcessEnv;
  /** Integrator must install bcryptjs (or bcrypt) and pass the library. */
  readonly bcrypt: BcryptLibrary;
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
  readonly secureCookies?: boolean;
  readonly cookieName?: string;
  readonly sessionTtlSeconds?: number;
  readonly rateLimit?: Partial<SupabaseRateLimitPolicy>;
  readonly emailLinkIdField?: "UserID" | "UUID";
  readonly resolveVerifiedEmailLink?: VerifiedEmailLinkResolver;
  readonly logger?: AuthRuntimeLogger;
}

export interface AuthRuntime {
  readonly gateway: AuthGateway;
  readonly cookies: AuthCookiePolicy;
  readonly http: AuthHttpBridge;
  readonly secureCookies: boolean;
  readonly sessionTtlSeconds: number;
  /** Contract DTO { user, method, expiresAt }; never includes the token. */
  sessionDto(session: Session): PublicSession;
}

interface ResolvedAuthConfig {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly serviceRoleKey: string;
  readonly sessionSecret: Buffer;
  readonly secureCookies: boolean;
  readonly sessionTtlSeconds: number;
  readonly rateLimit: SupabaseRateLimitPolicy;
}

let ephemeralSecretWarned = false;
let ephemeralSessionSecret: Buffer | null = null;

function readRequired(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
  message: string,
): string {
  for (const name of names) {
    const value = environment[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  throw new AuthConfigurationError(message);
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return parsed;
}

function readServiceRoleKey(environment: NodeJS.ProcessEnv): string {
  const candidates = [
    environment.SUPABASE_SERVICE_ROLE_KEY,
    // Only accepted if it really is a private key. The legacy SECRET_KEY value
    // may be an anon/publishable key; that case is rejected, not used.
    environment.SUPABASE_SECRET_KEY,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      continue;
    }
    try {
      assertServiceRoleKey(candidate.trim());
      return candidate.trim();
    } catch {
      // Try the next candidate without echoing the value.
    }
  }
  throw new AuthConfigurationError(
    "Falta una clave privada real de Supabase (service_role). Configure SUPABASE_SERVICE_ROLE_KEY; SUPABASE_SECRET_KEY solo se acepta si es service_role.",
  );
}

function readSessionSecret(
  environment: NodeJS.ProcessEnv,
  logger: AuthRuntimeLogger,
): Buffer {
  const configured = environment.AUTH_SESSION_SECRET;
  if (typeof configured === "string" && configured.trim().length > 0) {
    try {
      return parseSessionSecret(configured);
    } catch {
      throw new AuthConfigurationError(
        "AUTH_SESSION_SECRET no es válido: use al menos 32 bytes en hex, base64url o texto.",
      );
    }
  }

  if ((environment.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new AuthConfigurationError(
      "AUTH_SESSION_SECRET es obligatorio en producción (32+ bytes aleatorios).",
    );
  }

  if (!ephemeralSecretWarned) {
    ephemeralSecretWarned = true;
    logger.warn(
      "[auth] AUTH_SESSION_SECRET ausente; usando un secreto efímero de proceso solo para desarrollo. Las sesiones no sobrevivirán reinicios ni múltiples instancias.",
    );
  }
  ephemeralSessionSecret ??= parseSessionSecret(generateSessionSecret());
  return ephemeralSessionSecret;
}

function resolveConfig(
  environment: NodeJS.ProcessEnv,
  options: AuthRuntimeOptions,
  logger: AuthRuntimeLogger,
): ResolvedAuthConfig {
  const supabaseUrl = readRequired(
    environment,
    ["SUPABASE_URL"],
    "Falta SUPABASE_URL para la autenticación.",
  );
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new AuthConfigurationError("SUPABASE_URL no es una URL válida.");
  }
  const isLocal =
    parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname === "127.0.0.1" ||
    parsedUrl.hostname === "::1" ||
    parsedUrl.hostname === "[::1]";
  if (
    parsedUrl.protocol !== "https:" &&
    !(isLocal && parsedUrl.protocol === "http:")
  ) {
    throw new AuthConfigurationError(
      "SUPABASE_URL debe usar HTTPS (HTTP solo se admite en localhost).",
    );
  }

  const publishableKey = readRequired(
    environment,
    ["SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    "Falta SUPABASE_PUBLISHABLE_KEY para verificar identidades de email.",
  );
  const serviceRoleKey = readServiceRoleKey(environment);
  const sessionSecret = readSessionSecret(environment, logger);
  const secureCookies =
    options.secureCookies ??
    ((environment.NODE_ENV ?? "").toLowerCase() === "production");
  const sessionTtlSeconds = parsePositiveInteger(
    environment.AUTH_SESSION_TTL_SECONDS,
    options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS,
    60,
    30 * 24 * 60 * 60,
  );
  const rateLimit: SupabaseRateLimitPolicy = {
    windowSeconds: parsePositiveInteger(
      environment.AUTH_LOGIN_WINDOW_SECONDS,
      options.rateLimit?.windowSeconds ?? DEFAULT_RATE_LIMIT.windowSeconds,
      60,
      24 * 60 * 60,
    ),
    maxAttempts: parsePositiveInteger(
      environment.AUTH_LOGIN_MAX_ATTEMPTS,
      options.rateLimit?.maxAttempts ?? DEFAULT_RATE_LIMIT.maxAttempts,
      3,
      100,
    ),
    blockSeconds: parsePositiveInteger(
      environment.AUTH_LOGIN_BLOCK_SECONDS,
      options.rateLimit?.blockSeconds ?? DEFAULT_RATE_LIMIT.blockSeconds,
      60,
      24 * 60 * 60,
    ),
  };

  return {
    supabaseUrl: parsedUrl.toString().replace(/\/+$/, ""),
    publishableKey,
    serviceRoleKey,
    sessionSecret,
    secureCookies,
    sessionTtlSeconds,
    rateLimit,
  };
}

/**
 * Builds the complete server-only auth runtime. This file is the only wiring
 * point; the integrator mounts it in composition/routes and installs bcryptjs.
 */
export function createAuthRuntime(options: AuthRuntimeOptions): AuthRuntime {
  if (
    options.bcrypt === undefined ||
    typeof options.bcrypt.compare !== "function" ||
    typeof options.bcrypt.hash !== "function"
  ) {
    throw new AuthConfigurationError(
      "Falta la biblioteca bcrypt. Instale bcryptjs y pásela como options.bcrypt.",
    );
  }

  const environment = options.environment ?? process.env;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const clock: Clock = { now };
  const config = resolveConfig(environment, options, logger);

  const store = createSupabaseAuthStore({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    rateLimit: config.rateLimit,
  });
  const emailTransport = createSupabaseEmailTransport({
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.publishableKey,
    serviceRoleKey: config.serviceRoleKey,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const passwords = createBcryptPasswordVerifier(options.bcrypt);
  const tokens = createSessionTokenCodec(config.sessionSecret, { now });
  const emailLink: EmailLinkOptions = {
    ...(options.emailLinkIdField === undefined
      ? {}
      : { idField: options.emailLinkIdField }),
    ...(options.resolveVerifiedEmailLink === undefined
      ? {}
      : { resolveVerifiedLink: options.resolveVerifiedEmailLink }),
  };

  const gateway = createAuthGateway({
    users: store,
    passwords,
    email: emailTransport,
    sessions: store,
    limiter: store,
    tokens,
    clock,
    sessionTtlSeconds: config.sessionTtlSeconds,
    emailLink,
  });
  const cookies = createAuthCookiePolicy({
    secure: config.secureCookies,
    ...(options.cookieName === undefined ? {} : { name: options.cookieName }),
    now,
  });

  return {
    gateway,
    cookies,
    http: createAuthHttpBridge({ cookies }),
    secureCookies: config.secureCookies,
    sessionTtlSeconds: config.sessionTtlSeconds,
    sessionDto(session: Session): PublicSession {
      return toPublicSession(session);
    },
  };
}

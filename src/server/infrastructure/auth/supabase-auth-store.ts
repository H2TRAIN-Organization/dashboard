import { isUserRole, type User } from "@/server/domain/user";
import type {
  AuthCredentialUser,
  AuthSessionRecord,
  AuthSessionStore,
  AuthUserStore,
  LoginRateLimiter,
  RateLimitDecision,
} from "./contracts";
import { AuthConfigurationError, AuthInfrastructureError } from "./errors";

export type FetchLike = typeof fetch;

const USER_COLUMNS =
  "UserID,Username,UUID,role,GDPRConsent,GDPRConsentDate";
const CREDENTIAL_COLUMNS = `${USER_COLUMNS},PasswordHash`;

export interface SupabaseRateLimitPolicy {
  readonly windowSeconds: number;
  readonly maxAttempts: number;
  readonly blockSeconds: number;
}

export interface SupabaseAuthStoreOptions {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly rateLimit: SupabaseRateLimitPolicy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const payloadPart = parts[1];
  if (payloadPart === undefined) {
    return null;
  }
  try {
    const decoded = Buffer.from(payloadPart, "base64url").toString("utf8");
    const payload: unknown = JSON.parse(decoded);
    if (!isRecord(payload) || typeof payload.role !== "string") {
      return null;
    }
    return payload.role;
  } catch {
    return null;
  }
}

/**
 * Fails closed when the configured value is a publishable/anon key instead of
 * a private key. It does not validate the signature (that is Supabase's job),
 * only prevents a common, dangerous misconfiguration.
 */
export function assertServiceRoleKey(serviceRoleKey: string): void {
  const key = serviceRoleKey.trim();
  if (key.length === 0) {
    throw new AuthConfigurationError(
      "Falta la clave privada de Supabase (service_role). Configure SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  if (key.startsWith("sb_secret_")) {
    return;
  }
  if (decodeJwtRole(key) === "service_role") {
    return;
  }
  throw new AuthConfigurationError(
    "La clave server-side configurada no es service_role. Configure SUPABASE_SERVICE_ROLE_KEY con la clave privada real.",
  );
}

function readUserId(value: unknown): string {
  // Must match persistence/ids.ts toCanonicalUserId: numeric UserID -> string.
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) {
      return String(parsed);
    }
  }
  throw new AuthConfigurationError(
    "La tabla public.users contiene un UserID inválido.",
  );
}

/**
 * The domain keeps User.id as a canonical string. auth_sessions.user_id is a
 * real integer FK in PostgreSQL, so only this boundary converts it.
 */
function toDatabaseUserId(id: string): number {
  if (typeof id !== "string" || !/^-?\d+$/.test(id.trim())) {
    throw new AuthConfigurationError(
      "El identificador de usuario no es canónico para auth_sessions.",
    );
  }
  const parsed = Number(id.trim());
  if (!Number.isSafeInteger(parsed)) {
    throw new AuthConfigurationError(
      "El identificador de usuario excede el rango de auth_sessions.",
    );
  }
  return parsed;
}

function readUsername(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw new AuthConfigurationError(
    "La tabla public.users contiene un Username inválido.",
  );
}

function readNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function readPasswordHash(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeRoleValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function mapUserRow(row: Record<string, unknown>): User {
  const role = normalizeRoleValue(row.role);
  if (role === null || !isUserRole(role)) {
    throw new AuthConfigurationError(
      "La tabla public.users contiene un rol no permitido.",
    );
  }
  const gdprConsent = row.GDPRConsent === true;
  return {
    id: readUserId(row.UserID),
    username: readUsername(row.Username),
    // This legacy table has no email column. Email sessions use the verified
    // Supabase Auth identity; username sessions expose null.
    email: null,
    role,
    uuid: readNullableString(row.UUID),
    gdprConsent,
    gdprConsentAt: gdprConsent ? readIsoOrNull(row.GDPRConsentDate) : null,
    createdAt: null,
  };
}

/**
 * Server-only Supabase/PostgREST adapter for the legacy public.users table,
 * persistent session revocation and persistent login rate limiting.
 *
 * Required SQL: supabase-auth-schema.sql (same directory). If the migration is
 * missing, authentication fails closed with a configuration error.
 */
export class SupabaseAuthStore
  implements AuthUserStore, AuthSessionStore, LoginRateLimiter
{
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly rateLimit: SupabaseRateLimitPolicy;

  constructor(options: SupabaseAuthStoreOptions) {
    assertServiceRoleKey(options.serviceRoleKey);
    this.baseUrl = options.supabaseUrl.replace(/\/+$/, "");
    this.serviceRoleKey = options.serviceRoleKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.rateLimit = options.rateLimit;
  }

  private async rest(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.serviceRoleKey);
    headers.set("Authorization", `Bearer ${this.serviceRoleKey}`);
    headers.set("Accept-Profile", "public");
    if (init.body !== undefined) {
      headers.set("Content-Profile", "public");
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/rest/v1/${path}`, {
        ...init,
        headers,
        cache: "no-store",
        signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
      return response;
    } catch {
      throw new AuthInfrastructureError(
        "No se pudo contactar con el almacenamiento de autenticación.",
      );
    }
  }

  private async requireOk(
    response: Response,
    operation: string,
  ): Promise<Response> {
    if (!response.ok) {
      throw new AuthInfrastructureError(
        `Supabase rechazó la operación de autenticación (${operation}, HTTP ${response.status}).`,
      );
    }
    return response;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new AuthInfrastructureError(
        "Supabase devolvió una respuesta de autenticación inválida.",
      );
    }
  }

  private async selectUsers(
    filter: string,
    limit: number,
    columns: string,
  ): Promise<Record<string, unknown>[]> {
    const response = await this.rest(
      `users?select=${encodeURIComponent(columns)}&${filter}&limit=${limit}`,
      { method: "GET" },
    );
    await this.requireOk(response, "users.select");
    const data = await this.readJson(response);
    if (!Array.isArray(data)) {
      throw new AuthInfrastructureError(
        "Supabase devolvió una lista de usuarios inválida.",
      );
    }
    return data.filter(isRecord);
  }

  async findByUsername(
    username: string,
  ): Promise<AuthCredentialUser | null> {
    const rows = await this.selectUsers(
      `Username=eq.${encodeURIComponent(username)}`,
      2,
      CREDENTIAL_COLUMNS,
    );
    if (rows.length > 1) {
      throw new AuthConfigurationError(
        "Hay más de un usuario con el mismo nombre. Corrija public.users.",
      );
    }
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      user: mapUserRow(row),
      passwordHash: readPasswordHash(row.PasswordHash),
    };
  }

  async findByUserId(id: string): Promise<User | null> {
    const rows = await this.selectUsers(
      `UserID=eq.${encodeURIComponent(id)}`,
      1,
      USER_COLUMNS,
    );
    const row = rows[0];
    return row === undefined ? null : mapUserRow(row);
  }

  async findByUuid(uuid: string): Promise<User | null> {
    const rows = await this.selectUsers(
      `UUID=eq.${encodeURIComponent(uuid)}`,
      2,
      USER_COLUMNS,
    );
    if (rows.length > 1) {
      throw new AuthConfigurationError(
        "Hay más de un usuario con el mismo UUID. Corrija public.users.",
      );
    }
    const row = rows[0];
    return row === undefined ? null : mapUserRow(row);
  }

  async register(record: AuthSessionRecord): Promise<void> {
    const response = await this.rest("auth_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        sid_hash: record.sidHash,
        user_id: toDatabaseUserId(record.userId),
        method: record.method,
        issued_at: record.issuedAt,
        expires_at: record.expiresAt,
      }),
    });
    await this.requireOk(response, "auth_sessions.insert");
  }

  async isActive(input: {
    readonly sidHash: string;
    readonly userId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const response = await this.rest(
      [
        "auth_sessions?select=sid_hash",
        `sid_hash=eq.${encodeURIComponent(input.sidHash)}`,
        `user_id=eq.${toDatabaseUserId(input.userId)}`,
        "revoked_at=is.null",
        `expires_at=gt.${encodeURIComponent(input.now.toISOString())}`,
        "limit=1",
      ].join("&"),
      { method: "GET" },
    );
    await this.requireOk(response, "auth_sessions.select");
    const data = await this.readJson(response);
    return Array.isArray(data) && data.length === 1;
  }

  async revoke(sidHash: string, now: Date): Promise<void> {
    const response = await this.rest(
      `auth_sessions?sid_hash=eq.${encodeURIComponent(sidHash)}&revoked_at=is.null`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ revoked_at: now.toISOString() }),
      },
    );
    await this.requireOk(response, "auth_sessions.revoke");
  }

  async consume(keyHash: string): Promise<RateLimitDecision> {
    const response = await this.rest("rpc/auth_login_consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_key_hash: keyHash,
        p_window_seconds: this.rateLimit.windowSeconds,
        p_max_attempts: this.rateLimit.maxAttempts,
        p_block_seconds: this.rateLimit.blockSeconds,
      }),
    });
    await this.requireOk(response, "auth_login_consume");
    const data = await this.readJson(response);
    const row = Array.isArray(data) ? data[0] : null;
    if (!isRecord(row)) {
      throw new AuthConfigurationError(
        "Falta la migración SQL de rate limiting (auth_login_consume).",
      );
    }
    const allowed = row.allowed === true;
    const retryAfterSeconds =
      typeof row.retry_after_seconds === "number"
        ? Math.max(0, Math.trunc(row.retry_after_seconds))
        : 0;
    const remaining =
      typeof row.remaining === "number"
        ? Math.max(0, Math.trunc(row.remaining))
        : 0;
    return { allowed, retryAfterSeconds, remaining };
  }

  async reset(keyHash: string): Promise<void> {
    const response = await this.rest("rpc/auth_login_reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_key_hash: keyHash }),
    });
    await this.requireOk(response, "auth_login_reset");
  }
}

export function createSupabaseAuthStore(
  options: SupabaseAuthStoreOptions,
): SupabaseAuthStore {
  return new SupabaseAuthStore(options);
}

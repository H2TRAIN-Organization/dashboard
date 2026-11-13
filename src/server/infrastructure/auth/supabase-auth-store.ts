import { isUserRole, type User } from "@/server/domain/user";
import type {
  AuthCredentialUser,
  AuthSessionRecord,
  AuthSessionStore,
  AuthUserStore,
  LoginRateLimiter,
  RateLimitDecision,
  UsernameIdentity,
} from "./contracts";
import { AuthConfigurationError, AuthInfrastructureError } from "./errors";
import { normalizeIdentity } from "./rate-limit";
import { ConflictError, UnauthorizedError } from '@/server/domain/errors';
import { initialPrivacyStatus, PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION, type PrivacyStatus, type PrivacyDecision, type PrivacyDecisionResult } from '@/server/domain/privacy';

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
    // MT51: tras el cutover la columna legacy "Username" ya no se selecciona;
    // el username descifrado llega después vía auth_username_display_batch
    // (fillDecryptedUsernames). Mientras exista la columna, este valor es el
    // espejo legacy y no hay llamada extra.
    username:
      row.Username === undefined
        ? ""
        : readUsername(row.Username),
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
  async readPrivacy(sidHash: string, userId: string): Promise<PrivacyStatus> {
    // A per-user acceptance persists across sessions: no new sign-in repeats
    // the notice for the audited policy version. Sessions without a user ack
    // fall back to their own stage, mapped onto the single-stage flow.
    const dbUserId = toDatabaseUserId(userId);
    const ackResponse = await this.rest(`user_privacy_acks?select=policy_version,policy_hash&user_id=eq.${dbUserId}&limit=1`);
    if (ackResponse.status === 404) {
      // The ack table only exists after its migration is applied. Missing
      // table degrades to the per-session flow instead of blocking logins.
      return this.readSessionPrivacy(sidHash, dbUserId);
    }
    await this.requireOk(ackResponse, 'privacy.ack');
    const acks = await this.readJson(ackResponse);
    if (Array.isArray(acks) && acks.length > 0) {
      const ack = acks[0];
      if (!isRecord(ack) || typeof ack.policy_version !== "string" || typeof ack.policy_hash !== "string") {
        throw new AuthInfrastructureError();
      }
      if (ack.policy_version === PRIVACY_POLICY_VERSION && ack.policy_hash === PRIVACY_POLICY_HASH) {
        return { ...initialPrivacyStatus(), state: 'complete' };
      }
    }
    return this.readSessionPrivacy(sidHash, dbUserId);
  }

  private async readSessionPrivacy(sidHash: string, dbUserId: number): Promise<PrivacyStatus> {
    const response = await this.rest(`auth_sessions?select=privacy_version,privacy_hash,privacy_stage&sid_hash=eq.${encodeURIComponent(sidHash)}&user_id=eq.${dbUserId}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
    await this.requireOk(response, 'privacy.status');
    const rows = await this.readJson(response);
    if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) throw new AuthInfrastructureError();
    const row = rows[0];
    if (row.privacy_version !== PRIVACY_POLICY_VERSION || row.privacy_hash !== PRIVACY_POLICY_HASH) return initialPrivacyStatus();
    if (row.privacy_stage !== 0 && row.privacy_stage !== 1 && row.privacy_stage !== 2) throw new AuthInfrastructureError();
    // Legacy stage 1 (two-step banner) restarts the single-stage flow once.
    return { ...initialPrivacyStatus(), state: row.privacy_stage === 2 ? 'complete' : 'initial' };
  }

  async decidePrivacy(sidHash: string, userId: string, decision: PrivacyDecision): Promise<PrivacyDecisionResult> {
    const response = await this.rest('rpc/auth_privacy_decide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_sid_hash: sidHash, p_user_id: toDatabaseUserId(userId), p_policy_version: decision.policyVersion,
        p_policy_hash: PRIVACY_POLICY_HASH, p_surface: decision.surface, p_decision: decision.decision,
        p_language: decision.language, p_request_id: decision.requestId }),
    });
    if (response.status === 409) throw new ConflictError();
    if (response.status === 401) throw new UnauthorizedError();
    await this.requireOk(response, 'privacy.decision');
    const body = await this.readJson(response);
    const row: unknown = Array.isArray(body) && body.length === 1 ? body[0] : null;
    if (!isRecord(row) || row.rejected !== (decision.decision === 'reject') ||
      (decision.decision === 'accept' && row.stage !== 2) ||
      (decision.decision === 'reject' && row.stage !== 0)) throw new AuthInfrastructureError();
    return { ...initialPrivacyStatus(), state: row.stage === 2 ? 'complete' : 'initial', rejected: row.rejected };
  }
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
    const rows = data.filter(isRecord);
    return this.fillDecryptedUsernames(rows);
  }

  /**
   * MT51: condición del cambio — el username se pinta en pantalla aunque viva
   * cifrado en disco. Tras el cutover, las filas llegan sin la columna legacy
   * y el username se descifra server-side en un único lote por página. Si la
   * migración MT46 no está aplicada (404), se deja el valor como esté: el
   * frontend mostrará el email de sesión.
   */
  private async fillDecryptedUsernames(
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const missing = rows.filter((row) => row.Username === undefined);
    if (missing.length === 0) {
      return rows;
    }
    const userIds = missing
      .map((row) => row.UserID)
      .filter((value): value is number => typeof value === "number");
    if (userIds.length === 0) {
      return rows;
    }
    const response = await this.rest("rpc/auth_username_display_batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_user_ids: userIds }),
    });
    if (response.status === 404) {
      return rows;
    }
    await this.requireOk(response, "username.display");
    const decrypted = await this.readJson(response);
    if (!Array.isArray(decrypted)) {
      throw new AuthInfrastructureError();
    }
    const names = new Map<number, string>();
    for (const entry of decrypted) {
      if (
        isRecord(entry) &&
        typeof entry.user_id === "number" &&
        typeof entry.username === "string" &&
        entry.username.length > 0
      ) {
        names.set(entry.user_id, entry.username);
      }
    }
    for (const row of rows) {
      if (row.Username === undefined && typeof row.UserID === "number") {
        const name = names.get(row.UserID);
        if (name !== undefined) {
          row.Username = name;
        }
      }
    }
    return rows;
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

  async findByNormalizedUsername(username: string): Promise<readonly User[]> {
    const normalized = normalizeIdentity(username);
    if (normalized.length === 0) {
      return [];
    }
    // `ilike` performs the case-insensitive lookup; the exact normalized
    // comparison below removes any wildcard/locale false positive. Limit 3 is
    // enough for the caller to distinguish "one" from "ambiguous".
    const escaped = normalized.replace(/[\\%_*]/g, "\\$&");
    const rows = await this.selectUsers(
      `Username=ilike.${encodeURIComponent(escaped)}`,
      3,
      USER_COLUMNS,
    );
    return rows
      .map(mapUserRow)
      .filter((user) => normalizeIdentity(user.username) === normalized);
  }

  /**
   * MT48: username → (UserID, email confirmado de GoTrue) con la RPC de Vault.
   * La RPC no existe hasta aplicar la migración MT46: PostgREST responde 404
   * (PGRST202) y aquí se degrada a "unavailable" para que el gateway use el
   * camino legacy hasta el cutover. El cliente nunca calcula el HMAC: la
   * normalización y el HMAC ocurren dentro de la base de datos.
   */
  async resolveUsernameIdentity(
    username: string,
  ): Promise<readonly UsernameIdentity[] | "unavailable"> {
    const value = username.trim();
    if (value.length === 0) {
      return [];
    }
    const response = await this.rest("rpc/auth_username_resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_username: value }),
    });
    if (response.status === 404) {
      return "unavailable";
    }
    await this.requireOk(response, "username.resolve");
    const body = await this.readJson(response);
    if (!Array.isArray(body)) {
      throw new AuthInfrastructureError(
        "Supabase devolvió una resolución de username inválida.",
      );
    }
    const identities: UsernameIdentity[] = [];
    for (const row of body) {
      if (!isRecord(row)) {
        throw new AuthInfrastructureError();
      }
      if (typeof row.email !== "string" || row.email.length === 0) {
        throw new AuthInfrastructureError();
      }
      identities.push({
        userId: readUserId(row.user_id),
        email: row.email,
      });
    }
    return identities;
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

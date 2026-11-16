import {
  buildAuthAliasRecordKey,
  isUuidString,
} from "@/server/domain/health-data";
import { ValidationError } from "@/server/domain/errors";
import type {
  HealthRecordKeyResolver,
  RecordKeyQuery,
} from "@/server/application/ports/health-record-key-resolver";
import type { PersistenceGateway } from "@/server/infrastructure/persistence/supabase/query-types";

import { AuthConfigurationError, AuthInfrastructureError } from "./errors";

/**
 * Structural view of the auth admin API used here. The official client
 * satisfies it at runtime; keeping the surface narrow avoids generated types.
 */
interface AuthAdminLike {
  auth: {
    admin: {
      listUsers(options: {
        page?: number;
        perPage?: number;
      }): PromiseLike<{
        data: AuthListResponse | readonly AuthIdentityRow[] | null;
        error: unknown;
      }>;
    };
  };
}

interface AuthListResponse {
  readonly users?: readonly AuthIdentityRow[];
}

interface AuthIdentityRow {
  readonly id?: unknown;
  readonly email?: unknown;
  readonly email_confirmed_at?: unknown;
  readonly app_metadata?: unknown;
}

export interface HealthRecordKeyResolverOptions {
  /** Service-role Supabase client (auth admin reads). */
  readonly client: AuthAdminLike;
  /** PostgREST gateway to resolve users.UserID when the caller omits it. */
  readonly users: PersistenceGateway;
  /** Identity scan cache TTL in milliseconds. Defaults to 60_000. */
  readonly ttlMs?: number;
  /** Injectable monotonic clock (ms). Defaults to Date.now. */
  readonly clock?: () => number;
  /** Maximum record keys returned per account. Defaults to 32. */
  readonly maxKeys?: number;
  /** Maximum identity pages scanned (perPage = 1000). Defaults to 2. */
  readonly maxScanPages?: number;
}

interface LinkedIdentity {
  readonly id: string;
  readonly email: string | null;
  readonly emailConfirmed: boolean;
  readonly appUserId: number | null;
}

const PER_PAGE = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readEmailConfirmed(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function readAppUserId(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const raw = value.app_user_id;
  if (typeof raw === "number" && Number.isSafeInteger(raw)) {
    return raw;
  }
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return null;
}

function mapIdentityRow(row: AuthIdentityRow): LinkedIdentity | null {
  if (!isUuidString(row.id)) {
    return null;
  }
  return {
    id: row.id,
    email: readEmail(row.email),
    emailConfirmed: readEmailConfirmed(row.email_confirmed_at),
    appUserId: readAppUserId(row.app_metadata),
  };
}

/**
 * Server-side resolver of health-record keys. It scans Supabase Auth
 * identities with the service-role key and matches:
 *   - confirmed email equal to the canonical username, or
 *   - administered `app_metadata.app_user_id` equal to the account UserID.
 *
 * It fails closed: infrastructure failures throw a 503 instead of returning a
 * partial alias set, because a partial set silently hides rows.
 */
export class SupabaseHealthRecordKeyResolver implements HealthRecordKeyResolver {
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly maxKeys: number;
  private readonly maxScanPages: number;
  private scanCache: {
    readonly identities: readonly LinkedIdentity[];
    readonly expiresAt: number;
  } | null = null;

  constructor(private readonly options: HealthRecordKeyResolverOptions) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.clock = options.clock ?? Date.now;
    this.maxKeys = options.maxKeys ?? 32;
    this.maxScanPages = options.maxScanPages ?? 2;
    if (this.ttlMs < 0 || this.maxKeys < 1 || this.maxScanPages < 1) {
      throw new AuthConfigurationError(
        "La configuración del resolvedor de claves de registro no es válida.",
      );
    }
  }

  async resolve(query: RecordKeyQuery): Promise<readonly string[]> {
    const username = query.username.trim();
    if (username === "") {
      throw new ValidationError("El nombre de usuario es obligatorio");
    }

    const identities = await this.scanIdentities();
    const targetUserId = await this.targetUserId(username, query.userId);

    const keys: string[] = [username];
    for (const identity of identities) {
      const emailMatch =
        identity.emailConfirmed &&
        identity.email !== null &&
        identity.email.toLowerCase() === username.toLowerCase();
      const administeredMatch =
        targetUserId !== null && identity.appUserId === targetUserId;
      if (emailMatch || administeredMatch) {
        keys.push(buildAuthAliasRecordKey(identity.id));
      }
      if (keys.length >= this.maxKeys) {
        break;
      }
    }
    return keys;
  }

  private async targetUserId(
    username: string,
    providedUserId: string | undefined,
  ): Promise<number | null> {
    const provided = parseCanonicalUserId(providedUserId);
    if (provided !== null) {
      return provided;
    }
    let rows: unknown;
    try {
      const response = await this.options.users.select("users", {
        columns: "UserID",
        filters: [{ kind: "eq", column: "Username", value: username }],
        limit: 1,
      });
      rows = response.rows;
    } catch {
      throw new AuthInfrastructureError(
        "No se pudo resolver la identidad del usuario",
      );
    }
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!isRecord(row)) {
      return null;
    }
    return parseCanonicalUserId(row.UserID);
  }

  private async scanIdentities(): Promise<readonly LinkedIdentity[]> {
    const cached = this.scanCache;
    if (cached !== null && this.clock() < cached.expiresAt) {
      return cached.identities;
    }

    const identities: LinkedIdentity[] = [];
    for (let page = 1; page <= this.maxScanPages; page += 1) {
      let response: Awaited<
        ReturnType<AuthAdminLike["auth"]["admin"]["listUsers"]>
      >;
      try {
        response = await this.options.client.auth.admin.listUsers({
          page,
          perPage: PER_PAGE,
        });
      } catch {
        throw new AuthInfrastructureError();
      }

      if (response.error !== null && response.error !== undefined) {
        throw new AuthInfrastructureError();
      }

      const rows = readIdentityRows(response.data);
      for (const row of rows) {
        const identity = mapIdentityRow(row);
        if (identity !== null) {
          identities.push(identity);
        }
      }
      if (rows.length < PER_PAGE) {
        break;
      }
      if (page === this.maxScanPages) {
        // An unscanned identity could still claim an alias; fail closed.
        throw new AuthInfrastructureError(
          "El catálogo de identidades Auth excede el escaneo permitido",
        );
      }
    }

    this.scanCache = {
      identities,
      expiresAt: this.clock() + this.ttlMs,
    };
    return identities;
  }
}

function readIdentityRows(
  data: AuthListResponse | readonly AuthIdentityRow[] | null,
): readonly AuthIdentityRow[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (isRecord(data) && Array.isArray(data.users)) {
    return data.users;
  }
  throw new AuthInfrastructureError();
}

function parseCanonicalUserId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

import { createClient } from "@supabase/supabase-js";
import type {
  EmailAuthTransport,
  EmailPasswordResult,
  VerifiedEmailUser,
} from "./contracts";
import { assertServiceRoleKey } from "./supabase-auth-store";
import type { FetchLike } from "./supabase-auth-store";

export interface SupabaseEmailTransportOptions {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly serviceRoleKey: string;
  readonly fetch?: FetchLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/**
 * Maps only the safe auth identity fields. user_metadata is intentionally
 * ignored because it is user-editable and must never drive authorization.
 */
export function mapSupabaseAuthUser(value: unknown): VerifiedEmailUser | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    return null;
  }
  if (typeof value.email !== "string" || value.email.trim().length === 0) {
    return null;
  }
  if (!isRecord(value.app_metadata)) {
    return null;
  }
  return {
    authUserId: value.id,
    email: value.email.trim().toLowerCase(),
    emailConfirmedAt: readIsoOrNull(value.email_confirmed_at),
    appMetadata: { ...value.app_metadata },
  };
}

/**
 * Official Supabase Auth transport with two clients:
 * - publishable key: password grant + getUser(accessToken) verification.
 * - service_role key: local signOut of the Supabase token during app logout.
 *
 * Sessions are not persisted and tokens are never logged.
 */
export function createSupabaseEmailTransport(
  options: SupabaseEmailTransportOptions,
): EmailAuthTransport {
  assertServiceRoleKey(options.serviceRoleKey);
  const baseUrl = options.supabaseUrl.replace(/\/+$/, "");
  const createAuthClient = (key: string) =>
    createClient(baseUrl, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      ...(options.fetch === undefined
        ? {}
        : { global: { fetch: options.fetch } }),
    });

  return {
    async signInWithPassword(
      email: string,
      password: string,
    ): Promise<EmailPasswordResult> {
      const client = createAuthClient(options.publishableKey);
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error !== null) {
        if (
          error.status === 400 ||
          error.status === 401 ||
          error.code === "invalid_credentials"
        ) {
          return { ok: false, reason: "invalid_credentials" };
        }
        return { ok: false, reason: "unavailable" };
      }
      if (
        data.session === null ||
        data.session.access_token.length === 0 ||
        data.user === null
      ) {
        return { ok: false, reason: "unavailable" };
      }
      const user = mapSupabaseAuthUser(data.user);
      if (user === null) {
        return { ok: false, reason: "unavailable" };
      }
      const expiresAt =
        typeof data.session.expires_at === "number" &&
        Number.isFinite(data.session.expires_at)
          ? new Date(data.session.expires_at * 1000).toISOString()
          : new Date(Date.now() + 3_600_000).toISOString();
      return {
        ok: true,
        session: {
          accessToken: data.session.access_token,
          expiresAt,
          user,
        },
      };
    },

    async getUser(accessToken: string): Promise<VerifiedEmailUser | null> {
      if (accessToken.length === 0) {
        return null;
      }
      const client = createAuthClient(options.publishableKey);
      const { data, error } = await client.auth.getUser(accessToken);
      if (error !== null || data.user === null) {
        return null;
      }
      return mapSupabaseAuthUser(data.user);
    },

    async revokeAccessToken(accessToken: string): Promise<void> {
      if (accessToken.length === 0) {
        return;
      }
      try {
        const admin = createAuthClient(options.serviceRoleKey);
        await admin.auth.admin.signOut(accessToken, "local");
      } catch {
        // The application session is already revoked in persistent storage.
        // Supabase-side revocation is best effort (the token may have expired).
      }
    },
  };
}

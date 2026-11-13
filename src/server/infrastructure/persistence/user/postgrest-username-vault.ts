import type { UsernameVault } from "@/server/application/ports/username-vault";

import { isPersistenceError, PersistenceError } from "../errors";
import type { PersistenceGateway } from "../supabase/query-types";

interface ResolveRow {
  readonly user_id: number | string | null;
  readonly email: string | null;
}

interface DisplayNameRow {
  readonly user_id: number | string | null;
  readonly username: string | null;
}

function normalizeRows<T>(result: unknown): T[] {
  if (result === null || result === undefined) return [];
  return (Array.isArray(result) ? result : [result]) as T[];
}

/**
 * Adaptador PostgREST del puerto UsernameVault sobre las RPCs de MT46.
 *
 * Degradación de despliegue: mientras la migración de Vault no esté aplicada,
 * las RPCs no existen y el gateway lo reporta como MIGRATION_REQUIRED; en ese
 * estado el adaptador responde "no disponible" (null/false) y los callers
 * usan la columna legacy "Username". Cualquier otro error se propaga.
 */
export class PostgrestUsernameVault implements UsernameVault {
  constructor(private readonly gateway: PersistenceGateway) {}

  async resolveUserIdByUsername(username: string): Promise<string | null> {
    const value = username.trim();
    if (value.length === 0) {
      return null;
    }
    let result: unknown;
    try {
      result = await this.gateway.rpc<ResolveRow>("auth_username_resolve", {
        p_username: value,
      });
    } catch (error) {
      if (isVaultUnavailable(error)) return null;
      throw error;
    }
    const rows = normalizeRows<ResolveRow>(result).filter(
      (row) => row !== null && row !== undefined,
    );
    if (rows.length === 0) {
      return null;
    }
    if (rows.length > 1) {
      throw new PersistenceError(
        "USERNAME_AMBIGUOUS",
        "El nombre de usuario coincide con varias cuentas.",
        { operation: "auth_username_resolve", table: "users" },
      );
    }
    const userId = rows[0]!.user_id;
    return userId === null || userId === undefined ? null : String(userId);
  }

  async displayNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const ids = userIds
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    const result = new Map<string, string>();
    if (ids.length === 0) {
      return result;
    }
    let rows: readonly DisplayNameRow[];
    try {
      rows = normalizeRows<DisplayNameRow>(
        await this.gateway.rpc<DisplayNameRow>("auth_username_display_batch", {
          p_user_ids: ids,
        }),
      );
    } catch (error) {
      if (isVaultUnavailable(error)) return result;
      throw error;
    }
    for (const row of rows) {
      if (row === null || row === undefined) continue;
      if (row.user_id === null || row.user_id === undefined) continue;
      if (typeof row.username !== "string" || row.username.length === 0) continue;
      result.set(String(row.user_id), row.username);
    }
    return result;
  }

  async mirrorUsername(userId: string, username: string): Promise<boolean> {
    const numericId = Number(userId);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new PersistenceError(
        "MAPPING_FAILED",
        "Identificador de usuario no válido para cifrar el username.",
        { operation: "auth_username_set", table: "users" },
      );
    }
    try {
      await this.gateway.rpc("auth_username_set", {
        p_user_id: numericId,
        p_username: username,
      });
      return true;
    } catch (error) {
      if (isVaultUnavailable(error)) return false;
      throw error;
    }
  }
}

function isVaultUnavailable(error: unknown): boolean {
  return (
    isPersistenceError(error) &&
    (error.code === "MIGRATION_REQUIRED" || error.code === "RPC_NOT_FOUND")
  );
}

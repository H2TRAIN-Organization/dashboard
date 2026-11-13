import type { AdminDatabaseRepository } from "@/server/application/ports/admin-database-repository";
import type { UsernameVault } from "@/server/application/ports/username-vault";
import {
  assertTableLimit,
  assertTableOffset,
  type DatabaseTableInfo,
  type DatabaseTablePage,
  type DatabaseTablesResult,
} from "@/server/domain/admin-database";
import { NotFoundError } from "@/server/domain/errors";
import type { HealthRecord } from "@/server/domain/health-data";
import type { TextDecryptor } from "@/server/infrastructure/crypto";

import { PersistenceError } from "../errors";
import type { PersistenceGateway } from "../supabase/query-types";
import {
  mapHealthRecord,
  type HealthTable,
} from "../health/health-record-mapper";
import { mapUserAdminRow, USER_ADMIN_COLUMNS } from "../user/user-mapper";

interface AdminTableSpec {
  readonly name: string;
  readonly primaryKey: string;
  readonly kind: "users" | "health";
  readonly table: HealthTable | null;
}

/**
 * Explicit allowlist. The foundation HTTP schema validates the table-name
 * format; this adapter adds the authoritative allowlist.
 */
const ADMIN_TABLES: readonly AdminTableSpec[] = [
  { name: "users", primaryKey: "UserID", kind: "users", table: null },
  { name: "insulindata", primaryKey: "id", kind: "health", table: "insulindata" },
  { name: "fooddata", primaryKey: "id", kind: "health", table: "fooddata" },
  { name: "exercisedata", primaryKey: "id", kind: "health", table: "exercisedata" },
  { name: "periodrecords", primaryKey: "id", kind: "health", table: "periodrecords" },
  { name: "mooddata", primaryKey: "id", kind: "health", table: "mooddata" },
  { name: "polar_data", primaryKey: "id", kind: "health", table: "polar_data" },
] as const;

const ADMIN_TABLE_BY_NAME = new Map(
  ADMIN_TABLES.map((table) => [table.name, table] as const),
);

export class SupabaseAdminDatabaseRepository implements AdminDatabaseRepository {
  constructor(
    private readonly gateway: PersistenceGateway,
    private readonly decryptor: TextDecryptor,
    private readonly usernameVault?: UsernameVault,
  ) {}

  async listTables(): Promise<DatabaseTablesResult> {
    const tables: DatabaseTableInfo[] = await Promise.all(
      ADMIN_TABLES.map(async (table): Promise<DatabaseTableInfo> => {
        try {
          const result = await this.gateway.select(table.name, {
            columns: table.primaryKey,
            count: "exact",
            head: true,
          });
          return {
            name: table.name,
            recordCount: requireCount(result.count),
            accessible: true,
          };
        } catch {
          return {
            name: table.name,
            recordCount: 0,
            accessible: false,
            error: "No disponible",
          };
        }
      }),
    );

    return {
      tables,
      totalRecords: tables.reduce((sum, table) => sum + table.recordCount, 0),
      accessibleCount: tables.filter((table) => table.accessible).length,
      totalCount: tables.length,
    };
  }

  async getTableData(tableName: string, limit: number, offset = 0): Promise<DatabaseTablePage> {
    const spec = ADMIN_TABLE_BY_NAME.get(tableName);
    if (spec === undefined) {
      throw new NotFoundError(`Tabla no encontrada: ${tableName}`);
    }
    assertTableLimit(limit);
    assertTableOffset(offset);

    const countResult = await this.gateway.select(spec.name, {
      columns: spec.primaryKey,
      count: "exact",
      head: true,
    });
    const dataResult = await this.gateway.select(spec.name, {
      columns: spec.kind === "users" ? USER_ADMIN_COLUMNS : "*",
      order: { column: spec.primaryKey, ascending: true },
      range: { from: offset, to: offset + limit - 1 },
    });

    const data: HealthRecord[] = dataResult.rows.map((row) => {
      if (spec.kind === "users") {
        return mapUserAdminRow(row);
      }
      if (spec.table === null) {
        throw new PersistenceError(
          "MAPPING_FAILED",
          "La especificación de tabla admin no tiene mapeador de salud.",
          { operation: "admin-table-data", table: spec.name },
        );
      }
      return mapHealthRecord(spec.table, row, this.decryptor);
    });

    if (spec.kind === "users") {
      await fillUsernames(data, this.usernameVault);
    }

    return {
      tableName: spec.name,
      data,
      totalRecords: requireCount(countResult.count),
      returnedRecords: data.length,
      limit,
      offset,
      hasMore: offset + data.length < requireCount(countResult.count),
    };
  }
}

function requireCount(count: number | null): number {
  if (count === null || !Number.isSafeInteger(count) || count < 0) {
    throw new PersistenceError("MAPPING_FAILED", "No se pudo verificar el recuento completo.", { operation: "admin-table-count" });
  }
  return count;
}

/**
 * Cutover MT48: en la tabla de usuarios el username llega cifrado (la columna
 * legacy ya no se selecciona) y se completa vía Vault antes de exponerlo.
 */
async function fillUsernames(
  data: HealthRecord[],
  usernameVault: UsernameVault | undefined,
): Promise<void> {
  if (usernameVault === undefined || data.length === 0) {
    return;
  }
  const missing = data.filter((row) => row.Username === undefined);
  if (missing.length === 0) {
    return;
  }
  const names = await usernameVault.displayNames(
    missing.map((row) => String(row.UserID)),
  );
  for (const row of data) {
    if (row.Username === undefined) {
      row.Username = names.get(String(row.UserID)) ?? null;
    }
  }
}

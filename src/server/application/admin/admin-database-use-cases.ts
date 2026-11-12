import { canReadAdminDatabase } from "@/server/domain/access-policy";
import {
  assertSafeTableName,
  assertTableLimit,
  assertTableOffset,
  type DatabaseTablePage,
  type DatabaseTablesResult,
} from "@/server/domain/admin-database";
import { ForbiddenError } from "@/server/domain/errors";
import type { ActiveActor } from "@/server/domain/user";
import type { AdminDatabaseRepository } from "../ports/admin-database-repository";

export interface AdminDatabaseUseCases {
  listTables(actor: ActiveActor): Promise<DatabaseTablesResult>;
  getTableData(
    actor: ActiveActor,
    tableName: string,
    limit: number,
    offset?: number,
  ): Promise<DatabaseTablePage>;
}

function assertDatabaseReader(actor: ActiveActor): void {
  if (!canReadAdminDatabase(actor)) {
    throw new ForbiddenError("Solo un administrador puede explorar la base de datos");
  }
}

export function createAdminDatabaseUseCases(
  repository: AdminDatabaseRepository,
): AdminDatabaseUseCases {
  return {
    async listTables(actor: ActiveActor): Promise<DatabaseTablesResult> {
      assertDatabaseReader(actor);
      const result = await repository.listTables();
      return { ...result, observedAt: new Date().toISOString(), status: result.accessibleCount === result.totalCount ? "complete" : result.accessibleCount === 0 ? "failed" : "partial" };
    },

    async getTableData(
      actor: ActiveActor,
      tableName: string,
      limit: number,
      offset = 0,
    ): Promise<DatabaseTablePage> {
      assertDatabaseReader(actor);
      assertSafeTableName(tableName);
      assertTableLimit(limit);
      assertTableOffset(offset);
      return repository.getTableData(tableName, limit, offset);
    },
  };
}

import { canReadAdminDatabase } from "@/server/domain/access-policy";
import {
  assertSafeTableName,
  assertTableLimit,
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
      return repository.listTables();
    },

    async getTableData(
      actor: ActiveActor,
      tableName: string,
      limit: number,
    ): Promise<DatabaseTablePage> {
      assertDatabaseReader(actor);
      assertSafeTableName(tableName);
      assertTableLimit(limit);
      return repository.getTableData(tableName, limit);
    },
  };
}

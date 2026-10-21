import type { AdminDatabaseUseCases } from "@/server/application/admin/admin-database-use-cases";
import type { AuthUseCases } from "@/server/application/auth/auth-use-cases";
import { handle, jsonResult, parseInput, type HttpResult } from "../problem";
import { databaseTableQuerySchema } from "../schemas/admin-database";
import { requireActor } from "./auth";

export interface AdminDatabaseHttpHandlers {
  tables(input: { authorization: string | undefined }): Promise<HttpResult>;
  tableData(input: {
    authorization: string | undefined;
    query: unknown;
  }): Promise<HttpResult>;
}

export function createAdminDatabaseHttpHandlers(
  auth: AuthUseCases,
  adminDatabase: AdminDatabaseUseCases,
): AdminDatabaseHttpHandlers {
  return {
    async tables(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.authorization);
        const result = await adminDatabase.listTables(actor);
        return jsonResult(200, { success: true, ...result });
      });
    },

    async tableData(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.authorization);
        const query = parseInput(databaseTableQuerySchema, input.query);
        const result = await adminDatabase.getTableData(actor, query.table, query.limit);
        return jsonResult(200, { success: true, ...result });
      });
    },
  };
}

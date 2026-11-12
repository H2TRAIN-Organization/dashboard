import type { AdminDatabaseUseCases } from "@/server/application/admin/admin-database-use-cases";
import { createLogicalCopy, createTableExport } from "@/server/application/admin/admin-database-downloads";
import type { AuthUseCases } from "@/server/application/auth/auth-use-cases";
import type { ActiveActor } from "@/server/domain/user";
import type { BackupKeyMaterial } from "@/server/domain/admin-database";
import { handle, jsonResult, parseInput } from "../problem";
import { databaseExportQuerySchema, logicalBackupBodySchema } from "../schemas/admin-database";
import { requireActor } from "./auth";

export function createAdminDatabaseDownloadHandlers(dependencies: {
  readonly auth: AuthUseCases;
  readonly database: AdminDatabaseUseCases;
  readonly readKubios: (actor: ActiveActor) => Promise<readonly { readonly userId: number }[]>;
  readonly encrypt: (value: unknown, material: BackupKeyMaterial) => Promise<unknown>;
}) {
  return {
    exportTable(input: { sessionToken: string | undefined; query: unknown }) {
      return handle(async () => {
        const actor = await requireActor(dependencies.auth, input.sessionToken);
        const query = parseInput(databaseExportQuerySchema, input.query);
        const result = await createTableExport(dependencies.database, actor, query.table, query.format);
        return jsonResult(200, { success: true, ...result });
      });
    },
    logicalBackup(input: { sessionToken: string | undefined; body: unknown }) {
      return handle(async () => {
        const actor = await requireActor(dependencies.auth, input.sessionToken);
        const material: BackupKeyMaterial = parseInput(logicalBackupBodySchema, input.body);
        const copy = await createLogicalCopy(dependencies.database, actor, dependencies.readKubios);
        const encrypted = await dependencies.encrypt(copy, material);
        return jsonResult(200, { success: true, filename: `logical-copy-${new Date().toISOString().slice(0, 10)}.encrypted.json`, contentType: "application/json", content: JSON.stringify(encrypted, null, 2) });
      });
    },
  };
}

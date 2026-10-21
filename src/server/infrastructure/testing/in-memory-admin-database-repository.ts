import type { AdminDatabaseRepository } from "@/server/application/ports/admin-database-repository";
import type {
  DatabaseTablePage,
  DatabaseTableInfo,
  DatabaseTablesResult,
} from "@/server/domain/admin-database";
import type { HealthRecord } from "@/server/domain/health-data";
import { NotFoundError } from "@/server/domain/errors";

/** Test-only adapter. */
export class InMemoryAdminDatabaseRepository implements AdminDatabaseRepository {
  constructor(
    private readonly tables: Readonly<
      Record<string, { readonly records: readonly HealthRecord[]; readonly accessible?: boolean }>
    > = {},
  ) {}

  async listTables(): Promise<DatabaseTablesResult> {
    const tables: DatabaseTableInfo[] = Object.entries(this.tables).map(
      ([name, table]) => ({
        name,
        recordCount: table.records.length,
        accessible: table.accessible ?? true,
      }),
    );
    return {
      tables,
      totalRecords: tables.reduce((sum, table) => sum + table.recordCount, 0),
      accessibleCount: tables.filter((table) => table.accessible).length,
      totalCount: tables.length,
    };
  }

  async getTableData(tableName: string, limit: number): Promise<DatabaseTablePage> {
    const table = this.tables[tableName];
    if (table === undefined) {
      throw new NotFoundError(`Tabla no encontrada: ${tableName}`);
    }
    const data = table.records.slice(0, limit);
    return {
      tableName,
      data,
      totalRecords: table.records.length,
      returnedRecords: data.length,
      limit,
    };
  }
}

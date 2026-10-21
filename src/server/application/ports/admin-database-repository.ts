import type {
  DatabaseTablePage,
  DatabaseTablesResult,
} from "@/server/domain/admin-database";

export interface AdminDatabaseRepository {
  listTables(): Promise<DatabaseTablesResult>;
  getTableData(tableName: string, limit: number): Promise<DatabaseTablePage>;
}

import { apiRequest, buildQuery } from "./api-client";
import { deriveBackupKey } from "./derive-backup-key";

export interface DatabaseStats {
  readonly tables: readonly { readonly name: string; readonly recordCount: number; readonly accessible: boolean }[];
  readonly totalRecords: number;
  readonly accessibleCount: number;
  readonly totalCount: number;
  readonly observedAt: string;
  readonly status: "complete" | "partial" | "failed";
}
export interface DatabasePage {
  readonly tableName: string;
  readonly data: readonly Record<string, unknown>[];
  readonly totalRecords: number;
  readonly returnedRecords: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}
export interface DatabaseDownload { readonly filename: string; readonly contentType: string; readonly content: string }

export const databaseApi = {
  stats: () => apiRequest<DatabaseStats>("/api/admin/database/tables"),
  page: (table: string, limit: number, offset: number) => apiRequest<DatabasePage>(`/api/admin/database/table-data${buildQuery({ table, limit, offset })}`),
  exportTable: (table: string, format: "csv" | "json") => apiRequest<DatabaseDownload>(`/api/admin/database/export${buildQuery({ table, format })}`),
  /** The browser derives the encryption key locally: the passphrase never
   * travels in the request, so it cannot appear in any inspectable payload. */
  logicalCopy: async (password: string) => {
    const derived = await deriveBackupKey(password);
    return apiRequest<DatabaseDownload>("/api/admin/database/logical-backup", { method: "POST", body: JSON.stringify({ salt: derived.salt, key: derived.key }) });
  },
};
export function saveDatabaseDownload(download: DatabaseDownload): void {
  const url = URL.createObjectURL(new Blob([download.content], { type: download.contentType }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = download.filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

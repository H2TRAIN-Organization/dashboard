import type { AdminDatabaseUseCases } from "./admin-database-use-cases";
import { ConflictError } from "@/server/domain/errors";
import type { HealthRecord } from "@/server/domain/health-data";
import type { ActiveActor } from "@/server/domain/user";

const PAGE_SIZE = 1000;
const COPY_TABLES = ["users", "insulindata", "fooddata", "exercisedata", "periodrecords", "mooddata", "polar_data"];
const SECRET_KEY = /password|passhash|secret|token|credential|cipher|(^|_)(iv|api_?key|private_?key|session)(_|$)/i;

/** Defense in depth for future nested health fields; public users already use a projection. */
function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, item]) => [key, withoutSecrets(item)]));
  }
  return value;
}

function incomplete(): never {
  throw new ConflictError("CONFLICT", "La lectura no está completa o los datos cambiaron. Repite la operación.");
}

/** Ordered pages, exact counts and unique PKs. Never silently returns a short
 * export. Uniqueness is checked per key instead of assuming the JavaScript
 * string ordering matches the database collation: PostgreSQL may order text
 * keys differently, and that difference is not a data inconsistency. */
export async function readCompleteAdminTable(
  database: AdminDatabaseUseCases,
  actor: ActiveActor,
  table: string,
): Promise<readonly HealthRecord[]> {
  const records: HealthRecord[] = [];
  const seenKeys = new Set<string>();
  let expected: number | undefined;
  for (;;) {
    const page = await database.getTableData(actor, table, PAGE_SIZE, records.length);
    expected ??= page.totalRecords;
    if (!Number.isSafeInteger(expected) || expected < 0 || page.totalRecords !== expected || page.returnedRecords !== page.data.length || page.data.length !== Math.min(PAGE_SIZE, expected - records.length)) incomplete();
    for (const row of page.data) {
      const key = row[table === "users" ? "UserID" : "id"];
      if ((typeof key !== "string" && typeof key !== "number") || String(key).length === 0) incomplete();
      const currentKey = String(key);
      if (seenKeys.has(currentKey)) incomplete();
      seenKeys.add(currentKey);
      records.push(withoutSecrets(row) as HealthRecord);
    }
    if (records.length === expected) return records;
  }
}

export interface DatabaseDownload {
  readonly filename: string;
  readonly contentType: string;
  readonly content: string;
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Prevent formulas from running when CSV is opened in spreadsheet software.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function createTableExport(database: AdminDatabaseUseCases, actor: ActiveActor, table: string, format: "json" | "csv"): Promise<DatabaseDownload> {
  const records = await readCompleteAdminTable(database, actor, table);
  const columns = [...new Set(records.flatMap((row) => Object.keys(row)))];
  return {
    filename: `${table}.${format}`,
    contentType: format === "json" ? "application/json" : "text/csv;charset=utf-8",
    content: format === "json" ? JSON.stringify({ table, recordCount: records.length, data: records }, null, 2) : [columns.map(csvCell).join(","), ...records.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n"),
  };
}

export async function createLogicalCopy(
  database: AdminDatabaseUseCases,
  actor: ActiveActor,
  readKubios: (actor: ActiveActor) => Promise<readonly { readonly userId: number }[]>,
) {
  const stats = await database.listTables(actor);
  if (stats.tables.length !== COPY_TABLES.length || stats.accessibleCount !== stats.totalCount || stats.tables.some((table) => !table.accessible) || COPY_TABLES.some((name) => !stats.tables.some((table) => table.name === name))) incomplete();
  const tables: Record<string, readonly HealthRecord[]> = {};
  for (const table of stats.tables) {
    const rows = await readCompleteAdminTable(database, actor, table.name);
    if (rows.length !== table.recordCount) incomplete();
    tables[table.name] = rows;
  }
  if (!tables.users) incomplete();
  // Any Kubios failure propagates: there is deliberately no partial-backup fallback.
  const kubios = await readKubios(actor);
  const userIds = new Set(tables.users.map((user) => String(user.UserID)));
  if (kubios.some((participant) => !userIds.has(String(participant.userId)))) incomplete();
  const finalStats = await database.listTables(actor);
  if (finalStats.accessibleCount !== stats.totalCount || finalStats.totalCount !== stats.totalCount || finalStats.tables.some((table) => !table.accessible || tables[table.name]?.length !== table.recordCount)) incomplete();
  return {
    manifest: {
      format: "dashboard-logical-copy",
      version: 1,
      createdAt: new Date().toISOString(),
      kind: "sanitized-logical-copy",
      consistency: "ordered-pages-count-checked; not-a-transactional-snapshot",
      scope: ["users", "health", "linked-kubios"],
      excluded: ["sessions", "passwords-and-hashes", "tokens-and-keys", "database-schema"],
      counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
      kubiosParticipants: kubios.length,
    },
    tables,
    kubios: withoutSecrets(kubios),
  };
}

import { PersistenceError } from "@/server/infrastructure/persistence/errors";
import type {
  PersistenceFilter,
  PersistenceGateway,
  SelectRequest,
  SelectResult,
} from "@/server/infrastructure/persistence/supabase/query-types";

export type FakeRow = Record<string, unknown>;

export interface SelectCall {
  readonly table: string;
  readonly request: SelectRequest;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

function compareFilterValue(value: unknown, expected: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const left = Date.parse(value);
    const right = Date.parse(expected);
    if (!Number.isNaN(left) && !Number.isNaN(right)) {
      return left - right;
    }
    return value.localeCompare(expected);
  }
  return String(value).localeCompare(expected);
}

function matches(row: FakeRow, filter: PersistenceFilter): boolean {
  const value = row[filter.column];
  const compared =
    filter.kind === "eq" || filter.kind === "ilike" || filter.kind === "is"
      ? null
      : compareFilterValue(value, filter.value);
  switch (filter.kind) {
    case "eq":
      return value === filter.value;
    case "gte":
      return compared !== null && compared >= 0;
    case "lt":
      return compared !== null && compared < 0;
    case "lte":
      return compared !== null && compared <= 0;
    case "ilike": {
      if (typeof value !== "string") {
        return false;
      }
      const needle = filter.value.replaceAll("%", "").toLocaleLowerCase();
      return value.toLocaleLowerCase().includes(needle);
    }
    case "is":
      return value === null || value === undefined;
  }
}

function project(row: FakeRow, columns: string): FakeRow {
  if (columns === "*") {
    return { ...row };
  }
  const output: FakeRow = {};
  for (const column of columns.split(",").map((value) => value.trim())) {
    if (column.length > 0 && column in row) {
      output[column] = row[column];
    }
  }
  return output;
}

export class FakePersistenceGateway implements PersistenceGateway {
  readonly tables = new Map<string, FakeRow[]>();
  readonly selectCalls: SelectCall[] = [];
  readonly rpcCalls: Array<{ readonly name: string; readonly args: Record<string, unknown> }> = [];
  readonly insertCalls: Array<{ readonly table: string; readonly values: Record<string, unknown> }> = [];
  readonly updateCalls: Array<{
    readonly table: string;
    readonly values: Record<string, unknown>;
    readonly match: Record<string, string | number>;
  }> = [];

  rpcHandler: (name: string, args: Record<string, unknown>) => unknown = () => null;
  rpcError: Error | null = null;
  insertError: Error | null = null;
  updateError: Error | null = null;
  selectErrors = new Map<string, Error>();

  constructor(seed: Record<string, readonly FakeRow[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) {
      this.tables.set(
        table,
        rows.map((row) => ({ ...row })),
      );
    }
  }

  async select(table: string, request: SelectRequest): Promise<SelectResult> {
    this.selectCalls.push({ table, request });
    const error = this.selectErrors.get(table);
    if (error !== undefined) {
      throw error;
    }

    let rows = [...(this.tables.get(table) ?? [])];
    for (const filter of request.filters ?? []) {
      rows = rows.filter((row) => matches(row, filter));
    }
    const count = rows.length;

    if (request.order !== undefined) {
      const { column, ascending = true } = request.order;
      rows.sort((left, right) => compareValues(left[column], right[column]));
      if (!ascending) {
        rows.reverse();
      }
    }
    if (request.range !== undefined) {
      rows = rows.slice(request.range.from, request.range.to + 1);
    }
    if (request.limit !== undefined) {
      rows = rows.slice(0, request.limit);
    }
    if (request.head === true) {
      rows = [];
    }

    return {
      rows: rows.map((row) => ({ ...row })),
      count: request.count === undefined ? null : count,
    };
  }

  async insert(
    table: string,
    values: Record<string, unknown>,
    columns: string,
  ): Promise<unknown | null> {
    this.insertCalls.push({ table, values: { ...values } });
    if (this.insertError !== null) {
      throw this.insertError;
    }
    const rows = this.tables.get(table) ?? [];
    const idColumn = table === "users" ? "UserID" : "id";
    const nextId =
      rows.reduce((max, row) => {
        const value = row[idColumn];
        return typeof value === "number" && value > max ? value : max;
      }, 0) + 1;
    const row: FakeRow = { [idColumn]: nextId, ...values };
    rows.push(row);
    this.tables.set(table, rows);
    return project(row, columns);
  }

  async update(
    table: string,
    values: Record<string, unknown>,
    match: Record<string, string | number>,
    columns: string,
  ): Promise<readonly unknown[]> {
    this.updateCalls.push({ table, values: { ...values }, match: { ...match } });
    if (this.updateError !== null) {
      throw this.updateError;
    }
    const rows = this.tables.get(table) ?? [];
    const updated: FakeRow[] = [];
    for (const row of rows) {
      const matchesAll = Object.entries(match).every(
        ([key, value]) => row[key] === value,
      );
      if (matchesAll) {
        Object.assign(row, values);
        updated.push(project(row, columns));
      }
    }
    return updated;
  }

  async rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    this.rpcCalls.push({ name, args: { ...args } });
    if (this.rpcError !== null) {
      throw this.rpcError;
    }
    return (await this.rpcHandler(name, args)) as T;
  }
}

export function uniqueViolation(): PersistenceError {
  return new PersistenceError("UNIQUE_VIOLATION", "duplicate", {
    operation: "insert",
    table: "users",
    pgCode: "23505",
  });
}

export function userHasDataError(): PersistenceError {
  return new PersistenceError("USER_HAS_DATA", "has data", {
    operation: "rpc:t009_delete_user",
    pgCode: "P0001",
    raiseCode: "USER_HAS_DATA",
  });
}

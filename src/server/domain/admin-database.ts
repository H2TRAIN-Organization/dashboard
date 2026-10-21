import { BadRequestError } from "./errors";
import type { HealthRecord } from "./health-data";

export interface DatabaseTableInfo {
  readonly name: string;
  readonly recordCount: number;
  readonly accessible: boolean;
  readonly error?: string;
}

export interface DatabaseTablesResult {
  readonly tables: readonly DatabaseTableInfo[];
  readonly totalRecords: number;
  readonly accessibleCount: number;
  readonly totalCount: number;
}

export interface DatabaseTablePage {
  readonly tableName: string;
  readonly data: readonly HealthRecord[];
  readonly totalRecords: number;
  readonly returnedRecords: number;
  readonly limit: number;
}

const TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export function assertSafeTableName(tableName: string): void {
  if (!TABLE_NAME_PATTERN.test(tableName)) {
    throw new BadRequestError(
      "El nombre de tabla no es válido. Usa minúsculas, números y guiones bajos.",
    );
  }
}

export function assertTableLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new BadRequestError("El límite debe ser un entero entre 1 y 1000.");
  }
}

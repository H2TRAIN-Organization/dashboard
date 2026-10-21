import { persistenceMappingError } from "./errors";

export function parseUserId(id: string): number | null {
  const trimmed = id.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

export function toCanonicalUserId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) {
      return String(parsed);
    }
  }
  throw persistenceMappingError("El identificador UserID no es válido.", {
    operation: "map",
    table: "users",
  });
}

export function asRecord(
  value: unknown,
  table: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw persistenceMappingError("La fila recibida no es un objeto.", {
      operation: "map",
      table,
    });
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, field: string, table: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw persistenceMappingError(`La columna ${field} es obligatoria.`, {
      operation: "map",
      table,
    });
  }
  return value;
}

export function nullableString(value: unknown, field: string, table: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw persistenceMappingError(`La columna ${field} no es texto.`, {
      operation: "map",
      table,
    });
  }
  return value;
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

const TIMESTAMP_WITHOUT_ZONE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/**
 * Normalizes both `timestamp without time zone` and `timestamptz` values to
 * ISO-8601 UTC. Timestamps without an offset are interpreted as UTC by
 * convention; the legacy UI stores them that way.
 */
export function normalizeTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const normalized = TIMESTAMP_WITHOUT_ZONE.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

import { AsyncLocalStorage } from "node:async_hooks";

import { AppError } from "@/server/domain/errors";

export type ErrorStage = "handler" | "route" | "response";

export interface RequestErrorContext {
  readonly requestId?: string | null;
  readonly method?: string | null;
  readonly route?: string | null;
}

export interface ServerErrorDiagnostic {
  readonly type: string;
  readonly code?: string;
  readonly operation?: string;
  readonly table?: string;
  readonly postgresCode?: string;
  readonly raiseCode?: string;
  readonly field?: string;
  readonly requestId?: string;
  readonly method?: string;
  readonly route?: string;
  readonly stage?: ErrorStage;
}

/**
 * Request-scoped context used only to correlate safe diagnostics. It never
 * carries tokens, cookies, query strings, bodies or row values.
 */
const requestContext = new AsyncLocalStorage<RequestErrorContext>();

const KNOWN_ERROR_NAMES = new Set([
  "Error",
  "AggregateError",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "CryptoError",
  "PersistenceError",
]);

const DIAGNOSTIC_ERROR_NAMES = new Set(["CryptoError", "PersistenceError"]);

const HEALTH_TABLES = new Set([
  "insulindata",
  "fooddata",
  "exercisedata",
  "periodrecords",
  "mooddata",
  "polar_data",
]);

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_OPERATION = /^(?:config|map|select|insert|update|unknown|rpc:[a-z0-9_]{1,64})$/;
const SAFE_TABLE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_FIELD =
  /^[A-Za-z][A-Za-z0-9_]*(?:\[[0-9]{1,4}\])?(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;
const SAFE_PG_CODE = /^[A-Z0-9]{5,12}$/;
const SAFE_RAISE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const SAFE_METHOD = /^[A-Z]{3,10}$/;
const SAFE_ROUTE = /^\/[A-Za-z0-9/_-]{1,120}$/;

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeString(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : null;
}

function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return KNOWN_ERROR_NAMES.has(name) ? name : "UnknownError";
}

function healthField(value: unknown): { table: string; field: string } | null {
  const field = safeString(value, SAFE_FIELD);
  if (field === null) {
    return null;
  }
  const separator = field.indexOf(".");
  if (separator <= 0) {
    return null;
  }
  const table = field.slice(0, separator);
  if (!HEALTH_TABLES.has(table)) {
    return null;
  }
  return { table, field };
}

/**
 * Builds the sanitized diagnostic. Only fixed metadata (error class, safe error
 * codes, operation/table/field identifiers and the request id) is copied.
 * Messages, stacks, causes, request data, usernames, ciphertext and row values
 * are never read.
 */
export function internalErrorDiagnostic(
  error: unknown,
  stage: ErrorStage = "response",
): ServerErrorDiagnostic {
  const type = errorName(error);
  let diagnostic: ServerErrorDiagnostic = { type };

  if (DIAGNOSTIC_ERROR_NAMES.has(type)) {
    const code = safeString(readProperty(error, "code"), SAFE_CODE);
    if (code !== null) {
      diagnostic = { ...diagnostic, code };
    }
  }

  if (type === "PersistenceError") {
    const operation = safeString(readProperty(error, "operation"), SAFE_OPERATION);
    const table = safeString(readProperty(error, "table"), SAFE_TABLE);
    const postgresCode = safeString(readProperty(error, "pgCode"), SAFE_PG_CODE);
    const raiseCode = safeString(readProperty(error, "raiseCode"), SAFE_RAISE_CODE);
    diagnostic = {
      ...diagnostic,
      ...(operation === null ? {} : { operation }),
      ...(table === null ? {} : { table }),
      ...(postgresCode === null ? {} : { postgresCode }),
      ...(raiseCode === null ? {} : { raiseCode }),
    };
  }

  if (type === "CryptoError") {
    const field = healthField(readProperty(error, "field"));
    if (field !== null) {
      diagnostic = { ...diagnostic, table: field.table, field: field.field };
    }
  }

  const context = requestContext.getStore();
  if (context !== undefined) {
    const requestId = safeString(context.requestId, SAFE_REQUEST_ID);
    const method = safeString(context.method, SAFE_METHOD);
    const route = safeString(context.route, SAFE_ROUTE);
    diagnostic = {
      ...diagnostic,
      ...(requestId === null ? {} : { requestId }),
      ...(method === null ? {} : { method }),
      ...(route === null ? {} : { route }),
      stage,
    };
  }

  return diagnostic;
}

export function extractRequestId(
  headers: readonly (string | null)[],
): string | null {
  for (const header of headers) {
    const candidate = header?.split(",")[0]?.trim() ?? "";
    const safe = safeString(candidate, SAFE_REQUEST_ID);
    if (safe !== null) {
      return safe;
    }
  }
  return null;
}

export function runWithRequestErrorContext<T>(
  context: RequestErrorContext,
  operation: () => Promise<T>,
): Promise<T> {
  return requestContext.run(context, operation);
}

/**
 * Reports one unexpected error without changing the HTTP result. Expected
 * application errors are mapped by the HTTP layer and are not logged here.
 * Logging must never throw: a diagnostics failure cannot mask the response.
 */
export function reportServerError(error: unknown, stage: ErrorStage): void {
  if (error instanceof AppError) {
    return;
  }
  try {
    console.error(
      JSON.stringify({
        event: "api.internal_error",
        ...internalErrorDiagnostic(error, stage),
      }),
    );
  } catch {
    // Diagnostics are best-effort and must not affect the response path.
  }
}

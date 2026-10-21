export type PersistenceErrorCode =
  | "CONFIG_INVALID"
  | "QUERY_FAILED"
  | "UNIQUE_VIOLATION"
  | "FOREIGN_KEY_VIOLATION"
  | "NOT_NULL_VIOLATION"
  | "PERMISSION_DENIED"
  | "RPC_NOT_FOUND"
  | "MIGRATION_REQUIRED"
  | "USER_HAS_DATA"
  | "MAPPING_FAILED"
  | "UNSUPPORTED_FIELD"
  | "PASSWORD_HASH_INVALID"
  | "USERID_DEFAULT_MISSING"
  | "NOT_FOUND";

export interface PersistenceErrorOptions {
  readonly operation?: string;
  readonly table?: string;
  readonly pgCode?: string | null;
  readonly raiseCode?: string | null;
}

/**
 * Safe persistence error. It deliberately carries no row values, ciphertext,
 * hashes, encryption keys or raw database messages.
 */
export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly operation: string;
  readonly table: string | null;
  readonly pgCode: string | null;
  readonly raiseCode: string | null;

  constructor(code: PersistenceErrorCode, message: string, options: PersistenceErrorOptions = {}) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    this.operation = options.operation ?? "unknown";
    this.table = options.table ?? null;
    this.pgCode = options.pgCode ?? null;
    this.raiseCode = options.raiseCode ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isPersistenceError(value: unknown): value is PersistenceError {
  return value instanceof PersistenceError;
}

const RAISE_CODE_TOKENS = [
  "USER_HAS_DATA",
  "PERSISTENCE_MIGRATION_REQUIRED",
  "INVALID_ROLE",
  "INVALID_USERNAME",
  "USERNAME_TAKEN",
] as const;

function readStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : null;
}

/**
 * Maps a PostgREST/Postgres error to a safe error. The raw database message is
 * never copied: it can contain duplicate key values or other row data.
 */
export function persistenceErrorFromDatabase(
  error: unknown,
  context: { readonly operation: string; readonly table?: string },
): PersistenceError {
  const pgCode = readStringProperty(error, "code");
  const rawMessage = readStringProperty(error, "message") ?? "";
  const raiseCode =
    RAISE_CODE_TOKENS.find((token) => rawMessage.includes(token)) ?? null;

  const base = {
    operation: context.operation,
    ...(context.table === undefined ? {} : { table: context.table }),
    pgCode,
    raiseCode,
  } as const;

  if (pgCode === "23505" || raiseCode === "USERNAME_TAKEN") {
    return new PersistenceError(
      "UNIQUE_VIOLATION",
      "Ya existe un registro con el mismo valor único.",
      base,
    );
  }
  if (pgCode === "23503") {
    return new PersistenceError(
      "FOREIGN_KEY_VIOLATION",
      "La operación viola una relación entre usuarios y datos.",
      base,
    );
  }
  if (pgCode === "23502") {
    return new PersistenceError(
      "NOT_NULL_VIOLATION",
      "Falta un valor obligatorio en la base de datos.",
      base,
    );
  }
  if (pgCode === "42501") {
    return new PersistenceError(
      "PERMISSION_DENIED",
      "La credencial de servicio no tiene permisos suficientes.",
      base,
    );
  }
  if (pgCode === "PGRST202") {
    return new PersistenceError(
      "RPC_NOT_FOUND",
      "La función SQL requerida no existe. Aplica las migraciones T-009.",
      base,
    );
  }
  if (raiseCode === "USER_HAS_DATA") {
    return new PersistenceError(
      "USER_HAS_DATA",
      "El usuario tiene datos de salud asociados y no puede eliminarse.",
      base,
    );
  }
  if (raiseCode === "PERSISTENCE_MIGRATION_REQUIRED") {
    return new PersistenceError(
      "MIGRATION_REQUIRED",
      "Faltan las restricciones o funciones SQL de T-009. Aplica las migraciones antes de escribir.",
      base,
    );
  }
  if (raiseCode === "INVALID_ROLE") {
    return new PersistenceError(
      "MAPPING_FAILED",
      "El rol recibido no es válido.",
      base,
    );
  }
  if (raiseCode === "INVALID_USERNAME") {
    return new PersistenceError(
      "MAPPING_FAILED",
      "El nombre de usuario no es válido.",
      base,
    );
  }
  if (pgCode === "PGRST116") {
    return new PersistenceError("NOT_FOUND", "No se encontró el registro.", base);
  }

  return new PersistenceError(
    "QUERY_FAILED",
    "No se pudo completar la operación de persistencia.",
    base,
  );
}

export function persistenceMappingError(
  message: string,
  context: { readonly operation: string; readonly table?: string },
): PersistenceError {
  return new PersistenceError("MAPPING_FAILED", message, context);
}

export function persistenceConfigError(message: string): PersistenceError {
  return new PersistenceError("CONFIG_INVALID", message, { operation: "config" });
}

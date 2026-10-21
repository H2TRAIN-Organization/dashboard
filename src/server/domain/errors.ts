export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "USER_HAS_DATA"
  | "TABLE_NOT_ALLOWED"
  | "NOT_IMPLEMENTED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Readonly<Record<string, unknown>> },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = options?.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(
    message = "La petición no es válida",
    options?: { cause?: unknown; details?: Readonly<Record<string, unknown>> },
  ) {
    super(400, "BAD_REQUEST", message, options);
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "Los datos enviados no son válidos",
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(400, "VALIDATION_ERROR", message, details === undefined ? undefined : { details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Autenticación requerida") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "No tienes permisos para realizar esta acción") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(
    code: Extract<ErrorCode, "CONFLICT" | "USER_HAS_DATA"> = "CONFLICT",
    message = "La operación entra en conflicto con el estado actual",
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(409, code, message, details === undefined ? undefined : { details });
  }
}

export class NotImplementedError extends AppError {
  constructor(message = "Funcionalidad pendiente de implementación") {
    super(501, "NOT_IMPLEMENTED", message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Servicio no configurado") {
    super(503, "SERVICE_UNAVAILABLE", message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

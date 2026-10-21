import { ServiceUnavailableError } from "@/server/domain/errors";

/**
 * Raised when authentication cannot run because required configuration or
 * persistent infrastructure (SQL migration, explicit identity link) is missing.
 * Messages must never contain secret values, tokens or personal data.
 */
export class AuthConfigurationError extends ServiceUnavailableError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Raised when a server-side dependency needed for authentication is unavailable.
 * The HTTP layer maps it to 503 instead of silently treating the session as
 * valid or invalid.
 */
export class AuthInfrastructureError extends ServiceUnavailableError {
  constructor(message = "El servicio de autenticación no está disponible") {
    super(message);
  }
}

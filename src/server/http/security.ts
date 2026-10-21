import { ForbiddenError } from "@/server/domain/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CsrfInput {
  readonly method: string;
  readonly origin: string | null;
  readonly secFetchSite: string | null;
  readonly requestOrigin: string;
  readonly allowedOrigins?: readonly string[];
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLocaleLowerCase();
}

/**
 * Browser mutations must be same-origin. We accept either a matching Origin
 * header, or Sec-Fetch-Site: same-origin/none. No CSRF token or secret is placed
 * in request bodies. Non-browser callers must send an allowed Origin header.
 */
export function assertCsrfSafe(input: CsrfInput): void {
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return;
  }

  const site = input.secFetchSite?.toLocaleLowerCase();
  if (site === "cross-site") {
    throw new ForbiddenError("Petición cross-site rechazada");
  }

  const allowed = new Set(
    [input.requestOrigin, ...(input.allowedOrigins ?? [])].map(normalizeOrigin),
  );

  if (input.origin !== null && input.origin.length > 0) {
    if (!allowed.has(normalizeOrigin(input.origin))) {
      throw new ForbiddenError("Origen no permitido para una operación de escritura");
    }
    return;
  }

  if (site === "same-origin" || site === "none") {
    return;
  }

  throw new ForbiddenError(
    "Faltan cabeceras de origen para una operación de escritura",
  );
}

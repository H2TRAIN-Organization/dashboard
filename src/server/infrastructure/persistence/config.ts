import { persistenceConfigError } from "./errors";

export interface SupabasePersistenceConfig {
  readonly url: string;
  readonly serviceRoleKey: string;
}

function decodeJwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !token.startsWith("eyJ")) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? "", "base64url").toString("utf8"),
    ) as unknown;
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    const role = (payload as Record<string, unknown>).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

/**
 * Accepts only a service-role credential. The legacy `SUPABASE_SECRET_KEY` in
 * `.env.local` has been observed as an anon JWT, so it is not accepted unless
 * it actually carries role=service_role (or is a new sb_secret_ key).
 */
export function isServiceRoleCredential(token: string): boolean {
  const value = token.trim();
  if (value.length < 20) {
    return false;
  }
  if (value.startsWith("sb_secret_")) {
    return true;
  }
  return decodeJwtRole(value) === "service_role";
}

type Environment = Readonly<Record<string, string | undefined>>;

function readNonEmpty(
  environment: Environment,
  name: string,
): string | null {
  const value = environment[name];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function readSupabasePersistenceConfig(
  environment: Environment = process.env,
): SupabasePersistenceConfig {
  const rawUrl = readNonEmpty(environment, "SUPABASE_URL");
  if (rawUrl === null) {
    throw persistenceConfigError(
      "Supabase no está configurado: falta SUPABASE_URL.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw persistenceConfigError("SUPABASE_URL no es una URL válida.");
  }

  const isLocal =
    parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname === "127.0.0.1" ||
    parsedUrl.hostname === "::1";
  if (parsedUrl.protocol !== "https:" && !(isLocal && parsedUrl.protocol === "http:")) {
    throw persistenceConfigError(
      "SUPABASE_URL debe usar HTTPS (HTTP solo se admite en localhost).",
    );
  }

  const candidates = [
    readNonEmpty(environment, "SUPABASE_SERVICE_ROLE_KEY"),
    readNonEmpty(environment, "SUPABASE_SECRET_KEY"),
  ].filter((value): value is string => value !== null);

  if (candidates.length === 0) {
    throw persistenceConfigError(
      "Supabase no está configurado: falta SUPABASE_SERVICE_ROLE_KEY (o una SUPABASE_SECRET_KEY con rol service_role).",
    );
  }

  const serviceRoleKey = candidates.find(isServiceRoleCredential);
  if (serviceRoleKey === undefined) {
    throw persistenceConfigError(
      "La credencial de Supabase no tiene rol service_role. Usa SUPABASE_SERVICE_ROLE_KEY; SUPABASE_SECRET_KEY con rol anon no sirve para persistencia.",
    );
  }

  return {
    url: rawUrl.replace(/\/+$/, ""),
    serviceRoleKey,
  };
}

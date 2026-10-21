// Must match src/server/http/cookies.ts (SESSION_COOKIE_NAME) in the foundation.
const DEFAULT_COOKIE = "dashboard_session";
const MAX_COOKIE_VALUE_LENGTH = 8_192;

export interface AuthCookieOptions {
  /** Defaults to dashboard_session, matching the foundation HTTP cookie layer. */
  readonly name?: string;
  /** Must be true in production. Defaults to false for safety at this layer. */
  readonly secure?: boolean;
  readonly now?: () => Date;
}

export interface AuthCookiePolicy {
  readonly name: string;
  readonly secure: boolean;
  read(cookieHeader: string | undefined): string | null;
  serialize(token: string, expiresAt: string, now?: Date): string;
  clear(now?: Date): string;
}

function isValidToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_COOKIE_VALUE_LENGTH &&
    /^v1\.[A-Za-z0-9_-]+$/.test(value)
  );
}

function readCookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (cookieHeader === undefined || cookieHeader.length === 0) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const cookieName = part.slice(0, separator).trim();
    if (cookieName !== name) {
      continue;
    }
    let value = part.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return isValidToken(value) ? value : null;
  }
  return null;
}

/**
 * HttpOnly cookie transport for the opaque session token. The token is never
 * exposed to client JavaScript and never returned in a JSON DTO.
 */
export function createAuthCookiePolicy(
  options: AuthCookieOptions = {},
): AuthCookiePolicy {
  const secure = options.secure ?? false;
  const name = options.name ?? DEFAULT_COOKIE;
  if (name.startsWith("__Host-") && !secure) {
    throw new Error("La cookie __Host- exige Secure");
  }
  const now = options.now ?? (() => new Date());

  const attributes = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    "Priority=High",
  ];

  return {
    name,
    secure,

    read(cookieHeader: string | undefined): string | null {
      return readCookieValue(cookieHeader, name);
    },

    serialize(token: string, expiresAt: string, current: Date = now()): string {
      if (!isValidToken(token)) {
        throw new Error("Token de sesión inválido para cookie");
      }
      const expiryMs = Date.parse(expiresAt);
      if (!Number.isFinite(expiryMs)) {
        throw new Error("expiresAt inválido para cookie");
      }
      const maxAge = Math.max(0, Math.floor((expiryMs - current.getTime()) / 1000));
      return [
        `${name}=${token}`,
        `Max-Age=${maxAge}`,
        `Expires=${new Date(expiryMs).toUTCString()}`,
        ...attributes,
      ].join("; ");
    },

    clear(current: Date = now()): string {
      // Keep the same name/path/attributes so browsers replace the cookie.
      void current;
      return [
        `${name}=`,
        "Max-Age=0",
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        ...attributes,
      ].join("; ");
    },
  };
}

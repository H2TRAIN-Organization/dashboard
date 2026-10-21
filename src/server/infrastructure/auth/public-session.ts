import {
  toPublicSession as toDomainPublicSession,
  type PublicSession,
  type Session,
} from "@/server/domain/session";
import type { AuthCookiePolicy } from "./cookie";

/**
 * Contract DTO: { user, method, expiresAt }. It deliberately has no token.
 * The foundation Session already carries `method`.
 */
export function toPublicSession(session: Session): PublicSession {
  return toDomainPublicSession(session);
}

export interface AuthHttpResult {
  readonly status: number;
  readonly body?: PublicSession;
  readonly headers: Readonly<Record<string, string>>;
}

export interface AuthHttpBridge {
  /** Reads the opaque cookie token from a raw Cookie header. */
  readToken(cookieHeader: string | undefined): string | null;
  /** 200 + public session DTO + HttpOnly session cookie. */
  sessionResponse(session: Session, status?: number): AuthHttpResult;
  /** 204 + cookie deletion. */
  logoutResponse(): AuthHttpResult;
}

/**
 * Small adapter for the route handlers the integrator will mount. It keeps the
 * session token out of every JSON response.
 */
export function createAuthHttpBridge(input: {
  readonly cookies: AuthCookiePolicy;
}): AuthHttpBridge {
  const { cookies } = input;

  return {
    readToken(cookieHeader: string | undefined): string | null {
      return cookies.read(cookieHeader);
    },

    sessionResponse(session: Session, status = 200): AuthHttpResult {
      return {
        status,
        body: toPublicSession(session),
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Set-Cookie": cookies.serialize(session.token, session.expiresAt),
        },
      };
    },

    logoutResponse(): AuthHttpResult {
      return {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": cookies.clear(),
        },
      };
    },
  };
}

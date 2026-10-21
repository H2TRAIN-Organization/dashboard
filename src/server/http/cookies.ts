export interface HttpCookie {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "lax" | "strict" | "none";
  readonly path: string;
  readonly maxAge?: number;
  readonly expires?: Date;
}

export const SESSION_COOKIE_NAME = "dashboard_session";

export function buildSessionCookie(
  token: string,
  expiresAt: string,
  secure: boolean,
): HttpCookie {
  const expires = new Date(expiresAt);
  const validExpiry = !Number.isNaN(expires.getTime());
  const maxAge = validExpiry
    ? Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000))
    : undefined;

  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    ...(maxAge === undefined ? {} : { maxAge }),
    ...(validExpiry ? { expires } : {}),
  };
}

export function buildClearedSessionCookie(secure: boolean): HttpCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  };
}

import type { ActiveActor, User } from "./user";

export const AUTH_METHODS = ["email", "username"] as const;

export type AuthMethod = (typeof AUTH_METHODS)[number];

/**
 * Internal session shape. `token` is an opaque server-side secret and must
 * never be serialized to JSON; HTTP adapters place it in an HttpOnly cookie.
 */
export interface Session {
  readonly user: User;
  readonly token: string;
  readonly method: AuthMethod;
  readonly expiresAt: string;
}

/**
 * Public session DTO. There is deliberately no token, hash or cookie value.
 */
export interface PublicSession {
  readonly user: User;
  readonly method: AuthMethod;
  readonly expiresAt: string;
}

export function toPublicSession(session: Session): PublicSession {
  return {
    user: session.user,
    method: session.method,
    expiresAt: session.expiresAt,
  };
}

export function toActiveActor(session: Session): ActiveActor {
  return {
    userId: session.user.id,
    username: session.user.username,
    role: session.user.role,
  };
}

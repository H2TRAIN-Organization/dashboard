import type { ActiveActor, User } from "./user";

/**
 * Bearer session returned to clients. No password hash is part of this shape.
 */
export interface Session {
  readonly user: User;
  readonly token: string;
  readonly expiresAt: string;
}

export function toActiveActor(session: Session): ActiveActor {
  return {
    userId: session.user.id,
    username: session.user.username,
    role: session.user.role,
  };
}

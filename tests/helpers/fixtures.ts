import type { ActiveActor, User, UserRole } from "@/server/domain/user";
import { toActiveActor } from "@/server/domain/session";

export function makeUser(
  overrides: Partial<User> & { id: string; username: string; role: UserRole },
): User {
  return {
    email: null,
    uuid: null,
    gdprConsent: false,
    gdprConsentAt: null,
    createdAt: null,
    ...overrides,
  };
}

export function actorFor(user: User): ActiveActor {
  return toActiveActor({
    user,
    token: `token-${user.id}`,
    method: "username",
    expiresAt: "2026-12-31T23:59:59.000Z",
  });
}

export const fixedUser: User = makeUser({
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  role: "user",
  uuid: "external-uuid-1",
});

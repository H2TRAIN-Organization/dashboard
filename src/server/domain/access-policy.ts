import type { ActiveActor, UserRole } from "./user";

export const ROLE_CAPABILITIES = {
  admin: [
    "users:read:all",
    "users:write",
    "health-data:read:all",
    "admin-database:read",
  ],
  doctor: ["users:read:all", "health-data:read:all"],
  user: ["users:read:self", "health-data:read:self"],
} as const satisfies Record<UserRole, readonly string[]>;

export type Capability = (typeof ROLE_CAPABILITIES)[UserRole][number];

export function hasCapability(actor: ActiveActor, capability: Capability): boolean {
  return (ROLE_CAPABILITIES[actor.role] as readonly Capability[]).includes(capability);
}

export function canWriteUsers(actor: ActiveActor): boolean {
  return hasCapability(actor, "users:write");
}

export function canReadAllUsers(actor: ActiveActor): boolean {
  return hasCapability(actor, "users:read:all");
}

export function canReadAllHealthData(actor: ActiveActor): boolean {
  return hasCapability(actor, "health-data:read:all");
}

/**
 * Admins and doctors can list every user. A regular user only sees themselves.
 */
export function canListUser(actor: ActiveActor, targetUserId: string): boolean {
  return canReadAllUsers(actor) || actor.userId === targetUserId;
}

/**
 * `selectedUser` is a username in the legacy data schema, not a user id.
 * Regular users may only request their own username; `all` is privileged.
 */
export function canReadHealthDataFor(
  actor: ActiveActor,
  selectedUser: string,
): boolean {
  if (canReadAllHealthData(actor)) {
    return true;
  }
  return selectedUser !== "all" && selectedUser === actor.username;
}

export function canReadAdminDatabase(actor: ActiveActor): boolean {
  return hasCapability(actor, "admin-database:read");
}

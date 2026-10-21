export const USER_ROLES = ["admin", "doctor", "user"] as const;

/** Maximum username length accepted by the legacy users table. */
export const USERNAME_MAX_LENGTH = 100;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Public user shape. It deliberately contains no password hash, verifier or
 * credential material of any kind.
 */
export interface User {
  readonly id: string;
  readonly username: string;
  readonly email: string | null;
  readonly role: UserRole;
  readonly uuid: string | null;
  readonly gdprConsent: boolean;
  readonly gdprConsentAt: string | null;
  readonly createdAt: string | null;
}

export interface ActiveActor {
  readonly userId: string;
  readonly username: string;
  readonly role: UserRole;
}

export interface UserListFilter {
  readonly search?: string;
  readonly role?: UserRole;
  readonly limit?: number;
  readonly offset?: number;
}

export interface UserPage {
  readonly users: readonly User[];
  readonly total: number;
}

export interface UpdateUserPatch {
  readonly username?: string;
  readonly role?: UserRole;
  readonly gdprConsent?: boolean;
}

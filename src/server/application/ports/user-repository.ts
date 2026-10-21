import type {
  UpdateUserPatch,
  User,
  UserListFilter,
  UserPage,
  UserRole,
} from "@/server/domain/user";

export interface CreateUserRecord {
  readonly username: string;
  readonly email: string | null;
  readonly role: UserRole;
  readonly gdprConsent: boolean;
  /**
   * Plain-text credential supplied by the caller. A production adapter must
   * hash it before persistence and must never return it. This foundation has no
   * production adapter because the legacy credential format is unverified.
   */
  readonly password: string;
}

export interface UserRepository {
  list(filter: UserListFilter): Promise<UserPage>;
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(record: CreateUserRecord): Promise<User>;
  update(id: string, patch: UpdateUserPatch): Promise<User | null>;
  clearUuid(id: string): Promise<User | null>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}

/**
 * Separate read-only port used to decide whether a user may be deleted.
 */
export interface UserDataPresence {
  hasAnyForUser(user: User): Promise<boolean>;
}

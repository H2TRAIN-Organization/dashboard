import type {
  CreateUserRecord,
  UserRepository,
} from "@/server/application/ports/user-repository";
import type {
  UpdateUserPatch,
  User,
  UserListFilter,
  UserPage,
} from "@/server/domain/user";

/**
 * Test-only adapter. It stores no credentials and must never be wired into the
 * production composition root.
 */
export class InMemoryUserRepository implements UserRepository {
  private users: User[];
  private nextId: number;

  constructor(seed: readonly User[] = []) {
    this.users = seed.map((user) => ({ ...user }));
    this.nextId = this.users.length + 1;
  }

  async list(filter: UserListFilter): Promise<UserPage> {
    const search = filter.search?.toLocaleLowerCase();
    const matching = this.users.filter((user) => {
      const matchesSearch =
        search === undefined || user.username.toLocaleLowerCase().includes(search);
      const matchesRole = filter.role === undefined || user.role === filter.role;
      return matchesSearch && matchesRole;
    });

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return {
      users: matching.slice(offset, offset + limit),
      total: matching.length,
    };
  }

  async findById(id: string): Promise<User | null> {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async create(record: CreateUserRecord): Promise<User> {
    const user: User = {
      id: `test-user-${this.nextId++}`,
      username: record.username,
      email: record.email,
      role: record.role,
      uuid: null,
      gdprConsent: record.gdprConsent,
      gdprConsentAt: record.gdprConsent ? new Date(0).toISOString() : null,
      createdAt: new Date(0).toISOString(),
    };
    this.users.push(user);
    return user;
  }

  async update(id: string, patch: UpdateUserPatch): Promise<User | null> {
    const index = this.users.findIndex((user) => user.id === id);
    const current = this.users[index];
    if (current === undefined) {
      return null;
    }
    const updated: User = {
      ...current,
      ...(patch.username === undefined ? {} : { username: patch.username }),
      ...(patch.email === undefined ? {} : { email: patch.email }),
      ...(patch.role === undefined ? {} : { role: patch.role }),
      ...(patch.gdprConsent === undefined ? {} : { gdprConsent: patch.gdprConsent }),
    };
    this.users[index] = updated;
    return updated;
  }

  async clearUuid(id: string): Promise<User | null> {
    const index = this.users.findIndex((user) => user.id === id);
    const current = this.users[index];
    if (current === undefined) {
      return null;
    }
    const updated: User = { ...current, uuid: null };
    this.users[index] = updated;
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const before = this.users.length;
    this.users = this.users.filter((user) => user.id !== id);
    return this.users.length !== before;
  }

  async count(): Promise<number> {
    return this.users.length;
  }

  snapshot(): readonly User[] {
    return this.users;
  }
}

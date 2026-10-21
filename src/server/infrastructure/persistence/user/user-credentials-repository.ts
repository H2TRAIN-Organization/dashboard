import type { User } from "@/server/domain/user";

import type { PersistenceGateway } from "../supabase/query-types";
import type { PasswordHasher } from "./password-hasher";
import { mapUserRow, USER_PUBLIC_COLUMNS } from "./user-mapper";

export interface UserCredentialRecord {
  readonly user: User;
  readonly passwordHash: string;
}

/**
 * Server-only credential reader for the auth adapter. The hash is kept in a
 * separate field and is never part of the public User shape.
 */
export interface UserCredentialsRepository {
  findByUsername(username: string): Promise<UserCredentialRecord | null>;
  findByEmail(email: string): Promise<UserCredentialRecord | null>;
  verifyUsername(username: string, password: string): Promise<User | null>;
  verifyEmail(email: string, password: string): Promise<User | null>;
}

const CREDENTIAL_COLUMNS = `${USER_PUBLIC_COLUMNS},PasswordHash`;

export class SupabaseUserCredentialsRepository implements UserCredentialsRepository {
  constructor(
    private readonly gateway: PersistenceGateway,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async findByUsername(username: string): Promise<UserCredentialRecord | null> {
    const normalized = username.trim();
    if (normalized.length === 0) {
      return null;
    }
    const result = await this.gateway.select("users", {
      columns: CREDENTIAL_COLUMNS,
      filters: [{ kind: "eq", column: "Username", value: normalized }],
      limit: 1,
    });
    const row = result.rows[0];
    if (row === undefined || typeof row !== "object" || row === null) {
      return null;
    }
    const record = row as Record<string, unknown>;
    const passwordHash = record.PasswordHash;
    if (typeof passwordHash !== "string" || passwordHash.length === 0) {
      return null;
    }
    return {
      user: mapUserRow(record),
      passwordHash,
    };
  }

  async findByEmail(email: string): Promise<UserCredentialRecord | null> {
    void email;
    // public.users has no Email column in the verified schema.
    return null;
  }

  async verifyUsername(username: string, password: string): Promise<User | null> {
    const record = await this.findByUsername(username);
    if (record === null) {
      return null;
    }
    const valid = await this.passwordHasher.verify(password, record.passwordHash);
    return valid ? record.user : null;
  }

  async verifyEmail(email: string, password: string): Promise<User | null> {
    void email;
    void password;
    return null;
  }
}

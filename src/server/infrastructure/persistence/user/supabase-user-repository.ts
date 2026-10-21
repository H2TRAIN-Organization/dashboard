import type {
  CreateUserRecord,
  UserRepository,
} from "@/server/application/ports/user-repository";
import {
  ConflictError,
  ValidationError,
} from "@/server/domain/errors";
import {
  isUserRole,
  type UpdateUserPatch,
  type User,
  type UserListFilter,
  type UserPage,
  type UserRole,
} from "@/server/domain/user";

import {
  isPersistenceError,
  PersistenceError,
} from "../errors";
import { parseUserId } from "../ids";
import type { PersistenceGateway, PersistenceFilter } from "../supabase/query-types";
import { isBcryptHash, type PasswordHasher } from "./password-hasher";
import { mapUserRow, USER_PUBLIC_COLUMNS } from "./user-mapper";

const MAX_USERNAME_LENGTH = 100;

function validateUsername(value: string): string {
  const username = value.trim();
  if (username.length === 0) {
    throw new ValidationError("El nombre de usuario es obligatorio.");
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    throw new ValidationError(
      `El nombre de usuario no puede superar ${MAX_USERNAME_LENGTH} caracteres.`,
    );
  }
  return username;
}

function validateRole(value: string): UserRole {
  if (!isUserRole(value)) {
    throw new ValidationError("El rol debe ser admin, doctor o user.");
  }
  return value;
}

function mapWriteError(error: unknown): never {
  if (!isPersistenceError(error)) {
    throw error;
  }
  if (error.code === "UNIQUE_VIOLATION" || error.raiseCode === "USERNAME_TAKEN") {
    throw new ConflictError("CONFLICT", "El nombre de usuario ya existe.");
  }
  if (error.raiseCode === "INVALID_ROLE") {
    throw new ValidationError("El rol debe ser admin, doctor o user.");
  }
  if (error.raiseCode === "INVALID_USERNAME") {
    throw new ValidationError("El nombre de usuario no es válido.");
  }
  if (error.code === "MIGRATION_REQUIRED" || error.code === "RPC_NOT_FOUND") {
    throw new PersistenceError(
      "MIGRATION_REQUIRED",
      "Faltan las funciones SQL de T-009. Aplica las migraciones antes de escribir.",
      {
        operation: error.operation,
        table: error.table ?? undefined,
        pgCode: error.pgCode,
        raiseCode: error.raiseCode,
      },
    );
  }
  throw error;
}

/**
 * Supabase adapter for the foundation UserRepository port.
 *
 * Verified mapping:
 * UserID -> id (canonical string), Username -> username, role -> role,
 * UUID -> uuid, GDPRConsent/GDPRConsentDate -> consent fields.
 * Email and createdAt are null because public.users has no such columns.
 */
export class SupabaseUserRepository implements UserRepository {
  constructor(
    private readonly gateway: PersistenceGateway,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async list(filter: UserListFilter): Promise<UserPage> {
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 100);
    const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);
    const filters: PersistenceFilter[] = [];
    const search = filter.search?.trim();
    if (search !== undefined && search.length > 0) {
      filters.push({ kind: "ilike", column: "Username", value: `%${search}%` });
    }
    if (filter.role !== undefined) {
      filters.push({ kind: "eq", column: "role", value: filter.role });
    }

    const result = await this.gateway.select("users", {
      columns: USER_PUBLIC_COLUMNS,
      filters,
      order: { column: "UserID", ascending: true },
      range: { from: offset, to: offset + limit - 1 },
      count: "exact",
    });

    return {
      users: result.rows.map(mapUserRow),
      total: result.count ?? 0,
    };
  }

  async findById(id: string): Promise<User | null> {
    const userId = parseUserId(id);
    if (userId === null) {
      return null;
    }
    return this.findSingle({ kind: "eq", column: "UserID", value: userId });
  }

  async findByUsername(username: string): Promise<User | null> {
    const normalized = username.trim();
    if (normalized.length === 0) {
      return null;
    }
    return this.findSingle({ kind: "eq", column: "Username", value: normalized });
  }

  async findByEmail(email: string): Promise<User | null> {
    void email;
    // public.users has no Email column. Email login must fail closed until a
    // schema migration or an explicit product mapping exists.
    return null;
  }

  async create(record: CreateUserRecord): Promise<User> {
    const username = validateUsername(record.username);
    const role = validateRole(record.role);
    const passwordHash = await this.passwordHasher.hash(record.password);
    if (!isBcryptHash(passwordHash)) {
      throw new PersistenceError(
        "PASSWORD_HASH_INVALID",
        "El hash generado no es bcrypt de 60 caracteres.",
        { operation: "create", table: "users" },
      );
    }

    let inserted: unknown | null;
    try {
      inserted = await this.gateway.insert(
        "users",
        {
          Username: username,
          PasswordHash: passwordHash,
          role,
          GDPRConsent: record.gdprConsent,
          GDPRConsentDate: record.gdprConsent
            ? new Date().toISOString()
            : null,
        },
        USER_PUBLIC_COLUMNS,
      );
    } catch (error) {
      mapWriteError(error);
    }

    if (inserted === null) {
      throw new PersistenceError(
        "QUERY_FAILED",
        "La creación del usuario no devolvió una fila.",
        { operation: "create", table: "users" },
      );
    }
    return mapUserRow(inserted);
  }

  async update(id: string, patch: UpdateUserPatch): Promise<User | null> {
    const userId = parseUserId(id);
    if (userId === null) {
      return null;
    }

    const username =
      patch.username === undefined ? null : validateUsername(patch.username);
    const role = patch.role === undefined ? null : validateRole(patch.role);
    const gdprConsent =
      patch.gdprConsent === undefined ? null : patch.gdprConsent;

    if (username === null && role === null && gdprConsent === null) {
      return this.findById(id);
    }

    let result: unknown;
    try {
      result = await this.gateway.rpc("t009_update_user", {
        p_user_id: userId,
        p_username: username,
        p_role: role,
        p_gdpr_consent: gdprConsent,
      });
    } catch (error) {
      mapWriteError(error);
    }

    const rows = Array.isArray(result)
      ? result
      : result === null || result === undefined
        ? []
        : [result];
    if (rows.length === 0 || rows[0] === null || rows[0] === undefined) {
      return null;
    }
    return mapUserRow(rows[0]);
  }

  async clearUuid(id: string): Promise<User | null> {
    const userId = parseUserId(id);
    if (userId === null) {
      return null;
    }

    let rows: readonly unknown[];
    try {
      rows = await this.gateway.update(
        "users",
        { UUID: null },
        { UserID: userId },
        USER_PUBLIC_COLUMNS,
      );
    } catch (error) {
      mapWriteError(error);
    }
    if (rows.length === 0 || rows[0] === null || rows[0] === undefined) {
      return null;
    }
    return mapUserRow(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const userId = parseUserId(id);
    if (userId === null) {
      return false;
    }

    try {
      const deleted = await this.gateway.rpc<boolean>("t009_delete_user", {
        p_user_id: userId,
      });
      return deleted === true;
    } catch (error) {
      if (isPersistenceError(error)) {
        if (
          error.code === "USER_HAS_DATA" ||
          error.code === "FOREIGN_KEY_VIOLATION"
        ) {
          throw new ConflictError(
            "USER_HAS_DATA",
            "No se puede eliminar un usuario que todavía tiene datos asociados.",
          );
        }
        if (error.code === "MIGRATION_REQUIRED" || error.code === "RPC_NOT_FOUND") {
          throw new PersistenceError(
            "MIGRATION_REQUIRED",
            "Faltan las funciones SQL de T-009. Aplica las migraciones antes de borrar.",
            { operation: error.operation, table: error.table ?? undefined },
          );
        }
      }
      throw error;
    }
  }

  async count(): Promise<number> {
    const result = await this.gateway.select("users", {
      columns: "UserID",
      count: "exact",
      head: true,
    });
    return result.count ?? 0;
  }

  private async findSingle(
    filter: PersistenceFilter,
  ): Promise<User | null> {
    const result = await this.gateway.select("users", {
      columns: USER_PUBLIC_COLUMNS,
      filters: [filter],
      limit: 1,
    });
    const row = result.rows[0];
    return row === undefined ? null : mapUserRow(row);
  }
}

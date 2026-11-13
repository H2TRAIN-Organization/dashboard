import type {
  CreateUserRecord,
  UserRepository,
} from "@/server/application/ports/user-repository";
import type { AuthIdentityAdmin } from "@/server/application/ports/auth-identity-admin";
import type { UsernameVault } from "@/server/application/ports/username-vault";
import { deriveEmailFromUsername } from "@/server/domain/username-email";
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
  /**
   * `usernameVault` es opcional para el despliegue seguro: mientras la
   * migración de MT46 no esté aplicada, el repositorio sigue leyendo la
   * columna legacy "Username". Cuando esté presente, la resolución por
   * username y el descifrado pasan por las RPCs de Vault.
   *
   * `identityAdmin` (MT49) crea la identidad GoTrue del alta admin; si está
   * presente, el alta es dos pasos (identidad + fila) con compensación.
   */
  constructor(
    private readonly gateway: PersistenceGateway,
    private readonly passwordHasher: PasswordHasher,
    private readonly usernameVault?: UsernameVault,
    private readonly identityAdmin?: AuthIdentityAdmin,
  ) {}

  async list(filter: UserListFilter): Promise<UserPage> {
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 25), 1), 100);
    const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);
    // Filters are sent before the range: PostgREST applies them and computes
    // the exact count for the same filtered set. UserID is the primary key, so
    // the ascending order is stable across pages.
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
      users: await this.fillUsernames(result.rows.map(mapUserRow)),
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
    if (this.usernameVault !== undefined) {
      const resolvedId = await this.usernameVault.resolveUserIdByUsername(
        normalized,
      );
      if (resolvedId !== null) {
        return this.findById(resolvedId);
      }
      // Sin resolución (migración pendiente o cuenta sin lookup): la columna
      // legacy "Username" sigue siendo la fuente mientras exista.
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
    const user = mapUserRow(inserted);
    if (this.identityAdmin !== undefined) {
      // MT49: identidad GoTrue con el vínculo app_metadata. Si falla, la fila
      // recién creada se elimina (un usuario sin identidad no puede iniciar
      // sesión y sería una cuenta fantasma).
      try {
        await this.identityAdmin.createIdentity({
          email: deriveEmailFromUsername(username),
          password: record.password,
          appUserId: Number(user.id),
          role,
        });
      } catch (error) {
        try {
          await this.gateway.rpc("t009_delete_user", {
            p_user_id: Number(user.id),
          });
        } catch {
          // La compensación es best-effort; el error original manda.
        }
        throw error;
      }
    }
    await this.mirrorUsername(user.id, username);
    return user;
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
    const user = mapUserRow(rows[0]);
    if (username !== null) {
      await this.mirrorUsername(user.id, username);
    }
    return user;
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
    if (row === undefined) {
      return null;
    }
    const user = mapUserRow(row);
    if (user.username.length > 0) {
      return user;
    }
    const [filled] = await this.fillUsernames([user]);
    return filled ?? user;
  }

  /**
   * Cutover MT48: cuando la columna legacy "Username" ya no se selecciona,
   * las filas llegan con username vacío y se completa cifrado vía Vault.
   * Con la columna presente no hay llamada extra (degradación sin coste).
   */
  private async fillUsernames(users: readonly User[]): Promise<User[]> {
    const missing = users.filter((user) => user.username.length === 0);
    if (this.usernameVault === undefined || missing.length === 0) {
      return [...users];
    }
    const names = await this.usernameVault.displayNames(
      missing.map((user) => user.id),
    );
    return users.map((user) =>
      user.username.length === 0
        ? { ...user, username: names.get(user.id) ?? "" }
        : user,
    );
  }

  /**
   * Mejor esfuerzo de transición: si la migración de MT46 no está aplicada,
   * el espejo cifrado no existe y la columna legacy sigue siendo la fuente.
   * Los demás errores (p. ej. lookup duplicado) se propagan y fallan cerrado.
   */
  private async mirrorUsername(userId: string, username: string): Promise<void> {
    if (this.usernameVault === undefined) {
      return;
    }
    await this.usernameVault.mirrorUsername(userId, username);
  }
}

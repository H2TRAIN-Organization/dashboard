import {
  canListUser,
  canReadAllUsers,
  canWriteUsers,
} from "@/server/domain/access-policy";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/server/domain/errors";
import {
  USERNAME_MAX_LENGTH,
  type ActiveActor,
  type UpdateUserPatch,
  type User,
  type UserListFilter,
  type UserPage,
  type UserRole,
} from "@/server/domain/user";
import type {
  CreateUserRecord,
  UserDataPresence,
  UserRepository,
} from "../ports/user-repository";

export interface CreateUserCommand {
  readonly username: string;
  readonly role: UserRole;
  readonly gdprConsent: boolean;
  readonly password: string;
}

export interface UserUseCases {
  list(actor: ActiveActor, filter: UserListFilter): Promise<UserPage>;
  get(actor: ActiveActor, id: string): Promise<User>;
  create(actor: ActiveActor, command: CreateUserCommand): Promise<User>;
  update(actor: ActiveActor, id: string, patch: UpdateUserPatch): Promise<User>;
  clearUuid(actor: ActiveActor, id: string): Promise<User>;
  delete(actor: ActiveActor, id: string): Promise<void>;
  count(actor: ActiveActor): Promise<number>;
}

function assertAdmin(actor: ActiveActor): void {
  if (!canWriteUsers(actor)) {
    throw new ForbiddenError("Solo un administrador puede modificar usuarios");
  }
}

export function createUserUseCases(
  users: UserRepository,
  dataPresence: UserDataPresence,
): UserUseCases {
  return {
    async list(actor: ActiveActor, filter: UserListFilter): Promise<UserPage> {
      if (canReadAllUsers(actor)) {
        return users.list(filter);
      }

      const self = await users.findById(actor.userId);
      if (self === null) {
        throw new UnauthorizedError("La cuenta de la sesión ya no existe");
      }

      const search = filter.search?.toLocaleLowerCase();
      const matchesSearch =
        search === undefined || self.username.toLocaleLowerCase().includes(search);
      const matchesRole = filter.role === undefined || self.role === filter.role;

      return {
        users: matchesSearch && matchesRole ? [self] : [],
        total: matchesSearch && matchesRole ? 1 : 0,
      };
    },

    async get(actor: ActiveActor, id: string): Promise<User> {
      if (!canListUser(actor, id)) {
        throw new ForbiddenError("No puedes consultar otro usuario");
      }
      const user = await users.findById(id);
      if (user === null) {
        throw new NotFoundError("Usuario no encontrado");
      }
      return user;
    },

    async create(actor: ActiveActor, command: CreateUserCommand): Promise<User> {
      assertAdmin(actor);
      const username = command.username.trim();
      if (username.length === 0) {
        throw new ValidationError("El nombre de usuario es obligatorio");
      }
      if (username.length > USERNAME_MAX_LENGTH) {
        throw new ValidationError(
          `El nombre de usuario no puede superar ${USERNAME_MAX_LENGTH} caracteres`,
        );
      }
      if (command.password.length === 0) {
        throw new ValidationError("La contraseña es obligatoria");
      }

      const record: CreateUserRecord = {
        username,
        role: command.role,
        gdprConsent: command.gdprConsent,
        password: command.password,
      };
      return users.create(record);
    },

    async update(actor: ActiveActor, id: string, patch: UpdateUserPatch): Promise<User> {
      assertAdmin(actor);

      const username = patch.username?.trim();
      if (username !== undefined) {
        if (username.length === 0) {
          throw new ValidationError("El nombre de usuario es obligatorio");
        }
        if (username.length > USERNAME_MAX_LENGTH) {
          throw new ValidationError(
            `El nombre de usuario no puede superar ${USERNAME_MAX_LENGTH} caracteres`,
          );
        }
      }

      // Only explicitly supported fields are forwarded; an incoming email is
      // never persisted or used to create a new identity.
      const safePatch: UpdateUserPatch = {
        ...(username === undefined ? {} : { username }),
        ...(patch.role === undefined ? {} : { role: patch.role }),
        ...(patch.gdprConsent === undefined
          ? {}
          : { gdprConsent: patch.gdprConsent }),
      };
      if (Object.keys(safePatch).length === 0) {
        throw new ValidationError("No hay campos que actualizar");
      }
      const updated = await users.update(id, safePatch);
      if (updated === null) {
        throw new NotFoundError("Usuario no encontrado");
      }
      return updated;
    },

    async clearUuid(actor: ActiveActor, id: string): Promise<User> {
      assertAdmin(actor);
      const cleared = await users.clearUuid(id);
      if (cleared === null) {
        throw new NotFoundError("Usuario no encontrado");
      }
      return cleared;
    },

    async delete(actor: ActiveActor, id: string): Promise<void> {
      assertAdmin(actor);
      const user = await users.findById(id);
      if (user === null) {
        throw new NotFoundError("Usuario no encontrado");
      }

      if (await dataPresence.hasAnyForUser(user)) {
        throw new ConflictError(
          "USER_HAS_DATA",
          "No se puede eliminar un usuario que todavía tiene datos asociados",
        );
      }

      const deleted = await users.delete(id);
      if (!deleted) {
        throw new NotFoundError("Usuario no encontrado");
      }
    },

    async count(actor: ActiveActor): Promise<number> {
      if (canReadAllUsers(actor)) {
        return users.count();
      }
      return 1;
    },
  };
}

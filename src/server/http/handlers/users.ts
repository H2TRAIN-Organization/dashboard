import type { AuthUseCases } from "@/server/application/auth/auth-use-cases";
import type { UserUseCases } from "@/server/application/users/user-use-cases";
import type { UpdateUserPatch } from "@/server/domain/user";
import { handle, jsonResult, parseInput, type HttpResult } from "../problem";
import { requireActor } from "./auth";
import {
  createUserBodySchema,
  updateUserBodySchema,
  userListQuerySchema,
  userIdSchema,
} from "../schemas/users";

export interface UsersHttpHandlers {
  list(input: {
    sessionToken: string | undefined;
    query: unknown;
  }): Promise<HttpResult>;
  create(input: {
    sessionToken: string | undefined;
    body: unknown;
  }): Promise<HttpResult>;
  get(input: {
    sessionToken: string | undefined;
    id: string;
  }): Promise<HttpResult>;
  update(input: {
    sessionToken: string | undefined;
    id: string;
    body: unknown;
  }): Promise<HttpResult>;
  clearUuid(input: {
    sessionToken: string | undefined;
    id: string;
  }): Promise<HttpResult>;
  delete(input: {
    sessionToken: string | undefined;
    id: string;
  }): Promise<HttpResult>;
  count(input: {
    sessionToken: string | undefined;
  }): Promise<HttpResult>;
}

export function createUsersHttpHandlers(
  auth: AuthUseCases,
  users: UserUseCases,
): UsersHttpHandlers {
  return {
    async list(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.sessionToken);
        const query = parseInput(userListQuerySchema, input.query);
        const page = await users.list(actor, query);
        return jsonResult(200, page);
      });
    },

    async create(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.sessionToken);
        const body = parseInput(createUserBodySchema, input.body);
        const user = await users.create(actor, {
          username: body.username,
          password: body.password,
          role: body.role,
          gdprConsent: body.gdprConsent,
        });
        return jsonResult(201, { user });
      });
    },

    async get(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.sessionToken);
        const id = parseInput(userIdSchema, input.id);
        const user = await users.get(actor, id);
        return jsonResult(200, { user });
      });
    },

    async update(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.sessionToken);
        const id = parseInput(userIdSchema, input.id);
        const body = parseInput(updateUserBodySchema, input.body);
        const patch: UpdateUserPatch = {
          ...(body.username === undefined ? {} : { username: body.username }),
          ...(body.role === undefined ? {} : { role: body.role }),
          ...(body.gdprConsent === undefined
            ? {}
            : { gdprConsent: body.gdprConsent }),
        };

        // `email: null` is an accepted compatibility no-op, never a persisted
        // identity update. Email remains owned by the authentication layer.
        if (Object.keys(patch).length === 0) {
          const user = await users.get(actor, id);
          return jsonResult(200, { user });
        }

        const user = await users.update(actor, id, patch);
        return jsonResult(200, { user });
      });
    },

    async clearUuid(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.sessionToken);
        const id = parseInput(userIdSchema, input.id);
        const user = await users.clearUuid(actor, id);
        return jsonResult(200, { user });
      });
    },

    async delete(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.sessionToken);
        const id = parseInput(userIdSchema, input.id);
        await users.delete(actor, id);
        return jsonResult(204);
      });
    },

    async count(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.sessionToken);
        const count = await users.count(actor);
        return jsonResult(200, { count });
      });
    },
  };
}

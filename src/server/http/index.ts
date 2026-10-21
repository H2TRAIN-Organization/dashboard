import type { AuthUseCases } from "@/server/application/auth/auth-use-cases";
import type { AdminDatabaseUseCases } from "@/server/application/admin/admin-database-use-cases";
import type { DataUseCases } from "@/server/application/data/data-use-cases";
import type { UserUseCases } from "@/server/application/users/user-use-cases";
import {
  createAdminDatabaseHttpHandlers,
  type AdminDatabaseHttpHandlers,
} from "./handlers/admin-database";
import { createAuthHttpHandlers, type AuthHttpHandlers } from "./handlers/auth";
import { createDataHttpHandlers, type DataHttpHandlers } from "./handlers/data";
import { createUsersHttpHandlers, type UsersHttpHandlers } from "./handlers/users";

export interface HttpApi {
  readonly auth: AuthHttpHandlers;
  readonly users: UsersHttpHandlers;
  readonly data: DataHttpHandlers;
  readonly adminDatabase: AdminDatabaseHttpHandlers;
}

export interface HttpApiDependencies {
  readonly auth: AuthUseCases;
  readonly users: UserUseCases;
  readonly data: DataUseCases;
  readonly adminDatabase: AdminDatabaseUseCases;
}

export interface HttpApiConfig {
  readonly secureCookies: boolean;
}

export function createHttpApi(
  dependencies: HttpApiDependencies,
  config: HttpApiConfig = { secureCookies: false },
): HttpApi {
  return {
    auth: createAuthHttpHandlers(dependencies.auth, config),
    users: createUsersHttpHandlers(dependencies.auth, dependencies.users),
    data: createDataHttpHandlers(dependencies.auth, dependencies.data),
    adminDatabase: createAdminDatabaseHttpHandlers(
      dependencies.auth,
      dependencies.adminDatabase,
    ),
  };
}

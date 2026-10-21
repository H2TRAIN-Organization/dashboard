import "server-only";

import type { AdminDatabaseRepository } from "@/server/application/ports/admin-database-repository";
import type { AuthGateway } from "@/server/application/ports/auth-gateway";
import type { Clock } from "@/server/application/ports/clock";
import { systemClock } from "@/server/application/ports/clock";
import type { HealthDataRepository } from "@/server/application/ports/health-data-repository";
import type {
  UserDataPresence,
  UserRepository,
} from "@/server/application/ports/user-repository";
import { createAdminDatabaseUseCases } from "@/server/application/admin/admin-database-use-cases";
import { createAuthUseCases } from "@/server/application/auth/auth-use-cases";
import { createDataUseCases } from "@/server/application/data/data-use-cases";
import { createUserUseCases } from "@/server/application/users/user-use-cases";
import { createHttpApi, type HttpApi } from "@/server/http";

/**
 * Explicit dependencies only. There are no default repositories and no lazy
 * fallback to a remote project: a deployment must provide real adapters after
 * the database schema and legacy credential format have been verified.
 */
export interface ServerDependencies {
  readonly auth: AuthGateway;
  readonly users: UserRepository;
  readonly userDataPresence: UserDataPresence;
  readonly healthData: HealthDataRepository;
  readonly adminDatabase: AdminDatabaseRepository;
  readonly clock?: Clock;
}

export interface ServerApplication {
  readonly http: HttpApi;
  readonly useCases: {
    readonly auth: ReturnType<typeof createAuthUseCases>;
    readonly users: ReturnType<typeof createUserUseCases>;
    readonly data: ReturnType<typeof createDataUseCases>;
    readonly adminDatabase: ReturnType<typeof createAdminDatabaseUseCases>;
  };
}

export function composeServerApplication(
  dependencies: ServerDependencies,
): ServerApplication {
  const clock = dependencies.clock ?? systemClock;
  const useCases = {
    auth: createAuthUseCases(dependencies.auth),
    users: createUserUseCases(dependencies.users, dependencies.userDataPresence),
    data: createDataUseCases(dependencies.healthData, clock),
    adminDatabase: createAdminDatabaseUseCases(dependencies.adminDatabase),
  };

  return {
    useCases,
    http: createHttpApi(useCases, {
      secureCookies: process.env.NODE_ENV === "production",
    }),
  };
}

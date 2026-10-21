import "server-only";

import bcrypt from "bcryptjs";

import { ServiceUnavailableError } from "@/server/domain/errors";
import type { BcryptLibrary } from "@/server/infrastructure/auth/bcrypt-password-verifier";
import {
  createBcryptPasswordHasher,
  createSupabasePersistenceFromEnvironment,
  type BcryptLike,
  type PasswordHasher,
  type SupabasePersistence,
} from "@/server/infrastructure/persistence";
import {
  createAuthRuntime,
  type AuthRuntime,
  type AuthRuntimeOptions,
} from "@/server/runtime/auth-runtime";
import {
  composeServerApplication,
  type ServerApplication,
  type ServerDependencies,
} from "./container";

export type ProductionBcrypt = BcryptLibrary & BcryptLike;

export type ProductionAuthFactory = (
  options: Pick<AuthRuntimeOptions, "bcrypt" | "environment">,
) => AuthRuntime;

export type ProductionPersistenceFactory = (options: {
  readonly passwordHasher: PasswordHasher;
  readonly environment: NodeJS.ProcessEnv;
}) => SupabasePersistence;

export type ProductionCompose = (
  dependencies: ServerDependencies,
) => ServerApplication;

export interface ProductionRuntimeOptions {
  readonly environment?: NodeJS.ProcessEnv;
  /** Defaults to the official bcryptjs module already in package.json. */
  readonly bcrypt?: ProductionBcrypt;
  /** Test seam: defaults to the real auth runtime factory. */
  readonly createAuth?: ProductionAuthFactory;
  /** Test seam: defaults to the real Supabase persistence factory. */
  readonly createPersistence?: ProductionPersistenceFactory;
  /** Test seam: defaults to composeServerApplication. */
  readonly compose?: ProductionCompose;
}

/**
 * Converts any construction failure into a sanitized 503. Auth configuration
 * errors are already safe ServiceUnavailableError instances; persistence,
 * crypto and unexpected errors are deliberately replaced with a generic
 * message so no key, URL, row or credential can reach the HTTP layer.
 */
export function toRuntimeUnavailableError(
  error: unknown,
): ServiceUnavailableError {
  if (error instanceof ServiceUnavailableError) {
    return error;
  }
  return new ServiceUnavailableError(
    "El runtime del backend no está disponible",
  );
}

/**
 * Real production composition root. It validates and wires the official
 * auth/persistence factories only; it never runs DDL, migrations, fixtures or
 * remote queries. Building this application does not prove the SQL migrations
 * are applied: a missing migration fails later at request time.
 */
export function createProductionServerRuntime(
  options: ProductionRuntimeOptions = {},
): ServerApplication {
  try {
    const environment = options.environment ?? process.env;
    const bcryptModule = options.bcrypt ?? bcrypt;

    const auth = (options.createAuth ?? createAuthRuntime)({
      bcrypt: bcryptModule,
      environment,
    });
    const passwordHasher = createBcryptPasswordHasher(bcryptModule);
    const persistence = (
      options.createPersistence ?? createSupabasePersistenceFromEnvironment
    )({
      passwordHasher,
      environment,
    });

    return (options.compose ?? composeServerApplication)({
      auth: auth.gateway,
      users: persistence.users,
      userDataPresence: persistence.userDataPresence,
      healthData: persistence.healthData,
      adminDatabase: persistence.adminDatabase,
    });
  } catch (error) {
    throw toRuntimeUnavailableError(error);
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminDatabaseRepository } from "@/server/application/ports/admin-database-repository";
import type { HealthDataRepository } from "@/server/application/ports/health-data-repository";
import type {
  UserDataPresence,
  UserRepository,
} from "@/server/application/ports/user-repository";
import {
  Aes256CbcDecryptor,
  readEncryptionKeyConfig,
  type EncryptionKeyConfig,
  type TextDecryptor,
} from "@/server/infrastructure/crypto";

import { SupabaseAdminDatabaseRepository } from "./admin/supabase-admin-database-repository";
import {
  readSupabasePersistenceConfig,
  type SupabasePersistenceConfig,
} from "./config";
import { SupabaseHealthDataRepository } from "./health/health-data-repository";
import { createPostgrestGateway } from "./supabase/postgrest-gateway";
import { createSupabaseAdminClient } from "./supabase/client";
import { SupabaseUserDataPresence } from "./user/user-data-presence";
import {
  SupabaseUserCredentialsRepository,
  type UserCredentialsRepository,
} from "./user/user-credentials-repository";
import {
  SupabaseUserRepository,
} from "./user/supabase-user-repository";
import type { PasswordHasher } from "./user/password-hasher";

export interface SupabasePersistence {
  readonly client: SupabaseClient;
  readonly users: UserRepository;
  readonly userDataPresence: UserDataPresence;
  readonly healthData: HealthDataRepository;
  readonly adminDatabase: AdminDatabaseRepository;
  readonly credentials: UserCredentialsRepository;
  readonly decryptor: TextDecryptor;
}

export interface SupabasePersistenceOptions extends SupabasePersistenceConfig {
  readonly encryption: EncryptionKeyConfig;
  readonly passwordHasher: PasswordHasher;
  readonly pageSize?: number;
}

export interface SupabasePersistenceEnvironmentOptions {
  readonly passwordHasher: PasswordHasher;
  readonly environment?: NodeJS.ProcessEnv;
  readonly pageSize?: number;
}

export interface SupabasePersistenceWithClientOptions {
  readonly client: SupabaseClient;
  readonly encryption: EncryptionKeyConfig;
  readonly passwordHasher: PasswordHasher;
  readonly pageSize?: number;
}

/**
 * Composition helper with an already-created official Supabase client. Useful
 * for integration tests and for a composition root that already owns a client.
 */
export function createPersistenceWithClient(
  options: SupabasePersistenceWithClientOptions,
): SupabasePersistence {
  const decryptor = new Aes256CbcDecryptor(options.encryption);
  const gateway = createPostgrestGateway(options.client);
  return {
    client: options.client,
    users: new SupabaseUserRepository(gateway, options.passwordHasher),
    userDataPresence: new SupabaseUserDataPresence(gateway),
    healthData: new SupabaseHealthDataRepository(gateway, decryptor, {
      pageSize: options.pageSize,
    }),
    adminDatabase: new SupabaseAdminDatabaseRepository(gateway, decryptor),
    credentials: new SupabaseUserCredentialsRepository(
      gateway,
      options.passwordHasher,
    ),
    decryptor,
  };
}

/**
 * Exact factory for the composition root. It validates that the credential is
 * service_role and that encryption keys are 64 hex characters before creating
 * any client.
 */
export function createSupabasePersistence(
  options: SupabasePersistenceOptions,
): SupabasePersistence {
  const client = createSupabaseAdminClient({
    url: options.url,
    serviceRoleKey: options.serviceRoleKey,
  });
  return createPersistenceWithClient({
    client,
    encryption: options.encryption,
    passwordHasher: options.passwordHasher,
    pageSize: options.pageSize,
  });
}

/**
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY,
 * ENCRYPTION_SECRET_KEY and ENCRYPTION_SECRET_KEY0 from the server
 * environment. `SUPABASE_SECRET_KEY` is only accepted if it carries
 * role=service_role.
 */
export function createSupabasePersistenceFromEnvironment(
  options: SupabasePersistenceEnvironmentOptions,
): SupabasePersistence {
  const environment = options.environment ?? process.env;
  const config = readSupabasePersistenceConfig(environment);
  const encryption = readEncryptionKeyConfig(environment);
  return createSupabasePersistence({
    ...config,
    encryption,
    passwordHasher: options.passwordHasher,
    pageSize: options.pageSize,
  });
}

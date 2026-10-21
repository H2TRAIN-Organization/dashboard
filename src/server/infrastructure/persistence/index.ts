export {
  SupabaseAdminDatabaseRepository,
} from "./admin/supabase-admin-database-repository";
export {
  readSupabasePersistenceConfig,
  isServiceRoleCredential,
  type SupabasePersistenceConfig,
} from "./config";
export {
  createPersistenceWithClient,
  createSupabasePersistence,
  createSupabasePersistenceFromEnvironment,
  type SupabasePersistence,
  type SupabasePersistenceEnvironmentOptions,
  type SupabasePersistenceOptions,
  type SupabasePersistenceWithClientOptions,
} from "./create-supabase-persistence";
export {
  isPersistenceError,
  PersistenceError,
  persistenceErrorFromDatabase,
  type PersistenceErrorCode,
} from "./errors";
export {
  DECRYPTED_HEALTH_TABLES,
  HEALTH_TABLES,
  isDecryptedHealthTable,
  isHealthTable,
  mapHealthRecord,
  type DecryptedHealthTable,
  type HealthTable,
} from "./health/health-record-mapper";
export {
  SupabaseHealthDataRepository,
  type HealthDataRepositoryOptions,
} from "./health/health-data-repository";
export {
  createPostgrestGateway,
} from "./supabase/postgrest-gateway";
export {
  type PersistenceFilter,
  type PersistenceGateway,
  type SelectRequest,
  type SelectResult,
} from "./supabase/query-types";
export {
  createBcryptPasswordHasher,
  isBcryptHash,
  type BcryptLike,
  type PasswordHasher,
} from "./user/password-hasher";
export {
  SupabaseUserCredentialsRepository,
  type UserCredentialRecord,
  type UserCredentialsRepository,
} from "./user/user-credentials-repository";
export { SupabaseUserDataPresence } from "./user/user-data-presence";
export { SupabaseUserRepository } from "./user/supabase-user-repository";
export {
  mapUserAdminRow,
  mapUserRow,
  normalizeRole,
  USER_ADMIN_COLUMNS,
  USER_PUBLIC_COLUMNS,
} from "./user/user-mapper";

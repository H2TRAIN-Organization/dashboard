import type {
  DecryptedData,
  LegacyData,
  LegacyDataQuery,
  ResolvedDataQuery,
} from "@/server/domain/health-data";

/**
 * Decryption and table access belong to a future infrastructure adapter once
 * the remote schema and key format are confirmed. The application layer only
 * sees already-decrypted, public health records.
 *
 * Stable window contract: `from` is inclusive (or null), `to` is exclusive.
 * `recordKeys` is already resolved by the application layer: an empty set means
 * all users (privileged only); any value is a server-resolved `username` value
 * (canonical username or `auth_<uid>` alias).
 */
export interface HealthDataRepository {
  getDecryptedData(query: ResolvedDataQuery): Promise<DecryptedData>;
  getLegacyData(query: LegacyDataQuery): Promise<LegacyData>;
}

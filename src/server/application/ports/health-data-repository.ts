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
 * `selectedUser` is already normalized by the application layer.
 */
export interface HealthDataRepository {
  getDecryptedData(query: ResolvedDataQuery): Promise<DecryptedData>;
  getLegacyData(query: LegacyDataQuery): Promise<LegacyData>;
}

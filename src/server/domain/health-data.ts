export const DATA_TYPES = [
  "all",
  "insulin",
  "food",
  "exercise",
  "period",
  "mood",
] as const;

export type DataType = (typeof DATA_TYPES)[number];

export const TIME_RANGES = ["7d", "30d", "90d", "365d", "all"] as const;

export type TimeRange = (typeof TIME_RANGES)[number];

export const LEGACY_DATA_TYPES = [
  "all",
  "exercise",
  "mood",
  "insulin",
  "meal",
] as const;

export type LegacyDataType = (typeof LEGACY_DATA_TYPES)[number];

/**
 * Database records are intentionally open at the domain boundary until the
 * remote schema and its encrypted field format have been inspected. The HTTP
 * contract documents the stable, decrypted fields per collection.
 */
export type HealthRecord = Record<string, unknown>;

export interface DecryptedData {
  readonly insulinData: readonly HealthRecord[];
  readonly foodData: readonly HealthRecord[];
  readonly exerciseData: readonly HealthRecord[];
  readonly periodData: readonly HealthRecord[];
  readonly moodData: readonly HealthRecord[];
}

export interface LegacyData {
  readonly exercise: readonly HealthRecord[];
  readonly mood: readonly HealthRecord[];
  readonly insulin: readonly HealthRecord[];
  readonly meal: readonly HealthRecord[];
}

export interface DataQuery {
  readonly selectedUser: string;
  readonly timeRange: TimeRange;
  readonly selectedDataType: DataType;
  readonly dateFilter: string | null;
  /** Explicit from day (YYYY-MM-DD, UTC, inclusive). Non-null overrides timeRange. */
  readonly dateFrom: string | null;
  /** Explicit to day (YYYY-MM-DD, UTC, inclusive end). Non-null overrides timeRange. */
  readonly dateTo: string | null;
}

export interface ResolvedDataQuery extends Omit<DataQuery, "selectedUser"> {
  /**
   * Every `username` value in the health tables that belongs to the requested
   * account: the canonical users.Username plus any alias resolved server-side.
   * Empty means every user and is only produced for privileged roles.
   */
  readonly recordKeys: readonly string[];
  /** Inclusive lower bound, ISO-8601, or null for no lower bound. */
  readonly from: string | null;
  /** Exclusive upper bound, ISO-8601. Repositories must use `< to`. */
  readonly to: string;
}

export interface LegacyDataQuery {
  readonly type: LegacyDataType;
  readonly rangeDays: number;
  /**
   * Same contract as ResolvedDataQuery.recordKeys: server-resolved username
   * values owned by the requested account. Empty means every user (only
   * reachable by admin/doctor).
   */
  readonly recordKeys: readonly string[];
  /** Inclusive lower bound, ISO-8601. */
  readonly from: string;
  /** Inclusive upper bound, ISO-8601. */
  readonly to: string;
}

export function daysForTimeRange(range: TimeRange): number | null {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "365d":
      return 365;
    case "all":
      return null;
  }
}

/**
 * Alias record keys. External producers (the mobile app) key health rows with
 * `auth_<supabase-uid>` instead of the canonical users.Username. The dashboard
 * never writes this format; it only resolves it server-side from verified
 * Supabase Auth identities.
 */
export const AUTH_RECORD_KEY_PREFIX = "auth_";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function buildAuthAliasRecordKey(authUserId: string): string {
  return `${AUTH_RECORD_KEY_PREFIX}${authUserId}`;
}

/**
 * True only for exact `auth_<uuid>` values. Never accept a user-supplied value
 * through this parser: it is a helper for server-side resolution.
 */
export function parseAuthAliasRecordKey(value: string): string | null {
  if (!value.startsWith(AUTH_RECORD_KEY_PREFIX)) {
    return null;
  }
  const uuid = value.slice(AUTH_RECORD_KEY_PREFIX.length);
  return isUuidString(uuid) ? uuid : null;
}

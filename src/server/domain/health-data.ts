export const DATA_TYPES = [
  "all",
  "insulin",
  "food",
  "exercise",
  "period",
  "mood",
] as const;

export type DataType = (typeof DATA_TYPES)[number];

export const TIME_RANGES = ["7d", "30d", "90d", "all"] as const;

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
}

export interface ResolvedDataQuery extends DataQuery {
  /** Inclusive lower bound, ISO-8601, or null for no lower bound. */
  readonly from: string | null;
  /** Inclusive upper bound, ISO-8601. */
  readonly to: string;
}

export interface LegacyDataQuery {
  readonly type: LegacyDataType;
  readonly rangeDays: number;
  /** null means every user (only reachable by admin/doctor). */
  readonly selectedUser: string | null;
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
    case "all":
      return null;
  }
}

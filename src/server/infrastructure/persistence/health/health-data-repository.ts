import type { HealthDataRepository } from "@/server/application/ports/health-data-repository";
import type {
  DataType,
  DecryptedData,
  HealthRecord,
  LegacyData,
  LegacyDataQuery,
  ResolvedDataQuery,
} from "@/server/domain/health-data";

import type { TextDecryptor } from "@/server/infrastructure/crypto";

import type {
  PersistenceFilter,
  PersistenceGateway,
} from "../supabase/query-types";
import {
  DECRYPTED_HEALTH_TABLES,
  mapHealthRecord,
  type DecryptedHealthTable,
} from "./health-record-mapper";

const DATA_TYPE_TABLE: Record<Exclude<DataType, "all">, DecryptedHealthTable> = {
  insulin: "insulindata",
  food: "fooddata",
  exercise: "exercisedata",
  period: "periodrecords",
  mood: "mooddata",
};

const DATE_COLUMN: Record<DecryptedHealthTable, string> = {
  insulindata: "date_time",
  fooddata: "date_time",
  exercisedata: "date_time",
  periodrecords: "startDate",
  mooddata: "date_time",
};

const EMPTY_DECRYPTED: DecryptedData = {
  insulinData: [],
  foodData: [],
  exerciseData: [],
  periodData: [],
  moodData: [],
};

const EMPTY_LEGACY: LegacyData = {
  exercise: [],
  mood: [],
  insulin: [],
  meal: [],
};

export interface HealthDataRepositoryOptions {
  /** Supabase/PostgREST page size. Defaults to the server maximum of 1000. */
  readonly pageSize?: number;
}

interface TableQuery {
  readonly selectedUser: string | null;
  readonly from: string | null;
  readonly to: string;
}

function clampPageSize(value: number | undefined): number {
  const pageSize = Math.trunc(value ?? 1000);
  if (!Number.isFinite(pageSize) || pageSize < 1) {
    return 1000;
  }
  return Math.min(pageSize, 1000);
}

/**
 * Reads all matching rows with deterministic range pagination ordered by `id
 * ASC`. A single PostgREST response is capped at 1000 rows, so the repository
 * explicitly pages until a short page is returned.
 */
export class SupabaseHealthDataRepository implements HealthDataRepository {
  private readonly pageSize: number;

  constructor(
    private readonly gateway: PersistenceGateway,
    private readonly decryptor: TextDecryptor,
    options: HealthDataRepositoryOptions = {},
  ) {
    this.pageSize = clampPageSize(options.pageSize);
  }

  async getDecryptedData(query: ResolvedDataQuery): Promise<DecryptedData> {
    if (query.selectedDataType === "all") {
      const entries = await Promise.all(
        DECRYPTED_HEALTH_TABLES.map(async (table) => [
          table,
          await this.fetchTable(table, query, true),
        ] as const),
      );
      const byTable = new Map(entries);
      return {
        insulinData: byTable.get("insulindata") ?? [],
        foodData: byTable.get("fooddata") ?? [],
        exerciseData: byTable.get("exercisedata") ?? [],
        periodData: byTable.get("periodrecords") ?? [],
        moodData: byTable.get("mooddata") ?? [],
      };
    }

    const table = DATA_TYPE_TABLE[query.selectedDataType];
    const rows = await this.fetchTable(table, query, true);
    return {
      ...EMPTY_DECRYPTED,
      ...(table === "insulindata" ? { insulinData: rows } : {}),
      ...(table === "fooddata" ? { foodData: rows } : {}),
      ...(table === "exercisedata" ? { exerciseData: rows } : {}),
      ...(table === "periodrecords" ? { periodData: rows } : {}),
      ...(table === "mooddata" ? { moodData: rows } : {}),
    };
  }

  async getLegacyData(query: LegacyDataQuery): Promise<LegacyData> {
    const tableQuery: TableQuery = {
      selectedUser:
        query.selectedUser === "all" ? null : query.selectedUser,
      from: query.from,
      to: query.to,
    };

    const wanted = new Set<string>();
    if (query.type === "all") {
      wanted.add("exercise");
      wanted.add("mood");
      wanted.add("insulin");
      wanted.add("meal");
    } else {
      wanted.add(query.type);
    }

    const [exercise, mood, insulin, meal] = await Promise.all([
      wanted.has("exercise")
        ? this.fetchTable("exercisedata", tableQuery, false)
        : Promise.resolve([]),
      wanted.has("mood")
        ? this.fetchTable("mooddata", tableQuery, false)
        : Promise.resolve([]),
      wanted.has("insulin")
        ? this.fetchTable("insulindata", tableQuery, false)
        : Promise.resolve([]),
      wanted.has("meal")
        ? this.fetchTable("fooddata", tableQuery, false)
        : Promise.resolve([]),
    ]);

    return {
      ...EMPTY_LEGACY,
      exercise,
      mood,
      insulin,
      meal,
    };
  }

  private async fetchTable(
    table: DecryptedHealthTable,
    query: TableQuery,
    toExclusive: boolean,
  ): Promise<readonly HealthRecord[]> {
    const filters: PersistenceFilter[] = [];
    if (query.selectedUser !== null && query.selectedUser !== "all") {
      filters.push({ kind: "eq", column: "username", value: query.selectedUser });
    }
    if (query.from !== null && query.from.length > 0) {
      filters.push({ kind: "gte", column: DATE_COLUMN[table], value: query.from });
    }
    if (query.to.length > 0) {
      filters.push({
        kind: toExclusive ? "lt" : "lte",
        column: DATE_COLUMN[table],
        value: query.to,
      });
    }

    const rows: unknown[] = [];
    for (let offset = 0; ; offset += this.pageSize) {
      const result = await this.gateway.select(table, {
        columns: "*",
        filters,
        order: { column: "id", ascending: true },
        range: { from: offset, to: offset + this.pageSize - 1 },
      });
      rows.push(...result.rows);
      if (result.rows.length < this.pageSize) {
        break;
      }
    }

    return rows.map((row) => mapHealthRecord(table, row, this.decryptor));
  }
}

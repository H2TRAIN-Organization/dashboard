import type { HealthDataRepository } from "@/server/application/ports/health-data-repository";
import type {
  DataType,
  DecryptedData,
  HealthRecord,
  LegacyData,
  LegacyDataQuery,
  ResolvedDataQuery,
} from "@/server/domain/health-data";

/** Test-only adapter with deterministic data and no encryption. */
export class InMemoryHealthDataRepository implements HealthDataRepository {
  lastDecryptedQuery: ResolvedDataQuery | null = null;
  lastLegacyQuery: LegacyDataQuery | null = null;

  constructor(
    private readonly data: DecryptedData = {
      insulinData: [],
      foodData: [],
      exerciseData: [],
      periodData: [],
      moodData: [],
    },
    private readonly legacyData: LegacyData = {
      exercise: [],
      mood: [],
      insulin: [],
      meal: [],
    },
  ) {}

  async getDecryptedData(query: ResolvedDataQuery): Promise<DecryptedData> {
    this.lastDecryptedQuery = query;
    if (query.selectedDataType === "all") {
      return this.data;
    }
    return selectDataType(this.data, query.selectedDataType);
  }

  async getLegacyData(query: LegacyDataQuery): Promise<LegacyData> {
    this.lastLegacyQuery = query;
    return this.legacyData;
  }
}

function selectDataType(data: DecryptedData, type: Exclude<DataType, "all">): DecryptedData {
  const empty: HealthRecord[] = [];
  return {
    insulinData: type === "insulin" ? data.insulinData : empty,
    foodData: type === "food" ? data.foodData : empty,
    exerciseData: type === "exercise" ? data.exerciseData : empty,
    periodData: type === "period" ? data.periodData : empty,
    moodData: type === "mood" ? data.moodData : empty,
  };
}

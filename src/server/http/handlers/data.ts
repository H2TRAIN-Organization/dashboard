import type { AuthUseCases } from "@/server/application/auth/auth-use-cases";
import type { DataUseCases } from "@/server/application/data/data-use-cases";
import type { LegacyData } from "@/server/domain/health-data";
import { handle, jsonResult, parseInput, type HttpResult } from "../problem";
import { decryptedDataQuerySchema, legacyDataQuerySchema } from "../schemas/data";
import { requireActor } from "./auth";

export interface DataHttpHandlers {
  decrypted(input: {
    authorization: string | undefined;
    query: unknown;
  }): Promise<HttpResult>;
  legacy(input: {
    authorization: string | undefined;
    query: unknown;
  }): Promise<HttpResult>;
}

function legacySelection(data: LegacyData, type: string): readonly unknown[] | LegacyData {
  switch (type) {
    case "exercise":
      return data.exercise;
    case "mood":
      return data.mood;
    case "insulin":
      return data.insulin;
    case "meal":
      return data.meal;
    default:
      return data;
  }
}

export function createDataHttpHandlers(
  auth: AuthUseCases,
  dataUseCases: DataUseCases,
): DataHttpHandlers {
  return {
    async decrypted(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.authorization);
        const query = parseInput(decryptedDataQuerySchema, input.query);
        const data = await dataUseCases.getDecryptedData(actor, {
          selectedUser: query.selectedUser,
          timeRange: query.timeRange,
          selectedDataType: query.selectedDataType,
          dateFilter: query.dateFilter ?? null,
        });

        return jsonResult(200, {
          insulinData: data.insulinData,
          foodData: data.foodData,
          exerciseData: data.exerciseData,
          periodData: data.periodData,
          moodData: data.moodData,
        });
      });
    },

    async legacy(input): Promise<HttpResult> {
      return handle(async () => {
        const actor = await requireActor(auth, input.authorization);
        const query = parseInput(legacyDataQuerySchema, input.query);
        const data = await dataUseCases.getLegacyData(actor, {
          type: query.type,
          rangeDays: query.range,
        });
        return jsonResult(200, legacySelection(data, query.type));
      });
    },
  };
}

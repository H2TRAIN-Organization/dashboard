import {
  canReadHealthDataFor,
  canReadAllHealthData,
} from "@/server/domain/access-policy";
import { ForbiddenError, ValidationError } from "@/server/domain/errors";
import {
  daysForTimeRange,
  type DataQuery,
  type DecryptedData,
  type LegacyData,
  type LegacyDataType,
  type ResolvedDataQuery,
} from "@/server/domain/health-data";
import type { ActiveActor } from "@/server/domain/user";
import type { Clock } from "../ports/clock";
import type { HealthDataRepository } from "../ports/health-data-repository";

export interface LegacyQuery {
  readonly type: LegacyDataType;
  readonly rangeDays: number;
}

export interface DataUseCases {
  getDecryptedData(actor: ActiveActor, query: DataQuery): Promise<DecryptedData>;
  getLegacyData(actor: ActiveActor, query: LegacyQuery): Promise<LegacyData>;
}

function parseDateFilter(dateFilter: string | null): Date | null {
  if (dateFilter === null) {
    return null;
  }
  const parsed = new Date(dateFilter);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("dateFilter debe ser una fecha ISO-8601 válida");
  }
  return parsed;
}

function resolveDataQuery(query: DataQuery, now: Date): ResolvedDataQuery {
  const explicitFilter = parseDateFilter(query.dateFilter);
  const days = daysForTimeRange(query.timeRange);
  const from =
    explicitFilter !== null
      ? explicitFilter.toISOString()
      : days === null
        ? null
        : new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  return {
    ...query,
    dateFilter: from,
    from,
    to: now.toISOString(),
  };
}

export function createDataUseCases(
  repository: HealthDataRepository,
  clock: Clock,
): DataUseCases {
  return {
    async getDecryptedData(
      actor: ActiveActor,
      query: DataQuery,
    ): Promise<DecryptedData> {
      if (!canReadHealthDataFor(actor, query.selectedUser)) {
        throw new ForbiddenError(
          "Solo puedes consultar tus propios datos de salud",
        );
      }
      return repository.getDecryptedData(resolveDataQuery(query, clock.now()));
    },

    async getLegacyData(actor: ActiveActor, query: LegacyQuery): Promise<LegacyData> {
      if (!Number.isInteger(query.rangeDays) || query.rangeDays < 1 || query.rangeDays > 365) {
        throw new ValidationError("range debe ser un entero entre 1 y 365");
      }

      const now = clock.now();
      const from = new Date(
        now.getTime() - query.rangeDays * 24 * 60 * 60 * 1000,
      ).toISOString();

      return repository.getLegacyData({
        type: query.type,
        rangeDays: query.rangeDays,
        selectedUser: canReadAllHealthData(actor) ? null : actor.username,
        from,
        to: now.toISOString(),
      });
    },
  };
}

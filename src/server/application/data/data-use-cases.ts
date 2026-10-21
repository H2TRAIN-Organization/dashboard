import { canReadAllHealthData } from "@/server/domain/access-policy";
import { ValidationError } from "@/server/domain/errors";
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

/**
 * `dateFilter` is a calendar day in UTC. The selected window is
 * [00:00:00.000Z, next day 00:00:00.000Z), not "from that day until now".
 */
function parseUtcDay(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) {
    throw new ValidationError("dateFilter debe usar el formato YYYY-MM-DD");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  const start = new Date(Date.UTC(year, month - 1, dayOfMonth));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(dayOfMonth) ||
    start.toISOString().slice(0, 10) !== day
  ) {
    throw new ValidationError("dateFilter no es una fecha válida");
  }
  return start;
}

function resolveDataQuery(query: DataQuery, now: Date): ResolvedDataQuery {
  const days = daysForTimeRange(query.timeRange);
  const rangeFrom =
    days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rangeTo = now;

  let from = rangeFrom;
  let to = rangeTo;

  if (query.dateFilter !== null) {
    const dayStart = parseUtcDay(query.dateFilter);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    from =
      rangeFrom === null
        ? dayStart
        : new Date(Math.max(rangeFrom.getTime(), dayStart.getTime()));
    to = new Date(Math.min(rangeTo.getTime(), dayEnd.getTime()));
  }

  return {
    ...query,
    // Keep the caller's calendar day for traceability; repositories use
    // from/to exclusively for the window.
    dateFilter: query.dateFilter,
    from: from === null ? null : from.toISOString(),
    to: to.toISOString(),
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
      // Server-side normalization is the security boundary. A regular user's
      // requested user (including `all`) is ignored and replaced by their own
      // username; the browser filter is never the only protection.
      const selectedUser =
        actor.role === "user" ? actor.username : query.selectedUser;

      return repository.getDecryptedData(
        resolveDataQuery({ ...query, selectedUser }, clock.now()),
      );
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

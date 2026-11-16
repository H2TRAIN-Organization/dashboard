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
import type {
  HealthRecordKeyResolver,
  RecordKeyQuery,
} from "../ports/health-record-key-resolver";
import { createCanonicalRecordKeyResolver } from "../ports/health-record-key-resolver";

/**
 * Relabels the `username` of returned records with the canonical
 * users.Username of the owning account, so rows written by external producers
 * under an alias (auth_<uid>) group together with the rest of the account.
 * Unknown keys keep their own value; the database is never rewritten.
 */
function normalizeOwnership<T extends Record<string, unknown>>(
  records: readonly T[],
  ownership: ReadonlyMap<string, string>,
): T[] {
  if (ownership.size === 0) {
    return [...records];
  }
  return records.map((record) => {
    if (typeof record.username !== "string") {
      return record;
    }
    const canonical = ownership.get(record.username);
    if (canonical === undefined || canonical === record.username) {
      return record;
    }
    return { ...record, username: canonical };
  });
}

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

function resolveDataQuery(
  query: DataQuery,
  recordKeys: readonly string[],
  now: Date,
): ResolvedDataQuery {
  const days = daysForTimeRange(query.timeRange);
  const rangeFrom =
    days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rangeTo = now;

  // T13: an explicit from-to range is the authoritative window; timeRange
  // no longer clips it (a range older than timeRange would otherwise resolve
  // to an empty window with no way to reach that data).
  if (query.dateFrom !== null || query.dateTo !== null) {
    if (
      query.dateFrom !== null &&
      query.dateTo !== null &&
      query.dateFrom > query.dateTo
    ) {
      throw new ValidationError("dateFrom debe ser anterior o igual a dateTo");
    }

    return {
      ...query,
      recordKeys,
      dateFilter: query.dateFilter,
      from: query.dateFrom === null ? null : parseUtcDay(query.dateFrom).toISOString(),
      to:
        query.dateTo === null
          ? rangeTo.toISOString()
          : new Date(parseUtcDay(query.dateTo).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

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
    recordKeys,
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
  recordKeys: HealthRecordKeyResolver = createCanonicalRecordKeyResolver(),
): DataUseCases {
  /**
   * Server-side normalization is the security boundary. A regular user is
   * always scoped to the record keys resolved for their own account, even when
   * that username is the legacy value "all" and even when the client sends a
   * different selectedUser. Resolution never trusts HTTP input for regular
   * users. Only privileged roles may turn the HTTP "all" UI sentinel into an
   * empty key set (global repository query) or select another user by literal
   * username.
   */
  async function resolveKeys(query: RecordKeyQuery): Promise<readonly string[]> {
    return recordKeys.resolve(query);
  }

  function emptyKeys(): readonly string[] {
    return [];
  }

  async function ownership(): Promise<ReadonlyMap<string, string>> {
    return recordKeys.ownershipByRecordKey();
  }

  function ownedDecrypted(data: DecryptedData, owners: ReadonlyMap<string, string>): DecryptedData {
    return {
      insulinData: normalizeOwnership(data.insulinData, owners),
      foodData: normalizeOwnership(data.foodData, owners),
      exerciseData: normalizeOwnership(data.exerciseData, owners),
      periodData: normalizeOwnership(data.periodData, owners),
      moodData: normalizeOwnership(data.moodData, owners),
    };
  }

  return {
    async getDecryptedData(
      actor: ActiveActor,
      query: DataQuery,
    ): Promise<DecryptedData> {
      // Server-side normalization is the security boundary. Any actor without
      // the `health-data:read:all` capability is always scoped to the record
      // keys resolved for their own account, even when that username is the
      // legacy value "all". Only privileged roles may turn the HTTP "all" UI
      // sentinel into an empty key set (global repository query) or select
      // another account by literal username.
      const owners = await ownership();
      if (canReadAllHealthData(actor)) {
        const keys =
          query.selectedUser === "all"
            ? emptyKeys()
            : await resolveKeys({ username: query.selectedUser });
        const data = await repository.getDecryptedData(
          resolveDataQuery(query, keys, clock.now()),
        );
        return ownedDecrypted(data, owners);
      }

      const keys = await resolveKeys({
        username: actor.username,
        userId: actor.userId,
      });
      const data = await repository.getDecryptedData(
        resolveDataQuery(query, keys, clock.now()),
      );
      return ownedDecrypted(data, owners);
    },

    async getLegacyData(actor: ActiveActor, query: LegacyQuery): Promise<LegacyData> {
      if (!Number.isInteger(query.rangeDays) || query.rangeDays < 1 || query.rangeDays > 365) {
        throw new ValidationError("range debe ser un entero entre 1 y 365");
      }

      const now = clock.now();
      const from = new Date(
        now.getTime() - query.rangeDays * 24 * 60 * 60 * 1000,
      ).toISOString();

      const keys = canReadAllHealthData(actor)
        ? emptyKeys()
        : await resolveKeys({
            username: actor.username,
            userId: actor.userId,
          });

      const owners = await ownership();
      const legacy = await repository.getLegacyData({
        type: query.type,
        rangeDays: query.rangeDays,
        recordKeys: keys,
        from,
        to: now.toISOString(),
      });
      return {
        exercise: normalizeOwnership(legacy.exercise, owners),
        mood: normalizeOwnership(legacy.mood, owners),
        insulin: normalizeOwnership(legacy.insulin, owners),
        meal: normalizeOwnership(legacy.meal, owners),
      };
    },
  };
}

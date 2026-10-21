import { describe, expect, it } from "vitest";
import { createDataUseCases } from "@/server/application/data/data-use-cases";
import { InMemoryHealthDataRepository } from "@/server/infrastructure/testing/in-memory-health-data-repository";
import type { DecryptedData } from "@/server/domain/health-data";
import { actorFor, makeUser } from "../helpers/fixtures";

const now = new Date("2026-01-31T12:00:00.000Z");
const clock = { now: () => now };

const data: DecryptedData = {
  insulinData: [{ username: "alice", insulinType: "bolus", dose: "4" }],
  foodData: [{ username: "alice", food_type: "lunch" }],
  exerciseData: [{ username: "alice", exercise_type: "walk" }],
  periodData: [{ username: "alice", startDate: "2026-01-02T00:00:00.000Z" }],
  moodData: [{ username: "alice", mood_value: 4 }],
};

const adminActor = actorFor(
  makeUser({ id: "admin-1", username: "root", role: "admin" }),
);
const doctorActor = actorFor(
  makeUser({ id: "doctor-1", username: "doctor", role: "doctor" }),
);
const userActor = actorFor(
  makeUser({ id: "user-1", username: "alice", role: "user" }),
);
const userNamedAllActor = actorFor(
  makeUser({ id: "user-all", username: "all", role: "user" }),
);

function setup() {
  const repository = new InMemoryHealthDataRepository(data, {
    exercise: data.exerciseData,
    mood: data.moodData,
    insulin: data.insulinData,
    meal: data.foodData,
  });
  return { repository, useCases: createDataUseCases(repository, clock) };
}

describe("health data use cases", () => {
  it("lets privileged roles request all data and resolves timeRange lower bound", async () => {
    const { repository, useCases } = setup();

    const result = await useCases.getDecryptedData(adminActor, {
      selectedUser: "all",
      timeRange: "30d",
      selectedDataType: "all",
      dateFilter: null,
    });

    expect(result.insulinData).toHaveLength(1);
    expect(repository.lastDecryptedQuery?.selectedUser).toBeNull();
    expect(repository.lastDecryptedQuery?.from).toBe("2026-01-01T12:00:00.000Z");
    expect(repository.lastDecryptedQuery?.to).toBe(now.toISOString());
  });

  it("treats dateFilter as a full UTC day and intersects it with timeRange", async () => {
    const { repository, useCases } = setup();

    await useCases.getDecryptedData(doctorActor, {
      selectedUser: "alice",
      timeRange: "90d",
      selectedDataType: "insulin",
      dateFilter: "2025-12-15",
    });
    expect(repository.lastDecryptedQuery).toMatchObject({
      dateFilter: "2025-12-15",
      from: "2025-12-15T00:00:00.000Z",
      to: "2025-12-16T00:00:00.000Z",
    });

    await useCases.getDecryptedData(doctorActor, {
      selectedUser: "all",
      timeRange: "all",
      selectedDataType: "all",
      dateFilter: "2026-01-15",
    });
    expect(repository.lastDecryptedQuery).toMatchObject({
      from: "2026-01-15T00:00:00.000Z",
      to: "2026-01-16T00:00:00.000Z",
    });
  });

  it("clips the selected day to the timeRange window", async () => {
    const { repository, useCases } = setup();

    // 30d starts at 2026-01-01T12:00Z; the day starts earlier, so the
    // intersection uses the timeRange lower bound.
    await useCases.getDecryptedData(doctorActor, {
      selectedUser: "all",
      timeRange: "30d",
      selectedDataType: "all",
      dateFilter: "2026-01-01",
    });
    expect(repository.lastDecryptedQuery).toMatchObject({
      from: "2026-01-01T12:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    });

    // Today's full day is clipped to "now" by the range upper bound.
    await useCases.getDecryptedData(doctorActor, {
      selectedUser: "all",
      timeRange: "30d",
      selectedDataType: "all",
      dateFilter: "2026-01-31",
    });
    expect(repository.lastDecryptedQuery).toMatchObject({
      from: "2026-01-31T00:00:00.000Z",
      to: "2026-01-31T12:00:00.000Z",
    });
  });

  it("keeps all-range without dateFilter unbounded on the lower side", async () => {
    const { repository, useCases } = setup();

    await useCases.getDecryptedData(doctorActor, {
      selectedUser: "all",
      timeRange: "all",
      selectedDataType: "all",
      dateFilter: null,
    });
    expect(repository.lastDecryptedQuery?.from).toBeNull();
    expect(repository.lastDecryptedQuery?.to).toBe(now.toISOString());
  });

  it("normalizes a regular user's selectedUser to their own literal username", async () => {
    const { repository, useCases } = setup();
    const base = {
      timeRange: "30d",
      selectedDataType: "all",
      dateFilter: null,
    } as const;

    for (const selectedUser of ["all", "bob", "alice"]) {
      const own = await useCases.getDecryptedData(userActor, {
        ...base,
        selectedUser,
      });
      expect(own.insulinData).toHaveLength(1);
      expect(repository.lastDecryptedQuery?.selectedUser).toBe("alice");
    }
  });

  it("keeps the literal username all for users and reserves null for privileged all", async () => {
    const { repository, useCases } = setup();
    const query = {
      selectedUser: "all",
      timeRange: "30d",
      selectedDataType: "all",
      dateFilter: null,
    } as const;

    await useCases.getDecryptedData(userNamedAllActor, query);
    expect(repository.lastDecryptedQuery?.selectedUser).toBe("all");

    await useCases.getDecryptedData(adminActor, query);
    expect(repository.lastDecryptedQuery?.selectedUser).toBeNull();

    await useCases.getDecryptedData(doctorActor, {
      ...query,
      selectedUser: "alice",
    });
    expect(repository.lastDecryptedQuery?.selectedUser).toBe("alice");
  });

  it("rejects invalid calendar days", async () => {
    const { useCases } = setup();
    await expect(
      useCases.getDecryptedData(userActor, {
        selectedUser: "alice",
        timeRange: "30d",
        selectedDataType: "all",
        dateFilter: "2026-02-30",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("scopes legacy access for users and keeps admin access unscoped", async () => {
    const { repository, useCases } = setup();

    await useCases.getLegacyData(userActor, { type: "all", rangeDays: 30 });
    expect(repository.lastLegacyQuery?.selectedUser).toBe("alice");

    await useCases.getLegacyData(userNamedAllActor, {
      type: "all",
      rangeDays: 30,
    });
    expect(repository.lastLegacyQuery?.selectedUser).toBe("all");

    await useCases.getLegacyData(adminActor, { type: "all", rangeDays: 30 });
    expect(repository.lastLegacyQuery?.selectedUser).toBeNull();
    expect(repository.lastLegacyQuery?.from).toBe("2026-01-01T12:00:00.000Z");
  });

  it("rejects invalid legacy ranges", async () => {
    const { useCases } = setup();
    await expect(
      useCases.getLegacyData(adminActor, { type: "all", rangeDays: 0 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

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
    expect(repository.lastDecryptedQuery?.from).toBe("2026-01-01T12:00:00.000Z");
    expect(repository.lastDecryptedQuery?.to).toBe(now.toISOString());
  });

  it("uses dateFilter as the inclusive lower bound and lets all range mean no bound", async () => {
    const { repository, useCases } = setup();

    await useCases.getDecryptedData(doctorActor, {
      selectedUser: "alice",
      timeRange: "90d",
      selectedDataType: "insulin",
      dateFilter: "2025-12-01T00:00:00.000Z",
    });
    expect(repository.lastDecryptedQuery?.from).toBe("2025-12-01T00:00:00.000Z");

    await useCases.getDecryptedData(doctorActor, {
      selectedUser: "all",
      timeRange: "all",
      selectedDataType: "all",
      dateFilter: null,
    });
    expect(repository.lastDecryptedQuery?.from).toBeNull();
  });

  it("prevents regular users from reading all data or another user's data", async () => {
    const { useCases } = setup();
    const base = {
      timeRange: "30d",
      selectedDataType: "all",
      dateFilter: null,
    } as const;

    await expect(
      useCases.getDecryptedData(userActor, { ...base, selectedUser: "all" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      useCases.getDecryptedData(userActor, { ...base, selectedUser: "bob" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const own = await useCases.getDecryptedData(userActor, {
      ...base,
      selectedUser: "alice",
    });
    expect(own.insulinData).toHaveLength(1);
  });

  it("scopes legacy access for users and keeps admin access unscoped", async () => {
    const { repository, useCases } = setup();

    await useCases.getLegacyData(userActor, { type: "all", rangeDays: 30 });
    expect(repository.lastLegacyQuery?.selectedUser).toBe("alice");

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

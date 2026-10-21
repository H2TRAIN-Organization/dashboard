import { describe, expect, it } from "vitest";

import { Aes256CbcDecryptor } from "@/server/infrastructure/crypto/aes-256-cbc";
import { SupabaseHealthDataRepository } from "@/server/infrastructure/persistence/health/health-data-repository";

import {
  CURRENT_KEY,
  encryptText,
  ivHex,
  PREVIOUS_KEY,
} from "./helpers/crypto-fixtures";
import { FakePersistenceGateway } from "./helpers/fake-gateway";

function decryptor(): Aes256CbcDecryptor {
  return new Aes256CbcDecryptor({
    currentKeyHex: CURRENT_KEY,
    previousKeyHex: PREVIOUS_KEY,
  });
}

function insulinRow(
  id: number,
  username: string,
  dateTime: string,
  type = "bolus",
  dose = "4",
): Record<string, unknown> {
  const typeIv = ivHex(100 + id);
  const doseIv = ivHex(200 + id);
  return {
    id,
    username,
    insulinType: encryptText(type, CURRENT_KEY, typeIv),
    insulintype_iv: typeIv,
    dose: encryptText(dose, CURRENT_KEY, doseIv),
    dose_iv: doseIv,
    date_time: dateTime,
    actualDateTime: dateTime,
    iv: ivHex(300 + id),
  };
}

function seed() {
  return {
    insulindata: [
      insulinRow(1, "alice", "2026-01-15T10:00:00"),
      insulinRow(2, "alice", "2026-02-15T10:00:00", "basal", "12"),
      insulinRow(3, "bob", "2026-01-20T10:00:00", "bolus", "6"),
    ],
    fooddata: [
      {
        id: 10,
        username: "alice",
        food_type: encryptText("lunch", CURRENT_KEY, ivHex(401)),
        food_type_iv: ivHex(401),
        quantity: encryptText("200", CURRENT_KEY, ivHex(402)),
        quantity_iv: ivHex(402),
        carbs: encryptText("45", CURRENT_KEY, ivHex(403)),
        carbs_iv: ivHex(403),
        date_time: "2026-01-16T12:00:00",
        iv: ivHex(404),
      },
    ],
    exercisedata: [
      {
        id: 20,
        username: "alice",
        exercise_type: encryptText("walk", CURRENT_KEY, ivHex(501)),
        exercise_type_iv: ivHex(501),
        intensity: 3,
        exercise_start_time: "2026-01-17T08:00:00",
        exercise_end_time: "2026-01-17T08:30:00",
        exercise_description: encryptText("park", CURRENT_KEY, ivHex(502)),
        exercise_description_iv: ivHex(502),
        date_time: "2026-01-17T08:30:00",
        iv: ivHex(503),
      },
    ],
    periodrecords: [
      {
        id: 30,
        username: "alice",
        startDate: "2026-01-10T00:00:00",
        endDate: "2026-01-14T00:00:00",
        intensity: encryptText("medium", CURRENT_KEY, ivHex(601)),
        intensity_iv: ivHex(601),
        symptoms: [
          encryptText("nausea", CURRENT_KEY, ivHex(602)),
          encryptText("fatigue", CURRENT_KEY, ivHex(603)),
        ],
        symptoms_iv: [ivHex(602), ivHex(603)],
        notes: encryptText("rest", CURRENT_KEY, ivHex(604)),
        notes_iv: ivHex(604),
        date_time: "2026-01-10T00:00:00",
        iv: ivHex(605),
      },
    ],
    mooddata: [
      {
        id: 40,
        username: "alice",
        mood_value: 4,
        out_of_routine: false,
        routine_description: encryptText("normal", CURRENT_KEY, ivHex(701)),
        routine_description_iv: ivHex(701),
        emotions: [
          encryptText("calm", CURRENT_KEY, ivHex(702)),
          encryptText("happy", CURRENT_KEY, ivHex(703)),
        ],
        emotions_iv: [ivHex(702), ivHex(703)],
        other_emotion: encryptText("none", CURRENT_KEY, ivHex(704)),
        other_emotion_iv: ivHex(704),
        date_time: "2026-01-12T18:00:00+00:00",
        iv: ivHex(705),
      },
    ],
  };
}

function repository(pageSize = 1000) {
  const gateway = new FakePersistenceGateway(seed());
  return {
    gateway,
    repo: new SupabaseHealthDataRepository(gateway, decryptor(), { pageSize }),
  };
}

describe("SupabaseHealthDataRepository decrypted data", () => {
  it("returns the five arrays filtered by user, date and type", async () => {
    const { repo } = repository();
    const data = await repo.getDecryptedData({
      selectedUser: "alice",
      timeRange: "30d",
      selectedDataType: "all",
      dateFilter: null,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z",
    });

    expect(Object.keys(data)).toEqual([
      "insulinData",
      "foodData",
      "exerciseData",
      "periodData",
      "moodData",
    ]);
    expect(data.insulinData).toHaveLength(1);
    expect(data.insulinData[0]).toMatchObject({
      id: 1,
      username: "alice",
      insulinType: "bolus",
      dose: "4",
    });
    expect(data.foodData[0]).toMatchObject({
      food_type: "lunch",
      quantity: "200",
      carbs: "45",
    });
    expect(data.exerciseData[0]).toMatchObject({
      exercise_type: "walk",
      exercise_description: "park",
      intensity: 3,
    });
    expect(data.periodData[0]).toMatchObject({
      symptoms: ["nausea", "fatigue"],
      intensity: "medium",
      notes: "rest",
    });
    expect(data.moodData[0]).toMatchObject({
      emotions: ["calm", "happy"],
      routine_description: "normal",
      other_emotion: "none",
      mood_value: 4,
    });

    for (const records of Object.values(data)) {
      for (const record of records) {
        expect(Object.keys(record).some((key) => key === "iv" || key.endsWith("_iv"))).toBe(
          false,
        );
        expect(JSON.stringify(record)).not.toContain("__PLAIN__");
      }
    }
  });

  it("uses an exclusive upper bound for decrypted windows and an inclusive one for legacy", async () => {
    const { repo } = repository();
    const decrypted = await repo.getDecryptedData({
      selectedUser: "alice",
      timeRange: "all",
      selectedDataType: "insulin",
      dateFilter: null,
      from: "2026-01-15T10:00:00.000Z",
      to: "2026-01-15T10:00:00.000Z",
    });
    expect(decrypted.insulinData).toEqual([]);

    const legacy = await repo.getLegacyData({
      type: "insulin",
      rangeDays: 30,
      selectedUser: "alice",
      from: "2026-01-15T10:00:00.000Z",
      to: "2026-01-15T10:00:00.000Z",
    });
    expect(legacy.insulin).toHaveLength(1);
  });

  it("treats selectedUser=all as unscoped for privileged reads", async () => {
    const { gateway, repo } = repository();
    const data = await repo.getDecryptedData({
      selectedUser: "all",
      timeRange: "all",
      selectedDataType: "insulin",
      dateFilter: null,
      from: null,
      to: "2026-12-31T23:59:59.999Z",
    });

    expect(data.insulinData).toHaveLength(3);
    expect(
      gateway.selectCalls.some((call) =>
        call.request.filters?.some(
          (filter) => filter.kind === "eq" && filter.column === "username",
        ),
      ),
    ).toBe(false);
  });

  it("returns only the selected type and pages by id without truncation", async () => {
    const { gateway, repo } = repository(2);
    const data = await repo.getDecryptedData({
      selectedUser: "alice",
      timeRange: "all",
      selectedDataType: "insulin",
      dateFilter: null,
      from: null,
      to: "2026-12-31T23:59:59.999Z",
    });

    expect(data.insulinData).toHaveLength(2);
    expect(data.foodData).toEqual([]);
    expect(data.exerciseData).toEqual([]);
    expect(data.periodData).toEqual([]);
    expect(data.moodData).toEqual([]);

    const insulinCalls = gateway.selectCalls.filter(
      (call) => call.table === "insulindata",
    );
    expect(insulinCalls).toHaveLength(2);
    expect(insulinCalls[0]?.request.range).toEqual({ from: 0, to: 1 });
    expect(insulinCalls[1]?.request.range).toEqual({ from: 2, to: 3 });
    expect(insulinCalls[0]?.request.order).toEqual({
      column: "id",
      ascending: true,
    });
  });

  it("fails explicitly when an encrypted field has no IV and never echoes ciphertext", async () => {
    const doseCiphertext = encryptText("4", CURRENT_KEY, ivHex(802));
    const gateway = new FakePersistenceGateway({
      insulindata: [
        {
          id: 1,
          username: "alice",
          insulinType: encryptText("bolus", CURRENT_KEY, ivHex(801)),
          insulintype_iv: ivHex(801),
          dose: doseCiphertext,
          dose_iv: null,
          date_time: "2026-01-15T10:00:00",
        },
      ],
    });
    const repo = new SupabaseHealthDataRepository(gateway, decryptor());

    try {
      await repo.getDecryptedData({
        selectedUser: "alice",
        timeRange: "all",
        selectedDataType: "insulin",
        dateFilter: null,
        from: null,
        to: "2026-12-31T23:59:59.999Z",
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "MISSING_IV" });
      expect(String(error)).not.toContain(doseCiphertext);
    }
  });
});

describe("SupabaseHealthDataRepository legacy compatibility", () => {
  it("returns the four legacy arrays with decrypted values", async () => {
    const { repo } = repository();
    const data = await repo.getLegacyData({
      type: "all",
      rangeDays: 30,
      selectedUser: null,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z",
    });

    expect(data.exercise).toHaveLength(1);
    expect(data.mood).toHaveLength(1);
    // selectedUser=null means all users; both January insulin rows match.
    expect(data.insulin).toHaveLength(2);
    expect(data.insulin.map((record) => record.username).sort()).toEqual([
      "alice",
      "bob",
    ]);
    expect(data.meal).toHaveLength(1);
    expect(data.meal[0]).toMatchObject({ food_type: "lunch" });
  });

  it("scopes legacy data to the selected username and type", async () => {
    const { gateway, repo } = repository();
    const data = await repo.getLegacyData({
      type: "meal",
      rangeDays: 30,
      selectedUser: "alice",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z",
    });

    expect(data.exercise).toEqual([]);
    expect(data.mood).toEqual([]);
    expect(data.insulin).toEqual([]);
    expect(data.meal).toHaveLength(1);
    expect(
      gateway.selectCalls.some((call) =>
        call.request.filters?.some(
          (filter) => filter.kind === "eq" && filter.column === "username",
        ),
      ),
    ).toBe(true);
  });
});

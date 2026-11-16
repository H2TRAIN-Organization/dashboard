/**
 * Integration test of the health-data flow with resolved record keys.
 *
 * Scenario mirrors the reported incident: the mobile app writes health rows
 * keyed by the alias `auth_<supabase-uid>` while the dashboard account is
 * keyed by the canonical `users.Username` (the email). No network, no real
 * Supabase; the resolver and persistence layers are wired exactly like the
 * production composition (repository + use cases), with deterministic doubles.
 */
import { describe, expect, it } from "vitest";

import { createDataUseCases } from "@/server/application/data/data-use-cases";
import {
  SupabaseHealthRecordKeyResolver,
  type HealthRecordKeyResolverOptions,
} from "@/server/infrastructure/auth/health-record-key-resolver";
import { SupabaseHealthDataRepository } from "@/server/infrastructure/persistence/health/health-data-repository";
import { Aes256CbcDecryptor } from "@/server/infrastructure/crypto/aes-256-cbc";
import { actorFor, makeUser } from "../helpers/fixtures";
import { FakePersistenceGateway } from "./helpers/fake-gateway";
import {
  CURRENT_KEY,
  encryptText,
  ivHex,
  PREVIOUS_KEY,
} from "./helpers/crypto-fixtures";

const JAVIER_AUTH_UID = "d16ebc46-1c2f-4a9e-b5e1-4b2fa997cf99";
const OTHER_AUTH_UID = "aa6cbf21-7d57-4eb3-9300-fc0e5f4dc39f";
const JAVIER_EMAIL = "javier.alayon@ulpgc.es";
const OTHER_EMAIL = "prueba@example.com";

const now = new Date("2026-11-16T12:30:00.000Z");
const clock = { now: () => now };

function moodRow(
  id: number,
  username: string,
  moodValue: number,
  dateTime: string,
): Record<string, unknown> {
  const descriptionIv = ivHex(700 + id);
  return {
    id,
    username,
    mood_value: moodValue,
    out_of_routine: false,
    routine_description: encryptText(
      "rutina cumplida",
      CURRENT_KEY,
      descriptionIv,
    ),
    routine_description_iv: descriptionIv,
    emotions: [],
    other_emotion: null,
    date_time: dateTime,
  };
}

function insulinRow(
  id: number,
  username: string,
  dateTime: string,
): Record<string, unknown> {
  const typeIv = ivHex(100 + id);
  const doseIv = ivHex(200 + id);
  return {
    id,
    username,
    insulinType: encryptText("bolus", CURRENT_KEY, typeIv),
    insulintype_iv: typeIv,
    dose: encryptText("4", CURRENT_KEY, doseIv),
    dose_iv: doseIv,
    date_time: dateTime,
  };
}

function seed() {
  return {
    mooddata: [
      // Real incident row: written by the mobile app with the auth alias.
      moodRow(88, `auth_${JAVIER_AUTH_UID}`, 7, "2026-11-16T12:00:00+00:00"),
      // Historical row written with the canonical email.
      moodRow(61, JAVIER_EMAIL, 5, "2025-10-06T09:08:56+00:00"),
      // Another account's alias rows must stay out of Javier's session.
      moodRow(87, `auth_${OTHER_AUTH_UID}`, 5, "2026-11-12T12:00:00+00:00"),
    ],
    insulindata: [
      insulinRow(347, `auth_${OTHER_AUTH_UID}`, "2026-11-12T13:22:00"),
      insulinRow(61, JAVIER_EMAIL, "2025-10-06T10:00:00"),
    ],
    fooddata: [],
    exercisedata: [],
    periodrecords: [],
  };
}

const AUTH_USERS = [
  {
    id: JAVIER_AUTH_UID,
    email: JAVIER_EMAIL,
    email_confirmed_at: "2026-10-29T11:27:42.000Z",
    app_metadata: { app_user_id: 8, role: "user" },
  },
  {
    id: OTHER_AUTH_UID,
    email: OTHER_EMAIL,
    email_confirmed_at: "2026-11-07T00:02:29.000Z",
    app_metadata: { app_user_id: 57, role: "user" },
  },
];

function decryptor(): Aes256CbcDecryptor {
  return new Aes256CbcDecryptor({
    currentKeyHex: CURRENT_KEY,
    previousKeyHex: PREVIOUS_KEY,
  });
}

function build(options: Partial<HealthRecordKeyResolverOptions> = {}) {
  const gateway = new FakePersistenceGateway(seed());
  const repository = new SupabaseHealthDataRepository(gateway, decryptor());
  const resolver = new SupabaseHealthRecordKeyResolver({
    client: {
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: AUTH_USERS }, error: null }),
        },
      },
    },
    users: new FakePersistenceGateway({
      users: [
        { UserID: 8, Username: JAVIER_EMAIL, role: "user" },
        { UserID: 57, Username: `auth_${OTHER_AUTH_UID}`, role: "user" },
        { UserID: 67, Username: `auth_${JAVIER_AUTH_UID}`, role: "user" },
      ],
    }),
    ttlMs: 0,
    ...options,
  });
  const useCases = createDataUseCases(repository, clock, resolver);
  return { gateway, repository, useCases, resolver };
}

const javierActor = actorFor(
  makeUser({ id: "8", username: JAVIER_EMAIL, role: "user" }),
);
const otherActor = actorFor(
  makeUser({ id: "57", username: OTHER_EMAIL, role: "user" }),
);
const adminActor = actorFor(
  makeUser({ id: "21", username: "gabriel.gil@ulpgc.es", role: "admin" }),
);

describe("health data alias flow (mobile app auth_<uid> rows)", () => {
  it("returns the mood row written with the auth alias to the email account", async () => {
    const { useCases } = build();

    const data = await useCases.getDecryptedData(javierActor, {
      selectedUser: JAVIER_EMAIL,
      timeRange: "all",
      selectedDataType: "mood",
      dateFilter: null,
    });

    expect(data.moodData.map((row) => row.id).sort()).toEqual([61, 88]);
    expect(data.moodData[0]).toMatchObject({
      username: JAVIER_EMAIL,
      mood_value: 5,
    });
    expect(data.moodData[1]).toMatchObject({
      username: `auth_${JAVIER_AUTH_UID}`,
      mood_value: 7,
      routine_description: "rutina cumplida",
    });
  });

  it("does not expose another account's alias rows", async () => {
    const { useCases } = build();

    const javier = await useCases.getDecryptedData(javierActor, {
      selectedUser: "all",
      timeRange: "all",
      selectedDataType: "all",
      dateFilter: null,
    });
    const other = await useCases.getDecryptedData(otherActor, {
      selectedUser: "all",
      timeRange: "all",
      selectedDataType: "all",
      dateFilter: null,
    });

    expect(javier.moodData.map((row) => row.id).sort()).toEqual([61, 88]);
    expect(javier.insulinData.map((row) => row.id)).toEqual([61]);

    expect(other.moodData.map((row) => row.id)).toEqual([87]);
    expect(other.insulinData.map((row) => row.id)).toEqual([347]);
  });

  it("queries PostgREST with one username in (…) filter per table", async () => {
    const { gateway } = build();

    await build().useCases.getDecryptedData(javierActor, {
      selectedUser: "all",
      timeRange: "all",
      selectedDataType: "all",
      dateFilter: null,
    });
    void gateway;

    const { gateway: freshGateway, useCases } = build();
    await useCases.getDecryptedData(javierActor, {
      selectedUser: "all",
      timeRange: "all",
      selectedDataType: "mood",
      dateFilter: null,
    });

    const moodCalls = freshGateway.selectCalls.filter(
      (call) => call.table === "mooddata",
    );
    expect(moodCalls).toHaveLength(1);
    const usernameFilter = moodCalls[0]?.request.filters?.find(
      (filter) => filter.column === "username",
    );
    expect(usernameFilter).toMatchObject({
      kind: "in",
      values: [JAVIER_EMAIL, `auth_${JAVIER_AUTH_UID}`],
    });
  });

  it("keeps the unbounded read for privileged roles", async () => {
    const { gateway, useCases } = build();

    const data = await useCases.getDecryptedData(adminActor, {
      selectedUser: "all",
      timeRange: "all",
      selectedDataType: "mood",
      dateFilter: null,
    });

    expect(data.moodData).toHaveLength(3);
    const usernameFilter = gateway.selectCalls.find(
      (call) => call.table === "mooddata",
    )?.request.filters?.some((filter) => filter.column === "username");
    expect(usernameFilter).toBe(false);
  });

  it("lets an admin select an account by canonical username and see its alias rows", async () => {
    const { useCases } = build();

    const data = await useCases.getDecryptedData(adminActor, {
      selectedUser: JAVIER_EMAIL,
      timeRange: "all",
      selectedDataType: "mood",
      dateFilter: null,
    });

    expect(data.moodData.map((row) => row.id).sort()).toEqual([61, 88]);
  });

  it("keeps legacy reads scoped to the resolved keys", async () => {
    const { useCases } = build();

    const legacy = await useCases.getLegacyData(javierActor, {
      type: "mood",
      rangeDays: 365,
    });

    // Row 61 is dated 2025-10-06, outside the 365-day window ending 2026-11-16.
    expect(legacy.mood.map((row) => row.id)).toEqual([88]);
  });
});

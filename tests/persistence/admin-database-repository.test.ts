import { describe, expect, it } from "vitest";

import { NotFoundError } from "@/server/domain/errors";
import { Aes256CbcDecryptor } from "@/server/infrastructure/crypto/aes-256-cbc";
import { SupabaseAdminDatabaseRepository } from "@/server/infrastructure/persistence/admin/supabase-admin-database-repository";

import {
  CURRENT_KEY,
  encryptText,
  ivHex,
  PREVIOUS_KEY,
  validBcryptHash,
} from "./helpers/crypto-fixtures";
import { FakePersistenceGateway } from "./helpers/fake-gateway";

function decryptor(): Aes256CbcDecryptor {
  return new Aes256CbcDecryptor({
    currentKeyHex: CURRENT_KEY,
    previousKeyHex: PREVIOUS_KEY,
  });
}

function setup() {
  const gateway = new FakePersistenceGateway({
    users: [
      {
        UserID: 1,
        Username: "alice",
        UUID: "uuid-alice",
        GDPRConsent: true,
        GDPRConsentDate: "2026-01-01T10:00:00",
        sexo: "F",
        bomba_insulina: true,
        role: "admin",
        PasswordHash: validBcryptHash("a"),
      },
      {
        UserID: 2,
        Username: "bob",
        UUID: null,
        GDPRConsent: false,
        GDPRConsentDate: null,
        sexo: null,
        bomba_insulina: false,
        role: "user",
        PasswordHash: validBcryptHash("b"),
      },
    ],
    insulindata: [
      {
        id: 10,
        username: "alice",
        insulinType: encryptText("bolus", CURRENT_KEY, ivHex(901)),
        insulintype_iv: ivHex(901),
        dose: encryptText("4", CURRENT_KEY, ivHex(902)),
        dose_iv: ivHex(902),
        date_time: "2026-01-15T10:00:00",
        iv: ivHex(903),
      },
    ],
    fooddata: [],
    exercisedata: [],
    periodrecords: [],
    mooddata: [],
    polar_data: [
      {
        id: 50,
        username: "alice",
        timestamp: "2026-01-15T10:00:00+00:00",
        heart_rate: 62,
        rri_data: [800, 810],
        device_id: "polar_h10",
        data_type: "heart_rate_reading",
      },
    ],
  });
  return {
    gateway,
    repo: new SupabaseAdminDatabaseRepository(gateway, decryptor()),
  };
}

describe("SupabaseAdminDatabaseRepository", () => {
  it("lists the seven-table allowlist with counts and safe failures", async () => {
    const { gateway, repo } = setup();
    gateway.selectErrors.set("polar_data", new Error("permission denied"));

    const result = await repo.listTables();
    expect(result.tables.map((table) => table.name)).toEqual([
      "users",
      "insulindata",
      "fooddata",
      "exercisedata",
      "periodrecords",
      "mooddata",
      "polar_data",
    ]);
    expect(result.totalCount).toBe(7);
    expect(result.accessibleCount).toBe(6);
    const polar = result.tables.find((table) => table.name === "polar_data");
    expect(polar).toMatchObject({
      accessible: false,
      recordCount: 0,
      error: "No disponible",
    });
    expect(result.tables.find((table) => table.name === "users")?.recordCount).toBe(2);
  });

  it("projects users without PasswordHash and without credential material", async () => {
    const { repo } = setup();
    const page = await repo.getTableData("users", 1);
    expect(page.totalRecords).toBe(2);
    expect(page.returnedRecords).toBe(1);
    expect(page.limit).toBe(1);
    expect(page.data[0]).toMatchObject({
      UserID: 1,
      Username: "alice",
      UUID: "uuid-alice",
      role: "admin",
      sexo: "F",
    });
    expect(page.data[0]).not.toHaveProperty("PasswordHash");
    expect(JSON.stringify(page.data)).not.toContain("bcrypt");
  });

  it("decrypts health table data and removes IV/ciphertext fields", async () => {
    const { repo } = setup();
    const page = await repo.getTableData("insulindata", 10);
    expect(page.data[0]).toMatchObject({
      id: 10,
      username: "alice",
      insulinType: "bolus",
      dose: "4",
    });
    expect(page.data[0]).not.toHaveProperty("iv");
    expect(page.data[0]).not.toHaveProperty("insulintype_iv");
    expect(page.data[0]).not.toHaveProperty("dose_iv");
  });

  it("returns polar rows without IV-like keys", async () => {
    const { repo } = setup();
    const page = await repo.getTableData("polar_data", 10);
    expect(page.data[0]).toMatchObject({
      id: 50,
      username: "alice",
      heart_rate: 62,
    });
    expect(page.data[0]).not.toHaveProperty("iv");
  });

  it("rejects tables outside the allowlist and invalid limits", async () => {
    const { repo } = setup();
    await expect(repo.getTableData("device_public_keys", 10)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(repo.getTableData("users", 0)).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(repo.getTableData("users", 1001)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

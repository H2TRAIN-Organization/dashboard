import { describe, expect, it } from "vitest";

import {
  assertBcryptHash,
  createBcryptPasswordHasher,
  isBcryptHash,
} from "@/server/infrastructure/persistence/user/password-hasher";
import {
  mapUserAdminRow,
  mapUserRow,
} from "@/server/infrastructure/persistence/user/user-mapper";

import { validBcryptHash } from "./helpers/crypto-fixtures";

describe("user mapping", () => {
  it("maps the verified public.users columns to the foundation User", () => {
    const user = mapUserRow({
      UserID: 7,
      Username: "alice",
      UUID: "external-uuid",
      GDPRConsent: true,
      GDPRConsentDate: "2026-01-02T03:04:05",
      role: "doctor",
      PasswordHash: validBcryptHash(),
    });

    expect(user).toEqual({
      id: "7",
      username: "alice",
      email: null,
      role: "doctor",
      uuid: "external-uuid",
      gdprConsent: true,
      gdprConsentAt: "2026-01-02T03:04:05.000Z",
      createdAt: null,
    });
    expect(JSON.stringify(user)).not.toContain("PasswordHash");
  });

  it("uses least privilege for unknown roles and hides stale consent dates", () => {
    const user = mapUserRow({
      UserID: "8",
      Username: "bob",
      UUID: null,
      GDPRConsent: false,
      GDPRConsentDate: "2026-01-02T03:04:05",
      role: "superuser",
    });
    expect(user.role).toBe("user");
    expect(user.gdprConsentAt).toBeNull();
    expect(user.uuid).toBeNull();
  });

  it("rejects rows without a username", () => {
    expect(() => mapUserRow({ UserID: 1, Username: null })).toThrowError(
      expect.objectContaining({ code: "MAPPING_FAILED" }),
    );
  });

  it("projects admin user rows without PasswordHash", () => {
    const row = mapUserAdminRow({
      UserID: 1,
      Username: "alice",
      PasswordHash: validBcryptHash(),
      UUID: null,
      GDPRConsent: true,
      GDPRConsentDate: "2026-01-02T03:04:05",
      sexo: "F",
      bomba_insulina: true,
      role: "admin",
    });
    expect(row).not.toHaveProperty("PasswordHash");
    expect(row).toMatchObject({
      UserID: 1,
      Username: "alice",
      role: "admin",
      sexo: "F",
    });
  });
});

describe("bcrypt password hashing", () => {
  it("accepts only 60-character bcrypt hashes", () => {
    expect(isBcryptHash(validBcryptHash())).toBe(true);
    expect(() => assertBcryptHash(validBcryptHash())).not.toThrow();
    expect(() => assertBcryptHash("x".repeat(60))).toThrowError(
      expect.objectContaining({ code: "PASSWORD_HASH_INVALID" }),
    );
    expect(isBcryptHash("x".repeat(59))).toBe(false);
  });

  it("adapts an injected bcrypt module and verifies passwords", async () => {
    const hash = validBcryptHash("b");
    const hasher = createBcryptPasswordHasher({
      async hash(): Promise<string> {
        return hash;
      },
      async compare(password: string, passwordHash: string): Promise<boolean> {
        return password === "correct" && passwordHash === hash;
      },
    });

    await expect(hasher.hash("correct")).resolves.toBe(hash);
    await expect(hasher.verify("correct", hash)).resolves.toBe(true);
    await expect(hasher.verify("wrong", hash)).resolves.toBe(false);
    await expect(hasher.verify("correct", "not-bcrypt")).resolves.toBe(false);
  });

  it("rejects an invalid bcrypt cost", () => {
    expect(() =>
      createBcryptPasswordHasher(
        {
          async hash(): Promise<string> {
            return validBcryptHash();
          },
        },
        4,
      ),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });
});

import { describe, expect, it } from "vitest";

import { ConflictError, ValidationError } from "@/server/domain/errors";
import { SupabaseUserCredentialsRepository } from "@/server/infrastructure/persistence/user/user-credentials-repository";
import { SupabaseUserDataPresence } from "@/server/infrastructure/persistence/user/user-data-presence";
import { SupabaseUserRepository } from "@/server/infrastructure/persistence/user/supabase-user-repository";

import {
  FakePersistenceGateway,
  uniqueViolation,
  userHasDataError,
} from "./helpers/fake-gateway";
import { fakePasswordHasher, validBcryptHash } from "./helpers/crypto-fixtures";

const seedUsers = [
  {
    UserID: 1,
    Username: "alice",
    UUID: "uuid-alice",
    GDPRConsent: true,
    GDPRConsentDate: "2026-01-01T10:00:00",
    role: "user",
    PasswordHash: validBcryptHash("a"),
  },
  {
    UserID: 2,
    Username: "bob",
    UUID: null,
    GDPRConsent: false,
    GDPRConsentDate: null,
    role: "doctor",
    PasswordHash: validBcryptHash("b"),
  },
  {
    UserID: 3,
    Username: "carol",
    UUID: null,
    GDPRConsent: false,
    GDPRConsentDate: null,
    role: "admin",
    PasswordHash: validBcryptHash("c"),
  },
];

function setup() {
  const gateway = new FakePersistenceGateway({ users: seedUsers });
  const hasher = fakePasswordHasher();
  return {
    gateway,
    hasher,
    repository: new SupabaseUserRepository(gateway, hasher),
  };
}

describe("SupabaseUserRepository", () => {
  it("lists with search, role and stable pagination without selecting PasswordHash", async () => {
    const { gateway, repository } = setup();

    const search = await repository.list({ search: "ali" });
    expect(search.users.map((user) => user.username)).toEqual(["alice"]);
    expect(search.total).toBe(1);

    const doctors = await repository.list({ role: "doctor" });
    expect(doctors.users.map((user) => user.username)).toEqual(["bob"]);

    const page = await repository.list({ limit: 2, offset: 1 });
    expect(page.users.map((user) => user.username)).toEqual(["bob", "carol"]);
    expect(page.total).toBe(3);

    for (const call of gateway.selectCalls) {
      expect(call.request.columns).not.toContain("PasswordHash");
    }
  });

  it("finds by canonical id and username, and fails closed for email", async () => {
    const { repository } = setup();
    await expect(repository.findById("1")).resolves.toMatchObject({
      id: "1",
      username: "alice",
      email: null,
      createdAt: null,
    });
    await expect(repository.findById("1;drop")).resolves.toBeNull();
    await expect(repository.findByUsername("bob")).resolves.toMatchObject({
      id: "2",
      role: "doctor",
    });
    await expect(repository.findByUsername("missing")).resolves.toBeNull();
    await expect(repository.findByEmail("alice@example.com")).resolves.toBeNull();
  });

  it("creates users with a 60-character bcrypt hash and coherent GDPR date", async () => {
    const { gateway, repository } = setup();
    const created = await repository.create({
      username: "dave",
      role: "user",
      gdprConsent: true,
      password: "plain-password",
    });

    expect(created).toMatchObject({
      username: "dave",
      email: null,
      createdAt: null,
      gdprConsent: true,
    });
    expect(created.id).toBe("4");
    expect(created.gdprConsentAt).not.toBeNull();

    const insert = gateway.insertCalls[0];
    expect(insert?.values.PasswordHash).toMatch(/^\$2[aby]\$/);
    expect(String(insert?.values.PasswordHash)).toHaveLength(60);
    expect(JSON.stringify(insert?.values)).not.toContain("plain-password");
    expect(insert?.values).not.toHaveProperty("UserID");
  });

  it("maps duplicate usernames to an explicit conflict", async () => {
    const { gateway, repository } = setup();
    gateway.insertError = uniqueViolation();
    await expect(
      repository.create({
        username: "alice",
        role: "user",
        gdprConsent: false,
        password: "plain-password",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updates through the transactional RPC and treats an empty patch as a read", async () => {
    const { gateway, repository } = setup();
    const updatedRow = {
      ...seedUsers[0],
      Username: "alice-new",
      role: "doctor",
      GDPRConsent: true,
      GDPRConsentDate: "2026-02-01T00:00:00",
    };
    gateway.rpcHandler = (name, args) => {
      expect(name).toBe("t009_update_user");
      expect(args).toMatchObject({
        p_user_id: 1,
        p_username: "alice-new",
        p_role: "doctor",
        p_gdpr_consent: true,
      });
      return [updatedRow];
    };

    const updated = await repository.update("1", {
      username: "alice-new",
      role: "doctor",
      gdprConsent: true,
    });
    expect(updated).toMatchObject({
      id: "1",
      username: "alice-new",
      role: "doctor",
    });

    const rpcCount = gateway.rpcCalls.length;
    await expect(repository.update("2", {})).resolves.toMatchObject({
      id: "2",
      username: "bob",
    });
    expect(gateway.rpcCalls).toHaveLength(rpcCount);
  });

  it("rejects invalid roles", async () => {
    const { repository } = setup();
    await expect(
      repository.update("1", { role: "owner" as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("clears UUID atomically and returns null for invalid ids", async () => {
    const { gateway, repository } = setup();
    const cleared = await repository.clearUuid("1");
    expect(cleared?.uuid).toBeNull();
    expect(gateway.updateCalls[0]).toMatchObject({
      table: "users",
      values: { UUID: null },
      match: { UserID: 1 },
    });
    await expect(repository.clearUuid("not-an-id")).resolves.toBeNull();
  });

  it("deletes through the RPC and maps USER_HAS_DATA to a conflict", async () => {
    const { gateway, repository } = setup();
    gateway.rpcHandler = () => true;
    await expect(repository.delete("1")).resolves.toBe(true);

    gateway.rpcHandler = () => false;
    await expect(repository.delete("1")).resolves.toBe(false);

    gateway.rpcError = userHasDataError();
    await expect(repository.delete("1")).rejects.toMatchObject({
      code: "USER_HAS_DATA",
      statusCode: 409,
    });
  });

  it("counts all users", async () => {
    const { repository } = setup();
    await expect(repository.count()).resolves.toBe(3);
  });
});

describe("credential and presence adapters", () => {
  it("returns a separate hash field and verifies by username only", async () => {
    const gateway = new FakePersistenceGateway({ users: seedUsers });
    const hasher = fakePasswordHasher(validBcryptHash("a"), "correct-password");
    const credentials = new SupabaseUserCredentialsRepository(gateway, hasher);

    const record = await credentials.findByUsername("alice");
    expect(record?.passwordHash).toHaveLength(60);
    expect(JSON.stringify(record?.user)).not.toContain(record?.passwordHash ?? "");

    await expect(
      credentials.verifyUsername("alice", "correct-password"),
    ).resolves.toMatchObject({ username: "alice" });
    await expect(credentials.verifyUsername("alice", "wrong")).resolves.toBeNull();
    await expect(credentials.verifyUsername("missing", "correct-password")).resolves.toBeNull();
    await expect(credentials.findByEmail("alice@example.com")).resolves.toBeNull();
    await expect(credentials.verifyEmail("alice@example.com", "correct-password")).resolves.toBeNull();
  });

  it("delegates presence to the SQL function", async () => {
    const gateway = new FakePersistenceGateway();
    gateway.rpcHandler = (name, args) => {
      expect(name).toBe("t009_user_has_health_data");
      expect(args).toEqual({ p_user_id: 9 });
      return true;
    };
    const presence = new SupabaseUserDataPresence(gateway);
    await expect(
      presence.hasAnyForUser({
        id: "9",
        username: "alice",
        email: null,
        role: "user",
        uuid: null,
        gdprConsent: false,
        gdprConsentAt: null,
        createdAt: null,
      }),
    ).resolves.toBe(true);
  });
});

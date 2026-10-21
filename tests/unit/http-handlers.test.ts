import { describe, expect, it } from "vitest";
import { createAdminDatabaseUseCases } from "@/server/application/admin/admin-database-use-cases";
import { createAuthUseCases } from "@/server/application/auth/auth-use-cases";
import { createDataUseCases } from "@/server/application/data/data-use-cases";
import { createUserUseCases } from "@/server/application/users/user-use-cases";
import { createHttpApi } from "@/server/http";
import { InMemoryAdminDatabaseRepository } from "@/server/infrastructure/testing/in-memory-admin-database-repository";
import { InMemoryHealthDataRepository } from "@/server/infrastructure/testing/in-memory-health-data-repository";
import { InMemoryUserDataPresence } from "@/server/infrastructure/testing/in-memory-user-data-presence";
import { InMemoryUserRepository } from "@/server/infrastructure/testing/in-memory-user-repository";
import { TestAuthGateway } from "@/server/infrastructure/testing/test-auth-gateway";
import { makeUser } from "../helpers/fixtures";

const admin = makeUser({
  id: "admin-1",
  username: "root",
  email: "root@example.com",
  role: "admin",
});
const doctor = makeUser({
  id: "doctor-1",
  username: "doctor",
  email: "doctor@example.com",
  role: "doctor",
});
const user = makeUser({
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  role: "user",
});

function setup() {
  const accounts = [
    {
      user: admin,
      password: "admin-secret",
      token: "admin-token",
      expiresAt: "2026-12-31T23:59:59.000Z",
    },
    {
      user: doctor,
      password: "doctor-secret",
      token: "doctor-token",
      expiresAt: "2026-12-31T23:59:59.000Z",
    },
    {
      user,
      password: "user-secret",
      token: "user-token",
      expiresAt: "2026-12-31T23:59:59.000Z",
    },
  ];
  const auth = createAuthUseCases(new TestAuthGateway(accounts));
  const users = createUserUseCases(
    new InMemoryUserRepository([admin, doctor, user]),
    new InMemoryUserDataPresence(),
  );
  const data = createDataUseCases(
    new InMemoryHealthDataRepository(),
    { now: () => new Date("2026-01-31T12:00:00.000Z") },
  );
  const adminDatabase = createAdminDatabaseUseCases(
    new InMemoryAdminDatabaseRepository({
      users: { records: [{ UserID: 1 }] },
    }),
  );
  const api = createHttpApi({ auth, users, data, adminDatabase });
  return { api };
}

function bodyOf(result: { body?: unknown }): Record<string, unknown> {
  return result.body as Record<string, unknown>;
}

describe("HTTP auth handlers", () => {
  it("logs in with email, exposes a session, and never returns credentials", async () => {
    const { api } = setup();
    const result = await api.auth.login({
      body: { email: "alice@example.com", password: "user-secret" },
    });

    expect(result.status).toBe(200);
    const body = bodyOf(result);
    expect(body.token).toBe("user-token");
    expect(JSON.stringify(body)).not.toContain("user-secret");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("hash");
  });

  it("returns 401 for bad credentials and 400 without echoing request secrets", async () => {
    const { api } = setup();

    const bad = await api.auth.login({
      body: { username: "alice", password: "wrong-password" },
    });
    expect(bad.status).toBe(401);
    expect(JSON.stringify(bad.body)).not.toContain("wrong-password");

    const invalid = await api.auth.login({
      body: {
        email: "alice@example.com",
        password: "do-not-echo-this",
        extra: "do-not-echo-this-either",
      },
    });
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(invalid.body)).not.toContain("do-not-echo-this");
  });

  it("requires a bearer token and revokes it on logout", async () => {
    const { api } = setup();

    const missing = await api.auth.session({ authorization: undefined });
    expect(missing.status).toBe(401);
    expect(missing.headers?.["WWW-Authenticate"]).toBe("Bearer");

    const session = await api.auth.session({ authorization: "Bearer user-token" });
    expect(session.status).toBe(200);

    expect(
      await api.auth.logout({ authorization: "Bearer user-token" }),
    ).toMatchObject({ status: 204 });

    const afterLogout = await api.auth.session({
      authorization: "Bearer user-token",
    });
    expect(afterLogout.status).toBe(401);
  });
});

describe("HTTP user handlers", () => {
  it("scopes user listing to self and blocks doctor writes", async () => {
    const { api } = setup();

    const list = await api.users.list({
      authorization: "Bearer user-token",
      query: {},
    });
    expect(list.status).toBe(200);
    expect(bodyOf(list)).toMatchObject({ total: 1 });
    const listed = bodyOf(list).users as Array<{ username: string }>;
    expect(listed.map((entry) => entry.username)).toEqual(["alice"]);

    const forbidden = await api.users.create({
      authorization: "Bearer doctor-token",
      body: { username: "new-user", password: "new-secret" },
    });
    expect(forbidden.status).toBe(403);
  });

  it("creates and clears UUIDs as admin without leaking the password", async () => {
    const { api } = setup();

    const created = await api.users.create({
      authorization: "Bearer admin-token",
      body: {
        username: "new-user",
        email: "new@example.com",
        password: "create-secret",
        role: "user",
        gdprConsent: true,
      },
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain("create-secret");
    expect(JSON.stringify(created.body)).not.toContain("password");

    const createdBody = bodyOf(created).user as { id: string };
    const cleared = await api.users.clearUuid({
      authorization: "Bearer admin-token",
      id: createdBody.id,
    });
    expect(cleared.status).toBe(200);
    expect((bodyOf(cleared).user as { uuid: string | null }).uuid).toBeNull();
  });
});

describe("HTTP data and admin handlers", () => {
  it("rejects user access to all data and returns all five arrays for self", async () => {
    const { api } = setup();

    const forbidden = await api.data.decrypted({
      authorization: "Bearer user-token",
      query: { selectedUser: "all" },
    });
    expect(forbidden.status).toBe(403);

    const own = await api.data.decrypted({
      authorization: "Bearer user-token",
      query: { selectedUser: "alice", selectedDataType: "all" },
    });
    expect(own.status).toBe(200);
    expect(Object.keys(bodyOf(own)).sort()).toEqual([
      "exerciseData",
      "foodData",
      "insulinData",
      "moodData",
      "periodData",
    ]);
  });

  it("keeps legacy single-type responses as arrays and protects admin routes", async () => {
    const { api } = setup();

    const legacy = await api.data.legacy({
      authorization: "Bearer user-token",
      query: { type: "insulin", range: "30" },
    });
    expect(legacy.status).toBe(200);
    expect(Array.isArray(legacy.body)).toBe(true);

    const doctor = await api.adminDatabase.tables({
      authorization: "Bearer doctor-token",
    });
    expect(doctor.status).toBe(403);

    const adminTables = await api.adminDatabase.tables({
      authorization: "Bearer admin-token",
    });
    expect(adminTables.status).toBe(200);
    expect(bodyOf(adminTables).success).toBe(true);

    const badTable = await api.adminDatabase.tableData({
      authorization: "Bearer admin-token",
      query: { table: "users;drop", limit: "10" },
    });
    expect(badTable.status).toBe(400);
  });
});

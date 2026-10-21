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
import { TestAuthGateway, type TestAccount } from "@/server/infrastructure/testing/test-auth-gateway";
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
  const accounts: TestAccount[] = [
    {
      user: admin,
      password: "admin-secret",
      token: "admin-token",
      method: "username",
      expiresAt: "2026-12-31T23:59:59.000Z",
    },
    {
      user: doctor,
      password: "doctor-secret",
      token: "doctor-token",
      method: "username",
      expiresAt: "2026-12-31T23:59:59.000Z",
    },
    {
      user,
      password: "user-secret",
      token: "user-token",
      method: "email",
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
    expect(body).toMatchObject({ method: "email" });
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("user-secret");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("hash");

    const cookie = result.cookies?.[0];
    expect(cookie).toMatchObject({
      name: "dashboard_session",
      value: "user-token",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });

    const byUsername = await api.auth.login({
      body: { username: "alice", password: "user-secret" },
    });
    expect(byUsername.status).toBe(200);
    expect(bodyOf(byUsername).method).toBe("username");
    expect(byUsername.body).not.toHaveProperty("token");
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

  it("requires the session cookie, refreshes it, and clears it on logout", async () => {
    const { api } = setup();

    const missing = await api.auth.session({ sessionToken: undefined });
    expect(missing.status).toBe(401);
    expect(missing.headers?.["WWW-Authenticate"]).toBeUndefined();

    const session = await api.auth.session({ sessionToken: "user-token" });
    expect(session.status).toBe(200);
    expect(bodyOf(session)).toMatchObject({ method: "email" });
    expect(session.cookies?.[0]).toMatchObject({
      name: "dashboard_session",
      value: "user-token",
      httpOnly: true,
    });

    const logout = await api.auth.logout({ sessionToken: "user-token" });
    expect(logout.status).toBe(204);
    expect(logout.cookies?.[0]).toMatchObject({
      name: "dashboard_session",
      value: "",
      maxAge: 0,
      httpOnly: true,
    });

    const afterLogout = await api.auth.session({
      sessionToken: "user-token",
    });
    expect(afterLogout.status).toBe(401);

    const invalidLogout = await api.auth.logout({ sessionToken: "unknown-token" });
    expect(invalidLogout.status).toBe(204);
    expect(invalidLogout.cookies?.[0]?.maxAge).toBe(0);
  });
});

describe("HTTP user handlers", () => {
  it("scopes user listing to self and blocks doctor writes", async () => {
    const { api } = setup();

    const list = await api.users.list({
      sessionToken: "user-token",
      query: {},
    });
    expect(list.status).toBe(200);
    expect(bodyOf(list)).toMatchObject({ total: 1 });
    const listed = bodyOf(list).users as Array<{ username: string }>;
    expect(listed.map((entry) => entry.username)).toEqual(["alice"]);

    const forbidden = await api.users.create({
      sessionToken: "doctor-token",
      body: { username: "new-user", password: "new-secret" },
    });
    expect(forbidden.status).toBe(403);
  });

  it("creates and clears UUIDs as admin without leaking the password", async () => {
    const { api } = setup();

    const created = await api.users.create({
      sessionToken: "admin-token",
      body: {
        username: "new-user",
        email: null,
        password: "create-secret",
        role: "user",
        gdprConsent: true,
      },
    });
    expect(created.status).toBe(201);
    expect((bodyOf(created).user as { email: string | null }).email).toBeNull();
    expect(JSON.stringify(created.body)).not.toContain("create-secret");
    expect(JSON.stringify(created.body)).not.toContain("password");

    const createdBody = bodyOf(created).user as { id: string };
    const cleared = await api.users.clearUuid({
      sessionToken: "admin-token",
      id: createdBody.id,
    });
    expect(cleared.status).toBe(200);
    expect((bodyOf(cleared).user as { uuid: string | null }).uuid).toBeNull();
  });
});

describe("HTTP data and admin handlers", () => {
  it("normalizes user selectedUser=all to self and returns five arrays", async () => {
    const { api } = setup();

    const normalized = await api.data.decrypted({
      sessionToken: "user-token",
      query: { selectedUser: "all" },
    });
    expect(normalized.status).toBe(200);

    const own = await api.data.decrypted({
      sessionToken: "user-token",
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
      sessionToken: "user-token",
      query: { type: "insulin", range: "30" },
    });
    expect(legacy.status).toBe(200);
    expect(Array.isArray(legacy.body)).toBe(true);

    const doctor = await api.adminDatabase.tables({
      sessionToken: "doctor-token",
    });
    expect(doctor.status).toBe(403);

    const adminTables = await api.adminDatabase.tables({
      sessionToken: "admin-token",
    });
    expect(adminTables.status).toBe(200);
    expect(bodyOf(adminTables).success).toBe(true);

    const badTable = await api.adminDatabase.tableData({
      sessionToken: "admin-token",
      query: { table: "users;drop", limit: "10" },
    });
    expect(badTable.status).toBe(400);
  });
});

describe("username and email request contract", () => {
  it("accepts 100-character usernames and rejects 101 for login", async () => {
    const { api } = setup();
    const hundred = "u".repeat(100);

    const accepted = await api.auth.login({
      body: { username: hundred, password: "not-a-real-password" },
    });
    expect(accepted.status).toBe(401);

    const rejected = await api.auth.login({
      body: { username: "u".repeat(101), password: "not-a-real-password" },
    });
    expect(rejected.status).toBe(400);
  });

  it("enforces 100/101 on create and update", async () => {
    const { api } = setup();

    const tooLongCreate = await api.users.create({
      sessionToken: "admin-token",
      body: { username: "u".repeat(101), password: "secret" },
    });
    expect(tooLongCreate.status).toBe(400);

    const created = await api.users.create({
      sessionToken: "admin-token",
      body: { username: "u".repeat(100), password: "secret" },
    });
    expect(created.status).toBe(201);
    const id = (bodyOf(created).user as { id: string }).id;

    const tooLongUpdate = await api.users.update({
      sessionToken: "admin-token",
      id,
      body: { username: "v".repeat(101) },
    });
    expect(tooLongUpdate.status).toBe(400);

    const acceptedUpdate = await api.users.update({
      sessionToken: "admin-token",
      id,
      body: { username: "v".repeat(100) },
    });
    expect(acceptedUpdate.status).toBe(200);
  });

  it("accepts omitted/null email but rejects new email strings", async () => {
    const { api } = setup();

    const omitted = await api.users.create({
      sessionToken: "admin-token",
      body: { username: "no-email-user", password: "secret" },
    });
    expect(omitted.status).toBe(201);
    expect((bodyOf(omitted).user as { email: string | null }).email).toBeNull();

    const nullEmail = await api.users.create({
      sessionToken: "admin-token",
      body: { username: "null-email-user", password: "secret", email: null },
    });
    expect(nullEmail.status).toBe(201);
    expect((bodyOf(nullEmail).user as { email: string | null }).email).toBeNull();

    const stringEmail = await api.users.create({
      sessionToken: "admin-token",
      body: {
        username: "string-email-user",
        password: "secret",
        email: "new@example.com",
      },
    });
    expect(stringEmail.status).toBe(400);

    const id = (bodyOf(nullEmail).user as { id: string }).id;
    const updateNull = await api.users.update({
      sessionToken: "admin-token",
      id,
      body: { email: null },
    });
    expect(updateNull.status).toBe(200);
    expect((bodyOf(updateNull).user as { email: string | null }).email).toBeNull();

    const updateString = await api.users.update({
      sessionToken: "admin-token",
      id,
      body: { email: "changed@example.com" },
    });
    expect(updateString.status).toBe(400);
  });
});

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import {
  assertNoTokens,
  assertSessionCookie,
  baseUrl,
  enabled,
  loginEmail,
  loginUsername,
  logout,
  problemCode,
  request,
  session,
} from "./support/http.mjs";
import {
  admin,
  bcryptUser,
  doctor,
  runId,
  user,
  userWithData,
} from "./support/fixtures.mjs";

const suite = enabled ? describe : describe.skip;
const strictSeeds = process.env.ACCEPTANCE_STRICT_SEEDS === '1';
const USER_KEYS = [
  "createdAt",
  "email",
  "gdprConsent",
  "gdprConsentAt",
  "id",
  "role",
  "username",
  "uuid",
];

function assertStatus(result, expected, label) {
  assert.equal(
    result.status,
    expected,
    `${label}: expected ${expected}, got ${result.status}: ${result.text.slice(0, 300)}`,
  );
}

function assertProblem(result, status, code) {
  assertStatus(result, status, code);
  assert.match(
    result.headers.get("content-type") ?? "",
    /application\/(problem\+)?json/i,
  );
  assert.equal(problemCode(result.body), code);
}

function assertUserShape(value) {
  assert.ok(value && typeof value === "object", "user must be an object");
  assert.deepEqual(Object.keys(value).sort(), USER_KEYS);
  assert.equal(typeof value.id, "string");
  assert.equal(typeof value.username, "string");
  assert.equal(typeof value.role, "string");
  assert.equal(typeof value.gdprConsent, "boolean");
  assert.ok(value.email === null || typeof value.email === "string");
  assert.ok(value.uuid === null || typeof value.uuid === "string");
  assert.ok(value.gdprConsentAt === null || typeof value.gdprConsentAt === "string");
  assert.ok(value.createdAt === null || typeof value.createdAt === "string");
  assert.equal(Object.hasOwn(value, "passwordHash"), false);
  assert.equal(Object.hasOwn(value, "PasswordHash"), false);
}

function assertSessionBody(result, expectedMethod) {
  assertStatus(result, 200, "session");
  assertNoTokens(result.body);
  assertUserShape(result.body.user);
  assert.equal(result.body.method, expectedMethod);
  assert.ok(Number.isFinite(Date.parse(result.body.expiresAt)));
  assert.ok(Date.parse(result.body.expiresAt) > Date.now());
}

async function createUser(adminCookie, payload) {
  const result = await request("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: payload,
  });
  assertStatus(result, 201, "create user");
  assertUserShape(result.body?.user);
  return result.body.user;
}

suite("API acceptance: final cookie contract", () => {
  let adminCookie = "";
  let adminUser = null;
  let doctorCookie = "";
  let doctorUser = null;
  let userCookie = "";
  let userAccount = null;

  before(async () => {
    assert.ok(baseUrl, "ACCEPTANCE_BASE_URL must point at the disposable backend");
    if (process.env.ACCEPTANCE_RESET_URL) {
      const reset = await fetch(process.env.ACCEPTANCE_RESET_URL, { method: "POST" });
      assert.ok(reset.ok, `Reset stand-in failed: ${reset.status}`);
    }
    const login = await loginEmail(admin.email, admin.password);
    assertSessionBody(login, "email");
    assert.match(login.setCookies.map((item) => item.raw).join("\n"), /httponly/i);
    adminCookie = assertSessionCookie(login);
    adminUser = login.body.user;
    assert.equal(adminUser.role, "admin");

    doctorUser = await createUser(adminCookie, {
      username: doctor.username,
      password: doctor.password,
      role: "doctor",
    });
    userAccount = await createUser(adminCookie, {
      username: user.username,
      password: user.password,
      role: "user",
    });

    const doctorLogin = await loginUsername(doctor.username, doctor.password);
    assertSessionBody(doctorLogin, "username");
    doctorCookie = assertSessionCookie(doctorLogin);

    const userLogin = await loginUsername(user.username, user.password);
    assertSessionBody(userLogin, "username");
    userCookie = assertSessionCookie(userLogin);
  });

  after(async () => {
    if (!adminCookie) return;
    for (const id of [doctorUser?.id, userAccount?.id].filter(Boolean)) {
      await request(`/api/users/${encodeURIComponent(id)}`, {
        method: "DELETE",
        cookie: adminCookie,
      }).catch(() => undefined);
    }
    await logout(adminCookie).catch(() => undefined);
  });

  test("email login returns a cookie-shaped session, not a token", async () => {
    const result = await loginEmail(admin.email, admin.password);
    assertSessionBody(result, "email");
    assertSessionCookie(result);
    assert.equal(result.body.user.role, "admin");
    assert.equal(JSON.stringify(result.body).includes("access_token"), false);
    assert.equal(JSON.stringify(result.body).includes("refresh_token"), false);
  });

  test("session reads the cookie and rejects bearer-only access", async () => {
    const viaCookie = await session(adminCookie);
    assertSessionBody(viaCookie, "email");
    assert.equal(viaCookie.body.user.id, adminUser.id);

    const viaBearer = await request("/api/auth/session", {
      headers: { authorization: "Bearer synthetic-bearer-must-not-work" },
    });
    assertProblem(viaBearer, 401, "UNAUTHORIZED");
  });

  test("invalid credentials return 401 without a cookie", async () => {
    const wrongEmail = await loginEmail(admin.email, "wrong-acceptance-password");
    assertProblem(wrongEmail, 401, "UNAUTHORIZED");
    assert.equal(wrongEmail.setCookies.length, 0);

    const wrongUsername = await loginUsername(user.username, "wrong-acceptance-password");
    assertProblem(wrongUsername, 401, "UNAUTHORIZED");
    assert.equal(wrongUsername.setCookies.length, 0);

    const missing = await request("/api/users");
    assertProblem(missing, 401, "UNAUTHORIZED");
  });

  test("username login returns the same final session shape", async () => {
    const result = await loginUsername(user.username, user.password);
    assertSessionBody(result, "username");
    assertSessionCookie(result);
    assert.equal(result.body.user.id, userAccount.id);
    assert.equal(result.body.user.role, "user");
  });

  test("user DTOs are camelCase and never contain credentials", async () => {
    assertUserShape(adminUser);
    assertUserShape(doctorUser);
    assertUserShape(userAccount);
    const raw = JSON.stringify(doctorUser);
    assert.equal(raw.includes("PasswordHash"), false);
    assert.equal(raw.includes("passwordHash"), false);
  });

  test("users, count and filters enforce role scope", async () => {
    const adminList = await request("/api/users?limit=100", { cookie: adminCookie });
    assertStatus(adminList, 200, "admin list users");
    assert.ok(Array.isArray(adminList.body.users));
    assert.ok(adminList.body.total >= 3);
    assert.ok(adminList.body.users.some((item) => item.id === doctorUser.id));

    const doctorList = await request("/api/users?limit=100", { cookie: doctorCookie });
    assertStatus(doctorList, 200, "doctor list users");
    assert.ok(doctorList.body.total >= 3);

    const selfList = await request("/api/users", { cookie: userCookie });
    assertStatus(selfList, 200, "user list users");
    assert.equal(selfList.body.total, 1);
    assert.equal(selfList.body.users.length, 1);
    assert.equal(selfList.body.users[0].id, userAccount.id);

    const selfCount = await request("/api/users/count", { cookie: userCookie });
    assertStatus(selfCount, 200, "user count");
    assert.equal(selfCount.body.count, 1);

    const adminCount = await request("/api/users/count", { cookie: adminCookie });
    assertStatus(adminCount, 200, "admin count");
    assert.ok(adminCount.body.count >= 3);

    const search = await request(
      `/api/users?search=${encodeURIComponent(user.username)}&role=user&limit=1&offset=0`,
      { cookie: adminCookie },
    );
    assertStatus(search, 200, "filtered users");
    assert.ok(Array.isArray(search.body.users));
    assert.ok(search.body.users.length <= 1);
    assert.ok(search.body.total >= 1);

    assertProblem(
      await request("/api/users?role=superuser", { cookie: adminCookie }),
      400,
      "VALIDATION_ERROR",
    );
    assertProblem(
      await request("/api/users?limit=0", { cookie: adminCookie }),
      400,
      "VALIDATION_ERROR",
    );
  });

  test("user cannot read another profile (IDOR)", async () => {
    const own = await request(`/api/users/${encodeURIComponent(userAccount.id)}`, {
      cookie: userCookie,
    });
    assertStatus(own, 200, "user own profile");
    assert.equal(own.body.user.id, userAccount.id);

    const other = await request(`/api/users/${encodeURIComponent(doctorUser.id)}`, {
      cookie: userCookie,
    });
    assertProblem(other, 403, "FORBIDDEN");

    const missing = await request("/api/users/does-not-exist", { cookie: userCookie });
    assert.notEqual(missing.status, 200);
  });

  test("health data is scoped by role and filters are validated", async () => {
    const own = await request(
      `/api/decrypted-data?selectedUser=${encodeURIComponent(user.username)}&timeRange=all`,
      { cookie: userCookie },
    );
    assertStatus(own, 200, "user own data");
    for (const key of ["insulinData", "foodData", "exerciseData", "periodData", "moodData"]) {
      assert.ok(Array.isArray(own.body[key]), `${key} must be an array`);
    }

    for (const target of ["all", doctor.username, bcryptUser.username]) {
      const scoped = await request(
        `/api/decrypted-data?selectedUser=${encodeURIComponent(target)}&timeRange=all`,
        { cookie: userCookie },
      );
      assertStatus(scoped, 200, "user data normalization");
      for (const rows of Object.values(scoped.body)) {
        for (const row of rows) {
          assert.equal(
            row.username,
            user.username,
            "user must never receive another user's health rows",
          );
        }
      }
    }

    // Literal username "all" must not become the privileged all-users scope.
    const allUser = await createUser(adminCookie, {
      username: "all",
      password: "Acceptance-All-1!",
      role: "user",
    });
    const allLogin = await loginUsername("all", "Acceptance-All-1!");
    assertSessionBody(allLogin, "username");
    const allCookie = assertSessionCookie(allLogin);
    const allScoped = await request(
      "/api/decrypted-data?selectedUser=all&timeRange=all",
      { cookie: allCookie },
    );
    assertStatus(allScoped, 200, "literal all decrypted data");
    for (const rows of Object.values(allScoped.body)) {
      for (const row of rows) {
        assert.equal(row.username, "all", "literal all must stay self-scoped");
        assert.notEqual(row.username, userWithData.username);
      }
    }
    const allLegacy = await request("/api/data?type=all&range=365", {
      cookie: allCookie,
    });
    assertStatus(allLegacy, 200, "literal all legacy data");
    for (const rows of Object.values(allLegacy.body)) {
      for (const row of rows) {
        assert.equal(row.username, "all", "literal all legacy must stay self-scoped");
      }
    }
    assert.equal(allUser.username, "all");

    const doctorAll = await request("/api/decrypted-data?selectedUser=all&timeRange=all", {
      cookie: doctorCookie,
    });
    assertStatus(doctorAll, 200, "doctor data");
    assert.deepEqual(Object.keys(doctorAll.body).sort(), [
      "exerciseData",
      "foodData",
      "insulinData",
      "moodData",
      "periodData",
    ]);

    const adminForUser = await request(
      `/api/decrypted-data?selectedUser=${encodeURIComponent(user.username)}&dateFilter=2025-01-01&timeRange=all`,
      { cookie: adminCookie },
    );
    assertStatus(adminForUser, 200, "admin filtered data");
    for (const rows of Object.values(adminForUser.body)) {
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          assert.equal(/_iv$|ciphertext|encrypted/i.test(key), false, `decrypted row leaked ${key}`);
        }
      }
    }

    assertProblem(
      await request("/api/decrypted-data?timeRange=1d", { cookie: adminCookie }),
      400,
      "VALIDATION_ERROR",
    );
    assertProblem(
      await request("/api/decrypted-data?dateFilter=not-a-date", { cookie: adminCookie }),
      400,
      "VALIDATION_ERROR",
    );

    const legacyAll = await request("/api/data?type=all&range=30", { cookie: userCookie });
    assertStatus(legacyAll, 200, "legacy data all");
    assert.deepEqual(Object.keys(legacyAll.body).sort(), ["exercise", "insulin", "meal", "mood"]);
    const legacyOne = await request("/api/data?type=insulin&range=30", { cookie: userCookie });
    assertStatus(legacyOne, 200, "legacy data one type");
    assert.ok(Array.isArray(legacyOne.body));
    assertProblem(
      await request("/api/data?type=invalid", { cookie: userCookie }),
      400,
      "VALIDATION_ERROR",
    );
    assertProblem(
      await request("/api/data?range=0", { cookie: userCookie }),
      400,
      "VALIDATION_ERROR",
    );
  });

  test("dateFilter applies to the selected calendar day, not start-to-now", async (t) => {
    const login = await loginUsername(bcryptUser.username, bcryptUser.password);
    if (login.status === 401) {
      const message = `Seed bcrypt user '${bcryptUser.username}' with two rows on 2026-01-10 to run the day filter`;
      if (strictSeeds) assert.fail(message);
      return t.skip(message);
    }
    assertSessionBody(login, "username");
    const cookie = assertSessionCookie(login);

    const day = await request(
      `/api/decrypted-data?selectedUser=${encodeURIComponent(bcryptUser.username)}&dateFilter=2026-01-10&timeRange=all`,
      { cookie },
    );
    assertStatus(day, 200, "dateFilter day");
    assert.equal(day.body.insulinData.length, 2);
    assert.ok(
      day.body.insulinData.every((row) => String(row.date_time).startsWith("2026-01-10")),
      "dateFilter must not leak the next day",
    );
  });

  test("admin endpoints are admin-only and never expose PasswordHash", async () => {
    const tables = await request("/api/admin/database/tables", { cookie: adminCookie });
    assertStatus(tables, 200, "admin tables");
    assert.equal(tables.body.success, true);
    assert.ok(Array.isArray(tables.body.tables));
    assert.equal(typeof tables.body.totalCount, "number");

    const tableData = await request("/api/admin/database/table-data?table=users&limit=2", {
      cookie: adminCookie,
    });
    assertStatus(tableData, 200, "admin users table");
    assert.equal(tableData.body.success, true);
    for (const row of tableData.body.data) {
      assert.equal(Object.hasOwn(row, "PasswordHash"), false);
      assert.equal(Object.hasOwn(row, "passwordHash"), false);
    }

    assertProblem(
      await request("/api/admin/database/tables", { cookie: doctorCookie }),
      403,
      "FORBIDDEN",
    );
    assertProblem(
      await request("/api/admin/database/tables", { cookie: userCookie }),
      403,
      "FORBIDDEN",
    );
    assertProblem(
      await request("/api/admin/database/table-data?table=Users", { cookie: adminCookie }),
      400,
      "VALIDATION_ERROR",
    );
    const notAllowed = await request("/api/admin/database/table-data?table=pg_catalog", {
      cookie: adminCookie,
    });
    assert.ok([400, 404].includes(notAllowed.status), "non-allowlisted table must not return 200");

    assertProblem(
      await request(`/api/users/${encodeURIComponent(userAccount.id)}`, {
        method: "PATCH",
        cookie: doctorCookie,
        body: { role: "admin" },
      }),
      403,
      "FORBIDDEN",
    );
  });

  test("role change is enforced on an existing session", async () => {
    const beforeChange = await request("/api/decrypted-data?selectedUser=all&timeRange=all", {
      cookie: doctorCookie,
    });
    assertStatus(beforeChange, 200, "doctor global before downgrade");

    const downgrade = await request(`/api/users/${encodeURIComponent(doctorUser.id)}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "user" },
    });
    assertStatus(downgrade, 200, "downgrade doctor");
    assert.equal(downgrade.body.user.role, "user");

    const afterChange = await request("/api/decrypted-data?selectedUser=all&timeRange=all", {
      cookie: doctorCookie,
    });
    assertStatus(afterChange, 200, "downgraded doctor data");
    for (const rows of Object.values(afterChange.body)) {
      for (const row of rows) {
        assert.equal(
          row.username,
          doctor.username,
          "downgraded doctor must only receive self-scoped rows",
        );
      }
    }
  });

  test("admin user mutations, duplicate conflict and UUID clearing", async () => {
    const updated = await request(`/api/users/${encodeURIComponent(userAccount.id)}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { gdprConsent: true },
    });
    assertStatus(updated, 200, "update user");
    assert.equal(updated.body.user.gdprConsent, true);

    const duplicate = await request("/api/users", {
      method: "POST",
      cookie: adminCookie,
      body: {
        username: user.username,
        password: "Acceptance-Duplicate-1!",
        role: "user",
      },
    });
    assertProblem(duplicate, 409, "CONFLICT");

    assertProblem(
      await request(`/api/users/${encodeURIComponent(userAccount.id)}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: {},
      }),
      400,
      "VALIDATION_ERROR",
    );

    const clearUuid = await request(
      `/api/users/${encodeURIComponent(userAccount.id)}/uuid`,
      { method: "DELETE", cookie: adminCookie },
    );
    assertStatus(clearUuid, 200, "clear uuid");
    assert.equal(clearUuid.body.user.uuid, null);

    assertProblem(
      await request("/api/users", {
        method: "POST",
        cookie: doctorCookie,
        body: { username: `forbidden.${runId}`, password: "Acceptance-Forbidden-1!" },
      }),
      403,
      "FORBIDDEN",
    );
    assertProblem(
      await request(`/api/users/${encodeURIComponent(userAccount.id)}`, {
        method: "DELETE",
        cookie: userCookie,
      }),
      403,
      "FORBIDDEN",
    );
  });

  test("delete user with health data returns 409", async (t) => {
    const found = await request(
      `/api/users?search=${encodeURIComponent(userWithData.username)}&limit=1`,
      { cookie: adminCookie },
    );
    assertStatus(found, 200, "find seeded user with data");
    const target = found.body.users?.[0];
    if (!target) {
      const message = `Seed a user '${userWithData.username}' with health data to run the 409 case`;
      if (strictSeeds) assert.fail(message);
      return t.skip(message);
    }
    const deleted = await request(`/api/users/${encodeURIComponent(target.id)}`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    assertProblem(deleted, 409, "USER_HAS_DATA");
    const stillThere = await request(`/api/users/${encodeURIComponent(target.id)}`, {
      cookie: adminCookie,
    });
    assertStatus(stillThere, 200, "user with data remains");
  });

  test("deleting accounts revokes their sessions", async () => {
    assertStatus(
      await request(`/api/users/${encodeURIComponent(userAccount.id)}`, {
        method: "DELETE",
        cookie: adminCookie,
      }),
      204,
      "delete user",
    );
    assertProblem(await session(userCookie), 401, "UNAUTHORIZED");

    assertStatus(
      await request(`/api/users/${encodeURIComponent(doctorUser.id)}`, {
        method: "DELETE",
        cookie: adminCookie,
      }),
      204,
      "delete doctor",
    );
    assertProblem(await session(doctorCookie), 401, "UNAUTHORIZED");
    userAccount = null;
    doctorUser = null;
  });

  test("logout is 204 and invalidates the old cookie", async () => {
    const cleared = await logout(adminCookie);
    assertStatus(cleared, 204, "logout");
    assert.ok(
      cleared.setCookies.some((item) => item.maxAge === "0"),
      "logout must clear the cookie with Max-Age=0",
    );
    assertProblem(await session(adminCookie), 401, "UNAUTHORIZED");
    adminCookie = "";
  });
});

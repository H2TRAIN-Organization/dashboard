/**
 * Local Supabase dependency stand-in for acceptance runs.
 *
 * This is not a mock of the dashboard. It serves the official Supabase Auth
 * and PostgREST shapes consumed by the backend under test. All records are
 * synthetic. It is intentionally local-only and must never be deployed.
 */
const http = require("http");

const PORT = Number(process.env.PORT || 4910);
const JSON_HEADER = { "Content-Type": "application/json" };
const PUBLIC_SCHEMA_TABLES = [
  "users",
  "insulindata",
  "fooddata",
  "exercisedata",
  "periodrecords",
  "mooddata",
  "polar_data",
  "auth_sessions",
  "auth_login_limits",
];
const HEALTH_TABLES = ["insulindata", "fooddata", "exercisedata", "periodrecords", "mooddata"];
const RESERVED_QUERY = new Set(["select", "order", "limit", "offset", "apikey"]);

// Synthetic bcrypt fixtures at the observed legacy cost. Passwords are
// disposable and only exist to exercise the real adapter.
const BCRYPT_ADMIN_HASH = "$2b$10$nNB7TQo/mLQVrlmq5ZaU/.Utgvk9WlTYvzpmM3xnAeUIiU7ikAyaK";
const BCRYPT_USER_HASH = "$2b$10$VBD1lpIoHpJeFenz2/VWTuupW.ZnCPwPpAordaXb4Vt8EJ7IgKen.";
const NON_BCRYPT_HASH = "a".repeat(64);

function seed() {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    users: [
      {
        UserID: 1,
        Username: "admin.acceptance@example.test",
        PasswordHash: BCRYPT_ADMIN_HASH,
        UUID: null,
        GDPRConsent: true,
        GDPRConsentDate: now,
        sexo: null,
        bomba_insulina: false,
        role: "admin",
        created_at: now,
      },
      {
        UserID: 2,
        Username: "acceptance.hasdata",
        PasswordHash: NON_BCRYPT_HASH,
        UUID: null,
        GDPRConsent: true,
        GDPRConsentDate: now,
        sexo: null,
        bomba_insulina: false,
        role: "user",
        created_at: now,
      },
      {
        UserID: 3,
        Username: "acceptance.bcrypt",
        PasswordHash: BCRYPT_USER_HASH,
        UUID: null,
        GDPRConsent: true,
        GDPRConsentDate: now,
        sexo: null,
        bomba_insulina: false,
        role: "user",
        created_at: now,
      },
    ],
    insulindata: [
      {
        id: "seed-insulin-1",
        username: "acceptance.hasdata",
        insulinType: "__PLAIN__rapid",
        dose: "__PLAIN__4",
        date_time: "2026-01-10T08:00:00.000Z",
        insulintype_iv: null,
        dose_iv: null,
      },
      {
        id: "seed-bcrypt-1",
        username: "acceptance.bcrypt",
        insulinType: "__PLAIN__rapid",
        dose: "__PLAIN__2",
        date_time: "2026-01-10T08:00:00.000Z",
        insulintype_iv: null,
        dose_iv: null,
      },
      {
        id: "seed-bcrypt-2",
        username: "acceptance.bcrypt",
        insulinType: "__PLAIN__rapid",
        dose: "__PLAIN__3",
        date_time: "2026-01-10T23:30:00.000Z",
        insulintype_iv: null,
        dose_iv: null,
      },
      {
        id: "seed-bcrypt-3",
        username: "acceptance.bcrypt",
        insulinType: "__PLAIN__rapid",
        dose: "__PLAIN__4",
        date_time: "2026-01-11T08:00:00.000Z",
        insulintype_iv: null,
        dose_iv: null,
      },
      {
        id: "seed-bcrypt-boundary",
        username: "acceptance.bcrypt",
        insulinType: "__PLAIN__rapid",
        dose: "__PLAIN__1",
        date_time: "2026-01-11T00:00:00.000Z",
        insulintype_iv: null,
        dose_iv: null,
      },
      {
        id: "seed-all-user",
        username: "all",
        insulinType: "__PLAIN__rapid",
        dose: "__PLAIN__5",
        date_time: "2026-01-12T08:00:00.000Z",
        insulintype_iv: null,
        dose_iv: null,
      },
    ],
    fooddata: [],
    exercisedata: [],
    periodrecords: [],
    mooddata: [],
    polar_data: [],
    auth_sessions: [],
    auth_login_limits: [],
    authAccounts: [
      {
        authId: "11111111-1111-4111-8111-111111111111",
        email: "admin.acceptance@example.test",
        password: "Acceptance-Admin-1!",
        appUserId: "1",
        role: "admin",
      },
    ],
    authSessions: {},
  };
}

async function getDb() {
  let db = await pm.state.get("supabase");
  if (!db) {
    db = seed();
    await pm.state.set("supabase", db);
  }
  return db;
}

async function saveDb(db) {
  await pm.state.set("supabase", db);
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...JSON_HEADER,
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}

function parseCondition(value) {
  const dot = value.indexOf(".");
  if (dot === -1) return null;
  return { operator: value.slice(0, dot), operand: value.slice(dot + 1) };
}

function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (RESERVED_QUERY.has(key) || key === "or" || key === "and") continue;
    const condition = parseCondition(value);
    if (!condition) continue;
    const actual = row[key];
    const normalized = actual === undefined ? null : actual;
    if (condition.operator === "eq" && String(actual) !== condition.operand) return false;
    if (condition.operator === "neq" && String(actual) === condition.operand) return false;
    if (condition.operator === "is" && condition.operand === "null" && normalized !== null) return false;
    if (condition.operator === "is" && condition.operand === "not.null" && normalized === null) return false;
    if (condition.operator === "not" && condition.operand === "is.null" && normalized === null) return false;
    if (condition.operator === "gte" && String(actual ?? "") < condition.operand) return false;
    if (condition.operator === "gt" && String(actual ?? "") <= condition.operand) return false;
    if (condition.operator === "lte" && String(actual ?? "") > condition.operand) return false;
    if (condition.operator === "lt" && String(actual ?? "") >= condition.operand) return false;
    if (condition.operator === "like" || condition.operator === "ilike") {
      const needle = condition.operand.replaceAll("%", "").toLowerCase();
      if (!String(actual ?? "").toLowerCase().includes(needle)) return false;
    }
  }

  const or = params.get("or");
  if (or) {
    const inner = or.replace(/^\(/, "").replace(/\)$/, "");
    const alternatives = inner
      .split(",")
      .map((part) => part.trim().match(/^([^.]+)\.eq\.(.*)$/))
      .filter(Boolean);
    if (alternatives.length > 0) {
      const any = alternatives.some((match) => String(row[match[1]]) === match[2]);
      if (!any) return false;
    }
  }
  return true;
}

function project(row, select) {
  if (!select || select === "*") return row;
  const fields = select.split(",").map((item) => item.trim()).filter(Boolean);
  const result = {};
  for (const field of fields) {
    if (Object.hasOwn(row, field)) result[field] = row[field];
  }
  return result;
}

function pageRows(rows, params) {
  const order = params.get("order");
  let ordered = [...rows];
  if (order) {
    const [field, direction] = order.split(".");
    ordered.sort((a, b) => {
      const result = String(a[field] ?? "").localeCompare(String(b[field] ?? ""));
      return direction === "desc" ? -result : result;
    });
  }
  const limit = params.has("limit") ? Number(params.get("limit")) : ordered.length;
  const offset = Number(params.get("offset") || 0);
  return ordered.slice(offset, offset + limit);
}

function contentRange(rows, page, offset) {
  if (page.length === 0) return `*/${rows.length}`;
  return `${offset}-${offset + page.length - 1}/${rows.length}`;
}

function objectRequest(req) {
  return String(req.headers.accept || "").includes("application/vnd.pgrst.object+json");
}

function returnRepresentation(req) {
  return String(req.headers.prefer || "").includes("return=representation");
}

function countRequested(req) {
  return String(req.headers.prefer || "").includes("count=exact");
}

async function readTable(db, table) {
  if (table === "users") return db.users;
  if (PUBLIC_SCHEMA_TABLES.includes(table)) return db[table];
  return null;
}

function consumeRateLimit(db, body) {
  if (
    typeof body.p_key_hash !== "string" ||
    body.p_key_hash.length < 16 ||
    !Number.isInteger(body.p_window_seconds) ||
    !Number.isInteger(body.p_max_attempts) ||
    !Number.isInteger(body.p_block_seconds) ||
    body.p_window_seconds < 1 ||
    body.p_max_attempts < 1 ||
    body.p_block_seconds < 1
  ) {
    return null;
  }
  const now = Date.now();
  let row = db.auth_login_limits.find((item) => item.key_hash === body.p_key_hash);
  if (!row) {
    row = {
      key_hash: body.p_key_hash,
      window_started_at: new Date(now).toISOString(),
      failures: 1,
      blocked_until: null,
      updated_at: new Date(now).toISOString(),
    };
    db.auth_login_limits.push(row);
    return { allowed: true, retry_after_seconds: 0, remaining: body.p_max_attempts - 1 };
  }
  if (row.blocked_until && Date.parse(row.blocked_until) > now) {
    return {
      allowed: false,
      retry_after_seconds: Math.ceil((Date.parse(row.blocked_until) - now) / 1000),
      remaining: 0,
    };
  }
  const windowExpired =
    !row.window_started_at ||
    Date.parse(row.window_started_at) <= now - body.p_window_seconds * 1000;
  if (row.blocked_until || windowExpired) {
    row.window_started_at = new Date(now).toISOString();
    row.failures = 1;
    row.blocked_until = null;
    row.updated_at = new Date(now).toISOString();
    return { allowed: true, retry_after_seconds: 0, remaining: body.p_max_attempts - 1 };
  }
  row.failures += 1;
  row.updated_at = new Date(now).toISOString();
  if (row.failures >= body.p_max_attempts) {
    row.blocked_until = new Date(now + body.p_block_seconds * 1000).toISOString();
    return { allowed: false, retry_after_seconds: body.p_block_seconds, remaining: 0 };
  }
  return { allowed: true, retry_after_seconds: 0, remaining: body.p_max_attempts - row.failures };
}

function userHasHealthData(db, user) {
  return HEALTH_TABLES.some((health) =>
    db[health].some((row) => row.username === user.Username),
  );
}

function publicUserRow(user) {
  return {
    UserID: user.UserID,
    Username: user.Username,
    UUID: user.UUID ?? null,
    GDPRConsent: user.GDPRConsent ?? false,
    GDPRConsentDate: user.GDPRConsentDate ?? null,
    role: user.role,
  };
}

async function handleRpc(req, res, path) {
  const db = await getDb();
  if (path === "/rest/v1/rpc/t009_user_has_health_data" && req.method === "POST") {
    const body = await readJson(req);
    const user = db.users.find((item) => String(item.UserID) === String(body.p_user_id));
    return send(res, 200, user ? userHasHealthData(db, user) : false);
  }
  if (path === "/rest/v1/rpc/t009_delete_user" && req.method === "POST") {
    const body = await readJson(req);
    const user = db.users.find((item) => String(item.UserID) === String(body.p_user_id));
    if (!user) return send(res, 200, false);
    if (userHasHealthData(db, user)) {
      return send(res, 400, {
        code: "P0001",
        details: null,
        hint: null,
        message: "USER_HAS_DATA",
      });
    }
    db.users = db.users.filter((item) => item !== user);
    await saveDb(db);
    return send(res, 200, true);
  }
  if (path === "/rest/v1/rpc/t009_update_user" && req.method === "POST") {
    const body = await readJson(req);
    const user = db.users.find((item) => String(item.UserID) === String(body.p_user_id));
    if (!user) return send(res, 200, []);
    if (body.p_role !== null && body.p_role !== undefined) {
      if (!["admin", "doctor", "user"].includes(body.p_role)) {
        return send(res, 400, { code: "22023", message: "INVALID_ROLE" });
      }
    }
    const newUsername =
      body.p_username === null || body.p_username === undefined
        ? null
        : String(body.p_username).trim();
    if (newUsername !== null && newUsername.length === 0) {
      return send(res, 400, { code: "22023", message: "INVALID_USERNAME" });
    }
    if (
      newUsername !== null &&
      db.users.some((item) => item !== user && item.Username === newUsername)
    ) {
      return send(res, 409, { code: "23505", message: "USERNAME_TAKEN" });
    }
    const oldUsername = user.Username;
    if (newUsername !== null && newUsername !== oldUsername) {
      user.Username = newUsername;
      for (const health of HEALTH_TABLES) {
        for (const row of db[health]) {
          if (row.username === oldUsername) row.username = newUsername;
        }
      }
    }
    if (body.p_role !== null && body.p_role !== undefined) user.role = body.p_role;
    if (body.p_gdpr_consent !== null && body.p_gdpr_consent !== undefined) {
      user.GDPRConsent = body.p_gdpr_consent === true;
      user.GDPRConsentDate = user.GDPRConsent ? new Date().toISOString() : null;
    }
    await saveDb(db);
    return send(res, 200, [publicUserRow(user)]);
  }
  if (path === "/rest/v1/rpc/auth_login_consume" && req.method === "POST") {
    const body = await readJson(req);
    const result = consumeRateLimit(db, body);
    if (result === null) return send(res, 400, { message: "invalid rate-limit input" });
    await saveDb(db);
    return send(res, 200, [result]);
  }
  if (path === "/rest/v1/rpc/auth_login_reset" && req.method === "POST") {
    const body = await readJson(req);
    if (typeof body.p_key_hash !== "string") {
      return send(res, 400, { message: "invalid rate-limit key" });
    }
    db.auth_login_limits = db.auth_login_limits.filter(
      (item) => item.key_hash !== body.p_key_hash,
    );
    await saveDb(db);
    return sendEmpty(res, 204);
  }
  return send(res, 404, { message: "RPC not modeled" });
}

async function handleRest(req, res, path, url) {
  if (path.startsWith("/rest/v1/rpc/")) {
    return handleRpc(req, res, path);
  }
  const table = decodeURIComponent(path.slice("/rest/v1/".length).split("/")[0] || "");
  if (!PUBLIC_SCHEMA_TABLES.includes(table)) {
    return send(res, 404, {
      code: "42P01",
      details: null,
      hint: null,
      message: `relation "public.${table}" does not exist`,
    });
  }

  const db = await getDb();
  const rows = await readTable(db, table);
  const params = url.searchParams;

  if (req.method === "OPTIONS") {
    return sendEmpty(res, 204, { Allow: "GET,HEAD,POST,PATCH,DELETE,OPTIONS" });
  }

  if (req.method === "GET" || req.method === "HEAD") {
    const filtered = rows.filter((row) => matches(row, params));
    const offset = Number(params.get("offset") || 0);
    const page = pageRows(filtered, params);
    const selected = page.map((row) => project(row, params.get("select")));
    const headers = {};
    if (countRequested(req)) headers["Content-Range"] = contentRange(filtered, page, offset);
    if (req.method === "HEAD") return sendEmpty(res, page.length === 0 ? 200 : 206, headers);
    if (objectRequest(req)) {
      if (selected.length !== 1) {
        return send(res, 406, {
          code: "PGRST116",
          details: `The result contains ${selected.length} rows`,
          hint: null,
          message: "JSON object requested, multiple (or no) rows returned",
        });
      }
      return send(res, 200, selected[0], headers);
    }
    return send(res, page.length === 0 ? 200 : 206, selected, headers);
  }

  if (req.method === "POST") {
    const body = await readJson(req);
    const inputs = Array.isArray(body) ? body : [body];
    const created = [];
    for (const input of inputs) {
      if (table === "users") {
        if (db.users.some((item) => item.Username === input.Username)) {
          return send(res, 409, {
            code: "23505",
            details: "Key (Username) already exists.",
            hint: null,
            message: "duplicate key value violates unique constraint",
          });
        }
        const nextId = db.users.reduce((max, item) => Math.max(max, Number(item.UserID) || 0), 0) + 1;
        const row = {
          UserID: input.UserID ?? nextId,
          Username: input.Username,
          PasswordHash: input.PasswordHash ?? fakeBcrypt(),
          UUID: input.UUID ?? null,
          GDPRConsent: input.GDPRConsent ?? false,
          GDPRConsentDate: input.GDPRConsentDate ?? null,
          sexo: input.sexo ?? null,
          bomba_insulina: input.bomba_insulina ?? false,
          role: input.role ?? "user",
          created_at: input.created_at ?? new Date().toISOString(),
        };
        db.users.push(row);
        created.push(row);
      } else if (table === "auth_sessions") {
        const row = {
          ...input,
          revoked_at: input.revoked_at ?? null,
          created_at: input.created_at ?? new Date().toISOString(),
        };
        db.auth_sessions.push(row);
        created.push(row);
      } else {
        const row = { ...input, id: input.id ?? `${table}-${Date.now()}-${created.length}` };
        db[table].push(row);
        created.push(row);
      }
    }
    await saveDb(db);
    if (returnRepresentation(req)) {
      return send(res, 201, Array.isArray(body) ? created : created[0]);
    }
    return sendEmpty(res, 201);
  }

  if (req.method === "PATCH") {
    const body = await readJson(req);
    const matched = rows.filter((row) => matches(row, params));
    for (const row of matched) Object.assign(row, body);
    await saveDb(db);
    if (returnRepresentation(req)) {
      return send(res, 200, matched.map((row) => project(row, params.get("select"))));
    }
    return sendEmpty(res, 204);
  }

  if (req.method === "DELETE") {
    const matched = rows.filter((row) => matches(row, params));
    if (table === "users") {
      for (const user of matched) {
        if (HEALTH_TABLES.some((health) => db[health].some((row) => row.username === user.Username))) {
          return send(res, 409, {
            code: "23503",
            details: "Key is still referenced from another table.",
            hint: null,
            message: "update or delete on table violates foreign key constraint",
          });
        }
      }
      db.users = db.users.filter((row) => !matched.includes(row));
    } else {
      db[table] = db[table].filter((row) => !matched.includes(row));
    }
    await saveDb(db);
    return sendEmpty(res, 204);
  }

  return send(res, 405, { message: "Method not allowed" });
}

function authUser(account) {
  return {
    id: account.authId,
    aud: "authenticated",
    role: "authenticated",
    email: account.email,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    app_metadata: {
      app_user_id: account.appUserId,
      role: account.role,
    },
    user_metadata: { username: account.email },
  };
}

async function handleAuth(req, res, path, url) {
  const db = await getDb();
  if (path === "/auth/v1/token") {
    if (req.method !== "POST") return send(res, 405, { message: "Method not allowed" });
    const body = await readJson(req);
    if (url.searchParams.get("grant_type") !== "password") {
      return send(res, 400, { error: "unsupported_grant_type" });
    }
    const account = db.authAccounts.find(
      (item) => item.email === body.email && item.password === body.password,
    );
    if (!account) {
      return send(res, 400, {
        error: "invalid_grant",
        error_description: "Invalid login credentials",
      });
    }
    const accessToken = `synthetic-${account.authId}-${Date.now()}`;
    db.authSessions[accessToken] = account.email;
    await saveDb(db);
    return send(res, 200, {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `synthetic-refresh-${account.authId}`,
      user: authUser(account),
    });
  }

  if (path === "/auth/v1/user") {
    if (req.method !== "GET") return send(res, 405, { message: "Method not allowed" });
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const email = db.authSessions[token];
    const account = db.authAccounts.find((item) => item.email === email);
    if (!account) return send(res, 401, { message: "invalid JWT" });
    return send(res, 200, authUser(account));
  }

  if (path === "/auth/v1/logout") {
    if (req.method !== "POST") return send(res, 405, { message: "Method not allowed" });
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    delete db.authSessions[token];
    await saveDb(db);
    return sendEmpty(res, 204);
  }

  if (path === "/auth/v1/admin/users" && req.method === "POST") {
    const body = await readJson(req);
    const email = body.email;
    if (!email) return send(res, 400, { message: "email is required" });
    if (db.authAccounts.some((item) => item.email === email)) {
      return send(res, 422, { code: "email_exists", message: "User already registered" });
    }
    const account = {
      authId: `synthetic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      email,
      password: body.password || "synthetic-password",
      appUserId: body.app_user_id ?? "0",
      role: body.app_metadata?.role || body.user_metadata?.role || "user",
    };
    db.authAccounts.push(account);
    await saveDb(db);
    return send(res, 200, { user: authUser(account) });
  }

  if (path === "/auth/v1/admin/signout" && req.method === "POST") {
    return sendEmpty(res, 204);
  }

  return send(res, 404, { message: "Auth endpoint not modeled" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://supabase.mock");
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return sendEmpty(res, 204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,HEAD,POST,PATCH,DELETE,OPTIONS",
      });
    }
    if (path === "/__reset" && req.method === "POST") {
      await pm.state.set("supabase", seed());
      return sendEmpty(res, 204);
    }
    if (path.startsWith("/rest/v1/")) return await handleRest(req, res, path, url);
    if (path.startsWith("/auth/v1/")) return await handleAuth(req, res, path, url);
    return send(res, 404, { message: "Endpoint not modeled" });
  } catch (error) {
    console.error("Supabase stand-in error:", error?.message || "unknown");
    if (!res.headersSent) send(res, 500, { message: "Stand-in internal error" });
  }
});

server.listen(PORT, () => console.log(`Supabase stand-in on ${PORT}`));

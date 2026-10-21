// T-014/T-034 real-PostgreSQL validation harness.
// Scope: tests/sql/** only. Synthetic data, local isolated database, no remote
// Supabase project, no real credentials, no PII.
//
// Portability: canonical inputs live inside this repository. Pre-merge runs may
// override them with T014_AUTH_SQL / T014_MIGRATIONS_DIR / T014_METADATA.
//
// Safety rails:
//   * PostgreSQL must be reachable at 127.0.0.1:15432.
//   * Databases created by this script are all prefixed t014_ and are dropped
//     at the end (unless T014_KEEP_DBS=1).
//   * Product SQL is READ, never edited. The runner never stops containers.
//
// Run:
//   node tests/sql/run-sql-validation.mjs
//
// Exit code 0 = every check passed. 1 = at least one reproducible failure.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const runId = Date.now().toString(36).slice(-6);

const PG = {
  host: "127.0.0.1",
  port: 15432,
  user: process.env.T014_PG_USER || "postgres",
  password: process.env.T014_PG_PASSWORD || "synthetic_local_only",
};

const AUTH_SQL_PATH =
  process.env.T014_AUTH_SQL ||
  path.resolve(
    repoRoot,
    "src",
    "server",
    "infrastructure",
    "auth",
    "supabase-auth-schema.sql",
  );
const MIGRATIONS_DIR =
  process.env.T014_MIGRATIONS_DIR ||
  path.resolve(repoRoot, "supabase", "migrations");
const DEFAULT_METADATA_PATH = path.join(here, "fixtures", "schema-metadata.json");
const metadataPath = process.env.T014_METADATA || DEFAULT_METADATA_PATH;

const HEALTH_TABLES = [
  "insulindata",
  "fooddata",
  "exercisedata",
  "periodrecords",
  "mooddata",
  "polar_data",
];

const CONTAINER_NAME = "dashboard-sql-validation";
const CREATED_DBS = [];
const RESULTS = [];
const FINDINGS = [];
const hashes = {};

class CheckFailure extends Error {}

function assert(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new CheckFailure(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function readRequired(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} not found: ${file}`);
  }
  return fs.readFileSync(file, "utf8");
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const authSql = readRequired(AUTH_SQL_PATH, "auth schema SQL");
hashes.authSchema = sha256(authSql);
hashes.authSchemaCanonicalLf = sha256(authSql.replace(/\r\n/g, "\n"));

if (!fs.existsSync(MIGRATIONS_DIR)) {
  throw new Error(`persistence migrations directory not found: ${MIGRATIONS_DIR}`);
}
const migrationFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const findMigration = (suffix) => {
  const name = migrationFiles.find((candidate) => candidate.endsWith(suffix));
  if (!name) throw new Error(`missing migration *${suffix} in ${MIGRATIONS_DIR}`);
  return { name, path: path.join(MIGRATIONS_DIR, name), sql: readRequired(path.join(MIGRATIONS_DIR, name), name) };
};
const MIG1 = findMigration("_t009_health_username_integrity.sql");
const MIG2 = findMigration("_t009_user_admin_rpcs.sql");
const MIG3 = findMigration("_t009_password_hash_grants.sql");
const MIG4 = findMigration("_t025_health_tables_private.sql");
const MIG5 = findMigration("_t053_users_private.sql");
hashes.migration1 = sha256(MIG1.sql);
hashes.migration2 = sha256(MIG2.sql);
hashes.migration3 = sha256(MIG3.sql);
hashes.migration4 = sha256(MIG4.sql);
hashes.migration5 = sha256(MIG5.sql);

const metadata = JSON.parse(readRequired(metadataPath, "schema metadata snapshot"));
if (!metadata.metadata || typeof metadata.metadata !== "object") {
  throw new Error(`schema metadata snapshot has no "metadata" object: ${metadataPath}`);
}

function pgConfig(database) {
  return {
    ...PG,
    database,
    application_name: "t014-sql-validation",
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  };
}

async function connect(database) {
  const client = new Client(pgConfig(database));
  await client.connect();
  return client;
}

async function withClient(database, fn) {
  const client = await connect(database);
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function newDatabase(label) {
  const name = `t014_${label}_${runId}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const admin = await connect("postgres");
  try {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  CREATED_DBS.push(name);
  return name;
}

async function dropAllDatabases() {
  if (process.env.T014_KEEP_DBS === "1") {
    console.log(`\nT014_KEEP_DBS=1; kept: ${CREATED_DBS.join(", ")}`);
    return;
  }
  const admin = await connect("postgres");
  try {
    for (const name of CREATED_DBS.reverse()) {
      await admin.query(`drop database if exists ${name} with (force)`);
    }
  } finally {
    await admin.end();
  }
}

async function applyText(database, text, label) {
  const client = await connect(database);
  try {
    await client.query(text);
    return { ok: true, label };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Connection may already be unusable; a fresh client is used for checks.
    }
    return { ok: false, label, error };
  } finally {
    await client.end().catch(() => {});
  }
}

async function applyOk(database, text, label) {
  const result = await applyText(database, text, label);
  if (!result.ok) {
    throw new CheckFailure(`${label} failed: ${formatError(result.error)}`);
  }
  return result;
}

function formatError(error) {
  if (!error) return "unknown error";
  const code = error.code ? `[${error.code}] ` : "";
  return `${code}${String(error.message || error).replace(/\s+/g, " ").slice(0, 500)}`;
}

async function expectError(fn, expectedCode, messagePart) {
  try {
    await fn();
  } catch (error) {
    if (expectedCode && error.code !== expectedCode) {
      throw new CheckFailure(
        `wrong SQLSTATE: expected ${expectedCode}, got ${error.code ?? "(none)"}: ${formatError(error)}`,
      );
    }
    if (messagePart && !String(error.message || "").includes(messagePart)) {
      throw new CheckFailure(
        `error message missing ${JSON.stringify(messagePart)}: ${formatError(error)}`,
      );
    }
    return error;
  }
  throw new CheckFailure(`expected SQL error ${expectedCode ?? ""} ${messagePart ?? ""}, but statement succeeded`);
}

async function scalar(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
}

async function asRole(database, role, fn) {
  assert(["anon", "authenticated", "service_role", "t053_custom"].includes(role), `refusing unknown role ${role}`);
  const client = await connect(database);
  try {
    await client.query(`set role ${role}`);
    return await fn(client);
  } finally {
    try {
      await client.query("reset role");
    } catch {
      // ignore cleanup failure
    }
    await client.end().catch(() => {});
  }
}

async function test(section, name, fn) {
  try {
    await fn();
    RESULTS.push({ section, name, status: "PASS" });
    console.log(`PASS  ${section} :: ${name}`);
  } catch (error) {
    const detail = error instanceof CheckFailure ? error.message : formatError(error);
    RESULTS.push({ section, name, status: "FAIL", detail });
    console.error(`FAIL  ${section} :: ${name}\n      ${detail}`);
  }
}

function warn(section, name, detail) {
  FINDINGS.push({ section, name, detail });
  console.log(`WARN  ${section} :: ${name}\n      ${detail}`);
}

async function seedUser(client, { id, username, uuid = null, role = "user", password = "synthetic-not-a-real-hash" }) {
  await client.query(
    `insert into public.users ("UserID","Username","PasswordHash","UUID",role)
     values ($1,$2,$3,$4,$5)`,
    [id, username, password, uuid, role],
  );
}

// HARNESS PRECONDITION, NOT A MIGRATION RESULT.
// Migration 1 has a confirmed bug in its "legacy table has no UserID default"
// fallback path (see the reproducible failure in migration1-preflight). To
// exercise the rest of the real migrations unchanged, this helper simulates a
// legacy table that already owns a sequence/default, the early-return branch of
// migration 1. It is never claimed to match the remote schema.
async function installLegacyUserSequence(database, nextValue = 100) {
  await withClient(database, async (client) => {
    await client.query(`create sequence if not exists public.users_userid_seq`);
    await client.query(
      `alter table public.users
         alter column "UserID" set default nextval('public.users_userid_seq'::regclass)`,
    );
    await client.query(
      `alter sequence public.users_userid_seq owned by public.users."UserID"`,
    );
    await client.query(`select setval('public.users_userid_seq', $1, true)`, [nextValue]);
  });
}

async function seedHealth(client, username) {
  await client.query(
    `insert into public.insulindata (id,username,"insulinType",dose,date_time)
     values (1,$1,'rapid','1u',now()::timestamp)`,
    [username],
  );
  await client.query(
    `insert into public.fooddata (id,username,food_type,quantity,carbs,date_time)
     values (1,$1,'meal','100g','10g',now()::timestamp)`,
    [username],
  );
  await client.query(
    `insert into public.exercisedata
       (id,username,exercise_type,intensity,exercise_start_time,exercise_end_time,date_time)
     values (1,$1,'walk',2,now()::timestamp,now()::timestamp,now()::timestamp)`,
    [username],
  );
  await client.query(
    `insert into public.periodrecords (id,username,"startDate")
     values (1,$1,now()::timestamp)`,
    [username],
  );
  await client.query(
    `insert into public.mooddata (id,username,mood_value,out_of_routine,emotions)
     values (1,$1,3,false,array['calm'])`,
    [username],
  );
  await client.query(
    `insert into public.polar_data (id,username,"timestamp",heart_rate)
     values (1,$1,now(),70)`,
    [username],
  );
}

async function healthRowsFor(client, username) {
  const counts = {};
  for (const table of HEALTH_TABLES) {
    counts[table] = Number(
      await scalar(client, `select count(*) from public.${table} where username = $1`, [username]),
    );
  }
  return counts;
}

async function assertHealthRows(client, username, expected = 1) {
  const counts = await healthRowsFor(client, username);
  for (const table of HEALTH_TABLES) {
    assertEqual(counts[table], expected, `${table}.rows(username=${username})`);
  }
}

function assertAllOne(counts, message) {
  for (const table of HEALTH_TABLES) {
    assertEqual(counts[table], 1, `${message} (${table})`);
  }
}

async function fkRow(client, table) {
  const result = await client.query(
    `select c.conname, c.convalidated, c.confupdtype, c.confdeltype
       from pg_constraint c
       join pg_class src on src.oid = c.conrelid
       join pg_namespace n on n.oid = src.relnamespace
      where n.nspname = 'public'
        and src.relname = $1
        and c.contype = 'f'
        and c.confrelid = 'public.users'::regclass`,
    [table],
  );
  return result.rows[0] ?? null;
}

async function checkMetadataDrift(database) {
  await withClient(database, async (client) => {
    for (const [table, definition] of Object.entries(metadata.metadata)) {
      const expected = definition.properties;
      const result = await client.query(
        `select column_name, data_type, udt_name, character_maximum_length, is_nullable
           from information_schema.columns
          where table_schema = 'public' and table_name = $1`,
        [table],
      );
      const actual = new Map(result.rows.map((row) => [row.column_name, row]));
      assertEqual(
        [...actual.keys()].sort().join(","),
        Object.keys(expected).sort().join(","),
        `${table} columns vs metadata`,
      );
      const required = new Set(definition.required || []);
      for (const [column, spec] of Object.entries(expected)) {
        const row = actual.get(column);
        if (spec.format === "array" || String(spec.format).endsWith("[]")) {
          assertEqual(row.data_type, "ARRAY", `${table}.${column} array type`);
          const itemType = spec.items && spec.items.type;
          if (itemType) {
            const pgItemType = itemType === "string" ? "text" : itemType;
            assertEqual(row.udt_name, `_${pgItemType}`, `${table}.${column} array element type`);
          }
        } else {
          assertEqual(row.data_type, spec.format, `${table}.${column} data_type`);
        }
        if (spec.maxLength !== null && spec.maxLength !== undefined) {
          assertEqual(row.character_maximum_length, spec.maxLength, `${table}.${column} maxLength`);
        }
        assertEqual(
          row.is_nullable,
          required.has(column) ? "NO" : "YES",
          `${table}.${column} nullability (OpenAPI required)`,
        );
      }
    }
  });
}

async function applyAllMigrations(database) {
  await applyOk(database, MIG1.sql, "migration1 health_username_integrity");
  await applyOk(database, MIG2.sql, "migration2 user_admin_rpcs");
  await applyOk(database, MIG3.sql, "migration3 password_hash_grants");
  await applyOk(database, MIG4.sql, "migration4 health_tables_private");
  await applyOk(database, MIG5.sql, "migration5 users_private");
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

async function preflight() {
  const client = await connect("postgres");
  try {
    const version = await scalar(client, "select version()");
    const address = await scalar(client, "select coalesce(host(inet_server_addr()), 'local')");
    console.log(`PostgreSQL: ${version}`);
    console.log(`Server address: ${address}`);
    console.log(`Auth SQL: ${AUTH_SQL_PATH} (sha256 canonical LF ${hashes.authSchemaCanonicalLf.slice(0, 16)}…, raw ${hashes.authSchema.slice(0, 16)}…)`);
    console.log(`Migrations: ${MIG1.name}, ${MIG2.name}, ${MIG3.name}, ${MIG4.name}, ${MIG5.name}`);
    console.log(`Metadata: ${metadataPath ?? "(unavailable)"}`);
    const current = await scalar(client, "select current_database()");
    assertEqual(current, "postgres", "admin connection database");
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Scenario: migration 1 preflight failure is atomic
// ---------------------------------------------------------------------------

async function scenarioDuplicatePreflight() {
  const db = await newDatabase("dup");
  await applyOk(db, readRequired(path.join(here, "fixtures", "001_metadata_schema.sql"), "fixture"), "fixture");
  await withClient(db, async (client) => {
    await seedUser(client, { id: 1, username: "duplicate-name" });
    await seedUser(client, { id: 2, username: "duplicate-name" });
    await seedHealth(client, "duplicate-name");
  });

  const before = await withClient(db, async (client) => ({
    index: await scalar(client, `select to_regclass('public.users_username_key')::text`),
    default: await scalar(
      client,
      `select column_default from information_schema.columns
        where table_schema='public' and table_name='users' and column_name='UserID'`,
    ),
    fks: Number(await scalar(client, `select count(*) from pg_constraint where contype='f' and confrelid='public.users'::regclass`)),
    sequence: await scalar(client, `select to_regclass('public.users_userid_seq')::text`),
    users: Number(await scalar(client, `select count(*) from public.users`)),
  }));
  assertEqual(before.index, null, "unique index absent before migration");
  assertEqual(before.default, null, "UserID default absent before migration");
  assertEqual(before.fks, 0, "FKs absent before migration");

  await test("migration1-preflight", "duplicate Username aborts migration with P0001", async () => {
    const result = await applyText(db, MIG1.sql, "migration1 duplicate preflight");
    assert(!result.ok, "migration unexpectedly succeeded");
    assertEqual(result.error.code, "P0001", "preflight SQLSTATE");
    assert(String(result.error.message).includes("T009_PREFLIGHT"), "preflight message marker");
    assert(String(result.error.message).includes("1 duplicate"), "preflight count (values not logged)");
  });

  await test("migration1-preflight", "failed migration rolls back every DDL change", async () => {
    await withClient(db, async (client) => {
      assertEqual(await scalar(client, `select to_regclass('public.users_username_key')::text`), null, "no unique index after rollback");
      assertEqual(
        await scalar(
          client,
          `select column_default from information_schema.columns
            where table_schema='public' and table_name='users' and column_name='UserID'`,
        ),
        null,
        "no UserID default after rollback",
      );
      assertEqual(
        Number(await scalar(client, `select count(*) from pg_constraint where contype='f' and confrelid='public.users'::regclass`)),
        0,
        "no FKs after rollback",
      );
      assertEqual(await scalar(client, `select to_regclass('public.users_userid_seq')::text`), null, "no sequence after rollback");
      assertEqual(Number(await scalar(client, `select count(*) from public.users`)), 2, "fixture rows untouched");
    });
  });

  await test("migration1-preflight", "migration creates a UserID sequence/default on a legacy table without one", async () => {
    await withClient(db, async (client) => {
      await client.query(`delete from public.users where "UserID" = 2`);
    });
    const result = await applyText(db, MIG1.sql, "migration1 fallback sequence retry");
    if (!result.ok) {
      throw new CheckFailure(
        `migration1 cannot apply to a legacy users table without a UserID default: ${formatError(result.error)}`,
      );
    }
    await withClient(db, async (client) => {
      const sequence = await scalar(client, `select pg_get_serial_sequence('public.users','UserID')`);
      assert(sequence, "created sequence resolves via pg_get_serial_sequence");
      for (const privilege of ["usage", "select"]) {
        assertEqual(
          await scalar(client, `select has_sequence_privilege('service_role',$1,$2)`, [sequence, privilege]),
          true,
          `service_role ${privilege} on auto-created sequence`,
        );
      }
    });
    const id = await asRole(db, "service_role", async (client) =>
      Number(
        (
          await client.query(
            `insert into public.users ("Username","PasswordHash")
             values ('created-with-auto-sequence','synthetic-not-a-real-hash')
             returning "UserID"`,
          )
        ).rows[0].UserID,
      ),
    );
    assertEqual(id, 2, "auto-created sequence starts after max(UserID)");
  });

  await test("migration1-preflight", "migration succeeds once a legacy UserID default exists", async () => {
    await installLegacyUserSequence(db, 100);
    await applyOk(db, MIG1.sql, "migration1 retry with sequence precondition");
    await withClient(db, async (client) => {
      assert((await scalar(client, `select to_regclass('public.users_username_key')::text`)) !== null, "unique index created");
      assert(
        String(
          await scalar(
            client,
            `select column_default from information_schema.columns
              where table_schema='public' and table_name='users' and column_name='UserID'`,
          ),
        ).includes("nextval"),
        "UserID default present",
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario: migration 1 schema, orphan tolerance, sequence; migration 2 gate
// ---------------------------------------------------------------------------

async function scenarioSchemaAndSequence() {
  const db = await newDatabase("schema");
  await applyOk(db, readRequired(path.join(here, "fixtures", "001_metadata_schema.sql"), "fixture"), "fixture");
  await installLegacyUserSequence(db, 100);
  await withClient(db, async (client) => {
    await seedUser(client, { id: 1, username: "alice" });
    await seedUser(client, { id: 2, username: "bob" });
    // Legacy orphan: tolerated by NOT VALID but rejected for new writes.
    await client.query(
      `insert into public.insulindata (id,username,"insulinType",dose,date_time)
       values (99,'legacy-ghost','rapid','1u',now()::timestamp)`,
    );
  });

  await test("schema", "fixture columns/types/nullability match sanitized OpenAPI metadata", async () => {
    await checkMetadataDrift(db);
  });

  await test("migration1", "adds unique Username and six FKs NOT VALID (UserID default precondition present)", async () => {
    await applyOk(db, MIG1.sql, "migration1");
    await withClient(db, async (client) => {
      assertEqual(await scalar(client, `select indisunique from pg_index where indexrelid='public.users_username_key'::regclass`), true, "Username index unique");
      assert(
        String(
          await scalar(
            client,
            `select column_default from information_schema.columns
              where table_schema='public' and table_name='users' and column_name='UserID'`,
          ),
        ).includes("nextval"),
        "UserID sequence default",
      );
      for (const table of HEALTH_TABLES) {
        const fk = await fkRow(client, table);
        assert(fk, `missing FK on ${table}`);
        assertEqual(fk.convalidated, false, `${table} FK is NOT VALID`);
        assertEqual(fk.confupdtype, "c", `${table} FK ON UPDATE CASCADE`);
        assertEqual(fk.confdeltype, "r", `${table} FK ON DELETE RESTRICT`);
      }
      assertEqual(
        Number(await scalar(client, `select count(*) from public.insulindata where username='legacy-ghost'`)),
        1,
        "legacy orphan preserved by NOT VALID",
      );
    });
  });

  await test("migration1", "new orphan row is rejected with 23503", async () => {
    await withClient(db, async (client) => {
      await expectError(
        () =>
          client.query(
            `insert into public.insulindata (id,username,"insulinType",dose,date_time)
             values (100,'unknown-orphan','rapid','1u',now()::timestamp)`,
          ),
        "23503",
      );
    });
  });

  await test("migration1", "new user without UserID uses the sequence", async () => {
    await withClient(db, async (client) => {
      const result = await client.query(
        `insert into public.users ("Username","PasswordHash")
         values ('seq-user','synthetic-not-a-real-hash') returning "UserID"`,
      );
      assertEqual(Number(result.rows[0].UserID), 101, "sequence advances from the harness precondition");
      const second = await client.query(
        `insert into public.users ("Username","PasswordHash")
         values ('seq-user-2','synthetic-not-a-real-hash') returning "UserID"`,
      );
      assertEqual(Number(second.rows[0].UserID), 102, "sequence increments");
    });
  });

  await test("migration1", "duplicate Username rejected with 23505", async () => {
    await withClient(db, async (client) => {
      await expectError(
        () =>
          client.query(
            `insert into public.users ("Username","PasswordHash")
             values ('seq-user','synthetic-not-a-real-hash')`,
          ),
        "23505",
      );
    });
  });

  await test("grants", "migration grants service_role USAGE/SELECT on the UserID sequence", async () => {
    await withClient(db, async (client) => {
      const sequence = await scalar(client, `select pg_get_serial_sequence('public.users','UserID')`);
      assert(sequence, "serial sequence resolved");
      for (const privilege of ["usage", "select"]) {
        assertEqual(
          await scalar(client, `select has_sequence_privilege('service_role', $1, $2)`, [sequence, privilege]),
          true,
          `service_role ${privilege} on ${sequence}`,
        );
      }
      for (const role of ["anon", "authenticated"]) {
        assertEqual(
          await scalar(client, `select has_sequence_privilege($1, $2, 'usage')`, [role, sequence]),
          false,
          `${role} USAGE on ${sequence}`,
        );
      }
    });
  });

  await test("grants", "service_role can create a user without computing max+1", async () => {
    const id = await asRole(db, "service_role", async (client) =>
      Number(
        (
          await client.query(
            `insert into public.users ("Username","PasswordHash")
             values ('service-created','synthetic-not-a-real-hash') returning "UserID"`,
          )
        ).rows[0].UserID,
      ),
    );
    assert(id >= 103, `unexpected generated UserID ${id}`);
  });

  await test("migration2", "admin RPCs fail closed when migration 1 FKs are absent", async () => {
    const noFkDb = await newDatabase("nofk");
    await applyOk(noFkDb, readRequired(path.join(here, "fixtures", "001_metadata_schema.sql"), "fixture"), "fixture");
    await withClient(noFkDb, async (client) => {
      await seedUser(client, { id: 1, username: "gate-user" });
    });
    await applyOk(noFkDb, MIG2.sql, "migration2 without migration1");
    await expectError(
      () =>
        asRole(noFkDb, "service_role", (client) =>
          client.query(`select public.t009_assert_username_fks_ready()`),
        ),
      "P0001",
      "PERSISTENCE_MIGRATION_REQUIRED",
    );
    await expectError(
      () =>
        asRole(noFkDb, "service_role", (client) =>
          client.query(`select * from public.t009_update_user(1,'renamed')`),
        ),
      "P0001",
      "PERSISTENCE_MIGRATION_REQUIRED",
    );
    await withClient(noFkDb, async (client) => {
      assertEqual(await scalar(client, `select "Username" from public.users where "UserID"=1`), "gate-user", "no partial rename");
    });
  });

  await test("migration2", "RPC gate passes after migration 1 is applied", async () => {
    const noFkDb = CREATED_DBS.find((name) => name.includes("_nofk_"));
    assert(noFkDb, "nofk database tracked");
    await installLegacyUserSequence(noFkDb, 100);
    await applyOk(noFkDb, MIG1.sql, "migration1 after gate test");
    await asRole(noFkDb, "service_role", (client) =>
      client.query(`select public.t009_assert_username_fks_ready()`),
    );
  });

  await test("schema", "migration set is idempotent on a clean database", async () => {
    await applyAllMigrations(db);
    await applyAllMigrations(db);
    await withClient(db, async (client) => {
      for (const table of HEALTH_TABLES) {
        const fk = await fkRow(client, table);
        assert(fk, `${table} FK still present after reapply`);
      }
      assertEqual(
        Number(await scalar(client, `select count(*) from pg_indexes where schemaname='public' and tablename='users' and indexname='users_username_key'`)),
        1,
        "single unique index after reapply",
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario: core T-009 atomicity, grants, RLS, GDPR/UUID, deletes
// ---------------------------------------------------------------------------

async function resetCoreState(database) {
  await withClient(database, async (client) => {
    await client.query(`drop trigger if exists t014_tripwire on public.polar_data`);
    await client.query(`drop function if exists public.t014_tripwire()`);
    await client.query(
      `truncate table public.auth_sessions, public.insulindata, public.fooddata,
                      public.exercisedata, public.periodrecords, public.mooddata,
                      public.polar_data, public.users`,
    );
    await seedUser(client, { id: 1, username: "alice", uuid: "synthetic-uuid-alice" });
    await seedUser(client, { id: 2, username: "bob", uuid: "synthetic-uuid-bob" });
    await seedUser(client, { id: 3, username: "empty-user", uuid: "synthetic-uuid-empty" });
    await seedHealth(client, "alice");
    await client.query(
      `insert into public.auth_sessions (sid_hash,user_id,method,issued_at,expires_at)
       values (repeat('a',64),1,'username',now(),now() + interval '1 hour')`,
    );
  });
}

async function scenarioCore() {
  const db = await newDatabase("core");
  await applyOk(db, readRequired(path.join(here, "fixtures", "001_metadata_schema.sql"), "fixture"), "fixture");
  await installLegacyUserSequence(db, 100);
  await applyOk(db, authSql, "auth schema");
  await applyAllMigrations(db);
  await resetCoreState(db);

  await test("search_path", "all SECURITY DEFINER functions pin search_path and are owned by a privileged role", async () => {
    await withClient(db, async (client) => {
      const result = await client.query(
        `select p.proname, p.prosecdef, p.proconfig, r.rolname as owner
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           join pg_roles r on r.oid = p.proowner
          where n.nspname='public'
            and p.proname in ('auth_login_consume','auth_login_reset','auth_cleanup_expired',
                              't009_assert_username_fks_ready','t009_update_user',
                              't009_delete_user','t009_user_has_health_data')
          order by p.proname`,
      );
      assertEqual(result.rows.length, 7, "seven target functions");
      for (const row of result.rows) {
        assertEqual(row.prosecdef, true, `${row.proname} SECURITY DEFINER`);
        const config = row.proconfig || [];
        assert(
          config.some((entry) => entry.startsWith("search_path=")),
          `${row.proname} has no pinned search_path`,
        );
        assertEqual(row.owner, "postgres", `${row.proname} owner`);
      }
    });
  });

  await test("search_path", "unprivileged roles cannot create objects in public", async () => {
    await withClient(db, async (client) => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        assertEqual(
          await scalar(client, `select has_schema_privilege($1,'public','create')`, [role]),
          false,
          `${role} CREATE on public`,
        );
      }
    });
  });

  await test("grants", "anon/authenticated have no users column access after M5; service_role can read PasswordHash", async () => {
    await withClient(db, async (client) => {
      for (const role of ["anon", "authenticated"]) {
        assertEqual(
          await scalar(client, `select has_column_privilege($1,'public.users','PasswordHash','select')`, [role]),
          false,
          `${role} PasswordHash column privilege`,
        );
        for (const column of ["Username", "UUID", "GDPRConsent", "GDPRConsentDate", "role"]) {
          assertEqual(
            await scalar(client, `select has_column_privilege($1,'public.users',$2,'select')`, [role, column]),
            false,
            `${role} ${column} column privilege`,
          );
        }
      }
      assertEqual(
        await scalar(client, `select has_column_privilege('service_role','public.users','PasswordHash','select')`),
        true,
        "service_role PasswordHash privilege",
      );
    });
    await expectError(
      () => asRole(db, "anon", (client) => client.query(`select "PasswordHash" from public.users limit 1`)),
      "42501",
    );
    await expectError(
      () => asRole(db, "authenticated", (client) => client.query(`select "PasswordHash" from public.users limit 1`)),
      "42501",
    );
  });

  await test("rls", "role attributes: only service_role has BYPASSRLS", async () => {
    await withClient(db, async (client) => {
      const rows = await client.query(
        `select rolname, rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role')`,
      );
      const map = Object.fromEntries(rows.rows.map((row) => [row.rolname, row.rolbypassrls]));
      assertEqual(map.anon, false, "anon bypassrls");
      assertEqual(map.authenticated, false, "authenticated bypassrls");
      assertEqual(map.service_role, true, "service_role bypassrls");
    });
  });

  await test("rls", "users RLS enabled; no anon/auth/public policy; service_role bypasses", async () => {
    await withClient(db, async (client) => {
      assertEqual(await scalar(client, `select relrowsecurity from pg_class where oid='public.users'::regclass`), true, "users RLS");
      const policies = await client.query(
        `select policyname, roles::text[] as roles, cmd, qual, with_check
           from pg_policies where schemaname='public' and tablename='users'`,
      );
      assert(policies.rowCount >= 1, "at least one users policy");
      for (const policy of policies.rows) {
        assertEqual(policy.roles.join(","), "service_role", `${policy.policyname} applies only to service_role`);
        assertEqual(policy.cmd, "ALL", `${policy.policyname} command`);
        assertEqual(policy.qual, "true", `${policy.policyname} USING true`);
        assertEqual(policy.with_check, "true", `${policy.policyname} WITH CHECK true`);
      }
    });
    await expectError(
      () => asRole(db, "anon", (client) => client.query(`select count(*) from public.users`)),
      "42501",
    );
    await expectError(
      () => asRole(db, "authenticated", (client) => client.query(`select count(*) from public.users`)),
      "42501",
    );
    const serviceRows = await asRole(db, "service_role", async (client) =>
      Number(await scalar(client, `select count(*) from public.users`)),
    );
    assert(serviceRows >= 3, `service_role bypasses RLS, got ${serviceRows} rows`);
  });

  await test("rls", "anon update/delete of users is denied after M5", async () => {
    await expectError(
      () =>
        asRole(db, "anon", (client) =>
          client.query(
            `update public.users set "PasswordHash"='synthetic-overwrite' where "UserID"=1`,
          ),
        ),
      "42501",
    );
    await expectError(
      () =>
        asRole(db, "anon", (client) =>
          client.query(`delete from public.users where "UserID"=1`),
        ),
      "42501",
    );
    await withClient(db, async (client) => {
      assertEqual(await scalar(client, `select "PasswordHash" from public.users where "UserID"=1`), "synthetic-not-a-real-hash", "hash unchanged");
    });
  });

  await test("grants", "admin RPCs and auth RPCs are not executable by anon/authenticated", async () => {
    await withClient(db, async (client) => {
      const signatures = [
        "public.t009_assert_username_fks_ready()",
        "public.t009_update_user(bigint,text,text,boolean)",
        "public.t009_delete_user(bigint)",
        "public.t009_user_has_health_data(bigint)",
        "public.auth_login_consume(text,integer,integer,integer)",
        "public.auth_login_reset(text)",
        "public.auth_cleanup_expired(interval,interval)",
      ];
      for (const signature of signatures) {
        for (const role of ["anon", "authenticated"]) {
          assertEqual(
            await scalar(client, `select has_function_privilege($1,$2,'execute')`, [role, signature]),
            false,
            `${role} EXECUTE ${signature}`,
          );
        }
        assertEqual(
          await scalar(client, `select has_function_privilege('service_role',$1,'execute')`, [signature]),
          true,
          `service_role EXECUTE ${signature}`,
        );
      }
    });
    await expectError(
      () => asRole(db, "anon", (client) => client.query(`select public.t009_delete_user(1)`)),
      "42501",
    );
    await expectError(
      () => asRole(db, "authenticated", (client) => client.query(`select * from public.t009_update_user(1,'x')`)),
      "42501",
    );
  });

  await test("rename", "t009_update_user executes without ambiguous column error", async () => {
    await resetCoreState(db);
    const result = await asRole(db, "service_role", (client) =>
      client.query(`select * from public.t009_update_user(1,null,'doctor',null)`),
    );
    assertEqual(result.rowCount, 1, "no-op update returns the user");
  });

  await test("rename", "rename updates all six health tables and preserves UUID/GDPR", async () => {
    await resetCoreState(db);
    const result = await asRole(db, "service_role", (client) =>
      client.query(`select * from public.t009_update_user(1,'alice-renamed','doctor',true)`),
    );
    assertEqual(result.rowCount, 1, "one user returned");
    const row = result.rows[0];
    assertEqual(row.Username, "alice-renamed", "returned Username");
    assertEqual(row.role, "doctor", "returned role");
    assertEqual(row.UUID, "synthetic-uuid-alice", "UUID preserved");
    assertEqual(row.GDPRConsent, true, "GDPR consent set");
    assert(row.GDPRConsentDate, "GDPR date set");
    await withClient(db, async (client) => {
      await assertHealthRows(client, "alice-renamed", 1);
      assertEqual(Number(await scalar(client, `select count(*) from public.insulindata where username='alice'`)), 0, "no old username rows");
      const drift = Number(
        await scalar(
          client,
          `select abs(extract(epoch from ((now() at time zone 'UTC') - "GDPRConsentDate")))
             from public.users where "UserID"=1`,
        ),
      );
      assert(drift < 10, `GDPRConsentDate is UTC now (drift ${drift}s)`);
    });
  });

  await test("rename", "duplicate target rolls back Username, role, GDPR and health tables", async () => {
    await resetCoreState(db);
    const before = await withClient(db, async (client) => ({
      gdprDate: await scalar(client, `select "GDPRConsentDate" from public.users where "UserID"=1`),
    }));
    await expectError(
      () =>
        asRole(db, "service_role", (client) =>
          client.query(`select * from public.t009_update_user(1,'bob','admin',false)`),
        ),
      "23505",
    );
    await withClient(db, async (client) => {
      const row = (
        await client.query(
          `select "Username",role,"GDPRConsent","GDPRConsentDate","UUID"
             from public.users where "UserID"=1`,
        )
      ).rows[0];
      assertEqual(row.Username, "alice", "Username rolled back");
      assertEqual(row.role, "user", "role rolled back");
      assertEqual(row.GDPRConsent, false, "GDPR flag rolled back");
      assertEqual(row.GDPRConsentDate, before.gdprDate, "GDPR date rolled back");
      assertEqual(row.UUID, "synthetic-uuid-alice", "UUID untouched");
      await assertHealthRows(client, "alice", 1);
    });
  });

  await test("rename", "trigger failure after cascade rolls back every table atomically", async () => {
    await resetCoreState(db);
    await withClient(db, async (client) => {
      await client.query(`
        create or replace function public.t014_tripwire() returns trigger
        language plpgsql as $$
        begin
          if new.username = 'tripwire-target' then
            raise exception 'T014_TRIPWIRE';
          end if;
          return new;
        end
        $$;
        create trigger t014_tripwire before update on public.polar_data
          for each row execute function public.t014_tripwire();
      `);
    });
    await expectError(
      () =>
        asRole(db, "service_role", (client) =>
          client.query(`select * from public.t009_update_user(1,'tripwire-target','admin',false)`),
        ),
      "P0001",
      "T014_TRIPWIRE",
    );
    await withClient(db, async (client) => {
      const row = (
        await client.query(`select "Username",role,"GDPRConsent" from public.users where "UserID"=1`)
      ).rows[0];
      assertEqual(row.Username, "alice", "Username rollback after cascade failure");
      assertEqual(row.role, "user", "role rollback after cascade failure");
      assertEqual(row.GDPRConsent, false, "GDPR rollback after cascade failure");
      await assertHealthRows(client, "alice", 1);
      await client.query(`drop trigger t014_tripwire on public.polar_data`);
      await client.query(`drop function public.t014_tripwire()`);
    });
  });

  await test("injection", "username payload is stored literally and cannot execute SQL", async () => {
    await resetCoreState(db);
    const payload = `x'; drop table public.users; --`;
    await asRole(db, "service_role", (client) =>
      client.query(`select * from public.t009_update_user(1,$1,'doctor',true)`, [payload]),
    );
    await withClient(db, async (client) => {
      assertEqual(await scalar(client, `select to_regclass('public.users')::text`), "users", "users table still exists");
      assertEqual(await scalar(client, `select "Username" from public.users where "UserID"=1`), payload, "payload stored literally");
      await assertHealthRows(client, payload, 1);
    });
    await asRole(db, "service_role", (client) =>
      client.query(`select * from public.t009_update_user(1,'alice-renamed','doctor',true)`),
    );
  });

  await test("validation", "blank/oversized username and invalid role raise 22023 without changes", async () => {
    await resetCoreState(db);
    const before = await withClient(db, async (client) => ({
      username: await scalar(client, `select "Username" from public.users where "UserID"=1`),
      role: await scalar(client, `select role from public.users where "UserID"=1`),
    }));
    for (const badUsername of ["   ", "x".repeat(101)]) {
      await expectError(
        () =>
          asRole(db, "service_role", (client) =>
            client.query(`select * from public.t009_update_user(1,$1,'admin',false)`, [badUsername]),
          ),
        "22023",
      );
    }
    await expectError(
      () =>
        asRole(db, "service_role", (client) =>
          client.query(`select * from public.t009_update_user(1,'alice-renamed',$1,false)`, ["admin'; --"]),
        ),
      "22023",
    );
    await withClient(db, async (client) => {
      assertEqual(await scalar(client, `select "Username" from public.users where "UserID"=1`), before.username, "username unchanged");
      assertEqual(await scalar(client, `select role from public.users where "UserID"=1`), before.role, "role unchanged");
      await assertHealthRows(client, "alice", 1);
    });
  });

  await test("gdpr", "GDPR false clears date; true is idempotent; UUID untouched", async () => {
    await resetCoreState(db);
    const first = await asRole(db, "service_role", (client) =>
      client.query(`select * from public.t009_update_user(1,null,null,false)`),
    );
    assertEqual(first.rows[0].GDPRConsent, false, "GDPR false");
    assertEqual(first.rows[0].GDPRConsentDate, null, "GDPR date cleared");
    assertEqual(first.rows[0].UUID, "synthetic-uuid-alice", "UUID preserved on GDPR update");
    await asRole(db, "service_role", (client) =>
      client.query(`select * from public.t009_update_user(1,null,null,true)`),
    );
    const date1 = await withClient(db, async (client) =>
      scalar(client, `select "GDPRConsentDate" from public.users where "UserID"=1`),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    await asRole(db, "service_role", (client) =>
      client.query(`select * from public.t009_update_user(1,null,null,true)`),
    );
    const date2 = await withClient(db, async (client) =>
      scalar(client, `select "GDPRConsentDate" from public.users where "UserID"=1`),
    );
    assertEqual(String(date2), String(date1), "GDPR date is not rewritten when value is unchanged");
  });

  await test("locks", "missing FK makes rename fail closed and roll back", async () => {
    await resetCoreState(db);
    await withClient(db, async (client) => {
      await client.query("begin");
      await client.query(`alter table public.mooddata drop constraint mooddata_username_fkey`);
      try {
        await expectError(
          () => client.query(`select * from public.t009_update_user(1,'should-not-apply')`),
          "P0001",
          "PERSISTENCE_MIGRATION_REQUIRED",
        );
      } finally {
        await client.query("rollback");
      }
    });
    await withClient(db, async (client) => {
      assertEqual(await scalar(client, `select "Username" from public.users where "UserID"=1`), "alice", "rename rolled back");
      await assertHealthRows(client, "alice", 1);
    });
  });

  await test("delete", "direct DELETE with health rows is blocked by FK (23503)", async () => {
    await resetCoreState(db);
    await asRole(db, "service_role", async (client) => {
      await expectError(
        () => client.query(`delete from public.users where "UserID"=1`),
        "23503",
      );
    });
  });

  await test("delete", "RPC reports USER_HAS_DATA (P0001) and preserves every table", async () => {
    await resetCoreState(db);
    await expectError(
      () =>
        asRole(db, "service_role", (client) =>
          client.query(`select public.t009_delete_user(1)`),
        ),
      "P0001",
      "USER_HAS_DATA",
    );
    await withClient(db, async (client) => {
      await assertHealthRows(client, "alice", 1);
      assertEqual(await scalar(client, `select "Username" from public.users where "UserID"=1`), "alice", "user kept");
    });
  });

  await test("delete", "each of the six health tables independently blocks deletion, then empty user deletes", async () => {
    await resetCoreState(db);
    await withClient(db, async (client) => {
      for (const table of HEALTH_TABLES) {
        await client.query(`delete from public.${table} where username='alice'`);
        const remaining = HEALTH_TABLES.slice(HEALTH_TABLES.indexOf(table) + 1);
        if (remaining.length > 0) {
          const error = await expectError(
            () => client.query(`select public.t009_delete_user(1)`),
            "P0001",
            "USER_HAS_DATA",
          );
          assert(error, "blocked while remaining tables hold data");
        }
      }
      const deleted = await client.query(`select public.t009_delete_user(1) as deleted`);
      assertEqual(deleted.rows[0].deleted, true, "empty user deleted");
      assertEqual(Number(await scalar(client, `select count(*) from public.users where "UserID"=1`)), 0, "user row gone");
      assertEqual(Number(await scalar(client, `select count(*) from public.auth_sessions where user_id=1`)), 0, "auth_sessions cascade-deleted with user");
    });
  });

  await test("delete", "second delete returns false; missing user returns zero/false", async () => {
    await resetCoreState(db);
    await withClient(db, async (client) => {
      const first = await client.query(`select public.t009_delete_user(3) as deleted`);
      assertEqual(first.rows[0].deleted, true, "empty user deleted first");
      const second = await client.query(`select public.t009_delete_user(3) as deleted`);
      assertEqual(second.rows[0].deleted, false, "second delete false");
      const missing = await client.query(`select public.t009_delete_user(999999) as deleted`);
      assertEqual(missing.rows[0].deleted, false, "missing delete false");
      const update = await client.query(`select * from public.t009_update_user(999999,'ghost')`);
      assertEqual(update.rowCount, 0, "missing update returns zero rows");
      const hasData = await client.query(`select public.t009_user_has_health_data(2) as has_data`);
      assertEqual(hasData.rows[0].has_data, false, "bob has no data");
      const missingData = await client.query(`select public.t009_user_has_health_data(999999) as has_data`);
      assertEqual(missingData.rows[0].has_data, false, "missing user has no data");
    });
  });

  await test("delete", "user without data is deleted atomically; has_health_data false before", async () => {
    await resetCoreState(db);
    const before = await asRole(db, "service_role", (client) =>
      client.query(`select public.t009_user_has_health_data(3) as has_data`),
    );
    assertEqual(before.rows[0].has_data, false, "empty user has no data");
    const result = await asRole(db, "service_role", (client) =>
      client.query(`select public.t009_delete_user(3) as deleted`),
    );
    assertEqual(result.rows[0].deleted, true, "delete true");
    await withClient(db, async (client) => {
      assertEqual(Number(await scalar(client, `select count(*) from public.users where "UserID"=3`)), 0, "row gone");
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario: auth schema sessions + rate limit
// ---------------------------------------------------------------------------

async function scenarioAuth() {
  const db = await newDatabase("auth");
  await applyOk(db, readRequired(path.join(here, "fixtures", "001_metadata_schema.sql"), "fixture"), "fixture");
  await applyOk(db, authSql, "auth schema");
  await withClient(db, async (client) => {
    await seedUser(client, { id: 10, username: "session-user" });
    await seedUser(client, { id: 11, username: "cascade-user" });
  });

  await test("auth-schema", "auth_sessions indexes/RLS and service-only grants", async () => {
    await withClient(db, async (client) => {
      assertEqual(await scalar(client, `select relrowsecurity from pg_class where oid='public.auth_sessions'::regclass`), true, "auth_sessions RLS");
      assertEqual(await scalar(client, `select relrowsecurity from pg_class where oid='public.auth_login_limits'::regclass`), true, "auth_login_limits RLS");
      assertEqual(
        Number(await scalar(client, `select count(*) from pg_indexes where schemaname='public' and tablename='auth_sessions' and indexname in ('auth_sessions_user_id_idx','auth_sessions_expires_at_idx')`)),
        2,
        "auth_sessions indexes",
      );
      for (const table of ["auth_sessions", "auth_login_limits"]) {
        for (const role of ["anon", "authenticated"]) {
          for (const privilege of ["select", "insert", "update", "delete"]) {
            assertEqual(
              await scalar(client, `select has_table_privilege($1,$2,$3)`, [role, `public.${table}`, privilege]),
              false,
              `${role} ${privilege} ${table}`,
            );
          }
        }
        for (const privilege of ["select", "insert", "update", "delete"]) {
          assertEqual(
            await scalar(client, `select has_table_privilege('service_role',$1,$2)`, [`public.${table}`, privilege]),
            true,
            `service_role ${privilege} ${table}`,
          );
        }
      }
    });
    await expectError(
      () => asRole(db, "anon", (client) => client.query(`select * from public.auth_sessions limit 1`)),
      "42501",
    );
    await expectError(
      () => asRole(db, "authenticated", (client) => client.query(`select * from public.auth_login_limits limit 1`)),
      "42501",
    );
  });

  await test("auth-schema", "user_id integer FK ON DELETE CASCADE and expiry CHECK present", async () => {
    await withClient(db, async (client) => {
      assertEqual(
        await scalar(
          client,
          `select data_type from information_schema.columns
            where table_schema='public' and table_name='auth_sessions' and column_name='user_id'`,
        ),
        "integer",
        "auth_sessions.user_id type",
      );
      const fk = (
        await client.query(
          `select confdeltype, confupdtype, convalidated
             from pg_constraint
            where conrelid='public.auth_sessions'::regclass
              and contype='f'
              and confrelid='public.users'::regclass`,
        )
      ).rows[0];
      assert(fk, "missing auth_sessions -> users FK");
      assertEqual(fk.confdeltype, "c", "FK ON DELETE CASCADE");
      assertEqual(fk.confupdtype, "c", "FK ON UPDATE CASCADE");
      assertEqual(fk.convalidated, true, "FK validated");
      const check = (
        await client.query(
          `select convalidated from pg_constraint
            where conrelid='public.auth_sessions'::regclass
              and conname='auth_sessions_expiry_after_issue_check'`,
        )
      ).rows[0];
      assert(check, "missing expiry CHECK");
      assertEqual(check.convalidated, true, "expiry CHECK validated");
    });
  });

  await test("auth-sessions", "active/expired/revoked filtering matches the adapter query", async () => {
    await asRole(db, "service_role", async (client) => {
      await client.query(
        `insert into public.auth_sessions (sid_hash,user_id,method,issued_at,expires_at)
         values
           (repeat('1',64),10,'username',now(),now()+interval '1 hour'),
           (repeat('2',64),10,'username',now()-interval '2 hours',now()+interval '1 hour'),
           (repeat('3',64),10,'username',now(),now()+interval '1 hour')`,
      );
      // Keep expires_at > issued_at while forcing an already-expired row.
      await client.query(
        `update public.auth_sessions set expires_at=now()-interval '1 hour'
          where sid_hash=repeat('2',64)`,
      );
      await client.query(`update public.auth_sessions set revoked_at=now() where sid_hash=repeat('3',64)`);
      const active = await client.query(
        `select sid_hash from public.auth_sessions
          where sid_hash=$1 and user_id=$2 and revoked_at is null and expires_at > now() limit 1`,
        ["1".repeat(64), 10],
      );
      assertEqual(active.rowCount, 1, "active session visible");
      for (const hash of ["2".repeat(64), "3".repeat(64)]) {
        const rows = await client.query(
          `select 1 from public.auth_sessions
            where sid_hash=$1 and user_id=$2 and revoked_at is null and expires_at > now() limit 1`,
          [hash, 10],
        );
        assertEqual(rows.rowCount, 0, `${hash[0]} session filtered`);
      }
    });
  });

  await test("auth-sessions", "logout revokes idempotently and method check rejects unknown values", async () => {
    await asRole(db, "service_role", async (client) => {
      const first = await client.query(
        `update public.auth_sessions set revoked_at=now()
          where sid_hash=$1 and revoked_at is null`,
        ["1".repeat(64)],
      );
      assertEqual(first.rowCount, 1, "first logout revokes");
      const second = await client.query(
        `update public.auth_sessions set revoked_at=now()
          where sid_hash=$1 and revoked_at is null`,
        ["1".repeat(64)],
      );
      assertEqual(second.rowCount, 0, "second logout is a no-op");
      await expectError(
        () =>
          client.query(
            `insert into public.auth_sessions (sid_hash,user_id,method,issued_at,expires_at)
             values (repeat('4',64),10,'sms',now(),now()+interval '1 hour')`,
          ),
        "23514",
      );
    });
  });

  await test("auth-sessions", "invalid FK, invalid time range and invalid method are rejected", async () => {
    await asRole(db, "service_role", async (client) => {
      await expectError(
        () =>
          client.query(
            `insert into public.auth_sessions (sid_hash,user_id,method,issued_at,expires_at)
             values (repeat('5',64),999999,'username',now(),now()+interval '1 hour')`,
          ),
        "23503",
      );
      await expectError(
        () =>
          client.query(
            `insert into public.auth_sessions (sid_hash,user_id,method,issued_at,expires_at)
             values (repeat('6',64),10,'username',now(),now())`,
          ),
        "23514",
      );
      await expectError(
        () =>
          client.query(
            `update public.auth_sessions set expires_at=issued_at
              where sid_hash=repeat('1',64)`,
          ),
        "23514",
      );
      await expectError(
        () =>
          client.query(
            `insert into public.auth_sessions (sid_hash,user_id,method,issued_at,expires_at)
             values (repeat('7',64),10,'sms',now(),now()+interval '1 hour')`,
          ),
        "23514",
      );
    });
  });

  await test("auth-sessions", "deleting a user cascades to all of that user's sessions", async () => {
    await asRole(db, "service_role", async (client) => {
      await client.query(
        `insert into public.auth_sessions (sid_hash,user_id,method,issued_at,expires_at)
         values (repeat('e',64),11,'username',now(),now()+interval '1 hour')`,
      );
    });
    await withClient(db, async (client) => {
      assertEqual(Number(await scalar(client, `select count(*) from public.auth_sessions where user_id=11`)), 1, "session before delete");
      await client.query(`delete from public.users where "UserID"=11`);
      assertEqual(Number(await scalar(client, `select count(*) from public.auth_sessions where user_id=11`)), 0, "session cascade-deleted");
    });
  });

  await test("auth-cleanup", "retention deletes old sessions while preserving current/unexpired and recently revoked", async () => {
    await asRole(db, "service_role", async (client) => {
      await client.query(
        `insert into public.auth_sessions (sid_hash,user_id,method,issued_at,expires_at,revoked_at)
         values
           (repeat('6',64),10,'username',now(),now()+interval '1 hour',null),
           (repeat('7',64),10,'username',now()-interval '10 days',now()-interval '8 days',null),
           (repeat('8',64),10,'username',now()-interval '8 days',now()-interval '6 days',null),
           (repeat('9',64),10,'username',now()-interval '20 days',now()+interval '10 days',now()-interval '8 days'),
           (repeat('a',64),10,'username',now()-interval '20 days',now()+interval '10 days',now()-interval '6 days')`,
      );
      await client.query(
        `insert into public.auth_login_limits (key_hash,window_started_at,failures,blocked_until,updated_at)
         values
           (repeat('f',64),now()-interval '8 days',1,null,now()-interval '8 days'),
           (repeat('g',64),now()-interval '8 days',3,now()+interval '1 hour',now()-interval '8 days'),
           (repeat('h',64),now()-interval '8 days',3,now()-interval '1 hour',now()-interval '8 days'),
           (repeat('i',64),now()-interval '1 day',1,null,now()-interval '1 day')`,
      );
      const result = await client.query(
        `select * from public.auth_cleanup_expired(interval '7 days', interval '7 days')`,
      );
      assertEqual(Number(result.rows[0].sessions_deleted), 2, "sessions deleted count");
      assertEqual(Number(result.rows[0].login_limits_deleted), 2, "login limits deleted count");
      for (const hash of ["6".repeat(64), "8".repeat(64), "a".repeat(64)]) {
        assertEqual(Number(await scalar(client, `select count(*) from public.auth_sessions where sid_hash=$1`, [hash])), 1, `session ${hash[0]} preserved`);
      }
      for (const hash of ["7".repeat(64), "9".repeat(64)]) {
        assertEqual(Number(await scalar(client, `select count(*) from public.auth_sessions where sid_hash=$1`, [hash])), 0, `session ${hash[0]} deleted`);
      }
      for (const hash of ["g".repeat(64), "i".repeat(64)]) {
        assertEqual(Number(await scalar(client, `select count(*) from public.auth_login_limits where key_hash=$1`, [hash])), 1, `limit ${hash[0]} preserved`);
      }
      for (const hash of ["f".repeat(64), "h".repeat(64)]) {
        assertEqual(Number(await scalar(client, `select count(*) from public.auth_login_limits where key_hash=$1`, [hash])), 0, `limit ${hash[0]} deleted`);
      }
      const second = await client.query(
        `select * from public.auth_cleanup_expired(interval '7 days', interval '7 days')`,
      );
      assertEqual(Number(second.rows[0].sessions_deleted), 0, "cleanup idempotent sessions");
      assertEqual(Number(second.rows[0].login_limits_deleted), 0, "cleanup idempotent limits");
    });
  });

  await test("auth-cleanup", "negative retention is rejected; anon cannot execute cleanup", async () => {
    await asRole(db, "service_role", async (client) => {
      await expectError(
        () => client.query(`select * from public.auth_cleanup_expired(interval '-1 day', interval '7 days')`),
        "P0001",
        "invalid retention interval",
      );
    });
    await expectError(
      () => asRole(db, "anon", (client) => client.query(`select * from public.auth_cleanup_expired()`)),
      "42501",
    );
    await expectError(
      () => asRole(db, "authenticated", (client) => client.query(`select * from public.auth_cleanup_expired()`)),
      "42501",
    );
  });

  await test("auth-schema", "auth SQL reapply is idempotent and preserves valid sessions", async () => {
    const before = await withClient(db, async (client) => ({
      sessions: Number(await scalar(client, `select count(*) from public.auth_sessions`)),
      type: await scalar(
        client,
        `select data_type from information_schema.columns
          where table_schema='public' and table_name='auth_sessions' and column_name='user_id'`,
      ),
    }));
    await applyOk(db, authSql, "auth schema reapply");
    await withClient(db, async (client) => {
      assertEqual(Number(await scalar(client, `select count(*) from public.auth_sessions`)), before.sessions, "sessions preserved");
      assertEqual(
        await scalar(
          client,
          `select data_type from information_schema.columns
            where table_schema='public' and table_name='auth_sessions' and column_name='user_id'`,
        ),
        before.type,
        "user_id type stable",
      );
    });
  });

  await test("rate-limit", "consume increments, blocks at max, and reset deletes the key", async () => {
    const key = "a".repeat(64);
    const consume = (client) =>
      client.query(`select * from public.auth_login_consume($1,900,3,60)`, [key]);
    await asRole(db, "service_role", async (client) => {
      const one = await consume(client);
      assertEqual(one.rows[0].allowed, true, "attempt 1 allowed");
      assertEqual(one.rows[0].remaining, 2, "attempt 1 remaining");
      const two = await consume(client);
      assertEqual(two.rows[0].allowed, true, "attempt 2 allowed");
      assertEqual(two.rows[0].remaining, 1, "attempt 2 remaining");
      const three = await consume(client);
      assertEqual(three.rows[0].allowed, false, "attempt 3 blocked");
      assertEqual(three.rows[0].remaining, 0, "attempt 3 remaining");
      assert(three.rows[0].retry_after_seconds > 0, "retry-after positive");
      const four = await consume(client);
      assertEqual(four.rows[0].allowed, false, "attempt 4 still blocked");
      assertEqual(Number(await scalar(client, `select failures from public.auth_login_limits where key_hash=$1`, [key])), 3, "failure count capped at max");
      assert((await scalar(client, `select blocked_until from public.auth_login_limits where key_hash=$1`, [key])) !== null, "blocked_until set");
      await client.query(`select public.auth_login_reset($1)`, [key]);
      assertEqual(Number(await scalar(client, `select count(*) from public.auth_login_limits where key_hash=$1`, [key])), 0, "reset deleted row");
      const after = await consume(client);
      assertEqual(after.rows[0].allowed, true, "allowed after reset");
    });
  });

  await test("rate-limit", "window rollover and expired block reset counters", async () => {
    const key = "b".repeat(64);
    await asRole(db, "service_role", async (client) => {
      await client.query(`select * from public.auth_login_consume($1,900,3,60)`, [key]);
      await client.query(
        `update public.auth_login_limits set window_started_at=now()-interval '2 hours', failures=3
          where key_hash=$1`,
        [key],
      );
      const rolled = await client.query(`select * from public.auth_login_consume($1,900,3,60)`, [key]);
      assertEqual(rolled.rows[0].allowed, true, "window rollover allows");
      assertEqual(rolled.rows[0].remaining, 2, "window rollover resets failures");
      await client.query(
        `update public.auth_login_limits set blocked_until=now()-interval '1 second' where key_hash=$1`,
        [key],
      );
      const unblocked = await client.query(`select * from public.auth_login_consume($1,900,3,60)`, [key]);
      assertEqual(unblocked.rows[0].allowed, true, "expired block allows");
      assertEqual(unblocked.rows[0].remaining, 2, "expired block resets failures");
      await client.query(`select public.auth_login_reset($1)`, [key]);
    });
  });

  await test("rate-limit", "invalid key/policy are rejected and injection key is literal", async () => {
    await asRole(db, "service_role", async (client) => {
      await expectError(
        () => client.query(`select * from public.auth_login_consume('short',900,3,60)`),
        "P0001",
        "invalid rate-limit key",
      );
      await expectError(
        () => client.query(`select * from public.auth_login_consume($1,0,3,60)`, ["c".repeat(64)]),
        "P0001",
        "invalid rate-limit policy",
      );
      const payload = `'; drop table public.auth_login_limits; --`;
      await client.query(`select * from public.auth_login_consume($1,900,3,60)`, [payload]);
      assertEqual(await scalar(client, `select to_regclass('public.auth_login_limits')::text`), "auth_login_limits", "table still exists");
      assertEqual(Number(await scalar(client, `select count(*) from public.auth_login_limits where key_hash=$1`, [payload])), 1, "payload stored literally");
      await client.query(`select public.auth_login_reset($1)`, [payload]);
    });
  });

  await test("rate-limit", "concurrent attempts are atomic (no lost increments)", async () => {
    const key = "d".repeat(64);
    const clients = await Promise.all(Array.from({ length: 10 }, () => connect(db)));
    try {
      await Promise.all(clients.map((client) => client.query("set role service_role")));
      const outcomes = await Promise.all(
        clients.map(async (client) => {
          const result = await client.query(
            `select * from public.auth_login_consume($1,900,3,60)`,
            [key],
          );
          return result.rows[0];
        }),
      );
      const allowed = outcomes.filter((row) => row.allowed === true);
      assertEqual(allowed.length, 2, "exactly maxAttempts-1 attempts allowed before block");
      assertEqual(outcomes.filter((row) => row.allowed === false).length, 8, "remaining attempts blocked");
      const state = await clients[0].query(
        `select failures, blocked_until from public.auth_login_limits where key_hash=$1`,
        [key],
      );
      assertEqual(Number(state.rows[0].failures), 3, "failure count is exactly max");
      assert(state.rows[0].blocked_until !== null, "block set under concurrency");
      await clients[0].query(`select public.auth_login_reset($1)`, [key]);
    } finally {
      await Promise.all(clients.map((client) => client.end().catch(() => {})));
    }
  });

  await test("rate-limit", "anon/authenticated cannot execute the limiter RPCs", async () => {
    await expectError(
      () =>
        asRole(db, "anon", (client) =>
          client.query(`select * from public.auth_login_consume($1,900,3,60)`, ["e".repeat(64)]),
        ),
      "42501",
    );
    await expectError(
      () =>
        asRole(db, "authenticated", (client) =>
          client.query(`select public.auth_login_reset($1)`, ["e".repeat(64)]),
        ),
      "42501",
    );
  });
}

// ---------------------------------------------------------------------------
// Scenario: legacy auth_sessions with text user_id -> integer FK conversion
// ---------------------------------------------------------------------------

async function scenarioAuthLegacy() {
  const db = await newDatabase("authlegacy");
  await applyOk(db, readRequired(path.join(here, "fixtures", "001_metadata_schema.sql"), "fixture"), "fixture");
  await withClient(db, async (client) => {
    await seedUser(client, { id: 1, username: "legacy-user-1" });
    await seedUser(client, { id: 2, username: "legacy-user-2" });
    await client.query(`
      create table public.auth_sessions (
        sid_hash text primary key,
        user_id text,
        method text,
        issued_at timestamptz,
        expires_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz not null default now()
      );
      insert into public.auth_sessions (sid_hash,user_id,method,issued_at,expires_at)
      values
        (repeat('1',64),'1','username',now(),now()+interval '1 hour'),
        (repeat('2',64),'2','username',now(),now()+interval '1 hour'),
        (repeat('3',64),'abc','username',now(),now()+interval '1 hour'),
        (repeat('4',64),'999','username',now(),now()+interval '1 hour'),
        (repeat('5',64),null,'username',now(),now()+interval '1 hour'),
        (repeat('6',64),'1','username',now(),now()-interval '1 hour'),
        (repeat('7',64),'2','username',null,now()+interval '1 hour');
    `);
  });

  await test("auth-legacy", "text user_id converts to integer, invalid/orphan/range rows are removed", async () => {
    await applyOk(db, authSql, "auth schema over legacy text session table");
    await withClient(db, async (client) => {
      assertEqual(
        await scalar(
          client,
          `select data_type from information_schema.columns
            where table_schema='public' and table_name='auth_sessions' and column_name='user_id'`,
        ),
        "integer",
        "converted user_id type",
      );
      const hashes = (
        await client.query(`select sid_hash from public.auth_sessions order by sid_hash`)
      ).rows.map((row) => row.sid_hash);
      assertEqual(hashes.length, 2, "only canonical existing users remain");
      assertEqual(hashes[0], "1".repeat(64), "valid user 1 session kept");
      assertEqual(hashes[1], "2".repeat(64), "valid user 2 session kept");
      const fk = (
        await client.query(
          `select confdeltype, convalidated from pg_constraint
            where conrelid='public.auth_sessions'::regclass and contype='f'
              and confrelid='public.users'::regclass`,
        )
      ).rows[0];
      assert(fk, "FK created after conversion");
      assertEqual(fk.confdeltype, "c", "converted FK ON DELETE CASCADE");
      assertEqual(fk.convalidated, true, "converted FK validated");
      assertEqual(
        Number(
          await scalar(
            client,
            `select count(*) from pg_constraint
              where conrelid='public.auth_sessions'::regclass
                and conname='auth_sessions_expiry_after_issue_check'
                and convalidated`,
          ),
        ),
        1,
        "converted expiry CHECK validated",
      );
    });
  });

  await test("auth-legacy", "reapply is idempotent and user delete cascades converted sessions", async () => {
    await applyOk(db, authSql, "auth schema reapply over converted table");
    await withClient(db, async (client) => {
      assertEqual(Number(await scalar(client, `select count(*) from public.auth_sessions`)), 2, "converted rows preserved on reapply");
      await client.query(`delete from public.users where "UserID"=2`);
      assertEqual(Number(await scalar(client, `select count(*) from public.auth_sessions where user_id=2`)), 0, "converted session cascade-deleted");
      assertEqual(Number(await scalar(client, `select count(*) from public.auth_sessions where user_id=1`)), 1, "other user's session preserved");
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario: T-025 health-table privacy (M4) over pre-existing exposure
// ---------------------------------------------------------------------------

async function tableFingerprint(client, table) {
  return (
    await client.query(
      `select count(*)::int as row_count,
              md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as digest
         from public.${table} t`,
    )
  ).rows[0];
}

async function usersFingerprint(client) {
  return (
    await client.query(
      `select count(*)::int as row_count,
              md5(coalesce(string_agg(u::text, '|' order by u."UserID"), '')) as digest
         from public.users u`,
    )
  ).rows[0];
}

async function columnSnapshot(client, table) {
  const result = await client.query(
    `select column_name, data_type, udt_name, is_nullable, coalesce(column_default,'') as column_default
       from information_schema.columns
      where table_schema='public' and table_name=$1
      order by ordinal_position`,
    [table],
  );
  return JSON.stringify(result.rows);
}

async function scenarioHealthPrivacy() {
  const db = await newDatabase("healthprivacy");
  await applyOk(db, readRequired(path.join(here, "fixtures", "001_metadata_schema.sql"), "fixture"), "fixture");
  await installLegacyUserSequence(db, 100);
  await withClient(db, async (client) => {
    await seedUser(client, { id: 1, username: "alice", uuid: "synthetic-uuid-alice" });
    await seedUser(client, { id: 2, username: "bob", uuid: "synthetic-uuid-bob" });
    await seedHealth(client, "alice");
    for (const table of HEALTH_TABLES) {
      const extra = table === "polar_data" ? "rri_data" : "iv";
      const value = table === "polar_data" ? `'{"synthetic":"cipher-${table}"}'::jsonb` : `'synthetic-cipher-${table}'`;
      await client.query(`update public.${table} set ${extra}=${value} where username='alice'`);
    }
  });
  await applyOk(db, MIG1.sql, "health-privacy migration1");
  await applyOk(db, MIG2.sql, "health-privacy migration2");
  await applyOk(db, MIG3.sql, "health-privacy migration3");

  // Reproduce T-004 exposure: legacy table/column grants to anon/authenticated
  // and PUBLIC, plus permissive policies for all three before M4.
  await withClient(db, async (client) => {
    for (const table of HEALTH_TABLES) {
      const extra = table === "polar_data" ? "rri_data" : "iv";
      for (const role of ["anon", "authenticated"]) {
        await client.query(
          `grant select (username, ${extra}), insert (username, ${extra}),
                  update (username, ${extra}), references (username, ${extra})
             on table public.${table} to ${role}`,
        );
        await client.query(
          `drop policy if exists legacy_${role}_all on public.${table};
           create policy legacy_${role}_all on public.${table}
             for all to ${role} using (true) with check (true);`,
        );
      }
      await client.query(`grant select, insert, update, delete on table public.${table} to public`);
      await client.query(
        `grant select (username, ${extra}) on table public.${table} to public`,
      );
      await client.query(
        `drop policy if exists legacy_public_all on public.${table};
         create policy legacy_public_all on public.${table}
           for all to public using (true) with check (true);`,
      );
    }
  });

  const before = await withClient(db, async (client) => {
    const fingerprints = {};
    const columns = {};
    for (const table of HEALTH_TABLES) {
      fingerprints[table] = await tableFingerprint(client, table);
      columns[table] = await columnSnapshot(client, table);
    }
    return { fingerprints, columns };
  });

  await test("health-privacy", "legacy exposure is reproducible before M4", async () => {
    const anonRows = await asRole(db, "anon", async (client) =>
      Number(await scalar(client, `select count(*) from public.insulindata`)),
    );
    assertEqual(anonRows, 1, "anon can count health rows before M4");
    const authRows = await asRole(db, "authenticated", async (client) =>
      Number(await scalar(client, `select count(*) from public.insulindata`)),
    );
    assertEqual(authRows, 1, "authenticated can count health rows before M4");
    await withClient(db, async (client) => {
      assertEqual(
        Number(
          await scalar(
            client,
            `select count(*) from pg_policies
              where schemaname='public' and tablename='insulindata' and policyname like 'legacy_%'`,
          ),
        ),
        3,
        "three legacy policies present before M4",
      );
    });
  });

  await test("health-privacy", "M4 SQL security: fixed table list, quoted identifiers, local search_path, no definer", async () => {
    assert(
      MIG4.sql.includes("set local search_path = pg_catalog, public, pg_temp"),
      "M4 pins a safe local search_path",
    );
    assert(!/security\s+definer/i.test(MIG4.sql), "M4 adds no SECURITY DEFINER function");
    for (const table of HEALTH_TABLES) {
      assert(MIG4.sql.includes(`'${table}'`), `M4 fixed table list includes ${table}`);
    }
    assert(
      MIG4.sql.includes("revoke all privileges on table public.%I from public, anon, authenticated"),
      "M4 table revoke is identifier-quoted",
    );
    assert(
      MIG4.sql.includes("drop policy if exists %I on public.%I"),
      "M4 policy drop is identifier-quoted",
    );
    assert(
      MIG4.sql.includes("revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I)"),
      "M4 column revoke is identifier-quoted",
    );
  });

  await test("health-privacy", "M4 closes all six tables for anon/authenticated/PUBLIC, keeps service_role", async () => {
    await applyOk(db, MIG4.sql, "health-privacy migration4");
    await withClient(db, async (client) => {
      const privileges = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];
      for (const table of HEALTH_TABLES) {
        assertEqual(
          await scalar(client, `select relrowsecurity from pg_class where oid='public.${table}'::regclass`),
          true,
          `${table} RLS enabled`,
        );
        const policies = await client.query(
          `select policyname, roles::text[] as roles, cmd, qual, with_check
             from pg_policies where schemaname='public' and tablename=$1`,
          [table],
        );
        assertEqual(policies.rowCount, 1, `${table} exactly one policy after M4`);
        assertEqual(policies.rows[0].policyname, "t025_service_role_all", `${table} service policy`);
        assertEqual(policies.rows[0].roles.join(","), "service_role", `${table} policy roles`);
        assertEqual(policies.rows[0].cmd, "ALL", `${table} policy command`);
        assertEqual(policies.rows[0].qual, "true", `${table} policy USING`);
        assertEqual(policies.rows[0].with_check, "true", `${table} policy WITH CHECK`);

        for (const role of ["anon", "authenticated"]) {
          for (const privilege of privileges) {
            assertEqual(
              await scalar(client, `select has_table_privilege($1,$2,$3)`, [role, `public.${table}`, privilege]),
              false,
              `${role} ${privilege} ${table}`,
            );
          }
          const columns = await client.query(
            `select column_name from information_schema.columns
              where table_schema='public' and table_name=$1 order by ordinal_position`,
            [table],
          );
          for (const { column_name: column } of columns.rows) {
            for (const privilege of ["select", "insert", "update", "references"]) {
              assertEqual(
                await scalar(client, `select has_column_privilege($1,$2,$3,$4)`, [
                  role,
                  `public.${table}`,
                  column,
                  privilege,
                ]),
                false,
                `${role} ${privilege}(${column}) ${table}`,
              );
            }
          }
        }

        for (const privilege of privileges) {
          assertEqual(
            await scalar(client, `select has_table_privilege('service_role',$1,$2)`, [`public.${table}`, privilege]),
            true,
            `service_role ${privilege} ${table}`,
          );
        }

        // No ACL entry for PUBLIC (grantee OID 0), table or column.
        assertEqual(
          Number(
            await scalar(
              client,
              `select count(*) from pg_class c
                cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                where c.oid='public.${table}'::regclass and a.grantee=0`,
            ),
          ),
          0,
          `${table} PUBLIC table ACL`,
        );
        assertEqual(
          Number(
            await scalar(
              client,
              `select count(*) from pg_attribute a
                join pg_class c on c.oid=a.attrelid
                cross join lateral aclexplode(a.attacl) x
                where c.oid='public.${table}'::regclass and a.attnum>0 and not a.attisdropped and x.grantee=0`,
            ),
          ),
          0,
          `${table} PUBLIC column ACL`,
        );
      }

      for (const privilege of ["select", "insert", "update", "delete"]) {
        assertEqual(
          await scalar(client, `select has_table_privilege('service_role','public.users',$1)`, [privilege]),
          true,
          `service_role ${privilege} users (M4 explicit CRUD)`,
        );
      }
    });

    await expectError(
      () => asRole(db, "anon", (client) => client.query(`select count(*) from public.insulindata`)),
      "42501",
    );
    await expectError(
      () => asRole(db, "anon", (client) => client.query(`select username from public.mooddata limit 1`)),
      "42501",
    );
    await expectError(
      () => asRole(db, "authenticated", (client) => client.query(`select count(*) from public.polar_data`)),
      "42501",
    );
    await expectError(
      () =>
        asRole(db, "anon", (client) =>
          client.query(
            `insert into public.insulindata (id,username,dose,date_time)
             values (901,'alice','1u',now()::timestamp)`,
          ),
        ),
      "42501",
    );
  });

  await test("health-privacy", "M4 preserves rows, encrypted payloads, columns and constraints", async () => {
    await withClient(db, async (client) => {
      for (const table of HEALTH_TABLES) {
        const after = await tableFingerprint(client, table);
        assertEqual(after.row_count, before.fingerprints[table].row_count, `${table} row count unchanged`);
        assertEqual(after.digest, before.fingerprints[table].digest, `${table} row/ciphertext digest unchanged`);
        assertEqual(await columnSnapshot(client, table), before.columns[table], `${table} column definitions unchanged`);
      }
    });
  });

  await test("health-privacy", "service_role retains full DML on health tables after M4", async () => {
    await asRole(db, "service_role", async (client) => {
      assertEqual(Number(await scalar(client, `select count(*) from public.insulindata`)), 1, "service sees health row");
      await client.query(
        `insert into public.insulindata (id,username,"insulinType",dose,date_time)
         values (900,'alice','rapid','2u',now()::timestamp)`,
      );
      await client.query(`update public.insulindata set dose='3u' where id=900`);
      assertEqual(await scalar(client, `select dose from public.insulindata where id=900`), "3u", "service update");
      await client.query(`delete from public.insulindata where id=900`);
      assertEqual(Number(await scalar(client, `select count(*) from public.insulindata`)), 1, "service delete restored row count");
    });
  });

  await test("health-privacy", "M4 reapply is idempotent (rows, columns, policies, grants)", async () => {
    await applyOk(db, MIG4.sql, "health-privacy migration4 reapply");
    await withClient(db, async (client) => {
      for (const table of HEALTH_TABLES) {
        const after = await tableFingerprint(client, table);
        assertEqual(after.digest, before.fingerprints[table].digest, `${table} digest after reapply`);
        assertEqual(await columnSnapshot(client, table), before.columns[table], `${table} columns after reapply`);
        assertEqual(
          Number(
            await scalar(
              client,
              `select count(*) from pg_policies
                where schemaname='public' and tablename=$1 and policyname='t025_service_role_all'`,
              [table],
            ),
          ),
          1,
          `${table} single service policy after reapply`,
        );
        for (const role of ["anon", "authenticated"]) {
          assertEqual(
            await scalar(client, `select has_table_privilege($1,$2,'select')`, [role, `public.${table}`]),
            false,
            `${role} remains denied ${table}`,
          );
        }
      }
    });
  });

  await test("health-privacy", "rename/delete RPCs and per-row ciphertext still work with M4 RLS enabled", async () => {
    const extras = {};
    await withClient(db, async (client) => {
      for (const table of HEALTH_TABLES) {
        const extra = table === "polar_data" ? "rri_data::text" : "iv";
        extras[table] = await scalar(client, `select ${extra} from public.${table} where username='alice'`);
      }
    });
    const renamed = await asRole(db, "service_role", (client) =>
      client.query(`select * from public.t009_update_user(1,'alice-private','doctor',true)`),
    );
    assertEqual(renamed.rows[0].Username, "alice-private", "rename returned");
    await withClient(db, async (client) => {
      await assertHealthRows(client, "alice-private", 1);
      for (const table of HEALTH_TABLES) {
        const extra = table === "polar_data" ? "rri_data::text" : "iv";
        assertEqual(
          await scalar(client, `select ${extra} from public.${table} where username='alice-private'`),
          extras[table],
          `${table} ciphertext preserved by rename`,
        );
      }
    });
    await expectError(
      () =>
        asRole(db, "service_role", (client) =>
          client.query(`select public.t009_delete_user(1)`),
        ),
      "P0001",
      "USER_HAS_DATA",
    );
    await withClient(db, async (client) => {
      for (const table of HEALTH_TABLES) {
        await client.query(`delete from public.${table} where username='alice-private'`);
      }
      const deleted = await client.query(`select public.t009_delete_user(1) as deleted`);
      assertEqual(deleted.rows[0].deleted, true, "user deleted after health rows removed");
      assertEqual(Number(await scalar(client, `select count(*) from public.users where "UserID"=1`)), 0, "user gone");
      assertEqual(Number(await scalar(client, `select count(*) from public.users where "UserID"=2`)), 1, "other user kept");
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario: T-053 users privacy (M5) over legacy policies/grants
// ---------------------------------------------------------------------------

async function scenarioUsersPrivacy() {
  const db = await newDatabase("usersprivacy");
  await applyOk(db, readRequired(path.join(here, "fixtures", "001_metadata_schema.sql"), "fixture"), "fixture");
  await installLegacyUserSequence(db, 100);
  await applyOk(db, MIG1.sql, "users-privacy migration1");
  await applyOk(db, MIG2.sql, "users-privacy migration2");
  await withClient(db, async (client) => {
    await seedUser(client, { id: 1, username: "alice", uuid: "synthetic-uuid-alice" });
    await seedUser(client, { id: 2, username: "bob", uuid: "synthetic-uuid-bob" });
    await client.query(
      `update public.users set "GDPRConsent"=true, "GDPRConsentDate"='2026-01-01T00:00:00'
        where "UserID"=1`,
    );

    await client.query(`do $$
      begin
        if not exists (select 1 from pg_roles where rolname='t053_custom') then
          create role t053_custom nologin;
        end if;
      end $$;`);
    await client.query(`grant usage on schema public to t053_custom`);
    await client.query(`grant select on table public.users to t053_custom`);
    await client.query(`drop policy if exists t053_custom_reader on public.users`);
    await client.query(
      `create policy t053_custom_reader on public.users for select to t053_custom using (true)`,
    );

    // Legacy unsafe state: table + column CRUD grants and permissive policies.
    await client.query(`grant all privileges on table public.users to public`);
    for (const role of ["public", "anon", "authenticated"]) {
      await client.query(
        `grant select ("PasswordHash","UUID","GDPRConsent","GDPRConsentDate"),
                insert ("Username","PasswordHash"),
                update ("Username","PasswordHash"),
                references ("UserID")
           on table public.users to ${role}`,
      );
    }
    for (const role of ["public", "anon", "authenticated"]) {
      const name = `legacy_${role}_users_all`;
      await client.query(`drop policy if exists ${name} on public.users`);
      await client.query(
        `create policy ${name} on public.users for all to ${role} using (true) with check (true)`,
      );
    }
  });

  await applyOk(db, MIG3.sql, "users-privacy migration3");
  await applyOk(db, MIG4.sql, "users-privacy migration4");

  await test("users-privacy", "legacy PUBLIC/anon/authenticated exposure reproduced before M5", async () => {
    const anon = await asRole(db, "anon", async (client) =>
      (
        await client.query(
          `select "UUID","GDPRConsent","GDPRConsentDate" from public.users where "UserID"=1`,
        )
      ).rows[0],
    );
    assertEqual(anon.UUID, "synthetic-uuid-alice", "anon can project UUID before M5");
    assertEqual(anon.GDPRConsent, true, "anon can project GDPR before M5");
    const authenticated = await asRole(db, "authenticated", async (client) =>
      Number(
        (
          await client.query(`select "UserID" from public.users order by "UserID"`)
        ).rowCount,
      ),
    );
    assertEqual(authenticated, 2, "authenticated can read users before M5");
  });

  const beforeM5 = await withClient(db, async (client) => ({
    fingerprint: await usersFingerprint(client),
    columns: await columnSnapshot(client, "users"),
  }));

  await test("users-privacy", "M5 SQL security: fixed users table, quoted identifiers, local search_path, no definer", async () => {
    assert(MIG5.sql.includes("set local search_path = pg_catalog, public, pg_temp"), "M5 pins search_path");
    assert(MIG5.sql.includes("lock table public.users in access exclusive mode"), "M5 locks users");
    assert(MIG5.sql.includes("revoke all privileges on table public.users"), "M5 table revoke");
    assert(
      MIG5.sql.includes("revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I)"),
      "M5 column revoke is quoted",
    );
    assert(MIG5.sql.includes("drop policy if exists %I on public.users"), "M5 policy drop is quoted");
    assert(MIG5.sql.includes("grant select, insert, update, delete on table public.users to service_role"), "M5 service CRUD");
    assert(MIG5.sql.includes("grant usage, select on sequence %s to service_role"), "M5 sequence grant");
  });

  await test("users-privacy", "M5 removes PUBLIC/anon/authenticated read, profile UUID/GDPR and hash access", async () => {
    await applyOk(db, MIG5.sql, "users-privacy migration5");
    await withClient(db, async (client) => {
      assertEqual(await scalar(client, `select relrowsecurity from pg_class where oid='public.users'::regclass`), true, "users RLS");
      const policies = await client.query(
        `select policyname, roles::text[] as roles from pg_policies
          where schemaname='public' and tablename='users' order by policyname`,
      );
      assert(policies.rows.some((row) => row.policyname === "t053_custom_reader"), "custom policy preserved");
      for (const policy of policies.rows) {
        if (policy.policyname === "t053_custom_reader") continue;
        assertEqual(policy.roles.join(","), "service_role", `${policy.policyname} must be service-only`);
      }
      assertEqual(
        policies.rows.filter((row) => row.roles.join(",") === "service_role").length,
        2,
        "M3 and M5 service policies preserved",
      );
      for (const role of ["anon", "authenticated"]) {
        for (const privilege of ["select", "insert", "update", "delete", "truncate", "references", "trigger"]) {
          assertEqual(
            await scalar(client, `select has_table_privilege($1,'public.users',$2)`, [role, privilege]),
            false,
            `${role} ${privilege} users`,
          );
        }
        const columns = await client.query(
          `select column_name from information_schema.columns
            where table_schema='public' and table_name='users' order by ordinal_position`,
        );
        for (const { column_name: column } of columns.rows) {
          for (const privilege of ["select", "insert", "update", "references"]) {
            assertEqual(
              await scalar(client, `select has_column_privilege($1,'public.users',$2,$3)`, [role, column, privilege]),
              false,
              `${role} ${privilege}(${column}) users`,
            );
          }
        }
      }
      assertEqual(
        Number(
          await scalar(
            client,
            `select count(*) from pg_class c
              cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
              where c.oid='public.users'::regclass and a.grantee=0`,
          ),
        ),
        0,
        "PUBLIC users table ACL",
      );
      assertEqual(
        Number(
          await scalar(
            client,
            `select count(*) from pg_attribute a
              join pg_class c on c.oid=a.attrelid
              cross join lateral aclexplode(a.attacl) x
              where c.oid='public.users'::regclass and a.attnum>0 and not a.attisdropped and x.grantee=0`,
          ),
        ),
        0,
        "PUBLIC users column ACL",
      );
    });
    await expectError(
      () => asRole(db, "anon", (client) =>
        client.query(`select "UserID","Username","UUID","GDPRConsent","GDPRConsentDate","role" from public.users`),
      ),
      "42501",
    );
    await expectError(
      () => asRole(db, "anon", (client) => client.query(`select "PasswordHash" from public.users`)),
      "42501",
    );
    await expectError(
      () => asRole(db, "authenticated", (client) =>
        client.query(`select "UserID","Username","UUID","GDPRConsent","GDPRConsentDate","role" from public.users`),
      ),
      "42501",
    );
    await expectError(
      () => asRole(db, "authenticated", (client) => client.query(`select "PasswordHash" from public.users`)),
      "42501",
    );
    for (const role of ["anon", "authenticated"]) {
      for (const sql of [
        `update public.users set "PasswordHash"='synthetic-overwrite' where "UserID"=1`,
        `insert into public.users ("Username","PasswordHash") values ('unsafe','synthetic')`,
        `delete from public.users where "UserID"=1`,
      ]) {
        await expectError(() => asRole(db, role, (client) => client.query(sql)), "42501");
      }
    }
  });

  await test("users-privacy", "M5 preserves rows/schema and custom role policy access", async () => {
    await withClient(db, async (client) => {
      const after = await usersFingerprint(client);
      assertEqual(after.row_count, beforeM5.fingerprint.row_count, "users row count unchanged");
      assertEqual(after.digest, beforeM5.fingerprint.digest, "users digest unchanged");
      assertEqual(await columnSnapshot(client, "users"), beforeM5.columns, "users column definitions unchanged");
      assertEqual(
        Number(await scalar(client, `select count(*) from pg_policies where schemaname='public' and tablename='users' and policyname='t053_custom_reader'`)),
        1,
        "custom policy remains",
      );
    });
    const customRows = await asRole(db, "t053_custom", async (client) =>
      Number(await scalar(client, `select count(*) from public.users`)),
    );
    assertEqual(customRows, 2, "custom role policy/access preserved");
  });

  await test("users-privacy", "service_role CRUD and UserID sequence allocation preserved after M5", async () => {
    await withClient(db, async (client) => {
      const sequence = await scalar(client, `select pg_get_serial_sequence('public.users','UserID')`);
      assert(sequence, "users sequence resolved");
      for (const privilege of ["usage", "select"]) {
        assertEqual(
          await scalar(client, `select has_sequence_privilege('service_role',$1,$2)`, [sequence, privilege]),
          true,
          `service_role ${privilege} users sequence`,
        );
      }
    });
    const createdId = await asRole(db, "service_role", async (client) => {
      const inserted = await client.query(
        `insert into public.users ("Username","PasswordHash","role")
         values ('t053-service-created','synthetic-not-a-real-hash','user')
         returning "UserID","PasswordHash"`,
      );
      assertEqual(inserted.rows[0].PasswordHash, "synthetic-not-a-real-hash", "service can read hash");
      await client.query(`update public.users set "Username"='t053-service-updated' where "UserID"=$1`, [inserted.rows[0].UserID]);
      return Number(inserted.rows[0].UserID);
    });
    assert(createdId >= 101, `service sequence allocation, got ${createdId}`);
    await asRole(db, "service_role", async (client) => {
      const row = await client.query(`select "Username" from public.users where "UserID"=$1`, [createdId]);
      assertEqual(row.rows[0].Username, "t053-service-updated", "service update");
      await client.query(`delete from public.users where "UserID"=$1`, [createdId]);
    });
    await withClient(db, async (client) => {
      assertEqual(Number(await scalar(client, `select count(*) from public.users where "UserID"=$1`, [createdId])), 0, "service delete");
    });
  });

  await test("users-privacy", "M5 reapply is idempotent and preserves rows, schema, policies and grants", async () => {
    await applyOk(db, MIG5.sql, "users-privacy migration5 reapply");
    await withClient(db, async (client) => {
      const after = await usersFingerprint(client);
      assertEqual(after.digest, beforeM5.fingerprint.digest, "users digest after reapply");
      assertEqual(await columnSnapshot(client, "users"), beforeM5.columns, "users columns after reapply");
      assertEqual(
        Number(await scalar(client, `select count(*) from pg_policies where schemaname='public' and tablename='users' and policyname='t053_custom_reader'`)),
        1,
        "custom policy after reapply",
      );
      for (const role of ["anon", "authenticated"]) {
        assertEqual(
          await scalar(client, `select has_table_privilege($1,'public.users','select')`, [role]),
          false,
          `${role} remains denied after reapply`,
        );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario: concurrent insert vs delete
// ---------------------------------------------------------------------------

async function scenarioRace() {
  const db = await newDatabase("race");
  await applyOk(db, readRequired(path.join(here, "fixtures", "001_metadata_schema.sql"), "fixture"), "fixture");
  await installLegacyUserSequence(db, 100);
  await applyOk(db, authSql, "auth schema");
  await applyAllMigrations(db);
  await withClient(db, async (client) => {
    await seedUser(client, { id: 10, username: "race-delete" });
    await seedUser(client, { id: 11, username: "race-insert" });
  });

  await test("race", "delete holds SHARE ROW EXCLUSIVE and blocks a concurrent health insert", async () => {
    const deleteClient = await connect(db);
    let insertPromise;
    try {
      await deleteClient.query("begin");
      const deletion = await deleteClient.query(`select public.t009_delete_user(10) as deleted`);
      assertEqual(deletion.rows[0].deleted, true, "delete applied before commit");
      const lock = await withClient(db, async (client) =>
        scalar(
          client,
          `select bool_or(l.mode = 'ShareRowExclusiveLock')
             from pg_locks l
            where l.relation='public.exercisedata'::regclass
              and l.granted
              and l.pid <> pg_backend_pid()`,
        ),
      );
      assertEqual(lock, true, "SHARE ROW EXCLUSIVE lock held while delete txn open");
      const insertClient = await connect(db);
      const started = Date.now();
      insertPromise = insertClient
        .query(
          `insert into public.exercisedata
             (id,username,exercise_type,intensity,exercise_start_time,exercise_end_time,date_time)
           values (2,'race-delete','walk',1,now()::timestamp,now()::timestamp,now()::timestamp)`,
        )
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error }))
        .finally(() => insertClient.end().catch(() => {}));
      await new Promise((resolve) => setTimeout(resolve, 250));
      await deleteClient.query("commit");
      const outcome = await insertPromise;
      const elapsed = Date.now() - started;
      assertEqual(outcome.ok, false, "insert after commit fails");
      assertEqual(outcome.error.code, "23503", "insert SQLSTATE");
      assert(elapsed >= 200, `insert waited for delete commit (${elapsed}ms)`);
    } finally {
      await deleteClient.query("rollback").catch(() => {});
      await deleteClient.end().catch(() => {});
      if (insertPromise) await insertPromise.catch(() => {});
    }
    await withClient(db, async (client) => {
      assertEqual(Number(await scalar(client, `select count(*) from public.users where "UserID"=10`)), 0, "user deleted");
      assertEqual(Number(await scalar(client, `select count(*) from public.exercisedata where username='race-delete'`)), 0, "no race row");
    });
  });

  await test("race", "uncommitted insert blocks delete; delete then sees data and returns USER_HAS_DATA", async () => {
    const insertClient = await connect(db);
    let deletePromise;
    try {
      await insertClient.query("begin");
      await insertClient.query(
        `insert into public.exercisedata
           (id,username,exercise_type,intensity,exercise_start_time,exercise_end_time,date_time)
         values (3,'race-insert','walk',1,now()::timestamp,now()::timestamp,now()::timestamp)`,
      );
      const started = Date.now();
      const deleteClient = await connect(db);
      deletePromise = deleteClient
        .query(`select public.t009_delete_user(11) as deleted`)
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, error }))
        .finally(() => deleteClient.end().catch(() => {}));
      await new Promise((resolve) => setTimeout(resolve, 250));
      await insertClient.query("commit");
      const outcome = await deletePromise;
      const elapsed = Date.now() - started;
      assertEqual(outcome.ok, false, "delete blocked then rejected");
      assertEqual(outcome.error.code, "P0001", "delete SQLSTATE");
      assert(String(outcome.error.message).includes("USER_HAS_DATA"), "USER_HAS_DATA marker");
      assert(elapsed >= 200, `delete waited for insert commit (${elapsed}ms)`);
    } finally {
      await insertClient.query("rollback").catch(() => {});
      await insertClient.end().catch(() => {});
      if (deletePromise) await deletePromise.catch(() => {});
    }
    await withClient(db, async (client) => {
      assertEqual(Number(await scalar(client, `select count(*) from public.users where "UserID"=11`)), 1, "user kept");
      assertEqual(Number(await scalar(client, `select count(*) from public.exercisedata where username='race-insert'`)), 1, "insert committed and preserved");
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`T-014 SQL validation (run ${runId})`);
  console.log(`Container expected: ${CONTAINER_NAME} at 127.0.0.1:15432 (runner never manages containers)\n`);
  assert(PG.host === "127.0.0.1", "refusing non-loopback PostgreSQL host");
  assertEqual(PG.port, 15432, "refusing non-dedicated PostgreSQL port");

  try {
    await preflight();
    await scenarioDuplicatePreflight();
    await scenarioSchemaAndSequence();
    await scenarioCore();
    await scenarioAuth();
    await scenarioAuthLegacy();
    await scenarioHealthPrivacy();
    await scenarioUsersPrivacy();
    await scenarioRace();
  } finally {
    if (process.env.T014_KEEP_DBS !== "1") {
      await dropAllDatabases().catch((error) => {
        console.error(`database cleanup failed: ${formatError(error)}`);
      });
    }
  }

  const failed = RESULTS.filter((result) => result.status === "FAIL");
  const warnings = FINDINGS.length;
  console.log(
    `\nSummary: ${RESULTS.length - failed.length}/${RESULTS.length} checks passed, ${failed.length} failed, ${warnings} warnings.`,
  );
  console.log(`Hashes: auth_LF=${hashes.authSchemaCanonicalLf} auth_raw=${hashes.authSchema}`);
  console.log(`Hashes: M1=${hashes.migration1} M2=${hashes.migration2} M3=${hashes.migration3} M4=${hashes.migration4} M5=${hashes.migration5}`);
  if (metadataPath) console.log(`Metadata source: ${metadataPath}`);
  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const failure of failed) console.log(` - ${failure.section} :: ${failure.name}: ${failure.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`T-014 harness aborted: ${formatError(error)}`);
  console.error(error instanceof Error ? error.stack : "");
  process.exitCode = 1;
});

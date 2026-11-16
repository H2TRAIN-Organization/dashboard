#!/usr/bin/env node
/**
 * Readonly verification of the health-record key resolution (alias flow).
 *
 * The dashboard reads health tables with `username in (recordKeys)`. This
 * script resolves those keys for one account against a real Supabase project
 * and reports, per table, which rows the dashboard would include. It never
 * writes, never exports ciphertext, keys or hashes, and never prints row
 * payloads: only identifiers (id, username, date).
 *
 * The authoritative resolution logic lives in
 * src/server/infrastructure/auth/health-record-key-resolver.ts; this script
 * mirrors it readonly for operational verification.
 *
 * Usage (env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
 *   node scripts/check_health_record_keys.mjs --username <email> [--user-id N]
 */
import { createClient } from "@supabase/supabase-js";
import process from "node:process";

const AUTH_PREFIX = "auth_";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABLES = [
  ["mooddata", "date_time"],
  ["insulindata", "date_time"],
  ["fooddata", "date_time"],
  ["exercisedata", "date_time"],
  ["periodrecords", "startDate"],
];

function readArgs(argv) {
  const args = { username: null, userId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--username") {
      args.username = argv[index + 1] ?? null;
      index += 1;
    } else if (value === "--user-id") {
      args.userId = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return args;
}

function readAppUserId(appMetadata) {
  const raw = appMetadata?.app_user_id;
  if (typeof raw === "number" && Number.isSafeInteger(raw)) return raw;
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return null;
}

async function scanIdentities(admin) {
  const identities = [];
  for (let page = 1; page <= 2; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error !== null && error !== undefined) {
      throw new Error("auth admin listUsers failed");
    }
    const users = Array.isArray(data) ? data : data?.users ?? [];
    for (const user of users) {
      if (typeof user.id === "string" && UUID_PATTERN.test(user.id)) {
        identities.push({
          id: user.id,
          email: typeof user.email === "string" ? user.email : null,
          emailConfirmed:
            typeof user.email_confirmed_at === "string" &&
            user.email_confirmed_at !== "",
          appUserId: readAppUserId(user.app_metadata),
        });
      }
    }
    if (users.length < 1000) break;
  }
  return identities;
}

async function resolveRecordKeys(admin, username, providedUserId) {
  const identities = await scanIdentities(admin);
  let targetUserId = providedUserId === null ? null : Number(providedUserId);
  if (targetUserId === null || !Number.isInteger(targetUserId)) {
    const { data } = await admin
      .from("users")
      .select("UserID")
      .eq("Username", username)
      .limit(1);
    const row = Array.isArray(data) ? data[0] : null;
    targetUserId = typeof row?.UserID === "number" ? row.UserID : null;
  }

  const keys = [username];
  for (const identity of identities) {
    const emailMatch =
      identity.emailConfirmed &&
      identity.email !== null &&
      identity.email.toLowerCase() === username.toLowerCase();
    const administeredMatch =
      targetUserId !== null && identity.appUserId === targetUserId;
    if (emailMatch || administeredMatch) {
      keys.push(`${AUTH_PREFIX}${identity.id}`);
    }
  }
  return keys;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    console.error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
    process.exit(2);
  }
  if (!args.username) {
    console.error("Uso: node scripts/check_health_record_keys.mjs --username <email> [--user-id N]");
    process.exit(2);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const keys = await resolveRecordKeys(admin, args.username, args.userId);
  console.log("== Claves de registro resueltas (readonly) ==");
  for (const key of keys) console.log(" -", key);

  const aliasFilter = `username.in.(${keys.map((key) => `"${key}"`).join(",")})`;
  console.log("\n== Filtrado PostgREST equivalente ==");
  console.log(" -", aliasFilter);

  console.log("\n== Registros por tabla (id | username | fecha) ==");
  for (const [table, dateColumn] of TABLES) {
    const { data, error } = await admin
      .from(table)
      .select(`id,username,${dateColumn}`)
      .in("username", keys)
      .order("id", { ascending: true });
    if (error !== null && error !== undefined) {
      console.log(` ${table}: ERROR (sin detalle)`);
      continue;
    }
    console.log(` ${table}: ${(data ?? []).length} registro(s)`);
    for (const row of data ?? []) {
      console.log(
        `   id=${row.id} | username=${row.username} | ${row[dateColumn]}`,
      );
    }
  }
}

main().catch(() => {
  console.error("Verificación interrumpida.");
  process.exit(1);
});

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const HEALTH_TABLES = [
  "insulindata",
  "fooddata",
  "exercisedata",
  "periodrecords",
  "mooddata",
  "polar_data",
] as const;

async function migration(): Promise<string> {
  return readFile(
    new URL(
      "../../supabase/migrations/20261021130000_t025_health_tables_private.sql",
      import.meta.url,
    ),
    "utf8",
  );
}

describe("T-025 health tables privacy migration", () => {
  it("covers the six verified health tables", async () => {
    const sql = await migration();
    for (const table of HEALTH_TABLES) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it("revokes table and column access from PUBLIC/anon/authenticated", async () => {
    const sql = (await migration()).toLowerCase();
    const statements = sql.replace(/--.*$/gm, "");
    expect(sql).toContain(
      "revoke all privileges on table public.%i from public, anon, authenticated",
    );
    expect(sql).toContain("revoke select (%1$i), insert (%1$i), update (%1$i), references (%1$i)");
    expect(statements).not.toMatch(/grant[\s\S]*?\bto\s+(public|anon|authenticated)\b/i);
    expect(statements).not.toMatch(/create\s+policy[\s\S]*?\bto\s+(public|anon|authenticated)\b/i);
  });

  it("enables RLS and leaves only explicit service_role access", async () => {
    const sql = (await migration()).toLowerCase();
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("drop policy if exists");
    expect(sql).toContain("create policy %i on public.%i for all to service_role");
    expect(sql).toContain("grant all privileges on table public.%i to service_role");
    expect(sql).toContain("grant usage on schema public to service_role");
    expect(sql).toContain("t025_service_role_all");
  });

  it("keeps sequence grants and uses a safe search_path", async () => {
    const sql = (await migration()).toLowerCase();
    expect(sql).toContain(
      "set local search_path = pg_catalog, public, pg_temp",
    );
    expect(sql).toContain("pg_get_serial_sequence");
    expect(sql).toContain("revoke all privileges on sequence");
    expect(sql).toContain("grant usage, select on sequence");
  });

  it("is idempotent and does not mutate preserved data", async () => {
    const sql = (await migration()).toLowerCase();
    expect(sql).toContain("drop policy if exists");
    expect(sql).toContain("notify pgrst, 'reload schema'");
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate\s+(table\s+)?public\./i);
    expect(sql).not.toMatch(/insert\s+into\s+public\./i);
    expect(sql).not.toMatch(/delete\s+from\s+public\./i);
    expect(sql).not.toMatch(/update\s+public\./i);
  });
});

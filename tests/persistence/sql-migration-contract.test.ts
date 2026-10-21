import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function migration(name: string): Promise<string> {
  const source = await readFile(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
  return source.replace(/\r\n/g, "\n");
}

describe("T-009 SQL migrations", () => {
  it("adds the username unique index, real sequence default and FK protections", async () => {
    const sql = await migration("20261021120000_t009_health_username_integrity.sql");
    expect(sql).toContain("create unique index if not exists users_username_key");
    expect(sql).toContain('on public.users ("Username")');
    expect(sql).toContain("pg_get_serial_sequence");
    expect(sql).toContain("create sequence if not exists public.users_userid_seq");
    expect(sql).toContain("v_sequence := 'public.users_userid_seq'");
    expect(sql).not.toContain("public.users.users_userid_seq");
    expect(sql).toContain("grant usage, select on sequence");
    expect(sql).toContain('set default nextval');
    expect(sql.toLowerCase()).toContain('references public.users ("username")');
    expect(sql).toContain("on update cascade");
    expect(sql).toContain("on delete restrict");
    expect(sql).toContain("not valid");
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate\s+/i);
  });

  it("locks health writers and rejects delete when data exists", async () => {
    const sql = await migration("20261021120100_t009_user_admin_rpcs.sql");
    expect(sql).toContain("share row exclusive mode");
    expect(sql).toContain("lock table public.insulindata");
    expect(sql).toContain("t009_assert_username_fks_ready");
    expect(sql).toContain("t009_update_user");
    expect(sql).toContain("t009_delete_user");
    expect(sql).toContain("t009_user_has_health_data");
    expect(sql).toContain("message = 'USER_HAS_DATA'");
    expect(sql).toContain("PERSISTENCE_MIGRATION_REQUIRED");
    expect(sql).toContain("revoke all on function");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/delete\s+from\s+public\.(insulindata|fooddata|exercisedata|periodrecords|mooddata|polar_data)/i);
    expect(sql).not.toContain("max(\"UserID\")");
  });

  it("removes PasswordHash from anon/authenticated while keeping service_role", async () => {
    const sql = await migration("20261021120200_t009_password_hash_grants.sql");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke select on table public.users from public");
    expect(sql).toContain("revoke select on table public.users from anon, authenticated");
    expect(sql).toContain('grant select (\n  "UserID",\n  "Username",');
    expect(sql).toContain('"role"');
    expect(sql).not.toMatch(/grant\s+select\s*\([^)]*"PasswordHash"/i);
    expect(sql).toContain("grant select on table public.users to service_role");
    expect(sql).toContain("grant execute on function public.t009_update_user");
  });

  it("does not apply remote changes or contain credential values", async () => {
    const files = await Promise.all([
      migration("20261021120000_t009_health_username_integrity.sql"),
      migration("20261021120100_t009_user_admin_rpcs.sql"),
      migration("20261021120200_t009_password_hash_grants.sql"),
    ]);
    for (const sql of files) {
      expect(sql).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co/i);
      expect(sql).not.toContain("eyJ");
      expect(sql).not.toContain("ENCRYPTION_SECRET_KEY");
      expect(sql).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(sql).not.toMatch(/insert\s+into\s+public\./i);
    }
  });
});

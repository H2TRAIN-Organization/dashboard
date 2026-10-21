import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../src/server/infrastructure/auth/supabase-auth-schema.sql",
      import.meta.url,
    ),
  ),
  "utf8",
).replace(/\r\n/g, "\n");

describe("auth SQL integrity contract", () => {
  it("stores auth_sessions.user_id as an integer FK with cascade", () => {
    expect(sql).toContain("user_id integer not null");
    expect(sql).toContain('references public.users ("UserID")');
    expect(sql).toContain("on update cascade on delete cascade");
    expect(sql).toContain("auth_sessions_user_id_fkey");
    expect(sql).not.toMatch(/user_id\s+(text|character varying|character)\b/i);
  });

  it("enforces expiry after issue and repairs legacy text columns idempotently", () => {
    expect(sql).toContain(
      "constraint auth_sessions_expiry_after_issue_check\n    check (expires_at > issued_at)",
    );
    expect(sql).toContain("create table if not exists public.auth_sessions");
    expect(sql).toContain("if v_type in ('text', 'character varying', 'character')");
    expect(sql).toContain("alter column user_id type integer using user_id::integer");
    expect(sql).toContain("add constraint auth_sessions_expiry_after_issue_check");
    expect(sql).toContain("drop constraint %I");
  });

  it("provides privileged idempotent TTL cleanup without scheduling cron", () => {
    expect(sql).toContain("function public.auth_cleanup_expired(");
    expect(sql).toContain("security definer");
    expect(sql).toContain(
      "revoke all on function public.auth_cleanup_expired(interval, interval)",
    );
    expect(sql).toContain(
      "grant execute on function public.auth_cleanup_expired(interval, interval)",
    );
    expect(sql).toMatch(/no remote cron/i);
    expect(sql).not.toMatch(/create\s+extension\s+pg_cron/i);
  });
});

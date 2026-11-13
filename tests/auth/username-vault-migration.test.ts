import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

/**
 * Contrato SQL de MT46: el username se cifra con Vault + pgcrypto, se puede
 * descifrar server-side (condición del cambio) y se resuelve por HMAC sin
 * descifrar. La migración es idempotente y niega todo a anon/authenticated.
 */
async function migration(): Promise<string> {
  const source = await readFile(
    new URL(
      "../../supabase/migrations/20261113100000_auth_username_vault.sql",
      import.meta.url,
    ),
    "utf8",
  );
  return source.replace(/\r\n/g, "\n");
}

describe("MT46 username vault migration", () => {
  it("instala pgcrypto y vault y crea los dos secretos con nombre fijo", async () => {
    const sql = await migration();
    expect(sql).toContain("create extension if not exists pgcrypto");
    expect(sql).toContain("create extension if not exists vault with schema vault");
    expect(sql).toContain("dashboard-username-enc-v1");
    expect(sql).toContain("dashboard-username-hmac-v1");
    // Las claves se generan en la BD; jamás hay material de clave en el fichero.
    expect(sql).not.toMatch(/[0-9a-f]{32,}/i);
  });

  it("añade las columnas cifradas y el índice único de lookup con backfill idempotente", async () => {
    const sql = await migration();
    expect(sql).toContain("add column if not exists username_enc bytea");
    expect(sql).toContain("add column if not exists username_key_id uuid");
    expect(sql).toContain("add column if not exists username_lookup text");
    expect(sql).toContain("create unique index if not exists users_username_lookup_key");
    expect(sql).toContain("where keys.enc_secret is not null");
    expect(sql).toContain("and (u.username_enc is null or u.username_lookup is null)");
    // El backfill no puede borrar ni reescribir datos existentes.
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate\s+/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\./i);
  });

  it("descifra server-side en auth_username_display y falla cerrado sin clave", async () => {
    const sql = await migration();
    expect(sql).toContain("create or replace function public.auth_username_display(p_user_id integer)");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("extensions.pgp_sym_decrypt(row_record.username_enc, key_secret)");
    expect(sql).toContain("raise sqlstate 'PT503' using message = 'VAULT_KEY_UNAVAILABLE'");
    // Fallback legacy de transición: solo si username_enc aún no existe.
    expect(sql).toContain("if row_record.username_enc is null then");
    expect(sql).toContain("return row_record.legacy;");
  });

  it("resuelve por HMAC sin descifrar y exige email confirmado sin ban", async () => {
    const sql = await migration();
    expect(sql).toContain("create or replace function public.auth_username_resolve(p_username text)");
    expect(sql).toContain("extensions.hmac(lower(normalize(trim(p_username), NFC)), hmac_secret, 'sha256')");
    expect(sql).toContain("au.raw_app_meta_data->>'app_user_id' = u.\"UserID\"::text");
    expect(sql).toContain("au.email_confirmed_at is not null");
    expect(sql).toContain("au.banned_until is null");
    expect(sql).toContain("limit 2");
  });

  it("descifra listados en una sola consulta sin exponer la clave", async () => {
    const sql = await migration();
    expect(sql).toContain("create or replace function public.auth_username_display_batch(p_user_ids integer[])");
    expect(sql).toContain("extensions.pgp_sym_decrypt(item.username_enc, key_secret)");
    expect(sql).toContain("revoke all on function public.auth_username_display_batch(integer[]) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.auth_username_display_batch(integer[]) to service_role");
  });

  it("auth_username_set cifra, calcula lookup y mantiene el espejo de transición", async () => {
    const sql = await migration();
    expect(sql).toContain("create or replace function public.auth_username_set(p_user_id integer, p_username text)");
    expect(sql).toContain("extensions.pgp_sym_encrypt(display_value, enc_secret)");
    expect(sql).toContain("lower(normalize(display_value, NFC))");
    expect(sql).toContain('"Username" = display_value');
    expect(sql).toContain("raise sqlstate 'PT400' using message = 'INVALID_USERNAME'");
    expect(sql).toContain("raise sqlstate 'PT404' using message = 'UNKNOWN_USER'");
  });

  it("niega todo a anon/authenticated y solo concede execute a service_role", async () => {
    const sql = await migration();
    expect(sql).toContain("revoke all on function public.auth_username_display(integer) from public, anon, authenticated");
    expect(sql).toContain("revoke all on function public.auth_username_resolve(text) from public, anon, authenticated");
    expect(sql).toContain("revoke all on function public.auth_username_set(integer, text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.auth_username_display(integer) to service_role");
    expect(sql).toContain("grant execute on function public.auth_username_resolve(text) to service_role");
    expect(sql).toContain("grant execute on function public.auth_username_set(integer, text) to service_role");
    expect(sql).toContain("revoke usage on schema vault from anon, authenticated, public");
    expect(sql).toContain("revoke select on vault.decrypted_secrets from anon, authenticated, public");
  });

  it("no contiene credenciales ni endpoints del proyecto", async () => {
    const sql = await migration();
    expect(sql).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co/i);
    expect(sql).not.toContain("eyJ");
    expect(sql).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(sql).not.toContain("ENCRYPTION_SECRET_KEY");
  });
});

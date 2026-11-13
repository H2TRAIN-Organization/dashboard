import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

/**
 * Contrato SQL de MT46 (variante sin Vault): el username se cifra con
 * pgcrypto con claves en un esquema privado, se puede descifrar server-side
 * (condición del cambio) y se resuelve por HMAC sin descifrar. La migración
 * es idempotente y niega todo a anon/authenticated e incluso a service_role
 * en la tabla de claves.
 */
async function migration(): Promise<string> {
  const source = await readFile(
    new URL(
      "../../supabase/migrations/20261113100000_auth_username_encryption.sql",
      import.meta.url,
    ),
    "utf8",
  );
  return source.replace(/\r\n/g, "\n");
}

describe("MT46 username encryption migration (sin Vault)", () => {
  it("instala pgcrypto y no depende de Vault", async () => {
    const sql = await migration();
    expect(sql).toContain("create extension if not exists pgcrypto");
    // Sin llamadas al esquema vault ni a su extensión (el texto explicativo
    // puede mencionar la variante descartada).
    expect(sql).not.toMatch(/vault\./i);
    expect(sql).not.toMatch(/create\s+extension[^;]*vault/i);
  });

  it("genera las claves una sola vez en un esquema privado sin imprimirlas", async () => {
    const sql = await migration();
    expect(sql).toContain("create schema if not exists private");
    expect(sql).toContain("create table if not exists private.mt46_keys");
    expect(sql).toContain("check (id in ('enc', 'hmac'))");
    expect(sql).toContain("encode(extensions.gen_random_bytes(32), 'hex')");
    // Las claves se generan en la BD; jamás hay material de clave en el fichero.
    expect(sql).not.toMatch(/[0-9a-f]{32,}/i);
  });

  it("niega la tabla de claves a anon, authenticated y service_role", async () => {
    const sql = await migration();
    expect(sql).toContain(
      "revoke all on schema private from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "revoke all on table private.mt46_keys from public, anon, authenticated, service_role",
    );
  });

  it("añade las columnas cifradas y el índice único de lookup con backfill idempotente", async () => {
    const sql = await migration();
    expect(sql).toContain("add column if not exists username_enc bytea");
    expect(sql).toContain("add column if not exists username_lookup text");
    expect(sql).not.toContain("username_key_id");
    expect(sql).toContain("create unique index if not exists users_username_lookup_key");
    expect(sql).toContain("where keys.enc_secret is not null");
    expect(sql).toContain("and (u.username_enc is null or u.username_lookup is null)");
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
    expect(sql).toContain("raise sqlstate 'PT503' using message = 'KEY_UNAVAILABLE'");
    expect(sql).toContain("select value into key_secret from private.mt46_keys where id = 'enc'");
    // Fallback legacy de transición: solo si username_enc aún no existe.
    expect(sql).toContain("if row_record.username_enc is null then");
    expect(sql).toContain("return row_record.legacy;");
  });

  it("resuelve por HMAC sin descifrar y exige email confirmado sin ban", async () => {
    const sql = await migration();
    expect(sql).toContain("create or replace function public.auth_username_resolve(p_username text)");
    expect(sql).toContain(
      "extensions.hmac(lower(normalize(trim(p_username), NFC)), hmac_secret, 'sha256')",
    );
    expect(sql).toContain('au.raw_app_meta_data->>\'app_user_id\' = u."UserID"::text');
    expect(sql).toContain("au.email_confirmed_at is not null");
    expect(sql).toContain("au.banned_until is null");
    expect(sql).toContain("limit 2");
  });

  it("descifra listados en una sola consulta sin exponer la clave", async () => {
    const sql = await migration();
    expect(sql).toContain(
      "create or replace function public.auth_username_display_batch(p_user_ids integer[])",
    );
    expect(sql).toContain("extensions.pgp_sym_decrypt(item.username_enc, key_secret)");
    expect(sql).toContain(
      "revoke all on function public.auth_username_display_batch(integer[]) from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.auth_username_display_batch(integer[]) to service_role",
    );
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

  it("solo concede execute a service_role y niega el resto", async () => {
    const sql = await migration();
    expect(sql).toContain("revoke all on function public.auth_username_display(integer) from public, anon, authenticated");
    expect(sql).toContain("revoke all on function public.auth_username_resolve(text) from public, anon, authenticated");
    expect(sql).toContain("revoke all on function public.auth_username_set(integer, text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.auth_username_display(integer) to service_role");
    expect(sql).toContain("grant execute on function public.auth_username_resolve(text) to service_role");
    expect(sql).toContain("grant execute on function public.auth_username_set(integer, text) to service_role");
  });

  it("no contiene credenciales ni endpoints del proyecto", async () => {
    const sql = await migration();
    expect(sql).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co/i);
    expect(sql).not.toContain("eyJ");
    expect(sql).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(sql).not.toContain("ENCRYPTION_SECRET_KEY");
  });
});

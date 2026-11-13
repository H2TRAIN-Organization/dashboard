-- MT46 · Auth Fase 1: cifrado del username con Supabase Vault + pgcrypto.
--
-- El nombre de usuario deja de leerse en claro desde la base de datos y pasa
-- a almacenarse cifrado por columna, manteniendo dos propiedades del contrato:
--
-- 1. Pintable: `auth_username_display` descifra el username server-side
--    (service_role); el DTO de sesión lo sirve al frontend sin exponer la
--    clave, que vive dentro de Vault.
-- 2. Resoluble: `auth_username_resolve` localiza la cuenta por un HMAC
--    determinista (`username_lookup`) sin descifrar nada, para el login por
--    username sobre GoTrue.
--
-- Elementos:
--   * Secretos de Vault `dashboard-username-enc-v1` (cifrado PGP simétrico)
--     y `dashboard-username-hmac-v1` (HMAC de búsqueda), generados una sola
--     vez y nunca impresos ni almacenados en la migración.
--   * Columnas nuevas en public.users: `username_enc` (bytea), `username_key_id`
--     (secreto de cifrado usado, para rotación) y `username_lookup` (HMAC hex).
--   * Backfill idempotente: solo filas con columnas vacías. La columna legacy
--     "Username" NO se toca en esta migración; se retira en el cutover de MT48.
--   * Espejo de transición: `auth_username_set` sigue actualizando "Username"
--     para que el fallback legacy del gateway no diverja hasta el cutover.
--
-- pgcrypto se instala en el esquema `extensions` (por defecto en Supabase);
-- con `search_path = ''` todas las llamadas van cualificadas.
--
-- Aplicación manual en Supabase SQL Editor (docs/despliegue.md).

create extension if not exists pgcrypto;
create extension if not exists vault with schema vault;

-- Secretos de Vault: se crean una única vez; las re-ejecuciones los reutilizan.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'dashboard-username-enc-v1') then
    perform vault.create_secret(
      extensions.encode(extensions.gen_random_bytes(32), 'hex'),
      'dashboard-username-enc-v1',
      'Clave de cifrado del username (MT46); rotar con username_key_id'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'dashboard-username-hmac-v1') then
    perform vault.create_secret(
      extensions.encode(extensions.gen_random_bytes(32), 'hex'),
      'dashboard-username-hmac-v1',
      'Clave HMAC de username_lookup (MT46); rotación implica re-backfill'
    );
  end if;
end $$;

alter table public.users add column if not exists username_enc bytea;
alter table public.users add column if not exists username_key_id uuid;
alter table public.users add column if not exists username_lookup text;

-- Backfill idempotente con la clave vigente de Vault.
with keys as (
  select
    (select id from vault.secrets where name = 'dashboard-username-enc-v1') as enc_id,
    (select decrypted_secret from vault.decrypted_secrets where name = 'dashboard-username-enc-v1') as enc_secret,
    (select decrypted_secret from vault.decrypted_secrets where name = 'dashboard-username-hmac-v1') as hmac_secret
)
update public.users as u
set username_enc = extensions.pgp_sym_encrypt(trim(u."Username"), keys.enc_secret),
    username_key_id = keys.enc_id,
    username_lookup = extensions.encode(
      extensions.hmac(lower(normalize(trim(u."Username"), NFC)), keys.hmac_secret, 'sha256'),
      'hex'
    )
from keys
where keys.enc_secret is not null
  and keys.hmac_secret is not null
  and (u.username_enc is null or u.username_lookup is null);

create unique index if not exists users_username_lookup_key
  on public.users (username_lookup);

-- Lectura server-side del username (DTO de sesión). Falla cerrado si falta la
-- clave del secreto referenciado; usa la columna legacy solo como fallback de
-- transición mientras exista.
create or replace function public.auth_username_display(p_user_id integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_record record;
  key_secret text;
begin
  if p_user_id is null then
    return null;
  end if;
  select username_enc, username_key_id, "Username" as legacy
    into row_record
    from public.users
   where "UserID" = p_user_id;
  if not found then
    return null;
  end if;
  if row_record.username_enc is null then
    return row_record.legacy;
  end if;
  select decrypted_secret into key_secret
    from vault.decrypted_secrets
   where id = row_record.username_key_id;
  if key_secret is null then
    raise sqlstate 'PT503' using message = 'VAULT_KEY_UNAVAILABLE';
  end if;
  return extensions.pgp_sym_decrypt(row_record.username_enc, key_secret);
end $$;

-- Resolución para el login por username: el servidor normaliza, calcula el
-- HMAC con la clave de Vault y localiza user_id → email confirmado de GoTrue.
-- Devuelve como máximo 2 filas para que el gateway falle cerrado ante
-- cualquier ambigüedad.
create or replace function public.auth_username_resolve(p_username text)
returns table(user_id integer, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  hmac_secret text;
  lookup text;
begin
  if p_username is null or length(trim(p_username)) = 0 then
    return;
  end if;
  select decrypted_secret into hmac_secret
    from vault.decrypted_secrets
   where name = 'dashboard-username-hmac-v1';
  if hmac_secret is null then
    raise sqlstate 'PT503' using message = 'VAULT_KEY_UNAVAILABLE';
  end if;
  lookup := extensions.encode(
    extensions.hmac(lower(normalize(trim(p_username), NFC)), hmac_secret, 'sha256'),
    'hex'
  );
  return query
    select u."UserID", au.email
      from public.users u
      join auth.users au
        on au.raw_app_meta_data->>'app_user_id' = u."UserID"::text
       and au.email_confirmed_at is not null
       and au.banned_until is null
     where u.username_lookup = lookup
     limit 2;
end $$;

-- Descifrado por lotes para listados (una consulta por página, sin N+1).
create or replace function public.auth_username_display_batch(p_user_ids integer[])
returns table(user_id integer, username text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  key_secret text;
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;
  for item in
    select u."UserID" as uid, u.username_enc, u.username_key_id, u."Username" as legacy
      from public.users u
     where u."UserID" = any (p_user_ids)
  loop
    if item.username_enc is null then
      username := item.legacy;
    else
      select decrypted_secret into key_secret
        from vault.decrypted_secrets
       where id = item.username_key_id;
      if key_secret is null then
        raise sqlstate 'PT503' using message = 'VAULT_KEY_UNAVAILABLE';
      end if;
      username := extensions.pgp_sym_decrypt(item.username_enc, key_secret);
    end if;
    user_id := item.uid;
    return next;
  end loop;
end $$;

-- Escritura del username: cifra, calcula el lookup y mantiene el espejo legacy
-- durante la transición. Se usa en el alta de usuarios (MT49) y en el cutover.
create or replace function public.auth_username_set(p_user_id integer, p_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  display_value text;
  normalized_value text;
  enc_id uuid;
  enc_secret text;
  hmac_secret text;
begin
  display_value := trim(p_username);
  if p_user_id is null or display_value is null or length(display_value) < 3 or length(display_value) > 64 then
    raise sqlstate 'PT400' using message = 'INVALID_USERNAME';
  end if;
  select id, decrypted_secret into enc_id, enc_secret
    from vault.decrypted_secrets
   where name = 'dashboard-username-enc-v1';
  select decrypted_secret into hmac_secret
    from vault.decrypted_secrets
   where name = 'dashboard-username-hmac-v1';
  if enc_id is null or enc_secret is null or hmac_secret is null then
    raise sqlstate 'PT503' using message = 'VAULT_KEY_UNAVAILABLE';
  end if;
  normalized_value := lower(normalize(display_value, NFC));
  update public.users
     set username_enc = extensions.pgp_sym_encrypt(display_value, enc_secret),
         username_key_id = enc_id,
         username_lookup = extensions.encode(extensions.hmac(normalized_value, hmac_secret, 'sha256'), 'hex'),
         "Username" = display_value
   where "UserID" = p_user_id;
  if not found then
    raise sqlstate 'PT404' using message = 'UNKNOWN_USER';
  end if;
end $$;

revoke all on function public.auth_username_display(integer) from public, anon, authenticated;
revoke all on function public.auth_username_resolve(text) from public, anon, authenticated;
revoke all on function public.auth_username_set(integer, text) from public, anon, authenticated;
revoke all on function public.auth_username_display_batch(integer[]) from public, anon, authenticated;
grant execute on function public.auth_username_display(integer) to service_role;
grant execute on function public.auth_username_resolve(text) to service_role;
grant execute on function public.auth_username_set(integer, text) to service_role;
grant execute on function public.auth_username_display_batch(integer[]) to service_role;

-- El esquema vault completo queda reservado a service_role: ni anon ni
-- authenticated pueden leer secretos ni descifrar nada.
revoke usage on schema vault from anon, authenticated, public;
revoke select on vault.secrets from anon, authenticated, public;
revoke select on vault.decrypted_secrets from anon, authenticated, public;

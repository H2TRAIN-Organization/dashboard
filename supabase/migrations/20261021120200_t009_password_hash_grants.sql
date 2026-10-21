-- T-009 PasswordHash exposure hardening.
-- WARNING: authored in an isolated worktree and NOT applied remotely.
--
-- Evidence from the read-only inspection: the publishable/anon credential could
-- project public.users.PasswordHash (HTTP 200, no values retained). This
-- migration removes that column from anon/authenticated access and enables RLS
-- on public.users. The only policy is the explicit service_role policy below;
-- there is no permissive policy for anon/authenticated. service_role keeps full
-- access (BYPASSRLS) for the server API.
--
-- Consequence: direct browser-side reads of public.users stop returning rows
-- until the frontend is moved to the server API. Health-table RLS is outside
-- this task's evidence and is intentionally not changed here.

begin;

alter table public.users enable row level security;

-- Keep an explicit service_role policy as a second line of defense; Supabase's
-- service_role normally bypasses RLS.
drop policy if exists t009_service_role_all on public.users;
create policy t009_service_role_all on public.users
  for all
  to service_role
  using (true)
  with check (true);

-- Table-level SELECT grants override column grants, so remove them first.
revoke select on table public.users from public;
revoke select on table public.users from anon, authenticated;

grant select (
  "UserID",
  "Username",
  "UUID",
  "GDPRConsent",
  "GDPRConsentDate",
  "sexo",
  "bomba_insulina",
  "role"
) on table public.users to anon, authenticated;

-- service_role must remain able to read every column, including PasswordHash,
-- for the auth adapter.
grant select on table public.users to service_role;

-- Ensure the admin RPCs are not callable through PostgREST by anon/authenticated.
revoke all on function public.t009_assert_username_fks_ready() from public, anon, authenticated;
revoke all on function public.t009_update_user(bigint, text, text, boolean) from public, anon, authenticated;
revoke all on function public.t009_delete_user(bigint) from public, anon, authenticated;
revoke all on function public.t009_user_has_health_data(bigint) from public, anon, authenticated;

grant execute on function public.t009_assert_username_fks_ready() to service_role;
grant execute on function public.t009_update_user(bigint, text, text, boolean) to service_role;
grant execute on function public.t009_delete_user(bigint) to service_role;
grant execute on function public.t009_user_has_health_data(bigint) to service_role;

commit;

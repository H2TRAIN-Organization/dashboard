-- Aceptación del aviso de privacidad UNA sola vez por cuenta de usuario.
--
-- La app publicó el aviso '2026-11-12-draft-1' (hash 46f04537…), que describe
-- un flujo de una sola etapa: el aviso se pide en el primer inicio de sesión,
-- la aceptación se persiste por USUARIO (no por sesión) y no se vuelve a
-- pedir en inicios posteriores salvo que se publique una versión nueva.
--
-- 1. Nueva tabla public.user_privacy_acks: una fila por usuario con la última
--    versión aceptada. readPrivacy la consulta en cada sesión nueva para
--    sembrar el estado 'complete' sin preguntar de nuevo.
-- 2. Reescritura de auth_privacy_decide: 'accept' salta directamente al stage
--    2 (complete), graba el ack por usuario y rechazar revoca la sesión como
--    antes. La etapa intermedia 1 (barra inferior) deja de usarse; las
--    sesiones legacy en stage 1 se aceptan y completan con normalidad.
-- 3. Pin de la versión auditada dentro del RPC (migración idempotente:
--    create or replace function / table if not exists).
--
-- Aplicación manual en Supabase SQL Editor (docs/despliegue.md).

create table if not exists public.user_privacy_acks (
  user_id integer primary key references public.users("UserID") on delete cascade,
  policy_version text not null,
  policy_hash text not null,
  language text not null check (language in ('es','en')),
  decided_at timestamptz not null default clock_timestamp()
);
alter table public.user_privacy_acks enable row level security;
revoke all on public.user_privacy_acks from public, anon, authenticated;
grant select, insert, update, delete on public.user_privacy_acks to service_role;

create or replace function public.auth_privacy_decide(
  p_sid_hash text, p_user_id integer, p_policy_version text, p_policy_hash text,
  p_surface text, p_decision text, p_language text, p_request_id uuid
) returns table(stage smallint, rejected boolean)
language plpgsql security definer set search_path = '' as $$
declare
  s public.auth_sessions%rowtype;
  old public.auth_privacy_decisions%rowtype;
  next_stage smallint;
begin
  if p_policy_version is distinct from '2026-11-12-draft-1'
     or p_policy_hash is distinct from '46f0453728eed97e4329ccf822c130c2062bdb3c6969e75d6f0c0318da22881d'
     or p_surface is null or p_surface <> 'login'
     or p_decision is null or p_decision not in ('accept','reject')
     or p_language is null or p_language not in ('es','en') or p_request_id is null then
    raise sqlstate 'PT409' using message = 'Invalid privacy decision or policy version';
  end if;
  -- The session lock serializes decisions, logout, and all competing requests.
  select * into s from public.auth_sessions where sid_hash = p_sid_hash and user_id = p_user_id for update;
  if not found or s.expires_at <= clock_timestamp() then
    raise sqlstate 'PT401' using message = 'Session unavailable';
  end if;
  select * into old from public.auth_privacy_decisions where sid_hash = p_sid_hash and request_id = p_request_id;
  if found then
    if (old.policy_version, old.policy_hash, old.surface, old.decision, old.language)
       is distinct from (p_policy_version, p_policy_hash, p_surface, p_decision, p_language) then
      raise sqlstate 'PT409' using message = 'Idempotency key reused';
    end if;
    -- A past acceptance can never revive a subsequently rejected session.
    if s.revoked_at is not null and old.decision <> 'reject' then
      raise sqlstate 'PT401' using message = 'Session revoked';
    end if;
    return query select old.resulting_stage, old.decision = 'reject';
    return;
  end if;
  if s.revoked_at is not null then raise sqlstate 'PT401' using message = 'Session revoked'; end if;
  if p_decision = 'accept' then
    -- Single-stage flow: one acceptance completes the gate and persists the
    -- per-user acknowledgement for every future session of this account.
    next_stage := 2;
    insert into public.user_privacy_acks(user_id, policy_version, policy_hash, language, decided_at)
      values (p_user_id, p_policy_version, p_policy_hash, p_language, clock_timestamp())
      on conflict (user_id) do update
        set policy_version = excluded.policy_version,
            policy_hash = excluded.policy_hash,
            language = excluded.language,
            decided_at = excluded.decided_at;
  else
    next_stage := 0;
  end if;
  insert into public.auth_privacy_decisions(sid_hash, request_id, user_id, policy_version, policy_hash, surface, decision, language, resulting_stage)
    values(p_sid_hash, p_request_id, p_user_id, p_policy_version, p_policy_hash, p_surface, p_decision, p_language, next_stage);
  update public.auth_sessions set privacy_version = p_policy_version, privacy_hash = p_policy_hash, privacy_stage = next_stage,
    revoked_at = case when p_decision = 'reject' then clock_timestamp() else revoked_at end where sid_hash = p_sid_hash;
  return query select next_stage, p_decision = 'reject';
end $$;
revoke all on function public.auth_privacy_decide(text,integer,text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.auth_privacy_decide(text,integer,text,text,text,text,text,uuid) to service_role;

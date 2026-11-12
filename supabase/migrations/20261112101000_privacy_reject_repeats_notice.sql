-- El rechazo del aviso vuelve a pedir el aviso en el siguiente inicio (MT49).
--
-- Con el acuse persistido por usuario (20261112100000_privacy_once_per_user),
-- un rechazo revocaba la sesión pero conservaba el acuse previo de la cuenta:
-- un usuario que había aceptado, rechazaba y volvía a iniciar sesión entraba
-- directamente sin releer el aviso. El contrato exigido es el contrario:
-- tras un rechazo, el siguiente inicio de sesión debe presentar de nuevo el
-- aviso para aceptarlo o rechazarlo.
--
-- 1. 'reject' elimina la fila de public.user_privacy_acks del usuario, de modo
--    que readPrivacy vuelva a sembrar el estado 'initial' en cada sesión nueva.
-- 2. La aceptación regraba el acuse por usuario con normalidad.
-- 3. Migración idempotente (create or replace function) con la misma versión
--    auditada fijada dentro del RPC. Aplicación manual en Supabase SQL Editor
--    (docs/despliegue.md).

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
    -- A rejection revokes the session and also removes the per-user
    -- acknowledgement, so the very next sign-in is asked again (MT49).
    next_stage := 0;
    delete from public.user_privacy_acks where user_id = p_user_id;
  end if;
  insert into public.auth_privacy_decisions(sid_hash, request_id, user_id, policy_version, policy_hash, surface, decision, language, resulting_stage)
    values(p_sid_hash, p_request_id, p_user_id, p_policy_version, p_policy_hash, p_surface, p_decision, p_language, next_stage);
  update public.auth_sessions set privacy_version = p_policy_version, privacy_hash = p_policy_hash, privacy_stage = next_stage,
    revoked_at = case when p_decision = 'reject' then clock_timestamp() else revoked_at end where sid_hash = p_sid_hash;
  return query select next_stage, p_decision = 'reject';
end $$;
revoke all on function public.auth_privacy_decide(text,integer,text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.auth_privacy_decide(text,integer,text,text,text,text,text,uuid) to service_role;

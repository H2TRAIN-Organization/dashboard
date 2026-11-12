-- Actualiza el pin de la política de privacidad auditada dentro del RPC de
-- decisiones. La app publicó el aviso '2026-11-11-draft-1' (hash 19b903fb…);
-- sin esta migración, auth_privacy_decide rechaza toda decisión con PT409
-- ("Invalid privacy decision or policy version") y el aviso queda en 409
-- CONFLICT. Migración idempotente: create or replace function.
--
-- Aplicación manual en Supabase SQL Editor (docs/despliegue.md).

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
  if p_policy_version is distinct from '2026-11-11-draft-1'
     or p_policy_hash is distinct from '19b903fbfdbfe575db05a367e7d61957f3186ea78e034d6b2b61e84ef4a4663f'
     or p_surface is null or p_surface not in ('login','banner')
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
  next_stage := case when s.privacy_version = p_policy_version and s.privacy_hash = p_policy_hash then s.privacy_stage else 0 end;
  if p_decision = 'accept' then
    if p_surface = 'login' and next_stage = 0 then next_stage := 1;
    elsif p_surface = 'banner' and next_stage = 1 then next_stage := 2;
    elsif (p_surface = 'login' and next_stage >= 1) or (p_surface = 'banner' and next_stage = 2) then null;
    else raise sqlstate 'PT409' using message = 'Privacy surface is out of order';
    end if;
  end if;
  insert into public.auth_privacy_decisions(sid_hash, request_id, user_id, policy_version, policy_hash, surface, decision, language, resulting_stage)
    values(p_sid_hash, p_request_id, p_user_id, p_policy_version, p_policy_hash, p_surface, p_decision, p_language, next_stage);
  update public.auth_sessions set privacy_version = p_policy_version, privacy_hash = p_policy_hash, privacy_stage = next_stage,
    revoked_at = case when p_decision = 'reject' then clock_timestamp() else revoked_at end where sid_hash = p_sid_hash;
  return query select next_stage, p_decision = 'reject';
end $$;
revoke all on function public.auth_privacy_decide(text,integer,text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.auth_privacy_decide(text,integer,text,text,text,text,text,uuid) to service_role;

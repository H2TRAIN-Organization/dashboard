-- Session access acknowledgement only. Does not modify external consent.
alter table public.auth_sessions add column if not exists privacy_version text;
alter table public.auth_sessions add column if not exists privacy_hash text;
alter table public.auth_sessions add column if not exists privacy_stage smallint not null default 0 check (privacy_stage between 0 and 2);

create table if not exists public.auth_privacy_decisions (
  sid_hash text not null references public.auth_sessions(sid_hash) on delete cascade,
  request_id uuid not null,
  user_id integer not null references public.users("UserID") on delete cascade,
  policy_version text not null,
  policy_hash text not null,
  surface text not null check (surface in ('login','banner')),
  decision text not null check (decision in ('accept','reject')),
  language text not null check (language in ('es','en')),
  decided_at timestamptz not null default clock_timestamp(),
  resulting_stage smallint not null check (resulting_stage between 0 and 2),
  primary key(sid_hash, request_id)
);
alter table public.auth_privacy_decisions enable row level security;
revoke all on public.auth_privacy_decisions from public, anon, authenticated;
grant select on public.auth_privacy_decisions to service_role;

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
  if p_policy_version is distinct from '2026-11-04-draft-1'
     or p_policy_hash is distinct from '279bdc6c40df59a0224017a4e3ad012b2fe042bf0ef562da3206f296f26ae64c'
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

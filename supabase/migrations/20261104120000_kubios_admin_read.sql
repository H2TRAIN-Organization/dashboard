-- Local review only. Admin HTTP role and privacy gates precede this service-only RPC.
grant select ("UserID", "Username") on public.users to service_role;
create or replace function public.kubios_admin_list_links(p_after_user_id integer default 0, p_limit integer default 100)
returns table (user_id integer, username text, team_id uuid, kubios_member_id uuid)
language sql stable security invoker set search_path = '' as $$
  select l.user_id, u."Username"::text, l.team_id, l.kubios_member_id
  from kubios_private.user_member_links l
  join public.users u on u."UserID" = l.user_id
  where l.user_id > p_after_user_id
  order by l.user_id
  limit case when p_limit between 1 and 100 then p_limit else 100 end;
$$;
revoke all on function public.kubios_admin_list_links(integer, integer) from public, anon, authenticated, authenticator, service_role;
grant execute on function public.kubios_admin_list_links(integer, integer) to service_role;

-- One JSON scalar prevents PostgREST row caps from truncating links or their exact total.
create or replace function public.kubios_admin_page_links(p_search text default '', p_offset integer default 0, p_limit integer default 25)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as (
    select l.user_id, u."Username"::text as username, l.team_id, l.kubios_member_id
    from kubios_private.user_member_links l
    join public.users u on u."UserID" = l.user_id
    where pg_catalog.strpos(l.user_id::text, p_search) > 0 or pg_catalog.strpos(pg_catalog.lower(u."Username"), pg_catalog.lower(p_search)) > 0
  ), page as (
    select * from matching order by user_id
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 100)
  ) select pg_catalog.jsonb_build_object('total', (select count(*) from matching), 'links', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by user_id) from page), '[]'::jsonb));
$$;
revoke all on function public.kubios_admin_page_links(text, integer, integer) from public, anon, authenticated, authenticator, service_role;
grant execute on function public.kubios_admin_page_links(text, integer, integer) to service_role;

create or replace function public.kubios_admin_get_link(p_user_id integer)
returns table (user_id integer, username text, team_id uuid, kubios_member_id uuid)
language sql stable security invoker set search_path = '' as $$
  select l.user_id, u."Username"::text, l.team_id, l.kubios_member_id
  from kubios_private.user_member_links l
  join public.users u on u."UserID" = l.user_id
  where l.user_id = p_user_id;
$$;
revoke all on function public.kubios_admin_get_link(integer) from public, anon, authenticated, authenticator, service_role;
grant execute on function public.kubios_admin_get_link(integer) to service_role;

-- AK-01 - Listados administrativos paginados de participantes y snapshots.
--
-- Migracion aditiva y transaccional. Solo crea dos RPC de lectura en public;
-- no altera tablas, esquemas ni privilegios de tabla o de esquema. Las
-- funciones son SECURITY INVOKER, fijan search_path vacio y solo se conceden
-- a service_role.
--
-- Cursor por user_id ascendente:
--   * participants: after exclusivo, limite maximo 100;
--   * snapshots: start inclusivo, limite maximo 16.

begin;

-- Participantes activos: existe fila en kubios_private.user_member_links.
-- El username procede de public.users("UserID"), la identidad integer de la
-- aplicacion. p_after_user_id nulo empieza desde el principio.
create or replace function public.kubios_admin_list_participants(
  p_after_user_id integer,
  p_limit integer
)
returns table (
  user_id integer,
  username text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select link.user_id, account."Username"
    from kubios_private.user_member_links as link
    join public.users as account on account."UserID" = link.user_id
   where p_after_user_id is null
      or link.user_id > p_after_user_id
   order by link.user_id
   limit least(greatest(coalesce(p_limit, 100), 0), 100);
$$;

comment on function public.kubios_admin_list_participants(integer, integer) is
  'AK-01: participantes activos en orden ascendente; cursor after exclusivo; maximo 100.';

-- Snapshots administrativos:
--   * p_user_id nulo: vision global de vinculos con snapshot (inner join).
--   * p_user_id concreto: LEFT JOIN para incluir un vinculo pendiente sin
--     snapshot; un usuario sin vinculo (missing o revocado) no devuelve filas.
-- p_start_user_id es inclusivo y tambien puede ser nulo.
create or replace function public.kubios_admin_list_snapshots(
  p_user_id integer,
  p_start_user_id integer,
  p_limit integer
)
returns table (
  user_id integer,
  username text,
  team_id uuid,
  member_id uuid,
  ciphertext bytea,
  nonce bytea,
  tag bytea,
  key_version integer,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select link.user_id,
         account."Username",
         snapshot.team_id,
         snapshot.member_id,
         snapshot.ciphertext,
         snapshot.nonce,
         snapshot.tag,
         snapshot.key_version,
         snapshot.updated_at
    from kubios_private.user_member_links as link
    join public.users as account on account."UserID" = link.user_id
    left join kubios_private.encrypted_snapshots as snapshot
      on snapshot.team_id = link.team_id
     and snapshot.member_id = link.kubios_member_id
   where (p_user_id is null or link.user_id = p_user_id)
     and (p_user_id is not null or snapshot.member_id is not null)
     and (p_start_user_id is null or link.user_id >= p_start_user_id)
   order by link.user_id
   limit least(greatest(coalesce(p_limit, 16), 0), 16);
$$;

comment on function public.kubios_admin_list_snapshots(integer, integer, integer) is
  'AK-01: snapshots en orden ascendente; start inclusivo; global solo vinculos con snapshot; maximo 16.';

revoke all on function public.kubios_admin_list_participants(integer, integer) from public;
revoke all on function public.kubios_admin_list_participants(integer, integer)
  from anon, authenticated, authenticator, service_role;
revoke all on function public.kubios_admin_list_snapshots(integer, integer, integer) from public;
revoke all on function public.kubios_admin_list_snapshots(integer, integer, integer)
  from anon, authenticated, authenticator, service_role;

grant execute on function public.kubios_admin_list_participants(integer, integer)
  to service_role;
grant execute on function public.kubios_admin_list_snapshots(integer, integer, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;

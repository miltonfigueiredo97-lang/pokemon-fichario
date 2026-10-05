-- Reorder a binder from an exported Excel in ONE transaction.
--
-- p_positions: [{"id": "<card uuid>", "page": 1, "slot": 1}, ...] with EVERY
-- card of the binder exactly once. Cards are only moved: none is created or
-- deleted. Positions are first cleared, then assigned, so swaps never hit the
-- unique (user, binder, page, slot) index. Any problem raises and nothing
-- changes. The binder grows when the new order needs more pages.

create or replace function public.pokemon_reorder_binder(p_binder uuid, p_positions jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  n_given integer;
  n_binder integer;
  n_match integer;
  max_page integer;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from pokemon_binders where id = p_binder and user_id = uid) then
    raise exception 'binder_not_found';
  end if;

  if exists (select 1 from jsonb_to_recordset(p_positions) as _pos(id uuid, page int, slot int) where id is null or page is null or slot is null or page < 1 or slot < 1 or slot > 9) then
    raise exception 'invalid_position';
  end if;
  if exists (select id from jsonb_to_recordset(p_positions) as _pos(id uuid, page int, slot int) group by id having count(*) > 1) then
    raise exception 'duplicate_card';
  end if;
  if exists (select page, slot from jsonb_to_recordset(p_positions) as _pos(id uuid, page int, slot int) group by page, slot having count(*) > 1) then
    raise exception 'duplicate_pocket';
  end if;

  select count(*) into n_given from jsonb_to_recordset(p_positions) as _pos(id uuid, page int, slot int);
  select count(*) into n_binder from pokemon_cards where user_id = uid and binder_id = p_binder;
  select count(*) into n_match from jsonb_to_recordset(p_positions) as p(id uuid, page int, slot int) join pokemon_cards c on c.id = p.id and c.user_id = uid and c.binder_id = p_binder;
  if n_match <> n_given then
    raise exception 'unknown_card:%', n_given - n_match;
  end if;
  if n_given <> n_binder then
    raise exception 'missing_card:%', n_binder - n_given;
  end if;

  update pokemon_cards set binder_slot = null
   where user_id = uid and binder_id = p_binder;

  update pokemon_cards c
     set binder_page = p.page, binder_slot = p.slot, updated_at = now()
    from jsonb_to_recordset(p_positions) as p(id uuid, page int, slot int)
   where c.id = p.id and c.user_id = uid and c.binder_id = p_binder;

  select coalesce(max(page), 1) into max_page from jsonb_to_recordset(p_positions) as _pos(id uuid, page int, slot int);
  update pokemon_binders set pages = greatest(coalesce(pages, 1), max_page), updated_at = now()
   where id = p_binder and user_id = uid;

  return jsonb_build_object('moved', n_given, 'pages', max_page);
end;
$$;

grant execute on function public.pokemon_reorder_binder(uuid, jsonb) to authenticated;

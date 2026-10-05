-- Remove an EMPTY binder page: refuses when it holds a card or an art piece;
-- the pages after it move up by one (cards and art pieces follow), parked at
-- +100000 first so the one-per-pocket triggers never see an overlap.
create or replace function public.pokemon_remove_binder_page(p_binder uuid, p_page int)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  total int; n_cards int; n_art int;
begin
  select pages into total from pokemon_binders where id = p_binder and user_id = auth.uid();
  if not found then raise exception 'binder_not_found'; end if;
  total := greatest(coalesce(total, 1), 1);
  if p_page < 1 or p_page > total then raise exception 'invalid_page'; end if;
  if total <= 1 then raise exception 'last_page'; end if;
  select count(*) into n_cards from pokemon_cards where binder_id = p_binder and coalesce(binder_page, 1) = p_page;
  select count(*) into n_art from pokemon_binder_art_pieces where binder_id = p_binder and page = p_page;
  if n_cards + n_art > 0 then
    raise exception 'page_not_empty:%:%', n_cards, n_art;
  end if;

  update pokemon_cards set binder_page = binder_page + 100000
   where binder_id = p_binder and user_id = auth.uid() and coalesce(binder_page, 1) > p_page;
  update pokemon_binder_art_pieces set page = page + 100000
   where binder_id = p_binder and user_id = auth.uid() and page > p_page;
  update pokemon_cards set binder_page = binder_page - 100001, updated_at = now()
   where binder_id = p_binder and user_id = auth.uid() and binder_page > 100000;
  update pokemon_binder_art_pieces set page = page - 100001
   where binder_id = p_binder and user_id = auth.uid() and page > 100000;
  update pokemon_binder_art set page = page - 1
   where binder_id = p_binder and user_id = auth.uid() and page > p_page;

  update pokemon_binders set pages = total - 1, updated_at = now() where id = p_binder and user_id = auth.uid();
  return jsonb_build_object('removed', true, 'pages', total - 1);
end;
$$;

grant execute on function public.pokemon_remove_binder_page(uuid, int) to authenticated;

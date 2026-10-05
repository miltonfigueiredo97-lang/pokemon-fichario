-- Reorder binder pages: page p_from goes to position p_to and the pages in
-- between shift by one, carrying their cards and art pieces. Done in two
-- steps (park the affected pages at +100000, then their final numbers) so
-- the card/art "one per pocket" triggers never see a transient overlap.
create or replace function public.pokemon_move_binder_page(p_binder uuid, p_from int, p_to int)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  lo int; hi int; total int;
begin
  select pages into total from pokemon_binders where id = p_binder and user_id = auth.uid();
  if not found then raise exception 'binder_not_found'; end if;
  total := greatest(coalesce(total, 1), 1);
  if p_from < 1 or p_to < 1 or p_from > total or p_to > total then raise exception 'invalid_page'; end if;
  if p_from = p_to then return jsonb_build_object('moved', false); end if;
  lo := least(p_from, p_to); hi := greatest(p_from, p_to);

  update pokemon_cards set binder_page = coalesce(binder_page, 1) + 100000
   where binder_id = p_binder and user_id = auth.uid() and coalesce(binder_page, 1) between lo and hi;
  update pokemon_binder_art_pieces set page = page + 100000
   where binder_id = p_binder and user_id = auth.uid() and page between lo and hi;

  update pokemon_cards set binder_page = case
      when binder_page - 100000 = p_from then p_to
      when p_from < p_to then binder_page - 100000 - 1
      else binder_page - 100000 + 1 end,
      updated_at = now()
   where binder_id = p_binder and user_id = auth.uid() and binder_page > 100000;
  update pokemon_binder_art_pieces set page = case
      when page - 100000 = p_from then p_to
      when p_from < p_to then page - 100000 - 1
      else page - 100000 + 1 end
   where binder_id = p_binder and user_id = auth.uid() and page > 100000;

  -- Where each art was first placed follows its page too.
  update pokemon_binder_art set page = case
      when page = p_from then p_to
      when p_from < p_to and page > p_from and page <= p_to then page - 1
      when p_from > p_to and page >= p_to and page < p_from then page + 1
      else page end
   where binder_id = p_binder and user_id = auth.uid() and page between lo and hi;

  update pokemon_binders set updated_at = now() where id = p_binder and user_id = auth.uid();
  return jsonb_build_object('moved', true, 'from', p_from, 'to', p_to);
end;
$$;

grant execute on function public.pokemon_move_binder_page(uuid, int, int) to authenticated;

-- Reorder all pages of a binder at once: p_order lists the OLD page numbers
-- in their new order (new page i = old page p_order[i]). Used to move a whole
-- spread (two facing pages) at once. Same two-step parking as the other page
-- functions so the one-per-pocket triggers never see a transient overlap.
create or replace function public.pokemon_reorder_binder_pages(p_binder uuid, p_order int[])
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  total int;
begin
  select pages into total from pokemon_binders where id = p_binder and user_id = auth.uid();
  if not found then raise exception 'binder_not_found'; end if;
  total := greatest(coalesce(total, 1), 1);
  if coalesce(array_length(p_order, 1), 0) <> total
     or (select count(distinct v) from unnest(p_order) v where v between 1 and total) <> total then
    raise exception 'invalid_order';
  end if;

  if not exists (select 1 from unnest(p_order) with ordinality o(v, i) where o.v <> o.i) then
    return jsonb_build_object('moved', false);
  end if;

  -- Park every page that changes, then give it its new number.
  update pokemon_cards c set binder_page = coalesce(c.binder_page, 1) + 100000
   where c.binder_id = p_binder and c.user_id = auth.uid()
     and coalesce(c.binder_page, 1) in (select o.v from unnest(p_order) with ordinality o(v, i) where o.v <> o.i);
  update pokemon_binder_art_pieces p set page = p.page + 100000
   where p.binder_id = p_binder and p.user_id = auth.uid()
     and p.page in (select o.v from unnest(p_order) with ordinality o(v, i) where o.v <> o.i);

  update pokemon_cards c set binder_page = m.i::int, updated_at = now()
    from unnest(p_order) with ordinality m(v, i)
   where c.binder_id = p_binder and c.user_id = auth.uid() and c.binder_page = m.v + 100000;
  update pokemon_binder_art_pieces p set page = m.i::int
    from unnest(p_order) with ordinality m(v, i)
   where p.binder_id = p_binder and p.user_id = auth.uid() and p.page = m.v + 100000;
  update pokemon_binder_art a set page = m.i::int
    from unnest(p_order) with ordinality m(v, i)
   where a.binder_id = p_binder and a.user_id = auth.uid() and a.page = m.v and m.v <> m.i;

  update pokemon_binders set updated_at = now() where id = p_binder and user_id = auth.uid();
  return jsonb_build_object('moved', true);
end;
$$;

grant execute on function public.pokemon_reorder_binder_pages(uuid, int[]) to authenticated;

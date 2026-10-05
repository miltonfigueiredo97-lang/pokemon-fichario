-- Swap two binder pages (cards and art pieces exchange pages). Same two-step
-- parking as pokemon_move_binder_page so the one-per-pocket triggers never
-- see a transient overlap.
create or replace function public.pokemon_swap_binder_pages(p_binder uuid, p_a int, p_b int)
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
  if p_a < 1 or p_b < 1 or p_a > total or p_b > total then raise exception 'invalid_page'; end if;
  if p_a = p_b then return jsonb_build_object('swapped', false); end if;

  update pokemon_cards set binder_page = coalesce(binder_page, 1) + 100000
   where binder_id = p_binder and user_id = auth.uid() and coalesce(binder_page, 1) in (p_a, p_b);
  update pokemon_binder_art_pieces set page = page + 100000
   where binder_id = p_binder and user_id = auth.uid() and page in (p_a, p_b);

  update pokemon_cards set binder_page = case when binder_page - 100000 = p_a then p_b else p_a end, updated_at = now()
   where binder_id = p_binder and user_id = auth.uid() and binder_page > 100000;
  update pokemon_binder_art_pieces set page = case when page - 100000 = p_a then p_b else p_a end
   where binder_id = p_binder and user_id = auth.uid() and page > 100000;

  update pokemon_binder_art set page = case when page = p_a then p_b else p_a end
   where binder_id = p_binder and user_id = auth.uid() and page in (p_a, p_b);
  update pokemon_binders set updated_at = now() where id = p_binder and user_id = auth.uid();
  return jsonb_build_object('swapped', true, 'a', p_a, 'b', p_b);
end;
$$;

grant execute on function public.pokemon_swap_binder_pages(uuid, int, int) to authenticated;

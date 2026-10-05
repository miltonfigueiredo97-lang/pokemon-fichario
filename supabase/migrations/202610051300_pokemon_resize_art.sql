-- Resize an existing binder art (cols x rows) without removing it: the art
-- grows/shrinks from the pocket of its top-left piece (col 0, row 0). Pieces
-- outside the new size are removed; new pieces go to the neighbouring pockets
-- of that page, which must be empty (no card, no other art piece). Pieces
-- already moved elsewhere stay where they are.
create or replace function public.pokemon_resize_art(p_art uuid, p_cols int, p_rows int)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  a pokemon_binder_art%rowtype;
  anchor pokemon_binder_art_pieces%rowtype;
  c0 int; r0 int; c int; r int; target int;
begin
  if p_cols < 1 or p_cols > 3 or p_rows < 1 or p_rows > 3 then raise exception 'invalid_size'; end if;
  select * into a from pokemon_binder_art where id = p_art and user_id = auth.uid();
  if not found then raise exception 'art_not_found'; end if;
  select * into anchor from pokemon_binder_art_pieces where art_id = a.id and col = 0 and "row" = 0;
  if not found then raise exception 'anchor_missing'; end if;
  c0 := (anchor.slot - 1) % 3; r0 := (anchor.slot - 1) / 3;
  if c0 + p_cols > 3 or r0 + p_rows > 3 then raise exception 'no_room'; end if;

  delete from pokemon_binder_art_pieces where art_id = a.id and (col >= p_cols or "row" >= p_rows);

  for r in 0 .. p_rows - 1 loop
    for c in 0 .. p_cols - 1 loop
      if not exists (select 1 from pokemon_binder_art_pieces where art_id = a.id and col = c and "row" = r) then
        target := anchor.slot + r * 3 + c;
        if exists (select 1 from pokemon_cards where binder_id = a.binder_id and coalesce(binder_page, 1) = anchor.page and binder_slot = target)
           or exists (select 1 from pokemon_binder_art_pieces where binder_id = a.binder_id and page = anchor.page and slot = target) then
          raise exception 'pocket_taken:%', target;
        end if;
        insert into pokemon_binder_art_pieces (user_id, art_id, binder_id, page, slot, col, "row")
        values (a.user_id, a.id, a.binder_id, anchor.page, target, c, r);
      end if;
    end loop;
  end loop;

  update pokemon_binder_art set cols = p_cols, rows = p_rows, page = anchor.page, slot = anchor.slot where id = a.id;
  return jsonb_build_object('ok', true, 'cols', p_cols, 'rows', p_rows);
end;
$$;

grant execute on function public.pokemon_resize_art(uuid, int, int) to authenticated;

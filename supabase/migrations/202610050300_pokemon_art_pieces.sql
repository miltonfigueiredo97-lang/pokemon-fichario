-- Binder art pieces: each piece (col, row) of an art is placed on its own
-- pocket and can be moved freely (any pocket, any page of the same binder),
-- since a printed art is a set of independent pieces. pokemon_binder_art
-- keeps the image and its size (cols x rows); page/slot there is only where
-- it was first placed.

create table if not exists public.pokemon_binder_art_pieces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  art_id uuid not null references public.pokemon_binder_art(id) on delete cascade,
  binder_id uuid not null references public.pokemon_binders(id) on delete cascade,
  page integer not null check (page >= 1),
  slot integer not null check (slot between 1 and 9),
  col integer not null check (col between 0 and 2),
  "row" integer not null check ("row" between 0 and 2),
  constraint pokemon_art_pieces_pocket_uniq unique (binder_id, page, slot) deferrable initially deferred,
  constraint pokemon_art_pieces_cell_uniq unique (art_id, col, "row")
);
create index if not exists pokemon_art_pieces_art_idx on public.pokemon_binder_art_pieces (art_id);

alter table public.pokemon_binder_art_pieces enable row level security;
drop policy if exists pokemon_art_pieces_own on public.pokemon_binder_art_pieces;
create policy pokemon_art_pieces_own on public.pokemon_binder_art_pieces
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.pokemon_binders b where b.id = binder_id and b.user_id = auth.uid())
    and exists (select 1 from public.pokemon_binder_art a where a.id = art_id and a.user_id = auth.uid()));

-- Existing arts become pieces at the pockets they covered.
insert into public.pokemon_binder_art_pieces (user_id, art_id, binder_id, page, slot, col, "row")
select a.user_id, a.id, a.binder_id, a.page, a.slot + r * 3 + c, c, r
  from public.pokemon_binder_art a
  cross join generate_series(0, 2) c
  cross join generate_series(0, 2) r
 where c < a.cols and r < a.rows
   and not exists (select 1 from public.pokemon_binder_art_pieces p where p.art_id = a.id);

-- Coverage is now "a piece sits on this pocket".
drop trigger if exists pokemon_binder_art_check on public.pokemon_binder_art;
drop function if exists public.pokemon_art_check();
alter table public.pokemon_binder_art drop constraint if exists pokemon_binder_art_check;

create or replace function public.pokemon_art_covers(p_binder uuid, p_page int, p_slot int, p_skip uuid default null)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (
    select 1 from pokemon_binder_art_pieces p
     where p.binder_id = p_binder and p.page = p_page and p.slot = p_slot
       and (p_skip is null or p.id <> p_skip)
  );
$$;

create or replace function public.pokemon_art_piece_check()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if exists (select 1 from pokemon_cards
              where binder_id = new.binder_id and coalesce(binder_page, 1) = new.page and binder_slot = new.slot) then
    raise exception 'art_overlaps_card';
  end if;
  return new;
end;
$$;

drop trigger if exists pokemon_art_pieces_check on public.pokemon_binder_art_pieces;
create trigger pokemon_art_pieces_check
  before insert or update of binder_id, page, slot on public.pokemon_binder_art_pieces
  for each row execute function public.pokemon_art_piece_check();

-- Move one piece to (page, slot) of its binder, in one transaction:
-- empty pocket -> it moves; another piece -> they swap; a card -> they swap.
create or replace function public.pokemon_move_art_piece(p_piece uuid, p_page int, p_slot int)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  me pokemon_binder_art_pieces%rowtype;
  other_piece uuid;
  other_card uuid;
begin
  if p_page < 1 or p_slot < 1 or p_slot > 9 then raise exception 'invalid_position'; end if;
  select * into me from pokemon_binder_art_pieces where id = p_piece and user_id = auth.uid();
  if not found then raise exception 'piece_not_found'; end if;
  if me.page = p_page and me.slot = p_slot then return jsonb_build_object('moved', false); end if;

  select id into other_piece from pokemon_binder_art_pieces
   where binder_id = me.binder_id and page = p_page and slot = p_slot;
  select id into other_card from pokemon_cards
   where user_id = auth.uid() and binder_id = me.binder_id and coalesce(binder_page, 1) = p_page and binder_slot = p_slot;

  if other_card is not null then
    update pokemon_cards set binder_slot = null where id = other_card;
  end if;
  update pokemon_binder_art_pieces set page = p_page, slot = p_slot where id = me.id;
  if other_piece is not null then
    update pokemon_binder_art_pieces set page = me.page, slot = me.slot where id = other_piece;
  end if;
  if other_card is not null then
    update pokemon_cards set binder_page = me.page, binder_slot = me.slot, updated_at = now() where id = other_card;
  end if;
  update pokemon_binders set pages = greatest(coalesce(pages, 1), p_page), updated_at = now()
   where id = me.binder_id and user_id = auth.uid();
  return jsonb_build_object('moved', true, 'swapped_piece', other_piece, 'swapped_card', other_card);
end;
$$;

grant execute on function public.pokemon_move_art_piece(uuid, int, int) to authenticated;

-- Binder art: one image spread across a rectangle of pockets (e.g. a 2x2
-- panel of Latias & Latios), starting at the top-left pocket "slot".
-- A pocket holds either a card or a piece of art, never both: triggers on
-- both tables reject overlaps, whatever path writes them (add, drag, Excel).

create table if not exists public.pokemon_binder_art (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  binder_id uuid not null references public.pokemon_binders(id) on delete cascade,
  page integer not null check (page >= 1),
  slot integer not null check (slot between 1 and 9),
  cols integer not null check (cols between 1 and 3),
  rows integer not null check (rows between 1 and 3),
  image_path text not null,
  title text not null default '',
  created_at timestamptz not null default now(),
  check (((slot - 1) % 3) + cols <= 3 and ((slot - 1) / 3) + rows <= 3)
);
create index if not exists pokemon_binder_art_binder_idx on public.pokemon_binder_art (binder_id, page);

alter table public.pokemon_binder_art enable row level security;
drop policy if exists pokemon_binder_art_own on public.pokemon_binder_art;
create policy pokemon_binder_art_own on public.pokemon_binder_art
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.pokemon_binders b where b.id = binder_id and b.user_id = auth.uid()));

-- Does art cover pocket (page, slot) of the binder? (excluding art p_skip)
create or replace function public.pokemon_art_covers(p_binder uuid, p_page int, p_slot int, p_skip uuid default null)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (
    select 1 from pokemon_binder_art a
     where a.binder_id = p_binder and a.page = p_page
       and (p_skip is null or a.id <> p_skip)
       and ((p_slot - 1) % 3) between ((a.slot - 1) % 3) and ((a.slot - 1) % 3) + a.cols - 1
       and ((p_slot - 1) / 3) between ((a.slot - 1) / 3) and ((a.slot - 1) / 3) + a.rows - 1
  );
$$;

create or replace function public.pokemon_art_check()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  c int; r int; s int;
begin
  for r in 0 .. new.rows - 1 loop
    for c in 0 .. new.cols - 1 loop
      s := new.slot + r * 3 + c;
      if pokemon_art_covers(new.binder_id, new.page, s, new.id) then
        raise exception 'art_overlaps_art';
      end if;
      if exists (select 1 from pokemon_cards where binder_id = new.binder_id and binder_page = new.page and binder_slot = s) then
        raise exception 'art_overlaps_card';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;

drop trigger if exists pokemon_binder_art_check on public.pokemon_binder_art;
create trigger pokemon_binder_art_check
  before insert or update on public.pokemon_binder_art
  for each row execute function public.pokemon_art_check();

create or replace function public.pokemon_card_not_on_art()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.binder_slot is not null and new.binder_id is not null
     and pokemon_art_covers(new.binder_id, coalesce(new.binder_page, 1), new.binder_slot) then
    raise exception 'pocket_has_art';
  end if;
  return new;
end;
$$;

drop trigger if exists pokemon_cards_not_on_art on public.pokemon_cards;
create trigger pokemon_cards_not_on_art
  before insert or update of binder_id, binder_page, binder_slot on public.pokemon_cards
  for each row execute function public.pokemon_card_not_on_art();

-- Images: public bucket, each user writes only inside a folder named after
-- their user id ("<uid>/<file>.jpg").
insert into storage.buckets (id, name, public)
values ('pokemon-art', 'pokemon-art', true)
on conflict (id) do update set public = true;

drop policy if exists pokemon_art_insert on storage.objects;
create policy pokemon_art_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pokemon-art' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists pokemon_art_delete on storage.objects;
create policy pokemon_art_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'pokemon-art' and (storage.foldername(name))[1] = auth.uid()::text);

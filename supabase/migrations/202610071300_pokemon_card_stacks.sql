-- Master Sets with "one pocket per card": the variants of a card (Normal,
-- Holo, Reverse, Poké Ball…) share one pocket. The pocket holds the main row;
-- every other variant is a row of its own (own status, quantity and price)
-- that points at it with stack_of and has no pocket (binder_slot null).
-- Deleting the main row deletes its variants; moving it (page, binder) takes
-- them along, so page operations keep counting them on the right page.
alter table public.pokemon_cards
  add column if not exists stack_of uuid references public.pokemon_cards(id) on delete cascade;
create index if not exists pokemon_cards_stack_of_idx on public.pokemon_cards (stack_of) where stack_of is not null;

create or replace function public.pokemon_card_stack_follow()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.stack_of is null and (new.binder_id is distinct from old.binder_id or
     (new.binder_page is distinct from old.binder_page and new.binder_page is not null)) then
    update public.pokemon_cards
       set binder_id = new.binder_id, binder_page = new.binder_page
     where stack_of = new.id
       and (binder_id is distinct from new.binder_id or binder_page is distinct from new.binder_page);
  end if;
  return null;
end $$;

drop trigger if exists pokemon_cards_stack_follow on public.pokemon_cards;
create trigger pokemon_cards_stack_follow
  after update of binder_id, binder_page on public.pokemon_cards
  for each row execute function public.pokemon_card_stack_follow();

-- Reorder from a spreadsheet: only pocket cards count; grouped variants
-- (stack_of) have no pocket and follow their main card.
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
  select count(*) into n_binder from pokemon_cards where user_id = uid and binder_id = p_binder and stack_of is null;
  select count(*) into n_match from jsonb_to_recordset(p_positions) as p(id uuid, page int, slot int) join pokemon_cards c on c.id = p.id and c.user_id = uid and c.binder_id = p_binder and c.stack_of is null;
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

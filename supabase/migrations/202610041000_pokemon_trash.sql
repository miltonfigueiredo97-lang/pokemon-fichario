-- Every deleted card or binder is kept for 60 days (also cards removed by the
-- ON DELETE CASCADE of a binder), so a deletion can always be undone.
-- (On 2026-10-04 deleting a binder removed ~330 cards with no way back.)
create table if not exists public.pokemon_cards_trash (
  trash_id bigserial primary key,
  deleted_at timestamptz not null default now(),
  row jsonb not null
);
create index if not exists pokemon_cards_trash_user on public.pokemon_cards_trash ((row->>'user_id'), deleted_at desc);
create index if not exists pokemon_cards_trash_binder on public.pokemon_cards_trash ((row->>'binder_id'));
alter table public.pokemon_cards_trash enable row level security;

create table if not exists public.pokemon_binders_trash (
  trash_id bigserial primary key,
  deleted_at timestamptz not null default now(),
  row jsonb not null
);
alter table public.pokemon_binders_trash enable row level security;

create or replace function public.pokemon_keep_deleted_card() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.pokemon_cards_trash(row) values (to_jsonb(old));
  return old;
end $$;

create or replace function public.pokemon_keep_deleted_binder() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.pokemon_binders_trash(row) values (to_jsonb(old));
  return old;
end $$;

drop trigger if exists pokemon_cards_keep_deleted on public.pokemon_cards;
create trigger pokemon_cards_keep_deleted before delete on public.pokemon_cards
  for each row execute function public.pokemon_keep_deleted_card();
drop trigger if exists pokemon_binders_keep_deleted on public.pokemon_binders;
create trigger pokemon_binders_keep_deleted before delete on public.pokemon_binders
  for each row execute function public.pokemon_keep_deleted_binder();

-- Daily: the trash keeps 60 days.
select cron.schedule('pokemon-trash-cleanup', '17 6 * * *',
  $$delete from public.pokemon_cards_trash where deleted_at < now() - interval '60 days';
    delete from public.pokemon_binders_trash where deleted_at < now() - interval '60 days';$$);

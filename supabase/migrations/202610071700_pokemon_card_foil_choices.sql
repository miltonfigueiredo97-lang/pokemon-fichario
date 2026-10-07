-- Foil choices are per account: what someone picks in the viewer ("✦" panel:
-- foil and intensity of that card) is theirs only. pokemon_card_foils keeps
-- only the curated starting point (pokemon-cards-css promos + cards checked
-- by eye) and becomes read-only for users.
create table if not exists public.pokemon_card_foil_choices (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  api_id text not null,
  style text check (style in ('none','holo','cosmos','reverse','v','fullart','illus','rainbow','gold','vmax','vstar','radiant','amazing','shiny')),
  intensity integer check (intensity between 0 and 200),
  updated_at timestamptz not null default now(),
  primary key (user_id, api_id)
);
alter table public.pokemon_card_foil_choices enable row level security;
drop policy if exists pokemon_card_foil_choices_own on public.pokemon_card_foil_choices;
create policy pokemon_card_foil_choices_own on public.pokemon_card_foil_choices
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.pokemon_card_foil_choices to authenticated;

-- Choices already made in the shared table move to their author.
insert into public.pokemon_card_foil_choices (user_id, api_id, style)
select updated_by, api_id, style from public.pokemon_card_foils
 where source = 'user' and updated_by is not null
on conflict (user_id, api_id) do update set style = excluded.style, updated_at = now();
delete from public.pokemon_card_foils where source = 'user';
insert into public.pokemon_card_foils (api_id, style, source, updated_by)
values ('myp-456328', 'gold', 'conferido', null)
on conflict (api_id) do update set style = excluded.style, source = excluded.source, updated_at = now();

-- Curated table: read-only for users.
drop policy if exists pokemon_card_foils_write on public.pokemon_card_foils;
drop policy if exists pokemon_card_foils_update on public.pokemon_card_foils;
drop policy if exists pokemon_card_foils_delete on public.pokemon_card_foils;
revoke insert, update, delete on public.pokemon_card_foils from authenticated;

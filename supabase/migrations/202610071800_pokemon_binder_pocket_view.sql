-- How a Master Set binder is shown: one pocket per variant or one pocket per
-- card (variants of a card together). Only a view: null = as the binder was
-- built (its stack_of rows decide). Saved per binder so every PC shows the same.
alter table public.pokemon_binders add column if not exists pocket_view text;
alter table public.pokemon_binders drop constraint if exists pokemon_binders_pocket_view_check;
alter table public.pokemon_binders add constraint pokemon_binders_pocket_view_check
  check (pocket_view is null or pocket_view in ('variant', 'card'));

-- Framing of a binder art inside its pockets: zoom (1 = the image covers the
-- whole cols x rows rectangle; <1 shrinks, >1 enlarges) and position
-- (pos_x/pos_y from 0 to 1: which part of the image is shown; 0.5 = centre).
alter table public.pokemon_binder_art
  add column if not exists zoom real not null default 1,
  add column if not exists pos_x real not null default 0.5,
  add column if not exists pos_y real not null default 0.5;

alter table public.pokemon_binder_art drop constraint if exists pokemon_binder_art_framing_check;
alter table public.pokemon_binder_art add constraint pokemon_binder_art_framing_check
  check (zoom between 0.3 and 4 and pos_x between 0 and 1 and pos_y between 0 and 1);

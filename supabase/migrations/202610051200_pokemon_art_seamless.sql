-- "Arte inteira": the art is shown as one picture over its pockets (no gap
-- between them) and printed as a single uncut piece (cols*63 x rows*88 mm).
alter table public.pokemon_binder_art add column if not exists seamless boolean not null default false;

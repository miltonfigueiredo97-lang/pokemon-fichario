alter table public.pokemon_cards
  add column if not exists price_batch_id text,
  add column if not exists price_batch_started_at timestamptz;

create index if not exists pokemon_cards_price_batch_idx
  on public.pokemon_cards (price_batch_id)
  where price_batch_id is not null;

comment on column public.pokemon_cards.price_batch_id is
'Logical refresh batch that keeps progress stable even after successfully priced cards leave the current unpriced filter.';

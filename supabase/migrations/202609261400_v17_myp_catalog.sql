-- Learned MYP catalog.
--
-- Every MYP product page the price engine opens also lists the previous/next
-- product of the same set and "Outras Edições" of the same card, each with its
-- exact URL and "Name (number)". The worker stores all of them here, so link
-- discovery gets more precise with every page read (even a wrong candidate
-- teaches its neighbours). Service-role only: RLS on, no policies.

create table if not exists public.myp_products (
  product_id  integer primary key,
  slug        text not null,
  title       text not null,
  name_key    text not null,
  num         text not null,
  den         text not null default '',
  set_code    text,
  info        text not null default '',
  seen_at     timestamptz not null default now()
);
create index if not exists myp_products_num_idx on public.myp_products (num, den);
create index if not exists myp_products_name_idx on public.myp_products (name_key);
create index if not exists myp_products_set_idx on public.myp_products (set_code);
alter table public.myp_products enable row level security;
revoke all on public.myp_products from anon, authenticated;

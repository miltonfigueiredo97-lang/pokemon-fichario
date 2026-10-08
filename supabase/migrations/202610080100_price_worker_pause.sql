-- When MYP rate-limits (HTTP 429, then Cloudflare's 1015 ban), every price read
-- pauses for a while instead of only the card that hit it: the other reads kept
-- hitting MYP and turned a short 429 into a ban of the reader PC's IP.
create table if not exists public.price_worker_state (
  key text primary key,
  until timestamptz,
  detail text,
  updated_at timestamptz not null default now()
);
alter table public.price_worker_state enable row level security;

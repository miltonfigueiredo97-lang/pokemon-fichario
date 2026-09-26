-- Shared secret between pokemon-price-worker and /api/price-engine.
-- The worker reads it through this service_role-only function and sends it in
-- the x-engine-key header; Vercel holds the same value in PRICE_ENGINE_SECRET.
--
-- The real value is NOT stored in git. To rotate: generate a new random value,
-- run this migration with it in place of <SECRET>, then update
-- PRICE_ENGINE_SECRET in Vercel (production) and redeploy.

create or replace function public.pokemon_price_engine_secret()
returns text
language sql
security definer
set search_path to 'public'
as $$ select '<SECRET>'::text $$;

revoke all on function public.pokemon_price_engine_secret() from public, anon, authenticated;
grant execute on function public.pokemon_price_engine_secret() to service_role;

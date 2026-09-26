-- V17 price queue.
--
-- claim_pokemon_price_jobs replaces the fully serialized
-- claim_pokemon_price_batch (one card in flight across ALL users). It claims
-- up to p_limit cards while keeping at most 8 cards in flight globally, so
-- overlapping worker runs (cron every 30 s + frontend kicks) cannot flood the
-- price engine. Stale locks from a crashed run are released after 3 minutes,
-- so a card can never stay "processing" forever.
--
-- myp_link_tried remembers MYP product ids already ruled out for a card while
-- its product link is being discovered from catalog neighbours.

alter table public.pokemon_cards
  add column if not exists myp_link_tried integer[] not null default '{}';

create or replace function public.claim_pokemon_price_jobs(p_limit integer default 5)
returns setof public.pokemon_cards
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  in_flight integer;
  slots integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('pokemon-price-jobs-claim', 0));

  update public.pokemon_cards
     set price_processing_at = null
   where price_pending = true
     and price_processing_at is not null
     and price_processing_at < now() - interval '3 minutes';

  select count(*) into in_flight
    from public.pokemon_cards
   where price_pending = true
     and price_processing_at is not null;

  slots := least(greatest(coalesce(p_limit, 5), 1), 10, 8 - in_flight);
  if slots <= 0 then
    return;
  end if;

  return query
  with candidate as (
    select p.id
      from public.pokemon_cards p
     where p.price_pending = true
       and p.price_processing_at is null
       and (p.price_next_retry_at is null or p.price_next_retry_at <= now())
     order by p.price_priority desc nulls last,
              p.price_requested_at asc nulls first,
              p.created_at asc
     for update skip locked
     limit slots
  )
  update public.pokemon_cards p
     set price_processing_at = now(),
         price_attempts = coalesce(p.price_attempts, 0) + 1,
         price_next_retry_at = null,
         price_progress = 10,
         price_progress_stage = 'claimed',
         price_progress_updated_at = now()
    from candidate c
   where p.id = c.id
  returning p.*;
end;
$function$;

revoke all on function public.claim_pokemon_price_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_pokemon_price_jobs(integer) to service_role;

-- V16.12: real price queue claim.
-- One DB row is one active price job. Claims are serialized, capped globally at
-- six concurrent rows, and use SKIP LOCKED so overlapping Edge invocations
-- cannot process the same card simultaneously.

create or replace function public.claim_pokemon_price_card()
returns setof public.pokemon_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('pokemon-price-worker-claim', 0));

  select count(*)
    into active_count
  from public.pokemon_cards
  where price_pending = true
    and price_processing_at is not null
    and price_processing_at >= now() - interval '90 seconds';

  if active_count >= 6 then
    return;
  end if;

  return query
  with candidate as (
    select p.id
    from public.pokemon_cards p
    where p.price_pending = true
      and (p.price_next_retry_at is null or p.price_next_retry_at <= now())
      and (
        p.price_processing_at is null
        or p.price_processing_at < now() - interval '90 seconds'
      )
    order by p.price_priority desc nulls last,
             p.price_requested_at asc nulls first,
             p.created_at asc
    for update skip locked
    limit 1
  ),
  claimed as (
    update public.pokemon_cards p
       set price_processing_at = now(),
           price_attempts = coalesce(p.price_attempts,0) + 1,
           price_last_error = null,
           price_progress = 10,
           price_progress_stage = 'claimed',
           price_progress_updated_at = now()
      from candidate c
     where p.id = c.id
    returning p.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_pokemon_price_card() from public, anon, authenticated;
grant execute on function public.claim_pokemon_price_card() to service_role;

comment on function public.claim_pokemon_price_card() is
'Atomically claims one due Pokemon price row with a global six-job processing cap. Used only by the service-role Edge Function.';

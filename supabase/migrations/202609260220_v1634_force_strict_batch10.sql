-- V16.34: hard invariant for bulk pricing.
-- Ignore p_limit so no stale worker can regress bulk processing to 1/5/6 cards.
-- Claim one homogeneous set/language group, up to exactly ten rows, and refuse
-- the next group while any row from the current group is still processing.

create or replace function public.claim_pokemon_price_batch(p_limit integer default 10)
returns setof public.pokemon_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
  g_user uuid;
  g_set text;
  g_lang text;
begin
  perform pg_advisory_xact_lock(hashtextextended('pokemon-price-worker-batch', 0));

  select count(*) into active_count
  from public.pokemon_cards
  where price_pending=true
    and price_processing_at is not null
    and price_processing_at >= now() - interval '90 seconds';

  if active_count > 0 then return; end if;

  select p.user_id,p.set_id,p.language_code
    into g_user,g_set,g_lang
  from public.pokemon_cards p
  where p.price_pending=true
    and p.price_processing_at is null
    and (p.price_next_retry_at is null or p.price_next_retry_at<=now())
  group by p.user_id,p.set_id,p.language_code
  order by (count(*)>=10) desc,
           count(*) desc,
           max(p.price_priority) desc nulls last,
           min(p.price_batch_started_at) asc nulls last,
           min(p.price_requested_at) asc nulls first
  limit 1;

  if g_user is null then return; end if;

  return query
  with candidate as (
    select p.id
    from public.pokemon_cards p
    where p.price_pending=true
      and p.price_processing_at is null
      and (p.price_next_retry_at is null or p.price_next_retry_at<=now())
      and p.user_id=g_user
      and p.set_id is not distinct from g_set
      and p.language_code is not distinct from g_lang
    order by p.price_priority desc nulls last,
             p.price_requested_at asc nulls first,
             p.created_at asc
    for update skip locked
    limit 10
  ),
  claimed as (
    update public.pokemon_cards p
       set price_processing_at=now(),
           price_attempts=1,
           price_last_error=null,
           price_next_retry_at=null,
           price_progress=10,
           price_progress_stage='claimed',
           price_progress_updated_at=now()
      from candidate c
     where p.id=c.id
    returning p.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_pokemon_price_batch(integer) from public,anon,authenticated;
grant execute on function public.claim_pokemon_price_batch(integer) to service_role;

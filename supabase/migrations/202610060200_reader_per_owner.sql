-- Each user's prices are read only by that user's own PCs.
--
-- Before: any online reader (e.g. one user's PC) claimed every user's MYP
-- reads, and the worker processed cards of users without a reader of their
-- own, so one PC carried a friend's whole queue.
-- Now: engine_requests carry the card owner (user_id, set by the worker); a
-- reader claims only requests of its owner (pokemon_reader_tokens) or
-- requests without an owner; and the worker only claims cards whose owner has
-- a reader seen in the last 45 s.

alter table public.engine_requests add column if not exists user_id uuid;
create index if not exists engine_requests_open_owner_idx on public.engine_requests (user_id, id) where done_at is null;

create or replace function public.engine_claim(p_key text, p_reader text, p_limit integer default 1, p_info jsonb default '{}'::jsonb)
returns setof engine_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  owner uuid;
begin
  if not public.engine_key_ok(p_key) then
    raise exception 'unauthorized';
  end if;
  select t.user_id into owner from public.pokemon_reader_tokens t
   where t.token_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  insert into public.engine_readers(reader_id, last_seen, info, user_id) values (left(p_reader, 80), now(), coalesce(p_info, '{}'::jsonb), owner)
    on conflict (reader_id) do update set last_seen = now(), info = excluded.info, user_id = coalesce(excluded.user_id, engine_readers.user_id);
  if owner is null then
    select r.user_id into owner from public.engine_readers r where r.reader_id = left(p_reader, 80);
  end if;
  return query
  update public.engine_requests r set claimed_at = now(), claimed_by = left(p_reader, 80)
   where r.id in (
     select q.id from public.engine_requests q
      where q.done_at is null and (q.claimed_at is null or q.claimed_at < now() - interval '90 seconds')
        and q.created_at > now() - interval '10 minutes'
        and (q.user_id is null or q.user_id = owner)
      order by q.id
      limit greatest(1, least(coalesce(p_limit, 1), 5))
      for update skip locked)
  returning r.*;
end $function$;

create or replace function public.claim_pokemon_price_jobs(p_limit integer default 5)
returns setof pokemon_cards
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

  slots := least(greatest(coalesce(p_limit, 5), 1), 10, 5 - in_flight);
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
       -- only users with one of their own readers online
       and exists (select 1 from public.engine_readers er
                    where er.user_id = p.user_id and er.last_seen > now() - interval '45 seconds')
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

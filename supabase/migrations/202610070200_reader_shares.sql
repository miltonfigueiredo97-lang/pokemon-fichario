-- Optional help between friends: a user can let their own PC readers also
-- read the prices of an accepted friend's cards. Off by default (each reader
-- reads only its owner's cards); the owner's cards always go first.

create table if not exists public.pokemon_reader_shares (
  owner_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id)
);
create index if not exists pokemon_reader_shares_friend_idx on public.pokemon_reader_shares (friend_id);
alter table public.pokemon_reader_shares enable row level security;

drop policy if exists "reader shares: read own or helped" on public.pokemon_reader_shares;
create policy "reader shares: read own or helped" on public.pokemon_reader_shares
  for select to authenticated using (owner_id = auth.uid() or friend_id = auth.uid());
drop policy if exists "reader shares: owner deletes" on public.pokemon_reader_shares;
create policy "reader shares: owner deletes" on public.pokemon_reader_shares
  for delete to authenticated using (owner_id = auth.uid());

-- Turns the help on or off; only for accepted friends.
create or replace function public.pokemon_set_reader_share(p_friend uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not p_on then
    delete from public.pokemon_reader_shares where owner_id = auth.uid() and friend_id = p_friend;
    return false;
  end if;
  if not exists (select 1 from public.pokemon_friendships f
                  where f.status = 'accepted'
                    and ((f.requester_id = auth.uid() and f.addressee_id = p_friend)
                      or (f.addressee_id = auth.uid() and f.requester_id = p_friend))) then
    raise exception 'not a friend';
  end if;
  insert into public.pokemon_reader_shares(owner_id, friend_id) values (auth.uid(), p_friend)
    on conflict do nothing;
  return true;
end $$;
revoke all on function public.pokemon_set_reader_share(uuid, boolean) from public, anon;
grant execute on function public.pokemon_set_reader_share(uuid, boolean) to authenticated;

-- A reader claims MYP reads of its owner, of friends its owner helps, and
-- requests without an owner; its owner's requests first.
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
        and (q.user_id is null or q.user_id = owner
             or q.user_id in (select s.friend_id from public.pokemon_reader_shares s where s.owner_id = owner))
      order by (q.user_id is distinct from owner), q.id
      limit greatest(1, least(coalesce(p_limit, 1), 5))
      for update skip locked)
  returning r.*;
end $function$;

-- The worker claims cards whose owner has a reader online, or a friend's
-- reader online that helps them; cards read by their owner's own PC first.
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
  with online as (
    select distinct er.user_id from public.engine_readers er
     where er.user_id is not null and er.last_seen > now() - interval '45 seconds'
  ), served as (
    select o.user_id, true as own from online o
    union all
    select s.friend_id, false from public.pokemon_reader_shares s join online o on o.user_id = s.owner_id
  ), candidate as (
    select p.id
      from public.pokemon_cards p
     where p.price_pending = true
       and p.price_processing_at is null
       and (p.price_next_retry_at is null or p.price_next_retry_at <= now())
       and exists (select 1 from served sv where sv.user_id = p.user_id)
     order by exists (select 1 from served sv where sv.user_id = p.user_id and sv.own) desc,
              p.price_priority desc nulls last,
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

-- Activity: also who helps whom.
drop function if exists public.pokemon_reader_activity();
create or replace function public.pokemon_reader_activity()
returns table(
  user_id uuid,
  username text,
  is_me boolean,
  readers_online integer,
  last_seen timestamptz,
  pcs jsonb,
  pending integer,
  processing integer,
  waiting_retry integer,
  done_hour integer,
  last_done_at timestamptz,
  reading jsonb,
  helped_by_me boolean,
  helpers_online integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with people as (
    select auth.uid() as uid
    union
    select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
      from public.pokemon_friendships f
     where f.status = 'accepted'
       and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
  )
  select
    pe.uid,
    pr.username,
    pe.uid = auth.uid(),
    (select count(*)::int from public.engine_readers r where r.user_id = pe.uid and r.last_seen > now() - interval '45 seconds'),
    (select max(r.last_seen) from public.engine_readers r where r.user_id = pe.uid),
    coalesce((select jsonb_agg(jsonb_build_object(
                'reader', r.reader_id,
                'last_seen', r.last_seen,
                'online', r.last_seen > now() - interval '45 seconds',
                'version', r.info->>'version') order by r.last_seen desc)
                from public.engine_readers r where r.user_id = pe.uid), '[]'::jsonb),
    (select count(*)::int from public.pokemon_cards c where c.user_id = pe.uid and c.price_pending),
    (select count(*)::int from public.pokemon_cards c where c.user_id = pe.uid and c.price_pending and c.price_processing_at is not null),
    (select count(*)::int from public.pokemon_cards c where c.user_id = pe.uid and c.price_pending and c.price_next_retry_at > now()),
    (select count(*)::int from public.pokemon_cards c where c.user_id = pe.uid and not coalesce(c.price_pending, false) and c.price_checked_at > now() - interval '1 hour'),
    (select max(c.price_checked_at) from public.pokemon_cards c where c.user_id = pe.uid and not coalesce(c.price_pending, false)),
    coalesce((select jsonb_agg(x.label) from (
                select concat_ws(' ', c.name, c.number) as label
                  from public.pokemon_cards c
                 where c.user_id = pe.uid and c.price_pending and c.price_processing_at is not null
                 order by c.price_processing_at
                 limit 5) x), '[]'::jsonb),
    exists (select 1 from public.pokemon_reader_shares s where s.owner_id = auth.uid() and s.friend_id = pe.uid),
    (select count(*)::int from public.pokemon_reader_shares s
       join public.engine_readers r on r.user_id = s.owner_id and r.last_seen > now() - interval '45 seconds'
      where s.friend_id = pe.uid)
  from people pe
  left join public.pokemon_profiles pr on pr.user_id = pe.uid
  where pe.uid is not null
  order by pe.uid = auth.uid() desc, pr.username;
$$;
revoke all on function public.pokemon_reader_activity() from public, anon;
grant execute on function public.pokemon_reader_activity() to authenticated;

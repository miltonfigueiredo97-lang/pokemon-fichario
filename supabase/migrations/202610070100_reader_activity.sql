-- What each price reader is doing, for the signed-in user and their accepted
-- friends: PCs online, cards being read now, queue size, cards read lately.
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
  reading jsonb)
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
                 limit 5) x), '[]'::jsonb)
  from people pe
  left join public.pokemon_profiles pr on pr.user_id = pe.uid
  where pe.uid is not null
  order by pe.uid = auth.uid() desc, pr.username;
$$;

revoke all on function public.pokemon_reader_activity() from public, anon;
grant execute on function public.pokemon_reader_activity() to authenticated;

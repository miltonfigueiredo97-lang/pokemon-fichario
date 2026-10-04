-- The MYP reader runs on the user's PCs (pokemon-reader.exe), not on a paid
-- server. Supabase functions leave a read request in engine_requests; a PC
-- claims it, opens the page in Edge and writes the answer back. Readers report
-- in engine_readers, so the worker only sends requests while a PC is online.

create table if not exists public.engine_requests (
  id bigserial primary key,
  params jsonb not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  done_at timestamptz,
  response jsonb
);
create index if not exists engine_requests_open on public.engine_requests (id) where done_at is null;
alter table public.engine_requests enable row level security;

create table if not exists public.engine_readers (
  reader_id text primary key,
  last_seen timestamptz not null default now(),
  info jsonb not null default '{}'::jsonb
);
alter table public.engine_readers enable row level security;

-- PC side: heartbeat + take up to p_limit open requests (a request claimed more
-- than 90 s ago without an answer is handed out again).
create or replace function public.engine_claim(p_key text, p_reader text, p_limit integer default 1, p_info jsonb default '{}'::jsonb)
returns setof public.engine_requests
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_key is distinct from public.pokemon_price_engine_secret() then
    raise exception 'unauthorized';
  end if;
  insert into public.engine_readers(reader_id, last_seen, info) values (left(p_reader, 80), now(), coalesce(p_info, '{}'::jsonb))
    on conflict (reader_id) do update set last_seen = now(), info = excluded.info;
  return query
  update public.engine_requests r set claimed_at = now(), claimed_by = left(p_reader, 80)
   where r.id in (
     select id from public.engine_requests
      where done_at is null and (claimed_at is null or claimed_at < now() - interval '90 seconds')
        and created_at > now() - interval '10 minutes'
      order by id
      limit greatest(1, least(coalesce(p_limit, 1), 5))
      for update skip locked)
  returning r.*;
end $$;

create or replace function public.engine_respond(p_key text, p_id bigint, p_response jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_key is distinct from public.pokemon_price_engine_secret() then
    raise exception 'unauthorized';
  end if;
  update public.engine_requests set done_at = now(), response = p_response where id = p_id and done_at is null;
end $$;

-- Requests older than an hour are never read again.
create or replace function public.engine_requests_cleanup()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.engine_requests where created_at < now() - interval '1 hour';
$$;

revoke all on function public.engine_claim(text, text, integer, jsonb) from public;
revoke all on function public.engine_respond(text, bigint, jsonb) from public;
revoke all on function public.engine_requests_cleanup() from public;
grant execute on function public.engine_claim(text, text, integer, jsonb) to anon, authenticated, service_role;
grant execute on function public.engine_respond(text, bigint, jsonb) to anon, authenticated, service_role;
grant execute on function public.engine_requests_cleanup() to service_role;

-- Public status for the site's "price reader is off" notice (no secret).
create or replace function public.engine_reader_status()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'online', coalesce(max(last_seen) > now() - interval '45 seconds', false),
    'last_seen', max(last_seen),
    'readers', count(*) filter (where last_seen > now() - interval '45 seconds'))
  from public.engine_readers;
$$;
grant execute on function public.engine_reader_status() to anon, authenticated, service_role;

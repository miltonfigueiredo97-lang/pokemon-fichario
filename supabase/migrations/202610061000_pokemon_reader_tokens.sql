-- Price reader per user: the reader no longer needs the shared engine secret
-- baked into the exe. A signed-in user clicks "Ligar leitor neste PC" on the
-- site, which creates a reader token (pokemon_reader_pair) and hands it to the
-- reader through the pokemonreader:// link. The queue functions accept either
-- the old secret or a valid reader token. Only a hash of the token is stored.
create table if not exists public.pokemon_reader_tokens (
  token_hash text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.pokemon_reader_tokens enable row level security;

create or replace function public.pokemon_reader_pair()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  token text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.pokemon_reader_tokens (token_hash, user_id)
  values (encode(extensions.digest(token, 'sha256'), 'hex'), auth.uid());
  return token;
end $$;
revoke all on function public.pokemon_reader_pair() from public;
grant execute on function public.pokemon_reader_pair() to authenticated;

create or replace function public.engine_key_ok(p_key text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_key is null or p_key = '' then return false; end if;
  if p_key = public.pokemon_price_engine_secret() then return true; end if;
  update public.pokemon_reader_tokens set last_used_at = now()
   where token_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  return found;
end $$;
revoke all on function public.engine_key_ok(text) from public;

create or replace function public.engine_claim(p_key text, p_reader text, p_limit integer default 1, p_info jsonb default '{}'::jsonb)
returns setof public.engine_requests
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.engine_key_ok(p_key) then
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
  if not public.engine_key_ok(p_key) then
    raise exception 'unauthorized';
  end if;
  update public.engine_requests set done_at = now(), response = p_response where id = p_id and done_at is null;
end $$;

-- Which account each reader belongs to, so the site can say "your reader is
-- on" (engine_reader_status.mine) besides "some reader is on".
alter table public.engine_readers add column if not exists user_id uuid;

create or replace function public.engine_claim(p_key text, p_reader text, p_limit integer default 1, p_info jsonb default '{}'::jsonb)
returns setof public.engine_requests
language plpgsql
security definer
set search_path to 'public'
as $$
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

create or replace function public.engine_reader_status()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'online', coalesce(max(last_seen) > now() - interval '45 seconds', false),
    'last_seen', max(last_seen),
    'readers', count(*) filter (where last_seen > now() - interval '45 seconds'),
    'mine', count(*) filter (where last_seen > now() - interval '45 seconds' and user_id = auth.uid()),
    'mine_last_seen', max(last_seen) filter (where user_id = auth.uid()))
  from public.engine_readers;
$$;

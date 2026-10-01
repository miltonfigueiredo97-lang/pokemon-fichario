-- Monthly budget for the Chromium functions on Vercel (price engine and MYP
-- catalog search). Every run reports an upper bound of what it used; once the
-- month reaches the cap, the functions refuse to open a browser until the next
-- month, so the free (Hobby) allowance is never exhausted.
--
-- Caps = half of the Hobby allowance (4 CPU-hours, 360 GB-hours per month).

create table if not exists public.engine_usage (
  month date primary key,
  cpu_ms bigint not null default 0,
  mem_gb_s numeric not null default 0,
  calls integer not null default 0,
  refused integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.engine_usage enable row level security;

-- p_cpu_ms = 0 and p_mem_gb_s = 0 only checks. Returns allowed + totals.
create or replace function public.engine_budget(p_key text, p_cpu_ms integer default 0, p_mem_gb_s numeric default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cap_cpu_ms constant bigint := 2 * 3600 * 1000;   -- 2 of 4 CPU-hours
  cap_mem_gb_s constant numeric := 180 * 3600;     -- 180 of 360 GB-hours
  m date := date_trunc('month', now() at time zone 'utc')::date;
  row public.engine_usage;
  ok boolean;
begin
  if p_key is distinct from public.pokemon_price_engine_secret() then
    return jsonb_build_object('allowed', false, 'error', 'unauthorized');
  end if;
  insert into public.engine_usage(month) values (m) on conflict (month) do nothing;
  if coalesce(p_cpu_ms, 0) > 0 or coalesce(p_mem_gb_s, 0) > 0 then
    update public.engine_usage
       set cpu_ms = cpu_ms + greatest(p_cpu_ms, 0), mem_gb_s = mem_gb_s + greatest(p_mem_gb_s, 0),
           calls = calls + 1, updated_at = now()
     where month = m returning * into row;
  else
    select * into row from public.engine_usage where month = m;
  end if;
  ok := row.cpu_ms < cap_cpu_ms and row.mem_gb_s < cap_mem_gb_s;
  if not ok and coalesce(p_cpu_ms, 0) = 0 then
    update public.engine_usage set refused = refused + 1 where month = m;
  end if;
  return jsonb_build_object('allowed', ok, 'cpu_ms', row.cpu_ms, 'mem_gb_s', row.mem_gb_s, 'calls', row.calls,
    'cap_cpu_ms', cap_cpu_ms, 'cap_mem_gb_s', cap_mem_gb_s);
end $$;

revoke all on function public.engine_budget(text, integer, numeric) from public;
grant execute on function public.engine_budget(text, integer, numeric) to anon, authenticated, service_role;

-- Read-only view of the month for the app (no secret needed).
create or replace function public.engine_usage_month()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select coalesce((select jsonb_build_object('cpu_ms', cpu_ms, 'mem_gb_s', mem_gb_s, 'calls', calls, 'refused', refused,
    'cap_cpu_ms', 2 * 3600 * 1000, 'cap_mem_gb_s', 180 * 3600)
    from public.engine_usage where month = date_trunc('month', now() at time zone 'utc')::date), '{}'::jsonb)
$$;
grant execute on function public.engine_usage_month() to anon, authenticated, service_role;

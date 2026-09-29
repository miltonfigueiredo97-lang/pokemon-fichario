-- Price jobs requested by the app are stamped with the database clock.
--
-- The browser wrote price_requested_at / price_next_retry_at with the
-- computer's clock. A clock 73 s ahead kept every job unclaimable for 73 s
-- (claim_pokemon_price_jobs needs price_next_retry_at <= now()) and made the
-- app reject the worker's result, stamped with server time, as "older" than
-- the request: "Na fila..." forever.
--
-- Only requests made by app users are stamped; the worker (service_role) sets
-- its own retry delays.

create or replace function public.pokemon_price_request_server_time()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if new.price_pending
     and (tg_op = 'INSERT'
          or not coalesce(old.price_pending, false)
          or new.price_requested_at is distinct from old.price_requested_at) then
    new.price_requested_at := now();
    new.price_next_retry_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists pokemon_cards_price_request_server_time on public.pokemon_cards;
create trigger pokemon_cards_price_request_server_time
  before insert or update on public.pokemon_cards
  for each row execute function public.pokemon_price_request_server_time();

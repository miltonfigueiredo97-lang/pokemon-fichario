-- Binder art is visible to whoever can see the owner's cards: the owner, any
-- signed-in user when the profile is public, and accepted friends when the
-- profile is "friends" (same rule as pokemon_cards_select_visible_binders).
-- Writing stays owner-only (policies *_own).

create or replace function public.pokemon_binders_visible_to_me(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() = p_owner
      or exists (select 1 from pokemon_profiles p where p.user_id = p_owner and p.binder_visibility = 'public')
      or (exists (select 1 from pokemon_profiles p where p.user_id = p_owner and p.binder_visibility = 'friends')
          and exists (select 1 from pokemon_friendships f
                       where f.status = 'accepted'
                         and ((f.requester_id = auth.uid() and f.addressee_id = p_owner)
                           or (f.addressee_id = auth.uid() and f.requester_id = p_owner))));
$$;

drop policy if exists pokemon_binder_art_select_visible on public.pokemon_binder_art;
create policy pokemon_binder_art_select_visible on public.pokemon_binder_art
  for select to authenticated
  using (public.pokemon_binders_visible_to_me(user_id));

drop policy if exists pokemon_art_pieces_select_visible on public.pokemon_binder_art_pieces;
create policy pokemon_art_pieces_select_visible on public.pokemon_binder_art_pieces
  for select to authenticated
  using (public.pokemon_binders_visible_to_me(user_id));

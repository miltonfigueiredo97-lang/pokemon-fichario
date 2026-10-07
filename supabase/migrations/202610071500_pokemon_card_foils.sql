-- The foil each printing really has, for the card viewer. Neither TCGdex nor
-- the other sources say it for promos ("Promo") or special sets (the 30th
-- Classic Collection Lugia is all gold), so it is kept here, by card id,
-- shared by every account:
--   * the Sword & Shield promo foils listed by pokemon-cards-css (promos.json);
--   * the binders' promos and special cards, checked by eye (2026-10-07);
--   * what users choose in the viewer ("Foil desta carta").
-- Styles: none, holo, cosmos, reverse, v, fullart, illus, rainbow, gold,
-- vmax, vstar, radiant, amazing, shiny.
create table if not exists public.pokemon_card_foils (
  api_id text primary key,
  style text not null check (style in ('none','holo','cosmos','reverse','v','fullart','illus','rainbow','gold','vmax','vstar','radiant','amazing','shiny')),
  source text not null default 'user',
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.pokemon_card_foils enable row level security;
drop policy if exists pokemon_card_foils_read on public.pokemon_card_foils;
create policy pokemon_card_foils_read on public.pokemon_card_foils for select to authenticated using (true);
drop policy if exists pokemon_card_foils_write on public.pokemon_card_foils;
create policy pokemon_card_foils_write on public.pokemon_card_foils for insert to authenticated with check (updated_by = auth.uid());
drop policy if exists pokemon_card_foils_update on public.pokemon_card_foils;
create policy pokemon_card_foils_update on public.pokemon_card_foils for update to authenticated using (true) with check (updated_by = auth.uid());
drop policy if exists pokemon_card_foils_delete on public.pokemon_card_foils;
create policy pokemon_card_foils_delete on public.pokemon_card_foils for delete to authenticated using (true);
grant select, insert, update, delete on public.pokemon_card_foils to authenticated;

-- Sword & Shield promos (pokemon-cards-css promos.json): "SWSH number" +
-- h holo, c cosmos, v V/sunpillar, f full art (etched), i alt art
-- (swsecret), r radiant, b rainbow, n none.
insert into public.pokemon_card_foils (api_id, style, source, updated_by)
select 'swshp-SWSH' || m[1],
       case m[2] when 'h' then 'holo' when 'c' then 'cosmos' when 'v' then 'v' when 'f' then 'fullart'
                 when 'i' then 'illus' when 'r' then 'radiant' when 'b' then 'rainbow' else 'none' end,
       'pokemon-cards-css', null
  from regexp_matches(
    '001h002h003h004v005f006h007h008h009h010c011c012c013c014v015v016v017v018v019v020h021v022h023h024h025h026c027c028c029c030v031c032c033c034c035h036h037h038h039c040c041c042c043v044f045f046c047c048c049v050f051c052c053c054c055v056v057v058c059c060c061v062f063v064v065v066h067h068h069h070c071c072c073c076i077i078v079c080c081c082c083v084f085f086f087f088h089h090h091h092c093c094c095c096f097i098f099i100v101v102f103f104v105v106v107v108v109v110v111v112h113h114h115h116c117c118c119c120c121f122h123h124h125h126c127c128c129c130v131v132c133v134v135c136c137c138c139v140v141v142v143v144c145i146i147v148v149v150v151v152f153c154v155v156v157v158v159v160v161v162v163v164v165v166v167n168h169h170h171h172c173c174c175c176v178h179f180i181f182i183f184i185h186h187h188h189c190c191c192c193n194v195f196v197f198v199v200v201v202v203v204v205h206h207h208h209c210c211c212c213f214f215v216v217v218v219v220c221c222c223v224v225v226f227f228f229f230r231c232c233c234c235f236f237v238v239v240h241h242h243h244c245c246c247c248f249f250v252v253f254f255f256f257v258v259v260f261f262f263v264f265f266v267f268f269h270h271h272h273c274c275c276c277c278c279c280v281v291f294v295v296b297f298f',
    '(\d{3})([a-z])', 'g') as m
on conflict (api_id) do update set style = excluded.style, source = excluded.source, updated_at = now();

-- Promos and special cards of the binders, checked by eye (2026-10-07).
insert into public.pokemon_card_foils (api_id, style, source, updated_by) values
('30th-021','v','conferido',null),('30th-053','v','conferido',null),('30th-064','v','conferido',null),
('30th-070','v','conferido',null),('30th-090','v','conferido',null),('30th-140','fullart','conferido',null),
('30th-143','fullart','conferido',null),('30th-156','illus','conferido',null),('cel25cc-CC015','holo','conferido',null),
('mep-023','fullart','conferido',null),('mep-031','fullart','conferido',null),('smp-SM168','fullart','conferido',null),
('smp-SM201','fullart','conferido',null),('smp-SM82','holo','conferido',null),('svp-046','holo','conferido',null),
('svp-047','holo','conferido',null),('svp-048','holo','conferido',null),('svp-049','fullart','conferido',null),
('svp-050','fullart','conferido',null),('svp-051','fullart','conferido',null),('svp-052','fullart','conferido',null),
('svp-053','fullart','conferido',null),('svp-130','fullart','conferido',null),('svp-131','fullart','conferido',null),
('svp-132','fullart','conferido',null),('svp-142','v','conferido',null),('svp-161','v','conferido',null),
('svp-174','illus','conferido',null),('svp-175','illus','conferido',null),('svp-176','illus','conferido',null),
('svp-196','fullart','conferido',null),('svp-207','fullart','conferido',null),('svp-208','fullart','conferido',null),
('svp-211','fullart','conferido',null),('svp-212','fullart','conferido',null),('svp-217','fullart','conferido',null),
('swshp-SWSH300','fullart','conferido',null),('swshp-SWSH301','fullart','conferido',null),
('30th-c-029','gold','conferido',null),('myp-456328','gold','conferido',null),('myp-456816','illus','conferido',null),
('myp-41715','holo','conferido',null),('myp-41746','v','conferido',null)
on conflict (api_id) do update set style = excluded.style, source = excluded.source, updated_at = now();

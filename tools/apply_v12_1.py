from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
js_path = root / 'v12.js'
api_path = root / 'api' / 'mypcards-public.js'
sw_path = root / 'sw.js'

js = js_path.read_text(encoding='utf-8')
js = js.replace('// Pokémon Binder BR — V12.0', '// Pokémon Binder BR — V12.1', 1)
js = js.replace("const APP_VERSION = 'V12.0';", "const APP_VERSION = 'V12.1';", 1)

if "version:'V12.1'" not in js:
    marker = "  const RELEASE_NOTES = [\n    {\n      version:'V12.0',"
    replacement = """  const RELEASE_NOTES = [
    {
      version:'V12.1',
      title:'Correspondência exata de carta e número completo',
      items:[
        'A Liga Pokémon agora recebe Nome (número/total), inclusive quando o banco antigo só tinha o numerador.',
        'O total da coleção é recuperado pelo TCGdex e reutilizado para Liga e MYP.',
        'A busca pública da MYP passou a considerar nome, número completo, coleção e idioma para evitar escolher a impressão errada.',
        'Omanyte da coleção 151, por exemplo, é resolvido como 180/165 e não como outra impressão japonesa com o mesmo numerador.'
      ]
    },
    {
      version:'V12.0',"""
    if marker not in js:
        raise SystemExit('release marker not found')
    js = js.replace(marker, replacement, 1)

if 'const fullNumberCache=new Map();' not in js:
    marker = "  function ligaQuery(card){\n"
    insert = """  const fullNumberCache=new Map();

  async function resolveFullNumber(card){
    const raw=String(card?.number||'').trim();
    if(/\\d+\\s*\\/\\s*\\d+/.test(raw))return raw.replace(/\\s/g,'');
    if(!raw)return '';
    const apiId=String(card?.apiId||card?.api_id||'').trim();
    if(!apiId)return raw;
    const key=`${apiId}|${raw}`;
    if(fullNumberCache.has(key))return fullNumberCache.get(key);
    try{
      const r=await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(apiId)}`,{cache:'force-cache'});
      if(r.ok){
        const data=await r.json();
        const total=Number(data?.set?.cardCount?.official||0);
        if(total>0){
          const full=`${Number(raw)}/${total}`;
          fullNumberCache.set(key,full);
          return full;
        }
      }
    }catch(err){console.warn('Número completo TCGdex:',err)}
    fullNumberCache.set(key,raw);
    return raw;
  }

  function ligaQuery(card,numberOverride=''){
"""
    if marker not in js:
        raise SystemExit('liga marker not found')
    js = js.replace(marker, insert, 1)
    js = js.replace("    const number=String(card?.number||'').trim();\n", "    const number=String(numberOverride||card?.number||'').trim();\n", 1)
    js = js.replace("  function ligaUrlV12(card){\n    return 'https://www.ligapokemon.com.br/?view=cards/search&card='+encodeURIComponent(ligaQuery(card));\n  }", "  function ligaUrlV12(card,numberOverride=''){\n    return 'https://www.ligapokemon.com.br/?view=cards/search&card='+encodeURIComponent(ligaQuery(card,numberOverride));\n  }", 1)

js = js.replace('  function fixSourceLinks(){', '  async function fixSourceLinks(){', 1)
old = "    const liga=$q('#ligaSearchLink');\n    if(liga)liga.href=ligaUrlV12(card);"
new = """    const liga=$q('#ligaSearchLink');
    if(liga){
      const fullNumber=await resolveFullNumber(card);
      liga.href=ligaUrlV12(card,fullNumber);
      const chip=$q('#detailNumber');
      if(chip&&fullNumber)chip.textContent=`# ${fullNumber}`;
    }"""
if old in js:
    js = js.replace(old, new, 1)

js = js.replace("    const number=String(card.number||'').trim();\n    const set=String(card.setId||card.set_id||card.setName||card.set_name||card.market_edition_pt||'').trim();", "    const number=await resolveFullNumber(card);\n    const set=String(card.setName||card.set_name||card.market_edition_pt||card.setId||card.set_id||'').trim();", 1)
if "p.set('lang'" not in js:
    js = js.replace("    if(set)p.set('set',set);\n", "    if(set)p.set('set',set);\n    const lang=String(card.languageCode||card.language_code||'').trim();\n    if(lang)p.set('lang',lang);\n", 1)

js_path.write_text(js, encoding='utf-8')

api = api_path.read_text(encoding='utf-8')
api = api.replace('PokemonBinderBR/12.0', 'PokemonBinderBR/12.1')
old_resolve = "async function resolvePage({ name, number, set, link }) {"
api = api.replace(old_resolve, "async function resolvePage({ name, number, set, link, lang }) {", 1)
old_score = """      const score = (identity.number === String(number || '').replace(/\\s/g, '') ? 500 : 0)
        + (normalize(identity.name) === normalize(name) ? 300 : 0)
        + (market.samples || 0);"""
new_score = """      const wantedNumber=String(number||'').replace(/\\s/g,'');
      const wantedSet=normalize(set);
      const edition=normalize(identity.edition);
      const code=normalize(identity.code);
      const langNorm=normalize(lang);
      let score = 0;
      if(identity.number===wantedNumber)score+=1000;
      else if(wantedNumber&&identity.number&&String(Number(identity.number.split('/')[0]))===String(Number(wantedNumber.split('/')[0])))score+=420;
      if(normalize(identity.name)===normalize(name))score+=350;
      if(wantedSet&&(edition.includes(wantedSet)||wantedSet.includes(edition)||code.includes(wantedSet)))score+=280;
      const japanese=/japones|japanese|sv2a/.test(`${edition} ${code}`);
      if(langNorm==='ja'&&japanese)score+=220;
      if(langNorm&&langNorm!=='ja'&&japanese)score-=260;
      score+=(market.samples||0);"""
if old_score not in api:
    raise SystemExit('score marker not found')
api = api.replace(old_score, new_score, 1)
api = api.replace("  const link = String(req.query.link || '').trim();\n", "  const link = String(req.query.link || '').trim();\n  const lang = String(req.query.lang || '').trim();\n", 1)
api = api.replace("  const cacheKey = `market:${normalize(name)}|${number}|${normalize(set)}|${safeMypProductUrl(link)}`;", "  const cacheKey = `market:${normalize(name)}|${number}|${normalize(set)}|${normalize(lang)}|${safeMypProductUrl(link)}`;", 1)
api = api.replace("    const found = await resolvePage({ name, number, set, link });", "    const found = await resolvePage({ name, number, set, link, lang });", 1)
api_path.write_text(api, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = re.sub(r"const CACHE_NAME = '[^']+';", "const CACHE_NAME = 'pokemon-binder-v12-1';", sw, count=1)
sw_path.write_text(sw, encoding='utf-8')

print('V12.1 applied')

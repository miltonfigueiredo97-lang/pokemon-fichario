'use strict';

const APIFY_ROOT = 'https://api.apify.com/v2/acts';

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function money(v){
  if(v===null||v===undefined||v==='')return 0;
  let s=String(v).replace(/R\$/gi,'').trim().replace(/\s/g,'');
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  const n=Number(s);
  return Number.isFinite(n)&&n>0?n:0;
}
function pick(obj,keys){for(const k of keys){if(obj&&obj[k]!==undefined&&obj[k]!==null&&obj[k]!=='')return obj[k]}return null}
function normalizeCollectorToken(v){
  const raw=String(v||'').trim().replace(/[^A-Za-z0-9]/g,'');
  if(!raw)return'';
  const m=raw.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  if(!m)return raw.toLowerCase();
  return (m[1]||'').toLowerCase()+String(Number(m[2]))+(m[3]||'').toLowerCase();
}
function numberParts(v){
  const s=String(v||''),token='[A-Za-z]{0,8}\\d{1,4}[A-Za-z]{0,4}';
  const m=s.match(new RegExp('('+token+')\\s*\\/\\s*('+token+')','i'));
  if(m){const n=normalizeCollectorToken(m[1]),d=normalizeCollectorToken(m[2]);return{n,d,full:n+'/'+d}}
  const x=s.match(new RegExp(token,'i'));
  if(x){const n=normalizeCollectorToken(x[0]);return{n,d:'',full:n}}
  return{n:'',d:'',full:''};
}
function numberFrom(v){return numberParts(v).full}
function itemNumber(item){return numberFrom(pick(item,['number','collectorNumber','collector_number','cardNumber','card_number']))||numberFrom(pick(item,['name','title','cardName','card_name','productName','product_name']))}
function itemName(item){return String(pick(item,['name','cardName','card_name','title','productName','product_name'])||'')}
function itemEdition(item){return String(pick(item,['edition','set','setName','set_name','collection','expansion'])||'')}
function itemUrl(item){return String(pick(item,['url','cardUrl','card_url','productUrl','product_url','link'])||'')}
function itemLanguage(item){return String(pick(item,['language','lang','cardLanguage','card_language','idioma'])||'')}
function itemCondition(item){return String(pick(item,['condition','cardCondition','card_condition','quality'])||'')}
function itemFinish(item){return String(pick(item,['finish','variant','printing','foilType','foil_type','treatment','version'])||'')}
function itemPrice(item){return money(pick(item,['price','amount','currentPrice','current_price','offerPrice','offer_price']))}
function aggregateFields(item){
  return {
    min:money(pick(item,['min','minPrice','min_price','priceMin','price_min','minimumPrice','minimum_price','lowestPrice','lowest_price'])),
    avg:money(pick(item,['avg','avgPrice','avg_price','priceAvg','price_avg','average','averagePrice','average_price','meanPrice','mean_price'])),
    max:money(pick(item,['max','maxPrice','max_price','priceMax','price_max','maximumPrice','maximum_price','highestPrice','highest_price']))
  };
}
function langMap(code){const n=norm(code);if(n==='pt br'||n==='pt'||n.includes('port'))return'portuguese';if(n==='en'||n.includes('ing')||n.includes('engl'))return'english';if(n==='ja'||n==='jp'||n.includes('jap'))return'japanese';return'any'}
function ligaCondition(v){const c=String(v||'').trim().toUpperCase();if(c==='DM')return'D';if(c==='NOVA')return'NM';return['M','NM','SP','MP','HP','D'].includes(c)?c:'any'}
function mypCondition(v){const c=String(v||'').trim().toLowerCase();if(c==='nova')return'nm';if(c==='d')return'dm';return['nm','sp','mp','hp','dm'].includes(c)?c:'any'}
function finishKind(v){const n=norm(v);if(!n||n==='normal'||n.includes('nao foil'))return'normal';if(n.includes('master'))return'masterball';if(n.includes('poke')&&n.includes('ball'))return'pokeball';if(n.includes('reverse'))return'reverse';if(n.includes('full art'))return'fullart';if(n.includes('promo'))return'promo';if(n.includes('foil')||n.includes('holo'))return'foil';return'other'}
function finishMatch(value,wanted){
  const kind=finishKind(wanted),n=norm(value);
  if(!n)return null;
  if(kind==='normal')return !/(foil|holo|reverse|master ball|masterball|poke ball|pokeball|full art|promo)/.test(n)||/\bnormal\b/.test(n);
  if(kind==='masterball')return /master ?ball/.test(n);
  if(kind==='pokeball')return /poke ?ball/.test(n)&&!/master/.test(n);
  if(kind==='reverse')return /reverse/.test(n);
  if(kind==='fullart')return /full ?art/.test(n);
  if(kind==='promo')return /promo/.test(n);
  if(kind==='foil')return /(foil|holo)/.test(n)&&!/(reverse|master ?ball|poke ?ball)/.test(n);
  return true;
}
function localeIdentityScore(item,wanted){
  const wantedLang=languageCode(wanted.lang||wanted.language||'');
  const hay=norm([itemEdition(item),itemLanguage(item),pick(item,['code','productCode','product_code','setCode','set_code'])||''].join(' '));
  const tokens=new Set(hay.split(/\s+/).filter(Boolean));
  const japanese=tokens.has('japones')||tokens.has('japanese')||tokens.has('sv2a');
  let score=0;
  if(wantedLang==='ja')score+=japanese?900:-250;
  else if(wantedLang&&japanese)score-=1500;
  const setId=norm(wanted.setId||'');
  if(setId==='sv03 5'||setId==='sv3 5'){
    if(wantedLang==='ja'){
      if(tokens.has('sv2a'))score+=1100;
      if(tokens.has('mew'))score-=1100;
    }else{
      if(tokens.has('mew'))score+=1100;
      if(tokens.has('sv2a'))score-=1800;
    }
  }
  return score;
}
function identityScore(item,wanted){
  const aliases=[wanted?.name,...(Array.isArray(wanted?.nameAliases)?wanted.nameAliases:[])].map(norm).filter(Boolean);
  const name=norm(itemName(item));
  const targetNumber=numberParts(wanted.number),foundNumber=numberParts(itemNumber(item));
  const targetSet=norm(wanted.set),set=norm(itemEdition(item));
  let score=0;
  if(aliases.length&&name){
    if(aliases.some(x=>x===name))score+=450;
    else if(aliases.some(x=>name.includes(x)||x.includes(name)))score+=260;
    else return -1000;
  }
  if(targetNumber.n&&foundNumber.n){
    if(targetNumber.n!==foundNumber.n)return -1000;
    score+=650;
    if(targetNumber.d&&foundNumber.d){
      if(targetNumber.d!==foundNumber.d)return -1000;
      score+=320;
    }else if(targetNumber.d)score+=100;
  }
  if(targetSet&&set&&(set.includes(targetSet)||targetSet.includes(set)))score+=180;
  const localeScore=localeIdentityScore(item,wanted);
  if(localeScore<=-1000)return -1000;
  score+=localeScore;
  return score;
}
function sourceRows(items,wanted){
  const scored=(Array.isArray(items)?items:[]).map(item=>({item,score:identityScore(item,wanted)})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score);
  if(!scored.length)return[];
  const top=scored[0].score;
  return scored.filter(x=>x.score>=Math.max(300,top-120)).map(x=>x.item);
}
function qualityCode(v){
  const n=norm(v).toUpperCase();
  if(!n||n==='NOVA'||n==='NEW'||n==='MINT'||n.includes('NEAR MINT')||/^NM(?:\+|-)?$/.test(n))return'NM';
  if(n.includes('SLIGHTLY PLAYED')||/^SP(?:\+|-)?$/.test(n))return'SP';
  if(n.includes('MODERATELY PLAYED')||/^MP(?:\+|-)?$/.test(n))return'MP';
  if(n.includes('HEAVILY PLAYED')||/^HP(?:\+|-)?$/.test(n))return'HP';
  if(n.includes('DAMAGED')||/^DM(?:\+|-)?$/.test(n)||n==='D')return'DM';
  return n;
}
function languageCode(v){
  const n=norm(v);
  if(!n)return'';
  if(n==='pt'||n==='pt br'||n==='br'||n.includes('portugues')||n.includes('portuguese'))return'pt-br';
  if(n==='en'||n==='us'||n==='gb'||n.includes('ingles')||n.includes('english'))return'en';
  if(n==='ja'||n==='jp'||n.includes('japones')||n.includes('japanese'))return'ja';
  if(n==='zh'||n==='cn'||n.includes('chines')||n.includes('chinese'))return'zh';
  if(n==='ko'||n.includes('coreano')||n.includes('korean'))return'ko';
  return n;
}
function filterOffers(rows,wanted){
  if(!rows.length)return {rows:[],exactVariant:false};
  let filtered=rows;

  const wantedLang=languageCode(wanted.lang||wanted.language||'');
  if(wantedLang){
    const explicit=filtered.filter(x=>String(itemLanguage(x)||'').trim());
    if(explicit.length){
      const exactLanguage=explicit.filter(x=>languageCode(itemLanguage(x))===wantedLang);
      if(!exactLanguage.length)return {rows:[],exactVariant:false,reason:'language_not_found'};
      filtered=exactLanguage;
    }
  }

  const wantedCondition=qualityCode(wanted.condition||'Nova');
  if(wantedCondition){
    const explicit=filtered.filter(x=>String(itemCondition(x)||'').trim());
    if(explicit.length){
      const exactCondition=explicit.filter(x=>qualityCode(itemCondition(x))===wantedCondition);
      if(!exactCondition.length)return {rows:[],exactVariant:false,reason:'condition_not_found'};
      filtered=exactCondition;
    }
  }

  const wantedFinish=String(wanted.finish||'Normal').trim();
  const wantedKind=finishKind(wantedFinish);
  const explicitFinish=filtered.filter(x=>String(itemFinish(x)||'').trim());
  let exactVariant=false;
  if(explicitFinish.length){
    if(wantedKind==='normal'){
      // Normal pode usar linhas sem acabamento explícito, mas nunca uma
      // variante explicitamente Reverse/Foil/Poké Ball/Master Ball.
      const allowed=filtered.filter(x=>{
        const raw=String(itemFinish(x)||'').trim();
        if(!raw)return true;
        return finishMatch(raw,wantedFinish)!==false;
      });
      if(!allowed.length)return {rows:[],exactVariant:false,reason:'finish_not_found'};
      filtered=allowed;
    }else{
      // Para variantes especiais, aceite SOMENTE anúncios que declarem
      // explicitamente o acabamento pedido. Linhas vazias são a impressão
      // padrão e não podem contaminar Reverse/Foil/Poké Ball/Master Ball.
      const allowed=explicitFinish.filter(x=>finishMatch(itemFinish(x),wantedFinish)===true);
      if(!allowed.length)return {rows:[],exactVariant:false,reason:'finish_not_found'};
      filtered=allowed;
      exactVariant=true;
    }
  }else if(wantedKind!=='normal'){
    return {rows:[],exactVariant:false,reason:'finish_not_found'};
  }
  return {rows:filtered,exactVariant};
}
function hasMarket(m){return !!(m&&(Number(m.min)||Number(m.avg)||Number(m.max)))}
function summarize(rows,wanted){
  const filtered=filterOffers(rows,wanted);
  const offers=filtered.rows;

  // Preço de anúncio e estatística agregada são coisas diferentes.
  // Nunca transformar apenas "mínimo" em mínimo/médio/máximo.
  const prices=offers.map(itemPrice).filter(Boolean).sort((a,b)=>a-b);
  if(prices.length){
    return {
      min:prices[0],
      avg:prices.reduce((a,b)=>a+b,0)/prices.length,
      max:prices[prices.length-1],
      samples:prices.length,
      exactVariant:filtered.exactVariant,
      complete:true
    };
  }

  const aggregates=offers.map(aggregateFields);
  const mins=aggregates.map(x=>x.min).filter(Boolean);
  const avgs=aggregates.map(x=>x.avg).filter(Boolean);
  const maxs=aggregates.map(x=>x.max).filter(Boolean);
  const min=mins.length?Math.min(...mins):0;
  const avg=avgs.length?avgs.reduce((a,b)=>a+b,0)/avgs.length:0;
  const max=maxs.length?Math.max(...maxs):0;

  return {
    min,
    avg,
    max,
    samples:null,
    exactVariant:filtered.exactVariant,
    complete:!!(min&&avg&&max)
  };
}

async function runActor(actor,input,timeoutSeconds=55){
  const token=process.env.APIFY_API_TOKEN;
  if(!token){const e=new Error('APIFY_API_TOKEN não configurado');e.code='apify_not_configured';throw e}
  const seconds=Math.max(8,Math.min(55,Number(timeoutSeconds)||55));
  const url=APIFY_ROOT+'/'+actor+'/run-sync-get-dataset-items?token='+encodeURIComponent(token)+'&timeout='+seconds;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),(seconds+2)*1000);
  try{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(input),signal:controller.signal});
    const text=await r.text();
    let data=null;try{data=JSON.parse(text)}catch{}
    if(!r.ok){const e=new Error(data&&data.error&&data.error.message?data.error.message:'Apify HTTP '+r.status);e.code=r.status===401?'apify_auth':'apify_error';throw e}
    return Array.isArray(data)?data:(data&&Array.isArray(data.items)?data.items:[]);
  }finally{clearTimeout(timer)}
}

async function queryLiga(wanted){
  const name=String(wanted.name||'').trim();
  const number=String(wanted.number||'').trim();
  const exactQuery=number?name+' ('+number+')':name;
  const makeInput=query=>({
    query,
    language:langMap(wanted.lang),
    includeOffers:true,
    condition:ligaCondition(wanted.condition),
    maxProducts:8,
    maxItems:100,
    proxyConfiguration:{useApifyProxy:true}
  });

  let items=await runActor('gio21~ligapokemon-scraper',makeInput(exactQuery));
  let rows=sourceRows(items,wanted);
  let market=summarize(rows,wanted);
  if(number&&!hasMarket(market)){
    items=await runActor('gio21~ligapokemon-scraper',makeInput(name));
    rows=sourceRows(items,wanted);
    market=summarize(rows,wanted);
  }
  const link=rows.map(itemUrl).find(Boolean)||'';
  return Object.assign({source:'Liga Pokémon',provider:'Apify',link,rows:rows.length},market);
}

async function queryMyp(wanted){
  const aliases=[wanted?.name,...(Array.isArray(wanted?.nameAliases)?wanted.nameAliases:[])]
    .map(x=>String(x||'').trim()).filter(Boolean);
  const base=String(wanted.name||'').trim();
  const number=String(wanted.number||'').trim();
  const set=String(wanted.set||'').trim();
  const setId=String(wanted.setId||'').trim();
  const language=langMap(wanted.lang);
  const differentAliases=aliases.filter(x=>norm(x)!==norm(base));
  const localizedAlias=language==='portuguese'?(differentAliases[0]||base):(differentAliases.slice(-1)[0]||base);

  // V15.06: MYP must resolve the PRINTING, not merely the Pokémon name.
  // Search exact identity first and progressively relax only when necessary.
  // This fixes families such as Lugia/Pikachu that have dozens of products.
  const exactNumberQuery=(n,num)=>n&&num?(n+' ('+num+')'):'';
  const queryVariants=[...new Set([
    exactNumberQuery(localizedAlias||base,number),
    exactNumberQuery(base,number),
    ...differentAliases.map(alias=>exactNumberQuery(alias,number)),
    [localizedAlias||base,number].filter(Boolean).join(' '),
    [base,number].filter(Boolean).join(' '),
    [localizedAlias||base,number,set].filter(Boolean).join(' '),
    [localizedAlias||base,number,setId].filter(Boolean).join(' '),
    [base,number,set].filter(Boolean).join(' '),
    ...differentAliases.flatMap(alias=>[
      [alias,number,set].filter(Boolean).join(' '),
      [alias,number].filter(Boolean).join(' ')
    ]),
    [number,set].filter(Boolean).join(' '),
    base,
    localizedAlias
  ].map(x=>String(x||'').trim()).filter(Boolean))];

  const makeInput=query=>({
    query,
    game:'pokemon',
    language,
    condition:mypCondition(wanted.condition),
    includeOffers:true,
    maxProducts:24,
    maxItems:240,
    proxyConfiguration:{useApifyProxy:true}
  });

  const collected=[];
  const seen=new Set();
  let bestLink='';
  let lastReason='not_found';
  // V15.12: exact MYP query first, then only one relaxed attempt.
  // Each call is bounded so a single card cannot monopolize the batch.
  const maxQueries=Math.max(1,Math.min(2,Number(wanted?.maxQueries)||2));
  for(const query of queryVariants.slice(0,maxQueries)){
    let items=[];
    const actorSeconds=Math.max(5,Math.min(11,Number(wanted?.timeoutSeconds)||11));
    try{items=await runActor('gio21~mypcards-scraper',makeInput(query),actorSeconds)}
    catch(error){
      lastReason=error?.code||error?.message||'apify_error';
      continue;
    }
    for(const item of items||[]){
      const key=JSON.stringify([
        itemUrl(item),itemName(item),itemNumber(item),itemEdition(item),
        itemLanguage(item),itemCondition(item),itemFinish(item),itemPrice(item)
      ]);
      if(seen.has(key))continue;
      seen.add(key);collected.push(item);
    }

    const rows=sourceRows(collected,wanted);
    if(rows.length){
      bestLink=rows.map(itemUrl).find(Boolean)||bestLink;
      const market=summarize(rows,wanted);
      if(hasMarket(market)){
        return Object.assign({
          source:'MYP Cards',provider:'Apify',link:bestLink,rows:rows.length,
          queryUsed:query,queriesTried:queryVariants.slice(0,queryVariants.indexOf(query)+1)
        },market);
      }

      // Even if the exact requested finish has no explicit offers, preserve
      // the exact product identity. The caller can read the same page and use
      // same-product fallback without rediscovering the card.
      const generic=summarize(rows,{...wanted,finish:'Normal'});
      if(hasMarket(generic)){
        return Object.assign({
          source:'MYP Cards',provider:'Apify',link:bestLink,rows:rows.length,
          queryUsed:query,queriesTried:queryVariants.slice(0,queryVariants.indexOf(query)+1),
          variantFallback:true,exactVariant:false,requestedFinish:wanted.finish
        },generic);
      }
      lastReason='no_price_data';
    }
  }

  const rows=sourceRows(collected,wanted);
  const market=summarize(rows,wanted);
  bestLink=rows.map(itemUrl).find(Boolean)||bestLink;
  return Object.assign({
    source:'MYP Cards',provider:'Apify',link:bestLink,rows:rows.length,
    queryUsed:queryVariants[0]||base,queriesTried:queryVariants.slice(0,maxQueries),
    error:rows.length?(lastReason||'no_price_data'):'not_found',
    debugRaw:collected.slice(0,5)
  },market);
}
module.exports={queryLiga,queryMyp,langMap,ligaCondition,mypCondition};

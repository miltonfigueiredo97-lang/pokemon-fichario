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
function numberFrom(v){const s=String(v||'');const m=s.match(/(\d{1,4})\s*\/\s*(\d{1,4})/);return m?String(Number(m[1]))+'/'+String(Number(m[2])):''}
function itemNumber(item){return numberFrom(pick(item,['number','collectorNumber','collector_number','cardNumber','card_number']))||numberFrom(pick(item,['name','title','cardName','card_name','productName','product_name']))}
function itemName(item){return String(pick(item,['name','cardName','card_name','title','productName','product_name'])||'')}
function itemEdition(item){return String(pick(item,['edition','set','setName','set_name','collection','expansion'])||'')}
function itemUrl(item){return String(pick(item,['url','cardUrl','card_url','productUrl','product_url','link'])||'')}
function itemCondition(item){return String(pick(item,['condition','cardCondition','card_condition','quality'])||'')}
function itemFinish(item){return String(pick(item,['finish','variant','printing','foilType','foil_type','treatment','version'])||'')}
function itemPrice(item){return money(pick(item,['price','amount','currentPrice','current_price','offerPrice','offer_price','lowestPrice','lowest_price']))}
function aggregateFields(item){
  return {
    min:money(pick(item,['min','minPrice','min_price','minimumPrice','minimum_price','lowestPrice','lowest_price'])),
    avg:money(pick(item,['avg','avgPrice','avg_price','average','averagePrice','average_price','meanPrice','mean_price'])),
    max:money(pick(item,['max','maxPrice','max_price','maximumPrice','maximum_price','highestPrice','highest_price']))
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
function identityScore(item,wanted){
  const targetName=norm(wanted.name),name=norm(itemName(item));
  const targetNumber=numberFrom(wanted.number),num=itemNumber(item);
  const targetSet=norm(wanted.set),set=norm(itemEdition(item));
  let score=0;
  if(targetName&&name){if(name===targetName)score+=450;else if(name.includes(targetName)||targetName.includes(name))score+=260;else return -1000}
  if(targetNumber&&num){if(targetNumber===num)score+=700;else if(targetNumber.split('/')[0]===num.split('/')[0])score+=260;else return -1000}
  if(targetSet&&set&&(set.includes(targetSet)||targetSet.includes(set)))score+=180;
  return score;
}
function sourceRows(items,wanted){
  const scored=(Array.isArray(items)?items:[]).map(item=>({item,score:identityScore(item,wanted)})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score);
  if(!scored.length)return[];
  const top=scored[0].score;
  return scored.filter(x=>x.score>=Math.max(300,top-120)).map(x=>x.item);
}
function filterOffers(rows,wanted){
  if(!rows.length)return {rows:[],exactVariant:false};
  const condWanted=String(wanted.condition||'').trim().toUpperCase();
  let filtered=rows;
  const rowsWithCondition=filtered.filter(x=>itemCondition(x));
  if(rowsWithCondition.length&&condWanted){
    const aliases=condWanted==='DM'?['DM','D']:condWanted==='NOVA'?['NM','M']:[condWanted];
    const byCond=rowsWithCondition.filter(x=>aliases.includes(String(itemCondition(x)).trim().toUpperCase()));
    if(byCond.length)filtered=byCond;
  }
  const rowsWithFinish=filtered.filter(x=>itemFinish(x));
  let exactVariant=false;
  if(rowsWithFinish.length){
    const byFinish=rowsWithFinish.filter(x=>finishMatch(itemFinish(x),wanted.finish)!==false);
    if(byFinish.length){filtered=byFinish;exactVariant=true}
  }
  return {rows:filtered,exactVariant};
}
function summarize(rows,wanted){
  const filtered=filterOffers(rows,wanted);
  const offers=filtered.rows;
  const explicit=offers.map(aggregateFields).find(x=>x.min||x.avg||x.max);
  if(explicit){
    return {
      min:explicit.min||explicit.avg||explicit.max,
      avg:explicit.avg||explicit.min||explicit.max,
      max:explicit.max||explicit.avg||explicit.min,
      samples:null,
      exactVariant:filtered.exactVariant
    };
  }
  const prices=offers.map(itemPrice).filter(Boolean).sort((a,b)=>a-b);
  if(!prices.length)return {min:0,avg:0,max:0,samples:0,exactVariant:filtered.exactVariant};
  return {
    min:prices[0],
    avg:prices.reduce((a,b)=>a+b,0)/prices.length,
    max:prices[prices.length-1],
    samples:prices.length,
    exactVariant:filtered.exactVariant
  };
}

async function runActor(actor,input){
  const token=process.env.APIFY_API_TOKEN;
  if(!token){const e=new Error('APIFY_API_TOKEN não configurado');e.code='apify_not_configured';throw e}
  const url=APIFY_ROOT+'/'+actor+'/run-sync-get-dataset-items?token='+encodeURIComponent(token)+'&timeout=55';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),58000);
  try{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(input),signal:controller.signal});
    const text=await r.text();
    let data=null;try{data=JSON.parse(text)}catch{}
    if(!r.ok){const e=new Error(data&&data.error&&data.error.message?data.error.message:'Apify HTTP '+r.status);e.code=r.status===401?'apify_auth':'apify_error';throw e}
    return Array.isArray(data)?data:(data&&Array.isArray(data.items)?data.items:[]);
  }finally{clearTimeout(timer)}
}

async function queryLiga(wanted){
  const input={
    query:(String(wanted.name||'')+(wanted.number?' ('+wanted.number+')':'')).trim(),
    language:langMap(wanted.lang),
    includeOffers:true,
    condition:ligaCondition(wanted.condition),
    maxProducts:6,
    maxItems:80,
    proxyConfiguration:{useApifyProxy:true,apifyProxyGroups:['RESIDENTIAL'],apifyProxyCountry:'BR'}
  };
  const items=await runActor('gio21~ligapokemon-scraper',input);
  const rows=sourceRows(items,wanted);
  const market=summarize(rows,wanted);
  const link=rows.map(itemUrl).find(Boolean)||'';
  return Object.assign({source:'Liga Pokémon',provider:'Apify',link,rows:rows.length},market);
}

async function queryMyp(wanted){
  const input={
    query:(String(wanted.name||'')+(wanted.number?' ('+wanted.number+')':'')).trim(),
    game:'pokemon',
    language:langMap(wanted.lang),
    condition:mypCondition(wanted.condition),
    includeOffers:true,
    maxProducts:6,
    maxItems:80,
    proxyConfiguration:{useApifyProxy:true}
  };
  const items=await runActor('gio21~mypcards-scraper',input);
  const rows=sourceRows(items,wanted);
  const market=summarize(rows,wanted);
  const link=rows.map(itemUrl).find(Boolean)||'';
  return Object.assign({source:'MYP Cards',provider:'Apify',link,rows:rows.length},market);
}

module.exports={queryLiga,queryMyp,langMap,ligaCondition,mypCondition};

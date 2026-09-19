const { URL } = require('url');
const { queryLiga } = require('../lib/apify-prices');

const ROOT = 'https://www.ligapokemon.com.br/';
const CACHE = globalThis.__ligaPublicCache || (globalThis.__ligaPublicCache = new Map());

function normalize(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function decodeHtml(s){return String(s||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))}
function stripTags(html){return decodeHtml(String(html||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:tr|li|p|div|section|article|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').replace(/\n{3,}/g,'\n\n').trim()}
function parseMoney(v){let s=String(v||'').replace(/R\$/gi,'').trim().replace(/\s/g,'');if(!s)return null;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?n:null}
function moneyMatches(text){return [...String(text||'').matchAll(/R\$\s*([0-9.]+(?:,[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi)].map(m=>parseMoney(m[1])).filter(v=>Number.isFinite(v)&&v>0&&v<1000000)}
function finishKind(v){const n=normalize(v);if(!n||n==='normal'||n.includes('nao foil'))return'normal';if(n.includes('master'))return'masterball';if(n.includes('poke')&&n.includes('ball'))return'pokeball';if(n.includes('reverse'))return'reverse';if(n.includes('full art'))return'fullart';if(n.includes('promo'))return'promo';if(n.includes('foil')||n.includes('holo'))return'foil';return'other'}
function lineMatchesFinish(line,finish){const kind=finishKind(finish),n=normalize(line);const hasAny=/masterball|master ball|pokeball|poke ball|reverse foil|full art|full-art|promo|foil|holo/.test(n);if(kind==='normal')return !hasAny||/\bnormal\b/.test(n);if(kind==='masterball')return /masterball|master ball/.test(n);if(kind==='pokeball')return /pokeball|poke ball/.test(n);if(kind==='reverse')return /reverse foil|reverse holo/.test(n);if(kind==='fullart')return /full art|full-art/.test(n);if(kind==='promo')return /\bpromo\b/.test(n);if(kind==='foil')return /\bfoil\b|holo/.test(n)&&!/reverse|masterball|master ball|pokeball|poke ball/.test(n);return true}
function lineMatchesCondition(line,condition){
  const raw=String(line||'').toUpperCase(),c=String(condition||'').toUpperCase().trim();
  if(!c||c==='NOVA')return /\b(?:M|NM)\b|QUASE NOVA|NOVA/.test(raw)||!/\b(?:M|NM|SP|MP|HP|DM|D)\b/.test(raw);
  const aliases=c==='DM'?['DM','D']:c==='D'?['D','DM']:[c];
  return aliases.some(x=>new RegExp('\\b'+x.replace(/[^A-Z]/g,'')+'\\b').test(raw));
}
function hasAnyMarket(m){return !!(m&&(Number(m.min)||Number(m.avg)||Number(m.max)))}
function completeMarket(m){return !!(m&&Number(m.min)>0&&Number(m.avg)>0&&Number(m.max)>0)}
function mergeMarket(preferred,fallback){
  const a=preferred||{},b=fallback||{};
  const min=Number(a.min||b.min||0),avg=Number(a.avg||b.avg||0),max=Number(a.max||b.max||0);
  return {min,avg,max,samples:a.samples??b.samples??null,exactVariant:a.exactVariant===true||(a.exactVariant==null&&b.exactVariant===true),complete:!!(min&&avg&&max)};
}

async function fetchJina(target,timeout=18000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch('https://r.jina.ai/'+target,{headers:{'Accept':'text/plain','X-Timeout':'12','X-Engine':'browser','X-No-Cache':'true'},signal:controller.signal});
    const text=await r.text();
    if(!r.ok){const e=new Error('Jina HTTP '+r.status);e.code='jina_http';throw e}
    if(/just a moment|performing security verification|cf-chl|cloudflare/i.test(text)){
      const e=new Error('Cloudflare bloqueou a leitura da Liga');e.code='cloudflare_blocked';throw e;
    }
    return text;
  }finally{clearTimeout(timer)}
}
async function fetchPage(url,timeout=11000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{'Accept':'text/html,application/xhtml+xml,*/*;q=.8','Accept-Language':'pt-BR,pt;q=.9,en;q=.6','User-Agent':'Mozilla/5.0 (compatible; PokemonBinderBR/12.7; +https://pokemon-fichario.vercel.app)'},redirect:'follow',signal:controller.signal});
    const html=await r.text();
    if(r.ok&&!/just a moment|cf-chl|cloudflare/i.test(html))return{html,url:r.url};
    if(r.status===403||/just a moment|cf-chl|cloudflare/i.test(html)){
      try{return{html:await fetchJina(url),url}}catch{}
      const e=new Error('Cloudflare bloqueou a leitura direta');e.code='cloudflare_blocked';throw e;
    }
    if(!r.ok){const e=new Error('HTTP '+r.status);e.code='upstream_http';throw e}
    return{html,url:r.url};
  }finally{clearTimeout(timer)}
}
function absUrl(href,base){try{const u=new URL(decodeHtml(href),base||ROOT);if(!/(^|\.)ligapokemon\.com\.br$/i.test(u.hostname))return'';return u.toString()}catch{return''}}
function candidateLinks(html,base,name,number){
  const out=[];const wn=normalize(name),num=String(number||'').split('/')[0],raw=String(html||'');
  for(const m of raw.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const href=absUrl(m[1],base);if(!href)continue;const text=normalize(stripTags(m[2]));
    if((wn&&text.includes(wn))||(num&&text.includes(num))){if(!/view=cards\/search/i.test(href))out.push(href)}
  }
  for(const m of raw.matchAll(/\[([^\]]{1,180})\]\((https?:\/\/[^)]+)\)/g)){
    const href=absUrl(m[2],base);if(!href)continue;const text=normalize(m[1]);
    if((wn&&text.includes(wn))||(num&&text.includes(num))){if(!/view=cards\/search/i.test(href))out.push(href)}
  }
  return[...new Set(out)].slice(0,8)
}
function identityScore(text,name,number,set){
  const n=normalize(text),wn=normalize(name),parts=String(number||'').replace(/\s/g,'').split('/'),ws=normalize(set);
  let s=0;
  if(wn&&n.includes(wn))s+=300;
  if(parts[0]&&new RegExp('\\b0*'+Number(parts[0])+'\\s*\\/').test(n))s+=320;
  if(parts[1]&&new RegExp('\\/\\s*0*'+Number(parts[1])+'\\b').test(n))s+=220;
  if(ws&&n.includes(ws))s+=180;
  return s;
}
function labeled(text,re){const m=String(text||'').match(re);return m?parseMoney(m[1]):null}
function extractMarket(text,finish,condition){
  const minLabel=labeled(text,/(?:menor|m[ií]nimo)[^\nR$]{0,45}R\$\s*([0-9.,]+)/i);
  const avgLabel=labeled(text,/(?:m[eé]dio|m[eé]dia|pre[cç]o\s*m[eé]dio)[^\nR$]{0,45}R\$\s*([0-9.,]+)/i);
  const maxLabel=labeled(text,/(?:maior|m[aá]ximo)[^\nR$]{0,45}R\$\s*([0-9.,]+)/i);
  if(minLabel&&avgLabel&&maxLabel)return{min:minLabel,avg:avgLabel,max:maxLabel,samples:null,exactVariant:true};

  const lines=String(text||'').split(/\n+/).map(x=>x.trim()).filter(x=>x.includes('R$'));
  const byCondition=lines.filter(x=>lineMatchesCondition(x,condition));
  const exact=byCondition.filter(x=>lineMatchesFinish(x,finish));
  let chosen=[];
  let exactVariant=false;
  // Se existe ao menos uma oferta que corresponde ao acabamento + condição,
  // respeitamos essa variante estritamente. Uma única oferta gera apenas mínimo;
  // não misturamos anúncios de outro acabamento para fabricar média/máximo.
  if(exact.length){chosen=exact;exactVariant=true}
  else if(byCondition.length){chosen=byCondition}
  else{
    const byFinish=lines.filter(x=>lineMatchesFinish(x,finish));
    chosen=byFinish.length?byFinish:lines;
    exactVariant=byFinish.length>=2;
  }

  const prices=chosen.flatMap(moneyMatches).filter(Number.isFinite).sort((a,b)=>a-b);
  if(prices.length>=2)return{min:prices[0],avg:prices.reduce((a,b)=>a+b,0)/prices.length,max:prices[prices.length-1],samples:prices.length,exactVariant};
  if(prices.length===1)return{min:prices[0],avg:avgLabel||0,max:maxLabel||0,samples:1,exactVariant};

  // Labels independentes continuam independentes: não copiar mínimo para média.
  if(minLabel||avgLabel||maxLabel)return{min:minLabel||0,avg:avgLabel||0,max:maxLabel||0,samples:null,exactVariant:false};

  const all=moneyMatches(text).sort((a,b)=>a-b);
  if(!all.length)return{min:0,avg:0,max:0,samples:0,exactVariant:false};
  if(all.length===1)return{min:all[0],avg:0,max:0,samples:1,exactVariant:false};
  return{min:all[0],avg:all.reduce((a,b)=>a+b,0)/all.length,max:all[all.length-1],samples:all.length,exactVariant:false};
}

async function resolve({name,number,set,finish,condition}){
  const q=number?`${name} (${number})`:name;
  const search=new URL(ROOT);search.searchParams.set('view','cards/search');search.searchParams.set('card',q);
  const first=await fetchPage(search.toString());
  const docs=[first];
  for(const link of candidateLinks(first.html,first.url,name,number)){try{docs.push(await fetchPage(link))}catch{}}
  let best=null;
  for(const d of docs){
    const text=stripTags(d.html),score=identityScore(text,name,number,set);
    if(score<300)continue;
    const market=extractMarket(text,finish,condition);
    const cand={url:d.url,text,market,score:score+(market.samples||0)};
    if(!best||cand.score>best.score)best=cand;
  }
  return best;
}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=1200, stale-while-revalidate=14400');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});

  const name=String(req.query.name||'').trim();
  const number=String(req.query.number||'').trim();
  const finish=String(req.query.finish||'').trim();
  const condition=String(req.query.condition||'').trim();
  const set=String(req.query.set||'').trim();
  const lang=String(req.query.lang||'').trim();
  if(!name)return res.status(400).json({ok:false,error:'name_required'});

  const apifyConfigured=!!process.env.APIFY_API_TOKEN;
  let apifyFound=null,apifyError='';
  if(apifyConfigured){
    try{
      const found=await queryLiga({name,number,set,lang,finish,condition});
      if(hasAnyMarket(found))apifyFound=found;
      if(completeMarket(found)){
        return res.status(200).json({
          ok:true,source:'Liga Pokémon',provider:'Apify',name,number,finish,condition,
          link:found.link||'',min:Number(found.min||0),avg:Number(found.avg||0),max:Number(found.max||0),
          samples:found.samples??null,exactVariant:found.exactVariant!==false,complete:true,checkedAt:new Date().toISOString()
        });
      }
    }catch(error){
      apifyError=error?.code||error?.message||'apify_error';
      console.warn('Liga Apify falhou; usando fallback Reader:',apifyError);
    }
  }

  const key=[normalize(name),number,normalize(set),normalize(lang),normalize(finish),condition.toUpperCase()].join('|');
  const cached=CACHE.get(key);if(cached&&cached.expires>Date.now())return res.status(200).json(cached.value);
  try{
    const found=await resolve({name,number,set,finish,condition});
    if(!found){
      if(apifyFound){
        const partial=mergeMarket(apifyFound,null);
        const out={ok:true,source:'Liga Pokémon',provider:'Apify',name,number,finish,condition,link:apifyFound.link||'',...partial,checkedAt:new Date().toISOString()};
        CACHE.set(key,{value:out,expires:Date.now()+8*60*1000});
        return res.status(200).json(out);
      }
      const out={
        ok:false,
        error:apifyConfigured?'not_found':'price_connector_unavailable',
        connector:'Apify',
        apifyConfigured,
        apifyError,
        needsApifyToken:!apifyConfigured,
        message:apifyConfigured
          ?'O conector Apify não encontrou a carta na Liga.'
          :'Liga bloqueia leitura automática; configure APIFY_API_TOKEN.'
      };
      CACHE.set(key,{value:out,expires:Date.now()+3*60*1000});
      return res.status(200).json(out);
    }
    const market=mergeMarket(found.market,apifyFound);
    if(!hasAnyMarket(market)){
      const out={ok:false,error:'no_price_data',source:'Liga Pokémon',provider:apifyFound?'Reader + Apify':'Reader',connector:'Apify',apifyConfigured,apifyError,needsApifyToken:!apifyConfigured,message:'A Liga respondeu sem cotação utilizável para esta carta/variante.'};
      CACHE.set(key,{value:out,expires:Date.now()+3*60*1000});
      return res.status(200).json(out);
    }
    const out={ok:true,source:'Liga Pokémon',provider:apifyFound?'Reader + Apify':'Reader',name,number,finish,condition,link:found.url,...market,checkedAt:new Date().toISOString()};
    CACHE.set(key,{value:out,expires:Date.now()+25*60*1000});
    return res.status(200).json(out);
  }catch(error){
    if(apifyFound){
      const partial=mergeMarket(apifyFound,null);
      return res.status(200).json({ok:true,source:'Liga Pokémon',provider:'Apify',name,number,finish,condition,link:apifyFound.link||'',...partial,checkedAt:new Date().toISOString()});
    }
    const code=error?.code==='cloudflare_blocked'?'cloudflare_blocked':(error?.name==='AbortError'?'timeout':'upstream_error');
    return res.status(200).json({ok:false,error:code,connector:'Apify',apifyConfigured,apifyError,needsApifyToken:!apifyConfigured,message:code==='cloudflare_blocked'?'Liga bloqueou a leitura automática direta via Cloudflare.':'Não foi possível consultar a Liga Pokémon agora.'});
  }
}
module.exports.config={maxDuration:60};

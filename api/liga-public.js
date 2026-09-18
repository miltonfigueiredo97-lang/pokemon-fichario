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
function lineMatchesCondition(line,condition){const c=String(condition||'').toUpperCase().trim();if(!c||c==='NOVA')return /\bNM\b|QUASE NOVA|NOVA/.test(String(line||'').toUpperCase())||!/\b(?:NM|SP|MP|HP|DM)\b/.test(String(line||'').toUpperCase());return new RegExp(`\\b${c.replace(/[^A-Z]/g,'')}\\b`).test(String(line||'').toUpperCase())}

async function fetchJina(target,timeout=18000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch('https://r.jina.ai/'+target,{headers:{'Accept':'text/plain','X-Timeout':'12','X-Engine':'browser','X-No-Cache':'true'},signal:controller.signal});
    const text=await r.text();
    if(!r.ok){const e=new Error('Jina HTTP '+r.status);e.code='jina_http';throw e}
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
function identityScore(text,name,number){const n=normalize(text),wn=normalize(name),parts=String(number||'').replace(/\s/g,'').split('/');let s=0;if(wn&&n.includes(wn))s+=300;if(parts[0]&&new RegExp(`\\b0*${Number(parts[0])}\\s*\\/`).test(n))s+=320;if(parts[1]&&new RegExp(`\\/\\s*0*${Number(parts[1])}\\b`).test(n))s+=220;return s}
function labeled(text,re){const m=String(text||'').match(re);return m?parseMoney(m[1]):null}
function extractMarket(text,finish,condition){const minLabel=labeled(text,/(?:menor|m[ií]nimo)[^\nR$]{0,45}R\$\s*([0-9.,]+)/i);const avgLabel=labeled(text,/(?:m[eé]dio|m[eé]dia|pre[cç]o\s*m[eé]dio)[^\nR$]{0,45}R\$\s*([0-9.,]+)/i);const maxLabel=labeled(text,/(?:maior|m[aá]ximo)[^\nR$]{0,45}R\$\s*([0-9.,]+)/i);if(minLabel&&avgLabel&&maxLabel&&!finish)return{min:minLabel,avg:avgLabel,max:maxLabel,samples:null};
  const lines=String(text||'').split(/\n+/).map(x=>x.trim()).filter(x=>x.includes('R$'));
  let chosen=lines.filter(x=>lineMatchesFinish(x,finish)&&lineMatchesCondition(x,condition));
  if(!chosen.length)chosen=lines.filter(x=>lineMatchesFinish(x,finish));
  const prices=chosen.flatMap(moneyMatches).filter(Number.isFinite).sort((a,b)=>a-b);
  if(prices.length){return{min:prices[0],avg:prices.reduce((a,b)=>a+b,0)/prices.length,max:prices[prices.length-1],samples:prices.length}}
  if(minLabel||avgLabel||maxLabel)return{min:minLabel||0,avg:avgLabel||minLabel||maxLabel||0,max:maxLabel||0,samples:null};
  const all=moneyMatches(text).sort((a,b)=>a-b);if(!all.length)return{min:0,avg:0,max:0,samples:0};return{min:all[0],avg:all.reduce((a,b)=>a+b,0)/all.length,max:all[all.length-1],samples:all.length};
}

async function resolve({name,number,finish,condition}){const q=number?`${name} (${number})`:name;const search=new URL(ROOT);search.searchParams.set('view','cards/search');search.searchParams.set('card',q);const first=await fetchPage(search.toString());const docs=[first];for(const link of candidateLinks(first.html,first.url,name,number)){try{docs.push(await fetchPage(link))}catch{}}
  let best=null;for(const d of docs){const text=stripTags(d.html);const score=identityScore(text,name,number);if(score<300)continue;const market=extractMarket(text,finish,condition);const cand={url:d.url,text,market,score:score+(market.samples||0)};if(!best||cand.score>best.score)best=cand}return best}

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

  if(process.env.APIFY_API_TOKEN){
    try{
      const found=await queryLiga({name,number,set,lang,finish,condition});
      if(found&&(found.min||found.avg||found.max)){
        return res.status(200).json({
          ok:true,source:'Liga Pokémon',provider:'Apify',name,number,finish,condition,
          link:found.link||'',min:Number(found.min||0),avg:Number(found.avg||0),max:Number(found.max||0),
          samples:found.samples??null,exactVariant:found.exactVariant!==false,checkedAt:new Date().toISOString()
        });
      }
      return res.status(200).json({ok:false,error:'not_found',provider:'Apify',message:'Carta/variante não localizada na Liga Pokémon.'});
    }catch(error){
      return res.status(200).json({ok:false,error:error?.code||'apify_error',provider:'Apify',message:'O conector da Liga não conseguiu concluir a consulta.'});
    }
  }

  const key=[normalize(name),number,normalize(finish),condition.toUpperCase()].join('|');
  const cached=CACHE.get(key);if(cached&&cached.expires>Date.now())return res.status(200).json(cached.value);
  try{
    const found=await resolve({name,number,finish,condition});
    if(!found){
      const out={ok:false,error:'not_found',message:'Carta/variante não localizada na Liga.'};
      CACHE.set(key,{value:out,expires:Date.now()+8*60*1000});return res.status(200).json(out);
    }
    const out={ok:true,source:'Liga Pokémon',provider:'direct',name,number,finish,condition,link:found.url,min:Number(found.market.min||0),avg:Number(found.market.avg||0),max:Number(found.market.max||0),samples:found.market.samples??null,checkedAt:new Date().toISOString()};
    CACHE.set(key,{value:out,expires:Date.now()+25*60*1000});return res.status(200).json(out);
  }catch(error){
    const code=error?.code==='cloudflare_blocked'?'cloudflare_blocked':(error?.name==='AbortError'?'timeout':'upstream_error');
    return res.status(200).json({ok:false,error:code,needsApifyToken:code==='cloudflare_blocked',message:code==='cloudflare_blocked'?'Liga bloqueou a leitura automática direta via Cloudflare.':'Não foi possível consultar a Liga Pokémon agora.'});
  }
}
module.exports.config={maxDuration:60};

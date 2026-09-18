const { URL } = require('url');
const { queryMyp } = require('../lib/apify-prices');
const { scrapeMypBrowser } = require('../lib/myp-browser');

const ROOT = 'https://mypcards.com';
const CACHE = globalThis.__mypPublicCache || (globalThis.__mypPublicCache = new Map());

function normalize(value){return String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function slugify(value){return normalize(value).replace(/\s+/g,'-')}
function decodeHtml(text){return String(text||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))}
function stripTags(html){return decodeHtml(String(html||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|li|tr|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').replace(/\n{3,}/g,'\n\n').trim()}
function parseMoney(value){const raw=String(value||'').replace(/R\$/gi,'').trim();if(!raw)return null;let n=raw.replace(/\s/g,'');if(n.includes(','))n=n.replace(/\./g,'').replace(',','.');const v=Number(n);return Number.isFinite(v)?v:null}
function moneyMatches(text){return[...String(text||'').matchAll(/R\$\s*([0-9.]+(?:,[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi)].map(m=>parseMoney(m[1])).filter(v=>Number.isFinite(v)&&v>0&&v<1000000)}
function xmlLocs(xml){
  const text=String(xml||'');
  const out=[...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m=>decodeHtml(m[1].trim()));
  for(const m of text.matchAll(/https?:\/\/[^\s<>)\]"']+/gi)){
    const u=decodeHtml(m[0].replace(/[.,;]+$/,''));
    if(/mypcards\.com/i.test(u))out.push(u);
  }
  return [...new Set(out)];
}

function finishKind(v){const n=normalize(v);if(!n||n==='normal'||n.includes('nao foil'))return'normal';if(n.includes('master'))return'masterball';if(n.includes('poke')&&n.includes('ball'))return'pokeball';if(n.includes('reverse'))return'reverse';if(n.includes('full art'))return'fullart';if(n.includes('promo'))return'promo';if(n.includes('foil')||n.includes('holo'))return'foil';return'other'}
function lineMatchesFinish(line,finish){const kind=finishKind(finish),n=normalize(line);const hasAny=/masterball|master ball|pokeball|poke ball|reverse foil|full art|full-art|promo|foil|holo/.test(n);if(kind==='normal')return !hasAny||/\bnormal\b/.test(n);if(kind==='masterball')return /masterball|master ball/.test(n);if(kind==='pokeball')return /pokeball|poke ball/.test(n);if(kind==='reverse')return /reverse foil|reverse holo/.test(n);if(kind==='fullart')return /full art|full-art/.test(n);if(kind==='promo')return /\bpromo\b/.test(n);if(kind==='foil')return /\bfoil\b|holo/.test(n)&&!/reverse|masterball|master ball|pokeball|poke ball/.test(n);return true}
function lineMatchesCondition(line,condition){const c=String(condition||'').toUpperCase().trim();if(!c||c==='NOVA')return /\bNM\b|QUASE NOVA|NOVA/.test(String(line||'').toUpperCase())||!/\b(?:NM|SP|MP|HP|DM)\b/.test(String(line||'').toUpperCase());return new RegExp(`\\b${c.replace(/[^A-Z]/g,'')}\\b`).test(String(line||'').toUpperCase())}

function hasAnyMarket(m){return !!(m&&(Number(m.min)||Number(m.avg)||Number(m.max)))}
function completeMarket(m){return !!(m&&Number(m.min)>0&&Number(m.avg)>0&&Number(m.max)>0)}
function mergeMarket(preferred,fallback){
  const a=preferred||{},b=fallback||{};
  const min=Number(a.min||b.min||0),avg=Number(a.avg||b.avg||0),max=Number(a.max||b.max||0);
  return {
    min,avg,max,
    samples:a.samples??b.samples??null,
    availableQuantity:a.availableQuantity??b.availableQuantity??null,
    exactVariant:a.exactVariant===true||(a.exactVariant==null&&b.exactVariant===true),
    complete:!!(min&&avg&&max)
  };
}

async function fetchJina(target,timeout=18000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const url='https://r.jina.ai/'+target;
    const r=await fetch(url,{headers:{'Accept':'text/plain','X-Timeout':'12','X-Engine':'browser','X-No-Cache':'true'},signal:controller.signal});
    const text=await r.text();
    if(!r.ok){const e=new Error('Jina HTTP '+r.status);e.code='jina_http';throw e}
    return text;
  }finally{clearTimeout(timer)}
}
async function fetchText(url,timeout=9000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{headers:{'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'pt-BR,pt;q=.9,en;q=.6','User-Agent':'Mozilla/5.0 (compatible; PokemonBinderBR/12.7; +https://pokemon-fichario.vercel.app)'},redirect:'follow',signal:controller.signal});
    const html=await response.text();
    if(response.ok&&!/just a moment|cf-chl|cloudflare/i.test(html))return html;
    if(response.status===403||/just a moment|cf-chl|cloudflare/i.test(html)){
      try{return await fetchJina(url)}catch{}
      const e=new Error('Cloudflare bloqueou a leitura direta');e.code='cloudflare_blocked';throw e;
    }
    if(!response.ok){const e=new Error('HTTP '+response.status);e.code='upstream_http';throw e}
    return html;
  }finally{clearTimeout(timer)}
}
function safeMypProductUrl(value){try{const u=new URL(String(value||''));if(!/(^|\.)mypcards\.com$/i.test(u.hostname))return'';if(!/^\/pokemon\/produto\/\d+\//i.test(u.pathname))return'';return`${u.protocol}//${u.host}${u.pathname}`}catch{return''}}

async function sitemapCandidates(name){const key=`sitemap:${slugify(name)}`,cached=CACHE.get(key);if(cached&&cached.expires>Date.now())return cached.value;const wantedSlug=slugify(name),matches=[];let root;try{root=await fetchText(`${ROOT}/sitemap.xml`,12000)}catch(error){if(error?.code==='cloudflare_blocked')throw error;return[]}const first=xmlLocs(root);const accept=url=>{if(!/\/pokemon\/produto\/\d+\//i.test(url))return;const slug=url.split('/').filter(Boolean).pop()||'';if(!wantedSlug||slug===wantedSlug||slug.includes(wantedSlug)||wantedSlug.includes(slug))matches.push(url)};first.forEach(accept);if(!matches.length){const childMaps=first.filter(x=>/\.xml(?:\?|$)/i.test(x));const preferred=[...childMaps.filter(x=>/pokemon|produto|product|card/i.test(x)),...childMaps.filter(x=>!/pokemon|produto|product|card/i.test(x))].slice(0,18);for(const mapUrl of preferred){try{const xml=await fetchText(mapUrl,12000);xmlLocs(xml).forEach(accept);if(matches.length>=18)break}catch{}}}const unique=[...new Set(matches)].slice(0,18);CACHE.set(key,{value:unique,expires:Date.now()+6*60*60*1000});return unique}

function pageIdentity(html){const text=stripTags(html);const titleMatch=text.match(/(?:^|\n)\s*([^\n]{1,120}?)\s*\((\d{1,4}\s*\/\s*\d{1,4})\)\s*(?:\n|$)/m);const codeMatch=text.match(/Código\s+([^\n]+)/i),editionMatch=text.match(/Edição\s+([^\n]+)/i);return{text,name:titleMatch?titleMatch[1].trim():'',number:titleMatch?titleMatch[2].replace(/\s/g,''):'',code:codeMatch?codeMatch[1].trim():'',edition:editionMatch?editionMatch[1].trim():''}}
function matchesWanted(identity,wanted){const wn=normalize(wanted.name),pn=normalize(identity.name);if(wn&&pn&&wn!==pn&&!pn.includes(wn)&&!wn.includes(pn))return false;const wantedNumber=String(wanted.number||'').replace(/\s/g,'');if(wantedNumber&&identity.number){const[a,ad]=wantedNumber.split('/'),[b,bd]=identity.number.split('/');if(String(Number(a))!==String(Number(b)))return false;if(ad&&bd&&String(Number(ad))!==String(Number(bd)))return false}return true}

function extractMarket(identity,finish,condition){
  const text=identity.text;
  let sellerText=text;
  const sellerStart=text.search(/Lojistas e Certificados|Demais vendedores/i);
  if(sellerStart>=0)sellerText=text.slice(sellerStart);
  const other=sellerText.search(/Outras Edições/i);
  if(other>=0)sellerText=sellerText.slice(0,other);
  const lines=sellerText.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const priceLines=lines.filter(x=>x.includes('R$'));

  // A página do produto já identifica a carta. O campo de acabamento dos
  // anúncios é preenchido de forma inconsistente pelos vendedores; exigir
  // esse texto em todos os anúncios fazia uma única oferta representar todo
  // o mercado. Usamos acabamento exato quando há amostra suficiente e,
  // caso contrário, a condição da carta dentro da mesma página do produto.
  const byCondition=priceLines.filter(x=>lineMatchesCondition(x,condition));
  const exact=byCondition.filter(x=>lineMatchesFinish(x,finish));
  let selected=[];
  let exactVariant=false;
  // Se existe ao menos uma oferta que corresponde ao acabamento + condição,
  // respeitamos essa variante estritamente. Uma única oferta gera apenas mínimo;
  // não misturamos anúncios de outro acabamento para fabricar média/máximo.
  if(exact.length){selected=exact;exactVariant=true}
  else if(byCondition.length){selected=byCondition}
  else{
    const byFinish=priceLines.filter(x=>lineMatchesFinish(x,finish));
    selected=byFinish.length?byFinish:priceLines;
    exactVariant=byFinish.length>=2;
  }

  const usable=selected.flatMap(moneyMatches)
    .filter(v=>Number.isFinite(v)&&v>0&&v<1000000)
    .sort((a,b)=>a-b);
  const quantities=selected.flatMap(x=>[...x.matchAll(/(\d+)\s*un\./gi)].map(m=>Number(m[1]))).filter(Number.isFinite);
  const availableQuantity=quantities.reduce((a,b)=>a+b,0)||null;

  if(usable.length>=2){
    return{min:usable[0],avg:usable.reduce((a,b)=>a+b,0)/usable.length,max:usable[usable.length-1],availableQuantity,samples:usable.length,exactVariant};
  }
  if(usable.length===1){
    // Uma oferta só informa mínimo; não existe média/máximo confiável.
    return{min:usable[0],avg:0,max:0,availableQuantity,samples:1,exactVariant};
  }

  const beforeSellers=sellerStart>=0?text.slice(0,sellerStart):text;
  const summary=moneyMatches(beforeSellers).filter(v=>v>0).slice(0,3).sort((a,b)=>a-b);
  if(summary.length>=3)return{min:summary[0],avg:summary[1],max:summary[summary.length-1],availableQuantity,samples:null,exactVariant:false};
  if(summary.length)return{min:summary[0]||0,avg:summary[1]||0,max:summary[2]||0,availableQuantity,samples:null,exactVariant:false};
  return{min:0,avg:0,max:0,availableQuantity,samples:0,exactVariant:false};
}

async function resolvePage({name,number,set,link,lang,finish,condition}){const direct=safeMypProductUrl(link),urls=direct?[direct]:await sitemapCandidates(name);let best=null;for(const url of urls){try{const html=await fetchText(url),identity=pageIdentity(html);if(!matchesWanted(identity,{name,number,set}))continue;const market=extractMarket(identity,finish,condition),wantedNumber=String(number||'').replace(/\s/g,''),wantedSet=normalize(set),edition=normalize(identity.edition),code=normalize(identity.code),langNorm=normalize(lang);let score=0;if(identity.number===wantedNumber)score+=1000;else if(wantedNumber&&identity.number&&String(Number(identity.number.split('/')[0]))===String(Number(wantedNumber.split('/')[0])))score+=420;if(normalize(identity.name)===normalize(name))score+=350;if(wantedSet&&(edition.includes(wantedSet)||wantedSet.includes(edition)||code.includes(wantedSet)))score+=280;const japanese=/japones|japanese|sv2a/.test(`${edition} ${code}`);if(langNorm==='ja'&&japanese)score+=220;if(langNorm&&langNorm!=='ja'&&japanese)score-=260;score+=(market.samples||0);const candidate={url,identity,market,score};if(!best||candidate.score>best.score)best=candidate;if(score>=1000&&market.samples)break}catch{}}return best}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=1200, stale-while-revalidate=14400');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});

  const name=String(req.query.name||'').trim();
  const number=String(req.query.number||'').trim();
  const set=String(req.query.set||'').trim();
  const link=String(req.query.link||'').trim();
  const lang=String(req.query.lang||'').trim();
  const finish=String(req.query.finish||'Normal').trim();
  const condition=String(req.query.condition||'NM').trim();
  if(!name)return res.status(400).json({ok:false,error:'name_required'});

  // Fonte principal gratuita: abrir a página pública real em Chromium.
  // O fetch HTTP simples é bloqueado pelo Cloudflare, mas o navegador real
  // executa o desafio e enxerga as mesmas ofertas exibidas ao usuário.
  const directLink=safeMypProductUrl(link);
  if(directLink){
    const browserKey='browser:'+normalize(name)+'|'+number+'|'+normalize(finish)+'|'+String(condition||'').toUpperCase()+'|'+directLink;
    const browserCached=CACHE.get(browserKey);
    if(browserCached&&browserCached.expires>Date.now())return res.status(200).json(browserCached.value);
    try{
      const market=await scrapeMypBrowser(directLink,{name,number,set,lang,finish,condition});
      if(market?.ok&&hasAnyMarket(market)){
        const out={
          ok:true,
          source:'MYP Cards',
          provider:'Chromium',
          mode:'browser-page',
          name,
          number,
          edition:set,
          finish,
          condition,
          link:directLink,
          min:Number(market.min||0),
          avg:Number(market.avg||0),
          max:Number(market.max||0),
          samples:market.samples??null,
          availableQuantity:market.availableQuantity??null,
          exactVariant:true,
          complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
          checkedAt:new Date().toISOString()
        };
        CACHE.set(browserKey,{value:out,expires:Date.now()+10*60*1000});
        return res.status(200).json(out);
      }
      if(market?.error==='variant_not_found'||market?.error==='wrong_product'){
        const out={
          ok:false,
          error:market.error,
          source:'MYP Cards',
          provider:'Chromium',
          mode:'browser-page',
          link:directLink,
          message:market.error==='variant_not_found'
            ?'A página foi lida, mas não há oferta com este acabamento + condição.'
            :'O link salvo não corresponde à carta consultada.'
        };
        CACHE.set(browserKey,{value:out,expires:Date.now()+3*60*1000});
        return res.status(200).json(out);
      }
      console.warn('MYP Chromium falhou; tentando fallbacks:',market?.error||'unknown');
    }catch(error){
      console.warn('MYP Chromium lançou erro; tentando fallbacks:',error?.message||error);
    }
  }

  const apifyConfigured=!!process.env.APIFY_API_TOKEN;
  let apifyFound=null,apifyError='';
  if(apifyConfigured){
    try{
      const found=await queryMyp({name,number,set,lang,finish,condition});
      if(hasAnyMarket(found))apifyFound=found;
      if(completeMarket(found)){
        return res.status(200).json({
          ok:true,source:'MYP Cards',provider:'Apify',mode:'apify',
          name,number,edition:set,finish,condition,link:found.link||'',
          min:Number(found.min||0),avg:Number(found.avg||0),max:Number(found.max||0),
          samples:found.samples??null,exactVariant:found.exactVariant!==false,complete:true,checkedAt:new Date().toISOString()
        });
      }
    }catch(error){
      apifyError=error?.code||error?.message||'apify_error';
      console.warn('MYP Apify falhou; usando fallback Reader:',apifyError);
    }
  }

  const cacheKey='market:'+normalize(name)+'|'+number+'|'+normalize(set)+'|'+normalize(lang)+'|'+normalize(finish)+'|'+condition.toUpperCase()+'|'+safeMypProductUrl(link);
  const cached=CACHE.get(cacheKey);if(cached&&cached.expires>Date.now())return res.status(200).json(cached.value);
  try{
    const found=await resolvePage({name,number,set,link,lang,finish,condition});
    if(!found){
      if(apifyFound){
        const partial=mergeMarket(apifyFound,null);
        const out={ok:true,source:'MYP Cards',provider:'Apify',mode:'apify-partial',name,number,edition:set,finish,condition,link:apifyFound.link||'',...partial,checkedAt:new Date().toISOString()};
        CACHE.set(cacheKey,{value:out,expires:Date.now()+8*60*1000});
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
          ?'O conector Apify não encontrou a carta na MYP.'
          :'MYP bloqueia leitura automática; configure APIFY_API_TOKEN ou MYPCARDS_API_TOKEN.'
      };
      CACHE.set(cacheKey,{value:out,expires:Date.now()+3*60*1000});
      return res.status(200).json(out);
    }
    const market=mergeMarket(found.market,apifyFound);
    if(!hasAnyMarket(market)){
      const out={ok:false,error:'no_price_data',source:'MYP Cards',provider:apifyFound?'Reader + Apify':'Reader',connector:'Apify',apifyConfigured,apifyError,needsApifyToken:!apifyConfigured,message:'A MYP respondeu sem cotação utilizável para esta carta/variante.'};
      CACHE.set(cacheKey,{value:out,expires:Date.now()+3*60*1000});
      return res.status(200).json(out);
    }
    const out={ok:true,source:'MYP Cards',provider:apifyFound?'Reader + Apify':'Reader',mode:'public-page',name:found.identity.name||name,number:found.identity.number||number,edition:found.identity.edition||set,finish,condition,link:found.url,...market,checkedAt:new Date().toISOString()};
    CACHE.set(cacheKey,{value:out,expires:Date.now()+25*60*1000});
    return res.status(200).json(out);
  }catch(error){
    if(apifyFound){
      const partial=mergeMarket(apifyFound,null);
      return res.status(200).json({ok:true,source:'MYP Cards',provider:'Apify',mode:'apify-partial',name,number,edition:set,finish,condition,link:apifyFound.link||'',...partial,checkedAt:new Date().toISOString()});
    }
    const code=error?.code==='cloudflare_blocked'?'cloudflare_blocked':(error?.name==='AbortError'?'timeout':'upstream_error');
    return res.status(200).json({ok:false,error:code,connector:'Apify',apifyConfigured,apifyError,needsApifyToken:!apifyConfigured,message:code==='cloudflare_blocked'?'MYP bloqueou a leitura automática direta via Cloudflare.':'Não foi possível consultar a página pública da MYP agora.'});
  }
}
module.exports.config={maxDuration:60};

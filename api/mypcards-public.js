const { URL } = require('url');
const { queryMyp } = require('../lib/apify-prices');
const { findAndScrapeMypBrowser } = require('../lib/myp-browser');

const ROOT = 'https://mypcards.com';
const CACHE = globalThis.__mypPublicCache || (globalThis.__mypPublicCache = new Map());

function normalize(value){return String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function slugify(value){
  return normalize(String(value||'')
    .replace(/♀/g,' femea ')
    .replace(/♂/g,' macho '))
    .replace(/\s+/g,'-')
}
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

function finishKind(v){const n=normalize(v);if(!n||n==='normal'||n.includes('nao foil'))return'normal';if(n.includes('altered')&&n.includes('art'))return'alteredart';if(n.includes('master'))return'masterball';if(n.includes('poke')&&n.includes('ball'))return'pokeball';if(n.includes('reverse'))return'reverse';if(n.includes('full art')||n.includes('full-art'))return'normal';if(n.includes('promo'))return'normal';if(n.includes('foil')||n.includes('holo'))return'foil';return'other'}
function lineMatchesFinish(line,finish){const kind=finishKind(finish),n=normalize(line);if(/altered art|altered-art/.test(n)&&kind!=='alteredart')return false;const hasSurface=/masterball|master ball|pokeball|poke ball|reverse foil|reverse holo|\bfoil\b|holo/.test(n);if(kind==='normal')return !hasSurface||/\bnormal\b/.test(n);if(kind==='alteredart')return /altered art|altered-art/.test(n);if(kind==='masterball')return /masterball|master ball/.test(n);if(kind==='pokeball')return /pokeball|poke ball/.test(n);if(kind==='reverse')return /reverse foil|reverse holo/.test(n);if(kind==='foil')return /\bfoil\b|holo/.test(n)&&!/reverse|masterball|master ball|pokeball|poke ball/.test(n);return true}
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

async function resolveNameAliases(name,apiId){
  const aliases=[String(name||'').trim()].filter(Boolean);
  const key='name-aliases:v1475:'+String(apiId||'').trim();
  const cached=CACHE.get(key);
  if(cached&&cached.expires>Date.now())return [...new Set([...aliases,...cached.value])];
  if(apiId){
    const rows=await Promise.all(['pt-br','en'].map(async locale=>{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),3500);
      try{
        const r=await fetch('https://api.tcgdex.net/v2/'+locale+'/cards/'+encodeURIComponent(apiId),{
          headers:{accept:'application/json','user-agent':'PokemonBinderBR/14.75'},
          signal:controller.signal
        });
        return r.ok?await r.json():null;
      }catch{return null}
      finally{clearTimeout(timer)}
    }));
    for(const d of rows)if(d?.name)aliases.push(String(d.name).trim());
  }
  const unique=[...new Set(aliases.filter(Boolean))];
  CACHE.set(key,{value:unique,expires:Date.now()+24*60*60*1000});
  return unique;
}
async function resolveFullNumber(number,apiId){
  const raw=String(number||'').trim().replace(/\s/g,'');
  if(!raw)return'';
  if(/[A-Za-z]{0,8}\d+[A-Za-z]*\/[A-Za-z]{0,8}\d+[A-Za-z]*/i.test(raw))return raw;
  if(!/^\d+$/.test(raw)||!apiId)return raw;
  try{
    const rr=await fetch('https://api.tcgdex.net/v2/en/cards/'+encodeURIComponent(apiId),{
      headers:{accept:'application/json','user-agent':'PokemonBinderBR/14.70'}
    });
    if(!rr.ok)return raw;
    const d=await rr.json();
    const local=String(d?.localId||raw).trim();
    const total=Number(d?.set?.cardCount?.official||0);
    return /^\d+$/.test(local)&&total>0 ? String(Number(local))+'/'+String(total) : raw;
  }catch{return raw}
}
async function fetchJina(target,timeout=22000){
  const url='https://r.jina.ai/'+target;
  const started=Date.now();
  let lastError=null;
  const attempts=[
    {noCache:false,budget:Math.min(4500,timeout)},
    {noCache:true,budget:Math.min(7000,Math.max(0,timeout-4500))}
  ];
  for(const attempt of attempts){
    const remaining=timeout-(Date.now()-started);
    if(remaining<=1200)break;
    const controller=new AbortController();
    const budget=Math.max(1200,Math.min(attempt.budget||remaining,remaining));
    const timer=setTimeout(()=>controller.abort(),budget);
    try{
      const headers={'Accept':'text/plain','X-Timeout':String(Math.max(3,Math.floor(budget/1000)-1))};
      if(attempt.noCache)headers['X-No-Cache']='true';
      const r=await fetch(url,{headers,signal:controller.signal});
      const text=await r.text();
      if(r.ok&&text.trim())return text;
      const e=new Error('Jina HTTP '+r.status);e.code='jina_http';lastError=e;
    }catch(error){lastError=error}
    finally{clearTimeout(timer)}
  }
  if(lastError)throw lastError;
  const e=new Error('Jina reader unavailable');e.code='jina_unavailable';throw e;
}
async function fetchText(url,timeout=9000){
  const started=Date.now();
  const directBudget=Math.max(1800,Math.min(4000,Math.floor(timeout*.45)));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),directBudget);
  try{
    const response=await fetch(url,{headers:{'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'pt-BR,pt;q=.9,en;q=.6','User-Agent':'Mozilla/5.0 (compatible; PokemonBinderBR/14.76; +https://pokemon-fichario.vercel.app)'},redirect:'follow',signal:controller.signal});
    const html=await response.text();
    if(response.ok&&!/just a moment|cf-chl|cloudflare/i.test(html))return html;
    if(response.status!==403&&!/just a moment|cf-chl|cloudflare/i.test(html)){
      if(!response.ok){const e=new Error('HTTP '+response.status);e.code='upstream_http';throw e}
      return html;
    }
  }catch(error){
    if(error?.name!=='AbortError'&&error?.code!=='cloudflare_blocked'){
      // Ainda tentamos o Reader abaixo dentro do mesmo orçamento total.
    }
  }finally{clearTimeout(timer)}

  const elapsed=Date.now()-started;
  const remaining=Math.max(2500,timeout-elapsed);
  try{return await fetchJina(url,remaining)}
  catch{
    const e=new Error('Cloudflare bloqueou a leitura direta');e.code='cloudflare_blocked';throw e;
  }
}
function safeMypProductUrl(value){try{const u=new URL(String(value||''));if(!/(^|\.)mypcards\.com$/i.test(u.hostname))return'';if(!/^\/pokemon\/produto\/\d+\//i.test(u.pathname))return'';return`${u.protocol}//${u.host}${u.pathname}`}catch{return''}}
function mypProductId(value){
  const safe=safeMypProductUrl(value);
  return (safe.match(/\/produto\/(\d+)\//)||[])[1]||'';
}
function sameMypProduct(a,b){
  const aa=mypProductId(a),bb=mypProductId(b);
  return !!(aa&&bb&&aa===bb);
}
function aliasCompactKeys(names){
  return [...new Set((names||[]).map(name=>slugify(name).replace(/-/g,'')).filter(Boolean))];
}
function productUrlsFromText(raw,names=[]){
  const text=decodeHtml(String(raw||''));
  const found=[];
  const add=value=>{
    let u=String(value||'').trim().replace(/[)"'<>.,;]+$/g,'');
    if(!u)return;
    if(u.startsWith('/'))u=ROOT+u;
    if(!/^https?:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\//i.test(u))return;
    try{
      const parsed=new URL(u);
      u=`${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }catch{return}
    found.push(u);
  };
  for(const m of text.matchAll(/https?:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\/[A-Za-z0-9%_\-]+/gi))add(m[0]);
  for(const m of text.matchAll(/(?:href=|\]\()\s*["']?(\/pokemon\/produto\/\d+\/[A-Za-z0-9%_\-]+)/gi))add(m[1]);
  const keys=aliasCompactKeys(names);
  const unique=[...new Set(found)];
  if(!keys.length)return unique;
  const matching=unique.filter(url=>{
    const slug=(url.split('/').filter(Boolean).pop()||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
    return keys.some(key=>slug===key||slug.includes(key)||key.includes(slug));
  });
  return matching.length?matching:unique;
}

async function resolveSetMeta(apiId,setName,setId){
  const key='set-meta:v1470:'+String(setId||apiId||setName||'');
  const cached=CACHE.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;

  const names=[String(setName||'').trim()].filter(Boolean);
  let total=0;
  let releaseDate='';
  if(setId){
    const rows=await Promise.all(['pt-br','en'].map(async locale=>{
      try{
        const r=await fetch('https://api.tcgdex.net/v2/'+locale+'/sets/'+encodeURIComponent(setId),{
          headers:{accept:'application/json','user-agent':'PokemonBinderBR/14.70'}
        });
        return r.ok?await r.json():null;
      }catch{return null}
    }));
    for(const d of rows){
      if(!d)continue;
      const setLabel=String(d?.name||'').trim();
      const serieLabel=String(d?.serie?.name||'').trim();
      if(setLabel&&serieLabel)names.unshift(serieLabel+' '+setLabel);
      if(setLabel)names.push(setLabel);
      total=Math.max(total,Number(d?.cardCount?.total||d?.cardCount?.official||0));
      if(!releaseDate&&d?.releaseDate)releaseDate=String(d.releaseDate);
    }
  }

  const aliases=[...new Set(names.map(normalize).filter(Boolean))];
  const value={total,releaseDate,names:[...new Set(names.filter(Boolean))],aliases};
  CACHE.set(key,{value,expires:Date.now()+24*60*60*1000});
  return value;
}

function editionDirectoryCandidates(raw){
  const source=decodeHtml(String(raw||''));
  const out=[];
  const seen=new Set();
  const re=/(?:https?:\/\/(?:www\.)?mypcards\.com)?\/pokemon\/([a-z0-9][a-z0-9-]{2,})(?:[?\s"'<>)]|$)/gi;
  const blocked=new Set(['produto','edicoes','selados','acessorios','promocoes','ultimos-anuncios','deck-lote-set','cartas-graduadas']);
  for(const m of source.matchAll(re)){
    const slug=String(m[1]||'').toLowerCase();
    if(blocked.has(slug))continue;
    let url=ROOT+'/pokemon/'+slug;
    if(seen.has(url))continue;
    seen.add(url);
    const pos=m.index||0;
    const context=stripTags(source.slice(Math.max(0,pos-320),Math.min(source.length,pos+520)));
    out.push({url,slug,context});
  }
  return out;
}

function scoreEditionCandidate(candidate,meta,setName,setId){
  const hay=normalize(candidate?.context||'');
  const slug=normalize(candidate?.slug||'');
  let score=0;
  const aliases=[...(meta?.aliases||[]),normalize(setName)].filter(Boolean);
  for(const alias of aliases){
    if(hay===alias||slug===alias)score=Math.max(score,1200);
    else if(hay.includes(alias)||slug.includes(alias))score=Math.max(score,900);
    else{
      const words=alias.split(/\s+/).filter(x=>x.length>2);
      const shared=words.filter(x=>hay.includes(x)||slug.includes(x)).length;
      score=Math.max(score,shared*120);
    }
  }
  const sid=normalize(setId);
  if(sid&&hay.includes(sid))score+=300;
  if(meta?.releaseDate&&hay.includes(meta.releaseDate.slice(0,4)))score+=80;
  return score;
}

async function mypEditionUrl({apiId,setId,set}){
  const meta=await resolveSetMeta(apiId,set,setId);
  const key='myp-edition:v1470:'+String(setId||set||'');
  const cached=CACHE.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;

  let best=null;
  const batches=[[1,2,3],[4,5,6],[7,8,9]];
  for(const pages of batches){
    const results=await Promise.all(pages.map(async page=>{
      try{
        const url=ROOT+'/pokemon/edicoes?page='+page+'&per-page=48';
        return await fetchJina(url,9000);
      }catch{return''}
    }));
    for(const raw of results){
      for(const candidate of editionDirectoryCandidates(raw)){
        const score=scoreEditionCandidate(candidate,meta,set,setId);
        if(!best||score>best.score)best={...candidate,score};
      }
    }
    if(best?.score>=800)break;
  }
  const value=best?.score>=360?best.url:'';
  CACHE.set(key,{value,expires:Date.now()+24*60*60*1000});
  return value;
}

function textHasCollectorNumber(text,wantedNumber){
  const wanted=numberParts(wantedNumber);
  if(!wanted.n)return false;
  const token='[A-Za-z]{0,8}\\d{1,4}[A-Za-z]{0,4}';
  const re=new RegExp('('+token+')\\s*\\/\\s*('+token+')','gi');
  for(const m of String(text||'').matchAll(re)){
    const found={n:normalizeCollectorToken(m[1]),d:normalizeCollectorToken(m[2])};
    if(found.n===wanted.n&&(!wanted.d||found.d===wanted.d))return true;
  }
  return false;
}
function collectionProductCandidatesFromText(raw,wantedNumber,names=[]){
  const source=decodeHtml(String(raw||''));
  const keys=aliasCompactKeys(names);
  const found=[];
  const seen=new Set();
  const re=/(?:https?:\/\/(?:www\.)?mypcards\.com)?\/pokemon\/produto\/\d+\/[A-Za-z0-9%_\-]+/gi;
  for(const m of source.matchAll(re)){
    let url=String(m[0]||'');
    if(url.startsWith('/'))url=ROOT+url;
    try{
      const parsed=new URL(url);
      url=parsed.protocol+'//'+parsed.host+parsed.pathname;
    }catch{continue}
    if(seen.has(url))continue;
    const pos=m.index||0;
    const context=stripTags(source.slice(Math.max(0,pos-1600),Math.min(source.length,pos+1600)));
    if(!textHasCollectorNumber(context,wantedNumber))continue;
    if(keys.length){
      const slug=(url.split('/').filter(Boolean).pop()||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
      const nameMatch=keys.some(key=>slug===key||slug.includes(key)||key.includes(slug));
      if(!nameMatch){
        const ctx=normalize(context);
        if(!names.map(normalize).some(n=>n&&ctx.includes(n)))continue;
      }
    }
    seen.add(url);found.push(url);
  }
  return found;
}
async function collectionPageText(editionUrl,page){
  const key='collection-page:v1470:'+editionUrl+':'+page;
  const cached=CACHE.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;
  const join=editionUrl.includes('?')?'&':'?';
  const url=editionUrl+join+'page='+page+'&per-page=48&sort=-codigoproduto';
  const value=await fetchJina(url,10000);
  CACHE.set(key,{value,expires:Date.now()+30*60*1000});
  return value;
}

async function collectionIndexCandidates({apiId,setId,set,number,name,nameAliases=[]}){
  const meta=await resolveSetMeta(apiId,set,setId);
  const editionUrl=await mypEditionUrl({apiId,setId,set});
  if(!editionUrl)return[];

  const names=[name,...nameAliases].filter(Boolean);

  // Primeiro use o filtro da própria edição. A página da coleção carrega
  // produtos por relevância e usa "carregar mais"; page=N sozinho pode não
  // alcançar cartas menos procuradas. Filtrar pelo número exato é determinístico.
  const scopedQueries=[number,...names.map(n=>[n,number].filter(Boolean).join(' '))]
    .map(x=>String(x||'').trim()).filter(Boolean).slice(0,3);
  for(const query of scopedQueries){
    try{
      const join=editionUrl.includes('?')?'&':'?';
      const url=editionUrl+join+'ProdutoSearch%5Bquery%5D='+encodeURIComponent(query);
      const body=await fetchJina(url,10000);
      const urls=collectionProductCandidatesFromText(body,number,names);
      if(urls.length)return urls.slice(0,6);
    }catch{}
  }

  // Fallback para coleções que não aplicam o filtro no servidor.
  const maxPages=Math.max(1,Math.min(8,Math.ceil(Math.max(48,meta.total||240)/48)));
  const pages=Array.from({length:maxPages},(_,i)=>i+1);
  for(let i=0;i<pages.length;i+=3){
    const chunk=pages.slice(i,i+3);
    const bodies=await Promise.all(chunk.map(page=>collectionPageText(editionUrl,page).catch(()=>'')));
    for(const body of bodies){
      if(!body)continue;
      const urls=collectionProductCandidatesFromText(body,number,names);
      if(urls.length)return urls.slice(0,6);
    }
  }
  return[];
}

async function readerSearchCandidates({name,nameAliases=[],number,set,setId}){
  const names=[...new Set([name,...nameAliases].map(x=>String(x||'').trim()).filter(Boolean))];
  const setCode=normalize(setId)==='sv03 5'||normalize(setId)==='sv3 5'?'MEW':String(set||'').trim();
  const queries=[...new Set(names.flatMap(n=>[
    [n,number,setCode].filter(Boolean).join(' '),
    [n,number].filter(Boolean).join(' '),
    [n,setCode].filter(Boolean).join(' '),
    n
  ]))].slice(0,6);
  const urls=[];
  for(const query of queries){
    try{
      const searchUrl=ROOT+'/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D='+encodeURIComponent(query);
      const body=await fetchText(searchUrl,9000);
      urls.push(...productUrlsFromText(body,names));
      if(urls.length>=8)break;
    }catch{}
  }
  return [...new Set(urls)].slice(0,12);
}
async function familySeedCandidates(wanted){
  const names=[...new Set([wanted?.name,...(wanted?.nameAliases||[])].filter(Boolean))];
  const indexed=await collectionIndexCandidates(wanted).catch(()=>[]);
  if(indexed.length)return indexed.slice(0,8);
  const search=await readerSearchCandidates(wanted).catch(()=>[]);
  if(search.length)return search.slice(0,10);
  const groups=await Promise.all(names.map(n=>sitemapCandidates(n).catch(()=>[])));
  return [...new Set(groups.flat())].slice(0,12);
}

async function sitemapCandidates(name){
  const wantedSlug=slugify(name),wantedCompact=wantedSlug.replace(/-/g,'');
  const key='sitemap:v1470:'+wantedCompact,cached=CACHE.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;
  const matches=[];
  let root;
  try{root=await fetchText(`${ROOT}/sitemap.xml`,12000)}
  catch(error){if(error?.code==='cloudflare_blocked')throw error;return[]}
  const first=xmlLocs(root);
  const accept=url=>{
    if(!/\/pokemon\/produto\/\d+\//i.test(url))return;
    const slug=(url.split('/').filter(Boolean).pop()||'').toLowerCase();
    const compact=slug.replace(/[^a-z0-9]/g,'');
    if(!wantedCompact||compact===wantedCompact||compact.includes(wantedCompact)||wantedCompact.includes(compact))matches.push(url);
  };
  first.forEach(accept);
  if(!matches.length){
    const childMaps=first.filter(x=>/\.xml(?:\?|$)/i.test(x));
    const preferred=[...childMaps.filter(x=>/pokemon|produto|product|card/i.test(x)),...childMaps.filter(x=>!/pokemon|produto|product|card/i.test(x))].slice(0,18);
    for(const mapUrl of preferred){
      try{
        const xml=await fetchText(mapUrl,12000);
        xmlLocs(xml).forEach(accept);
        if(matches.length>=18)break;
      }catch{}
    }
  }
  const unique=[...new Set(matches)].slice(0,18);
  CACHE.set(key,{value:unique,expires:Date.now()+6*60*60*1000});
  return unique;
}

function normalizeCollectorToken(value){const raw=String(value||'').trim().replace(/[^A-Za-z0-9]/g,'');if(!raw)return'';const m=raw.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);if(!m)return raw.toLowerCase();return (m[1]||'').toLowerCase()+String(Number(m[2]))+(m[3]||'').toLowerCase()}
function numberParts(value){const text=String(value||'');const token='[A-Za-z]{0,8}\\d{1,4}[A-Za-z]{0,4}';const m=text.match(new RegExp('('+token+')\\s*\\/\\s*('+token+')','i'));if(m)return{n:normalizeCollectorToken(m[1]),d:normalizeCollectorToken(m[2]),full:normalizeCollectorToken(m[1])+'/'+normalizeCollectorToken(m[2])};const x=text.match(new RegExp(token,'i'));return x?{n:normalizeCollectorToken(x[0]),d:'',full:normalizeCollectorToken(x[0])}:{n:'',d:'',full:''}}
function pageIdentity(html){const text=stripTags(html);const token='[A-Za-z]{0,8}\\d{1,4}[A-Za-z]{0,4}';const titleMatch=text.match(new RegExp('(?:^|\\n)\\s*([^\\n]{1,120}?)\\s*\\(('+token+'(?:\\s*\\/\\s*'+token+')?)\\)\\s*(?:\\n|$)','m'));const codeMatch=text.match(/Código\s+([^\n]+)/i),editionMatch=text.match(/Edição\s+([^\n]+)/i),rarityMatch=text.match(/Raridade\s+([^\n]+)/i);return{text,name:titleMatch?titleMatch[1].trim():'',number:titleMatch?titleMatch[2].replace(/\s/g,''):'',code:codeMatch?codeMatch[1].trim():'',edition:editionMatch?editionMatch[1].trim():'',rarity:rarityMatch?rarityMatch[1].trim():''}}
function marketIdentityLocaleScore(identity,wanted={}){
  const lang=String(wanted?.lang||'').toLowerCase();
  // identity.text também contém "Outras Edições". Usar o corpo inteiro
  // confundia uma página MEW válida com SV2A/Japonês listado mais abaixo.
  // A identidade da impressão vem apenas de Edição/Código da página atual.
  const hay=normalize([identity?.edition,identity?.code].filter(Boolean).join(' '));
  const tokens=new Set(hay.split(/\s+/).filter(Boolean));
  const japanese=tokens.has('japones')||tokens.has('japanese')||tokens.has('sv2a');
  let score=0;
  if(lang==='ja'||lang==='jp')score+=japanese?900:-250;
  else if(lang&&japanese)score-=1500;
  const setId=normalize(wanted?.setId||'');
  if(setId==='sv03 5'||setId==='sv3 5'){
    if(lang==='ja'||lang==='jp'){
      if(tokens.has('sv2a'))score+=1100;
      if(tokens.has('mew'))score-=1100;
    }else{
      if(tokens.has('mew'))score+=1100;
      if(tokens.has('sv2a'))score-=1800;
    }
  }
  return score;
}
function matchesWanted(identity,wanted){
  const w=numberParts(wanted.number);
  const titleNumber=numberParts(identity.number);
  const codeNumber=numberParts(identity.code);
  const f=titleNumber.n?titleNumber:codeNumber;
  if(w.n&&f.n!==w.n)return false;
  if(w.d&&f.d&&f.d!==w.d)return false;

  const setId=normalize(wanted?.setId||'');
  const code=normalize(identity?.code||'');
  // Na 151, set + número de colecionador + código MEW identificam a impressão
  // de forma única. Isso cobre nomes localizados como Nidoran macho/fêmea sem
  // depender de um alias manual para cada idioma.
  const canonicalMew=(setId==='sv03 5'||setId==='sv3 5')&&code.includes('pokemon mew')&&!!w.n&&f.n===w.n;

  const aliases=[wanted?.name,...(Array.isArray(wanted?.nameAliases)?wanted.nameAliases:[])].map(normalize).filter(Boolean);
  const pn=normalize(identity.name);
  if(!canonicalMew&&aliases.length&&pn&&!aliases.some(wn=>wn===pn||pn.includes(wn)||wn.includes(pn)))return false;
  if(marketIdentityLocaleScore(identity,wanted)<=-1000)return false;
  return true;
}

function extractMarket(identity,finish,condition){
  const text=identity.text;
  let sellerText=text;
  const sellerStart=text.search(/Lojistas e Certificados|Demais vendedores/i);
  if(sellerStart>=0)sellerText=text.slice(sellerStart);
  const other=sellerText.search(/Outras Edições/i);
  if(other>=0)sellerText=sellerText.slice(0,other);
  const lines=sellerText.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  // O Reader pode desmontar uma linha da tabela em vários blocos:
  // vendedor -> acabamento -> condição -> quantidade -> preço.
  const offerRows=[];
  let rowBuffer=[];
  for(const line of lines){
    rowBuffer.push(line);
    if(line.includes('R$')){
      offerRows.push(rowBuffer.join(' | '));
      rowBuffer=[];
    }
  }

  const byCondition=offerRows.filter(x=>lineMatchesCondition(x,condition));
  const wantedFinish=finishKind(finish);
  const np=numberParts(identity.number||'');
  const n=/^\d+$/.test(np.n)?Number(np.n):0;
  const d=/^\d+$/.test(np.d)?Number(np.d):0;
  const rarity=normalize(identity.rarity||'');
  const intrinsicFoil=/holo|ultra rara|ultra rare|illustration rare|ilustracao rara|ilustracao especial|special illustration|hiper rara|hyper rare|secret rare|secreta|rainbow|dourada|gold/.test(rarity)||(n>0&&d>0&&n>d);
  const exact=byCondition.filter(x=>{
    if(lineMatchesFinish(x,finish))return true;
    const normalized=normalize(x);
    if(wantedFinish==='foil'&&intrinsicFoil){
      const otherSurface=/reverse|masterball|master ball|pokeball|poke ball|altered art/.test(normalized);
      if(otherSurface)return false;
      // Full-Art or an unlabeled row on an intrinsically holo product is the
      // default physical printing, not a separate Normal card.
      return /full art|full-art/.test(normalized)||!/foil|holo|reverse|masterball|master ball|pokeball|poke ball/.test(normalized);
    }
    return false;
  });
  let selected=[];
  let exactVariant=false;
  // Strict market identity: never fall back to another quality or another
  // explicit finish just to avoid an empty price.
  if(exact.length){selected=exact;exactVariant=true}
  else if(byCondition.length&&finishKind(finish)==='normal'){
    // Só o acabamento Normal pode usar linhas sem rótulo de superfície.
    // Reverse/Foil/Poké Ball/Master Ball jamais caem para anúncios normais.
    const safeDefault=byCondition.filter(x=>!normalize(x).match(/altered art|reverse foil|reverse holo|masterball|master ball|pokeball|poke ball|\bfoil\b|holo/));
    selected=safeDefault;
  }

  // Uma oferta promocional pode carregar preço antigo e preço atual.
  // O último valor da própria oferta é o vigente e conta como uma amostra.
  const usable=selected.map(row=>{
      const values=moneyMatches(row);
      return values.length?values[values.length-1]:0;
    })
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


function marketFitsFinish(market,finish){
  if(!hasAnyMarket(market))return false;
  const kind=finishKind(finish);
  if(kind==='normal')return true;
  return market?.exactVariant===true;
}
function mergeVariantMarkets(markets){
  const usable=(markets||[]).filter(m=>m&&m.exactVariant&&hasAnyMarket(m));
  if(!usable.length)return null;
  let min=Infinity,max=0,total=0,samples=0,qty=0,hasQty=false;
  for(const m of usable){
    const count=Math.max(1,Number(m.samples||0));
    const pageAvg=Number(m.avg||0)||Number(m.min||0)||Number(m.max||0);
    const pageMin=Number(m.min||0)||pageAvg;
    const pageMax=Number(m.max||0)||pageAvg;
    if(pageMin>0)min=Math.min(min,pageMin);
    if(pageMax>0)max=Math.max(max,pageMax);
    if(pageAvg>0){total+=pageAvg*count;samples+=count}
    if(Number(m.availableQuantity||0)>0){qty+=Number(m.availableQuantity);hasQty=true}
  }
  if(!Number.isFinite(min))min=0;
  return{
    min,avg:samples?total/samples:0,max,
    availableQuantity:hasQty?qty:null,
    samples:samples||null,
    exactVariant:true
  };
}
async function marketAcrossSellerPages(link,firstRaw,firstIdentity,wanted,finish,condition){
  const first=extractMarket(firstIdentity,finish,condition);
  if(marketFitsFinish(first,finish))return first;
  if(finishKind(finish)==='normal')return first;

  const certPages=new Set([2,3,4]);
  const otherPages=new Set([2,3,4]);
  for(const m of String(firstRaw||'').matchAll(/estoque-cert-page(?:=|%3D)(\d+)/gi)){
    const n=Number(m[1]||0);
    if(n>=2&&n<=8)certPages.add(n);
  }
  for(const m of String(firstRaw||'').matchAll(/estoque-outros-page(?:=|%3D)(\d+)/gi)){
    const n=Number(m[1]||0);
    if(n>=2&&n<=8)otherPages.add(n);
  }

  const base=safeMypProductUrl(link);
  if(!base)return first;

  const urls=[];
  for(const page of [...certPages].sort((a,b)=>a-b).slice(0,7)){
    urls.push(base+'?estoque-cert-page='+page);
  }
  for(const page of [...otherPages].sort((a,b)=>a-b).slice(0,7)){
    urls.push(base+'?estoque-outros-page='+page);
  }

  const results=await Promise.all(urls.map(async url=>{
    try{
      const raw=await fetchJina(url,6500);
      const identity=pageIdentity(raw);
      if(!matchesWanted(identity,wanted))return null;
      return extractMarket(identity,finish,condition);
    }catch{return null}
  }));

  return mergeVariantMarkets([first,...results])||first;
}

async function resolvePage({name,nameAliases=[],number,set,setId,apiId,link,lang,finish,condition}){
  const direct=safeMypProductUrl(link);
  const wanted={name,nameAliases,number,set,setId,lang};
  const familyNames=[name,...nameAliases].filter(Boolean);
  const queue=direct?[direct]:await familySeedCandidates({name,nameAliases,number,set,setId,apiId});
  const seen=new Set();
  let best=null;
  let inspected=0;

  while(queue.length&&inspected<14){
    const url=queue.shift();
    if(!url||seen.has(url))continue;
    seen.add(url);inspected++;
    try{
      const raw=await fetchJina(url,6500);
      const identity=pageIdentity(raw);
      const exact=matchesWanted(identity,wanted);

      if(exact){
        const market=await marketAcrossSellerPages(url,raw,identity,wanted,finish,condition);
        const wantedSet=normalize(set),edition=normalize(identity.edition),code=normalize(identity.code);
        let score=1000+marketIdentityLocaleScore(identity,{setId,lang})+(market.samples||0);
        if(wantedSet&&(edition.includes(wantedSet)||wantedSet.includes(edition)||code.includes(wantedSet)))score+=280;
        const candidate={url,identity,market,score};
        if(!best||candidate.score>best.score)best=candidate;
        if(marketFitsFinish(market,finish))break;
      }

      // Mesmo quando o número não bate, uma página do mesmo personagem/carta
      // pode ser a porta de entrada para "Outras Edições". Ex.: 156/165 -> 194/165.
      const identityName=normalize(identity.name);
      const familyMatch=familyNames.map(normalize).some(n=>n&&identityName&&(identityName===n||identityName.includes(n)||n.includes(identityName)));
      if(exact||familyMatch){
        const siblings=productUrlsFromText(raw,familyNames);
        for(const sibling of siblings)if(!seen.has(sibling))queue.push(sibling);
      }
    }catch{}
  }

  if(!best&&direct){
    return resolvePage({name,nameAliases,number,set,setId,apiId,link:'',lang,finish,condition});
  }
  return best;
}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=1200, stale-while-revalidate=14400');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});

  const name=String(req.query.name||'').trim();
  const inputNumber=String(req.query.number||'').trim();
  const apiId=String(req.query.apiId||req.query.api_id||'').trim();
  const number=await resolveFullNumber(inputNumber,apiId);
  const set=String(req.query.set||'').trim();
  const setId=String(req.query.setId||req.query.set_id||'').trim();
  const link=String(req.query.link||'').trim();
  const lang=String(req.query.lang||'').trim();
  const finish=String(req.query.finish||'Normal').trim();
  const condition=String(req.query.condition||'NM').trim();
  const fast=String(req.query.fast||'')==='1';
  if(fast)res.setHeader('Cache-Control','no-store, max-age=0');
  if(!name)return res.status(400).json({ok:false,error:'name_required'});

  const directLink=safeMypProductUrl(link);
  const nameAliases=fast&&directLink?[name]:await resolveNameAliases(name,apiId);
  const browserSeedLink=directLink;

  if(String(req.query.actorOnly||'')==='1'){
    if(!process.env.APIFY_API_TOKEN){
      return res.status(200).json({ok:false,error:'apify_not_configured'});
    }
    try{
      const found=await queryMyp({name,nameAliases,number,set,setId,lang,finish,condition});
      return res.status(200).json({
        ok:hasAnyMarket(found),
        source:'MYP Cards',
        provider:'Apify actor only',
        name,number,set,setId,finish,condition,
        ...found
      });
    }catch(error){
      return res.status(200).json({
        ok:false,error:error?.name==='AbortError'?'timeout':String(error?.code||error?.message||'apify_error'),
        provider:'Apify actor only'
      });
    }
  }

  // Atualização manual de uma única carta: nunca prende a interface por
  // Chromium/Apify. Se já sabemos a página da MYP, tentamos uma leitura direta
  // via Reader por poucos segundos. Se não der, a carta permanece na fila
  // persistente de alta prioridade para o worker do servidor.
  if(fast){
    if(!directLink){
      return res.status(200).json({
        ok:false,error:'fast_link_missing',source:'MYP Cards',provider:'Fast Reader',
        message:'Sem link MYP conhecido; atualização completa seguirá pela fila prioritária.'
      });
    }
    try{
      const text=await fetchJina(directLink,8000);
      const identity=pageIdentity(text);
      const identityOk=matchesWanted(identity,{name,nameAliases,number,set,setId,lang});
      if(identityOk){
        const market=await marketAcrossSellerPages(directLink,text,identity,{name,nameAliases,number,set,setId,lang},finish,condition);
        if(marketFitsFinish(market,finish)){
          return res.status(200).json({
            ok:true,source:'MYP Cards',provider:'Fast Reader',mode:'fast-direct',
            name:identity.name||name,number:identity.number||number,edition:identity.edition||set,
            finish,condition,link:directLink,
            min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
            samples:market.samples??null,availableQuantity:market.availableQuantity??null,
            exactVariant:market.exactVariant!==false,
            complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
            checkedAt:new Date().toISOString()
          });
        }
      }

      return res.status(200).json({
        ok:false,
        error:identityOk?'fast_no_price':'wrong_product',
        source:'MYP Cards',
        provider:'Fast Reader',
        link:directLink,
        identity:{name:identity?.name||'',number:identity?.number||'',code:identity?.code||'',edition:identity?.edition||''},
        message:identityOk
          ?'A página correta foi aberta, mas a variante ainda não apareceu no Reader rápido.'
          :'O Reader rápido não confirmou a impressão; a fila fará a tentativa completa.'
      });
    }catch(error){
      return res.status(200).json({
        ok:false,error:error?.name==='AbortError'?'fast_timeout':'fast_unavailable',
        source:'MYP Cards',provider:'Fast Reader',link:directLink,
        message:'A leitura rápida não concluiu; a fila prioritária continuará no servidor.'
      });
    }
  }

  const directBrowser=String(req.query.directBrowser||'')==='1';
  if(directBrowser&&directLink){
    try{
      const market=await findAndScrapeMypBrowser(directLink,{
        name,nameAliases,number,set,setId,apiId,lang,finish,condition,strictDirect:true
      });
      if(market?.ok&&hasAnyMarket(market)){
        return res.status(200).json({
          ok:true,source:'MYP Cards',provider:'Chromium direct',mode:market.mode||'browser-direct-known',
          name,number,edition:market.edition||set,finish,condition,
          link:safeMypProductUrl(market.link)||directLink,
          min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
          samples:market.samples??null,availableQuantity:market.availableQuantity??null,
          exactVariant:market.exactVariant!==false,
          complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
          checkedAt:new Date().toISOString()
        });
      }
      return res.status(200).json({
        ok:false,error:market?.error||'variant_not_found',source:'MYP Cards',
        provider:'Chromium direct',link:directLink,
        rows:market?.rows??null,
        language:market?.language??null,
        availableLanguages:market?.availableLanguages??[],
        defaultFinish:market?.defaultFinish??null,
        finish:market?.finish??finish,
        condition:market?.condition??condition,
        diagnostics:market?.diagnostics??[],
        message:market?.message||'A página conhecida não retornou a variante solicitada.'
      });
    }catch(error){
      return res.status(200).json({
        ok:false,error:error?.name==='TimeoutError'?'timeout':'browser_error',
        source:'MYP Cards',provider:'Chromium direct',link:directLink,
        message:error?.message||String(error)
      });
    }
  }

  // Na fila, uma carta com URL MYP conhecida não precisa refazer descoberta.
  // Tente primeiro o scraper especializado com consulta exata
  // (nome + número + coleção). Ele já valida idioma, condição e acabamento.
  const apifyConfigured=!!process.env.APIFY_API_TOKEN;
  let apifyFound=null,apifyError='';
  if(directLink&&apifyConfigured){
    try{
      const found=await queryMyp({name,nameAliases,number,set,setId,lang,finish,condition});
      if(hasAnyMarket(found)||safeMypProductUrl(found?.link))apifyFound=found;
      if(apifyFound&&hasAnyMarket(apifyFound)&&apifyFound.exactVariant===true){
        const actorLink=safeMypProductUrl(apifyFound.link);
        if(actorLink&&sameMypProduct(actorLink,directLink)){
          return res.status(200).json({
            ok:true,source:'MYP Cards',provider:'Apify exact market',mode:'actor-known-product',
            name,number,edition:set,finish,condition,link:actorLink,
            min:Number(apifyFound.min||0),avg:Number(apifyFound.avg||0),max:Number(apifyFound.max||0),
            samples:apifyFound.samples??null,availableQuantity:apifyFound.availableQuantity??null,
            exactVariant:true,
            complete:!!(Number(apifyFound.min)>0&&Number(apifyFound.avg)>0&&Number(apifyFound.max)>0),
            checkedAt:new Date().toISOString()
          });
        }
      }
    }catch(error){
      apifyError=error?.code||error?.message||'apify_error';
      console.warn('MYP Apify exato falhou; tentando Reader:',apifyError);
    }
  }

  // Quando o índice da coleção já encontrou uma página, tente o Reader
  // imediatamente antes de abrir Chromium. Isso mantém o worker abaixo do
  // limite de execução e ainda valida nome/número/coleção/idioma/variante.
  if(directLink&&!fast){
    try{
      const text=await fetchJina(directLink,8000);
      const identity=pageIdentity(text);
      if(matchesWanted(identity,{name,nameAliases,number,set,setId,lang})){
        const market=await marketAcrossSellerPages(directLink,text,identity,{name,nameAliases,number,set,setId,lang},finish,condition);
        if(marketFitsFinish(market,finish)){
          return res.status(200).json({
            ok:true,
            source:'MYP Cards',
            provider:'Collection Reader',
            mode:'collection-index-direct',
            name:identity.name||name,
            number:identity.number||number,
            edition:identity.edition||set,
            finish,
            condition,
            link:directLink,
            min:Number(market.min||0),
            avg:Number(market.avg||0),
            max:Number(market.max||0),
            samples:market.samples??null,
            availableQuantity:market.availableQuantity??null,
            exactVariant:market.exactVariant!==false,
            complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
            checkedAt:new Date().toISOString()
          });
        }
      }
    }catch(error){
      console.warn('MYP Collection Reader falhou; tentando Chromium:',error?.message||error);
    }
  }

  let collectionDiscoveredLink='';

  // Fonte completa: abrir a página pública real em Chromium.
  // O fetch HTTP simples é bloqueado pelo Cloudflare, mas o navegador real
  // executa o desafio e enxerga as mesmas ofertas exibidas ao usuário.
  {
    const browserKey='browser:v1480direct:'+normalize(name)+'|'+number+'|'+normalize(set)+'|'+normalize(setId)+'|'+normalize(lang)+'|'+normalize(finish)+'|'+String(condition||'').toUpperCase()+'|'+(browserSeedLink||'discover');
    const browserCached=CACHE.get(browserKey);
    if(browserCached&&browserCached.expires>Date.now())return res.status(200).json(browserCached.value);
    try{
      const market=await findAndScrapeMypBrowser(browserSeedLink||'',{name,nameAliases,number,set,setId,apiId,lang,finish,condition});
      if(market?.ok&&hasAnyMarket(market)){
        const resolvedLink=safeMypProductUrl(market.link)||directLink||'';
        const out={
          ok:true,
          source:'MYP Cards',
          provider:'Chromium',
          mode:browserSeedLink?'browser-family-page':'browser-search-page',
          name,
          number,
          edition:market.edition||set,
          finish,
          condition,
          link:resolvedLink,
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
      if(market?.error==='product_blocked'&&safeMypProductUrl(market?.link)){
        // A coleção já identificou a impressão correta pelo número. O detalhe
        // é bloqueado pelo Cloudflare, então preserve esta identidade e use o
        // Actor da MYP para obter o preço do estoque filtrado.
        collectionDiscoveredLink=safeMypProductUrl(market.link);
        console.warn('Produto MYP localizado pela coleção; detalhe bloqueado. Validando preço via Actor:',collectionDiscoveredLink);
      }
      if(market?.error==='collection_not_found'){
        return res.status(200).json({
          ok:false,
          error:'collection_not_found::'+String(market.message||'').slice(0,700),
          source:'MYP Cards',
          provider:'Chromium Collection',
          stage:market.stage||'collection',
          elapsedMs:market.elapsedMs||null,
          message:market.message||'A coleção da MYP não localizou a carta.'
        });
      }
      if(['wrong_product','product_not_found'].includes(market?.error)){
        // Não encerre aqui. A busca visual da MYP pode falhar mesmo com a
        // página existente; o sitemap/Reader abaixo é um segundo índice
        // independente e pode descobrir a mesma carta automaticamente.
        console.warn('MYP Chromium não localizou a impressão; tentando sitemap/Reader:',market.error);
      }
      if(market?.error==='variant_not_found'){
        // O Reader/Apify ainda pode enxergar anúncios que o DOM do Chromium
        // não classificou corretamente. Não encerramos a busca cedo.
        console.warn('MYP Chromium não achou a variante; tentando fallbacks.');
      }else{
        console.warn('MYP Chromium falhou; tentando fallbacks:',market?.error||'unknown');
      }
    }catch(error){
      console.warn('MYP Chromium lançou erro; tentando fallbacks:',error?.message||error);
    }
  }

  if(!apifyFound&&apifyConfigured){
    try{
      const found=await queryMyp({name,nameAliases,number,set,setId,lang,finish,condition});
      if(hasAnyMarket(found)||safeMypProductUrl(found?.link))apifyFound=found;
    }catch(error){
      apifyError=apifyError||error?.code||error?.message||'apify_error';
      console.warn('MYP Apify falhou; usando fallback Reader:',apifyError);
    }
  }

  // Se o Actor encontrou exatamente a variante solicitada e a URL bate com
  // o produto MYP já conhecido, o mercado está totalmente validado e pode ser
  // usado diretamente. Isso evita depender do Reader/Chromium quando a própria
  // página pública está instável ou cacheada.
  if(apifyFound&&hasAnyMarket(apifyFound)&&apifyFound.exactVariant===true){
    const actorLink=safeMypProductUrl(apifyFound.link);
    const knownLink=directLink||collectionDiscoveredLink||safeMypProductUrl(link);
    if(actorLink&&(!knownLink||sameMypProduct(actorLink,knownLink))){
      return res.status(200).json({
        ok:true,
        source:'MYP Cards',
        provider:'Apify exact market',
        mode:'actor-exact-variant',
        name,
        number,
        edition:set,
        finish,
        condition,
        link:actorLink,
        min:Number(apifyFound.min||0),
        avg:Number(apifyFound.avg||0),
        max:Number(apifyFound.max||0),
        samples:apifyFound.samples??null,
        availableQuantity:apifyFound.availableQuantity??null,
        exactVariant:true,
        complete:!!(Number(apifyFound.min)>0&&Number(apifyFound.avg)>0&&Number(apifyFound.max)>0),
        checkedAt:new Date().toISOString()
      });
    }
  }

  if(apifyFound&&hasAnyMarket(apifyFound)&&collectionDiscoveredLink&&sameMypProduct(apifyFound.link,collectionDiscoveredLink)){
    const out={
      ok:true,
      source:'MYP Cards',
      provider:'Apify + MYP Collection',
      mode:'collection-validated-actor',
      name,
      number,
      edition:set,
      finish,
      condition,
      link:collectionDiscoveredLink,
      min:Number(apifyFound.min||0),
      avg:Number(apifyFound.avg||0),
      max:Number(apifyFound.max||0),
      samples:apifyFound.samples??null,
      availableQuantity:apifyFound.availableQuantity??null,
      exactVariant:apifyFound.exactVariant===true,
      complete:!!(Number(apifyFound.min)>0&&Number(apifyFound.avg)>0&&Number(apifyFound.max)>0),
      checkedAt:new Date().toISOString()
    };
    return res.status(200).json(out);
  }

  const cacheKey='market:v1480direct:'+normalize(name)+'|'+number+'|'+normalize(set)+'|'+normalize(setId)+'|'+normalize(lang)+'|'+normalize(finish)+'|'+condition.toUpperCase()+'|'+safeMypProductUrl(link);
  const cached=CACHE.get(cacheKey);if(cached&&cached.expires>Date.now())return res.status(200).json(cached.value);
  try{
    // Preserve the deterministic/canonical product identity through the
    // final fallback. Dropping back to raw text search here reintroduced
    // ambiguity for localized names and uncommon cards.
    const candidateLink=safeMypProductUrl(apifyFound?.link)||directLink||safeMypProductUrl(link);
    const found=await resolvePage({name,nameAliases,number,set,setId,apiId,link:candidateLink,lang,finish,condition});
    if(!found){
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
    // Preço final vem da página pública validada. O Actor serve apenas para
    // descobrir a URL quando a busca textual/slug da MYP não encontra a carta.
    const market=found.market;
    if(!marketFitsFinish(market,finish)){
      const out={ok:false,error:'no_price_data',source:'MYP Cards',provider:apifyFound?'Reader + Apify':'Reader',connector:'Apify',apifyConfigured,apifyError,needsApifyToken:!apifyConfigured,message:'A MYP respondeu sem cotação utilizável para esta carta/variante.'};
      CACHE.set(cacheKey,{value:out,expires:Date.now()+3*60*1000});
      return res.status(200).json(out);
    }
    const out={ok:true,source:'MYP Cards',provider:apifyFound?'Reader + Apify':'Reader',mode:'public-page',name:found.identity.name||name,number:found.identity.number||number,edition:found.identity.edition||set,finish,condition,link:found.url,...market,checkedAt:new Date().toISOString()};
    CACHE.set(cacheKey,{value:out,expires:Date.now()+25*60*1000});
    return res.status(200).json(out);
  }catch(error){
    const code=error?.code==='cloudflare_blocked'?'cloudflare_blocked':(error?.name==='AbortError'?'timeout':'upstream_error');
    return res.status(200).json({ok:false,error:code,connector:'Apify',apifyConfigured,apifyError,needsApifyToken:!apifyConfigured,message:code==='cloudflare_blocked'?'MYP bloqueou a leitura automática direta via Cloudflare.':'Não foi possível consultar a página pública da MYP agora.'});
  }
}
module.exports.config={maxDuration:60};

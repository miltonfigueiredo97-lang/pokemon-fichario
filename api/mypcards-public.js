const { URL } = require('url');
const { queryMyp } = require('../lib/apify-prices');
const { findAndScrapeMypBrowser, searchExactMypBrowser, searchCollectionExactMypBrowser, searchFastSetPageMypBrowser, searchWebExactMypBrowser, scanSetCatalogMypBrowser, resolveBatchMypLinksBrowser } = require('../lib/myp-browser');

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


function compactCollector(value){
  return String(value||'').toLowerCase().replace(/\s+/g,'').replace(/^0+(?=\d)/,'');
}
function officialProductScore(card,{number,set,setId,name}={}){
  const wantedNumber=compactCollector(number);
  const wantedSet=normalize(set||setId||'');
  const wantedName=normalize(name||'');
  let score=0;
  const labels=Array.isArray(card?.deck_labels)?card.deck_labels:[];
  const hayNumber=[card?.card_code,...labels].map(x=>String(x||''));
  if(wantedNumber&&hayNumber.some(x=>compactCollector(x).includes(wantedNumber)))score+=1800;
  const edition=normalize([card?.edition_code,card?.edition_pt,card?.edition_en].filter(Boolean).join(' '));
  if(wantedSet&&edition&&(edition.includes(wantedSet)||wantedSet.includes(edition)))score+=900;
  const productName=normalize([card?.name_pt,card?.name_en].filter(Boolean).join(' '));
  if(wantedName&&productName&&(productName.includes(wantedName)||wantedName.includes(productName)))score+=500;
  if(card?.link&&safeMypProductUrl(card.link))score+=100;
  return score;
}
async function officialMypIdentity({name,number,set,setId}={}){
  const token=String(process.env.MYPCARDS_API_TOKEN||process.env.MYP_API_TOKEN||'').trim();
  if(!token||!name)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),3200);
  try{
    const url='https://mypcards.com/api/v1/pokemon/carta/'+encodeURIComponent(String(name));
    const rr=await fetch(url,{
      headers:{'Accept':'application/json','X-Api-Token':token,'User-Agent':'PokemonBinderBR/16.21'},
      signal:controller.signal
    });
    if(!rr.ok)return null;
    const body=await rr.json().catch(()=>null);
    const cards=Array.isArray(body?.cards)?body.cards:[];
    const ranked=cards
      .map(card=>({card,score:officialProductScore(card,{number,set,setId,name})}))
      .sort((a,b)=>b.score-a.score);
    const best=ranked[0];
    if(!best||best.score<1800)return null;
    const link=safeMypProductUrl(best.card?.link);
    if(!link)return null;
    return{link,product:best.card,score:best.score,provider:'MYP official API'};
  }catch{
    return null;
  }finally{clearTimeout(timer)}
}

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
function isCanonicalMewPtBrProductLink(link,{setId,lang,number}={}){
  const rawSet=String(setId||'').trim().toLowerCase();
  const rawLang=String(lang||'').trim().toLowerCase();
  if(!['sv03.5','sv3.5'].includes(rawSet)||!['pt-br','pt'].includes(rawLang))return false;
  const np=numberParts(number);
  const collector=/^\d+$/.test(np.n)?Number(np.n):0;
  if(collector<1||collector>207)return false;
  return Number(mypProductId(link)||0)===205873+collector;
}
function generationsMypProductId(number){
  const raw=String(number||'').trim().replace(/\s/g,'').toLowerCase();
  let m=raw.match(/^rc0*(\d+)\/rc32$/i);
  if(m){
    const n=Number(m[1]);
    return n>=1&&n<=32?36243+n:0;
  }
  if(/^0*28a\/83$/i.test(raw))return 36188;
  if(/^0*73a\/83$/i.test(raw))return 115355;
  m=raw.match(/^0*(\d+)\/83$/);
  if(!m)return 0;
  const n=Number(m[1]);
  if(n<1||n>83)return 0;
  return (n<=28?36159:36160)+n;
}
function isCanonicalGenerationsProductLink(link,{setId,number}={}){
  if(normalize(setId)!=='g1')return false;
  const expected=generationsMypProductId(number);
  return !!expected&&Number(mypProductId(link)||0)===expected;
}
function productUrlByIdFromText(raw,productId){
  const id=Number(productId||0);
  if(!id)return'';
  const source=decodeHtml(String(raw||''));
  const re=new RegExp('(?:https?:\\/\\/(?:www\\.)?mypcards\\.com)?\\/pokemon\\/produto\\/'+id+'\\/[A-Za-z0-9%_\\-]+','i');
  const m=source.match(re);
  if(!m)return'';
  let url=String(m[0]||'');
  if(url.startsWith('/'))url=ROOT+url;
  try{
    const u=new URL(url);
    return u.protocol+'//'+u.host+u.pathname;
  }catch{return''}
}
async function sitemapProductById(productId){
  const id=Number(productId||0);
  if(!id)return'';
  const key='sitemap-product-id:v1484:'+id;
  const cached=CACHE.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;

  const needle='/pokemon/produto/'+id+'/';
  let root='';
  try{root=await fetchText(ROOT+'/sitemap.xml',9000)}catch{return''}

  const pick=text=>{
    const urls=xmlLocs(text);
    return urls.find(url=>String(url).includes(needle))||'';
  };
  let found=pick(root);
  if(found){
    found=safeMypProductUrl(found);
    if(found)CACHE.set(key,{value:found,expires:Date.now()+24*60*60*1000});
    return found;
  }

  const childMaps=xmlLocs(root).filter(url=>/\.xml(?:\?|$)/i.test(url));
  const ordered=[
    ...childMaps.filter(url=>/pokemon|produto|product|card/i.test(url)),
    ...childMaps.filter(url=>!/pokemon|produto|product|card/i.test(url))
  ];
  for(let i=0;i<ordered.length;i+=6){
    const chunk=ordered.slice(i,i+6);
    const bodies=await Promise.all(chunk.map(async url=>{
      try{return await fetchText(url,9000)}catch{return''}
    }));
    for(const body of bodies){
      if(!body||!body.includes(String(id)))continue;
      found=pick(body);
      if(found){
        found=safeMypProductUrl(found);
        if(found){
          CACHE.set(key,{value:found,expires:Date.now()+24*60*60*1000});
          return found;
        }
      }
    }
  }
  return'';
}

async function canonicalizeKnownProductLink({link,apiId,setId,set,number,name,nameAliases=[]}){
  const safe=safeMypProductUrl(link);
  const id=mypProductId(safe);
  if(!safe||!id)return safe;

  // 1) O sitemap identifica o produto pelo ID, sem depender de nome/idioma.
  try{
    const sitemapUrl=await sitemapProductById(id);
    if(sitemapUrl)return sitemapUrl;
  }catch{}

  // 2) A própria busca exata da edição pode revelar o slug canônico do mesmo ID.
  try{
    const editionUrl=await mypEditionUrl({apiId,setId,set});
    if(editionUrl){
      const join=editionUrl.includes('?')?'&':'?';
      const queries=[number,...[name,...nameAliases].filter(Boolean).map(n=>[n,number].filter(Boolean).join(' '))]
        .map(x=>String(x||'').trim()).filter(Boolean).slice(0,4);
      for(const query of queries){
        try{
          const body=await fetchJina(editionUrl+join+'ProdutoSearch%5Bquery%5D='+encodeURIComponent(query),8000);
          const canonical=productUrlByIdFromText(body,id);
          if(canonical)return canonical;
        }catch{}
      }
    }
  }catch{}

  // 3) Busca global pelo número, sem confiar no slug/nome localizado.
  try{
    const setCode=(normalize(setId)==='sv03 5'||normalize(setId)==='sv3 5')?'MEW':normalize(setId)==='g1'?'GEN':String(set||'').trim();
    for(const query of [[number,setCode].filter(Boolean).join(' '),number].filter(Boolean)){
      const searchUrl=ROOT+'/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D='+encodeURIComponent(query);
      const body=await fetchJina(searchUrl,8000);
      const canonical=productUrlByIdFromText(body,id);
      if(canonical)return canonical;
    }
  }catch{}

  return safe;
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
  const key='set-meta:v1483:'+String(setId||apiId||setName||'');
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
    const aliasIsGeneric=/^\d+$/.test(alias)||alias.length<4;
    if(hay===alias||slug===alias)score=Math.max(score,aliasIsGeneric?260:1200);
    else if(hay.includes(alias)||slug.includes(alias))score=Math.max(score,aliasIsGeneric?180:900);
    else{
      const words=alias.split(/\s+/).filter(x=>x.length>2);
      const shared=words.filter(x=>hay.includes(x)||slug.includes(x)).length;
      score=Math.max(score,shared*120);
    }
  }
  const sid=normalize(setId);
  if(sid&&hay.includes(sid))score+=300;
  if(meta?.releaseDate&&hay.includes(meta.releaseDate.slice(0,4)))score+=80;
  if(/^\d+$/.test(String(candidate?.slug||'')))score-=220;
  else if(String(candidate?.slug||'').includes('-'))score+=120;
  return score;
}

async function mypEditionUrl({apiId,setId,set}){
  const meta=await resolveSetMeta(apiId,set,setId);
  const key='myp-edition:v1483:'+String(setId||set||'');
  const cached=CACHE.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;

  // A MYP cataloga Generations com o nome completo "XY: Generations (GEN)".
  // O slug /pokemon/generations aponta para outra família moderna e fazia a
  // descoberta por coleção falhar para quase todo o master set de 2016.
  if(normalize(setId)==='g1'){
    const value=ROOT+'/pokemon/xy-generations';
    CACHE.set(key,{value,expires:Date.now()+24*60*60*1000});
    return value;
  }

  // Primeiro derive a URL diretamente dos nomes oficiais/localizados do set.
  // Isso evita escolher atalhos genéricos como /pokemon/151 quando a página
  // real é /pokemon/scarlet-violet-151 ou equivalente localizado.
  const derived=[...new Set((meta?.names||[])
    .map(name=>slugify(name))
    .filter(slug=>slug&&slug.length>=4&&!/^\d+$/.test(slug))
  )].sort((a,b)=>b.length-a.length);

  for(const slug of derived.slice(0,8)){
    const candidate=ROOT+'/pokemon/'+slug;
    try{
      const raw=await fetchJina(candidate+'?page=1&sort=-codigoproduto',6500);
      const plain=normalize(stripTags(raw));
      if(!plain||/404|pagina nao encontrada|page not found/.test(plain.slice(0,500)))continue;

      // Exija evidência de que é uma listagem de edição/produtos Pokémon.
      const hasProducts=/itens encontrados|ver ofertas|adicionar a pasta|codigo produto|alta procura/.test(plain);
      const setTokens=(meta?.aliases||[])
        .flatMap(alias=>String(alias||'').split(/\s+/))
        .filter(token=>token.length>=3&&!/^\d+$/.test(token));
      const tokenHits=setTokens.filter(token=>plain.includes(token)).length;
      if(hasProducts&&(tokenHits>0||!setTokens.length)){
        CACHE.set(key,{value:candidate,expires:Date.now()+24*60*60*1000});
        return candidate;
      }
    }catch{}
  }

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
  const key='collection-page:v1485:'+editionUrl+':'+page;
  const cached=CACHE.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;
  const join=editionUrl.includes('?')?'&':'?';
  const url=editionUrl+join+'page='+page+'&per-page=48&sort=-codigoproduto';
  const value=await fetchJina(url,10000);
  CACHE.set(key,{value,expires:Date.now()+30*60*1000});
  return value;
}

async function fastSetPageCandidates({apiId,setId,set,number,name,nameAliases=[]}){
  const meta=await resolveSetMeta(apiId,set,setId);
  const wanted=numberParts(number);
  if(!wanted.n)return[];
  const collector=/^\d+$/.test(wanted.n)?Number(wanted.n):0;
  const total=Math.max(Number(meta?.total||0),collector,48);
  const estimated=collector?Math.max(1,Math.floor(Math.max(0,total-collector)/48)+1):1;

  const slugs=[...new Set([
    slugify(set),
    ...(meta?.names||[]).map(slugify)
  ].filter(slug=>slug&&slug.length>=4&&!/^\d+$/.test(slug)))].slice(0,4);

  const pages=[...new Set([estimated,estimated>1?estimated-1:null,estimated+1].filter(Boolean))];
  const requests=[];
  for(const slug of slugs){
    const editionUrl=ROOT+'/pokemon/'+slug;
    for(const page of pages){
      requests.push((async()=>{
        try{
          const url=editionUrl+'?page='+page+'&per-page=48&sort=-codigoproduto';
          const body=await fetchJina(url,7000);
          return collectionProductCandidatesFromText(body,number,[name,...nameAliases].filter(Boolean));
        }catch{return[]}
      })());
    }
  }
  const groups=await Promise.all(requests);
  return[...new Set(groups.flat())].slice(0,8);
}

async function collectionIndexCandidates({apiId,setId,set,number,name,nameAliases=[]}){
  const meta=await resolveSetMeta(apiId,set,setId);
  const discovered=await mypEditionUrl({apiId,setId,set}).catch(()=>'');
  const derived=(meta?.names||[])
    .map(label=>slugify(label))
    .filter(slug=>slug&&slug.length>=4&&!/^\d+$/.test(slug))
    .sort((a,b)=>b.length-a.length)
    .map(slug=>ROOT+'/pokemon/'+slug);

  const editionUrls=[...new Set([discovered,...derived].filter(Boolean))].slice(0,10);
  if(!editionUrls.length)return[];

  // XY: Generations possui 117 produtos na MYP. Como conhecemos a edição
  // exata, leia as 3 páginas do catálogo em paralelo e resolva pelo número
  // antes de gastar tempo com Actor/busca genérica.
  if(normalize(setId)==='g1'){
    const editionUrl=discovered||ROOT+'/pokemon/xy-generations';
    const bodies=await Promise.all([1,2,3].map(page=>collectionPageText(editionUrl,page).catch(()=>'')));
    for(const body of bodies){
      if(!body)continue;
      const urls=collectionProductCandidatesFromText(body,number,[]);
      if(urls.length)return urls.slice(0,6);
    }
    // O Reader/Jina pode remover os hrefs dos cards desta listagem dinâmica.
    // Não desperdice dezenas de segundos em buscas genéricas: o Chromium
    // enxerga os anchors reais da coleção e é o próximo fallback.
    return[];
  }

  const names=[name,...nameAliases].filter(Boolean);
  const scopedQueries=[number,...names.map(n=>[n,number].filter(Boolean).join(' '))]
    .map(x=>String(x||'').trim()).filter(Boolean).slice(0,4);

  // Teste todas as URLs plausíveis da edição. O número exato é suficiente
  // dentro da coleção; não exija nome/slug localizado para a primeira busca.
  for(const editionUrl of editionUrls){
    for(const query of scopedQueries){
      try{
        const join=editionUrl.includes('?')?'&':'?';
        const url=editionUrl+join+'ProdutoSearch%5Bquery%5D='+encodeURIComponent(query);
        const body=await fetchJina(url,8500);
        const byNumberOnly=query===number;
        const urls=collectionProductCandidatesFromText(body,number,byNumberOnly?[]:names);
        if(urls.length)return urls.slice(0,6);
      }catch{}
    }
  }

  // Mesmo sem filtro de busca, as cartas de número mais alto costumam estar
  // nas primeiras páginas quando ordenadas por código decrescente.
  const effectiveTotal=normalize(setId)==='g1'?117:(meta.total||240);
  const maxPages=Math.max(1,Math.min(8,Math.ceil(Math.max(48,effectiveTotal)/48)));
  const pages=Array.from({length:maxPages},(_,i)=>i+1);
  for(const editionUrl of editionUrls){
    for(let i=0;i<pages.length;i+=3){
      const chunk=pages.slice(i,i+3);
      const bodies=await Promise.all(chunk.map(page=>collectionPageText(editionUrl,page).catch(()=>'')));
      for(const body of bodies){
        if(!body)continue;
        const urls=collectionProductCandidatesFromText(body,number,[]);
        if(urls.length)return urls.slice(0,6);
      }
    }
  }
  return[];
}

async function fastSitemapCandidates(name){
  const wantedSlug=slugify(name);
  const wantedCompact=wantedSlug.replace(/[^a-z0-9]/g,'');
  if(!wantedCompact)return[];
  const found=[];
  const accept=url=>{
    if(!/\/pokemon\/produto\/\d+\//i.test(String(url||'')))return;
    let slug='';
    try{slug=new URL(url).pathname.split('/').filter(Boolean).pop()||''}catch{}
    const compact=slug.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(compact===wantedCompact||compact.includes(wantedCompact)||wantedCompact.includes(compact))found.push(url);
  };
  try{
    const root=await fetchText(ROOT+'/sitemap.xml',6500);
    const first=xmlLocs(root);
    first.forEach(accept);
    if(!found.length){
      const maps=first.filter(x=>/\.xml(?:\?|$)/i.test(x));
      const preferred=[
        ...maps.filter(x=>/pokemon|produto|product|card/i.test(x)),
        ...maps.filter(x=>!/pokemon|produto|product|card/i.test(x))
      ].slice(0,12);
      const bodies=await Promise.all(preferred.map(async mapUrl=>{
        try{return await fetchText(mapUrl,6500)}catch{return''}
      }));
      for(const body of bodies)if(body)xmlLocs(body).forEach(accept);
    }
  }catch{}
  return[...new Set(found)].slice(0,24);
}

async function fastCollectionReaderCandidates({name,nameAliases=[],number,set,setId}){
  const setSlug=slugify(set||setId||'');
  const wanted=numberParts(number);
  if(!setSlug||!wanted.n)return[];

  const names=[...new Set([name,...nameAliases].map(x=>String(x||'').trim()).filter(Boolean))];
  const totalGuess=/^\d+$/.test(wanted.d)?Number(wanted.d):0;
  const collector=/^\d+$/.test(wanted.n)?Number(wanted.n):0;
  const pageSize=96;
  const estimated=collector&&totalGuess?Math.max(1,Math.floor((collector-1)/pageSize)+1):1;
  const pages=[...new Set([1,estimated,estimated-1,estimated+1].filter(x=>x>=1&&x<=6))];
  const urls=pages.map(page=>ROOT+'/pokemon/'+setSlug+'?page='+page+'&per-page='+pageSize);

  const bodies=await Promise.all(urls.map(async url=>{
    try{return await fetchJina(url,6500)}catch{return''}
  }));

  const candidates=[];
  const exactToken=String(number||'').replace(/\s+/g,'').toLowerCase();

  for(const body of bodies){
    if(!body)continue;

    // Reader output typically contains title/number text near the product URL.
    // Work in local windows around each product URL so repeated collector
    // numbers from other cards cannot contaminate the match.
    const text=String(body);
    const matches=[...text.matchAll(/https?:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\/[a-z0-9-]+/gi)];
    for(const m of matches){
      const url=safeMypProductUrl(m[0]);
      if(!url)continue;
      const at=m.index||0;
      const window=text.slice(Math.max(0,at-500),Math.min(text.length,at+500));
      const compact=window.replace(/\s+/g,' ').toLowerCase();
      const found=numberParts(window);
      if(found.n!==wanted.n)continue;
      if(wanted.d&&found.d&&found.d!==wanted.d)continue;
      const normalizedWindow=normalize(window);
      const nameOk=!names.length||names.some(n=>{
        const nn=normalize(n);
        return nn&&(normalizedWindow.includes(nn)||nn.includes(normalize((url.split('/').pop()||'').replace(/-/g,' '))));
      });
      if(!nameOk)continue;
      candidates.push(url);
    }

    // Fallback for markdown/Reader shapes where the URL and text order is
    // unusual: find exact collector token and collect nearby product URLs.
    const low=text.toLowerCase();
    let pos=0;
    while((pos=low.indexOf(exactToken,pos))>=0){
      const window=text.slice(Math.max(0,pos-900),Math.min(text.length,pos+900));
      const normalizedWindow=normalize(window);
      if(names.some(n=>normalizedWindow.includes(normalize(n)))){
        for(const m of window.matchAll(/https?:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\/[a-z0-9-]+/gi)){
          const url=safeMypProductUrl(m[0]);
          if(url)candidates.push(url);
        }
      }
      pos+=exactToken.length||1;
    }
  }

  return [...new Set(candidates)].slice(0,8);
}

async function exactMypGoogleReaderCandidates({name,number}){
  const exact=String(name||'').trim();
  const num=String(number||'').trim();
  if(!exact||!num)return[];
  const query='site:mypcards.com/pokemon/produto "'+exact+' ('+num+')"';
  const google='https://www.google.com/search?q='+encodeURIComponent(query);
  try{
    const body=await fetchJina(google,8500);
    const urls=productUrlsFromText(body,[exact])
      .map(safeMypProductUrl).filter(Boolean);
    return [...new Set(urls)].slice(0,6);
  }catch{
    return[];
  }
}

async function externalSearchCandidates({name,nameAliases=[],number,set}){
  const names=[...new Set([name,...nameAliases].map(x=>String(x||'').trim()).filter(Boolean))];
  const exact=names[0]||String(name||'').trim();
  if(!exact||!number)return[];

  const queries=[...new Set([
    'site:mypcards.com/pokemon/produto "'+exact+' ('+number+')"',
    [exact,'('+number+')','MYP Cards'].filter(Boolean).join(' '),
    ['site:mypcards.com/pokemon/produto',exact,number].filter(Boolean).join(' ')
  ])];
  const urls=[];

  const extract=body=>{
    const raw=String(body||'').replace(/&amp;/gi,'&').replace(/\\u0026/gi,'&');
    const variants=[raw];
    try{variants.push(decodeURIComponent(raw))}catch{}
    for(const text of variants){
      urls.push(...productUrlsFromText(text,names));
      for(const m of text.matchAll(/https?:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\/[a-z0-9-]+/gi))urls.push(m[0]);
      for(const m of text.matchAll(/https?%3A%2F%2F(?:www\.)?mypcards\.com%2Fpokemon%2Fproduto%2F\d+%2F[a-z0-9-]+/gi)){
        try{urls.push(decodeURIComponent(m[0]))}catch{}
      }
      for(const m of text.matchAll(/[?&]uddg=([^&"'<>\s]+)/gi)){
        try{
          const target=decodeURIComponent(m[1]);
          if(/mypcards\.com\/pokemon\/produto\/\d+\//i.test(target))urls.push(target);
        }catch{}
      }
      for(const m of text.matchAll(/(?:\/url\?q=|[?&]q=)(https?%3A%2F%2F(?:www\.)?mypcards\.com%2Fpokemon%2Fproduto%2F\d+%2F[^&"'<>\s]+)/gi)){
        try{
          const target=decodeURIComponent(m[1]);
          if(/mypcards\.com\/pokemon\/produto\/\d+\//i.test(target))urls.push(target);
        }catch{}
      }
    }
  };

  const searchUrls=queries.flatMap(q=>[
    'https://www.google.com/search?num=10&filter=0&q='+encodeURIComponent(q),
    'https://html.duckduckgo.com/html/?q='+encodeURIComponent(q),
    'https://www.bing.com/search?count=10&q='+encodeURIComponent(q)
  ]);

  await Promise.all(searchUrls.map(async searchUrl=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),3800);
    try{
      const rr=await fetch(searchUrl,{
        headers:{
          'Accept':'text/html,application/xhtml+xml',
          'Accept-Language':'pt-BR,pt;q=.9,en;q=.6',
          'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36'
        },
        redirect:'follow',
        signal:controller.signal
      });
      if(rr.ok)extract(await rr.text());
    }catch{}finally{clearTimeout(timer)}
  }));

  return [...new Set(urls.map(safeMypProductUrl).filter(Boolean))].slice(0,8);
}


async function simpleQueueMypLookup({name,number,set,setId,apiId,lang,finish,condition,link}) {
  const started=Date.now();
  const wanted={name,nameAliases:[name],number,set,setId,apiId,lang,finish,condition};
  let productLink=safeMypProductUrl(link);

  // Primeiro caminho: API oficial da própria MYP. Se o token estiver configurado,
  // isso resolve identidade + preços sem scraper, sem Chromium e sem Cloudflare.
  if(!productLink){
    try{
      const official=await officialMypIdentity({name,number,set,setId});
      const card=official?.product;
      if(official?.link&&card){
        const min=Number(card.min_price||0),avg=Number(card.avg_price||0),max=Number(card.max_price||0);
        if(min||avg||max){
          return{
            ok:true,source:'MYP Cards',provider:'MYP official API',mode:'official-api-exact',
            name:card.name_pt||card.name_en||name,number,edition:card.edition_pt||card.edition_en||set,
            finish,condition,link:official.link,
            min,avg:avg||min||max,max,
            samples:null,availableQuantity:Number(card.available_quantity||0)||null,
            exactVariant:true,variantFallback:false,complete:!!(min||avg||max),
            checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started
          };
        }
        productLink=official.link;
      }
    }catch{}
  }

  // V16.38: fila "Cartas para ajustar" usa exatamente o fluxo manual:
  // NOME + " (" + NÚMERO + ")" -> busca da própria MYP -> primeiro produto
  // compatível -> abre a página do produto -> lê a cotação.
  if(!productLink){
    const query=String(name||'').trim()+' ('+String(number||'').trim()+')';
    const searchUrl=ROOT+'/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D='+encodeURIComponent(query);

    let searchBody='';
    try{searchBody=await fetchText(searchUrl,9000)}catch(error){
      return{
        ok:false,error:'simple_search_unavailable',source:'MYP Cards',
        provider:'MYP exact search',query,searchUrl,
        message:String(error?.message||'Não foi possível abrir a busca exata da MYP.'),
        elapsedMs:Date.now()-started
      };
    }

    let candidates=productUrlsFromText(searchBody,[name]).slice(0,5);

    // O navegador humano abre essa busca normalmente, mas o datacenter da Vercel
    // às vezes recebe somente a tela "Executando verificação de segurança".
    // Quando isso acontecer, fazemos UMA única consulta indexada EXATA pela mesma
    // identidade "Nome (numero/total)" e seguimos para o produto encontrado.
    if(!candidates.length){
      candidates=await exactMypGoogleReaderCandidates({name,number});
    }
    if(!candidates.length){
      candidates=await externalSearchCandidates({name,nameAliases:[name],number,set});
    }
    if(!candidates.length){
      try{candidates=await sitemapCandidates(name)}catch{}
    }

    if(!candidates.length){
      // Último caminho, ainda para ESTA MESMA carta: reproduz no Chromium
      // stealth exatamente a busca humana "Nome (numero/total)" na MYP.
      const browserHit=await searchExactMypBrowser(wanted).catch(()=>null);
      if(browserHit?.ok&&hasAnyMarket(browserHit)){
        return{
          ...browserHit,
          source:'MYP Cards',
          provider:'MYP browser exact search',
          checkedAt:new Date().toISOString(),
          elapsedMs:Date.now()-started
        };
      }
      productLink=safeMypProductUrl(browserHit?.link||'');
      if(!productLink){
        return{
          ok:false,error:browserHit?.error||'simple_product_not_found',source:'MYP Cards',
          provider:'MYP exact search',query,searchUrl,
          message:browserHit?.message||'A busca exata não conseguiu obter o link do produto.',
          elapsedMs:Date.now()-started
        };
      }
    }

    // Valida os candidatos em paralelo. Isso é importante para Pokémon com
    // muitas reimpressões (Rotom, Pikachu etc.), onde o link correto pode não ser
    // o primeiro no sitemap/índice.
    const checked=await Promise.all(candidates.slice(0,12).map(async candidate=>{
      try{
        const raw=await fetchText(candidate,7000);
        const identity=pageIdentity(raw);
        return matchesWanted(identity,wanted)?safeMypProductUrl(candidate):'';
      }catch{return''}
    }));
    productLink=checked.find(Boolean)||'';

    if(!productLink){
      return{
        ok:false,error:'simple_wrong_product',source:'MYP Cards',
        provider:'MYP exact search',query,searchUrl,
        message:'A MYP retornou resultados, mas nenhum bateu com nome e número.',
        elapsedMs:Date.now()-started
      };
    }
  }

  try{
    const raw=await fetchText(productLink,10000);
    const identity=pageIdentity(raw);
    if(!matchesWanted(identity,wanted)){
      // Leitura HTTP/Reader pode ter recebido a tela do Cloudflare mesmo com
      // o link exato. Reabre somente ESTE produto no Chromium stealth.
      const browserMarket=await findAndScrapeMypBrowser(productLink,{...wanted,strictDirect:true,quick:true}).catch(()=>null);
      if(browserMarket?.ok&&hasAnyMarket(browserMarket)){
        return{
          ...browserMarket,
          source:'MYP Cards',
          provider:'MYP browser exact product',
          link:safeMypProductUrl(browserMarket.link)||productLink,
          checkedAt:new Date().toISOString(),
          elapsedMs:Date.now()-started
        };
      }
      return{
        ok:false,error:browserMarket?.error||'simple_wrong_product',source:'MYP Cards',
        provider:'MYP exact search',link:productLink,
        message:browserMarket?.message||'O produto aberto não corresponde ao nome e número solicitados.',
        elapsedMs:Date.now()-started
      };
    }

    let market=extractMarket(identity,finish,condition);
    if(!marketFitsFinish(market,finish)&&finishKind(finish)!=='normal'){
      market=await marketAcrossSellerPages(productLink,raw,identity,wanted,finish,condition);
    }
    if(!marketFitsFinish(market,finish)&&!requiresExactMewPtBrVariant({setId,lang,finish})){
      market=sameProductFallbackMarket(identity,finish,condition);
    }

    if(!hasAnyMarket(market)){
      const browserMarket=await findAndScrapeMypBrowser(productLink,{...wanted,strictDirect:true,quick:true}).catch(()=>null);
      if(browserMarket?.ok&&hasAnyMarket(browserMarket)){
        return{
          ...browserMarket,
          source:'MYP Cards',
          provider:'MYP browser exact product',
          link:safeMypProductUrl(browserMarket.link)||productLink,
          checkedAt:new Date().toISOString(),
          elapsedMs:Date.now()-started
        };
      }
      return{
        ok:false,error:browserMarket?.error||'simple_no_price',source:'MYP Cards',
        provider:'MYP exact search',mode:'name-number-first-result',
        name:identity?.name||name,number:identity?.number||number,
        edition:identity?.edition||set,finish,condition,link:productLink,
        message:browserMarket?.message||'Produto exato localizado, mas sem oferta compatível.',
        elapsedMs:Date.now()-started
      };
    }

    return{
      ok:true,source:'MYP Cards',provider:'MYP exact search',mode:'name-number-first-result',
      name:identity?.name||name,number:identity?.number||number,
      edition:identity?.edition||set,finish,condition,link:productLink,
      min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
      samples:market.samples??null,availableQuantity:market.availableQuantity??null,
      exactVariant:market.exactVariant===true,variantFallback:market.variantFallback===true,
      complete:!!(Number(market.min)>0||Number(market.avg)>0||Number(market.max)>0),
      checkedAt:new Date().toISOString(),
      elapsedMs:Date.now()-started
    };
  }catch(error){
    return{
      ok:false,error:error?.name==='AbortError'?'simple_timeout':'simple_read_error',
      source:'MYP Cards',provider:'MYP exact search',link:productLink,
      message:String(error?.message||'Falha ao abrir o produto da MYP.'),
      elapsedMs:Date.now()-started
    };
  }
}

async function fastExactReaderCandidates({name,nameAliases=[],number,set,setId}){
  const names=[...new Set([name,...nameAliases].map(x=>String(x||'').trim()).filter(Boolean))];
  const exact=names[0]||String(name||'').trim();
  if(!exact||!number)return[];
  const setCode=normalize(setId)==='sv03 5'||normalize(setId)==='sv3 5'?'MEW':String(set||'').trim();
  const queries=[...new Set([
    [exact,number].filter(Boolean).join(' '),
    [number,setCode].filter(Boolean).join(' '),
    number
  ].filter(Boolean))].slice(0,3);

  const bodies=await Promise.all(queries.map(async query=>{
    const url=ROOT+'/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D='+encodeURIComponent(query);
    try{return await fetchJina(url,5200)}catch{return''}
  }));

  const out=[];
  for(let i=0;i<bodies.length;i++){
    const body=bodies[i];if(!body)continue;
    const byNumberOnly=queries[i]===number||queries[i]===[number,setCode].filter(Boolean).join(' ');
    out.push(...productUrlsFromText(body,byNumberOnly?[]:names));
  }
  return [...new Set(out.map(safeMypProductUrl).filter(Boolean))].slice(0,10);
}

async function readerSearchCandidates({name,nameAliases=[],number,set,setId}){
  const names=[...new Set([name,...nameAliases].map(x=>String(x||'').trim()).filter(Boolean))];
  const setCode=(normalize(setId)==='sv03 5'||normalize(setId)==='sv3 5')?'MEW':normalize(setId)==='g1'?'GEN':String(set||'').trim();
  const queries=[...new Set([
    ...names.map(n=>number?(n+' ('+number+')'):n),
    ...names.map(n=>[n,number].filter(Boolean).join(' ')),
    [number,setCode].filter(Boolean).join(' '),
    ...names.flatMap(n=>[
      [n,number,setCode].filter(Boolean).join(' '),
      [n,setCode].filter(Boolean).join(' ')
    ]),
    number,
    ...names
  ].map(x=>String(x||'').trim()).filter(Boolean))].slice(0,12);

  const urls=[];
  for(const query of queries){
    const variants=[
      ROOT+'/pokemon?ProdutoSearch%5Bquery%5D='+encodeURIComponent(query),
      ROOT+'/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D='+encodeURIComponent(query)
    ];
    for(const searchUrl of variants){
      try{
        // V14.97: preferir o Reader para páginas de busca da MYP. A leitura
        // direta é frequentemente bloqueada pelo Cloudflare e fazia cartas
        // existentes terminarem como not_found.
        const body=await fetchJina(searchUrl,11000);
        const byNumber=query===number||query===[number,setCode].filter(Boolean).join(' ');
        urls.push(...productUrlsFromText(body,byNumber?[]:names));
        if(urls.length>=12)break;
      }catch{}
    }
    if(urls.length>=12)break;
  }
  return [...new Set(urls)].slice(0,18);
}
async function familySeedCandidates(wanted){
  const names=[...new Set([wanted?.name,...(wanted?.nameAliases||[])].filter(Boolean))];
  // V14.97: não confiar em uma única rota de descoberta. Mistura catálogo,
  // busca e sitemap e deixa resolvePage validar número/coleção/idioma.
  const [indexed,search,groups]=await Promise.all([
    collectionIndexCandidates(wanted).catch(()=>[]),
    readerSearchCandidates(wanted).catch(()=>[]),
    Promise.all(names.map(n=>sitemapCandidates(n).catch(()=>[]))).then(x=>x.flat())
  ]);
  return [...new Set([...(indexed||[]),...(search||[]),...(groups||[])])].slice(0,24);
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


function requiresExactMewPtBrVariant({setId,lang,finish}={}){
  const rawSet=String(setId||'').trim().toLowerCase();
  const rawLang=String(lang||'').trim().toLowerCase();
  return ['sv03.5','sv3.5'].includes(rawSet)
    && ['pt-br','pt'].includes(rawLang)
    && finishKind(finish)!=='normal';
}
function sameProductFallbackMarket(identity,finish,condition){
  const strict=extractMarket(identity,finish,condition);
  if(hasAnyMarket(strict))return strict;

  // A MYP nem sempre rotula explicitamente Reverse/Foil/Poké Ball/Master Ball
  // nas linhas de estoque. Quando a página da carta já foi validada por
  // coleção + número + código, use o mercado agregado DA MESMA IMPRESSÃO como
  // fallback em vez de tratar a carta como sem cotação.
  const generic=extractMarket(identity,'Normal',condition);
  if(!hasAnyMarket(generic))return strict;

  return {
    ...generic,
    exactVariant:false,
    variantFallback:true,
    requestedFinish:finish
  };
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

  while(queue.length&&inspected<24){
    const url=queue.shift();
    if(!url||seen.has(url))continue;
    seen.add(url);inspected++;
    try{
      const raw=await fetchJina(url,6500);
      const identity=pageIdentity(raw);
      const exact=matchesWanted(identity,wanted);

      if(exact){
        let market=await marketAcrossSellerPages(url,raw,identity,wanted,finish,condition);
        if(!marketFitsFinish(market,finish)&&!requiresExactMewPtBrVariant({setId,lang,finish}))market=sameProductFallbackMarket(identity,finish,condition);
        const wantedSet=normalize(set),edition=normalize(identity.edition),code=normalize(identity.code);
        let score=1000+marketIdentityLocaleScore(identity,{setId,lang})+(market.samples||0);
        if(wantedSet&&(edition.includes(wantedSet)||wantedSet.includes(edition)||code.includes(wantedSet)))score+=280;
        const candidate={url,identity,market,score};
        if(!best||candidate.score>best.score)best=candidate;
        if(hasAnyMarket(market))break;
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


async function resolveBatchMypSearchFirst(items=[]){
  const rows=(Array.isArray(items)?items:[]).slice(0,10).map(item=>({
    ...item,
    key:String(item?.key||item?.id||''),
    name:String(item?.name||'').trim(),
    number:String(item?.number||'').trim(),
    set:String(item?.set||item?.setName||'').trim(),
    setId:String(item?.setId||'').trim(),
    lang:String(item?.lang||'').trim(),
    finish:String(item?.finish||'Normal').trim(),
    condition:String(item?.condition||'Nova').trim(),
    link:safeMypProductUrl(item?.link||'')
  }));
  const started=Date.now();
  if(!rows.length)return{ok:true,items:[],elapsedMs:0};

  // Stage 1: ten exact web-index lookups in parallel. This mirrors the query
  // that reliably resolves MYP products from a browser/search engine and avoids
  // crawling a whole collection before we even know the exact product URL.
  await Promise.all(rows.map(async item=>{
    if(item.link)return;
    try{
      const candidates=await Promise.race([
        externalSearchCandidates({
          name:item.name,
          nameAliases:[],
          number:item.number,
          set:item.set
        }),
        new Promise(resolve=>setTimeout(()=>resolve([]),3600))
      ]);
      if(Array.isArray(candidates)&&candidates.length)item.link=safeMypProductUrl(candidates[0]);
    }catch{}
  }));

  // Stage 2: read the ten exact product pages concurrently. Normal/Reverse/Foil
  // are all seller rows on the same MYP product page, so one page identifies the
  // product and usually contains the requested market immediately.
  const results=await Promise.all(rows.map(async item=>{
    if(!item.link){
      return{key:item.key,name:item.name,number:item.number,ok:false,error:'search_exact_product_not_found',elapsedMs:Date.now()-started};
    }
    try{
      const raw=await fetchText(item.link,4300);
      const identity=pageIdentity(raw);
      const wanted={name:item.name,nameAliases:[item.name],number:item.number,set:item.set,setId:item.setId,lang:item.lang};
      if(!matchesWanted(identity,wanted)){
        return{key:item.key,name:item.name,number:item.number,ok:false,error:'search_wrong_product',link:item.link,elapsedMs:Date.now()-started};
      }

      let market=extractMarket(identity,item.finish,item.condition);

      // Same-attempt finish fallback: only if the requested market is not on the
      // first page, read seller page 2 and 3 concurrently. No retry/requeue.
      if(!marketFitsFinish(market,item.finish)&&finishKind(item.finish)!=='normal'){
        const base=safeMypProductUrl(item.link);
        const variantBodies=await Promise.all([
          fetchJina(base+'?estoque-cert-page=2',2400).catch(()=>''),
          fetchJina(base+'?estoque-outros-page=2',2400).catch(()=>''),
          fetchJina(base+'?estoque-cert-page=3',2400).catch(()=>''),
          fetchJina(base+'?estoque-outros-page=3',2400).catch(()=>'')
        ]);
        const markets=[market];
        for(const body of variantBodies){
          if(!body)continue;
          const variantIdentity=pageIdentity(body);
          if(matchesWanted(variantIdentity,wanted))markets.push(extractMarket(variantIdentity,item.finish,item.condition));
        }
        market=mergeVariantMarkets(markets)||market;
      }

      if(!marketFitsFinish(market,item.finish)&&!requiresExactMewPtBrVariant(item)){
        market=sameProductFallbackMarket(identity,item.finish,item.condition);
      }
      if(!hasAnyMarket(market)){
        return{key:item.key,name:item.name,number:item.number,ok:false,error:'search_no_price',link:item.link,elapsedMs:Date.now()-started};
      }
      return{
        key:item.key,name:item.name,number:item.number,ok:true,
        source:'MYP Cards',provider:'MYP search-index batch10',mode:'search-index-batch10-one-shot',
        link:item.link,edition:identity.edition||item.set,finish:item.finish,condition:item.condition,
        min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
        samples:market.samples??null,availableQuantity:market.availableQuantity??null,
        exactVariant:market.exactVariant===true,variantFallback:market.variantFallback===true,
        complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
        checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started
      };
    }catch(error){
      return{key:item.key,name:item.name,number:item.number,ok:false,error:'search_batch_read_error',link:item.link,message:String(error?.message||error||''),elapsedMs:Date.now()-started};
    }
  }));

  return{ok:true,items:results,elapsedMs:Date.now()-started};
}

async function resolveBatchMypHttp(items=[]){
  const rows=(Array.isArray(items)?items:[]).slice(0,10).map(item=>({
    ...item,
    key:String(item?.key||item?.id||''),
    name:String(item?.name||'').trim(),
    number:String(item?.number||'').trim(),
    set:String(item?.set||item?.setName||'').trim(),
    setId:String(item?.setId||'').trim(),
    lang:String(item?.lang||'').trim(),
    finish:String(item?.finish||'Normal').trim(),
    condition:String(item?.condition||'Nova').trim(),
    link:safeMypProductUrl(item?.link||''),
    _trustedLink:!!safeMypProductUrl(item?.link||'')
  }));
  const started=Date.now();
  if(!rows.length)return{ok:true,items:[],elapsedMs:0};

  const setGroups=new Map();
  for(const item of rows){
    if(item.link)continue;
    const slug=slugify(item.set);
    const key=[slug,item.setId].join('|');
    if(!setGroups.has(key))setGroups.set(key,{slug,set:item.set,setId:item.setId,items:[]});
    setGroups.get(key).items.push(item);
  }

  // V16.32: resolve every card in the current ten from the COMPLETE edition
  // catalog, fetched in parallel. We do not guess an estimated page and we do
  // not schedule another attempt. For a 191-card set this is ~5-7 catalog pages,
  // all requested at once, then the ten exact product pages are read in parallel.
  await Promise.all([...setGroups.values()].map(async group=>{
    if(!group.items.some(item=>!item.link))return;

    let meta={total:0,names:[]};
    let discoveredBase='';
    try{
      [meta,discoveredBase]=await Promise.all([
        resolveSetMeta('',group.set,group.setId).catch(()=>({total:0,names:[]})),
        Promise.race([
          mypEditionUrl({setId:group.setId,set:group.set}),
          new Promise(resolve=>setTimeout(()=>resolve(''),2200))
        ]).catch(()=> '')
      ]);
    }catch{}

    const bases=[...new Set([
      discoveredBase,
      group.slug?ROOT+'/pokemon/'+group.slug:'',
      ...(Array.isArray(meta?.names)?meta.names:[]).map(name=>ROOT+'/pokemon/'+slugify(name))
    ].filter(Boolean))].slice(0,3);

    const maxCollector=Math.max(0,...group.items.map(item=>{
      const np=numberParts(item.number);
      return /^\d+$/.test(np.n)?Number(np.n):0;
    }));
    const pageSize=48;
    const total=Math.max(Number(meta?.total||0),maxCollector,pageSize);
    const pageCount=Math.max(1,Math.min(12,Math.ceil(total/pageSize)+1));

    const requests=[];
    for(const base of bases){
      for(let page=1;page<=pageCount;page++){
        const join=base.includes('?')?'&':'?';
        const url=base+join+'page='+page+'&per-page='+pageSize+'&sort=-codigoproduto';
        requests.push(fetchJina(url,4300).catch(()=>''));
      }
    }
    const bodies=await Promise.all(requests);

    for(const item of group.items){
      if(item.link)continue;
      for(const body of bodies){
        const candidates=collectionProductCandidatesFromText(body,item.number,[item.name]);
        if(candidates.length){
          item.link=candidates[0];
          item._trustedLink=true;
          break;
        }
      }
    }

    // Exact edition search is a same-attempt fallback only for cards not present
    // in the catalog pages returned above (promos/odd numbering). Still parallel.
    await Promise.all(group.items.filter(item=>!item.link).map(async item=>{
      const query=[item.name,item.number].filter(Boolean).join(' ');
      const searches=bases.map(base=>{
        const join=base.includes('?')?'&':'?';
        return fetchJina(base+join+'ProdutoSearch%5Bquery%5D='+encodeURIComponent(query)+'&per-page=48&sort=-codigoproduto',3500).catch(()=>'');
      });
      const searchBodies=await Promise.all(searches);
      for(const body of searchBodies){
        const candidates=collectionProductCandidatesFromText(body,item.number,[item.name]);
        if(candidates.length){
          item.link=candidates[0];
          item._trustedLink=true;
          break;
        }
      }
    }));
  }));

  const results=await Promise.all(rows.map(async item=>{
    if(!item.link){
      return{key:item.key,name:item.name,number:item.number,ok:false,error:'batch_exact_product_not_found',elapsedMs:Date.now()-started};
    }
    try{
      const raw=await fetchText(item.link,4200);
      const identity=pageIdentity(raw);
      const wanted={name:item.name,nameAliases:[item.name],number:item.number,set:item.set,setId:item.setId,lang:item.lang};
      const strictOk=matchesWanted(identity,wanted);
      const rawText=stripTags(raw);
      const slugKey=slugify(item.name).replace(/-/g,'');
      const productSlug=(String(item.link).split('/').filter(Boolean).pop()||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
      const deterministicOk=!!item._trustedLink
        && textHasCollectorNumber(rawText,item.number)
        && (!slugKey||productSlug.includes(slugKey)||slugKey.includes(productSlug)||normalize(rawText).includes(normalize(item.name)));
      if(!strictOk&&!deterministicOk){
        return{key:item.key,name:item.name,number:item.number,ok:false,error:'batch_wrong_product',link:item.link,elapsedMs:Date.now()-started};
      }
      let market=extractMarket(identity,item.finish,item.condition);
      if(!marketFitsFinish(market,item.finish)&&!requiresExactMewPtBrVariant(item)){
        market=sameProductFallbackMarket(identity,item.finish,item.condition);
      }
      if(!hasAnyMarket(market)){
        return{key:item.key,name:item.name,number:item.number,ok:false,error:'batch_no_price',link:item.link,elapsedMs:Date.now()-started};
      }
      return{
        key:item.key,name:item.name,number:item.number,ok:true,
        source:'MYP Cards',provider:'MYP HTTP batch10',mode:'http-batch10-set-page',
        link:item.link,edition:identity.edition||item.set,finish:item.finish,condition:item.condition,
        min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
        samples:market.samples??null,availableQuantity:market.availableQuantity??null,
        exactVariant:market.exactVariant===true,variantFallback:market.variantFallback===true,
        complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
        checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started
      };
    }catch(error){
      return{key:item.key,name:item.name,number:item.number,ok:false,error:'batch_http_error',link:item.link,message:String(error?.message||error||''),elapsedMs:Date.now()-started};
    }
  }));

  return{ok:true,items:results,elapsedMs:Date.now()-started};
}

async function resolveBatchMypActor(items=[]){
  const rows=(Array.isArray(items)?items:[]).slice(0,10);
  const started=Date.now();
  if(!process.env.APIFY_API_TOKEN){
    return{ok:false,error:'apify_not_configured',items:rows.map(item=>({
      key:String(item?.key||item?.id||''),name:String(item?.name||''),number:String(item?.number||''),
      ok:false,error:'apify_not_configured'
    })),elapsedMs:Date.now()-started};
  }

  const results=await Promise.all(rows.map(async item=>{
    const wanted={
      name:String(item?.name||'').trim(),
      nameAliases:Array.isArray(item?.nameAliases)?item.nameAliases:[],
      number:String(item?.number||'').trim(),
      set:String(item?.set||item?.setName||'').trim(),
      setId:String(item?.setId||'').trim(),
      lang:String(item?.lang||'').trim(),
      finish:String(item?.finish||'Normal').trim(),
      condition:String(item?.condition||'Nova').trim(),
      maxQueries:1,
      timeoutSeconds:8
    };
    const key=String(item?.key||item?.id||'');
    try{
      const found=await queryMyp(wanted);
      return{
        key,name:wanted.name,number:wanted.number,
        ok:hasAnyMarket(found),
        source:'MYP Cards',provider:'Apify batch10 one-shot',mode:'apify-batch10-one-shot',
        link:safeMypProductUrl(found?.link||''),
        min:Number(found?.min||0),avg:Number(found?.avg||0),max:Number(found?.max||0),
        samples:found?.samples??null,availableQuantity:found?.availableQuantity??null,
        exactVariant:found?.exactVariant===true,variantFallback:found?.variantFallback===true,
        complete:!!(Number(found?.min)>0&&Number(found?.avg)>0&&Number(found?.max)>0),
        error:hasAnyMarket(found)?'':String(found?.error||'batch_no_price'),
        checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started
      };
    }catch(error){
      return{key,name:wanted.name,number:wanted.number,ok:false,error:String(error?.code||error?.message||'apify_batch_error'),elapsedMs:Date.now()-started};
    }
  }));
  return{ok:true,items:results,elapsedMs:Date.now()-started};
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
  const catalog=String(req.query.catalog||'')==='1';
  const batchResolve=String(req.query.batchResolve||'')==='1';
  const browserBatch=String(req.query.browserBatch||'')==='1';
  const identityOnly=String(req.query.identityOnly||'')==='1';
  const identityDebug=String(req.query.identityDebug||'')==='1';
  const queueSimple=String(req.query.queueSimple||'')==='1';
  const setReaderDebug=String(req.query.setReaderDebug||'')==='1';
  const sitemapDebug=String(req.query.sitemapDebug||'')==='1';
  const webSearchDebug=String(req.query.webSearchDebug||'')==='1';
  const actorRawDebug=String(req.query.actorRawDebug||'')==='1';
  if(fast||catalog||identityOnly||identityDebug||queueSimple)res.setHeader('Cache-Control','no-store, max-age=0');
  if(actorRawDebug){
    const wanted={
      name:String(name||'Rotom'),nameAliases:[String(name||'Rotom')],
      number:String(number||'061/191'),set:String(set||'Fagulhas Impetuosas'),
      setId:String(setId||'sv08'),apiId,
      lang:'',finish:'Normal',condition:'',
      maxQueries:1,timeoutSeconds:20
    };
    try{
      const result=await queryMyp(wanted);
      return res.status(200).json({ok:true,result});
    }catch(error){
      return res.status(200).json({ok:false,error:String(error?.code||error?.message||error)});
    }
  }

  if(webSearchDebug){
    const wanted={
      name:String(name||'Rotom'),nameAliases:[String(name||'Rotom')],
      number:String(number||'061/191'),set:String(set||'Fagulhas Impetuosas'),
      setId:String(setId||'sv08'),apiId,lang:String(lang||'pt-br'),
      finish:String(finish||'Normal'),condition:String(condition||'Nova'),quick:true
    };
    const result=await searchWebExactMypBrowser(wanted,'');
    return res.status(200).json({ok:!!result?.ok,result});
  }

  if(sitemapDebug){
    const targetName=String(req.query.name||name||'Rotom').trim();
    try{
      const urls=await sitemapCandidates(targetName);
      return res.status(200).json({ok:true,name:targetName,count:urls.length,urls:urls.slice(0,80)});
    }catch(error){
      return res.status(200).json({ok:false,error:String(error?.code||error?.message||error)});
    }
  }

  if(setReaderDebug){
    const slug=slugify(set||'Fagulhas Impetuosas');
    const pageNo=Math.max(1,Number(req.query.page||1)||1);
    const target=ROOT+'/pokemon/'+slug+'?page='+pageNo+'&per-page=48&sort=-codigoproduto';
    let body='';
    try{body=await fetchJina(target,12000)}catch(error){
      return res.status(200).json({ok:false,error:String(error?.code||error?.message||error),target});
    }
    const urls=productUrlsFromText(body,[]);
    return res.status(200).json({
      ok:true,target,length:body.length,count:urls.length,
      urls:urls.slice(0,120),
      sample:body.slice(0,1800)
    });
  }

  if(String(req.query.rotomDebug||'')==='1'){
    const result=await searchExactMypBrowser({
      name:'Rotom',nameAliases:['Rotom'],number:'061/191',
      set:'Fagulhas Impetuosas',setId:'sv08',apiId:'sv08-061',
      lang:'pt-br',finish:'Normal',condition:'Nova',quick:true
    });
    return res.status(200).json({build:'16.40-debug',result});
  }


  if(queueSimple){
    if(!name||!number)return res.status(400).json({ok:false,error:'name_number_required'});

    // V16.45: sem resolvedor paralelo, sem busca externa e sem Chromium para
    // descobrir a carta. Usa EXATAMENTE o fluxo manual confirmado:
    // "Nome (numero/total)" -> busca da própria MYP -> primeiro produto válido
    // -> abre o produto -> lê e salva a cotação.
    const result=await simpleQueueMypLookup({
      name,number,set,setId,apiId,lang,finish,condition,link
    });
    return res.status(200).json(result);
  }

  if(browserBatch){
    let items=[];
    try{
      const raw=String(req.query.items||'');
      items=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
    }catch{}
    const result=await Promise.race([
      resolveBatchMypLinksBrowser(items),
      new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'browser_batch_timeout',items:[]}),30000))
    ]);
    return res.status(200).json(result);
  }

  if(batchResolve){
    let items=[];
    try{
      const raw=String(req.query.items||'');
      items=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
    }catch{}

    // V16.29: one authoritative batch attempt, but with two independent
    // discovery engines RUNNING IN PARALLEL inside the same 10.5s budget.
    // The HTTP set-page resolver is always available; Apify is only an optional
    // accelerator. We merge per-card results and never schedule a second attempt.
    const run=async(fn)=>{try{return await fn()}catch(error){return{ok:false,error:String(error?.message||error||'batch_resolver_error'),items:[]}}};
    const [searchResult,httpResult,actorResult]=await Promise.race([
      Promise.all([
        run(()=>resolveBatchMypSearchFirst(items)),
        run(()=>resolveBatchMypHttp(items)),
        run(()=>resolveBatchMypActor(items))
      ]),
      new Promise(resolve=>setTimeout(()=>resolve([
        {ok:false,error:'batch_search_timeout',items:[]},
        {ok:false,error:'batch_http_timeout',items:[]},
        {ok:false,error:'batch_actor_timeout',items:[]}
      ]),10800))
    ]);

    const byKey=new Map();
    const ingest=(payload,priority)=>{
      for(const item of Array.isArray(payload?.items)?payload.items:[]){
        const key=String(item?.key||'');
        if(!key)continue;
        const current=byKey.get(key);
        const hasPrice=hasAnyMarket(item);
        const currentHasPrice=hasAnyMarket(current);
        if(!current || (hasPrice&&!currentHasPrice) || (hasPrice===currentHasPrice&&priority>(current?._priority||0))){
          byKey.set(key,{...item,_priority:priority});
        }
      }
    };
    ingest(searchResult,3);
    ingest(httpResult,2);
    ingest(actorResult,1);

    const merged=(Array.isArray(items)?items:[]).slice(0,10).map(raw=>{
      const key=String(raw?.key||raw?.id||'');
      const hit=byKey.get(key);
      if(hit){
        const {_priority,...clean}=hit;
        return clean;
      }
      return{
        key,
        name:String(raw?.name||''),
        number:String(raw?.number||''),
        ok:false,
        error:String(searchResult?.error||httpResult?.error||actorResult?.error||'batch_no_result')
      };
    });

    return res.status(200).json({
      ok:true,
      mode:'batch10-search-plus-http-one-shot',
      items:merged
    });
  }

  if(catalog){
    const result=await Promise.race([
      scanSetCatalogMypBrowser({set,setName:set,setId,lang}),
      new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'set_catalog_timeout',items:[]}),9500))
    ]);
    return res.status(200).json(result);
  }

  if(!name)return res.status(400).json({ok:false,error:'name_required'});

  if(identityOnly){
    const official=await officialMypIdentity({name,number,set,setId});
    return res.status(200).json({
      ok:!!official?.link,
      link:safeMypProductUrl(official?.link||''),
      provider:official?.provider||'',
      score:Number(official?.score||0),
      error:official?.link?'':'official_identity_not_found'
    });
  }

  if(identityDebug){
    const started=Date.now();
    const run=async(label,fn)=>{
      const t=Date.now();
      try{return{label,ms:Date.now()-t,links:await fn()}}
      catch(error){return{label,ms:Date.now()-t,links:[],error:String(error?.message||error)}}
    };
    const [exact,collection,external,setpage]=await Promise.all([
      run('exact-reader',()=>fastExactReaderCandidates({name,nameAliases:[name],number,set,setId})),
      run('collection-reader',()=>fastCollectionReaderCandidates({name,nameAliases:[name],number,set,setId})),
      run('external-search',()=>externalSearchCandidates({name,nameAliases:[name],number,set})),
      run('set-page',()=>fastSetPageCandidates({apiId,setId,set,number,name,nameAliases:[name]}))
    ]);
    return res.status(200).json({ok:true,totalMs:Date.now()-started,exact,collection,external,setpage});
  }

  let directLink=safeMypProductUrl(link);
  let catalogResolvedLink=false;
  const nameAliases=fast&&directLink?[name]:await resolveNameAliases(name,apiId);

  // V16.16: worker FAST path exits here. None of the historical discovery
  // branches below are allowed to run for queued cards.
  if(fast){
    const wanted={name,nameAliases,number,set,setId,apiId,lang,finish,condition,strictDirect:true,quick:true};

    if(!directLink){
      // V16.21: first resolve the exact MYP product identity through the official
      // API when a token is configured. This avoids Cloudflare/search scraping
      // entirely for identity and leaves only the finish-specific market read.
      const official=await officialMypIdentity({name,number,set,setId});
      if(official?.link){
        directLink=official.link;
      }
    }

    if(!directLink){
      // V16.19 fallback: one definitive, non-browser retry cycle. Run the three fast
      // indexes in parallel (Reader collection, external search, fast set pages),
      // then validate the strongest product pages in parallel. No second attempt,
      // no requeue.
      const candidates=await Promise.race([
        Promise.all([
          fastExactReaderCandidates({name,nameAliases,number,set,setId}).catch(()=>[]),
          fastCollectionReaderCandidates({name,nameAliases,number,set,setId}).catch(()=>[]),
          externalSearchCandidates({name,nameAliases,number,set}).catch(()=>[]),
          fastSetPageCandidates({apiId,setId,set,number,name,nameAliases}).catch(()=>[])
        ]).then(groups=>[...new Set(groups.flat().map(safeMypProductUrl).filter(Boolean))].slice(0,10)),
        new Promise(resolve=>setTimeout(()=>resolve([]),6500))
      ]);

      if(candidates.length){
        const inspected=await Promise.all(candidates.slice(0,6).map(async candidate=>{
          try{
            const raw=await fetchJina(candidate,4200);
            const identity=pageIdentity(raw);
            if(!matchesWanted(identity,{name,nameAliases,number,set,setId,lang}))return null;
            let market=await marketAcrossSellerPages(candidate,raw,identity,{name,nameAliases,number,set,setId,lang},finish,condition);
            if(!marketFitsFinish(market,finish)&&!requiresExactMewPtBrVariant({setId,lang,finish})){
              market=sameProductFallbackMarket(identity,finish,condition);
            }
            return{candidate,identity,market};
          }catch{return null}
        }));
        const hit=inspected.find(x=>x&&hasAnyMarket(x.market))
          ||inspected.find(Boolean);
        if(hit&&hasAnyMarket(hit.market)){
          return res.status(200).json({
            ok:true,source:'MYP Cards',provider:'MYP fast reader one-shot',mode:'reader-parallel-exact',
            name:hit.identity?.name||name,number:hit.identity?.number||number,
            edition:hit.identity?.edition||set,finish,condition,link:hit.candidate,
            min:Number(hit.market.min||0),avg:Number(hit.market.avg||0),max:Number(hit.market.max||0),
            samples:hit.market.samples??null,availableQuantity:hit.market.availableQuantity??null,
            exactVariant:hit.market.exactVariant===true,variantFallback:hit.market.variantFallback===true,
            complete:!!(Number(hit.market.min)>0&&Number(hit.market.avg)>0&&Number(hit.market.max)>0),
            checkedAt:new Date().toISOString()
          });
        }
        if(hit?.candidate){
          return res.status(200).json({
            ok:false,error:'fast_no_price',source:'MYP Cards',provider:'MYP fast reader one-shot',
            name,number,edition:hit.identity?.edition||set,finish,condition,link:hit.candidate,
            message:'Produto exato localizado, mas sem oferta compatível para este acabamento.'
          });
        }
      }

      return res.status(200).json({
        ok:false,error:'one_shot_no_quote',source:'MYP Cards',provider:'MYP fast reader one-shot',
        link:'',message:'A tentativa única não localizou uma cotação compatível.'
      });
    }

    // Known-link path: real product page only.
    try{
      const raw=await fetchText(directLink,8500);
      const identity=pageIdentity(raw);
      if(matchesWanted(identity,wanted)){
        let market=await marketAcrossSellerPages(directLink,raw,identity,wanted,finish,condition);
        if(!marketFitsFinish(market,finish)&&!requiresExactMewPtBrVariant({setId,lang,finish})){
          market=sameProductFallbackMarket(identity,finish,condition);
        }
        if(hasAnyMarket(market)){
          return res.status(200).json({
            ok:true,source:'MYP Cards',provider:'Direct MYP HTML',mode:'direct-known-product',
            name:identity?.name||name,number:identity?.number||number,edition:identity?.edition||set,
            finish,condition,link:directLink,
            min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
            samples:market.samples??null,availableQuantity:market.availableQuantity??null,
            exactVariant:market.exactVariant===true,variantFallback:market.variantFallback===true,
            complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
            checkedAt:new Date().toISOString()
          });
        }
      }
    }catch(error){
      console.warn('MYP fast direct:',error?.message||error);
    }

    return res.status(200).json({
      ok:false,error:'fast_no_price',source:'MYP Cards',provider:'Direct MYP HTML',
      link:directLink,message:'Produto localizado, mas sem cotação compatível nesta leitura.'
    });
  }

  // V16.17: fast no-link path goes straight to the estimated page of the
  // selected MYP edition. It validates exact name + number before accepting.
  if(fast&&!directLink&&name&&number&&set){
    try{
      const wanted={name,nameAliases,number,set,setId,apiId,lang,finish,condition};
      const exact=await Promise.race([
        searchFastSetPageMypBrowser(wanted),
        new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'fast_set_page_timeout'}),12000))
      ]);
      const exactLink=safeMypProductUrl(exact?.link);
      if(exactLink)directLink=exactLink;
      if(exact?.ok&&hasAnyMarket(exact)){
        return res.status(200).json({
          ok:true,source:'MYP Cards',provider:'MYP fast set page',mode:exact.mode||'browser-fast-set-page',
          name,number,edition:exact.edition||set,finish,condition,link:exactLink||'',
          min:Number(exact.min||0),avg:Number(exact.avg||0),max:Number(exact.max||0),
          samples:exact.samples??null,availableQuantity:exact.availableQuantity??null,
          exactVariant:exact.exactVariant===true,variantFallback:exact.variantFallback===true,
          complete:!!(Number(exact.min)>0&&Number(exact.avg)>0&&Number(exact.max)>0),
          checkedAt:new Date().toISOString()
        });
      }
    }catch(error){
      console.warn('MYP fast set page:',error?.message||error);
    }
  }

  // V16.11: cheap exact discovery first. Search-engine result pages are read
  // through Reader, then every MYP candidate is validated by name + collector
  // number before we accept its URL or price.
  if(fast&&!directLink&&name&&number){
    try{
      const wanted={name,nameAliases,number,set,setId,apiId,lang,finish,condition};
      const [external,sitemap]=await Promise.all([
        externalSearchCandidates({name,nameAliases,number,set}),
        fastSitemapCandidates(name)
      ]);
      const candidates=[...new Set([...(external||[]),...(sitemap||[])])];
      const checked=await Promise.all(candidates.slice(0,10).map(async candidate=>{
        try{
          const raw=await fetchText(candidate,6500);
          const identity=pageIdentity(raw);
          if(!matchesWanted(identity,wanted))return null;
          let market=await marketAcrossSellerPages(candidate,raw,identity,wanted,finish,condition);
          if(!marketFitsFinish(market,finish)&&!requiresExactMewPtBrVariant({setId,lang,finish})){
            market=sameProductFallbackMarket(identity,finish,condition);
          }
          return{candidate,identity,market};
        }catch{return null}
      }));
      const hit=checked.find(x=>x&&hasAnyMarket(x.market))||checked.find(Boolean);
      if(hit){
        directLink=safeMypProductUrl(hit.candidate);
        if(hasAnyMarket(hit.market)){
          return res.status(200).json({
            ok:true,source:'MYP Cards',provider:'External exact Reader',mode:'external-exact-reader',
            name:hit.identity?.name||name,number:hit.identity?.number||number,
            edition:hit.identity?.edition||set,finish,condition,link:directLink,
            min:Number(hit.market.min||0),avg:Number(hit.market.avg||0),max:Number(hit.market.max||0),
            samples:hit.market.samples??null,availableQuantity:hit.market.availableQuantity??null,
            exactVariant:hit.market.exactVariant===true,variantFallback:hit.market.variantFallback===true,
            complete:!!(Number(hit.market.min)>0&&Number(hit.market.avg)>0&&Number(hit.market.max)>0),
            checkedAt:new Date().toISOString()
          });
        }
      }
    }catch(error){
      console.warn('MYP external exact Reader:',error?.message||error);
    }
  }

  // V16.10: for the worker's fast no-link path, mirror the search that
  // reliably finds MYP pages externally: "site:mypcards.com/pokemon/produto
  // Name number". The native MYP search remains the normal/manual fallback.
  if(!directLink&&name&&number){
    try{
      const wanted={name,nameAliases,number,set,setId,apiId,lang,finish,condition};
      const exact=await Promise.race([
        searchExactMypBrowser(wanted),
        new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'exact_browser_timeout'}),fast?10500:12000))
      ]);
      const exactLink=safeMypProductUrl(exact?.link);
      if(exactLink)directLink=exactLink;
      if(exact?.ok&&hasAnyMarket(exact)){
        return res.status(200).json({
          ok:true,source:'MYP Cards',provider:fast?'External exact search':'Browser exact search',
          mode:exact.mode||(fast?'browser-web-search-exact':'browser-exact-only'),
          name,number,edition:exact.edition||set,finish,condition,link:exactLink||'',
          min:Number(exact.min||0),avg:Number(exact.avg||0),max:Number(exact.max||0),
          samples:exact.samples??null,availableQuantity:exact.availableQuantity??null,
          exactVariant:exact.exactVariant===true,variantFallback:exact.variantFallback===true,
          complete:!!(Number(exact.min)>0&&Number(exact.avg)>0&&Number(exact.max)>0),
          checkedAt:new Date().toISOString()
        });
      }
    }catch(error){
      console.warn('MYP exact discovery:',error?.message||error);
    }
  }

  // V15.12: exact MYP site-style search FIRST: "Name (number/total)".
  // This avoids spending tens of seconds in Reader/Jina before trying the
  // search pattern that resolves the card immediately on MYP.
  if(!fast&&!directLink&&process.env.APIFY_API_TOKEN){
    try{
      const exact=await queryMyp({name,nameAliases,number,set,setId,lang,finish,condition});
      const exactLink=safeMypProductUrl(exact?.link);
      if(exactLink)directLink=exactLink;
      if(exactLink&&hasAnyMarket(exact)){
        return res.status(200).json({
          ok:true,source:'MYP Cards',provider:'Apify exact-first',mode:'exact-name-number',
          name,number,edition:set,finish,condition,link:exactLink,
          min:Number(exact.min||0),avg:Number(exact.avg||0),max:Number(exact.max||0),
          samples:exact.samples??null,availableQuantity:exact.availableQuantity??null,
          exactVariant:exact.exactVariant===true,
          variantFallback:exact.variantFallback===true,
          complete:!!(Number(exact.min)>0&&Number(exact.avg)>0&&Number(exact.max)>0),
          checkedAt:new Date().toISOString()
        });
      }
    }catch(error){
      console.warn('MYP exact-first Actor:',error?.code||error?.message||error);
    }
  }

  // V15.07: reproduce the search that works on MYP itself:
  // "Nome (número/total)". This is the first generic discovery step for every
  // card, before Chromium or long retry queues.
  if(!fast&&!directLink&&name&&number){
    try{
      const quickCandidates=await readerSearchCandidates({name,nameAliases,number,set,setId});
      // V15.10: candidate validation is parallel and bounded. A single bad page
      // must never turn one price lookup into a 60+ second chain.
      const tested=await Promise.all(quickCandidates.slice(0,6).map(async candidate=>{
        try{
          const text=await fetchJina(candidate,4200);
          const identity=pageIdentity(text);
          return matchesWanted(identity,{name,nameAliases,number,set,setId,lang})
            ? safeMypProductUrl(candidate)
            : '';
        }catch{return ''}
      }));
      directLink=tested.find(Boolean)||'';
    }catch(error){
      console.warn('MYP exact search discovery failed:',error?.message||error);
    }
  }

  if(directLink
    &&!isCanonicalMewPtBrProductLink(directLink,{setId,lang,number})
    &&!isCanonicalGenerationsProductLink(directLink,{setId,number})){
    directLink=await canonicalizeKnownProductLink({link:directLink,apiId,setId,set,number,name,nameAliases});
  }
  if(!directLink&&normalize(setId)==='g1'){
    const indexed=await collectionIndexCandidates({apiId,setId,set,number,name,nameAliases}).catch(()=>[]);
    if(indexed.length){
      directLink=safeMypProductUrl(indexed[0]);
      catalogResolvedLink=!!directLink;
    }
  }
  const browserSeedLink=directLink;

  // Descoberta e leitura são etapas diferentes. Para Generations, devolva o
  // produto assim que o catálogo oficial da MYP o localizar; o worker então
  // usa esse link conhecido na leitura direta, sem perder a descoberta em um
  // timeout de uma requisição monolítica.
  if(catalogResolvedLink&&String(req.query.actorOnly||'')!=='1'){
    return res.status(200).json({
      ok:false,error:'link_resolved',source:'MYP Cards',provider:'MYP Generations catalog',
      name,number,edition:set,finish,condition,link:directLink,
      message:'Produto MYP localizado; preço será lido diretamente pelo worker.'
    });
  }

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
    const wanted={name,nameAliases,number,set,setId,apiId,lang,finish,condition,strictDirect:true,quick:true};

    // V16.11: "fast" can no longer mean "give up when there is no saved link".
    // That was the reason hundreds of queued cards looped forever as
    // fast_link_missing. Do one real bounded identity lookup first.
    if(!directLink){
      // V16.13: same lightweight path as a manual one-off lookup:
      // exact external search -> validate exact MYP product pages.
      let candidates=[];
      try{
        candidates=await Promise.race([
          externalSearchCandidates({name,nameAliases,number,set}),
          new Promise(resolve=>setTimeout(()=>resolve([]),6500))
        ]);
      }catch{}

      let discovered=null;
      if(Array.isArray(candidates)&&candidates.length){
        const checked=await Promise.all(candidates.slice(0,4).map(async candidate=>{
          try{
            const raw=await fetchText(candidate,5000);
            const identity=pageIdentity(raw);
            if(!matchesWanted(identity,wanted))return null;
            let market=await marketAcrossSellerPages(candidate,raw,identity,wanted,finish,condition);
            if(!marketFitsFinish(market,finish)&&!requiresExactMewPtBrVariant({setId,lang,finish})){
              market=sameProductFallbackMarket(identity,finish,condition);
            }
            return{
              ok:hasAnyMarket(market),
              link:safeMypProductUrl(candidate),
              edition:identity?.edition||set,
              identity,market,
              mode:'external-exact-search'
            };
          }catch{return null}
        }));
        discovered=checked.find(x=>x?.ok)||checked.find(x=>safeMypProductUrl(x?.link))||null;
      }

      const discoveredLink=safeMypProductUrl(discovered?.link);
      if(discoveredLink){
        directLink=discoveredLink;
        if(discovered?.ok&&hasAnyMarket(discovered?.market)){
          const market=discovered.market;
          return res.status(200).json({
            ok:true,source:'MYP Cards',provider:'External exact search',mode:discovered.mode,
            name:discovered.identity?.name||name,number:discovered.identity?.number||number,
            edition:discovered.edition||set,finish,condition,link:directLink,
            min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
            samples:market.samples??null,availableQuantity:market.availableQuantity??null,
            exactVariant:market.exactVariant===true,variantFallback:market.variantFallback===true,
            complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
            checkedAt:new Date().toISOString()
          });
        }
        return res.status(200).json({
          ok:false,error:'link_resolved',source:'MYP Cards',provider:'External exact search',
          name,number,edition:discovered?.edition||set,finish,condition,link:directLink,
          message:'Produto MYP exato localizado; leitura direta necessária.'
        });
      }

      return res.status(200).json({
        ok:false,error:'fast_link_missing',source:'MYP Cards',provider:'External exact search',
        message:'A busca externa exata não localizou a página desta impressão.'
      });
    }

    // V16.08: known MYP product links are read as HTML/text first. This is the
    // same real product page, but avoids launching Chromium for every queued card.
    try{
      const raw=await fetchText(directLink,10000);
      const identity=pageIdentity(raw);
      if(matchesWanted(identity,wanted)){
        let market=await marketAcrossSellerPages(directLink,raw,identity,wanted,finish,condition);
        if(!marketFitsFinish(market,finish)&&!requiresExactMewPtBrVariant({setId,lang,finish})){
          market=sameProductFallbackMarket(identity,finish,condition);
        }
        if(hasAnyMarket(market)){
          return res.status(200).json({
            ok:true,source:'MYP Cards',provider:'Direct MYP HTML',mode:'direct-known-product',
            name:identity?.name||name,number:identity?.number||number,edition:identity?.edition||set,
            finish,condition,link:directLink,
            min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
            samples:market.samples??null,availableQuantity:market.availableQuantity??null,
            exactVariant:market.exactVariant===true,variantFallback:market.variantFallback===true,
            complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
            checkedAt:new Date().toISOString()
          });
        }
      }
    }catch(error){
      console.warn('MYP direct HTML:',error?.message||error);
    }

    // Browser is only the fallback now, not the default path.
    try{
      const market=await Promise.race([
        findAndScrapeMypBrowser(directLink,wanted),
        new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'fast_timeout',link:directLink}),12000))
      ]);
      if(market?.ok&&hasAnyMarket(market)){
        return res.status(200).json({
          ok:true,source:'MYP Cards',provider:'Direct MYP browser fallback',mode:market.mode||'browser-direct-known',
          name,number,edition:market.edition||set,finish,condition,
          link:safeMypProductUrl(market.link)||directLink||'',
          min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
          samples:market.samples??null,availableQuantity:market.availableQuantity??null,
          exactVariant:market.exactVariant===true,variantFallback:market.variantFallback===true,
          complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
          checkedAt:new Date().toISOString()
        });
      }
      return res.status(200).json({
        ok:false,error:market?.error||'fast_no_price',
        source:'MYP Cards',provider:'Direct MYP browser fallback',link:directLink,
        message:'A página exata foi localizada, mas não retornou uma cotação compatível.'
      });
    }catch(error){
      return res.status(200).json({
        ok:false,error:error?.name==='AbortError'?'fast_timeout':'fast_unavailable',
        source:'MYP Cards',provider:'Direct MYP browser fallback',link:directLink,
        message:String(error?.message||'Falha na leitura direta da página exata.')
      });
    }
  }

  const directBrowser=String(req.query.directBrowser||'')==='1';
  if(directBrowser){
    try{
      // Serialized queue path: use the same real browser resolver for BOTH
      // known and unknown products. With no link it searches by exact card
      // identity (name + collector number + set); with a link it opens that
      // product directly. This avoids the static-reader path that can see the
      // product but miss the live seller rows.
      const wanted={name,nameAliases,number,set,setId,apiId,lang,finish,condition,strictDirect:!!directLink};
      // A direct MYP product is read directly. When the product URL is unknown,
      // do NOT crawl MYP's Cloudflare-protected collection/search pages; resolve
      // the exact indexed product through a normal web search, then read it.
      const market=directLink
        ? await findAndScrapeMypBrowser(directLink,wanted)
        : await searchWebExactMypBrowser(wanted,'');
      if(market?.ok&&hasAnyMarket(market)){
        return res.status(200).json({
          ok:true,source:'MYP Cards',provider:'Chromium queue resolver',mode:market.mode||(directLink?'browser-direct-known':'browser-search-exact'),
          name,number,edition:market.edition||set,finish,condition,
          link:safeMypProductUrl(market.link)||directLink,
          min:Number(market.min||0),avg:Number(market.avg||0),max:Number(market.max||0),
          samples:market.samples??null,availableQuantity:market.availableQuantity??null,
          exactVariant:market.exactVariant===true,
            variantFallback:market.variantFallback===true,
          complete:!!(Number(market.min)>0&&Number(market.avg)>0&&Number(market.max)>0),
          checkedAt:new Date().toISOString()
        });
      }
      return res.status(200).json({
        ok:false,error:market?.error||'variant_not_found',source:'MYP Cards',
        provider:'Chromium queue resolver',link:safeMypProductUrl(market?.link)||directLink||'',
        rows:market?.rows??null,
        language:market?.language??null,
        availableLanguages:market?.availableLanguages??[],
        defaultFinish:market?.defaultFinish??null,
        finish:market?.finish??finish,
        condition:market?.condition??condition,
        diagnostics:market?.diagnostics??[],
        paginationDiagnostics:market?.paginationDiagnostics??[],
        realPagination:market?.realPagination??[],
        relatedError:market?.relatedError??null,
        message:market?.message||'A página conhecida não retornou a variante solicitada.'
      });
    }catch(error){
      return res.status(200).json({
        ok:false,error:error?.name==='TimeoutError'?'timeout':'browser_error',
        source:'MYP Cards',provider:'Chromium queue resolver',link:directLink||'',
        message:error?.message||String(error)
      });
    }
  }

  // Na fila, uma carta com URL MYP conhecida não precisa refazer descoberta.
  // Tente primeiro o scraper especializado com consulta exata
  // (nome + número + coleção). Ele já valida idioma, condição e acabamento.
  const apifyConfigured=!!process.env.APIFY_API_TOKEN;
  let apifyFound=null,apifyError='';
  if(directLink&&apifyConfigured&&normalize(setId)!=='g1'){
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

  // Sem link MYP conhecido, tente primeiro o scraper estruturado. Ele já
  // devolve produto + ofertas e evita gastar o orçamento inteiro em Chromium
  // antes de chegar ao fallback capaz de resolver cartas novas/localizadas.
  if(!fast&&!directLink&&process.env.APIFY_API_TOKEN){
    try{
      const early=await queryMyp({name,nameAliases,number,set,setId,lang,finish,condition});
      const actorLink=safeMypProductUrl(early?.link);

      // V15.06: descoberta de identidade e leitura de preço são independentes.
      // Se o Actor encontrou a impressão correta, nunca jogue esse link fora só
      // porque a variante/acabamento ainda não trouxe preço nessa mesma chamada.
      if(actorLink){
        directLink=actorLink;
        catalogResolvedLink=true;
      }

      if(hasAnyMarket(early)&&actorLink){
        return res.status(200).json({
          ok:true,
          source:'MYP Cards',
          provider:'Apify exact printing',
          mode:'actor-first-no-link',
          name,
          number,
          edition:set,
          finish,
          condition,
          link:actorLink,
          min:Number(early.min||0),
          avg:Number(early.avg||0),
          max:Number(early.max||0),
          samples:early.samples??null,
          availableQuantity:early.availableQuantity??null,
          exactVariant:early.exactVariant===true,
          variantFallback:early.variantFallback===true,
          complete:!!(Number(early.min)>0&&Number(early.avg)>0&&Number(early.max)>0),
          checkedAt:new Date().toISOString()
        });
      }
    }catch(error){
      console.warn('MYP early Actor falhou; continuando Reader/Chromium:',error?.code||error?.message||error);
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
        let market=await marketAcrossSellerPages(directLink,text,identity,{name,nameAliases,number,set,setId,lang},finish,condition);
        if(!marketFitsFinish(market,finish)&&!requiresExactMewPtBrVariant({setId,lang,finish}))market=sameProductFallbackMarket(identity,finish,condition);
        if(hasAnyMarket(market)){
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
            exactVariant:market.exactVariant===true,
            variantFallback:market.variantFallback===true,
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
        // Uma falha no índice visual da coleção não é terminal. Continue para
        // busca por número exato, Reader e Actor; nomes/localizações da MYP
        // podem divergir mesmo quando o produto existe.
        console.warn('MYP Chromium não localizou na coleção; continuando fallbacks:',market.message||'collection_not_found');
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

  if(!apifyFound&&apifyConfigured&&normalize(setId)!=='g1'){
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
    if(!hasAnyMarket(market)){
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

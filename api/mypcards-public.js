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
  const key='name-aliases:v1462:'+String(apiId||'').trim();
  const cached=CACHE.get(key);
  if(cached&&cached.expires>Date.now())return [...new Set([...aliases,...cached.value])];
  if(apiId){
    const rows=await Promise.all(['pt-br','en'].map(async locale=>{
      try{
        const r=await fetch('https://api.tcgdex.net/v2/'+locale+'/cards/'+encodeURIComponent(apiId),{
          headers:{accept:'application/json','user-agent':'PokemonBinderBR/14.64'}
        });
        return r.ok?await r.json():null;
      }catch{return null}
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
      headers:{accept:'application/json','user-agent':'PokemonBinderBR/14.64'}
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
    {engine:'',budget:Math.min(12000,timeout)},
    {engine:'browser',budget:Math.max(5000,timeout-12000)}
  ];
  for(const attempt of attempts){
    const remaining=timeout-(Date.now()-started);
    if(remaining<=1500)break;
    const controller=new AbortController();
    const budget=Math.min(attempt.budget,remaining);
    const timer=setTimeout(()=>controller.abort(),budget);
    try{
      const headers={'Accept':'text/plain','X-No-Cache':'true','X-Timeout':String(Math.max(5,Math.floor(budget/1000)-1))};
      if(attempt.engine)headers['X-Engine']=attempt.engine;
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
function canonicalSetProductUrl({setId,number}={}){
  const sid=normalize(setId);
  const np=numberParts(number);
  const collector=/^\d+$/.test(np.n)?Number(np.n):0;
  if(!collector)return'';

  // Escarlate e Violeta: 151 (MEW) usa uma sequência contígua na MYP:
  // 001/165 = 205874, portanto productId = 205873 + collector.
  // Isso é uma regra da coleção, não uma tabela manual por carta.
  if((sid==='sv03 5'||sid==='sv3 5')&&collector>=1&&collector<=207){
    return ROOT+'/pokemon/produto/'+String(205873+collector)+'/card';
  }
  return'';
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
  const groups=await Promise.all(names.map(n=>sitemapCandidates(n).catch(()=>[])));
  const search=await readerSearchCandidates(wanted).catch(()=>[]);
  return [...new Set([...search,...groups.flat()])].slice(0,14);
}

async function sitemapCandidates(name){
  const wantedSlug=slugify(name),wantedCompact=wantedSlug.replace(/-/g,'');
  const key='sitemap:v1462:'+wantedCompact,cached=CACHE.get(key);
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
function pageIdentity(html){const text=stripTags(html);const token='[A-Za-z]{0,8}\\d{1,4}[A-Za-z]{0,4}';const titleMatch=text.match(new RegExp('(?:^|\\n)\\s*([^\\n]{1,120}?)\\s*\\(('+token+'(?:\\s*\\/\\s*'+token+')?)\\)\\s*(?:\\n|$)','m'));const codeMatch=text.match(/Código\s+([^\n]+)/i),editionMatch=text.match(/Edição\s+([^\n]+)/i);return{text,name:titleMatch?titleMatch[1].trim():'',number:titleMatch?titleMatch[2].replace(/\s/g,''):'',code:codeMatch?codeMatch[1].trim():'',edition:editionMatch?editionMatch[1].trim():''}}
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
  const w=numberParts(wanted.number),f=numberParts(identity.number);
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
  const exact=byCondition.filter(x=>lineMatchesFinish(x,finish));
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

async function resolvePage({name,nameAliases=[],number,set,setId,link,lang,finish,condition}){
  const direct=safeMypProductUrl(link);
  const wanted={name,nameAliases,number,set,setId,lang};
  const familyNames=[name,...nameAliases].filter(Boolean);
  const queue=direct?[direct]:await familySeedCandidates({name,nameAliases,number,set,setId});
  const seen=new Set();
  let best=null;
  let inspected=0;

  while(queue.length&&inspected<14){
    const url=queue.shift();
    if(!url||seen.has(url))continue;
    seen.add(url);inspected++;
    try{
      const raw=await fetchText(url,9000);
      const identity=pageIdentity(raw);
      const exact=matchesWanted(identity,wanted);

      if(exact){
        const market=extractMarket(identity,finish,condition);
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
    return resolvePage({name,nameAliases,number,set,setId,link:'',lang,finish,condition});
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

  const canonicalLink=canonicalSetProductUrl({setId,number});
  const directLink=canonicalLink||safeMypProductUrl(link);
  const nameAliases=await resolveNameAliases(name,apiId);
  let browserSeedLink=directLink;
  if(!browserSeedLink&&!fast){
    const seeds=await familySeedCandidates({name,nameAliases,number,set,setId}).catch(()=>[]);
    browserSeedLink=seeds[0]||'';
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
      if(!matchesWanted(identity,{name,nameAliases,number,set,setId,lang})){
        return res.status(200).json({
          ok:false,error:'wrong_product',source:'MYP Cards',provider:'Fast Reader',link:directLink,
          message:'O link salvo não corresponde à carta consultada.'
        });
      }
      const market=extractMarket(identity,finish,condition);
      if(hasAnyMarket(market)){
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
      return res.status(200).json({
        ok:false,error:'fast_no_price',source:'MYP Cards',provider:'Fast Reader',link:directLink,
        message:'A leitura rápida não encontrou cotação utilizável; a fila prioritária continuará no servidor.'
      });
    }catch(error){
      return res.status(200).json({
        ok:false,error:error?.name==='AbortError'?'fast_timeout':'fast_unavailable',
        source:'MYP Cards',provider:'Fast Reader',link:directLink,
        message:'A leitura rápida não concluiu; a fila prioritária continuará no servidor.'
      });
    }
  }

  // Fonte completa: abrir a página pública real em Chromium.
  // O fetch HTTP simples é bloqueado pelo Cloudflare, mas o navegador real
  // executa o desafio e enxerga as mesmas ofertas exibidas ao usuário.
  {
    const browserKey='browser:v1464:'+normalize(name)+'|'+number+'|'+normalize(set)+'|'+normalize(setId)+'|'+normalize(lang)+'|'+normalize(finish)+'|'+String(condition||'').toUpperCase()+'|'+(browserSeedLink||'discover');
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

  const apifyConfigured=!!process.env.APIFY_API_TOKEN;
  let apifyFound=null,apifyError='';
  if(apifyConfigured){
    try{
      const found=await queryMyp({name,number,set,setId,lang,finish,condition});
      if(hasAnyMarket(found))apifyFound=found;
      // Nunca devolvemos preço do Actor sem validar a página da MYP.
      // Em 151, MEW e SV2A compartilham nome+número e o Actor pode devolver
      // a impressão japonesa mesmo quando a consulta é PT-BR.
    }catch(error){
      apifyError=error?.code||error?.message||'apify_error';
      console.warn('MYP Apify falhou; usando fallback Reader:',apifyError);
    }
  }

  const cacheKey='market:v1464b:'+normalize(name)+'|'+number+'|'+normalize(set)+'|'+normalize(setId)+'|'+normalize(lang)+'|'+normalize(finish)+'|'+condition.toUpperCase()+'|'+safeMypProductUrl(link);
  const cached=CACHE.get(cacheKey);if(cached&&cached.expires>Date.now())return res.status(200).json(cached.value);
  try{
    // Preserve the deterministic/canonical product identity through the
    // final fallback. Dropping back to raw text search here reintroduced
    // ambiguity for localized names and uncommon cards.
    const candidateLink=safeMypProductUrl(apifyFound?.link)||directLink||safeMypProductUrl(link);
    const found=await resolvePage({name,nameAliases,number,set,setId,link:candidateLink,lang,finish,condition});
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
    const code=error?.code==='cloudflare_blocked'?'cloudflare_blocked':(error?.name==='AbortError'?'timeout':'upstream_error');
    return res.status(200).json({ok:false,error:code,connector:'Apify',apifyConfigured,apifyError,needsApifyToken:!apifyConfigured,message:code==='cloudflare_blocked'?'MYP bloqueou a leitura automática direta via Cloudflare.':'Não foi possível consultar a página pública da MYP agora.'});
  }
}
module.exports.config={maxDuration:60};

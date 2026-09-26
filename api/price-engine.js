'use strict';
// Price engine V17.
//
// One Chromium session per request reads BOTH Brazilian markets:
//   - MYP Cards: opens the known product page, or probes a short list of
//     candidate product ids supplied by the worker, and accepts a page only
//     when name + collector number (+ locale rules) match the requested card.
//   - Liga Pokémon: opens the card search page "Name (number)" and reads the
//     per-edition price summary (menor / médio / maior) embedded in the page.
//
// MYP and Liga block plain datacenter HTTP (Cloudflare "Just a moment"), but a
// real browser page loads normally. Search/listing pages on MYP stay blocked,
// which is why link discovery happens in the worker (catalog neighbours) and
// this endpoint only ever opens product pages.
//
// Only ONE MYP page is opened per request: MYP answers a second navigation in
// the same session with a Cloudflare challenge, and we do not try to evade it.
// The worker picks the single most likely product id per attempt.
//
// Liga is opt-in (liga=1): it currently challenges the browser on the first
// page, so the queue does not spend time on it.

const {launch,readProduct,summarizeProduct,productIdentityOk,finishKind,numberParts}=require('../lib/myp-browser');

const MYP_ROOT='https://mypcards.com';
const LIGA_ROOT='https://www.ligapokemon.com.br';
const MAX_CANDIDATES=1;
const DEADLINE_MS=52000;

function normalize(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function slugify(v){
  return String(v||'').replace(/['’]/g,'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .replace(/♀/g,'-female-').replace(/♂/g,'-male-').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-+/g,'-');
}
function safeMypProductUrl(value){
  try{
    const u=new URL(String(value||''));
    if(!/(^|\.)mypcards\.com$/i.test(u.hostname))return'';
    if(!/^\/pokemon\/produto\/\d+\//i.test(u.pathname))return'';
    return`https://mypcards.com${u.pathname}`;
  }catch{return''}
}
function productIdOf(url){
  const m=String(url||'').match(/\/pokemon\/produto\/(\d+)\//i);
  return m?Number(m[1]):0;
}
function challenged(data){
  const t=normalize([data?.title,String(data?.body||'').slice(0,400)].join(' '));
  return /just a moment|um momento|verificacao de seguranca|security verification|checking your browser/.test(t);
}
async function waitChallenge(page,ms){
  // A real browser usually clears the Cloudflare interstitial by itself.
  await page.waitForFunction(()=>!/just a moment|um momento|verifica/i.test(document.title||''),{timeout:ms}).catch(()=>{});
}

async function readMypPage(page,url,wanted){
  let data=await readProduct(page,url,{timeout:20000,tolerateTimeout:true});
  if(challenged(data)){
    await waitChallenge(page,9000);
    data=await readProduct(page,url,{timeout:15000,tolerateTimeout:true});
  }
  return data;
}

async function lookupMyp(page,wanted,urls,deadline){
  const probes=[];
  let identityOnly=null;
  for(const url of urls){
    if(Date.now()>deadline){probes.push({url,skipped:'deadline'});continue}
    let data;
    try{data=await readMypPage(page,url,wanted)}
    catch(error){probes.push({url,error:String(error?.message||error).slice(0,120)});continue}
    const finalUrl=safeMypProductUrl(data.finalUrl||data.url)||url;
    const probe={
      url:finalUrl,
      productId:productIdOf(finalUrl)||productIdOf(url),
      status:data.httpStatus||0,
      title:String(data.title||'').slice(0,160),
      edition:String(data.edition||'').slice(0,160),
      code:String(data.code||'').slice(0,80),
      challenged:challenged(data),
      // Other MYP products linked from this page ("Outras Edições" etc.):
      // every one is a free catalog entry for the worker to learn from.
      related:[...new Map((data.related||[])
        .map(r=>[safeMypProductUrl(r.href),String(r.text||'').replace(/\s+/g,' ').trim().slice(0,140)])
        .filter(([href])=>href&&href!==finalUrl)).entries()]
        .slice(0,80).map(([href,text])=>({productId:productIdOf(href),href,text}))
    };
    probes.push(probe);
    if(probe.challenged||Number(probe.status)>=400)continue;
    if(!productIdentityOk(data,wanted))continue;

    probe.match=true;
    let market=summarizeProduct(data,wanted);
    if(market.ok)return{market:{...market,link:finalUrl,source:'MYP Cards'},probes};
    identityOnly={ok:false,error:market.error||'variant_not_found',link:finalUrl,title:data.title,edition:data.edition,message:market.message||'Produto MYP correto, sem oferta compatível com condição/acabamento.'};
    break;
  }
  if(identityOnly)return{market:identityOnly,probes};
  // not_found: the page answered (404 or another card) -> try the next id.
  // myp_blocked: challenge / network error -> transient, retry later.
  const p=probes[0]||{};
  const notFound=!p.challenged&&!p.error&&!p.skipped&&(Number(p.status)===404||(Number(p.status)===200&&!p.match));
  return{
    market:notFound
      ?{ok:false,error:'product_not_found',message:'O produto MYP candidato não corresponde a nome + número.'}
      :{ok:false,error:'myp_blocked',message:'A MYP não abriu a página agora ('+(p.challenged?'verificação de segurança':(p.error||p.skipped||('HTTP '+(p.status||0))))+').'},
    probes
  };
}

// Liga "extras" codes used in cards_editions[].price.
function ligaFinishKeys(finish){
  const kind=finishKind(finish);
  if(kind==='reverse')return['3'];
  if(kind==='masterball')return['43'];
  if(kind==='pokeball')return['47'];
  if(kind==='foil')return['2','0'];
  return['0'];
}
function ligaQuery(wanted){
  const name=String(wanted.ligaName||wanted.name||'').trim();
  const number=String(wanted.number||'').trim();
  return number?`${name} (${number})`:name;
}
function pickLigaEdition(editions,wanted){
  const want=numberParts(wanted.number);
  const setName=normalize(wanted.set);
  const setCode=normalize(wanted.setCode||'');
  const scored=(Array.isArray(editions)?editions:[]).map(ed=>{
    let score=0;
    const num=numberParts(String(ed.num||''));
    if(want.n&&num.n===want.n)score+=1000;else if(want.n)score-=2000;
    const edName=normalize(ed.name),edCode=normalize(ed.code);
    if(setName&&edName&&(edName===setName||edName.includes(setName)||setName.includes(edName)))score+=600;
    if(setCode&&edCode&&edCode===setCode)score+=600;
    return{ed,score};
  }).sort((a,b)=>b.score-a.score);
  const best=scored[0];
  if(!best||best.score<1000)return null;
  // Same number in two editions without a set match is ambiguous: refuse.
  if(scored[1]&&scored[1].score===best.score&&best.score<1600)return null;
  return best.ed;
}
function ligaMarketFromEdition(ed,wanted){
  const prices=ed?.price||{};
  for(const key of ligaFinishKeys(wanted.finish)){
    const row=prices[key];
    if(!row)continue;
    const min=Number(row.p||0),avg=Number(row.m||0),max=Number(row.g||0);
    if(min||avg||max)return{min,avg:avg||min,max,finishKey:key};
  }
  return null;
}
async function lookupLiga(page,wanted,deadline){
  const query=ligaQuery(wanted);
  const link=`${LIGA_ROOT}/?view=cards%2Fsearch&card=${encodeURIComponent(query).replace(/%20/g,'+')}`;
  if(Date.now()>deadline-6000)return{ok:false,error:'liga_deadline',link};
  try{
    await page.goto(link,{waitUntil:'domcontentloaded',timeout:Math.min(15000,deadline-Date.now())});
    let editions=await page.evaluate(()=>Array.isArray(window.cards_editions)?window.cards_editions:null).catch(()=>null);
    if(!editions){
      await waitChallenge(page,9000);
      await page.waitForFunction(()=>Array.isArray(window.cards_editions),{timeout:4000}).catch(()=>{});
      editions=await page.evaluate(()=>Array.isArray(window.cards_editions)?window.cards_editions:null).catch(()=>null);
    }
    if(!editions){
      const title=await page.title().catch(()=> '');
      return{ok:false,error:/moment|momento/i.test(title)?'liga_blocked':'liga_not_found',link,message:'Liga sem dados da carta ('+String(title).slice(0,60)+').'};
    }
    const ed=pickLigaEdition(editions,wanted);
    if(!ed)return{ok:false,error:'liga_edition_not_found',link,editions:editions.map(e=>`${e.code||''} ${e.num||''}`).slice(0,12)};
    const market=ligaMarketFromEdition(ed,wanted);
    if(!market)return{ok:false,error:'liga_variant_not_found',link,edition:ed.name,finishKeys:Object.keys(ed.price||{})};
    return{ok:true,source:'Liga Pokémon',link,edition:ed.name,editionCode:ed.code,...market,checkedAt:new Date().toISOString()};
  }catch(error){
    return{ok:false,error:'liga_error',link,message:String(error?.message||error).slice(0,160)};
  }
}

function candidateUrls(q){
  const urls=[];
  const link=safeMypProductUrl(q.mypLink);
  if(link)urls.push(link);
  const slug=slugify(q.name)||'card';
  for(const raw of String(q.mypIds||'').split(',')){
    const id=Number(String(raw).trim());
    if(Number.isInteger(id)&&id>0)urls.push(`${MYP_ROOT}/pokemon/produto/${id}/${slug}`);
  }
  return [...new Set(urls)].slice(0,MAX_CANDIDATES);
}

function authorized(req){
  // Only the price worker may launch browsers here (shared secret header).
  const secret=String(process.env.PRICE_ENGINE_SECRET||'');
  if(!secret)return true;
  const given=Buffer.from(String(req.headers['x-engine-key']||''));
  const want=Buffer.from(secret);
  return given.length===want.length&&require('crypto').timingSafeEqual(given,want);
}

module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(!authorized(req))return res.status(401).json({ok:false,error:'unauthorized'});
  const q=req.method==='POST'&&req.body&&typeof req.body==='object'?{...req.query,...req.body}:req.query;
  const wanted={
    name:String(q.name||'').trim(),
    nameAliases:String(q.aliases||'').split('|').map(s=>s.trim()).filter(Boolean),
    number:String(q.number||'').trim(),
    set:String(q.set||'').trim(),
    setId:String(q.setId||'').trim(),
    setCode:String(q.setCode||'').trim(),
    lang:String(q.lang||'').trim(),
    finish:String(q.finish||'Normal').trim(),
    condition:String(q.condition||'Nova').trim(),
    ligaName:String(q.ligaName||'').trim(),
    quick:true
  };
  if(!wanted.name||!wanted.number)return res.status(400).json({ok:false,error:'name_number_required'});
  const wantMyp=String(q.myp??'1')!=='0';
  const wantLiga=String(q.liga??'0')==='1';
  const urls=wantMyp?candidateUrls(q):[];
  const started=Date.now();
  const deadline=started+DEADLINE_MS;

  let browser;
  try{
    const launched=await launch();
    browser=launched.browser;
    const page=launched.page;
    page.setDefaultNavigationTimeout(15000);

    let myp={ok:false,error:wantMyp?'no_myp_candidates':'skipped'},probes=[];
    if(urls.length){
      // Leave time for Liga after MYP.
      const r=await lookupMyp(page,wanted,urls,wantLiga?deadline-14000:deadline);
      myp=r.market;probes=r.probes;
    }
    const liga=wantLiga?await lookupLiga(page,wanted,deadline):{ok:false,error:'skipped'};
    return res.status(200).json({
      ok:!!(myp.ok||liga.ok),
      build:'17.5',
      myp,liga,probes,
      checkedAt:new Date().toISOString(),
      elapsedMs:Date.now()-started
    });
  }catch(error){
    return res.status(200).json({ok:false,error:'engine_error',message:String(error?.message||error).slice(0,200),elapsedMs:Date.now()-started});
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
};

module.exports.config={maxDuration:60};

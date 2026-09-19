'use strict';

function normalize(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function words(v){
  return normalize(v).split(/\s+/).filter(x=>x.length>1);
}
function parseMoneyNumber(raw){
  let s=String(raw||'').replace(/[^0-9.,]/g,'').trim();
  if(!s)return 0;
  const lastDot=s.lastIndexOf('.'),lastComma=s.lastIndexOf(',');
  if(lastDot>=0&&lastComma>=0){
    // O último separador é o decimal; o outro é milhar.
    if(lastComma>lastDot)s=s.replace(/\./g,'').replace(',','.');
    else s=s.replace(/,/g,'');
  }else if(lastComma>=0){
    const decimals=s.length-lastComma-1;
    s=decimals===1||decimals===2?s.replace(',','.'):s.replace(/,/g,'');
  }else if(lastDot>=0){
    const decimals=s.length-lastDot-1;
    // A MYP usa ponto decimal no resumo ("59.90") e vírgula nas ofertas.
    // Um único ponto com 1–2 casas é decimal; caso contrário é milhar.
    if(!((decimals===1||decimals===2)&&s.indexOf('.')===lastDot))s=s.replace(/\./g,'');
  }
  const n=Number(s);
  return Number.isFinite(n)?n:0;
}
function moneyValues(v){
  const text=String(v||'');
  const out=[];
  for(const m of text.matchAll(/R\$\s*([0-9][0-9.,]*)/gi)){
    const n=parseMoneyNumber(m[1]);
    if(n>0)out.push(n);
  }
  if(!out.length){
    const n=parseMoneyNumber(text);
    if(n>0)out.push(n);
  }
  return out;
}
function priceFrom(v){
  const values=moneyValues(v);
  // Em promoção, o DOM pode carregar preço antigo + atual; o último é o vigente.
  return values.length?values[values.length-1]:0;
}
function finishKind(v){
  const n=normalize(v);
  if(!n||n==='normal'||n.includes('nao foil'))return'normal';
  if(n.includes('master')&&n.includes('ball'))return'masterball';
  if(n.includes('poke')&&n.includes('ball'))return'pokeball';
  if(n.includes('reverse'))return'reverse';
  if(n.includes('full')&&n.includes('art'))return'fullart';
  if(n.includes('altered')&&n.includes('art'))return'alteredart';
  if(n.includes('promo'))return'promo';
  if(n.includes('foil')||n.includes('holo'))return'foil';
  return n||'normal';
}
function conditionKind(v){
  const n=normalize(v).toUpperCase();
  if(!n||n==='NOVA'||n==='NEW'||n==='MINT'||/\bNEAR MINT\b/.test(n)||/\bNM\b/.test(n))return'NM';
  if(/\bSLIGHTLY PLAYED\b/.test(n)||/\bSP\b/.test(n))return'SP';
  if(/\bMODERATELY PLAYED\b/.test(n)||/\bMP\b/.test(n))return'MP';
  if(/\bHEAVILY PLAYED\b/.test(n)||/\bHP\b/.test(n))return'HP';
  if(/\bDAMAGED\b/.test(n)||/\bDM\b/.test(n)||n==='D')return'DM';
  return n;
}
function numberParts(v){
  const s=String(v||'');
  const m=s.match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
  if(m)return{n:String(Number(m[1])),d:String(Number(m[2])),full:String(Number(m[1]))+'/'+String(Number(m[2]))};
  const x=s.match(/(?:^|\D)0*(\d{1,4})(?:\D|$)/);
  return x?{n:String(Number(x[1])),d:'',full:String(Number(x[1]))}:{n:'',d:'',full:''};
}
function cleanName(v){
  return String(v||'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
}
function identityOk(title,wanted){
  const t=normalize(title),name=normalize(cleanName(wanted?.name)),a=numberParts(title),b=numberParts(wanted?.number);
  if(name&&!t.includes(name)&&!name.includes(t.replace(/\d+\s*\d+$/,'')))return false;
  if(b.n&&a.n&&b.n!==a.n)return false;
  if(b.d&&a.d&&b.d!==a.d)return false;
  return true;
}
function labelFromBody(body,label){
  const lines=String(body||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const wanted=normalize(label);
  for(let i=0;i<lines.length;i++){
    if(normalize(lines[i])===wanted&&lines[i+1])return lines[i+1].trim();
    if(normalize(lines[i]).startsWith(wanted+' '))return lines[i].slice(label.length).trim();
  }
  return'';
}
function setScore(text,wanted){
  const target=normalize(wanted?.set||wanted?.setName||'');
  if(!target)return 0;
  const hay=normalize(text);
  if(!hay)return 0;
  if(hay.includes(target)||target.includes(hay))return 700;
  const targetWords=words(target).filter(x=>!['espada','escudo','black','white','pokemon'].includes(x));
  const hayWords=new Set(words(hay));
  const shared=targetWords.filter(x=>hayWords.has(x)).length;
  return shared*140;
}
function productScore(data,wanted){
  let score=0;
  const titleName=normalize(String(data.title||'').replace(/\([^)]*\)/g,''));
  const wantedName=normalize(cleanName(wanted?.name));
  if(wantedName&&titleName===wantedName)score+=550;
  else if(wantedName&&(titleName.includes(wantedName)||wantedName.includes(titleName)))score+=300;
  const a=numberParts(data.title),b=numberParts(wanted?.number);
  if(b.n&&a.n===b.n)score+=550;
  if(b.d&&a.d===b.d)score+=450;
  score+=setScore(data.edition,wanted);
  const setId=normalize(wanted?.setId||'');
  if(setId&&normalize(data.body).includes(setId))score+=220;
  return score;
}
function searchCandidateScore(c,wanted){
  let score=0;
  const n=numberParts(c.text),w=numberParts(wanted?.number);
  const hay=normalize(c.text),wantedName=normalize(cleanName(wanted?.name));
  if(w.n&&n.n===w.n)score+=500;
  if(w.d&&n.d===w.d)score+=420;
  if(wantedName&&hay.includes(wantedName))score+=260;
  score+=setScore(c.text,wanted);
  return score;
}

async function configurePage(page){
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({'Accept-Language':'pt-BR,pt;q=0.9,en;q=0.6'});
  return page;
}
async function launch(){
  const chromiumModule=await import('@sparticuz/chromium');
  const chromium=chromiumModule.default||chromiumModule;
  const puppeteerModule=await import('puppeteer-core');
  const puppeteer=puppeteerModule.default||puppeteerModule;
  const browser=await puppeteer.launch({
    args:chromium.args,
    defaultViewport:{width:1365,height:900},
    executablePath:await chromium.executablePath(),
    headless:chromium.headless
  });
  const page=await configurePage(await browser.newPage());
  return{browser,page};
}

async function readProduct(page,url){
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:50000});
  await page.waitForSelector('h1',{timeout:10000}).catch(()=>{});
  await page.waitForSelector('td.estoque-lista-precoestoque',{timeout:12000}).catch(()=>{});
  const data=await page.evaluate(()=>({
    title:document.querySelector('h1')?.textContent?.trim()||document.title,
    body:document.body?.innerText||'',
    // Estes dois valores são as estatísticas oficiais exibidas pela própria MYP.
    summaryMin:document.querySelector('.estatistica-menor .moeda')?.textContent?.trim()||'',
    summaryAvg:document.querySelector('.estatistica-medio .moeda')?.textContent?.trim()||'',
    lastPrice:document.querySelector('.estatistica-ultimo .moeda')?.textContent?.trim()||'',
    offers:[...document.querySelectorAll('tr')].map(tr=>({
      seller:tr.querySelector('.nome-vendedor-apelido')?.textContent?.trim()||'',
      finish:tr.querySelector('.estoque-lista-nomeenfoil')?.textContent?.trim()||'',
      condition:tr.querySelector('.estoque-lista-qualidadenome .chip-inline')?.textContent?.trim()||'',
      price:tr.querySelector('.estoque-lista-precoestoque .moeda')?.textContent?.trim()||'',
      qty:tr.querySelector('.estoque-lista-quantidadeestoque')?.textContent?.trim()||'',
      note:(tr.innerText||'').trim()
    })).filter(x=>x.price)
  }));
  data.edition=labelFromBody(data.body,'Edição');
  data.rarity=labelFromBody(data.body,'Raridade');
  data.httpStatus=response?.status()||0;
  data.url=url;
  return data;
}
function summarizeProduct(data,wanted){
  if(!identityOk(data.title,wanted)){
    return{ok:false,error:'wrong_product',title:data.title,edition:data.edition,link:data.url,httpStatus:data.httpStatus};
  }

  const wantedFinish=finishKind(wanted.finish||'Normal');
  const wantedCondition=conditionKind(wanted.condition||'Nova');
  const inherentHolo=/\bholo\b/i.test(String(data.rarity||''));

  const sameCondition=data.offers.filter(row=>conditionKind(row.condition)===wantedCondition);
  let matched=sameCondition.filter(row=>finishKind(row.finish)===wantedFinish);

  // Na MYP muitos vendedores deixam o acabamento vazio quando ele é o padrão
  // daquela impressão. Para uma carta cuja raridade já é Holo, vazio + NM
  // representa a mesma impressão Foil, sem misturar Full-Art/Reverse/etc.
  if(wantedFinish==='foil'&&inherentHolo){
    const implicit=sameCondition.filter(row=>!String(row.finish||'').trim());
    const seen=new Set(matched.map(x=>x.seller+'|'+x.price+'|'+x.qty));
    for(const row of implicit){
      const k=row.seller+'|'+row.price+'|'+row.qty;
      if(!seen.has(k)){matched.push(row);seen.add(k)}
    }
  }

  const variantPrices=matched.map(x=>priceFrom(x.price)).filter(n=>n>0).sort((a,b)=>a-b);
  const variantQty=matched.reduce((sum,row)=>{
    const m=String(row.qty||'').match(/(\d+)/);
    return sum+(m?Number(m[1]):0);
  },0);

  // Para o painel MYP usamos as estatísticas da própria página.
  // A MYP publica "menor" e "médio"; "máximo" é calculado entre anúncios
  // regulares, excluindo sinais claros de carta graduada/slab.
  const regularOffers=data.offers.filter(row=>!/\b(?:PSA|BGS|CGC|SLAB|GRADUAD[AO])\b/i.test(String(row.note||'')));
  const regularPrices=regularOffers.map(x=>priceFrom(x.price)).filter(n=>n>0).sort((a,b)=>a-b);
  const pageMin=priceFrom(data.summaryMin);
  const pageAvg=priceFrom(data.summaryAvg);
  const pageMax=regularPrices.length?regularPrices[regularPrices.length-1]:0;

  const variantMin=variantPrices[0]||0;
  const variantAvg=variantPrices.length>=2?variantPrices.reduce((a,b)=>a+b,0)/variantPrices.length:0;
  const variantMax=variantPrices.length>=2?variantPrices[variantPrices.length-1]:0;

  const min=pageMin||variantMin||(regularPrices[0]||0);
  const avg=pageAvg||variantAvg||(regularPrices.length>=2?regularPrices.reduce((a,b)=>a+b,0)/regularPrices.length:0);
  const max=pageMax||variantMax;

  if(!(min||avg||max)){
    return{
      ok:false,error:'no_price_data',title:data.title,edition:data.edition,link:data.url,httpStatus:data.httpStatus,
      rows:data.offers.length,finish:wantedFinish,condition:wantedCondition
    };
  }

  return{
    ok:true,
    provider:'Chromium',
    mode:'browser-page',
    title:data.title,
    edition:data.edition,
    link:data.url,
    httpStatus:data.httpStatus,
    min,avg,max,
    samples:regularPrices.length,
    availableQuantity:variantQty||null,
    exactVariant:variantPrices.length>0,
    complete:!!(min&&avg&&max),
    pageStats:{min:pageMin,avg:pageAvg,max:pageMax,last:priceFrom(data.lastPrice)},
    variant:{
      found:variantPrices.length>0,
      min:variantMin,
      avg:variantAvg,
      max:variantMax,
      samples:variantPrices.length,
      finish:wantedFinish,
      condition:wantedCondition
    },
    matched:matched.map(x=>({seller:x.seller,finish:x.finish,condition:x.condition,price:priceFrom(x.price),qty:x.qty}))
  };
}

async function discoverProduct(browser,page,wanted){
  const query=cleanName(wanted?.name);
  if(!query)return null;
  const url='https://mypcards.com/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D='+encodeURIComponent(query);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:50000});
  // A grade da MYP entra depois do DOM inicial; aguardar o primeiro produto.
  await page.waitForSelector('a[href*="/pokemon/produto/"]',{timeout:12000}).catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,2200));
  const raw=await page.evaluate(()=>[...document.querySelectorAll('a[href*="/pokemon/produto/"]')].map(a=>({
    href:a.href,
    text:(a.closest('article,li,.produto-item,.produto,.card,div')?.innerText||a.innerText||'').trim()
  })));
  const map=new Map();
  for(const c of raw){
    if(!/^https:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\//i.test(c.href))continue;
    const old=map.get(c.href);
    if(!old||c.text.length>old.text.length)map.set(c.href,c);
  }
  let candidates=[...map.values()];
  const wantedNum=numberParts(wanted?.number);
  if(wantedNum.n){
    const exact=candidates.filter(c=>{
      const n=numberParts(c.text);
      return n.n===wantedNum.n&&(!wantedNum.d||n.d===wantedNum.d);
    });
    if(exact.length)candidates=exact;
  }
  candidates.sort((a,b)=>searchCandidateScore(b,wanted)-searchCandidateScore(a,wanted));
  candidates=candidates.slice(0,8);
  if(!candidates.length)return null;

  let best=null;
  for(const candidate of candidates){
    let isolatedBrowser=null;
    try{
      // Cloudflare pode marcar todo o contexto após uma impressão bloqueada.
      // Por isso cada candidata usa um Chromium independente.
      const isolated=await launch();
      isolatedBrowser=isolated.browser;
      const data=await readProduct(isolated.page,candidate.href);
      if(Number(data.httpStatus)>=400)continue;
      const score=productScore(data,wanted);
      if(!best||score>best.score)best={...data,score};
      // Nome + número + coleção já confirmados com folga.
      if(score>=1800)break;
    }catch{}finally{
      if(isolatedBrowser)await isolatedBrowser.close().catch(()=>{});
    }
  }
  return best;
}

async function findAndScrapeMypBrowser(url,wanted={}){
  let browser;
  try{
    const launched=await launch();
    browser=launched.browser;
    const page=launched.page;
    let data=null;
    if(url){
      data=await readProduct(page,url);
    }else{
      data=await discoverProduct(browser,page,wanted);
      if(!data)return{ok:false,error:'product_not_found',message:'A busca da MYP não encontrou a impressão correta.'};
    }
    return summarizeProduct(data,wanted);
  }catch(error){
    return{ok:false,error:'browser_error',message:error?.message||String(error)};
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
}

async function scrapeMypBrowser(url,wanted={}){
  return findAndScrapeMypBrowser(url,wanted);
}

module.exports={scrapeMypBrowser,findAndScrapeMypBrowser,finishKind,conditionKind,priceFrom,numberParts};

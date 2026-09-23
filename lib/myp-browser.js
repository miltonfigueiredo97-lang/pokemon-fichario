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
  if(n.includes('altered')&&n.includes('art'))return'alteredart';
  if(n.includes('master')&&n.includes('ball'))return'masterball';
  if(n.includes('poke')&&n.includes('ball'))return'pokeball';
  if(n.includes('reverse'))return'reverse';
  // "Full-Art" and "Promo" on MYP are descriptors of the already selected
  // printing/product page. Collector number identifies the physical card.
  // They must not exclude a valid NM offer when the binder finish is Normal.
  if(n.includes('full')&&n.includes('art'))return'normal';
  if(n.includes('promo'))return'normal';
  if(n.includes('foil')||n.includes('holo'))return'foil';
  return n||'normal';
}
function conditionKind(v){
  const n=normalize(v).toUpperCase();
  // A MYP costuma renderizar "NM - Quase nova", "SP - Pouco jogada" etc.
  // normalize() remove o hífen, então aceitamos o código no início da string.
  if(!n||n==='NOVA'||n==='NEW'||n==='MINT'||/\bNEAR MINT\b|\bQUASE NOVA\b/.test(n)||/^NM\b/.test(n))return'NM';
  if(/\bSLIGHTLY PLAYED\b|\bPOUCO JOGADA\b/.test(n)||/^SP\b/.test(n))return'SP';
  if(/\bMODERATELY PLAYED\b|\bMODERADAMENTE JOGADA\b/.test(n)||/^MP\b/.test(n))return'MP';
  if(/\bHEAVILY PLAYED\b|\bMUITO JOGADA\b/.test(n)||/^HP\b/.test(n))return'HP';
  if(/\bDAMAGED\b|\bDANIFICADA\b/.test(n)||/^DM\b/.test(n)||n==='D')return'DM';
  return n;
}
function offerConditionKind(row){
  const explicit=String(row?.condition||'').trim();
  if(explicit)return conditionKind(explicit);
  const n=normalize(row?.note||'').toUpperCase();
  if(/\bNM\b|\bNEAR MINT\b|\bQUASE NOVA\b/.test(n))return'NM';
  if(/\bSP\b|\bSLIGHTLY PLAYED\b|\bPOUCO JOGADA\b/.test(n))return'SP';
  if(/\bMP\b|\bMODERATELY PLAYED\b|\bMODERADAMENTE JOGADA\b/.test(n))return'MP';
  if(/\bHP\b|\bHEAVILY PLAYED\b|\bMUITO JOGADA\b/.test(n))return'HP';
  if(/\bDM\b|\bDAMAGED\b|\bDANIFICADA\b/.test(n))return'DM';
  return'NM';
}
function offerFinishKind(row){
  const explicit=String(row?.finish||'').trim();
  if(explicit)return finishKind(explicit);
  const n=normalize(row?.note||'');
  if(/altered art|altered-art/.test(n))return'alteredart';
  if(/masterball|master ball/.test(n))return'masterball';
  if(/pokeball|poke ball/.test(n))return'pokeball';
  if(/reverse foil|reverse holo|\breverse\b/.test(n))return'reverse';
  if(/\bfoil\b|\bholo\b/.test(n))return'foil';
  return'normal';
}

function languageKind(v){
  const n=normalize(v);
  if(!n)return'';
  if(n==='pt'||n==='pt br'||n==='br'||n.includes('portugues')||n.includes('portuguese')||n.includes('brasil')||n.includes('brazil')||/\b(?:flag icon|fi) br\b/.test(n))return'pt-br';
  if(n==='en'||n==='us'||n==='gb'||n.includes('ingles')||n.includes('english')||n.includes('united states')||n.includes('estados unidos')||n.includes('reino unido')||/\b(?:flag icon|fi) (?:us|gb)\b/.test(n))return'en';
  if(n==='ja'||n==='jp'||n.includes('japones')||n.includes('japanese')||n.includes('japan')||n.includes('japao')||/\b(?:flag icon|fi) jp\b/.test(n))return'ja';
  if(n==='zh'||n==='cn'||n.includes('chines')||n.includes('chinese')||n.includes('china')||/\b(?:flag icon|fi) cn\b/.test(n))return'zh';
  if(n==='ko'||n==='kr'||n.includes('coreano')||n.includes('korean')||n.includes('korea')||/\b(?:flag icon|fi) kr\b/.test(n))return'ko';
  return n;
}

function productLocaleScore(data,wanted){
  const lang=languageKind(wanted?.lang||wanted?.language||'');
  // O body inclui "Outras Edições"; não use esse bloco para decidir idioma/set.
  const hay=normalize([data?.title,data?.edition,data?.code].filter(Boolean).join(' '));
  const tokens=new Set(hay.split(/\s+/).filter(Boolean));
  const japanese=tokens.has('japones')||tokens.has('japanese')||tokens.has('sv2a');
  let score=0;
  if(lang==='ja')score+=japanese?900:-250;
  else if(lang&&japanese)score-=1500;

  // TCGdex chama a coleção internacional de 151 de sv03.5, enquanto a MYP
  // identifica a impressão brasileira/internacional pelo código oficial MEW.
  // A japonesa usa SV2A e compartilha vários nomes/números, então nome+número
  // sozinhos não identificam a impressão correta.
  const setId=normalize(wanted?.setId||'');
  if(setId==='sv03 5'||setId==='sv3 5'){
    if(lang==='ja'){
      if(tokens.has('sv2a'))score+=1100;
      if(tokens.has('mew'))score-=1100;
    }else{
      if(tokens.has('mew'))score+=1100;
      if(tokens.has('sv2a'))score-=1800;
    }
  }
  return score;
}
function productIdentityOk(data,wanted){
  const setId=normalize(wanted?.setId||'');
  const code=normalize(data?.code||'');
  const wantedNumber=numberParts(wanted?.number);
  const collector=/^\d+$/.test(wantedNumber.n)?Number(wantedNumber.n):0;
  const productId=Number((String(data?.url||'').match(/\/produto\/(\d+)\//)||[])[1]||0);
  const deterministicMew=(setId==='sv03 5'||setId==='sv3 5')
    &&collector>0&&productId===205873+collector;
  const canonicalMew=deterministicMew||(
    (setId==='sv03 5'||setId==='sv3 5')
    &&code.includes('pokemon mew')
    &&numberIdentityMatches(data?.title,wanted?.number)
  );
  if(!canonicalMew&&!identityOk(data?.title,wanted))return false;
  return productLocaleScore(data,wanted)>-1000;
}

function normalizeCollectorToken(value){
  const raw=String(value||'').trim().replace(/[^A-Za-z0-9]/g,'');
  if(!raw)return'';
  const m=raw.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  if(!m)return raw.toLowerCase();
  return (m[1]||'').toLowerCase()+String(Number(m[2]))+(m[3]||'').toLowerCase();
}
function numberParts(v){
  const s=String(v||'');
  const token='[A-Za-z]{0,8}\\d{1,4}[A-Za-z]{0,4}';
  const m=s.match(new RegExp('('+token+')\\s*\\/\\s*('+token+')','i'));
  if(m){
    const n=normalizeCollectorToken(m[1]),d=normalizeCollectorToken(m[2]);
    return{n,d,full:n+'/'+d,rawN:m[1],rawD:m[2]};
  }
  const x=s.match(new RegExp(token,'i'));
  if(x){
    const n=normalizeCollectorToken(x[0]);
    return{n,d:'',full:n,rawN:x[0],rawD:''};
  }
  return{n:'',d:'',full:'',rawN:'',rawD:''};
}
function numberIdentityMatches(foundValue,wantedValue){
  const found=numberParts(foundValue),wanted=numberParts(wantedValue);
  if(wanted.n&&found.n!==wanted.n)return false;
  if(wanted.d&&found.d&&found.d!==wanted.d)return false;
  return true;
}
function wantedNameAliases(wanted){
  return [...new Set([wanted?.name,...(Array.isArray(wanted?.nameAliases)?wanted.nameAliases:[])]
    .map(cleanName).map(normalize).filter(Boolean))];
}
function nameIdentityMatches(found,wanted){
  const title=normalize(String(found||'').replace(/\([^)]*\)/g,''));
  const aliases=wantedNameAliases(wanted);
  if(!aliases.length)return true;
  return aliases.some(name=>title===name||title.includes(name)||name.includes(title));
}
function cleanName(v){
  return String(v||'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
}
function identityOk(title,wanted){
  if(!numberIdentityMatches(title,wanted?.number))return false;
  return nameIdentityMatches(title,wanted);
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
  const aliases=wantedNameAliases(wanted);
  if(aliases.some(n=>n===titleName))score+=550;
  else if(aliases.some(n=>titleName.includes(n)||n.includes(titleName)))score+=300;
  const a=numberParts(data.title),b=numberParts(wanted?.number);
  if(b.n&&a.n===b.n)score+=550; else if(b.n)score-=900;
  if(b.d&&a.d===b.d)score+=450; else if(b.d&&a.d&&a.d!==b.d)score-=700;
  score+=setScore(data.edition,wanted);
  score+=productLocaleScore(data,wanted);
  const setId=normalize(wanted?.setId||'');
  if(setId&&normalize(data.body).includes(setId))score+=220;
  return score;
}
function searchCandidateScore(c,wanted){
  let score=0;
  const n=numberParts(c.text),w=numberParts(wanted?.number);
  const hay=normalize(c.text),aliases=wantedNameAliases(wanted);
  if(w.n&&n.n===w.n)score+=500; else if(w.n)score-=900;
  if(w.d&&n.d===w.d)score+=420; else if(w.d&&n.d&&n.d!==w.d)score-=700;
  if(aliases.some(name=>hay.includes(name)))score+=260;
  score+=setScore(c.text,wanted);
  score+=productLocaleScore({title:c.text,edition:c.text,body:c.text},wanted);
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
  const data=await page.evaluate(()=>{
    const body=document.body?.innerText||'';
    const edition=(body.match(/(?:^|\n)\s*Edição\s+([^\n]+)/i)||[])[1]?.trim()||'';
    const code=(body.match(/(?:^|\n)\s*Código\s+([^\n]+)/i)||[])[1]?.trim()||'';
    return {
    title:document.querySelector('h1')?.textContent?.trim()||document.title,
    body,
    edition,
    code,
    // Estes dois valores são as estatísticas oficiais exibidas pela própria MYP.
    summaryMin:document.querySelector('.estatistica-menor .moeda')?.textContent?.trim()||'',
    summaryAvg:document.querySelector('.estatistica-medio .moeda')?.textContent?.trim()||'',
    lastPrice:document.querySelector('.estatistica-ultimo .moeda')?.textContent?.trim()||'',
    offers:[...document.querySelectorAll('tr')].map(tr=>({
      seller:tr.querySelector('.nome-vendedor-apelido')?.textContent?.trim()||'',
      finish:tr.querySelector('.estoque-lista-nomeenfoil')?.textContent?.trim()||'',
      condition:tr.querySelector('.estoque-lista-qualidadenome .chip-inline')?.textContent?.trim()||'',
      language:(()=>{
        const el=tr.querySelector('.estoque-lista-qualidadenome .flag-icon,.estoque-lista-qualidadenome [class*="flag-icon-"],.estoque-lista-qualidadenome [class*="fi-"],.estoque-lista-qualidadenome img[alt]');
        if(!el)return'';
        return [
          el.getAttribute('title'),
          el.getAttribute('aria-label'),
          el.getAttribute('data-original-title'),
          el.getAttribute('data-bs-original-title'),
          el.getAttribute('alt'),
          el.getAttribute('class')
        ].filter(Boolean).join(' ').trim();
      })(),
      price:tr.querySelector('.estoque-lista-precoestoque .moeda')?.textContent?.trim()||'',
      qty:tr.querySelector('.estoque-lista-quantidadeestoque')?.textContent?.trim()||'',
      note:(tr.innerText||'').trim()
    })).filter(x=>x.price)
  }});
  data.edition=labelFromBody(data.body,'Edição');
  data.rarity=labelFromBody(data.body,'Raridade');
  data.httpStatus=response?.status()||0;
  data.url=url;
  return data;
}
function summarizeProduct(data,wanted){
  if(!productIdentityOk(data,wanted)){
    return{ok:false,error:'wrong_product',title:data.title,edition:data.edition,link:data.url,httpStatus:data.httpStatus};
  }

  const wantedFinish=finishKind(wanted.finish||'Normal');
  const wantedCondition=conditionKind(wanted.condition||'Nova');
  const wantedLanguage=languageKind(wanted.lang||wanted.language||'');

  // A página de produto da MYP já representa uma impressão específica.
  // A bandeira exibida em cada linha é do vendedor/localidade da oferta, NÃO
  // o idioma da carta. Filtrar por ela descartava ofertas brasileiras válidas
  // e fazia o preço saltar para a única linha restante (ex.: Salamence 30C).
  // O idioma da impressão é validado pela identidade do produto/edição; nas
  // ofertas filtramos apenas condição e acabamento.
  const sameLanguage=data.offers;
  const sameCondition=sameLanguage.filter(row=>offerConditionKind(row)===wantedCondition);
  const matched=sameCondition.filter(row=>{
    const rowFinish=offerFinishKind(row);
    if(rowFinish==='alteredart'&&wantedFinish!=='alteredart')return false;
    return rowFinish===wantedFinish;
  });

  const prices=matched.map(x=>priceFrom(x.price)).filter(n=>n>0).sort((a,b)=>a-b);
  const qty=matched.reduce((sum,row)=>{
    const m=String(row.qty||'').match(/(\d+)/);
    return sum+(m?Number(m[1]):0);
  },0);

  if(!prices.length){
    return{
      ok:false,error:'variant_not_found',title:data.title,edition:data.edition,link:data.url,httpStatus:data.httpStatus,
      rows:data.offers.length,language:wantedLanguage||null,finish:wantedFinish,condition:wantedCondition,
      message:'Nenhuma oferta da MYP corresponde à condição + acabamento selecionados.'
    };
  }

  const min=prices[0];
  const avg=prices.length>=2?prices.reduce((a,b)=>a+b,0)/prices.length:0;
  const max=prices.length>=2?prices[prices.length-1]:0;

  return{
    ok:true,
    provider:'Chromium',
    mode:'browser-page-condition',
    title:data.title,
    edition:data.edition,
    link:data.url,
    httpStatus:data.httpStatus,
    min,avg,max,
    samples:prices.length,
    availableQuantity:qty||null,
    exactVariant:true,
    complete:!!(min&&avg&&max),
    language:wantedLanguage||null,
    condition:wantedCondition,
    finish:wantedFinish,
    matched:matched.map(x=>({seller:x.seller,language:x.language,finish:x.finish||'(padrão da impressão)',condition:x.condition,price:priceFrom(x.price),qty:x.qty}))
  };
}

async function discoverProduct(browser,page,wanted){
  const names=[...new Set([
    cleanName(wanted?.name),
    ...(Array.isArray(wanted?.nameAliases)?wanted.nameAliases.map(cleanName):[])
  ].filter(Boolean))];
  const collector=String(wanted?.number||'').trim();
  const shortCollector=numberParts(collector).rawN||'';
  const setLabel=cleanName(wanted?.set||wanted?.setName||'');
  // Consultas combinadas primeiro: evitam que uma carta comum caia em outra
  // edição só porque a busca isolada pelo nome tem muitos resultados.
  const queries=[...new Set([
    ...names.flatMap(n=>[
      [n,collector].filter(Boolean).join(' '),
      [n,shortCollector,setLabel].filter(Boolean).join(' '),
      [n,setLabel].filter(Boolean).join(' '),
      n
    ]),
    collector
  ].map(x=>x.trim()).filter(Boolean))].slice(0,10);
  if(!queries.length)return null;
  const map=new Map();
  for(const query of queries){
    const url='https://mypcards.com/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D='+encodeURIComponent(query);
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:50000});
      await page.waitForSelector('a[href*="/pokemon/produto/"]',{timeout:12000}).catch(()=>{});
      await new Promise(resolve=>setTimeout(resolve,1400));
      const raw=await page.evaluate(()=>[...document.querySelectorAll('a[href*="/pokemon/produto/"]')].map(a=>({
        href:a.href,
        text:(a.closest('article,li,.produto-item,.produto,.card,div')?.innerText||a.innerText||'').trim()
      })));
      for(const c of raw){
        if(!/^https:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\//i.test(c.href))continue;
        const old=map.get(c.href);
        if(!old||c.text.length>old.text.length)map.set(c.href,c);
      }
    }catch{}
  }
  let candidates=[...map.values()];
  const wantedNum=numberParts(wanted?.number);
  if(wantedNum.n){
    const exact=candidates.filter(c=>{
      const n=numberParts(c.text);
      return n.n===wantedNum.n&&(!wantedNum.d||!n.d||n.d===wantedNum.d);
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
      if(!productIdentityOk(data,wanted))continue;
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

module.exports={scrapeMypBrowser,findAndScrapeMypBrowser,finishKind,conditionKind,languageKind,priceFrom,numberParts};

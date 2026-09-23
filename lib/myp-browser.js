'use strict';

function normalize(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function slugify(v){
  return normalize(v).replace(/\s+/g,'-');
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
  const canonicalMew=(setId==='sv03 5'||setId==='sv3 5')
    &&code.includes('pokemon mew')
    &&numberIdentityMatches(data?.title,wanted?.number);
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

async function readProduct(page,url,options={}){
  const gotoOptions={waitUntil:'domcontentloaded',timeout:12000};
  if(options.referer)gotoOptions.referer=options.referer;
  const response=await page.goto(url,gotoOptions);
  await page.waitForSelector('h1',{timeout:3000}).catch(()=>{});
  await page.waitForSelector('td.estoque-lista-precoestoque',{timeout:3500}).catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,650));
  const data=await page.evaluate(()=>{
    const body=document.body?.innerText||'';
    const edition=(body.match(/(?:^|\n)\s*Edição\s+([^\n]+)/i)||[])[1]?.trim()||'';
    const code=(body.match(/(?:^|\n)\s*Código\s+([^\n]+)/i)||[])[1]?.trim()||'';
    return {
    title:document.querySelector('h1')?.textContent?.trim()||document.title,
    body,
    edition,
    code,
    finalUrl:location.href,
    related:[...document.querySelectorAll('a[href*="/pokemon/produto/"]')].map(a=>({
      href:a.href,
      text:(a.closest('article,li,.produto-item,.produto,.card,.row,div')?.innerText||a.innerText||'').trim()
    })),
    // Estes dois valores são as estatísticas oficiais exibidas pela própria MYP.
    summaryMin:document.querySelector('.estatistica-menor .moeda')?.textContent?.trim()||'',
    summaryAvg:document.querySelector('.estatistica-medio .moeda')?.textContent?.trim()||'',
    lastPrice:document.querySelector('.estatistica-ultimo .moeda')?.textContent?.trim()||'',
    offers:[...document.querySelectorAll('tr')].map(tr=>{
      const note=(tr.innerText||'').trim();
      const finishNode=tr.querySelector('.estoque-lista-nomeenfoil,[class*="nomeenfoil"],[class*="enfoil"],[data-finish],[data-foil]');
      const finishFromText=(note.match(/\b(Master\s*Ball\s*Foil|Masterball\s*Foil|Pok[eé]\s*Ball\s*Foil|Pokeball\s*Foil|Reverse\s*(?:Foil|Holo)|Full[- ]?Art|Foil|Holo|Promo)\b/i)||[])[1]||'';
      const conditionNode=tr.querySelector('.estoque-lista-qualidadenome .chip-inline,[class*="qualidade"] .chip-inline,[class*="condition"]');
      const conditionFromText=(note.match(/(?:^|\s)(NM|SP|MP|HP|DM)(?=\s|$|-)/i)||[])[1]||'';
      const priceNode=tr.querySelector('.estoque-lista-precoestoque .moeda,[class*="precoestoque"] .moeda,[class*="price"] .moeda');
      const prices=note.match(/R\$\s*[0-9.]+(?:,[0-9]{1,2})?/gi)||[];
      const qtyNode=tr.querySelector('.estoque-lista-quantidadeestoque,[class*="quantidadeestoque"],[class*="quantity"]');
      const qtyFromText=(note.match(/(\d+)\s*un\./i)||[])[0]||'';
      return{
        seller:tr.querySelector('.nome-vendedor-apelido,[class*="vendedor"][class*="apelido"],[class*="seller"]')?.textContent?.trim()||'',
        finish:finishNode?.textContent?.trim()||finishFromText,
        condition:conditionNode?.textContent?.trim()||conditionFromText,
        language:(()=>{
          const el=tr.querySelector('.flag-icon,[class*="flag-icon-"],[class*="fi-"],img[alt]');
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
        price:priceNode?.textContent?.trim()||(prices.length?prices[prices.length-1]:''),
        qty:qtyNode?.textContent?.trim()||qtyFromText,
        note
      };
    }).filter(x=>x.price)
  }});
  data.edition=labelFromBody(data.body,'Edição');
  data.rarity=labelFromBody(data.body,'Raridade');
  data.httpStatus=response?.status()||0;
  data.url=data.finalUrl||url;
  return data;
}
function defaultProductFinish(data){
  const rarity=normalize(data?.rarity||'');
  const np=numberParts(data?.title||'');
  const n=/^\d+$/.test(np.n)?Number(np.n):0;
  const d=/^\d+$/.test(np.d)?Number(np.d):0;
  const intrinsic=/holo|ultra rara|ultra rare|illustration rare|ilustracao rara|ilustracao especial|special illustration|hiper rara|hyper rare|secret rare|secreta|rainbow|dourada|gold/.test(rarity)||(n>0&&d>0&&n>d);
  return intrinsic?'foil':'normal';
}
function effectiveOfferFinish(row,defaultFinish){
  const raw=normalize(row?.finish||'');
  if(!raw)return defaultFinish;
  if((raw.includes('full art')||raw.includes('promo'))&&defaultFinish==='foil')return'foil';
  return offerFinishKind(row);
}
function recognizedOfferLanguage(row){
  const lang=languageKind(row?.language||'');
  return ['pt-br','en','ja','zh','ko'].includes(lang)?lang:'';
}
function summarizeProduct(data,wanted){
  if(!productIdentityOk(data,wanted)){
    return{ok:false,error:'wrong_product',title:data.title,edition:data.edition,link:data.url,httpStatus:data.httpStatus};
  }

  const wantedFinish=finishKind(wanted.finish||'Normal');
  const wantedCondition=conditionKind(wanted.condition||'Nova');
  const wantedLanguage=languageKind(wanted.lang||wanted.language||'');

  // Na MYP, a bandeira na linha da oferta representa o idioma da cópia
  // anunciada. Uma mesma página pode ter EN, PT-BR, JP etc. Nunca misture
  // idiomas quando a própria tabela informa essa diferença.
  const offers=(data.offers||[]).map(row=>({...row,_language:recognizedOfferLanguage(row)}));
  const explicitLanguageRows=offers.filter(row=>row._language);
  let sameLanguage=offers;
  if(wantedLanguage&&explicitLanguageRows.length){
    sameLanguage=explicitLanguageRows.filter(row=>row._language===wantedLanguage);
  }
  const sameCondition=sameLanguage.filter(row=>offerConditionKind(row)===wantedCondition);
  const defaultFinish=defaultProductFinish(data);
  const matched=sameCondition.filter(row=>{
    const rowFinish=effectiveOfferFinish(row,defaultFinish);
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
      rows:data.offers.length,language:wantedLanguage||null,availableLanguages:[...new Set(explicitLanguageRows.map(x=>x._language))],defaultFinish,finish:wantedFinish,condition:wantedCondition,
      diagnostics:offers.slice(0,30).map(row=>({
        seller:row.seller||'',
        rawLanguage:row.language||'',
        language:row._language||'',
        rawCondition:row.condition||'',
        condition:offerConditionKind(row),
        rawFinish:row.finish||'',
        finish:effectiveOfferFinish(row,defaultFinish),
        price:row.price||'',
        note:row.note||''
      })),
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
    matched:matched.map(x=>({seller:x.seller,language:x._language||x.language,finish:x.finish||'(padrão da impressão)',condition:x.condition,price:priceFrom(x.price),qty:x.qty}))
  };
}

function relatedProductCandidates(data,wanted){
  const current=String(data?.url||'');
  const seen=new Set();
  const candidates=[];
  for(const raw of (data?.related||[])){
    const href=String(raw?.href||'');
    if(!/^https:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\//i.test(href)||href===current||seen.has(href))continue;
    seen.add(href);
    candidates.push({href,text:String(raw?.text||'')});
  }
  const wantedNum=numberParts(wanted?.number);
  const exact=candidates.filter(c=>{
    const n=numberParts(c.text);
    return wantedNum.n&&n.n===wantedNum.n&&(!wantedNum.d||!n.d||n.d===wantedNum.d);
  });
  const pool=exact.length?exact:candidates;
  return pool.sort((a,b)=>searchCandidateScore(b,wanted)-searchCandidateScore(a,wanted)).slice(0,6);
}
async function scrapeRelatedProducts(page,data,wanted){
  const candidates=relatedProductCandidates(data,wanted);
  let bestFailure=null;
  for(const candidate of candidates){
    try{
      const related=await readProduct(page,candidate.href);
      if(Number(related.httpStatus)>=400)continue;
      const summary=summarizeProduct(related,wanted);
      if(summary.ok)return{...summary,mode:'browser-related-edition'};
      if(!bestFailure)bestFailure=summary;
    }catch{}
  }
  return bestFailure;
}


async function resolveBrowserSetMeta(wanted){
  const names=[String(wanted?.set||wanted?.setName||'').trim()].filter(Boolean);
  let total=0;
  if(wanted?.setId){
    try{
      const r=await fetch('https://api.tcgdex.net/v2/en/sets/'+encodeURIComponent(wanted.setId),{
        headers:{accept:'application/json','user-agent':'PokemonBinderBR-BrowserIndex/2'}
      });
      if(r.ok){
        const d=await r.json();
        const setName=String(d?.name||'').trim();
        const serieName=String(d?.serie?.name||'').trim();
        if(setName&&serieName)names.unshift(serieName+' '+setName);
        if(setName)names.push(setName);
        total=Number(d?.cardCount?.total||d?.cardCount?.official||0);
      }
    }catch{}
  }
  return{total,slugs:[...new Set(names.map(slugify).filter(Boolean))]};
}
async function discoverProductFromCollection(page,wanted){
  const meta=await resolveBrowserSetMeta(wanted);
  const np=numberParts(wanted?.number);
  const collector=/^\d+$/.test(np.n)?Number(np.n):0;
  let estimated=1;
  if(meta.total&&collector)estimated=Math.max(1,Math.floor(Math.max(0,meta.total-collector)/30)+1);
  const pages=[estimated];
  if(estimated>1)pages.push(estimated-1);
  pages.push(estimated+1);
  const diagnostics=[];

  for(const slug of meta.slugs.slice(0,3)){
    for(const pageNo of [...new Set(pages)].slice(0,1)){
      const collectionUrl='https://mypcards.com/pokemon/'+slug+'?page='+pageNo+'&sort=-codigoproduto';
      try{
        const response=await page.goto(collectionUrl,{waitUntil:'domcontentloaded',timeout:12000});
        await page.waitForSelector('a[href*="/pokemon/produto/"]',{timeout:3500}).catch(()=>{});
        await new Promise(resolve=>setTimeout(resolve,180));

        const pageInfo=await page.evaluate((wantedNumber)=>{
          const target=String(wantedNumber||'').replace(/\s/g,'');
          const body=(document.body?.innerText||'');
          return{
            title:document.title||'',
            url:location.href,
            statusText:body.slice(0,120),
            anchors:document.querySelectorAll('a[href*="/pokemon/produto/"]').length,
            hasNumber:body.replace(/\s/g,'').includes(target)
          };
        },wanted?.number||'');

        const raw=await page.evaluate((wantedNumber)=>{
          const target=String(wantedNumber||'').replace(/\s/g,'');
          return [...document.querySelectorAll('a[href*="/pokemon/produto/"]')].map(a=>{
            let node=a;
            let bestText=(a.innerText||'').trim();
            for(let depth=0;depth<10&&node;depth++,node=node.parentElement){
              const text=(node.innerText||'').trim();
              const compact=text.replace(/\s/g,'');
              if(text&&text.length<1500)bestText=text;
              if(target&&compact.includes(target)){bestText=text;break}
            }
            return{href:a.href,text:bestText};
          });
        },wanted?.number||'');

        let candidates=raw.filter(c=>/^https:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\//i.test(c.href));
        let exactCount=0;
        if(np.n){
          const exact=candidates.filter(c=>{
            const found=numberParts(c.text);
            return found.n===np.n&&(!np.d||!found.d||found.d===np.d);
          });
          exactCount=exact.length;
          if(exact.length)candidates=exact;
          else{
            diagnostics.push({slug,pageNo,status:response?.status()||0,anchors:pageInfo.anchors,hasNumber:pageInfo.hasNumber,exact:0,url:pageInfo.url});
            continue;
          }
        }
        candidates=[...new Map(candidates.map(c=>[c.href,c])).values()];
        diagnostics.push({
          slug,pageNo,status:response?.status()||0,anchors:pageInfo.anchors,
          hasNumber:pageInfo.hasNumber,exact:exactCount,url:pageInfo.url,
          candidates:candidates.slice(0,3).map(c=>c.href)
        });
        candidates.sort((a,b)=>searchCandidateScore(b,wanted)-searchCandidateScore(a,wanted));
        for(const candidate of candidates.slice(0,3)){
          try{
            const data=await readProduct(page,candidate.href,{referer:collectionUrl});
            const identityOkNow=productIdentityOk(data,wanted);
            diagnostics.push({
              product:candidate.href,status:data.httpStatus||0,title:String(data.title||'').slice(0,90),
              edition:String(data.edition||'').slice(0,90),code:String(data.code||'').slice(0,90),
              identityOk:identityOkNow
            });
            if(Number(data.httpStatus)>=400){
              if(Number(data.httpStatus)===403){
                return{__productBlocked:true,link:candidate.href,httpStatus:data.httpStatus,diagnostics};
              }
              continue;
            }
            if(!identityOkNow)continue;
            return data;
          }catch(error){
            diagnostics.push({product:candidate.href,error:error?.name||'error',message:String(error?.message||'').slice(0,100)});
          }
        }
      }catch(error){
        diagnostics.push({slug,pageNo,error:error?.name||'error',message:String(error?.message||'').slice(0,90),url:collectionUrl});
      }
    }
  }
  return{__collectionMiss:true,diagnostics,slugs:meta.slugs,total:meta.total,estimated};
}
async function discoverProduct(browser,page,wanted){
  const baseName=cleanName(wanted?.name);
  const names=[...new Set([
    ...(Array.isArray(wanted?.nameAliases)?wanted.nameAliases.map(cleanName):[]),
    baseName
  ].filter(Boolean))].sort((a,b)=>{
    const ad=normalize(a)!==normalize(baseName)?0:1;
    const bd=normalize(b)!==normalize(baseName)?0:1;
    return ad-bd;
  });
  const collector=String(wanted?.number||'').trim();
  const shortCollector=numberParts(collector).rawN||'';
  const setLabel=cleanName(wanted?.set||wanted?.setName||'');
  const normalizedSetId=normalize(wanted?.setId||'');
  const setAliases=[setLabel];
  if(normalizedSetId==='sv03 5'||normalizedSetId==='sv3 5')setAliases.push('MEW','151');
  if(normalizedSetId==='sv2a'||normalizedSetId==='sv2 a')setAliases.push('SV2A','151 Japonês');
  const queries=[...new Set([
    ...names,
    ...names.map(n=>[n,collector].filter(Boolean).join(' ')),
    ...names.map(n=>[n,shortCollector].filter(Boolean).join(' ')),
    ...names.flatMap(n=>setAliases.slice(0,2).map(s=>[n,s].filter(Boolean).join(' '))),
    [collector,setAliases.find(Boolean)].filter(Boolean).join(' '),
    collector
  ].map(x=>x.trim()).filter(Boolean))].slice(0,5);
  if(!queries.length)return null;
  const map=new Map();
  for(const query of queries){
    const url='https://mypcards.com/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D='+encodeURIComponent(query);
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:10000});
      await page.waitForSelector('a[href*="/pokemon/produto/"]',{timeout:3000}).catch(()=>{});
      await new Promise(resolve=>setTimeout(resolve,180));
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
  candidates=candidates.slice(0,3);
  if(!candidates.length)return null;

  let best=null;
  for(const candidate of candidates){
    try{
      const data=await readProduct(page,candidate.href);
      if(Number(data.httpStatus)>=400)continue;
      if(!productIdentityOk(data,wanted))continue;
      const score=productScore(data,wanted);
      if(!best||score>best.score)best={...data,score};
      if(score>=1800)break;
    }catch{}
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
    if(url)data=await readProduct(page,url);
    else{
      const started=Date.now();
      data=await discoverProductFromCollection(page,wanted);
      if(data?.__productBlocked){
        return{ok:false,error:'product_blocked',link:data.link,httpStatus:data.httpStatus||403,message:'Produto localizado na coleção, mas a MYP bloqueou a abertura direta.'};
      }
      if(data?.__collectionMiss){
        const diag=(data.diagnostics||[]).map(x=>{
          if(x.product)return['product',x.product,x.status||x.error||'',x.identityOk===true?'ok':x.identityOk===false?'bad':'',x.title||'',x.edition||'',x.code||'',x.message||''].join(',');
          return[x.slug,x.pageNo,x.status||x.error,x.anchors??'',x.hasNumber?'num':'nonum',x.exact??'',(x.candidates||[]).join('~'),x.url||''].join(',');
        }).join(';');
        return{ok:false,error:'collection_not_found',stage:'collection',elapsedMs:Date.now()-started,message:'diag='+diag+'|slugs='+(data.slugs||[]).join('/')+'|total='+String(data.total||0)+'|estimated='+String(data.estimated||0)};
      }
      if(!data)return{ok:false,error:'collection_not_found',stage:'collection',elapsedMs:Date.now()-started,message:'collection-null'};
    }
    if(!data)return{ok:false,error:'product_not_found',message:'A busca da MYP não encontrou a impressão correta.'};

    let summary=summarizeProduct(data,wanted);
    if(summary.ok)return summary;

    // Se a impressão é conhecida mas a variante não aparece na primeira
    // lista de vendedores, percorra as duas paginações da MESMA página:
    // lojistas/certificados e demais vendedores. Isso evita redescobrir
    // o produto por nome quando o link correto já é conhecido.
    if(url&&finishKind(wanted?.finish)!=='normal'){
      const base=String(url).split('?')[0];
      const variantPages=[
        '?estoque-outros-page=2',
        '?estoque-cert-page=2'
      ];
      const markets=[];
      for(const suffix of variantPages){
        try{
          const paged=await readProduct(page,base+suffix);
          if(Number(paged.httpStatus)>=400)continue;
          if(!productIdentityOk(paged,wanted))continue;
          const m=summarizeProduct(paged,wanted);
          if(m.ok){
            // Uma única oferta válida já é cotação real. Não segure o worker
            // procurando média/máximo enquanto a carta continua "sem cotação".
            return{...m,mode:'browser-seller-pagination'};
          }
        }catch{}
      }
      if(markets.length){
        const prices=[];
        let qty=0;
        for(const m of markets){
          if(Number(m.min)>0)prices.push(Number(m.min));
          if(Number(m.samples||0)>=2&&Number(m.max)>0&&Number(m.max)!==Number(m.min))prices.push(Number(m.max));
          qty+=Number(m.availableQuantity||0);
        }
        prices.sort((a,b)=>a-b);
        if(prices.length){
          return{
            ...markets[0],
            mode:'browser-seller-pagination',
            min:prices[0],
            avg:prices.reduce((a,b)=>a+b,0)/prices.length,
            max:prices.length>1?prices[prices.length-1]:0,
            samples:prices.length,
            availableQuantity:qty||markets[0].availableQuantity||null,
            exactVariant:true,
            complete:prices.length>1
          };
        }
      }
    }

    if(url&&wanted?.strictDirect){
      return summary?.error
        ? summary
        : {ok:false,error:'variant_not_found',link:url,message:'A página MYP conhecida não exibiu a variante solicitada.'};
    }

    // A página encontrada pode estar em outro idioma ou variante. A própria
    // MYP lista outras edições/versões: percorremos essas páginas primeiro.
    const related=await scrapeRelatedProducts(page,data,wanted);
    if(related?.ok)return related;

    // Se o link salvo era ruim ou a versão inicial não tinha PT-BR/NM/finish,
    // faça uma nova descoberta textual automaticamente, sem depender do usuário.
    if(url){
      const discovered=await discoverProduct(browser,page,wanted);
      if(discovered&&String(discovered.url)!==String(data.url)){
        data=discovered;
        summary=summarizeProduct(data,wanted);
        if(summary.ok)return summary;
        const relatedDiscovered=await scrapeRelatedProducts(page,data,wanted);
        if(relatedDiscovered?.ok)return relatedDiscovered;
      }
    }
    return related||summary;
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

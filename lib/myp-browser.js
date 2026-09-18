'use strict';

function normalize(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function moneyValues(v){
  const text=String(v||'');
  const out=[];
  for(const m of text.matchAll(/R\$\s*([0-9.]+(?:,[0-9]{1,2})?)/gi)){
    const n=Number(m[1].replace(/\./g,'').replace(',','.'));
    if(Number.isFinite(n)&&n>0)out.push(n);
  }
  if(!out.length){
    const s=text.trim().replace(/\./g,'').replace(',','.');
    const n=Number(s);
    if(Number.isFinite(n)&&n>0)out.push(n);
  }
  return out;
}
function priceFrom(v){
  const values=moneyValues(v);
  // Promoções aparecem como "preço antigo + preço atual"; o último é o vigente.
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
  if(!n||n==='NOVA'||n==='NEW'||n==='MINT')return'NM';
  if(n.includes('NEAR MINT'))return'NM';
  if(n.includes('SLIGHTLY PLAYED'))return'SP';
  if(n.includes('MODERATELY PLAYED'))return'MP';
  if(n.includes('HEAVILY PLAYED'))return'HP';
  if(n.includes('DAMAGED'))return'DM';
  if(n==='D')return'DM';
  return n;
}
function numberParts(v){
  const s=String(v||'');
  const m=s.match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
  return m?{n:String(Number(m[1])),d:String(Number(m[2]))}:{n:'',d:''};
}
function identityOk(title,wanted){
  const t=normalize(title),name=normalize(wanted?.name),a=numberParts(title),b=numberParts(wanted?.number);
  if(name&&!t.includes(name)&&!name.includes(t.replace(/\d+\s*\d+$/,'')))return false;
  if(b.n&&a.n&&b.n!==a.n)return false;
  if(b.d&&a.d&&b.d!==a.d)return false;
  return true;
}

async function scrapeMypBrowser(url,wanted={}){
  let browser;
  try{
    const chromiumModule=await import('@sparticuz/chromium');
    const chromium=chromiumModule.default||chromiumModule;
    const puppeteerModule=await import('puppeteer-core');
    const puppeteer=puppeteerModule.default||puppeteerModule;

    browser=await puppeteer.launch({
      args:chromium.args,
      defaultViewport:{width:1365,height:900},
      executablePath:await chromium.executablePath(),
      headless:chromium.headless
    });
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'pt-BR,pt;q=0.9,en;q=0.6'});

    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:50000});
    await page.waitForSelector('td.estoque-lista-precoestoque',{timeout:16000}).catch(()=>{});

    const data=await page.evaluate(()=>({
      title:document.querySelector('h1')?.textContent?.trim()||document.title,
      offers:[...document.querySelectorAll('tr')].map(tr=>({
        seller:tr.querySelector('.nome-vendedor-apelido')?.textContent?.trim()||'',
        finish:tr.querySelector('.estoque-lista-nomeenfoil')?.textContent?.trim()||'',
        condition:tr.querySelector('.estoque-lista-qualidadenome .chip-inline')?.textContent?.trim()||'',
        price:tr.querySelector('.estoque-lista-precoestoque .moeda')?.textContent?.trim()||'',
        qty:tr.querySelector('.estoque-lista-quantidadeestoque')?.textContent?.trim()||''
      })).filter(x=>x.price)
    }));

    if(!identityOk(data.title,wanted)){
      return {ok:false,error:'wrong_product',title:data.title,httpStatus:response?.status()||0};
    }

    const wantedFinish=finishKind(wanted.finish||'Normal');
    const wantedCondition=conditionKind(wanted.condition||'Nova');

    const matched=data.offers.filter(row=>{
      const rowFinish=finishKind(row.finish);
      const rowCondition=conditionKind(row.condition);
      return rowFinish===wantedFinish && rowCondition===wantedCondition;
    });

    const prices=matched.map(x=>priceFrom(x.price)).filter(n=>n>0).sort((a,b)=>a-b);
    const qty=matched.reduce((sum,row)=>{
      const m=String(row.qty||'').match(/(\d+)/);
      return sum+(m?Number(m[1]):0);
    },0);

    if(!prices.length){
      return {
        ok:false,error:'variant_not_found',title:data.title,httpStatus:response?.status()||0,
        rows:data.offers.length,finish:wantedFinish,condition:wantedCondition
      };
    }

    const min=prices[0];
    const avg=prices.length>=2?prices.reduce((a,b)=>a+b,0)/prices.length:0;
    const max=prices.length>=2?prices[prices.length-1]:0;

    return {
      ok:true,
      provider:'Chromium',
      mode:'browser-page',
      title:data.title,
      httpStatus:response?.status()||0,
      min,avg,max,
      samples:prices.length,
      availableQuantity:qty||null,
      exactVariant:true,
      complete:!!(min&&avg&&max),
      matched:matched.map(x=>({seller:x.seller,finish:x.finish,condition:x.condition,price:priceFrom(x.price),qty:x.qty}))
    };
  }catch(error){
    return {ok:false,error:'browser_error',message:error?.message||String(error)};
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
}

module.exports={scrapeMypBrowser,finishKind,conditionKind,priceFrom};

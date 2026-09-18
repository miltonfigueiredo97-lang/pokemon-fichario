'use strict';

function parseBRL(v){
  const s=String(v||'').replace(/R\$/gi,'').trim().replace(/\./g,'').replace(',','.');
  const n=Number(s);
  return Number.isFinite(n)?n:0;
}
function finishNorm(v){
  const s=String(v||'').trim().toLowerCase();
  if(!s)return'';
  if(s.includes('full-art')||s.includes('full art'))return'full-art';
  if(s.includes('foil'))return'foil';
  return s;
}
function condNorm(v){return String(v||'').trim().toUpperCase()}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  const url=String(req.query.url||'https://mypcards.com/pokemon/produto/38909/lugia-ex');
  if(!/^https:\/\/(www\.)?mypcards\.com\/pokemon\/produto\/\d+\//i.test(url)){
    return res.status(400).json({ok:false,error:'invalid_url'});
  }
  let browser;
  try{
    let chromium,puppeteer;
    try{
      const chromiumModule=await import('@sparticuz/chromium');
      chromium=chromiumModule.default||chromiumModule;
      const puppeteerModule=await import('puppeteer-core');
      puppeteer=puppeteerModule.default||puppeteerModule;
    }catch(e){
      return res.status(200).json({ok:false,stage:'require',error:e?.stack||e?.message||String(e)});
    }
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
    await page.waitForSelector('td.estoque-lista-precoestoque',{timeout:15000}).catch(()=>{});
    const data=await page.evaluate(()=>{
      const title=document.querySelector('h1')?.textContent?.trim()||document.title;
      const rows=[...document.querySelectorAll('tr')].map(tr=>({
        seller:tr.querySelector('.nome-vendedor-apelido')?.textContent?.trim()||'',
        finish:tr.querySelector('.estoque-lista-nomeenfoil')?.textContent?.trim()||'',
        condition:tr.querySelector('.estoque-lista-qualidadenome .chip-inline')?.textContent?.trim()||'',
        price:tr.querySelector('.estoque-lista-precoestoque .moeda')?.textContent?.trim()||'',
        qty:tr.querySelector('.estoque-lista-quantidadeestoque')?.textContent?.trim()||''
      })).filter(x=>x.price);
      const pageText=document.body.innerText;
      return {title,rows,pageText:pageText.slice(0,5000)};
    });
    const wantedFinish=finishNorm(req.query.finish||'');
    const wantedCondition=condNorm(req.query.condition||'');
    const matched=data.rows.filter(r=>{
      const f=finishNorm(r.finish),c=condNorm(r.condition);
      const finishOk=!wantedFinish||f===wantedFinish;
      const condOk=!wantedCondition||c===wantedCondition;
      return finishOk&&condOk;
    });
    const prices=matched.map(r=>parseBRL(r.price)).filter(n=>n>0).sort((a,b)=>a-b);
    const result={
      ok:true,
      httpStatus:response?.status()||0,
      title:data.title,
      offers:data.rows,
      matched,
      min:prices[0]||0,
      avg:prices.length?prices.reduce((a,b)=>a+b,0)/prices.length:0,
      max:prices.length?prices[prices.length-1]:0,
      samples:prices.length
    };
    return res.status(200).json(result);
  }catch(error){
    return res.status(200).json({ok:false,error:error?.message||String(error)});
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
};

module.exports.config={maxDuration:60};

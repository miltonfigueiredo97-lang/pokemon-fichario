'use strict';

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
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
    const q='Lugia V';
    const base='https://mypcards.com/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D='+encodeURIComponent(q);
    const r1=await page.goto(base,{waitUntil:'domcontentloaded',timeout:50000});
    await new Promise(r=>setTimeout(r,5000));
    const editions=await page.evaluate(()=>[...document.querySelectorAll('input[name="ProdutoSearch[edicoesSelecionadas][]"]')].map(input=>({
      value:input.value,
      id:input.id,
      label:(document.querySelector('label[for="'+CSS.escape(input.id)+'"]')?.innerText||'').trim()
    })));
    const wanted='tempestade prateada';
    const match=editions.find(e=>norm(e.label).includes(norm(wanted)));
    let filtered=null, links=[];
    if(match){
      const url=base+'&ProdutoSearch%5BedicoesSelecionadas%5D%5B%5D='+encodeURIComponent(match.value);
      const r2=await page.goto(url,{waitUntil:'domcontentloaded',timeout:50000});
      await new Promise(r=>setTimeout(r,5000));
      links=await page.evaluate(()=>[...document.querySelectorAll('a[href*="/pokemon/produto/"]')].map(a=>({
        href:a.href,
        text:(a.closest('article,li,.produto-item,.produto,.card,div')?.innerText||a.innerText||'').trim()
      })).slice(0,60));
      filtered={url,httpStatus:r2?.status()||0,body:(await page.evaluate(()=>document.body?.innerText||'')).slice(0,10000)};
    }
    res.status(200).json({ok:true,httpStatus:r1?.status()||0,match,editionCount:editions.length,editions,links,filtered});
  }catch(error){
    res.status(200).json({ok:false,error:error?.message||String(error),stack:error?.stack||''});
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
};
module.exports.config={maxDuration:60};

'use strict';

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
    const url='https://mypcards.com/pokemon?ProdutoSearch%5Bmarca%5D=pokemon&ProdutoSearch%5Bquery%5D=Lugia%20V';
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:50000});
    await new Promise(r=>setTimeout(r,7000));
    const data=await page.evaluate(()=>({
      title:document.title,
      body:(document.body?.innerText||'').slice(0,16000),
      links:[...document.querySelectorAll('a[href*="/pokemon/produto/"]')].slice(0,40).map(a=>({
        href:a.href,
        text:(a.closest('article,li,.produto-item,.produto,.card,div')?.innerText||a.innerText||'').trim().slice(0,1200)
      }))
    }));
    res.status(200).json({ok:true,httpStatus:response?.status()||0,url,...data});
  }catch(error){
    res.status(200).json({ok:false,error:error?.message||String(error),stack:error?.stack||''});
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
};
module.exports.config={maxDuration:60};

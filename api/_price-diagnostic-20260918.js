'use strict';

const ACTS='https://api.apify.com/v2/acts';
const ALLOWED=new Set(['Charizard ex','Lugia-EX','Omanyte']);

async function run(actor,input){
  const token=process.env.APIFY_API_TOKEN;
  if(!token)return {ok:false,error:'no_token'};
  const url=`${ACTS}/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=55`;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),58000);
  try{
    const r=await fetch(url,{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify(input),
      signal:ctrl.signal
    });
    const text=await r.text();
    let data=null;try{data=JSON.parse(text)}catch{}
    return {
      ok:r.ok,
      status:r.status,
      count:Array.isArray(data)?data.length:(Array.isArray(data?.items)?data.items.length:null),
      sample:(Array.isArray(data)?data:(data?.items||[])).slice(0,12),
      error:!r.ok?(data?.error?.message||text.slice(0,1000)):null
    };
  }catch(e){
    return {ok:false,error:e?.name+': '+e?.message};
  }finally{clearTimeout(timer)}
}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  const name=String(req.query.name||'Charizard ex');
  if(!ALLOWED.has(name))return res.status(400).json({ok:false,error:'name_not_allowed'});
  const source=String(req.query.source||'myp');

  if(source==='liga'){
    const out=await run('gio21~ligapokemon-scraper',{
      query:name,
      language:'any',
      includeOffers:false,
      maxItems:30,
      proxyConfiguration:{
        useApifyProxy:true,
        apifyProxyGroups:['RESIDENTIAL'],
        apifyProxyCountry:'BR'
      }
    });
    return res.status(200).json({source:'liga',name,...out});
  }

  const out=await run('gio21~mypcards-scraper',{
    query:name,
    game:'pokemon',
    language:'any',
    condition:'any',
    includeOffers:true,
    maxProducts:15,
    maxItems:80,
    proxyConfiguration:{useApifyProxy:true}
  });
  return res.status(200).json({source:'myp',name,...out});
};

module.exports.config={maxDuration:60};

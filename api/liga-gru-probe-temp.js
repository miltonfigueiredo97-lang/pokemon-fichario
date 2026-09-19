'use strict';

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  const target='https://www.ligapokemon.com.br/?view=cards/card&card='+encodeURIComponent('Lugia-EX (134/135)')+'&ed=PLS&num=134';
  try{
    const r=await fetch(target,{
      redirect:'follow',
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
        'Accept-Language':'pt-BR,pt;q=0.9,en;q=0.6',
        'Accept':'text/html,application/xhtml+xml,*/*;q=.8'
      }
    });
    const text=await r.text();
    res.status(200).json({
      ok:r.ok,status:r.status,region:process.env.VERCEL_REGION||'',
      title:(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'',
      cloudflare:/cloudflare|just a moment|error 1005|cf-chl|security verification/i.test(text),
      bytes:text.length,
      sample:text.slice(0,1200)
    });
  }catch(e){
    res.status(200).json({ok:false,region:process.env.VERCEL_REGION||'',error:e?.message||String(e)});
  }
};
module.exports.config={maxDuration:60,regions:['gru1']};

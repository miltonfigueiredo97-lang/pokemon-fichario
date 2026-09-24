'use strict';

const { relatedMypCatalogBrowser } = require('../lib/myp-browser');

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=1800');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
  const name=String(req.query?.name||'').trim();
  const seeds=String(req.query?.seeds||'').split('|').map(x=>x.trim()).filter(Boolean).slice(0,3);
  const lang=String(req.query?.lang||'pt-br').trim()||'pt-br';
  if(!name||!seeds.length)return res.status(200).json({ok:true,cards:[]});
  try{
    const cards=(await relatedMypCatalogBrowser(seeds,name,{limit:100})).map(c=>({
      ...c,
      languageCode:lang,
      language:lang==='pt-br'?'Português':lang==='ja'?'Japonês':'Inglês',
      market:{source:'MYP Cards',min:0,avg:0,max:0,link:c.mypLink||''}
    }));
    return res.status(200).json({ok:true,count:cards.length,cards});
  }catch(error){
    console.error('[myp-related-catalog]',error);
    return res.status(200).json({ok:true,cards:[],error:'myp_related_failed'});
  }
};
module.exports.config={maxDuration:30};

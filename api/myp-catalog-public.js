'use strict';

const { searchMypCatalogBrowser } = require('../lib/myp-browser');

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=180, stale-while-revalidate=900');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
  const name=String(req.query?.name||'').trim();
  const lang=String(req.query?.lang||'pt-br').trim()||'pt-br';
  const number=String(req.query?.number||'').trim();
  const set=String(req.query?.set||'').trim();
  const limit=Math.max(1,Math.min(60,Number(req.query?.limit)||40));
  if(name.length<2)return res.status(200).json({ok:true,cards:[]});
  try{
    let cards=await searchMypCatalogBrowser(name,{limit});
    const q=norm(name),n=norm(number),s=norm(set);
    cards=cards.filter(c=>{
      const cn=norm(c.name),ct=norm(c.rawText);
      if(q&&!(cn===q||cn.includes(q)||q.includes(cn)||ct.includes(q)))return false;
      if(n&&!(norm(c.number).includes(n)||ct.includes(n)))return false;
      if(s&&!(norm(c.setName).includes(s)||ct.includes(s)))return false;
      return true;
    }).map(c=>({
      ...c,
      languageCode:lang,
      language:lang==='pt-br'?'Português':lang==='ja'?'Japonês':'Inglês',
      priceLink:c.mypLink||'',
      market:{source:'MYP Cards',min:0,avg:0,max:0,link:c.mypLink||''}
    }));
    return res.status(200).json({ok:true,count:cards.length,cards});
  }catch(error){
    console.error('[myp-catalog-public]',error);
    return res.status(200).json({ok:true,cards:[],error:'myp_catalog_failed'});
  }
};
module.exports.config={maxDuration:30};

'use strict';

const BASE='https://www.pokemon-card.com';
const API=BASE+'/card-search/resultAPI.php';

function n(v){const m=String(v||'').match(/\d+/);return m?Number(m[0]):0}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','public, s-maxage=604800, stale-while-revalidate=2592000');
  const set=String(req.query.set||'').trim();
  const wanted=n(req.query.localId);
  if(!set||!wanted)return res.status(400).json({ok:false,error:'set_and_localId_required'});

  const headers={
    'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
    'Accept':'application/json, text/javascript, */*; q=0.01',
    'Accept-Language':'ja,en-US;q=0.9,en;q=0.8',
    'Referer':BASE+'/card-search/',
    'X-Requested-With':'XMLHttpRequest'
  };

  try{
    let position=0;
    for(let page=1;page<=30;page++){
      const u=new URL(API);
      u.searchParams.set('pg',set);
      u.searchParams.set('page',String(page));
      u.searchParams.set('regulation_sidebar_form','all');
      u.searchParams.set('keyword','');
      u.searchParams.set('se_ta','');
      u.searchParams.set('illust','');
      u.searchParams.set('sm_and_keyword','true');

      const r=await fetch(u,{headers,redirect:'follow'});
      if(!r.ok)break;
      const j=await r.json();
      const list=Array.isArray(j.cardList)?j.cardList:[];
      for(const card of list){
        position++;
        if(position===wanted){
          const thumb=String(card.cardThumbFile||'');
          if(!thumb)return res.status(404).json({ok:false,error:'image_missing'});
          const image=thumb.startsWith('http')?thumb:BASE+thumb;
          res.statusCode=302;
          res.setHeader('Location',image);
          return res.end();
        }
      }
      if(page>=Number(j.maxPage||1)||!list.length)break;
    }
    return res.status(404).json({ok:false,error:'not_found'});
  }catch(error){
    return res.status(502).json({ok:false,error:'jp_source_failed',message:error?.message||String(error)});
  }
};

module.exports.config={maxDuration:30};

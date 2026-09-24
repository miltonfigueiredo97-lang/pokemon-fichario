'use strict';

const JP_LABELS=require('../data/jp-set-labels.json');
const BASE='https://api.tcgdex.net/v2';
const CACHE=new Map();

function apiLang(v){
  const x=String(v||'pt').toLowerCase();
  if(x==='pt-br')return'pt';
  return ['pt','en','ja'].includes(x)?x:'pt';
}
async function json(url){
  const r=await fetch(url,{headers:{accept:'application/json'}});
  if(!r.ok)throw new Error('TCGdex '+r.status);
  return r.json();
}
async function pool(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){
    while(true){
      const i=next++;
      if(i>=items.length)return;
      try{out[i]=await fn(items[i],i)}catch(e){out[i]={__error:String(e)}}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length||1)},worker));
  return out;
}
function dateValue(v){
  const t=Date.parse(String(v||''));
  return Number.isFinite(t)?t:Number.MAX_SAFE_INTEGER;
}
function displayName(lang,set){
  if(lang==='ja'){
    const key=String(set?.id||'');
    return JP_LABELS[key]||JP_LABELS[key.toUpperCase()]||set?.name||key;
  }
  return set?.name||set?.id||'';
}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=86400, stale-while-revalidate=604800');
  const lang=apiLang(req.query.lang);
  const seriesId=String(req.query.series||'').trim();
  if(!seriesId)return res.status(400).json({ok:false,error:'series_required'});
  const key=lang+'|'+seriesId;
  const hit=CACHE.get(key);
  if(hit&&Date.now()-hit.at<86400000)return res.status(200).json(hit.value);

  try{
    const serie=await json(BASE+'/'+lang+'/series/'+encodeURIComponent(seriesId));
    const briefs=Array.isArray(serie?.sets)?serie.sets:[];
    const details=await pool(briefs,12,async brief=>{
      try{
        return await json(BASE+'/'+lang+'/sets/'+encodeURIComponent(brief.id));
      }catch(e){
        if(lang!=='en'){
          try{return await json(BASE+'/en/sets/'+encodeURIComponent(brief.id))}catch{}
        }
        return {...brief,releaseDate:''};
      }
    });
    const sets=briefs.map((brief,i)=>{
      const d=details[i]&&!details[i].__error?details[i]:brief;
      return {
        id:brief.id,
        name:d.name||brief.name||brief.id,
        displayName:displayName(lang,{...brief,...d}),
        releaseDate:d.releaseDate||'',
        cardCount:d.cardCount||brief.cardCount||{},
        isPromo:/promo|black star/i.test(String(d.name||brief.name||'')+' '+String(brief.id||''))
      };
    }).filter(s=>!(lang==='pt'&&String(s.id||'').toLowerCase()==='xy12'))
      .sort((a,b)=>dateValue(a.releaseDate)-dateValue(b.releaseDate)||String(a.displayName).localeCompare(String(b.displayName),'en',{numeric:true}));

    const value={ok:true,series:{id:serie.id||seriesId,name:serie.name||seriesId},sets};
    CACHE.set(key,{at:Date.now(),value});
    return res.status(200).json(value);
  }catch(error){
    return res.status(500).json({ok:false,error:'set_catalog_failed',message:error?.message||String(error)});
  }
};
module.exports.config={maxDuration:60};

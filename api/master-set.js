'use strict';

const CACHE=new Map();
const BASE='https://api.tcgdex.net/v2';

function apiLang(v){
  const x=String(v||'pt').toLowerCase();
  if(x==='pt-br')return'pt';
  return ['pt','en','ja'].includes(x)?x:'pt';
}
function finishFor(type){
  const n=String(type||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(n.includes('master')&&n.includes('ball'))return'Masterball Foil';
  if((n.includes('poke')||n.includes('poke'))&&n.includes('ball'))return'Pokeball Foil';
  if(n.includes('reverse'))return'Reverse Foil';
  if(n.includes('holo'))return'Foil';
  if(n.includes('normal'))return'Normal';
  if(n.includes('promo'))return'Promo';
  return'Especial';
}
function variantOrder(finish){
  return ({Normal:0,Foil:1,'Reverse Foil':2,'Pokeball Foil':3,'Masterball Foil':4,Promo:5,Especial:6})[finish]??9;
}
async function json(url){
  const r=await fetch(url,{headers:{accept:'application/json'}});
  if(!r.ok)throw new Error('TCGdex '+r.status);
  return r.json();
}
async function jsonOrNull(url){
  try{return await json(url)}catch{return null}
}
async function pool(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(e){out[i]={__error:String(e)}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}
function variantsOf(card){
  const detailed=Array.isArray(card?.variants_detailed)?card.variants_detailed:[];
  const out=[];
  if(detailed.length){
    for(const v of detailed){
      const type=String(v?.type||'').trim()||'Normal';
      out.push({
        key:String(v?.variantId||type),
        label:type,
        finish:finishFor(type),
        order:variantOrder(finishFor(type))
      });
    }
  }else{
    const v=card?.variants||{};
    if(v.normal)out.push({key:'normal',label:'Normal',finish:'Normal',order:0});
    if(v.holo)out.push({key:'holo',label:'Holo',finish:'Foil',order:1});
    if(v.reverse)out.push({key:'reverse',label:'Reverse',finish:'Reverse Foil',order:2});
    if(v.firstEdition)out.push({key:'first-edition',label:'1ª Edição',finish:'Especial',order:6});
    if(v.wPromo)out.push({key:'w-promo',label:'W Promo',finish:'Promo',order:5});
  }
  if(!out.length)out.push({key:'base',label:'Normal',finish:'Normal',order:0});

  // TCGdex variants_detailed can contain several internal variantIds for the
  // same physical finish. A Master Set needs one pocket per physical variant,
  // not one pocket per internal marketplace/printing identifier.
  const semanticKey=v=>{
    const finish=String(v.finish||'Especial');
    if(finish!=='Especial')return finish;
    return 'Especial|'+String(v.label||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  };
  const seen=new Set();
  return out.filter(x=>{
    const k=semanticKey(x);
    if(seen.has(k))return false;
    seen.add(k);
    x.key=k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'base';
    return true;
  }).sort((a,b)=>a.order-b.order||a.label.localeCompare(b.label));
}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=86400');
  const lang=apiLang(req.query.lang),setId=String(req.query.set||'').trim();
  if(!setId)return res.status(400).json({ok:false,error:'set_required'});
  const cacheKey=lang+'|'+setId;
  const cached=CACHE.get(cacheKey);
  if(cached&&Date.now()-cached.at<3600000)return res.status(200).json(cached.value);
  try{
    let set=await jsonOrNull(BASE+'/'+lang+'/sets/'+encodeURIComponent(setId));
    let sourceLang=lang;
    if(!set||!Array.isArray(set.cards)||!set.cards.length){
      const fallback=await jsonOrNull(BASE+'/en/sets/'+encodeURIComponent(setId));
      if(fallback){set=fallback;sourceLang='en'}
    }
    if(!set)throw new Error('Coleção não encontrada no TCGdex.');
    const list=Array.isArray(set.cards)?set.cards:[];
    const details=await pool(list,18,async item=>{
      const preferred=await jsonOrNull(BASE+'/'+lang+'/cards/'+encodeURIComponent(item.id));
      if(preferred)return preferred;
      if(lang!=='en'){
        const english=await jsonOrNull(BASE+'/en/cards/'+encodeURIComponent(item.id));
        if(english)return english;
      }
      return item;
    });
    const entries=[];
    for(let i=0;i<details.length;i++){
      const card=details[i];
      if(!card||card.__error)continue;
      const variants=variantsOf(card);
      for(const variant of variants){
        entries.push({
          apiId:card.id,
          name:card.name||list[i]?.name||'',
          number:String(card.localId||list[i]?.localId||''),
          printedTotal:String(card?.set?.cardCount?.official||set?.cardCount?.official||''),
          setId:set.id||setId,
          setName:set.name||card?.set?.name||'',
          seriesName:set?.serie?.name||'',
          releaseDate:set.releaseDate||'',
          rarity:card.rarity||'',
          type:Array.isArray(card.types)?card.types.join(', '):(card.category||''),
          category:card.category||'',
          hp:card.hp??null,
          imageUrl:card.image||list[i]?.image||'',
          variantKey:variant.key,
          variantLabel:variant.label,
          finish:variant.finish,
          variantOrder:variant.order,
          source:'TCGdex',
          languageCode:lang==='pt'?'pt-br':lang,
          language:lang==='pt'?'Português':lang==='ja'?'Japonês':'Inglês'
        });
      }
    }
    entries.sort((a,b)=>{
      const an=Number(String(a.number).replace(/\D/g,''))||99999;
      const bn=Number(String(b.number).replace(/\D/g,''))||99999;
      return an-bn||a.variantOrder-b.variantOrder||a.name.localeCompare(b.name);
    });
    const setName=set.name||setId;
    const usedFallbackLanguage=sourceLang!==lang||details.some((card,i)=>card&&card.id===list[i]?.id&&lang!=='en'&&!card?.set?.name);
    const isPromoSet=/promo|black star/i.test(setName+' '+String(set.id||setId));
    const value={ok:true,set:{id:set.id||setId,name:setName,series:set?.serie?.name||'',releaseDate:set.releaseDate||'',cardCount:set.cardCount||{},languageCode:lang==='pt'?'pt-br':lang,isPromoSet},entries,sourceLanguage:sourceLang,fallbackLanguageUsed:usedFallbackLanguage};
    CACHE.set(cacheKey,{at:Date.now(),value});
    return res.status(200).json(value);
  }catch(error){
    return res.status(500).json({ok:false,error:'master_set_failed',message:error?.message||String(error)});
  }
};
module.exports.config={maxDuration:60};

'use strict';

const CACHE=new Map();
const BASE='https://api.tcgdex.net/v2';

function apiLang(v){
  const x=String(v||'pt').toLowerCase();
  if(x==='pt-br')return'pt';
  return ['pt','en','ja'].includes(x)?x:'pt';
}
function slug(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
function foilLabel(v){
  return ({
    pokeball:'Poké Ball',greatball:'Great Ball',ultraball:'Ultra Ball',masterball:'Master Ball',
    gold:'Gold',cosmos:'Cosmos',galaxy:'Galaxy',starlight:'Starlight',energy:'Energy',
    'cracked-ice':'Cracked Ice',mirror:'Mirror',league:'League','player-reward':'Player Reward',
    'professor-program':'Professor Program',tinsel:'Tinsel',loveball:'Love Ball',
    friendball:'Friend Ball',quickball:'Quick Ball','team-rocket':'Team Rocket',
    duskball:'Dusk Ball',rainbow:'Rainbow',glitter:'Glitter'
  })[String(v||'').toLowerCase()]||String(v||'');
}
function typeLabel(v){
  return ({normal:'Normal',holo:'Holo',reverse:'Reverse',metal:'Metal',lenticular:'Lenticular'})[String(v||'').toLowerCase()]||String(v||'Especial');
}
function finishForVariant(v){
  const type=String(v?.type||'').toLowerCase();
  const foil=String(v?.foil||'').toLowerCase();
  if(foil==='masterball')return'Masterball Foil';
  if(foil==='pokeball')return'Pokeball Foil';
  if(type==='reverse')return'Reverse Foil';
  if(type==='holo')return'Foil';
  if(type==='normal')return'Normal';
  return'Especial';
}
function variantOrder(finish){
  return ({Normal:0,Foil:1,'Reverse Foil':2,'Pokeball Foil':3,'Masterball Foil':4,Promo:5,Especial:6})[finish]??9;
}
function languageMatches(v,lang){
  const langs=Array.isArray(v?.languages)?v.languages.map(x=>String(x).toLowerCase()):[];
  if(!langs.length)return true;
  if(lang==='pt')return langs.includes('pt')||langs.includes('pt-br')||langs.includes('pt-pt');
  return langs.includes(lang);
}
function physicalVariantKey(v){
  const stamps=[...(Array.isArray(v?.stamp)?v.stamp:[])].map(slug).sort();
  return [
    slug(v?.type||'normal'),
    slug(v?.foil||''),
    slug(v?.subtype||''),
    slug(v?.size||'standard'),
    stamps.join('+')
  ].join('|');
}
function variantLabel(v){
  const parts=[typeLabel(v?.type)];
  if(v?.foil)parts.push(foilLabel(v.foil));
  if(v?.subtype)parts.push(String(v.subtype).replace(/-/g,' '));
  const stamps=Array.isArray(v?.stamp)?v.stamp:[];
  if(stamps.length)parts.push(stamps.map(x=>String(x).replace(/-/g,' ')).join(' + '));
  if(v?.size==='jumbo')parts.push('Jumbo');
  return parts.filter(Boolean).join(' · ');
}
function rawVariantsOf(card,lang){
  const detailed=Array.isArray(card?.variants_detailed)?card.variants_detailed:[];
  const out=[];
  if(detailed.length){
    for(const v of detailed){
      if(!languageMatches(v,lang))continue;
      const item={
        type:String(v?.type||'normal').toLowerCase(),
        foil:v?.foil||'',
        subtype:v?.subtype||'',
        size:v?.size||'standard',
        stamp:Array.isArray(v?.stamp)?v.stamp:[],
        label:variantLabel(v),
        finish:finishForVariant(v)
      };
      item.key=physicalVariantKey(item);
      item.order=variantOrder(item.finish);
      out.push(item);
    }
  }else{
    const v=card?.variants||{};
    if(v.normal)out.push({key:'normal|||standard|',type:'normal',foil:'',subtype:'',size:'standard',stamp:[],label:'Normal',finish:'Normal',order:0});
    if(v.holo)out.push({key:'holo|||standard|',type:'holo',foil:'',subtype:'',size:'standard',stamp:[],label:'Holo',finish:'Foil',order:1});
    if(v.reverse)out.push({key:'reverse|||standard|',type:'reverse',foil:'',subtype:'',size:'standard',stamp:[],label:'Reverse',finish:'Reverse Foil',order:2});
    if(v.firstEdition)out.push({key:'normal|||standard|1st-edition',type:'normal',foil:'',subtype:'',size:'standard',stamp:['1st-edition'],label:'Normal · 1st edition',finish:'Normal',order:0});
    if(v.wPromo)out.push({key:'normal|||standard|w-promo',type:'normal',foil:'',subtype:'',size:'standard',stamp:['w-promo'],label:'Normal · W Promo',finish:'Promo',order:5});
  }
  if(!out.length)out.push({key:'normal|||standard|',type:'normal',foil:'',subtype:'',size:'standard',stamp:[],label:'Normal',finish:'Normal',order:0});
  const seen=new Set();
  return out.filter(v=>{if(seen.has(v.key))return false;seen.add(v.key);return true});
}
function inferUniformSetVariants(cardCount,expectedCount){
  if(!expectedCount)return{};
  const out={};
  if(Number(cardCount?.normal||0)>=expectedCount)out.normal=true;
  if(Number(cardCount?.holo||0)>=expectedCount)out.holo=true;
  if(Number(cardCount?.reverse||0)>=expectedCount)out.reverse=true;
  return out;
}
function synthesizeMissingSetBriefs(list,setId,expectedCount){
  const out=[...list];
  if(!expectedCount||out.length>=expectedCount)return out;
  const localIds=out.map(x=>{
    const explicit=String(x?.localId||'').trim();
    if(explicit)return explicit;
    const id=String(x?.id||'');
    const prefix=String(setId||'')+'-';
    return id.startsWith(prefix)?id.slice(prefix.length):'';
  }).filter(Boolean);
  if(!localIds.length)return out;

  const prefixed=localIds.map(id=>id.match(/^([^0-9]+)(\d+)$/)).filter(Boolean);
  const numeric=localIds.map(id=>id.match(/^(\d+)$/)).filter(Boolean);
  let makeLocal=null;

  if(prefixed.length>=Math.max(1,Math.ceil(localIds.length*0.6))){
    const prefix=prefixed[0][1];
    const same=prefixed.filter(m=>m[1]===prefix);
    if(same.length>=Math.max(1,Math.ceil(localIds.length*0.6))){
      const width=Math.max(...same.map(m=>m[2].length));
      makeLocal=n=>prefix+String(n).padStart(width,'0');
    }
  }else if(numeric.length>=Math.max(1,Math.ceil(localIds.length*0.6))){
    const width=Math.max(...numeric.map(m=>m[1].length));
    makeLocal=n=>String(n).padStart(width,'0');
  }

  if(!makeLocal&&String(setId||'').toLowerCase()==='cel25cc'&&expectedCount===25){
    makeLocal=n=>'CC'+String(n).padStart(3,'0');
  }
  if(!makeLocal)return out;
  const seen=new Set(out.map(x=>{
    const explicit=String(x?.localId||'').trim();
    if(explicit)return explicit;
    const id=String(x?.id||''),prefix=String(setId||'')+'-';
    return id.startsWith(prefix)?id.slice(prefix.length):'';
  }).filter(Boolean));
  for(let n=1;n<=expectedCount;n++){
    const localId=makeLocal(n);
    if(seen.has(localId))continue;
    out.push({id:setId+'-'+localId,localId,name:localId});
    seen.add(localId);
  }
  return out;
}

function buildSetVariantProfile(rawByCard){
  const counts=new Map();
  for(const variants of rawByCard){
    for(const v of variants)counts.set(v.key,(counts.get(v.key)||0)+1);
  }
  return counts;
}
function uniformOnlySetType(cardCount,expectedCount){
  if(!expectedCount)return'';
  const values={
    normal:Number(cardCount?.normal||0),
    holo:Number(cardCount?.holo||0),
    reverse:Number(cardCount?.reverse||0)
  };
  const full=Object.entries(values).filter(([,n])=>n>=expectedCount).map(([k])=>k);
  const nonZero=Object.entries(values).filter(([,n])=>n>0).map(([k])=>k);
  return full.length===1&&nonZero.length===1?full[0]:'';
}
function isCoreSetVariant(v,cardVariants,profile,totalCards,isPromoSet,uniformOnlyType=''){
  if(v.size==='jumbo')return false;
  if(isPromoSet)return true;
  if(uniformOnlyType&&v.type===uniformOnlyType)return true;

  const stamps=v.stamp||[];
  if(stamps.length){
    const onlyFirst=stamps.every(x=>String(x).toLowerCase()==='1st-edition');
    const prevalence=(profile.get(v.key)||0)/Math.max(1,totalCards);
    if(!onlyFirst&&prevalence<0.20)return false;
  }

  const foil=String(v.foil||'').toLowerCase();
  if(['pokeball','greatball','ultraball','masterball','loveball','friendball','quickball','duskball'].includes(foil))return true;
  if(v.subtype)return true;
  if(!foil)return true;
  if(v.type==='holo')return true;

  const plainSameType=cardVariants.some(x=>x!==v&&x.type===v.type&&!x.foil&&!x.subtype&&!(x.stamp||[]).length);
  if(!plainSameType)return true;

  const count=profile.get(v.key)||0;
  const threshold=Math.max(3,Math.ceil(totalCards*0.08));
  return count>=threshold;
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

    let list=Array.isArray(set.cards)?[...set.cards]:[];
    const expectedCount=Math.max(
      Number(set?.cardCount?.official||0),
      Number(set?.cardCount?.total||0)
    );
    // Some localized set indexes are incomplete even when the set itself exists
    // (Celebrations Classic Collection PT is a real example). Complete only
    // the missing card IDs from EN; each card still prefers the requested
    // language when its detail is fetched below.
    if(lang!=='en'&&expectedCount&&list.length<expectedCount){
      const enSet=await jsonOrNull(BASE+'/en/sets/'+encodeURIComponent(setId));
      const enCards=Array.isArray(enSet?.cards)?enSet.cards:[];
      const seenIds=new Set(list.map(x=>String(x?.id||'')));
      for(const item of enCards){
        if(!seenIds.has(String(item?.id||''))){
          list.push(item);
          seenIds.add(String(item?.id||''));
        }
      }
    }
    list=synthesizeMissingSetBriefs(list,set.id||setId,expectedCount);
    // TCGdex's public index for Celebrations Classic Collection is known to
    // omit two briefs even though all 25 card endpoints exist. Use the set's
    // canonical CC001..CC025 local IDs so no card disappears from the Master Set.
    if(String(set.id||setId).toLowerCase()==='cel25cc'&&expectedCount===25){
      list=Array.from({length:25},(_,i)=>{
        const localId='CC'+String(i+1).padStart(3,'0');
        return {id:(set.id||setId)+'-'+localId,localId,name:localId};
      });
    }

    const details=await pool(list,18,async item=>{
      const preferred=await jsonOrNull(BASE+'/'+lang+'/cards/'+encodeURIComponent(item.id));
      if(preferred)return {...preferred,__variantLang:lang};
      if(lang!=='en'){
        const english=await jsonOrNull(BASE+'/en/cards/'+encodeURIComponent(item.id));
        if(english)return {...english,__variantLang:'en'};
      }
      return {
        ...item,
        variants:Object.keys(item?.variants||{}).length?item.variants:inferUniformSetVariants(set.cardCount,expectedCount),
        __variantLang:sourceLang
      };
    });
    const setName=set.name||setId;
    const isPromoSet=/promo|black star/i.test(setName+' '+String(set.id||setId));
    const rawByCard=details.map(card=>(!card||card.__error)?[]:rawVariantsOf(card,card.__variantLang||lang));
    const profile=buildSetVariantProfile(rawByCard);
    const uniformOnlyType=uniformOnlySetType(set.cardCount,expectedCount);
    const entries=[];
    for(let i=0;i<details.length;i++){
      const card=details[i];
      if(!card||card.__error)continue;
      const rawVariants=rawByCard[i];
      const variants=rawVariants.filter(v=>isCoreSetVariant(v,rawVariants,profile,details.length,isPromoSet,uniformOnlyType));
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
          variantType:variant.type,
          variantFoil:variant.foil||'',
          variantSubtype:variant.subtype||'',
          variantStamps:variant.stamp||[],
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
    const usedFallbackLanguage=sourceLang!==lang||details.some((card,i)=>card&&card.id===list[i]?.id&&lang!=='en'&&!card?.set?.name);
    const value={ok:true,set:{id:set.id||setId,name:setName,series:set?.serie?.name||'',releaseDate:set.releaseDate||'',cardCount:set.cardCount||{},languageCode:lang==='pt'?'pt-br':lang,isPromoSet},entries,sourceLanguage:sourceLang,fallbackLanguageUsed:usedFallbackLanguage};
    if(String(req.query.debug||'')==='1'){
      value.debug={
        expectedCount,
        listLength:list.length,
        detailsLength:details.length,
        rawNonEmpty:rawByCard.filter(x=>x.length).length,
        rawEmptyIndexes:rawByCard.map((x,i)=>x.length?null:{i,id:list[i]?.id,localId:list[i]?.localId,detail:details[i]}).filter(Boolean),
        entryIds:[...new Set(entries.map(x=>x.apiId))]
      };
    }
    CACHE.set(cacheKey,{at:Date.now(),value});
    return res.status(200).json(value);
  }catch(error){
    return res.status(500).json({ok:false,error:'master_set_failed',message:error?.message||String(error)});
  }
};
module.exports.config={maxDuration:60};

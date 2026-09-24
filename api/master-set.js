'use strict';

const CACHE=new Map();
const BASE='https://api.tcgdex.net/v2';
const MASTER_ALGO_VERSION='28';
const SPECIAL_MASTER_ORIGINAL_NUMBERS={
  cel25cc:{
    CC001:'2/102',CC002:'4/102',CC003:'15/102',CC004:'73/102',CC005:'8/82',
    CC006:'15/82',CC007:'15/132',CC008:'24',CC009:'20/111',CC010:'66/64',
    CC011:'9/95',CC012:'86/109',CC013:'88/92',CC014:'93/101',CC015:'17/17',
    CC016:'15/106',CC017:'109/111',CC018:'145/147',CC019:'107/123',CC020:'113/114',
    CC021:'114/114',CC022:'54/99',CC023:'97/146',CC024:'76/108',CC025:'60/145'
  },
  '30th-c':{
    '001':'4/102','002':'5/109','003':'11/113','004':'11/101','005':'18/132',
    '006':'19/109','007':'25/111','008':'33/181','009':'41/122','010':'43/146',
    '011':'47/127','012':'50/185','013':'57/111','014':'58/102','015':'69/132',
    '016':'85/124','017':'89/149','018':'94/102','019':'99/102','020':'100/102',
    '021':'101/101','022':'106/106','023':'106/160','024':'106/105','025':'108/115',
    '026':'114/264','027':'123/172','028':'138/202','029':'149/147','030':'203/193'
  }
};
function specialMasterNumber(setId,localId){
  const set=String(setId||''),local=String(localId||'').trim();
  const digits=local.match(/(\d+)/)?.[1]||'';
  if(set==='cel25cc'&&digits)return String(Number(digits))+'/25';
  if(set==='30th-c'&&digits)return String(Number(digits))+'/30';
  return local;
}
function specialMasterOriginalNumber(setId,localId){
  const local=String(localId||'').trim();
  return SPECIAL_MASTER_ORIGINAL_NUMBERS[String(setId||'')]?.[local]||'';
}
function printedDenominator(number,fallback=''){
  const m=String(number||'').match(/\/\s*([A-Za-z0-9]+)/);
  return m?m[1]:String(fallback||'');
}

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
  if(slug(v.size)==='jumbo')return false;
  if(isPromoSet)return true;

  const type=String(v.type||'').toLowerCase();
  const foil=String(v.foil||'').toLowerCase();
  const stamps=v.stamp||[];
  const count=profile.get(v.key)||0;
  const prevalence=count/Math.max(1,totalCards);

  if(uniformOnlyType&&type===uniformOnlyType&&!foil&&!v.subtype&&!stamps.length)return true;

  // These are real set-wide chase finishes in sets that use them (for example
  // Poké Ball / Master Ball). Keep them even though they are not plain variants.
  if(['pokeball','greatball','ultraball','masterball','loveball','friendball','quickball','duskball'].includes(foil))return true;

  // Main pack variants. No special foil/stamp/subtype means they belong to the set.
  if(['normal','holo','reverse'].includes(type)&&!foil&&!v.subtype&&!stamps.length)return true;

  // 1st-edition is a legitimate printing distinction in older sets.
  if(stamps.length&&stamps.every(x=>String(x).toLowerCase()==='1st-edition')&&!foil&&!v.subtype)return true;

  // One-off treatments such as Cosmos, Gold, Metal, League stamps, etc. are
  // typically box/promotional variants that share the set number. They should
  // not inflate a normal Master Set. Only keep a special treatment when it is
  // genuinely systemic across a meaningful portion of the collection.
  const systemicThreshold=Math.max(6,Math.ceil(totalCards*0.20));
  if(count>=systemicThreshold||prevalence>=0.20)return true;

  return false;
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
  const includeAllPhysical=['1','true','yes','all'].includes(String(req.query.all||'').toLowerCase());
  const includeJumbo=['1','true','yes'].includes(String(req.query.jumbo||'').toLowerCase());
  const strictLang=['1','true','yes'].includes(String(req.query.strictLang||'').toLowerCase());
  const onlyRaw=String(req.query.only||'').split(',').map(x=>x.trim()).filter(Boolean);
  const onlyKey=v=>{
    const raw=String(v||'').trim().toUpperCase();
    return /^\d+$/.test(raw)?String(Number(raw)):raw;
  };
  const onlySet=new Set(onlyRaw.map(onlyKey));
  const cacheKey=MASTER_ALGO_VERSION+'|'+lang+'|'+setId+'|all='+(includeAllPhysical?'1':'0')+'|jumbo='+(includeJumbo?'1':'0')+'|strict='+(strictLang?'1':'0')+'|only='+[...onlySet].sort().join(',');
  const cached=CACHE.get(cacheKey);
  if(cached&&Date.now()-cached.at<3600000)return res.status(200).json(cached.value);
  try{
    const localizedSet=await jsonOrNull(BASE+'/'+lang+'/sets/'+encodeURIComponent(setId));
    const localizedSetExists=!!localizedSet;
    const localizedCards=Array.isArray(localizedSet?.cards)?localizedSet.cards:[];
    let set=localizedSet;
    let sourceLang=lang;
    if(!set||!localizedCards.length){
      const fallback=await jsonOrNull(BASE+'/en/sets/'+encodeURIComponent(setId));
      if(fallback){set=fallback;sourceLang='en'}
    }
    if(!set)throw new Error('Coleção não encontrada no TCGdex.');

    const setName=set.name||setId;
    const isPromoSet=/promo|black star/i.test(setName+' '+String(set.id||setId));
    const localizedIds=new Set(localizedCards.map(x=>String(x?.id||'')));

    // Em sets normais, a existência do set localizado indica que a impressão
    // física existe naquele idioma, mesmo que detalhes/imagens usem EN como
    // metadado auxiliar. Em sets de PROMO, a validação precisa ser por carta:
    // um XY Promo ausente do índice PT não pode virar PT só porque o set xyp existe.
    const physicalSetLang=localizedSetExists?lang:sourceLang;
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

    if(onlySet.size){
      list=list.filter(item=>{
        const explicit=String(item?.localId||'').trim();
        const id=String(item?.id||'');
        const prefix=String(set.id||setId)+'-';
        const suffix=id.startsWith(prefix)?id.slice(prefix.length):id.split('-').pop();
        return [explicit,suffix,id].some(v=>onlySet.has(onlyKey(v)));
      });
    }

    const details=await pool(list,18,async item=>{
      const itemId=String(item?.id||'');
      const localizedPhysical=localizedIds.has(itemId);
      const physicalLangForItem=lang==='en'
        ?'en'
        :(localizedPhysical?lang:(localizedSetExists&&!isPromoSet?lang:sourceLang));
      const preferred=await jsonOrNull(BASE+'/'+lang+'/cards/'+encodeURIComponent(item.id));
      if(preferred){
        let english=null;
        const preferredHasDetailed=Array.isArray(preferred?.variants_detailed)&&preferred.variants_detailed.length;
        const preferredHasVariants=preferred?.variants&&Object.keys(preferred.variants).length;
        if(lang!=='en'&&(!preferred.image||(!preferredHasDetailed&&!preferredHasVariants))){
          english=await jsonOrNull(BASE+'/en/cards/'+encodeURIComponent(item.id));
        }
        return {
          ...(english||{}),
          ...preferred,
          image:preferred.image||english?.image||item?.image||'',
          variants_detailed:preferredHasDetailed?preferred.variants_detailed:(english?.variants_detailed||preferred.variants_detailed),
          variants:preferredHasVariants?preferred.variants:(english?.variants||preferred.variants),
          __physicalLang:physicalLangForItem,
          __variantSourceLang:(preferredHasDetailed||preferredHasVariants)?lang:(english?'en':lang)
        };
      }
      if(lang!=='en'){
        const english=await jsonOrNull(BASE+'/en/cards/'+encodeURIComponent(item.id));
        if(english){
          return {
            ...english,
            image:english.image||item?.image||'',
            __physicalLang:physicalLangForItem,
            __variantSourceLang:'en'
          };
        }
      }
      return {
        ...item,
        variants:Object.keys(item?.variants||{}).length?item.variants:inferUniformSetVariants(set.cardCount,expectedCount),
        __physicalLang:physicalLangForItem,
        __variantSourceLang:sourceLang
      };
    });
    const rawByCard=details.map(card=>(!card||card.__error)?[]:rawVariantsOf(card,card.__variantSourceLang||card.__physicalLang||lang));
    const profile=buildSetVariantProfile(rawByCard);
    const uniformOnlyType=uniformOnlySetType(set.cardCount,expectedCount);
    const entries=[];
    for(let i=0;i<details.length;i++){
      const card=details[i];
      if(!card||card.__error)continue;
      const resolvedLang=String(card.__physicalLang||physicalSetLang||sourceLang||lang).toLowerCase();
      if(strictLang&&resolvedLang!==lang)continue;
      const rawVariants=rawByCard[i];
      const anniversaryClassic=['cel25cc','30th-c'].includes(String(set.id||setId));
      let variants;
      if(includeAllPhysical){
        variants=rawVariants.filter(v=>includeJumbo||slug(v.size)!=='jumbo');
      }else if(anniversaryClassic){
        const standard=rawVariants.filter(v=>slug(v.size)!=='jumbo').sort((a,b)=>a.order-b.order);
        const chosen=standard.find(v=>v.type==='holo')||standard.find(v=>v.type==='normal')||standard[0];
        variants=chosen?[chosen]:[];
      }else{
        variants=rawVariants.filter(v=>isCoreSetVariant(v,rawVariants,profile,details.length,isPromoSet,uniformOnlyType));
      }
      for(const variant of variants){
        entries.push({
          apiId:card.id,
          name:card.name||list[i]?.name||'',
          number:specialMasterNumber(set.id||setId,card.localId||list[i]?.localId||''),
          originalNumber:specialMasterOriginalNumber(set.id||setId,card.localId||list[i]?.localId||''),
          numberAliases:[
            String(card.localId||list[i]?.localId||''),
            specialMasterNumber(set.id||setId,card.localId||list[i]?.localId||''),
            specialMasterOriginalNumber(set.id||setId,card.localId||list[i]?.localId||'')
          ].filter(Boolean),
          printedTotal:printedDenominator(
            specialMasterNumber(set.id||setId,card.localId||list[i]?.localId||''),
            card?.set?.cardCount?.official||set?.cardCount?.official||''
          ),
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
          variantSize:variant.size||'standard',
          source:'TCGdex',
          languageCode:resolvedLang==='pt'?'pt-br':resolvedLang,
          language:resolvedLang==='pt'?'Português':resolvedLang==='ja'?'Japonês':'Inglês'
        });
      }
    }
    const dedupedEntries=[];
    const finalSeen=new Set();
    for(const entry of entries){
      const key=[entry.apiId,entry.variantKey,entry.languageCode].join('|');
      if(finalSeen.has(key))continue;
      finalSeen.add(key);
      dedupedEntries.push(entry);
    }
    entries.length=0;
    entries.push(...dedupedEntries);

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
        includeAllPhysical,
        includeJumbo,
        strictLang,
        localizedSetExists,
        localizedCardCount:localizedCards.length,
        localizedIdsCount:localizedIds.size,
        isPromoSet,
        physicalSetLang,
        only:[...onlySet],
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

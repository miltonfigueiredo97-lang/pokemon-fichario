'use strict';

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function collector(v){
  const raw=String(v||'').trim().replace(/[^A-Za-z0-9]/g,'');
  const m=raw.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  if(!m)return raw.toLowerCase();
  return (m[1]||'').toLowerCase()+String(Number(m[2]))+(m[3]||'').toLowerCase();
}
function parts(v){
  const s=String(v||''),m=s.match(/([A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4})\s*\/\s*([A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4})/i);
  if(m)return{n:collector(m[1]),d:collector(m[2])};
  const x=s.match(/[A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4}/i);
  return x?{n:collector(x[0]),d:''}:{n:'',d:''};
}
function tokenShape(v){
  const raw=collector(v),m=raw.match(/^([a-z]*)(\d+)([a-z]*)$/i);
  return m?{raw,prefix:m[1]||'',digits:String(Number(m[2])),suffix:m[3]||''}:{raw,prefix:'',digits:'',suffix:''};
}
function tokenMatches(wanted,found){
  const w=tokenShape(wanted),f=tokenShape(found);
  if(!w.raw)return true;
  if(w.raw===f.raw)return true;
  return !w.prefix&&!w.suffix&&!!w.digits&&w.digits===f.digits;
}
function numberMatches(wantedValue,foundValue){
  const w=parts(wantedValue),f=parts(foundValue);
  if(w.n&&!tokenMatches(w.n,f.n))return false;
  if(w.d&&f.d&&!tokenMatches(w.d,f.d))return false;
  return true;
}
function anniversarySetMatch(setHint,setId,setName){
  const h=norm(setHint),id=String(setId||'').toLowerCase(),name=norm(setName);
  const classic=/classic|classica|classico|colecao classica/.test(h);
  const y25=(/\b25\b/.test(h)&&(h.includes('ano')||h.includes('anivers')||h.includes('celebr')))||h.includes('celebrations')||h.includes('celebracoes');
  const y30=(/\b30\b/.test(h)&&(h.includes('ano')||h.includes('anivers')||h.includes('celebr')))||h.includes('30th celebration');
  if(y25){
    if(classic)return id==='cel25c'||id==='cel25cc'||(name.includes('celebr')&&name.includes('classic'));
    return id==='cel25'||id==='cel25c'||id==='cel25cc'||name.includes('celebr');
  }
  if(y30){
    if(classic)return id==='30th-c'||(name.includes('30')&&name.includes('classic'));
    return id==='30th'||id==='30th-c'||(name.includes('30')&&name.includes('celebr'));
  }
  return false;
}
function similarName(cardName,wanted){
  const a=norm(cardName),b=norm(wanted);
  if(!a||!b)return false;
  if(a===b||a.includes(b)||b.includes(a))return true;
  const suffix=/\b(ex|gx|v|vmax|vstar)\b/g;
  return a.replace(suffix,'').trim()===b.replace(suffix,'').trim();
}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400');
  const name=String(req.query?.name||'').trim();
  const number=String(req.query?.number||'').trim();
  const set=String(req.query?.set||'').trim();
  const limit=Math.max(1,Math.min(100,Number(req.query?.limit)||60));
  if(!name)return res.status(200).json({ok:true,cards:[]});

  try{
    const base=name.replace(/\b(ex|gx|vmax|vstar|v)\b/ig,'').trim()||name;
    const q='name:'+JSON.stringify(base);
    const r=await fetch('https://api.pokemontcg.io/v2/cards?q='+encodeURIComponent(q)+'&pageSize=100',{
      headers:{accept:'application/json','user-agent':'PokemonBinderBR/14.47'}
    });
    if(!r.ok)return res.status(200).json({ok:true,cards:[],upstream:r.status});
    const data=await r.json();
    const wanted=parts(number),setNorm=norm(set);
    const cards=[];
    for(const d of data?.data||[]){
      if(!similarName(d?.name,name))continue;
      if(number&&!numberMatches(number,d?.number||''))continue;
      if(setNorm){
        const setHay=norm([d?.set?.id,d?.set?.name].filter(Boolean).join(' '));
        const direct=setHay===setNorm||setHay.includes(setNorm)||setNorm.includes(setHay);
        if(!direct&&!anniversarySetMatch(set,d?.set?.id,d?.set?.name))continue;
      }
      const image=d?.images?.large||d?.images?.small||'';
      const local=String(d?.number||'');
      const isPromo=/promo|black star/i.test(String(d?.set?.name||''))||/\d+[A-Za-z]$/i.test(local);
      cards.push({
        source:'PokemonTCG.io',
        apiId:d?.id||'',
        name:d?.name||name,
        languageCode:'en',
        language:'Inglês',
        setName:d?.set?.name||'',
        setId:d?.set?.id||'',
        number:local,
        printedTotal:String(d?.set?.printedTotal||''),
        rarity:d?.rarity||'',
        type:Array.isArray(d?.types)?d.types.join(', '):(d?.supertype||''),
        category:d?.supertype||'',
        hp:d?.hp||null,
        imageUrl:image,
        isPromo,
        variants:d?.tcgplayer?.prices||null
      });
      if(cards.length>=limit)break;
    }
    return res.status(200).json({ok:true,cards});
  }catch(error){
    console.error('[legacy-card-search]',error);
    return res.status(200).json({ok:true,cards:[],error:'legacy_search_failed'});
  }
};
module.exports.config={maxDuration:30};

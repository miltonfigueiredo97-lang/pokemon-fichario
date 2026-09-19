'use strict';

const CACHE=new Map();
const BASE='https://api.tcgdex.net/v2';

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function score(c,w){
  let s=0;
  const cn=norm(c?.name),wn=norm(w.name);
  if(cn&&wn){
    if(cn===wn)s+=80;
    else if(cn.includes(wn)||wn.includes(cn))s+=45;
  }
  if(w.hp){
    if(Number(c?.hp)===Number(w.hp))s+=45;
    else s-=70;
  }
  if(w.number&&String(c?.localId||'').replace(/^0+/,'')===String(w.number).replace(/\D/g,'').replace(/^0+/,''))s+=12;
  if(w.rarity&&norm(c?.rarity)===norm(w.rarity))s+=10;
  if(c?.image)s+=20;
  return s;
}
async function j(url){
  const r=await fetch(url,{headers:{accept:'application/json'}});
  if(!r.ok)return null;
  return r.json();
}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=86400, stale-while-revalidate=604800');
  const name=String(req.query.name||'').trim(),number=String(req.query.number||'').trim(),hp=String(req.query.hp||'').trim(),rarity=String(req.query.rarity||'').trim();
  if(!name)return res.status(200).json({ok:false,error:'name_required'});
  const key=[name,number,hp,rarity].join('|');
  if(CACHE.has(key))return res.status(200).json(CACHE.get(key));
  try{
    const p=new URLSearchParams({name,'pagination:itemsPerPage':'50'});
    const list=await j(BASE+'/en/cards?'+p);
    const candidates=[];
    if(Array.isArray(list)){
      const details=await Promise.all(list.slice(0,30).map(x=>j(BASE+'/en/cards/'+encodeURIComponent(x.id))));
      for(const d of details.filter(Boolean))if(d.image)candidates.push({url:d.image+'/high.webp',score:score(d,{name,number,hp,rarity}),source:'TCGdex EN',id:d.id});
    }
    if(!candidates.length||Math.max(...candidates.map(x=>x.score))<90){
      try{
        const q='name:'+JSON.stringify(name);
        const r=await fetch('https://api.pokemontcg.io/v2/cards?q='+encodeURIComponent(q)+'&pageSize=50');
        if(r.ok){
          const data=await r.json();
          for(const d of data?.data||[]){
            const url=d?.images?.large||d?.images?.small;
            if(url)candidates.push({url,score:score({name:d.name,hp:d.hp,localId:d.number,rarity:d.rarity,image:url},{name,number,hp,rarity}),source:'PokemonTCG.io',id:d.id});
          }
        }
      }catch{}
    }
    candidates.sort((a,b)=>b.score-a.score);
    const best=candidates[0];
    const minScore=hp?105:80;\n    const out=best&&best.score>=minScore?{ok:true,...best}:{ok:false,error:'no_safe_fallback'};
    CACHE.set(key,out);
    return res.status(200).json(out);
  }catch(error){
    return res.status(200).json({ok:false,error:'fallback_failed',message:error?.message||String(error)});
  }
};
module.exports.config={maxDuration:30};

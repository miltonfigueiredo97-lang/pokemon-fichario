'use strict';

const BASE='https://www.pokemon-card.com';
const API=BASE+'/card-search/resultAPI.php';

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function localNumber(v){const m=String(v||'').match(/\d+/);return m?String(Number(m[0])):''}
function scoreCandidate(c,w){
  let s=0;
  const cn=norm(c?.name),wn=norm(w.name);
  if(cn&&wn){
    if(cn===wn)s+=90;
    else if(cn.includes(wn)||wn.includes(cn))s+=55;
  }
  const cnum=localNumber(c?.localId||c?.number),wnum=localNumber(w.number);
  if(wnum&&cnum){
    if(cnum===wnum)s+=18;
    else s-=8;
  }
  if(w.hp){
    if(Number(c?.hp)===Number(w.hp))s+=45;
    else if(c?.hp)s-=50;
  }
  if(w.rarity&&c?.rarity&&norm(c.rarity)===norm(w.rarity))s+=10;
  if(c?.image)s+=15;
  return s;
}
async function fetchJson(url,options={}){
  const r=await fetch(url,options);
  if(!r.ok)return null;
  try{return await r.json()}catch{return null}
}
async function officialImage(set,wanted){
  const headers={
    'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
    'Accept':'application/json, text/javascript, */*; q=0.01',
    'Accept-Language':'ja,en-US;q=0.9,en;q=0.8',
    'Referer':BASE+'/card-search/',
    'X-Requested-With':'XMLHttpRequest'
  };
  const candidates=[set,String(set||'').replace(/-ja$/i,''),String(set||'').toUpperCase()].filter(Boolean);
  for(const pg of [...new Set(candidates)]){
    let position=0;
    for(let page=1;page<=30;page++){
      const u=new URL(API);
      u.searchParams.set('pg',pg);
      u.searchParams.set('page',String(page));
      u.searchParams.set('regulation_sidebar_form','all');
      u.searchParams.set('keyword','');
      u.searchParams.set('se_ta','');
      u.searchParams.set('illust','');
      u.searchParams.set('sm_and_keyword','true');
      const j=await fetchJson(u,{headers,redirect:'follow'});
      if(!j)break;
      const list=Array.isArray(j.cardList)?j.cardList:[];
      for(const card of list){
        position++;
        if(position===wanted){
          const thumb=String(card.cardThumbFile||'');
          if(thumb)return thumb.startsWith('http')?thumb:BASE+thumb;
        }
      }
      if(page>=Number(j.maxPage||1)||!list.length)break;
    }
  }
  return'';
}
async function equivalentImage(w){
  if(!w.name)return'';
  const p=new URLSearchParams({name:w.name,'pagination:itemsPerPage':'50'});
  const list=await fetchJson('https://api.tcgdex.net/v2/en/cards?'+p);
  const candidates=[];
  if(Array.isArray(list)){
    const details=await Promise.all(list.slice(0,30).map(x=>fetchJson('https://api.tcgdex.net/v2/en/cards/'+encodeURIComponent(x.id))));
    for(const d of details.filter(Boolean)){
      if(d.image)candidates.push({url:d.image+'/high.webp',score:scoreCandidate(d,w),source:'TCGdex EN'});
    }
  }
  if(!candidates.length||Math.max(...candidates.map(x=>x.score))<95){
    try{
      const q='name:'+JSON.stringify(w.name);
      const r=await fetch('https://api.pokemontcg.io/v2/cards?q='+encodeURIComponent(q)+'&pageSize=50');
      if(r.ok){
        const j=await r.json();
        for(const d of j?.data||[]){
          const url=d?.images?.large||d?.images?.small;
          if(url)candidates.push({url,score:scoreCandidate({name:d.name,hp:d.hp,number:d.number,rarity:d.rarity,image:url},w),source:'PokemonTCG.io'});
        }
      }
    }catch{}
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  const threshold=w.hp?110:88;
  return best&&best.score>=threshold?best.url:'';
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','public, s-maxage=604800, stale-while-revalidate=2592000');
  const set=String(req.query.set||'').trim();
  const local=localNumber(req.query.localId||req.query.number);
  const name=String(req.query.name||'').trim();
  const hp=String(req.query.hp||'').trim();
  const rarity=String(req.query.rarity||'').trim();
  if(!set&&!name)return res.status(400).json({ok:false,error:'set_or_name_required'});

  try{
    let image='';
    if(set&&local)image=await officialImage(set,Number(local));
    let fallback=false;
    if(!image&&name){
      image=await equivalentImage({name,number:local,hp,rarity});
      fallback=!!image;
    }
    if(!image)return res.status(404).json({ok:false,error:'image_not_found'});
    res.statusCode=302;
    res.setHeader('Location',image);
    if(fallback)res.setHeader('X-Pokemon-Image-Fallback','equivalent');
    return res.end();
  }catch(error){
    return res.status(502).json({ok:false,error:'jp_source_failed',message:error?.message||String(error)});
  }
};
module.exports.config={maxDuration:30};

'use strict';

const MAX_BYTES=7*1024*1024;
const TCGDEX='https://api.tcgdex.net/v2';
// Celebrations Classic Collection reprints: TCGdex has no scan for them and
// its TCGplayer link points at the yellow Celebrations card of the same
// Pokémon (CC021 Zekrom -> 010/025). The reprint looks like the original
// print, so its scan is used.
// Number printed on each reprint. The official card database (pokemon.com)
// names its scans by it, per language: CEL25C_PT-BR_114_A; a number printed on
// more than one reprint is A1, A2... in collection order.
const CLASSIC_PRINTED={
  'cel25cc-CC001':'2/102','cel25cc-CC002':'4/102','cel25cc-CC003':'15/102','cel25cc-CC004':'73/102','cel25cc-CC005':'8/82',
  'cel25cc-CC006':'15/82','cel25cc-CC007':'15/132','cel25cc-CC008':'24','cel25cc-CC009':'20/111','cel25cc-CC010':'66/64',
  'cel25cc-CC011':'9/95','cel25cc-CC012':'86/109','cel25cc-CC013':'88/92','cel25cc-CC014':'93/101','cel25cc-CC015':'17/17',
  'cel25cc-CC016':'15/106','cel25cc-CC017':'109/111','cel25cc-CC018':'145/147','cel25cc-CC019':'107/123','cel25cc-CC020':'113/114',
  'cel25cc-CC021':'114/114','cel25cc-CC022':'54/99','cel25cc-CC023':'97/146','cel25cc-CC024':'76/108','cel25cc-CC025':'60/145'
};
function classicOfficialUrl(id,lang){
  const printed=CLASSIC_PRINTED[id];
  if(!printed)return'';
  const num=printed.split('/')[0];
  const same=Object.keys(CLASSIC_PRINTED).sort().filter(k=>CLASSIC_PRINTED[k].split('/')[0]===num);
  const suffix=same.length>1?'A'+(same.indexOf(id)+1):'A';
  const pt=/^pt/i.test(String(lang||''));
  return'https://assets.pokemon.com/assets/'+(pt?'cms2-pt-br':'cms2')+'/img/cards/web/CEL25C/CEL25C_'+(pt?'PT-BR':'EN')+'_'+num+'_'+suffix+'.png';
}
const CLASSIC_ORIGINALS={
  'cel25cc-CC001':'base1-2','cel25cc-CC002':'base1-4','cel25cc-CC003':'base1-15','cel25cc-CC004':'base1-73','cel25cc-CC005':'base5-8',
  'cel25cc-CC006':'base5-15','cel25cc-CC007':'gym2-15','cel25cc-CC008':'basep-24','cel25cc-CC009':'neo1-20','cel25cc-CC010':'neo3-66',
  'cel25cc-CC011':'ex4-9','cel25cc-CC012':'ex7-86','cel25cc-CC013':'ex12-88','cel25cc-CC014':'ex15-93','cel25cc-CC015':'pop5-17',
  'cel25cc-CC016':'dp4-15','cel25cc-CC017':'pl2-109','cel25cc-CC018':'pl3-145','cel25cc-CC019':'hgss1-107','cel25cc-CC020':'bw1-113',
  'cel25cc-CC021':'bw1-114','cel25cc-CC022':'bw4-54','cel25cc-CC023':'xy1-97','cel25cc-CC024':'xy6-76','cel25cc-CC025':'sm2-60'
};

function pickTcgplayerId(card){
  const ids=[];
  for(const variant of Array.isArray(card?.variants_detailed)?card.variants_detailed:[]){
    const id=variant?.thirdParty?.tcgplayer||
      variant?.pricing?.tcgplayer?.holofoil?.productId||
      variant?.pricing?.tcgplayer?.normal?.productId||
      variant?.pricing?.tcgplayer?.reverseHolofoil?.productId;
    if(id)ids.push({id,size:String(variant?.size||'standard')});
  }
  const root=card?.pricing?.tcgplayer||{};
  for(const key of Object.keys(root)){
    const id=root?.[key]?.productId;
    if(id)ids.push({id,size:'standard'});
  }
  return (ids.find(x=>x.size==='standard')||ids[0])?.id||null;
}

async function fetchImage(url){
  if(!url)return null;
  const r=await fetch(url,{
    redirect:'follow',
    headers:{
      accept:'image/avif,image/webp,image/png,image/jpeg,image/*',
      'user-agent':'Mozilla/5.0 (compatible; PokemonBinderBR/14.41)'
    }
  });
  if(!r.ok)return null;
  const type=String(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!type.startsWith('image/'))return null;
  const bytes=Buffer.from(await r.arrayBuffer());
  if(!bytes.length||bytes.length>MAX_BYTES)return null;
  return{bytes,type};
}

module.exports=async function handler(req,res){
  const id=String(req.query?.id||'').trim();
  const requestedLang=String(req.query?.lang||'en').trim().toLowerCase();
  if(!id)return res.status(400).json({ok:false,error:'id_required'});

  const langs=[requestedLang==='pt-br'?'pt':requestedLang,'en'].filter((v,i,a)=>v&&a.indexOf(v)===i);

  // Classic Collection: the official scan of the reprint in the card's
  // language (25th stamp), straight from pokemon.com's image CDN.
  const official=classicOfficialUrl(id,requestedLang);
  if(official){
    const image=await fetchImage(official);
    if(image){
      res.setHeader('Content-Type',image.type);
      res.setHeader('Content-Length',String(image.bytes.length));
      res.setHeader('Cache-Control','public, max-age=86400');
      res.setHeader('X-Card-Image-Source','Pokemon official classic collection');
      return res.status(200).send(image.bytes);
    }
  }
  const original=CLASSIC_ORIGINALS[id];
  if(original){
    for(const lang of langs){
      try{
        const r=await fetch(TCGDEX+'/'+encodeURIComponent(lang)+'/cards/'+encodeURIComponent(original),{
          headers:{accept:'application/json','user-agent':'PokemonBinderBR/14.41'}
        });
        if(!r.ok)continue;
        const raw=String((await r.json())?.image||'').trim();
        if(!raw)continue;
        for(const url of [raw+'/high.webp',raw+'/high.png',raw+'/low.webp']){
          const image=await fetchImage(url);
          if(!image)continue;
          res.setHeader('Content-Type',image.type);
          res.setHeader('Content-Length',String(image.bytes.length));
          res.setHeader('Cache-Control','public, s-maxage=604800, stale-while-revalidate=2592000');
          res.setHeader('X-Card-Image-Source','TCGdex original print '+original);
          return res.status(200).send(image.bytes);
        }
      }catch(error){
        console.warn('[tcgdex-card-image] original',original,error?.message||error);
      }
    }
  }

  for(const lang of langs){
    try{
      const r=await fetch(TCGDEX+'/'+encodeURIComponent(lang)+'/cards/'+encodeURIComponent(id),{
        headers:{accept:'application/json','user-agent':'PokemonBinderBR/14.41'}
      });
      if(!r.ok)continue;
      const card=await r.json();

      const raw=String(card?.image||'').trim();
      const imageCandidates=raw
        ? (/\.(?:png|jpe?g|webp)(?:\?|$)/i.test(raw)?[raw]:[raw+'/high.webp',raw+'/low.webp',raw])
        : [];
      for(const url of imageCandidates){
        const image=await fetchImage(url);
        if(!image)continue;
        res.setHeader('Content-Type',image.type);
        res.setHeader('Content-Length',String(image.bytes.length));
        res.setHeader('Cache-Control','public, s-maxage=604800, stale-while-revalidate=2592000');
        res.setHeader('X-Card-Image-Source','TCGdex '+lang);
        return res.status(200).send(image.bytes);
      }

      const productId=original?null:pickTcgplayerId(card);
      if(productId){
        const url='https://tcgplayer-cdn.tcgplayer.com/product/'+encodeURIComponent(String(productId))+'_in_1000x1000.jpg';
        const image=await fetchImage(url);
        if(image){
          res.setHeader('Content-Type',image.type);
          res.setHeader('Content-Length',String(image.bytes.length));
          res.setHeader('Cache-Control','public, s-maxage=604800, stale-while-revalidate=2592000');
          res.setHeader('X-Card-Image-Source','TCGplayer exact print');
          res.setHeader('X-TCGplayer-Product',String(productId));
          return res.status(200).send(image.bytes);
        }
      }
    }catch(error){
      console.warn('[tcgdex-card-image]',lang,id,error?.message||error);
    }
  }
  return res.status(404).json({ok:false,error:'exact_image_not_found'});
};

module.exports.config={maxDuration:25};

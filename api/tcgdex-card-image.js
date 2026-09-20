'use strict';

const MAX_BYTES=7*1024*1024;
const TCGDEX='https://api.tcgdex.net/v2';

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

      const productId=pickTcgplayerId(card);
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

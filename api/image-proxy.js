'use strict';

const MAX_BYTES=6*1024*1024;
const ALLOWED_HOSTS=[
  'assets.tcgdex.net',
  'www.pokemon-card.com',
  'pokemon-card.com',
  'images.pokemontcg.io'
];

function hostAllowed(hostname){
  const host=String(hostname||'').toLowerCase();
  return ALLOWED_HOSTS.some(allowed=>host===allowed||host.endsWith('.'+allowed));
}

module.exports=async function handler(req,res){
  const raw=String(req.query?.url||'').trim();
  let url;
  try{url=new URL(raw)}catch{
    return res.status(400).json({ok:false,error:'bad_url'});
  }

  if(url.protocol!=='https:'||!hostAllowed(url.hostname)){
    return res.status(403).json({ok:false,error:'host_not_allowed'});
  }

  try{
    const upstream=await fetch(url,{
      redirect:'follow',
      headers:{
        accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent':'Mozilla/5.0 (compatible; PokemonBinderBR/14.0)'
      }
    });

    if(!upstream.ok)return res.status(upstream.status).end();

    const finalUrl=new URL(upstream.url||url.toString());
    if(finalUrl.protocol!=='https:'||!hostAllowed(finalUrl.hostname)){
      return res.status(403).json({ok:false,error:'redirect_host_not_allowed'});
    }

    const type=String(upstream.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(!type.startsWith('image/'))return res.status(415).json({ok:false,error:'not_an_image'});

    const declared=Number(upstream.headers.get('content-length')||0);
    if(declared&&declared>MAX_BYTES)return res.status(413).json({ok:false,error:'image_too_large'});

    const bytes=Buffer.from(await upstream.arrayBuffer());
    if(bytes.length>MAX_BYTES)return res.status(413).json({ok:false,error:'image_too_large'});

    res.setHeader('Content-Type',type);
    res.setHeader('Content-Length',String(bytes.length));
    res.setHeader('Cache-Control','public, s-maxage=604800, stale-while-revalidate=2592000');
    return res.status(200).send(bytes);
  }catch(error){
    return res.status(502).json({ok:false,error:'image_proxy_failed',message:error?.message||String(error)});
  }
};

module.exports.config={maxDuration:20};

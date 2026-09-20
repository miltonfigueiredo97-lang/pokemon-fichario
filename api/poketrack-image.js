'use strict';

const MAX_BYTES=7*1024*1024;
function slug(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
function decode(v){
  return String(v||'').replace(/&amp;/g,'&').replace(/&#x2F;/gi,'/').replace(/&#47;/g,'/').replace(/&quot;/g,'"');
}
function extractImage(html){
  const patterns=[
    /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i,
    /<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<img[^>]+alt=["'][^"']*Carta[^"']*["'][^>]+src=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+alt=["'][^"']*Carta[^"']*["']/i
  ];
  for(const re of patterns){
    const m=html.match(re);
    if(m?.[1]&&!/logo|favicon|icon/i.test(m[1]))return decode(m[1]);
  }
  return'';
}
module.exports=async function handler(req,res){
  const set=String(req.query?.set||'').trim().toLowerCase();
  const number=String(req.query?.number||'').trim();
  const name=String(req.query?.name||'').trim();
  if(!set||!number||!name)return res.status(400).end();

  const page='https://www.poketrack.com.br/carta/'+encodeURIComponent(set)+'/'+encodeURIComponent(number)+'/'+slug(name);
  try{
    const pr=await fetch(page,{
      redirect:'follow',
      headers:{accept:'text/html,application/xhtml+xml','user-agent':'Mozilla/5.0 (compatible; PokemonBinderBR/14.35)'}
    });
    if(!pr.ok)return res.status(404).end();
    const html=await pr.text();
    let image=extractImage(html);
    if(!image)return res.status(404).end();
    if(image.startsWith('/'))image='https://www.poketrack.com.br'+image;
    if(!/^https:\/\//i.test(image))return res.status(404).end();

    const ir=await fetch(image,{
      redirect:'follow',
      headers:{accept:'image/avif,image/webp,image/png,image/jpeg,image/*','user-agent':'Mozilla/5.0 (compatible; PokemonBinderBR/14.35)','referer':page}
    });
    if(!ir.ok)return res.status(404).end();
    const type=String(ir.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(!type.startsWith('image/'))return res.status(415).end();
    const bytes=Buffer.from(await ir.arrayBuffer());
    if(bytes.length>MAX_BYTES)return res.status(413).end();
    res.setHeader('Content-Type',type);
    res.setHeader('Content-Length',String(bytes.length));
    res.setHeader('Cache-Control','public, s-maxage=604800, stale-while-revalidate=2592000');
    return res.status(200).send(bytes);
  }catch(error){
    console.error('[poketrack-image]',error);
    return res.status(404).end();
  }
};
module.exports.config={maxDuration:30};

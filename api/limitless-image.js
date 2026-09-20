'use strict';

const MAX_BYTES=7*1024*1024;
const CDN='https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';
const SET_MAP={
  svp:'SVP',sm7:'CES',smp:'SMP',swshp:'SWSH',
  celestialstorm:'CES',tempestadecelestial:'CES',
  scarletvioletpromos:'SVP',svpblackstarpromos:'SVP'
};
function clean(v){return String(v||'').trim()}
function key(v){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'')}
function codeFor(set,setName){
  const a=key(set),b=key(setName);
  if(SET_MAP[a])return SET_MAP[a];
  if(SET_MAP[b])return SET_MAP[b];
  const raw=clean(set).replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if(/^[A-Z]{2,8}$/.test(raw)&&!/^SM\d|SWSH\d|SV\d/.test(raw))return raw;
  return'';
}
function localNumber(v){return clean(v).split('/')[0].replace(/[^A-Za-z0-9]/g,'')}
async function readImage(url){
  const r=await fetch(url,{redirect:'follow',headers:{
    accept:'image/avif,image/webp,image/png,image/jpeg,image/*',
    'user-agent':'Mozilla/5.0 (compatible; PokemonBinderBR/14.36)'
  }});
  if(!r.ok)return null;
  const type=String(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!type.startsWith('image/'))return null;
  const bytes=Buffer.from(await r.arrayBuffer());
  if(!bytes.length||bytes.length>MAX_BYTES)return null;
  return{bytes,type};
}
module.exports=async function handler(req,res){
  const code=codeFor(req.query?.set,req.query?.setName);
  const number=localNumber(req.query?.number);
  const lang=clean(req.query?.lang).toLowerCase();
  if(!code||!number)return res.status(404).end();

  const preferred=(lang==='pt'||lang==='pt-br')?'PT':'EN';
  const langs=preferred==='PT'?['PT','EN']:['EN'];
  for(const l of langs){
    for(const ext of ['png','webp']){
      const url=CDN+'/'+code+'/'+code+'_'+number+'_R_'+l+'.'+ext;
      try{
        const image=await readImage(url);
        if(!image)continue;
        res.setHeader('Content-Type',image.type);
        res.setHeader('Content-Length',String(image.bytes.length));
        res.setHeader('Cache-Control','public, s-maxage=604800, stale-while-revalidate=2592000');
        res.setHeader('X-Card-Image-Source','Limitless TCG');
        return res.status(200).send(image.bytes);
      }catch{}
    }
  }
  return res.status(404).end();
};
module.exports.config={maxDuration:25};

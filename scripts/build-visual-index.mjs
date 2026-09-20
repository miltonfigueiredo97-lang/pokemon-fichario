import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const API='https://api.tcgdex.net/v2';
const LANGS=['en','ja'];
const OUT=path.resolve('data/card-visual-index.json');
const CONCURRENCY=24;

function lowImage(url){
  const s=String(url||'').replace(/\/(?:low|high)\.webp(?:\?.*)?$/i,'').replace(/\/$/,'');
  return s?s+'/low.webp':'';
}
function lum(data,w,x,y){
  x=Math.max(0,Math.min(w-1,Math.round(x)));
  const h=Math.floor(data.length/(w*3));
  y=Math.max(0,Math.min(h-1,Math.round(y)));
  const i=(y*w+x)*3;
  return .299*data[i]+.587*data[i+1]+.114*data[i+2];
}
function bitsToHex(bits){
  let out='';
  for(let i=0;i<bits.length;i+=4){
    let n=0;
    for(let j=0;j<4;j++)n=(n<<1)|(bits[i+j]?1:0);
    out+=n.toString(16);
  }
  return out;
}
function dHashRegion(data,w,h,x0,y0,x1,y1,cols,rows){
  const bits=[];
  for(let ry=0;ry<rows;ry++){
    const yy=(y0+(ry+.5)/rows*(y1-y0))*h;
    for(let rx=0;rx<cols;rx++){
      const xa=(x0+(rx+.15)/(cols+1)*(x1-x0))*w;
      const xb=(x0+(rx+1.15)/(cols+1)*(x1-x0))*w;
      bits.push(lum(data,w,xb,yy)>=lum(data,w,xa,yy)?1:0);
    }
  }
  return bitsToHex(bits);
}
function colorHex(data,w,h,x0=.03,y0=.04,x1=.97,y1=.88){
  const hist=new Array(16).fill(0);let total=0;
  const sx=Math.floor(w*x0),ex=Math.ceil(w*x1),sy=Math.floor(h*y0),ey=Math.ceil(h*y1);
  for(let y=sy;y<ey;y+=2)for(let x=sx;x<ex;x+=2){
    const i=(y*w+x)*3,r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,sat=max?delta/max:0;
    if(sat<.16){
      hist[12+Math.min(3,Math.floor(max*4))]++;total++;continue;
    }
    let hue=0;
    if(delta){
      if(max===r)hue=((g-b)/delta)%6;
      else if(max===g)hue=(b-r)/delta+2;
      else hue=(r-g)/delta+4;
      hue=(hue*60+360)%360;
    }
    hist[Math.min(11,Math.floor(hue/30))]++;total++;
  }
  return hist.map(v=>Math.max(0,Math.min(255,Math.round(v/Math.max(1,total)*255))).toString(16).padStart(2,'0')).join('');
}
async function signature(image){
  const url=lowImage(image);if(!url)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(url,{signal:controller.signal,headers:{'user-agent':'PokemonBinderBR-VisualIndex/1.0'}});
    if(!r.ok)return null;
    const input=Buffer.from(await r.arrayBuffer());
    const {data,info}=await sharp(input).resize(84,118,{fit:'fill'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
    if(info.channels!==3)return null;
    return{
      fh:dHashRegion(data,info.width,info.height,.04,.04,.96,.96,16,22),
      ah:dHashRegion(data,info.width,info.height,.05,.10,.95,.61,20,12),
      ch:colorHex(data,info.width,info.height)
    };
  }catch{return null}finally{clearTimeout(timer)}
}
async function allCards(lang){
  const r=await fetch(`${API}/${lang}/cards`,{headers:{accept:'application/json','user-agent':'PokemonBinderBR-VisualIndex/1.0'}});
  if(!r.ok)throw new Error(`TCGdex ${lang}: HTTP ${r.status}`);
  const j=await r.json();
  return Array.isArray(j)?j:[];
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let cursor=0,done=0;
  const workers=Array.from({length:limit},async()=>{
    while(true){
      const i=cursor++;if(i>=items.length)return;
      out[i]=await fn(items[i],i);
      done++;
      if(done%250===0)console.log(`processed ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
  return out;
}

await fs.mkdir(path.dirname(OUT),{recursive:true});
const rows=[];
for(const lang of LANGS){
  const cards=(await allCards(lang)).filter(c=>c?.id&&c?.image);
  console.log(`${lang}: ${cards.length} cards with images`);
  const built=await mapLimit(cards,CONCURRENCY,async card=>{
    const sig=await signature(card.image);if(!sig)return null;
    return[
      lang,
      String(card.id||''),
      String(card.localId||''),
      String(card.name||''),
      String(card.image||''),
      sig.fh,sig.ah,sig.ch
    ];
  });
  rows.push(...built.filter(Boolean));
}

const payload={
  version:1,
  generatedAt:new Date().toISOString(),
  fields:['lang','id','localId','name','image','fullHash','artHash','colorHex'],
  cards:rows
};
await fs.writeFile(OUT,JSON.stringify(payload));
const stat=await fs.stat(OUT);
console.log(`visual index: ${rows.length} cards, ${(stat.size/1024/1024).toFixed(2)} MiB`);

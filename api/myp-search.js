'use strict';
// Catalog search through MYP's own search page, for the "Adicionar cartas"
// dialog. MYP lists every printing it sells (new sets, promos, Japanese, reprint
// collections) before other catalogs do, so it complements TCGdex.
//
// Only signed-in users of the app may call it (Supabase access token), since
// each search launches a browser. Results are cached for 10 minutes.

const {searchMypResults}=require('../lib/myp-browser');

const SUPABASE_URL='https://ryylegveltrypqclimqo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_Ved1tXBXQN1zofbJj3uPzQ_MqHxIEGw';
const CACHE=new Map();
const CACHE_MS=10*60*1000;

async function signedIn(req){
  const auth=String(req.headers.authorization||'');
  if(!/^Bearer\s+\S+/.test(auth))return false;
  try{
    const r=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:auth}});
    return r.ok;
  }catch{return false}
}

function collectorToken(v){
  const raw=String(v||'').trim().replace(/[^A-Za-z0-9]/g,'');
  const m=raw.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  return m?(m[1]||'').toLowerCase()+String(Number(m[2]))+(m[3]||'').toLowerCase():raw.toLowerCase();
}

// A result: title "Name (number)" (Japanese: "Name - 069/064 (069/064)"),
// edition code (SIT, 30CC, SV7A...) with the edition name, MYP code
// "pokemon_<set>_<number>", image, lowest price and stock.
function parseTile(tile){
  const text=String(tile.text||'');
  const title=String(tile.title||text.split(' · ')[0]);
  const m=title.match(/^\s*(.+?)\s*\(\s*([A-Za-z]*\d+[A-Za-z]*)(?:\s*\/\s*([A-Za-z]*\d+[A-Za-z]*))?\s*\)/);
  if(!m)return null;
  const id=Number((String(tile.href).match(/\/produto\/(\d+)\//)||[])[1]||0);
  if(!id)return null;
  const name=m[1].replace(/\s+-\s+[A-Za-z]*\d+[A-Za-z]*(?:\/[A-Za-z]*\d+[A-Za-z]*)?\s*$/,'').trim();
  let setCode=String(tile.edition||'').trim();
  if(!setCode){
    // Text-only fallback: the code is the last word before stock/offer words.
    const after=text.slice(text.indexOf(m[0])+m[0].length).split(/\b(?:Alta procura|Outros idiomas|\d+\s*un\b|Adicionar|Ver ofertas|R\$)/i)[0].trim();
    setCode=after.split(/\s+/).filter(Boolean).pop()||'';
  }
  const price=(text.match(/R\$\s*([0-9.]+,[0-9]{2})/)||[])[1]||'';
  return{
    productId:id,
    link:String(tile.href).split('?')[0],
    code:String(tile.code||''),
    name,
    number:m[3]?m[2]+'/'+m[3]:m[2],
    numberToken:collectorToken(m[2]),
    totalToken:m[3]?collectorToken(m[3]):'',
    setCode:setCode.toUpperCase(),
    editionName:String(tile.editionName||''),
    japanese:/\s-\s[A-Za-z]*\d+/.test(m[1]),
    otherLanguages:/outros idiomas/i.test(text),
    image:tile.image||'',
    lowestPrice:price?Number(price.replace(/\./g,'').replace(',','.')):0,
    stock:Number((text.match(/(\d+)\s*un\b/)||[])[1]||0)
  };
}

module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store, max-age=0');
  const q=String(req.query.q||'').trim().slice(0,80);
  if(q.length<2)return res.status(400).json({ok:false,error:'query_too_short'});
  if(!await signedIn(req))return res.status(401).json({ok:false,error:'unauthorized'});

  const key=q.toLowerCase();
  const hit=CACHE.get(key);
  if(hit&&Date.now()-hit.at<CACHE_MS)return res.status(200).json({...hit.value,cached:true});

  const result=await searchMypResults(q);
  const cards=(result.cards||[]).map(parseTile).filter(Boolean);
  const value={ok:!!result.ok&&!result.blocked,blocked:!!result.blocked,error:result.error||null,query:q,cards};
  if(value.ok)CACHE.set(key,{at:Date.now(),value});
  return res.status(200).json(value);
};

module.exports.config={maxDuration:40};

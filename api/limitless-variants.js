'use strict';

const SET_MAP={
  sm7:'CES',
  celestialstorm:'CES',
  tempestadecelestial:'CES'
};
function clean(v){return String(v||'').trim()}
function norm(v){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function key(v){return norm(v).replace(/\s+/g,'')}
function setCode(id,name){
  const a=key(id),b=key(name);
  if(SET_MAP[a])return SET_MAP[a];
  if(SET_MAP[b])return SET_MAP[b];
  const raw=clean(id).replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if(/^[A-Z]{2,8}$/.test(raw)&&!/^SM\d|SWSH\d|SV\d/.test(raw))return raw;
  return'';
}
function token(v){
  const raw=clean(v).replace(/[^A-Za-z0-9]/g,'');
  const m=raw.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  if(!m)return{raw:raw.toLowerCase(),prefix:'',digits:'',suffix:''};
  return{
    raw:(m[1]||'').toLowerCase()+String(Number(m[2]))+(m[3]||'').toLowerCase(),
    prefix:(m[1]||'').toLowerCase(),
    digits:String(Number(m[2])),
    suffix:(m[3]||'').toLowerCase()
  };
}
function pageHasName(html,name){
  const page=norm(String(html||'').replace(/<[^>]+>/g,' '));
  const q=norm(name).replace(/\bgx\b/g,'').trim();
  return !q||page.includes(q);
}
function escapeRe(v){return String(v||'').replace(/[.*+?^$()|[\]{}\\]/g,'\\$&')}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400');

  const name=clean(req.query?.name),number=clean(req.query?.number);
  const lang=clean(req.query?.lang).toLowerCase()==='pt'?'pt':'en';
  const wanted=token(number.split('/')[0]);
  if(!name||!wanted.digits)return res.status(200).json({ok:true,cards:[]});

  let sets=[];
  try{sets=JSON.parse(String(req.query?.sets||'[]'))}catch{}
  if(!Array.isArray(sets))sets=[];

  const cards=[],seen=new Set();
  const suffixes=wanted.suffix?[wanted.suffix]:['a','b','c','d','e','f'];

  for(const s of sets.slice(0,6)){
    const code=setCode(s?.id,s?.name);
    if(!code)continue;

    for(const suffix of suffixes){
      const local=(wanted.prefix||'')+wanted.digits+suffix;
      const identity=code+'|'+local+'|'+lang;
      if(seen.has(identity))continue;
      seen.add(identity);

      const page='https://limitlesstcg.com/cards/'+lang+'/'+code+'/'+local;
      try{
        const r=await fetch(page,{redirect:'follow',headers:{
          accept:'text/html,application/xhtml+xml',
          'user-agent':'Mozilla/5.0 (compatible; PokemonBinderBR/14.36)'
        }});
        if(!r.ok)continue;
        const html=await r.text();
        const hasNumber=new RegExp('#\\s*'+escapeRe(local),'i').test(html)||html.toLowerCase().includes('/'+local.toLowerCase());
        if(!hasNumber||!pageHasName(html,name))continue;

        const total=clean(s?.total);
        cards.push({
          source:'Limitless TCG',
          apiId:'limitless-'+code+'-'+local+'-'+lang,
          name,
          languageCode:lang==='pt'?'pt-br':'en',
          language:lang==='pt'?'Português':'Inglês',
          setName:clean(s?.name)||code,
          setId:clean(s?.id)||code.toLowerCase(),
          number:total?local+'/'+total:local,
          printedTotal:total,
          rarity:'Arte alternativa',
          type:'',
          category:'',
          hp:null,
          imageUrl:'/api/limitless-image?'+new URLSearchParams({
            set:code,setName:clean(s?.name),number:local,lang
          }).toString(),
          isPromo:false,
          alternatePrint:true
        });
      }catch{}
    }
  }

  return res.status(200).json({ok:true,cards});
};
module.exports.config={maxDuration:30};

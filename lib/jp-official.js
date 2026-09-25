'use strict';

const OFFICIAL_BASE='https://www.pokemon-card.com';
const OFFICIAL_SEARCH=OFFICIAL_BASE+'/card-search/resultAPI.php';
const TCGDEX='https://api.tcgdex.net/v2';

const HEADERS={
  'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  'accept':'application/json,text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language':'ja,en-US;q=0.9,en;q=0.8',
  'referer':OFFICIAL_BASE+'/card-search/',
  'x-requested-with':'XMLHttpRequest'
};

function decodeHtml(v){
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return String(v||'')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)||32))
    .replace(/&([a-z]+);/gi,(m,n)=>Object.prototype.hasOwnProperty.call(named,n.toLowerCase())?named[n.toLowerCase()]:m);
}
function stripTags(v){
  return decodeHtml(String(v||'')
    .replace(/<br\s*\/?>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim());
}
function norm(v){
  return String(v||'').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function absolute(v){
  const s=decodeHtml(v||'').trim();
  if(!s)return'';
  if(/^https?:\/\//i.test(s))return s;
  return OFFICIAL_BASE+(s.startsWith('/')?'':'/')+s;
}
function attr(tag,name){
  const m=String(tag||'').match(new RegExp('\\b'+name+'\\s*=\\s*["\\\']([^"\\\']*)["\\\']','i'));
  return m?decodeHtml(m[1]):'';
}
function tagWithClass(html,tag,className){
  const re=new RegExp('<'+tag+'\\b[^>]*>','gi');
  let m;
  while((m=re.exec(html))){
    const cls=attr(m[0],'class').split(/\s+/);
    if(cls.includes(className))return m[0];
  }
  return'';
}
function blockWithClass(html,tag,className){
  const re=new RegExp('<'+tag+'\\b([^>]*)>([\\s\\S]*?)<\\/'+tag+'>','gi');
  let m;
  while((m=re.exec(html))){
    const cls=attr('<'+tag+m[1]+'>','class').split(/\s+/);
    if(cls.includes(className))return m[2];
  }
  return'';
}
function japaneseText(v){return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(v||''))}
function localNumber(v){
  const m=String(v||'').match(/\d{1,4}/);
  return m?String(Number(m[0])):'';
}
function numberParts(v){
  const s=String(v||'');
  const m=s.match(/(\d{1,4})\s*\/\s*([\p{L}\p{N}-]{1,12})/u);
  if(m)return{n:String(Number(m[1])),rawN:m[1],d:String(m[2])};
  const x=s.match(/\d{1,4}/);
  return x?{n:String(Number(x[0])),rawN:x[0],d:''}:{n:'',rawN:'',d:''};
}
function similarity(a,b){
  const x=norm(a),y=norm(b);
  if(!x||!y)return 0;
  if(x===y)return 1;
  if(x.includes(y)||y.includes(x))return .9;
  const A=new Set(x.split(' ').filter(Boolean)),B=new Set(y.split(' ').filter(Boolean));
  let hit=0;for(const t of A)if(B.has(t))hit++;
  return hit/Math.max(A.size,B.size,1);
}
async function fetchJson(url,options={}){
  const r=await fetch(url,{...options,headers:{...HEADERS,...(options.headers||{})},redirect:'follow'});
  if(!r.ok)return null;
  try{return await r.json()}catch{return null}
}
async function fetchText(url,options={}){
  const r=await fetch(url,{...options,headers:{...HEADERS,...(options.headers||{})},redirect:'follow'});
  if(!r.ok)return'';
  return await r.text();
}

function querySuffix(raw){
  const m=String(raw||'').trim().match(/\b(ex|gx|vmax|vstar|v-union|v|break|lv\.?\s*x)\s*$/i);
  return m?m[1].replace(/\s+/g,''):'';
}
function speciesCandidates(raw){
  let base=String(raw||'').trim()
    .replace(/\b(ex|gx|vmax|vstar|v-union|v|break|lv\.?\s*x)\s*$/i,'')
    .replace(/\b(?:radiant|shining)\b/ig,'')
    .trim();
  const form=[];
  if(/^alolan\s+/i.test(base)){form.push('アローラ');base=base.replace(/^alolan\s+/i,'')}
  if(/^galarian\s+/i.test(base)){form.push('ガラル');base=base.replace(/^galarian\s+/i,'')}
  if(/^hisuian\s+/i.test(base)){form.push('ヒスイ');base=base.replace(/^hisuian\s+/i,'')}
  if(/^paldean\s+/i.test(base)){form.push('パルデア');base=base.replace(/^paldean\s+/i,'')}
  const words=base.split(/\s+/).filter(Boolean);
  const out=[];
  for(let i=0;i<words.length;i++){
    const chunk=words.slice(i).join(' ')
      .replace(/[.'’]/g,'')
      .replace(/♀/g,'-f').replace(/♂/g,'-m')
      .replace(/:/g,' ')
      .replace(/\s+/g,'-')
      .toLowerCase();
    if(chunk)out.push({slug:chunk,form});
  }
  return out;
}
async function pokemonJapaneseNameFromAmerican(raw){
  const suffix=querySuffix(raw);
  for(const candidate of speciesCandidates(raw)){
    try{
      const j=await fetchJson('https://pokeapi.co/api/v2/pokemon-species/'+encodeURIComponent(candidate.slug),{
        headers:{accept:'application/json','user-agent':'PokemonBinderBR/14.30'}
      });
      if(!j)continue;
      const names=Array.isArray(j.names)?j.names:[];
      const ja=names.find(x=>x?.language?.name==='ja-Hrkt')?.name||
        names.find(x=>x?.language?.name==='ja')?.name||'';
      if(!ja)continue;
      const term=[...candidate.form,ja,suffix].filter(Boolean).join(' ');
      return {term,native:term,speciesJa:ja,suffix};
    }catch{}
  }
  return null;
}
async function deriveJapaneseTerms(name,number=''){
  const raw=String(name||'').trim();
  if(!raw)return[];
  if(japaneseText(raw))return[{ja:raw,display:raw,score:1000}];

  const out=[],seen=new Set();
  const add=row=>{
    if(!row?.ja)return;
    const k=norm(row.ja);
    if(!k||seen.has(k))return;
    seen.add(k);out.push(row);
  };

  const poke=await pokemonJapaneseNameFromAmerican(raw);
  if(poke)add({ja:poke.term,display:raw,score:1.2,nativeName:poke.native});

  const ids=new Map();
  for(const lang of ['en','pt']){
    try{
      // First try the typed name exactly.
      const p=new URLSearchParams({name:raw,'pagination:itemsPerPage':'24'});
      const list=await fetchJson(TCGDEX+'/'+lang+'/cards?'+p.toString(),{headers:{accept:'application/json'}});
      for(const row of Array.isArray(list)?list:[]){
        if(!row?.id)continue;
        const display=String(row.name||raw);
        const score=similarity(display,raw);
        const old=ids.get(row.id);
        if(!old||score>old.score)ids.set(row.id,{id:row.id,display,score});
      }

      // V16.01: when the user knows the collector number but misspells the
      // English/romanized name (e.g. "Millotic ex" instead of "Milotic ex"),
      // use that number only as a discovery pool, then require a strong fuzzy
      // name match before deriving the Japanese species name.
      const wanted=numberParts(number);
      if(wanted.n){
        const q=new URLSearchParams({localId:wanted.rawN||wanted.n,'pagination:itemsPerPage':'80'});
        const numbered=await fetchJson(TCGDEX+'/'+lang+'/cards?'+q.toString(),{headers:{accept:'application/json'}});
        for(const row of Array.isArray(numbered)?numbered:[]){
          if(!row?.id||!row?.name)continue;
          const display=String(row.name);
          const score=similarity(display,raw);
          if(score<.72)continue;
          const old=ids.get(row.id);
          if(!old||score>old.score)ids.set(row.id,{id:row.id,display,score});
        }
      }
    }catch{}
  }
  const candidates=[...ids.values()].sort((a,b)=>b.score-a.score).slice(0,14);

  // If PokeAPI failed on the typed spelling, retry it with the best canonical
  // TCGdex card name before translating to Japanese.
  if(!poke&&candidates.length&&candidates[0].score>=.72){
    const canonical=await pokemonJapaneseNameFromAmerican(candidates[0].display);
    if(canonical)add({ja:canonical.term,display:raw,score:1.15,nativeName:canonical.native});
  }
  const translated=await Promise.all(candidates.map(async row=>{
    try{
      const j=await fetchJson(TCGDEX+'/ja/cards/'+encodeURIComponent(row.id),{headers:{accept:'application/json'}});
      return j?.name?{ja:String(j.name),display:raw,score:row.score}:null;
    }catch{return null}
  }));
  translated.filter(Boolean).forEach(add);
  return out.slice(0,6);
}
async function officialList(term,page=1){
  const u=new URL(OFFICIAL_SEARCH);
  u.searchParams.set('keyword',term||'');
  u.searchParams.set('regulation_sidebar_form','all');
  u.searchParams.set('page',String(page));
  u.searchParams.set('sm_and_keyword','true');
  const j=await fetchJson(u.toString(),{headers:{accept:'application/json, text/javascript, */*; q=0.01'}});
  if(!j||j.result!==1)return{ids:[],maxPage:0,hitCnt:0};
  const ids=[];
  for(const row of Array.isArray(j.cardList)?j.cardList:[]){
    const id=String(row?.cardID||'');
    if(/^\d+$/.test(id))ids.push(id);
  }
  return{ids,maxPage:Number(j.maxPage||1),hitCnt:Number(j.hitCnt||ids.length)};
}

function parseDetail(html,id,displayName=''){
  if(!html)return null;
  const h1=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const nativeName=stripTags(h1?.[1]||'');
  if(!nativeName)return null;

  const imageTag=tagWithClass(html,'img','fit');
  const officialImageUrl=absolute(attr(imageTag,'src'));
  const image=officialImageUrl?'/api/image-proxy?url='+encodeURIComponent(officialImageUrl):'';

  const setTag=tagWithClass(html,'img','img-regulation');
  const setCode=stripTags(attr(setTag,'alt'));

  const sub=stripTags(blockWithClass(html,'div','subtext'));
  const regulationPos=html.search(/img-regulation/i);
  const nearRegulation=regulationPos>=0?stripTags(html.slice(regulationPos,regulationPos+900)):'';
  const wholeText=stripTags(html);
  const collector=
    nearRegulation.match(/(\d{1,4})\s*\/\s*([\p{L}\p{N}-]{1,12})/u)||
    sub.match(/(\d{1,4})\s*\/\s*([\p{L}\p{N}-]{1,12})/u)||
    wholeText.match(/(\d{1,4})\s*\/\s*([\p{L}\p{N}-]{1,12})/u);
  const rawNumber=collector?.[1]||localNumber(sub)||'';
  const printedTotal=collector?.[2]||'';
  const collectorNumber=collector?(rawNumber+'/'+printedTotal):rawNumber;

  const rarityMatch=html.match(/(?:src|data-src)=["'][^"']*ic_([^/"'.]+)\.(?:png|gif|svg|webp)["']/i);
  const rarity=decodeHtml(rarityMatch?.[1]||'').replace(/_/g,' ').toUpperCase();

  const hpBlock=blockWithClass(html,'span','hp-num');
  const hp=Number(stripTags(hpBlock)||0)||null;

  const section=html.match(/<section\b[^>]*>([\s\S]*?)<\/section>/i)?.[1]||html;
  const h2=section.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  const type=stripTags(h2?.[1]||'');

  const sourceNames=[];
  const liRe=/<li\b[^>]*class=["'][^"']*\bList_item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let lm;
  while((lm=liRe.exec(html))&&sourceNames.length<6){
    const s=stripTags(lm[1]);
    if(s)sourceNames.push(s);
  }

  const name=displayName&& !japaneseText(displayName)?displayName:nativeName;
  return{
    source:'Pokémon Japão Oficial',
    apiId:'jp-'+id,
    officialId:String(id),
    name,
    nativeName,
    languageCode:'ja',
    language:'Japonês',
    setName:setCode||sourceNames[0]||'Japão',
    setId:setCode||'jp',
    setTitle:sourceNames[0]||'',
    number:collectorNumber,
    printedTotal,
    rarity,
    type,
    category:type,
    hp,
    imageUrl:image,
    officialImageUrl,
    officialUrl:OFFICIAL_BASE+'/card-search/details.php/card/'+id
  };
}

async function fetchDetail(id,displayName=''){
  const url=OFFICIAL_BASE+'/card-search/details.php/card/'+encodeURIComponent(id);
  const html=await fetchText(url,{headers:{accept:'text/html,application/xhtml+xml'}});
  return parseDetail(html,id,displayName);
}

function matchesFilters(card,wanted){
  if(!card)return false;
  const suffix=querySuffix(wanted.name);
  if(suffix){
    const native=norm(card.nativeName),display=norm(card.name),token=norm(suffix);
    if(!native.split(' ').includes(token)&&!display.split(' ').includes(token)&&!native.endsWith(token)&&!display.endsWith(token))return false;
  }
  const qn=numberParts(wanted.number);
  const cn=numberParts(card.number);
  if(qn.n&&cn.n!==qn.n)return false;
  if(qn.d){
    const cardDen=norm(card.printedTotal);
    if(cardDen&&cardDen!==norm(qn.d))return false;
  }
  const set=norm(wanted.set);
  if(set){
    const hay=[card.setId,card.setName,card.setTitle].map(norm).filter(Boolean);
    if(!hay.some(x=>x===set||x.includes(set)||set.includes(x)))return false;
  }
  if(wanted.hp&&card.hp&&Number(wanted.hp)!==Number(card.hp))return false;
  if(wanted.rarity&&card.rarity&&similarity(card.rarity,wanted.rarity)<.75)return false;
  return true;
}

function scoreCard(card,wanted){
  let s=0;
  const qn=numberParts(wanted.number),cn=numberParts(card.number);
  if(qn.n&&cn.n===qn.n)s+=800;
  if(qn.d&&norm(card.printedTotal)===norm(qn.d))s+=220;
  const set=norm(wanted.set);
  if(set){
    for(const x of [card.setId,card.setName,card.setTitle].map(norm)){
      if(!x)continue;
      if(x===set)s=Math.max(s,s+650);
      else if(x.includes(set)||set.includes(x))s+=420;
    }
  }
  if(wanted.name){
    s+=Math.round(Math.max(similarity(card.name,wanted.name),similarity(card.nativeName,wanted.nativeName||''))*300);
  }
  if(card.imageUrl)s+=60;
  return s;
}

async function searchOfficialJapaneseCards({name='',number='',set='',limit=40,hp='',rarity=''}={}){
  limit=Math.max(1,Math.min(80,Number(limit)||40));
  const terms=await deriveJapaneseTerms(name,number);
  if(!terms.length)return[];

  const wanted={name,number,set,hp,rarity};
  const hasHard=!!(number||set||hp||rarity);
  const maxIds=hasHard?90:Math.min(60,limit*2);
  const idMeta=new Map();

  for(const term of terms.slice(0,4)){
    let page=1,maxPage=1;
    const pageCap=hasHard?5:2;
    while(page<=Math.min(maxPage,pageCap)&&idMeta.size<maxIds){
      const list=await officialList(term.ja,page);
      maxPage=Math.max(1,list.maxPage||1);
      for(const id of list.ids){
        if(!idMeta.has(id))idMeta.set(id,{display:term.display,nativeName:term.ja,termScore:term.score});
        if(idMeta.size>=maxIds)break;
      }
      page++;
    }
    if(idMeta.size>=maxIds)break;
  }

  const entries=[...idMeta.entries()];
  const cards=[];
  const concurrency=10;
  for(let i=0;i<entries.length;i+=concurrency){
    const batch=entries.slice(i,i+concurrency);
    const rows=await Promise.all(batch.map(async([id,meta])=>{
      try{
        const card=await fetchDetail(id,meta.display);
        if(card)card._termScore=meta.termScore;
        return card;
      }catch{return null}
    }));
    for(const card of rows){
      if(card&&matchesFilters(card,wanted))cards.push(card);
    }
    if(cards.length>=limit*2)break;
  }

  cards.sort((a,b)=>(scoreCard(b,wanted)+(b._termScore||0)*50)-(scoreCard(a,wanted)+(a._termScore||0)*50));
  const seen=new Set(),out=[];
  for(const card of cards){
    const key=[card.officialId,card.setId,card.number].join('|');
    if(seen.has(key))continue;
    seen.add(key);
    delete card._termScore;
    out.push(card);
    if(out.length>=limit)break;
  }
  return out;
}

module.exports={
  searchOfficialJapaneseCards,
  deriveJapaneseTerms,
  fetchDetail,
  parseDetail
};

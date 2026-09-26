import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MYP_API = "https://pokemon-fichario.vercel.app/api/mypcards-public";
const LIGA_API = "https://pokemon-fichario.vercel.app/api/liga-public";
const BATCH_SIZE = 1;
const MAX_RUN_MS = 48 * 1000;
const STALE_MS = 75 * 1000;

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
function json(data: unknown, status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Connection":"keep-alive",...CORS}});
}
function num(v: unknown){ const n=Number(v||0); return Number.isFinite(n)?n:0; }
async function setProgress(db:any,id:string,progress:number,stage:string){
  const value=Math.max(0,Math.min(100,Math.round(Number(progress)||0)));
  await db.from("pokemon_cards").update({
    price_progress:value,
    price_progress_stage:stage,
    price_progress_updated_at:new Date().toISOString()
  }).eq("id",id);
}

async function fetchSource(base:string, card:any, allowSavedLink=true, fast=false){
  const q=new URLSearchParams({
    name:String(card.name||""),
    number:String(card.number||""),
    set:String(card.set_name||""),
    setId:String(card.set_id||""),
    apiId:String(card.api_id||""),
    lang:String(card.language_code||""),
    finish:String(card.finish||"Normal"),
    condition:String(card.condition||"Nova")
  });
  if(Number(card.price_priority||0)>=1000)q.set("_",String(Date.now()));
  if(base===MYP_API&&fast)q.set("fast","1");
  if(base===MYP_API&&allowSavedLink){
    const link=String(card.myp_price_link||card.price_br_link||card.price_link||"").trim();
    if(link&&/mypcards\.com/i.test(link))q.set("link",link);
    // Reliability mode uses the real browser resolver for a single card,
    // whether the exact product URL is already known or still needs discovery.
    if(!fast)q.set("directBrowser","1");
  }
  const controller=new AbortController();
  // Cartas sem link conhecido podem precisar do Actor (até ~55 s).
  // Só esse caminho ganha orçamento maior; links conhecidos continuam rápidos.
  // V16.36: a fila tenta primeiro o resolvedor rápido da MESMA carta. Só quando
  // ele já localizou um produto MYP exato é permitido abrir o browser desse link.
  // Isso impede uma busca Chromium de 45 s por carta sem identidade resolvida.
  const timeoutMs=base===MYP_API?(fast?14000:24000):7000;
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const rr=await fetch(base+"?"+q.toString(),{
      headers:{"Accept":"application/json","User-Agent":"PokemonBinderBR-PriceWorker/16.36"},
      signal:controller.signal
    });
    const body=await rr.text();
    let data:any={};
    try{data=JSON.parse(body)}catch{}
    if(!rr.ok)throw new Error("price_api_http_"+rr.status);
    return data;
  }finally{clearTimeout(timer)}
}

function collectorNumber(value:unknown){
  const m=String(value||"").match(/([0-9]{1,4})/);
  return m?Number(m[1]):0;
}
function mypProductId(value:unknown){
  const m=String(value||"").match(/mypcards\.com\/pokemon\/produto\/([0-9]+)\//i);
  return m?Number(m[1]):0;
}

function base64UrlUtf8(value:string){
  const bytes=new TextEncoder().encode(value);
  let binary="";
  for(const b of bytes)binary+=String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

async function hydrateBatchMypLinks(db:any,batch:any[]){
  const targets=batch.slice(0,10);
  if(!targets.length)return;

  // Reuse a validated product link from the sibling finish (Normal/Reverse/Foil)
  // before any remote discovery. Same set + language + collector number is the
  // same MYP product page, only the market subsection differs by finish.
  const items=await Promise.all(targets.map(async card=>{
    let link=String(card.myp_price_link||card.price_br_link||card.price_link||"");
    if(!/mypcards\.com\/pokemon\/produto\/\d+\//i.test(link)){
      link=await siblingMypLink(db,card).catch(()=> "");
      if(link){
        card.myp_price_link=link;
        await db.from("pokemon_cards").update({myp_price_link:link}).eq("id",card.id);
      }
    }
    return{
      key:String(card.id),
      name:String(card.name||""),
      number:String(card.number||""),
      set:String(card.set_name||""),
      setId:String(card.set_id||""),
      lang:String(card.language_code||""),
      finish:String(card.finish||"Normal"),
      condition:String(card.condition||"Nova"),
      link
    };
  }));
  const q=new URLSearchParams({
    batchResolve:"1",
    items:base64UrlUtf8(JSON.stringify(items))
  });

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),11500);
  let payload:any=null;
  try{
    const rr=await fetch(MYP_API+"?"+q.toString(),{
      headers:{"Accept":"application/json","User-Agent":"PokemonBinderBR-PriceWorker/16.18"},
      signal:controller.signal
    });
    if(rr.ok)payload=await rr.json().catch(()=>null);
  }catch{}
  finally{clearTimeout(timer)}

  const byKey=new Map<string,any>();
  for(const item of Array.isArray(payload?.items)?payload.items:[]){
    if(item?.key)byKey.set(String(item.key),item);
  }
  for(const card of targets){
    const result=byKey.get(String(card.id))||{
      ok:false,
      error:String(payload?.error||"batch_resolver_no_result"),
      source:"MYP Cards",
      provider:"MYP batch10"
    };
    // In reliability mode batchResolve is only the FIRST identity/market source.
    // A valid quote can finish immediately; a miss must fall through to the
    // individual resolver instead of becoming a fake terminal "no quote".
    card._batchMypMarket=(result?.ok&&hasMarketPrice(result))?result:null;
    card._batchMypDiagnostic=String(result?.error||"");
    const link=String(result?.link||"").trim();
    if(link&&/mypcards\.com\/pokemon\/produto\/\d+\//i.test(link)){
      card.myp_price_link=link;
      await db.from("pokemon_cards").update({myp_price_link:link}).eq("id",card.id);
    }
  }
}
const learnedSetLinkCache=new Map<string,{offset:number,anchors:number,expires:number}|null>();

const siblingLinkCache=new Map<string,{link:string,expires:number}>();
async function siblingMypLink(db:any,card:any){
  const setId=String(card?.set_id||"").trim();
  const lang=String(card?.language_code||"").trim();
  const number=String(card?.number||"").trim();
  if(!setId||!number)return"";
  const key=setId+"|"+lang+"|"+number;
  const cached=siblingLinkCache.get(key);
  if(cached&&cached.expires>Date.now())return cached.link;

  const {data,error}=await db.from("pokemon_cards")
    .select("myp_price_link")
    .eq("set_id",setId)
    .eq("language_code",lang)
    .eq("number",number)
    .not("myp_price_link","is",null)
    .limit(3);

  if(error||!Array.isArray(data))return"";
  const link=data
    .map((row:any)=>String(row?.myp_price_link||"").trim())
    .find((value:string)=>/mypcards\.com\/pokemon\/produto\/\d+\//i.test(value))||"";
  if(link)siblingLinkCache.set(key,{link,expires:Date.now()+30*60_000});
  return link;
}


const englishSlugCache=new Map<string,{slug:string,expires:number}>();
function mypSlug(value:unknown){
  return String(value||"")
    .replace(/['’]/g,"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/♀/g,"-female-").replace(/♂/g,"-male-")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"")
    .replace(/-+/g,"-");
}
async function mypCardSlug(card:any){
  const apiId=String(card?.api_id||"").trim();
  const lang=String(card?.language_code||"").toLowerCase();
  const key=(lang||"default")+"|"+(apiId||String(card?.name||""));
  const cached=englishSlugCache.get(key);
  if(cached&&cached.expires>Date.now())return cached.slug;

  let name="";
  if(apiId){
    const locales=(lang==="pt-br"||lang==="pt")?["pt-br","en"]:["en","pt-br"];
    for(const locale of locales){
      try{
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),4500);
        try{
          const r=await fetch("https://api.tcgdex.net/v2/"+locale+"/cards/"+encodeURIComponent(apiId),{
            headers:{"Accept":"application/json","User-Agent":"PokemonBinderBR-PriceWorker/16.36"},
            signal:controller.signal
          });
          if(r.ok){
            const data=await r.json();
            const candidate=String(data?.name||"").trim();
            if(candidate){name=candidate;break}
          }
        }finally{clearTimeout(timer)}
      }catch{}
    }
  }
  if(!name)name=String(card?.name||"");

  const combined=String([name,card?.name].filter(Boolean).join(" "))
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase();
  let slug="";
  if((lang==="pt-br"||lang==="pt")
    &&/\b(?:energy|energia)\b/.test(combined)
    &&/\b(?:psychic|psiquic[ao])\b/.test(combined)){
    // A MYP usa o título localizado "Energia Psíquica" para esta família,
    // mesmo quando APIs externas retornam "Basic Psychic Energy".
    slug="energia-psiquica";
  }
  if(!slug)slug=mypSlug(name)||"card";

  englishSlugCache.set(key,{slug,expires:Date.now()+24*60*60_000});
  return slug;
}

function generationsMypProductId(value:unknown){
  const raw=String(value||"").trim().replace(/\s/g,"").toLowerCase();
  let m=raw.match(/^rc0*(\d+)\/rc32$/i);
  if(m){
    const n=Number(m[1]);
    return n>=1&&n<=32?36243+n:0;
  }
  if(/^0*28a\/83$/i.test(raw))return 36188;
  if(/^0*73a\/83$/i.test(raw))return 115355;
  m=raw.match(/^0*(\d+)\/83$/);
  if(!m)return 0;
  const n=Number(m[1]);
  if(n<1||n>83)return 0;
  return (n<=28?36159:36160)+n;
}
async function canonicalGenerationsLink(card:any){
  if(String(card?.set_id||"").trim().toLowerCase()!=="g1")return"";
  const productId=generationsMypProductId(card?.number);
  if(!productId)return"";
  let slug="";
  if(String(card?.number||"").replace(/\s/g,"").toLowerCase()==="73a/83"){
    slug="grunhido-da-equipe-flare";
  }else{
    slug=await mypCardSlug(card).catch(()=> "card");
  }
  return "https://mypcards.com/pokemon/produto/"+String(productId)+"/"+(slug||"card");
}

async function canonicalMew151Link(card:any){
  const setId=String(card?.set_id||"").trim().toLowerCase();
  const lang=String(card?.language_code||"").trim().toLowerCase();
  if(!["sv03.5","sv3.5"].includes(setId)||!["pt-br","pt"].includes(lang))return"";
  const collector=collectorNumber(card?.number);
  if(collector<1||collector>207)return"";
  const productId=205873+collector;
  const slug=await mypCardSlug(card).catch(()=> "card");
  return "https://mypcards.com/pokemon/produto/"+String(productId)+"/"+(slug||"card");
}

async function learnedMypLink(db:any,card:any){
  const collector=collectorNumber(card?.number);
  const setId=String(card?.set_id||"").trim();
  const lang=String(card?.language_code||"").trim();
  if(!collector||!setId)return"";

  const key=setId+"|"+lang;
  let learned=learnedSetLinkCache.get(key);
  if(learned===undefined||((learned as any)?.expires||0)<Date.now()){
    const {data,error}=await db.from("pokemon_cards")
      .select("number,myp_price_link")
      .eq("set_id",setId)
      .eq("language_code",lang)
      .not("myp_price_link","is",null)
      .limit(160);

    if(error||!Array.isArray(data)){
      learnedSetLinkCache.set(key,null);
      return"";
    }

    const counts=new Map<number,number>();
    let usable=0;
    for(const row of data){
      const n=collectorNumber(row?.number);
      const id=mypProductId(row?.myp_price_link);
      if(!n||!id)continue;
      usable++;
      const offset=id-n;
      counts.set(offset,(counts.get(offset)||0)+1);
    }
    let bestOffset=0,bestCount=0;
    for(const [offset,count] of counts){
      if(count>bestCount){bestOffset=offset;bestCount=count}
    }

    // V15.16: one validated card is enough to generate a SEQUENTIAL CANDIDATE.
    // This is not blindly trusted: the MYP API validates name/number/set on the
    // candidate page before accepting any price. A wrong candidate is discarded.
    // As more anchors appear, the same offset naturally gains confidence.
    if(bestCount>=1&&bestCount>=Math.ceil(Math.max(1,usable)*.50)){
      learned={offset:bestOffset,anchors:bestCount,expires:Date.now()+30*60_000};
      learnedSetLinkCache.set(key,learned);
    }else{
      learnedSetLinkCache.set(key,null);
      return"";
    }
  }

  if(!learned)return"";
  const productId=learned.offset+collector;
  if(productId<=0)return"";
  const slug=await mypCardSlug(card);
  return "https://mypcards.com/pokemon/produto/"+String(productId)+"/"+slug;
}

function requiresExactMewPtBrVariant(card:any){
  const setId=String(card?.set_id||"").trim().toLowerCase();
  const lang=String(card?.language_code||"").trim().toLowerCase();
  const finish=String(card?.finish||"Normal").trim().toLowerCase();
  return ["sv03.5","sv3.5"].includes(setId)
    && ["pt-br","pt"].includes(lang)
    && finish!=="normal";
}
function hasMarketPrice(m:any){return !!(m&&(num(m.min)||num(m.avg)||num(m.max)))}
function choosePrimary(liga:any,myp:any){
  // V15.06: MYP é a fonte canônica. Liga é apenas fallback.
  if(hasMarketPrice(myp)&&num(myp.avg)>0)return{market:myp,source:"MYP Cards"};
  if(hasMarketPrice(myp))return{market:myp,source:"MYP Cards"};
  if(hasMarketPrice(liga)&&num(liga.avg)>0)return{market:liga,source:"Liga Pokémon"};
  if(hasMarketPrice(liga))return{market:liga,source:"Liga Pokémon"};
  return{market:null,source:"Sem preço BR"};
}
async function fetchMarkets(card:any,onProgress:(pct:number,stage:string)=>Promise<void>=async()=>{}){
  // V16.36: UMA carta por vez e somente MYP. A fila usa primeiro o mesmo
  // resolvedor rápido de nome+número+coleção. Se ele já devolver preço, acabou.
  // Se localizar o produto exato mas não conseguir ler a variante, fazemos UMA
  // leitura browser apenas desse link conhecido. Nunca pula para outra carta
  // enquanto esta ainda está sendo resolvida.
  await onProgress(55,"searching_myp");
  const fastMyp=await fetchSource(MYP_API,card,true,true)
    .catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"fast_timeout":String(e?.message||"myp_fast_error")}));

  if(hasMarketPrice(fastMyp)){
    await onProgress(86,"myp_returned");
    return{myp:fastMyp,liga:null};
  }

  const resolvedLink=String(
    fastMyp?.link||card.myp_price_link||card.price_br_link||card.price_link||""
  ).trim();

  if(/mypcards\.com\/pokemon\/produto\/\d+\//i.test(resolvedLink)){
    const directCard={...card,myp_price_link:resolvedLink};
    await onProgress(72,"reading_myp");
    const directMyp=await fetchSource(MYP_API,directCard,true,false)
      .catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"direct_timeout":String(e?.message||"myp_direct_error"),link:resolvedLink}));

    if(hasMarketPrice(directMyp)){
      await onProgress(86,"myp_returned");
      return{myp:directMyp,liga:null};
    }

    await onProgress(86,"myp_returned");
    return{myp:{...fastMyp,...directMyp,link:String(directMyp?.link||resolvedLink)},liga:null};
  }

  await onProgress(86,"myp_returned");
  return{myp:fastMyp,liga:null};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);

  const url=Deno.env.get("SUPABASE_URL");
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return json({ok:false,error:"missing_supabase_env"},500);
  const db=createClient(url,service,{auth:{persistSession:false}});

  let claimed=0,updated=0,retried=0,terminal=0;
  const startedAt=Date.now();
  const states:string[]=[];

  async function processClaimedCard(card:any){
    // The RPC has already atomically incremented attempts and persisted "claimed".
    // Never short-circuit because an older quote exists: this job must perform a
    // real source lookup before it may become complete.
    try{
      await setProgress(db,card.id,20,"resolving_identity");
      // Se a coleção já possui várias páginas MYP validadas com uma sequência
      // consistente, aprenda o padrão automaticamente e use-o como candidato.
      // A API ainda valida a página real antes de aceitar qualquer preço.
      let fetchCard=card;
      {
        const existingMyp=[
          card.myp_price_link,card.price_br_link,card.price_link
        ].map((v:any)=>String(v||"").trim()).find((v:string)=>/mypcards\.com/i.test(v))||"";
        const canonical151Link=await canonicalMew151Link(card).catch(()=> "");
        const canonicalGenerations=await canonicalGenerationsLink(card).catch(()=> "");
        const canonicalLink=canonical151Link||canonicalGenerations;
        if(canonicalLink){
          if(mypProductId(existingMyp)!==mypProductId(canonicalLink)){
            await db.from("pokemon_cards").update({myp_price_link:canonicalLink}).eq("id",card.id);
          }
          fetchCard={...card,myp_price_link:canonicalLink};
        }else if(!existingMyp){
          const siblingLink=await siblingMypLink(db,card).catch(()=> "");
          if(siblingLink){
            await db.from("pokemon_cards").update({myp_price_link:siblingLink}).eq("id",card.id);
            fetchCard={...card,myp_price_link:siblingLink};
          }
        }
      }

      await setProgress(db,card.id,40,[fetchCard.myp_price_link,fetchCard.price_br_link,fetchCard.price_link].some((v:any)=>/mypcards\.com/i.test(String(v||"")))?"link_ready":"identity_ready");
      const markets=await fetchMarkets(fetchCard,(pct,stage)=>setProgress(db,card.id,pct,stage));
      await setProgress(db,card.id,86,"validating_quote");
      const myp=markets.myp,liga=markets.liga;
      const picked=choosePrimary(liga,myp);
      const market=picked.market;

      if(market){
        const checkedAt=String(market?.checkedAt||new Date().toISOString());
        const resolvedLink=String(market?.link||"");
        const patch:any={
          price_min:num(market.min),
          price_avg:num(market.avg)||num(market.min)||num(market.max),
          price_max:num(market.max),currency:"BRL",
          price_source:picked.source,price_link:resolvedLink||"",
          price_br_source:picked.source,price_br_link:resolvedLink||null,
          price_checked_at:checkedAt,price_pending:false,price_processing_at:null,
          price_next_retry_at:null,price_priority:0,price_last_error:null,
          price_progress:100,price_progress_stage:"complete",price_progress_updated_at:new Date().toISOString()
        };

        if(hasMarketPrice(liga)){
          patch.liga_price_min=num(liga.min);patch.liga_price_avg=num(liga.avg);patch.liga_price_max=num(liga.max);
          patch.liga_price_link=String(liga.link||card.liga_price_link||"")||null;
          patch.liga_price_checked_at=String(liga.checkedAt||checkedAt);
        }
        if(hasMarketPrice(myp)){
          patch.myp_price_min=num(myp.min);patch.myp_price_avg=num(myp.avg);patch.myp_price_max=num(myp.max);
          patch.myp_price_link=String(myp.link||card.myp_price_link||"")||null;
          patch.myp_price_checked_at=String(myp.checkedAt||checkedAt);
        }else if(["wrong_product","product_not_found"].includes(String(myp?.error||""))){
          patch.myp_price_link=null;
        }

        const resolvedNumber=String(liga?.number||myp?.number||"").trim();
        if(/^\d+\/\d+$/.test(resolvedNumber)&&!String(card.number||"").includes("/"))patch.number=resolvedNumber;

        await setProgress(db,card.id,92,"saving_quote");
        const {data:saved,error}=await db.from("pokemon_cards")
          .update(patch)
          .eq("id",card.id)
          .eq("price_pending",true)
          .select("id,price_pending,price_progress_stage,price_checked_at")
          .maybeSingle();
        if(error)throw error;
        if(!saved||saved.price_pending!==false||String(saved.price_progress_stage)!=="complete"){
          throw new Error("price_save_not_confirmed");
        }
        updated++;
        return {state:"updated",source:picked.source};
      }

      const ligaError=String(liga?.error||"").trim();
      const mypError=String(myp?.error||"").trim();
      const discoveredMypLink=String(myp?.link||"").trim();
      const detail=[
        mypError?"myp:"+mypError:"",
        ligaError?"liga:"+ligaError:""
      ].filter(Boolean).join("|")||"no_price_data";

      const patch:any={
        price_pending:false,price_processing_at:null,price_next_retry_at:null,
        price_priority:0,price_last_error:detail,
        price_progress:100,price_progress_stage:"no_quote",
        price_progress_updated_at:new Date().toISOString()
      };
      if(discoveredMypLink&&/mypcards\.com/i.test(discoveredMypLink))patch.myp_price_link=discoveredMypLink;
      const {error}=await db.from("pokemon_cards").update(patch).eq("id",card.id);
      if(error)throw error;
      terminal++;
      return {state:"no_quote",detail};
    }catch(error:any){
      const message=error?.name==="AbortError"?"timeout":String(error?.message||error||"worker_error");
      await db.from("pokemon_cards").update({
        price_pending:false,price_processing_at:null,price_next_retry_at:null,
        price_priority:0,price_last_error:message,
        price_progress:100,price_progress_stage:"no_quote",price_progress_updated_at:new Date().toISOString()
      }).eq("id",card.id);
      terminal++;
      return {state:"no_quote",detail:message};
    }

  }  async function claimBatch(){
    // The database itself hard-limits this claim to ONE row.
    const {data,error}=await db.rpc("claim_pokemon_price_batch",{p_limit:1});
    if(error)throw error;
    return Array.isArray(data)?data:[];
  }

  try{
    while(Date.now()-startedAt<MAX_RUN_MS){
      const batch=await claimBatch();
      if(!batch.length)break;
      claimed+=batch.length;

      // A batch is physically one row. No second card is claimed until this
      // one reaches complete/no_quote and clears price_processing_at.
      const results=await Promise.allSettled(batch.map((card:any)=>processClaimedCard(card)));
      for(const result of results){
        states.push(result.status==="fulfilled"?String(result.value?.state||"unknown"):"rejected");
      }
      if(Date.now()-startedAt>=MAX_RUN_MS)break;
    }
  }catch(error:any){
    return json({ok:false,error:"worker_batch_failed",message:String(error?.message||error),claimed,updated,terminal,states},500);
  }

  return json({ok:true,batchSize:BATCH_SIZE,claimed,updated,terminal,states});
});

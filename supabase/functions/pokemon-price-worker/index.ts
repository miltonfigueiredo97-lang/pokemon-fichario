import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MYP_API = "https://pokemon-fichario.vercel.app/api/mypcards-public";
const LIGA_API = "https://pokemon-fichario.vercel.app/api/liga-public";
const BATCH = 16;
const RETRY_LIMIT = 3;
const STALE_MS = 2 * 60 * 1000;
const TERMINAL = new Set(["wrong_product","product_not_found"]);

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
function json(data: unknown, status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Connection":"keep-alive",...CORS}});
}
function num(v: unknown){ const n=Number(v||0); return Number.isFinite(n)?n:0; }

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
    if(link&&/mypcards\.com/i.test(link)){
      q.set("link",link);
      if(!fast)q.set("directBrowser","1");
    }
  }
  const controller=new AbortController();
  // Cartas sem link conhecido podem precisar do Actor (até ~55 s).
  // Só esse caminho ganha orçamento maior; links conhecidos continuam rápidos.
  const timeoutMs=fast?15000:(base===MYP_API&&!allowSavedLink?60000:38000);
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const rr=await fetch(base+"?"+q.toString(),{
      headers:{"Accept":"application/json","User-Agent":"PokemonBinderBR-PriceWorker/14.87"},
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
            headers:{"Accept":"application/json","User-Agent":"PokemonBinderBR-PriceWorker/14.87"},
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

    // Só aprende uma sequência quando várias páginas já validadas concordam.
    // Isso evita extrapolar coleções cujo ID da MYP não seja sequencial.
    if(bestCount>=5&&bestCount>=Math.ceil(usable*.72)){
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

function hasMarketPrice(m:any){return !!(m&&(num(m.min)||num(m.avg)||num(m.max)))}
function choosePrimary(liga:any,myp:any){
  if(hasMarketPrice(liga)&&num(liga.avg)>0)return{market:liga,source:"Liga Pokémon"};
  if(hasMarketPrice(myp)&&num(myp.avg)>0)return{market:myp,source:"MYP Cards"};
  if(hasMarketPrice(liga))return{market:liga,source:"Liga Pokémon"};
  if(hasMarketPrice(myp))return{market:myp,source:"MYP Cards"};
  return{market:null,source:"Sem preço BR"};
}
async function fetchMarkets(card:any){
  const hasMypLink=[card.myp_price_link,card.price_br_link,card.price_link]
    .map((v:any)=>String(v||"").trim()).some((v:string)=>/mypcards\.com/i.test(v));

  const ligaPromise=fetchSource(LIGA_API,card,false)
    .catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"timeout":String(e?.message||"liga_error")}));

  let myp:any;
  if(hasMypLink){
    // Link conhecido = leia a própria página primeiro. A rota fast percorre
    // também as páginas de vendedores da MYP e evita gastar 58 s redescobrindo
    // uma carta que já foi identificada por outra variante do mesmo número.
    myp=await fetchSource(MYP_API,card,true,true)
      .catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"fast_timeout":String(e?.message||"myp_error")}));
    console.log("[MYP_FAST]",String(card.id||""),String(card.number||""),String(card.finish||""),JSON.stringify({ok:myp?.ok,error:myp?.error,min:myp?.min,avg:myp?.avg,max:myp?.max,link:myp?.link,provider:myp?.provider,mode:myp?.mode,identity:myp?.identity}));

    if(!hasMarketPrice(myp)){
      const fastError=String(myp?.error||"");
      const needsHeavyFallback=["fast_timeout","fast_unavailable","fast_no_price","wrong_product","product_not_found","variant_not_found","no_price_data"].includes(fastError);
      if(needsHeavyFallback){
        myp=await fetchSource(MYP_API,card,true,false)
          .catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"timeout":String(e?.message||"myp_error")}));
        console.log("[MYP_FULL]",String(card.id||""),String(card.number||""),String(card.finish||""),JSON.stringify({ok:myp?.ok,error:myp?.error,min:myp?.min,avg:myp?.avg,max:myp?.max,link:myp?.link,provider:myp?.provider,mode:myp?.mode}));
      }
    }
  }else{
    myp=await fetchSource(MYP_API,card,false,false)
      .catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"timeout":String(e?.message||"myp_error")}));
  }

  // A MYP nem sempre rotula Reverse/Foil nas ofertas da mesma impressão.
  // Com produto conhecido, tente o mercado padrão da MESMA página: primeiro
  // Reader rápido; se falhar, faça a consulta completa antes de desistir.
  if(!hasMarketPrice(myp)&&hasMypLink&&String(card.finish||"Normal").toLowerCase()!=="normal"){
    const err=String(myp?.error||"");
    if(["variant_not_found","no_price_data","browser_error","fast_no_price","timeout","fast_timeout","fast_unavailable"].includes(err)){
      const genericCard={...card,finish:"Normal"};
      let generic=await fetchSource(MYP_API,genericCard,true,true)
        .catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"fast_timeout":String(e?.message||"myp_generic_error")}));
      if(!hasMarketPrice(generic)){
        generic=await fetchSource(MYP_API,genericCard,true,false)
          .catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"timeout":String(e?.message||"myp_generic_error")}));
      }
      if(hasMarketPrice(generic)){
        myp={
          ...generic,
          requestedFinish:String(card.finish||""),
          variantFallback:true,
          exactVariant:false,
          mode:String(generic.mode||"")+"-same-product-fallback"
        };
        console.log("[MYP_VARIANT_FALLBACK]",String(card.id||""),String(card.number||""),String(card.finish||""),JSON.stringify({min:myp?.min,avg:myp?.avg,max:myp?.max,link:myp?.link}));
      }
    }
  }

  const liga=await ligaPromise;
  if(["wrong_product","product_not_found","not_found","variant_not_found","browser_error","timeout"].includes(String(myp?.error||""))&&hasMypLink){
    // Link aprendido/salvo pode ter ID correto e slug inválido. Refazer sem
    // enviar o link força a API a localizar o produto por número + coleção.
    myp=await fetchSource(MYP_API,{...card,myp_price_link:null,price_br_link:null,price_link:null},false,false)
      .catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"timeout":String(e?.message||"myp_error")}));
  }
  return{myp,liga};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);

  const url=Deno.env.get("SUPABASE_URL");
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return json({ok:false,error:"missing_supabase_env"},500);
  const db=createClient(url,service,{auth:{persistSession:false}});

  const now=new Date();
  const nowIso=now.toISOString();
  const staleIso=new Date(now.getTime()-STALE_MS).toISOString();

  const {data:candidates,error:listError}=await db.from("pokemon_cards")
    .select("id,user_id,name,number,set_name,set_id,api_id,language_code,finish,condition,liga_price_link,myp_price_link,price_br_link,price_link,price_attempts,price_pending,price_processing_at,price_priority")
    .eq("price_pending",true)
    .lte("price_next_retry_at",nowIso)
    .or("price_processing_at.is.null,price_processing_at.lt."+staleIso)
    .order("price_priority",{ascending:false})
    .order("price_requested_at",{ascending:true})
    .limit(BATCH);

  if(listError)return json({ok:false,error:"list_failed"},500);
  if(!candidates?.length)return json({ok:true,claimed:0,updated:0,retried:0,terminal:0});

  let claimed=0,updated=0,retried=0,terminal=0;
  const results=await Promise.allSettled(candidates.map(async(card:any)=>{
    const attempts=(Number(card.price_attempts)||0)+1;
    let claim=db.from("pokemon_cards")
      .update({price_processing_at:nowIso,price_attempts:attempts,price_last_error:null})
      .eq("id",card.id)
      .eq("price_pending",true);
    if(card.price_processing_at)claim=claim.eq("price_processing_at",card.price_processing_at);
    else claim=claim.is("price_processing_at",null);
    const {data:claimedRows,error:claimError}=await claim.select("id").limit(1);
    if(claimError||!claimedRows?.length)return {state:"skipped"};
    claimed++;

    try{
      // Se a coleção já possui várias páginas MYP validadas com uma sequência
      // consistente, aprenda o padrão automaticamente e use-o como candidato.
      // A API ainda valida a página real antes de aceitar qualquer preço.
      let fetchCard=card;
      const existingMyp=[
        card.myp_price_link,card.price_br_link,card.price_link
      ].map((v:any)=>String(v||"").trim()).find((v:string)=>/mypcards\.com/i.test(v))||"";
      let learnedLink="";
      let siblingLink="";
      if(!existingMyp){
        siblingLink=await siblingMypLink(db,card).catch(()=> "");
        if(siblingLink){
          // Mesmo produto / mesma coleção / mesmo número: preserve o link
          // aprendido pela variante irmã, ainda que a leitura de preço falhe.
          await db.from("pokemon_cards")
            .update({myp_price_link:siblingLink})
            .eq("id",card.id);
          fetchCard={...card,myp_price_link:siblingLink};
        }else{
          learnedLink=await learnedMypLink(db,card).catch(()=> "");
          if(learnedLink){
            // A sequência só é aceita quando várias páginas validadas concordam.
            // A API ainda valida a página real antes de aceitar qualquer preço.
            await db.from("pokemon_cards")
              .update({myp_price_link:learnedLink})
              .eq("id",card.id);
            fetchCard={...card,myp_price_link:learnedLink};
          }
        }
      }

      const markets=await fetchMarkets(fetchCard);
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
          price_next_retry_at:null,price_priority:0,price_last_error:null
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

        const {error}=await db.from("pokemon_cards").update(patch).eq("id",card.id);
        if(error)throw error;
        updated++;
        return {state:"updated",source:picked.source};
      }

      const ligaError=String(liga?.error||"").trim();
      const mypError=String(myp?.error||"").trim();
      const errors=[mypError,ligaError].filter(Boolean);
      // MYP é a fonte principal para identidade/variante; não deixe um
      // "not_found" da Liga esconder o erro real da MYP.
      const errorCode=mypError||ligaError||"no_price_data";
      const errorDetail=[
        mypError?"myp:"+mypError:"",
        ligaError?"liga:"+ligaError:""
      ].filter(Boolean).join("|")||errorCode;
      const allTerminal=errors.length>0&&errors.every(e=>TERMINAL.has(e));

      if(allTerminal){
        const clearIdentity=["wrong_product","product_not_found"].includes(mypError);
        const patch:any={
          price_pending:false,price_processing_at:null,price_next_retry_at:null,
          price_priority:0,price_last_error:errorDetail
        };
        if(clearIdentity)patch.myp_price_link=null;
        const {error}=await db.from("pokemon_cards").update(patch).eq("id",card.id);
        if(error)throw error;
        terminal++;
        return {state:"terminal"};
      }

      if(attempts>=RETRY_LIMIT){
        const {error}=await db.from("pokemon_cards").update({
          price_pending:false,price_processing_at:null,price_next_retry_at:null,
          price_priority:0,price_last_error:errorDetail||errorCode||"retry_limit"
        }).eq("id",card.id);
        if(error)throw error;
        terminal++;
        return {state:"retry_limit"};
      }

      // Fila rápida: 30 s na primeira falha, 60 s na segunda.
      // O cron roda a cada minuto, então isso evita buracos de 2–4 minutos.
      const delaySeconds=attempts<=1?30:60;
      const retryAt=new Date(Date.now()+delaySeconds*1000).toISOString();
      const {error}=await db.from("pokemon_cards").update({
        price_pending:true,price_processing_at:null,price_next_retry_at:retryAt,
        price_last_error:errorDetail||errorCode||"temporary_error"
      }).eq("id",card.id);
      if(error)throw error;
      retried++;
      return {state:"retry"};
    }catch(error:any){
      const message=error?.name==="AbortError"?"timeout":String(error?.message||error||"worker_error");
      if(attempts>=RETRY_LIMIT){
        await db.from("pokemon_cards").update({
          price_pending:false,price_processing_at:null,price_next_retry_at:null,
          price_priority:0,price_last_error:message
        }).eq("id",card.id);
        terminal++;
        return {state:"retry_limit"};
      }
      const retryAt=new Date(Date.now()+(attempts<=1?30:60)*1000).toISOString();
      await db.from("pokemon_cards").update({
        price_pending:true,price_processing_at:null,price_next_retry_at:retryAt,
        price_last_error:message
      }).eq("id",card.id);
      retried++;
      return {state:"retry"};
    }
  }));

  return json({ok:true,claimed,updated,retried,terminal,results:results.map(r=>r.status==="fulfilled"?r.value?.state:"rejected")});
});
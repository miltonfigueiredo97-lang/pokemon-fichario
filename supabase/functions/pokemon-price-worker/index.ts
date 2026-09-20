import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MYP_API = "https://pokemon-fichario.vercel.app/api/mypcards-public";
const LIGA_API = "https://pokemon-fichario.vercel.app/api/liga-public";
const BATCH = 3;
const STALE_MS = 5 * 60 * 1000;
const TERMINAL = new Set(["variant_not_found","wrong_product","product_not_found","no_price_data"]);

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
function json(data: unknown, status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Connection":"keep-alive",...CORS}});
}
function num(v: unknown){ const n=Number(v||0); return Number.isFinite(n)?n:0; }

async function fetchSource(base:string, card:any, allowSavedLink=true){
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
  if(base===MYP_API&&allowSavedLink){
    const link=String(card.myp_price_link||card.price_br_link||card.price_link||"").trim();
    if(link&&/mypcards\.com/i.test(link))q.set("link",link);
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),58000);
  try{
    const rr=await fetch(base+"?"+q.toString(),{
      headers:{"Accept":"application/json","User-Agent":"PokemonBinderBR-PriceWorker/14.42"},
      signal:controller.signal
    });
    const body=await rr.text();
    let data:any={};
    try{data=JSON.parse(body)}catch{}
    if(!rr.ok)throw new Error("price_api_http_"+rr.status);
    return data;
  }finally{clearTimeout(timer)}
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
  let [myp,liga]=await Promise.all([
    fetchSource(MYP_API,card,true).catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"timeout":String(e?.message||"myp_error")})),
    fetchSource(LIGA_API,card,false).catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"timeout":String(e?.message||"liga_error")}))
  ]);
  if(myp?.error==="wrong_product"&&String(card.myp_price_link||card.price_br_link||card.price_link||"").trim()){
    myp=await fetchSource(MYP_API,card,false).catch((e:any)=>({ok:false,error:e?.name==="AbortError"?"timeout":String(e?.message||"myp_error")}));
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
      const markets=await fetchMarkets(card);
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

      const errors=[String(liga?.error||""),String(myp?.error||"")].filter(Boolean);
      const errorCode=errors.find(e=>!TERMINAL.has(e))||errors[0]||"no_price_data";
      const allTerminal=errors.length>0&&errors.every(e=>TERMINAL.has(e));

      if(allTerminal){
        const clearIdentity=["wrong_product","product_not_found"].includes(String(myp?.error||""));
        const patch:any={
          price_pending:false,price_processing_at:null,price_next_retry_at:null,
          price_priority:0,price_last_error:errorCode
        };
        if(clearIdentity)patch.myp_price_link=null;
        const {error}=await db.from("pokemon_cards").update(patch).eq("id",card.id);
        if(error)throw error;
        terminal++;
        return {state:"terminal"};
      }

      if(attempts>=6){
        const {error}=await db.from("pokemon_cards").update({
          price_pending:false,price_processing_at:null,price_next_retry_at:null,
          price_priority:0,price_last_error:errorCode||"retry_limit"
        }).eq("id",card.id);
        if(error)throw error;
        terminal++;
        return {state:"retry_limit"};
      }

      const delayMinutes=Math.min(30,Math.pow(2,Math.min(attempts,4)));
      const retryAt=new Date(Date.now()+delayMinutes*60_000).toISOString();
      const {error}=await db.from("pokemon_cards").update({
        price_pending:true,price_processing_at:null,price_next_retry_at:retryAt,
        price_last_error:errorCode||"temporary_error"
      }).eq("id",card.id);
      if(error)throw error;
      retried++;
      return {state:"retry"};
    }catch(error:any){
      const message=error?.name==="AbortError"?"timeout":String(error?.message||error||"worker_error");
      if(attempts>=6){
        await db.from("pokemon_cards").update({
          price_pending:false,price_processing_at:null,price_next_retry_at:null,
          price_priority:0,price_last_error:message
        }).eq("id",card.id);
        terminal++;
        return {state:"retry_limit"};
      }
      const retryAt=new Date(Date.now()+Math.min(30,Math.pow(2,Math.min(attempts,4)))*60_000).toISOString();
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
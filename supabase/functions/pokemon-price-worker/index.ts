import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRICE_API = "https://pokemon-fichario.vercel.app/api/mypcards-public";
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

async function fetchPrice(card: any){
  const q=new URLSearchParams({
    name:String(card.name||""),
    number:String(card.number||""),
    set:String(card.set_name||""),
    setId:String(card.set_id||""),
    lang:String(card.language_code||""),
    finish:String(card.finish||"Normal"),
    condition:String(card.condition||"Nova")
  });
  const link=String(card.myp_price_link||card.price_br_link||card.price_link||"").trim();
  if(link)q.set("link",link);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const r=await fetch(PRICE_API+"?"+q.toString(),{
      headers:{"Accept":"application/json","User-Agent":"PokemonBinderBR-PriceWorker/14.8"},
      signal:controller.signal
    });
    const text=await r.text();
    let data:any={};
    try{data=JSON.parse(text)}catch{}
    if(!r.ok)throw new Error("price_api_http_"+r.status);
    return data;
  }finally{clearTimeout(timer)}
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
    .select("id,user_id,name,number,set_name,set_id,language_code,finish,condition,myp_price_link,price_br_link,price_link,price_attempts,price_pending,price_processing_at")
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
      const market=await fetchPrice(card);
      const min=num(market?.min),avg=num(market?.avg),max=num(market?.max);
      const hasPrice=!!(min||avg||max);
      const checkedAt=String(market?.checkedAt||new Date().toISOString());
      const resolvedLink=String(market?.link||card.myp_price_link||card.price_br_link||card.price_link||"");

      if(market?.ok&&hasPrice){
        const patch:any={
          myp_price_min:min,myp_price_avg:avg,myp_price_max:max,
          myp_price_link:resolvedLink||null,myp_price_checked_at:checkedAt,
          price_min:min,price_avg:avg||min||max,price_max:max,currency:"BRL",
          price_source:"MYP Cards",price_link:resolvedLink||"",
          price_br_source:"MYP Cards",price_br_link:resolvedLink||null,
          price_checked_at:checkedAt,price_pending:false,price_processing_at:null,
          price_next_retry_at:null,price_priority:0,price_last_error:null
        };
        const {error}=await db.from("pokemon_cards").update(patch).eq("id",card.id);
        if(error)throw error;
        updated++;
        return {state:"updated"};
      }

      const errorCode=String(market?.error||"no_price_data");
      if(TERMINAL.has(errorCode)){
        const {error}=await db.from("pokemon_cards").update({
          price_pending:false,price_processing_at:null,price_next_retry_at:null,
          price_priority:0,price_last_error:errorCode
        }).eq("id",card.id);
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
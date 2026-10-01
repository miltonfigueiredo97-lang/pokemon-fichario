'use strict';
// Monthly budget for the functions that open Chromium (see migration
// 202610011000_engine_usage_budget.sql). check() before launching a browser;
// record() after it closed. When the month reaches the cap (half of the free
// Hobby allowance), check() says no and the caller returns "budget_exhausted".
//
// CPU is measured from /proc (this process + reaped children, i.e. Chromium
// after browser.close()) with a 20% margin; wall time is the fallback. Memory
// is wall time x the function's memory size.

const fs=require('fs');

const SUPABASE_URL='https://ryylegveltrypqclimqo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_Ved1tXBXQN1zofbJj3uPzQ_MqHxIEGw';
const MEMORY_GB=Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE||2048)/1024;

function cpuTicks(){
  try{
    const stat=fs.readFileSync('/proc/self/stat','utf8');
    const f=stat.slice(stat.lastIndexOf(')')+2).split(' ');
    // utime, stime, cutime, cstime (fields 14-17; index 11-14 after the name)
    return Number(f[11])+Number(f[12])+Number(f[13])+Number(f[14]);
  }catch{return null}
}

async function rpc(cpuMs,memGbS){
  const key=process.env.PRICE_ENGINE_SECRET||'';
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/engine_budget',{
      method:'POST',signal:controller.signal,
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({p_key:key,p_cpu_ms:Math.round(cpuMs),p_mem_gb_s:Math.round(memGbS*1000)/1000})
    });
    return r.ok?await r.json():null;
  }catch{return null}finally{clearTimeout(timer)}
}

// Fails closed: if the budget cannot be read, no browser is opened.
async function check(){
  // The PC reader uses the user's own machine: nothing to budget.
  if(process.env.PF_LOCAL_READER)return{allowed:true,state:{local:true}};
  const state=await rpc(0,0);
  return{allowed:!!state?.allowed,state};
}

function start(){
  return{at:Date.now(),ticks:cpuTicks()};
}

async function record(mark){
  if(process.env.PF_LOCAL_READER)return{local:true};
  const wallMs=Date.now()-mark.at;
  const end=cpuTicks();
  const measured=mark.ticks!=null&&end!=null?(end-mark.ticks)*10*1.2:null;
  const cpuMs=Math.max(1,measured!=null&&measured>0?measured:wallMs);
  const memGbS=wallMs/1000*MEMORY_GB;
  const state=await rpc(cpuMs,memGbS);
  return{cpuMs:Math.round(cpuMs),wallMs,memGbS:Math.round(memGbS*10)/10,month:state};
}

module.exports={check,start,record};

// Wraps a whole handler that may open Chromium.
function withBudget(handler){
  return async(req,res)=>{
    const allowance=await check();
    if(!allowance.allowed){
      res.setHeader('Cache-Control','no-store, max-age=0');
      return res.status(200).json({ok:false,blocked:true,error:'budget_exhausted'});
    }
    const mark=start();
    try{return await handler(req,res)}
    finally{await record(mark).catch(()=>{})}
  };
}

module.exports.withBudget=withBudget;

'use strict';
// Pokémon Fichário price reader for the user's PCs.
//
// The price worker and the catalog search (Supabase) leave MYP read requests
// in engine_requests. This program claims them, runs the same price engine as
// the old Vercel function (api/price-engine.js) with the installed Edge or
// Chrome, and writes the answers back. Any number of PCs can run it; the
// database hands each request to one of them.
//
// Build: node reader/build.mjs  ->  dist/pokemon-reader.exe

const os=require('os');
const fs=require('fs');
const path=require('path');
const net=require('net');

const SUPABASE_URL='https://ryylegveltrypqclimqo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_Ved1tXBXQN1zofbJj3uPzQ_MqHxIEGw';
const VERSION='1.0.0';
const CONCURRENCY=3;
const IDLE_POLL_MS=2000;
const LOCK_PORT=47321;

function readerKey(){
  if(process.env.PF_READER_KEY)return process.env.PF_READER_KEY.trim();
  try{return require('./key.generated.js')}catch{}
  const nextToExe=path.join(path.dirname(process.execPath),'reader-key.txt');
  try{return fs.readFileSync(nextToExe,'utf8').trim()}catch{}
  return '';
}

function findBrowser(){
  const env=process.env;
  const candidates=[
    env.PF_BROWSER_PATH,
    path.join(env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(env.ProgramFiles||'C:\\Program Files','Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(env.ProgramFiles||'C:\\Program Files','Google\\Chrome\\Application\\chrome.exe'),
    path.join(env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Google\\Chrome\\Application\\chrome.exe'),
    env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge','/usr/bin/google-chrome','/usr/bin/chromium'
  ].filter(Boolean);
  return candidates.find(p=>{try{return fs.statSync(p).isFile()}catch{return false}})||'';
}

const stamp=()=>new Date().toLocaleTimeString('pt-BR');
const log=(...a)=>console.log(`[${stamp()}]`,...a);

async function rpc(name,args){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{
    method:'POST',
    headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify(args)
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`${name} ${r.status}: ${text.slice(0,160)}`);
  return text?JSON.parse(text):null;
}

// Runs api/price-engine.js as Vercel would, collecting its JSON answer.
function runEngine(handler,params){
  return new Promise(resolve=>{
    const res={
      statusCode:200,
      status(c){res.statusCode=c;return res},
      setHeader(){return res},
      json(obj){resolve(obj);return res},
      send(obj){resolve(typeof obj==='object'?obj:{ok:false,error:'bad_answer'});return res},
      end(){resolve({ok:false,error:'empty_answer',status:res.statusCode});return res}
    };
    const query={};
    for(const [k,v] of Object.entries(params||{}))query[k]=String(v??'');
    Promise.resolve(handler({method:'GET',query,headers:{}},res))
      .catch(e=>resolve({ok:false,error:'engine_error',message:String(e?.message||e).slice(0,200)}));
  });
}

function singleInstance(){
  return new Promise(resolve=>{
    const server=net.createServer();
    server.once('error',()=>resolve(false));
    server.listen(LOCK_PORT,'127.0.0.1',()=>resolve(true));
  });
}

async function main(){
  console.log(`Pokémon Fichário - leitor de preços v${VERSION}`);
  if(!await singleInstance()){
    log('Já existe um leitor aberto neste PC. Pode fechar esta janela.');
    return setTimeout(()=>process.exit(0),8000);
  }
  const key=readerKey();
  if(!key){log('Chave do leitor não encontrada (reader-key.txt).');return setTimeout(()=>process.exit(1),15000)}
  const browser=findBrowser();
  if(!browser){log('Nem o Edge nem o Chrome foram encontrados neste PC.');return setTimeout(()=>process.exit(1),15000)}
  process.env.PF_BROWSER_PATH=browser;
  process.env.PF_LOCAL_READER='1';
  delete process.env.PRICE_ENGINE_SECRET;
  const handler=require('../api/price-engine.js');
  const readerId=(os.hostname()||'pc').slice(0,60);
  log(`Navegador: ${browser}`);
  log(`Leitor "${readerId}" ligado. Deixe esta janela aberta (pode minimizar).`);

  let inflight=0,done=0,failures=0;
  const info={version:VERSION,platform:process.platform};
  const handle=async job=>{
    inflight++;
    const started=Date.now();
    const p=job.params||{};
    const label=p.searchQuery?`busca "${p.searchQuery}"`:p.apiName?`catálogo "${p.apiName}"`:`${p.name||''} ${p.number||''}`.trim();
    try{
      const answer=await runEngine(handler,p);
      await rpc('engine_respond',{p_key:key,p_id:job.id,p_response:answer});
      done++;
      const price=answer?.myp?.ok?` · R$ ${Number(answer.myp.avg||answer.myp.min||0).toFixed(2)}`:'';
      log(`${answer?.ok?'ok ':'-- '} ${label}${price} (${((Date.now()-started)/1000).toFixed(1)} s)`);
    }catch(e){
      log(`erro ${label}: ${String(e?.message||e).slice(0,160)}`);
    }finally{inflight--}
  };

  for(;;){
    let jobs=[];
    try{
      const free=CONCURRENCY-inflight;
      jobs=free>0?await rpc('engine_claim',{p_key:key,p_reader:readerId,p_limit:free,p_info:{...info,done}}):[];
      failures=0;
    }catch(e){
      failures++;
      if(failures===1||failures%30===0)log(`Sem conexão com o banco (${String(e?.message||e).slice(0,100)}). Tentando de novo...`);
    }
    for(const job of jobs||[])handle(job);
    await new Promise(r=>setTimeout(r,(jobs&&jobs.length)?300:IDLE_POLL_MS));
  }
}

main();

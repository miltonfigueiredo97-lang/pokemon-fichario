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
const VERSION='1.1.0';
const CONCURRENCY=3;
// Idle polling is light on Supabase egress: 4 s, then 10 s after 5 idle minutes
// (the worker treats a reader as online for 45 s after its last poll).
const IDLE_POLL_MS=4000;
const SLOW_POLL_MS=10000;
const LOCK_PORT=47321;
// The engine (api/price-engine.js + lib) is also published as one file in the
// repository; the reader picks up new versions by itself every 20 minutes, so
// engine fixes reach every PC without reinstalling the exe.
const ENGINE_URL='https://raw.githubusercontent.com/miltonfigueiredo97-lang/pokemon-fichario/main/reader/engine.bundle.cjs';
const ENGINE_REFRESH_MS=20*60000;

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
  return [...new Set(candidates.filter(p=>{try{return fs.statSync(p).isFile()}catch{return false}}))];
}

const stamp=()=>new Date().toLocaleString('pt-BR');
// Console + LOCALAPPDATA/PokemonFichario/reader.log (last ~1 MB), so a
// reader that stopped can be diagnosed later.
const LOG_FILE=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'PokemonFichario','reader.log');
function log(...a){
  const line=`[${stamp()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');
  console.log(line);
  try{
    fs.mkdirSync(path.dirname(LOG_FILE),{recursive:true});
    if(fs.existsSync(LOG_FILE)&&fs.statSync(LOG_FILE).size>1048576)fs.renameSync(LOG_FILE,LOG_FILE+'.old');
    fs.appendFileSync(LOG_FILE,line+'\n');
  }catch{}
}
// One bad page (or a browser that refuses to start) must never stop the reader.
process.on('uncaughtException',e=>log('erro inesperado (seguindo):',String(e?.stack||e).slice(0,300)));
process.on('unhandledRejection',e=>log('erro inesperado (seguindo):',String(e?.stack||e).slice(0,300)));
process.on('exit',code=>log('leitor encerrado, código',code));
for(const sig of ['SIGINT','SIGTERM','SIGHUP','SIGBREAK'])process.on(sig,()=>{log('leitor fechado ('+sig+')');process.exit(0)});

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

// Windows .exe opened from anywhere (Drive, Downloads): copy it to
// LOCALAPPDATA/PokemonFichario, start it with Windows hidden (a .vbs launcher
// in the user's Startup folder, no window that could be closed by accident)
// and run that copy in the background. Opening the exe again installs the
// newer version over the running one.
function installOnWindows(){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA||process.env.PF_NO_INSTALL)return false;
  if(!/pokemon-reader\.exe$/i.test(process.execPath))return false;
  const cp=require('child_process');
  const dir=path.join(process.env.LOCALAPPDATA,'PokemonFichario');
  const target=path.join(dir,'pokemon-reader.exe');
  const startupDir=path.join(process.env.APPDATA||'','Microsoft','Windows','Start Menu','Programs','Startup');
  const launcher=path.join(startupDir,'Pokemon Fichario - leitor de precos.vbs');
  const oldShortcut=path.join(startupDir,'Pokemon Fichario - leitor de precos.lnk');
  const here=path.resolve(process.execPath).toLowerCase();
  if(here===target.toLowerCase())return false;
  try{
    fs.mkdirSync(dir,{recursive:true});
    try{fs.copyFileSync(process.execPath,target)}
    catch(e){
      // The installed copy is running: stop it and copy the new version.
      try{cp.execFileSync('taskkill.exe',['/F','/IM','pokemon-reader.exe','/FI','PID ne '+process.pid],{stdio:'ignore'})}catch{}
      let copied=false;
      for(let i=0;i<10&&!copied;i++){try{fs.copyFileSync(process.execPath,target);copied=true}catch{cp.execFileSync('cmd.exe',['/c','timeout /t 1 >nul'],{stdio:'ignore'})}}
      if(!copied&&!fs.existsSync(target))throw e;
    }
    fs.mkdirSync(startupDir,{recursive:true});
    fs.writeFileSync(launcher,'CreateObject("WScript.Shell").Run """'+target+'""", 0, False\r\n','latin1');
    try{fs.unlinkSync(oldShortcut)}catch{}
    cp.spawn(target,[],{detached:true,stdio:'ignore',cwd:dir,windowsHide:true}).unref();
    console.log('Leitor de preços instalado e rodando em segundo plano.');
    console.log('Ele liga sozinho sempre que você entrar no Windows. Pode fechar esta janela.');
    setTimeout(()=>process.exit(0),8000);
    return true;
  }catch(e){console.log('Não foi possível instalar ('+String(e?.message||e).slice(0,120)+'); rodando daqui mesmo.')}
  return false;
}

async function main(){
  console.log(`Pokémon Fichário - leitor de preços v${VERSION}`);
  if(installOnWindows())return;
  if(!await singleInstance()){
    log('Já existe um leitor aberto neste PC. Pode fechar esta janela.');
    return setTimeout(()=>process.exit(0),8000);
  }
  const key=readerKey();
  if(!key){log('Chave do leitor não encontrada (reader-key.txt).');return setTimeout(()=>process.exit(1),15000)}
  const browsers=findBrowser();
  const browser=browsers[0]||'';
  if(!browser){log('Nem o Edge nem o Chrome foram encontrados neste PC.');return setTimeout(()=>process.exit(1),15000)}
  process.env.PF_BROWSER_PATH=browser;
  process.env.PF_BROWSER_FALLBACKS=browsers.slice(1).join('|');
  process.env.PF_LOCAL_READER='1';
  delete process.env.PRICE_ENGINE_SECRET;
  let handler=require('../api/price-engine.js');
  let engineHash='bundled';
  const cacheDir=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'PokemonFichario');
  const cacheFile=path.join(cacheDir,'engine.bundle.cjs');
  const compile=code=>{
    const puppeteer=require('puppeteer-core');
    const shim=name=>name==='puppeteer-core'?puppeteer:require(name);
    const mod={exports:{}};
    new Function('require','module','exports','__filename','__dirname',code)(shim,mod,mod.exports,cacheFile,cacheDir);
    if(typeof mod.exports!=='function')throw new Error('engine bundle without handler');
    return mod.exports;
  };
  const hashOf=code=>require('crypto').createHash('sha256').update(code).digest('hex').slice(0,12);
  const useEngine=(code,from)=>{
    const h=hashOf(code);
    if(h===engineHash)return;
    handler=compile(code);engineHash=h;
    log(`Motor de leitura atualizado (${from}, ${h}).`);
  };
  try{useEngine(fs.readFileSync(cacheFile,'utf8'),'cópia local')}catch{}
  const refreshEngine=async()=>{
    try{
      const r=await fetch(ENGINE_URL+'?t='+Date.now(),{cache:'no-store'});
      if(!r.ok)return;
      const code=await r.text();
      if(!/module.exports/.test(code))return;
      useEngine(code,'GitHub');
      try{fs.mkdirSync(cacheDir,{recursive:true});fs.writeFileSync(cacheFile,code)}catch{}
    }catch(e){log('Motor novo não carregado: '+String(e?.message||e).slice(0,100))}
  };
  await refreshEngine();
  setInterval(refreshEngine,ENGINE_REFRESH_MS);
  const readerId=(os.hostname()||'pc').slice(0,60);
  log(`Navegador: ${browser}`);
  log(`Leitor "${readerId}" ligado. Deixe esta janela aberta (pode minimizar).`);

  let inflight=0,done=0,failures=0,lastWork=Date.now();
  const info={version:VERSION,platform:process.platform};
  Object.defineProperty(info,'engine',{enumerable:true,get:()=>engineHash});
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
    if((jobs&&jobs.length)||inflight)lastWork=Date.now();
    const wait=(jobs&&jobs.length)?300:Date.now()-lastWork>5*60000?SLOW_POLL_MS:IDLE_POLL_MS;
    await new Promise(r=>setTimeout(r,wait));
  }
}

main();

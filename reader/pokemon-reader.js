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
const VERSION='1.3.0';
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

// The reader's key: a reader token made on the site ("Ligar leitor neste
// PC", saved in token.txt by the pokemonreader:// link) or, for old builds,
// the engine secret. Read again on every poll, so pairing works while the
// reader is already running.
const DATA_DIR=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'PokemonFichario');
const TOKEN_FILE=path.join(DATA_DIR,'token.txt');
function readerKey(){
  if(process.env.PF_READER_KEY)return process.env.PF_READER_KEY.trim();
  try{const t=fs.readFileSync(TOKEN_FILE,'utf8').trim();if(t)return t}catch{}
  try{const k=require('./key.generated.js');if(k)return k}catch{}
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
const LOG_FILE=path.join(DATA_DIR,'reader.log');
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
let quietExit=false;
process.on('exit',code=>{if(!quietExit)log('leitor encerrado, código',code)});
for(const sig of ['SIGINT','SIGTERM','SIGHUP','SIGBREAK'])process.on(sig,()=>{log('leitor fechado ('+sig+')');process.exit(0)});

// Every database call has a deadline: after sleep or a network drop a request
// can otherwise hang forever and the reader looks "off" while still open.
async function rpc(name,args){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{
      method:'POST',signal:controller.signal,
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify(args)
    });
    const text=await r.text();
    if(!r.ok)throw new Error(`${name} ${r.status}: ${text.slice(0,160)}`);
    return text?JSON.parse(text):null;
  }finally{clearTimeout(timer)}
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
const WIN_DIR=DATA_DIR;
const WIN_TARGET=path.join(WIN_DIR,'pokemon-reader.exe');
const STARTUP_DIR=path.join(process.env.APPDATA||'','Microsoft','Windows','Start Menu','Programs','Startup');
const LAUNCHER=path.join(STARTUP_DIR,'Pokemon Fichario - leitor de precos.vbs');
const OPENER=path.join(WIN_DIR,'abrir-leitor.vbs');
const TASK_NAME='Pokemon Fichario - leitor de precos';
const SITE_PAIR_URL='https://miltonfigueiredo97-lang.github.io/pokemon-fichario/?leitor=conectar';
// Writes a helper file only when its content changed, through a temporary
// file, so a script started at that moment never finds it missing or half
// written.
function writeIfChanged(file,content,enc){
  try{if(fs.readFileSync(file,enc)===content)return}catch{}
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp,content,enc);
  fs.renameSync(tmp,file);
}

function launcherRunning(){
  try{
    const out=require('child_process').execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='wscript.exe'\" | Where-Object { $_.CommandLine -like '*leitor de precos.vbs*' }).Count"],{encoding:'utf8',windowsHide:true});
    return Number(String(out).trim())>0;
  }catch{return false}
}
// Starts the Startup launcher loop unless it is already running. Used by the
// scheduled task (at logon and every 5 min) and by the site's button.
function ensureLauncher(why){
  if(!fs.existsSync(LAUNCHER)||launcherRunning())return false;
  require('child_process').spawn('wscript.exe',['//B','//Nologo',LAUNCHER],{detached:true,stdio:'ignore',cwd:WIN_DIR,windowsHide:true}).unref();
  log('Leitor ligado ('+why+').');
  return true;
}
// pokemonreader://start?token=... (site button) or --ensure (scheduled task):
// save the token, make sure the reader runs, exit.
function handleCommand(){
  const link=process.argv.find(a=>/^pokemonreader:/i.test(a));
  if(!link&&!process.argv.includes('--ensure'))return false;
  if(link){
    try{
      const token=new URL(link).searchParams.get('token')||'';
      if(/^[0-9a-f]{32,128}$/i.test(token)){
        fs.mkdirSync(DATA_DIR,{recursive:true});
        const old=(()=>{try{return fs.readFileSync(TOKEN_FILE,'utf8').trim()}catch{return ''}})();
        if(old!==token){fs.writeFileSync(TOKEN_FILE,token);log('Leitor conectado à conta pelo site.')}
      }
    }catch(e){log('Link do site inválido: '+String(e?.message||e).slice(0,100))}
  }
  quietExit=true;
  ensureLauncher(link?'botão do site':'tarefa agendada');
  setTimeout(()=>process.exit(0),300);
  return true;
}

// The site button opens pokemonreader://...; Windows hands it to
// abrir-leitor.vbs, which runs the installed reader hidden with that link.
function registerProtocol(){
  const cp=require('child_process');
  fs.mkdirSync(WIN_DIR,{recursive:true});
  writeIfChanged(OPENER,['Set sh = CreateObject("WScript.Shell")','arg = ""','If WScript.Arguments.Count > 0 Then arg = " """ & WScript.Arguments(0) & """"','sh.Run """'+WIN_TARGET+'""" & arg, 0, False',''].join('\r\n'),'latin1');
  const key='HKCU\\Software\\Classes\\pokemonreader';
  const reg=args=>cp.execFileSync('reg.exe',args,{stdio:'ignore',windowsHide:true});
  reg(['add',key,'/ve','/d','URL:Pokemon Fichario - leitor de precos','/f']);
  reg(['add',key,'/v','URL Protocol','/d','','/f']);
  reg(['add',key+'\\shell\\open\\command','/ve','/d','wscript.exe //B //Nologo "'+OPENER+'" "%1"','/f']);
}
// Scheduled task: at logon and every 5 minutes, start the reader if it is not
// running (the Startup folder alone missed some logons). Runs on battery too,
// through abrir-leitor.vbs so no console window flashes.
function registerTask(){
  const cp=require('child_process');
  const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const user=(process.env.USERDOMAIN?process.env.USERDOMAIN+'\\':'')+(process.env.USERNAME||'');
  const d=new Date(Date.now()+60000),pad=n=>String(n).padStart(2,'0');
  const start=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())+':00';
  const xml=`<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Liga o leitor de precos do Pokemon Fichario se ele nao estiver rodando.</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>${esc(user)}</UserId><Delay>PT30S</Delay></LogonTrigger>
    <TimeTrigger><Enabled>true</Enabled><StartBoundary>${start}</StartBoundary><Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "${esc(OPENER)}" --ensure</Arguments></Exec></Actions>
</Task>`;
  const xmlFile=path.join(WIN_DIR,'tarefa.xml');
  fs.writeFileSync(xmlFile,Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(xml.replace(/\n/g,'\r\n'),'utf16le')]));
  try{cp.execFileSync('schtasks.exe',['/Create','/F','/TN',TASK_NAME,'/XML',xmlFile],{stdio:'ignore',windowsHide:true})}
  finally{try{fs.unlinkSync(xmlFile)}catch{}}
}

function installOnWindows(){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA||process.env.PF_NO_INSTALL)return false;
  if(!/pokemon-reader\.exe$/i.test(process.execPath))return false;
  const cp=require('child_process');
  const dir=WIN_DIR,target=WIN_TARGET,startupDir=STARTUP_DIR,launcher=LAUNCHER;
  const oldShortcut=path.join(startupDir,'Pokemon Fichario - leitor de precos.lnk');
  const here=path.resolve(process.execPath).toLowerCase();
  if(here===target.toLowerCase())return false;
  try{
    fs.mkdirSync(dir,{recursive:true});
    // Stop the running launcher loop first, so only one is left afterwards.
    try{cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process -Filter \"Name='wscript.exe'\" | Where-Object { $_.CommandLine -like '*leitor de precos.vbs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],{stdio:'ignore'})}catch{}
    try{fs.copyFileSync(process.execPath,target)}
    catch(e){
      // The installed copy is running: stop it and copy the new version.
      try{cp.execFileSync('taskkill.exe',['/F','/IM','pokemon-reader.exe','/FI','PID ne '+process.pid],{stdio:'ignore'})}catch{}
      let copied=false;
      for(let i=0;i<10&&!copied;i++){try{fs.copyFileSync(process.execPath,target);copied=true}catch{cp.execFileSync('cmd.exe',['/c','timeout /t 1 >nul'],{stdio:'ignore'})}}
      if(!copied&&!fs.existsSync(target))throw e;
    }
    fs.mkdirSync(startupDir,{recursive:true});
    // Keeps the reader running: when it exits (watchdog, crash), opens it
    // again after 15 s. A second copy exits at once (single instance).
    fs.writeFileSync(launcher,['Set sh = CreateObject("WScript.Shell")','Do','  sh.Run """'+target+'""", 0, True','  WScript.Sleep 15000','Loop',''].join('\r\n'),'latin1');
    try{fs.unlinkSync(oldShortcut)}catch{}
    try{registerProtocol()}catch(e){console.log('Aviso: botão do site não registrado ('+String(e?.message||e).slice(0,80)+').')}
    try{registerTask()}catch(e){console.log('Aviso: tarefa agendada não criada ('+String(e?.message||e).slice(0,80)+').')}
    cp.spawn('wscript.exe',['//B','//Nologo',launcher],{detached:true,stdio:'ignore',cwd:dir,windowsHide:true}).unref();
    console.log('Leitor de preços instalado e rodando em segundo plano.');
    console.log('Ele liga sozinho sempre que você entrar no Windows. Pode fechar esta janela.');
    if(!readerKey()){
      // First install: open the site, which connects this PC to the account
      // that is signed in there (pokemonreader://start?token=...).
      console.log('Abrindo o site para conectar o leitor à sua conta...');
      try{cp.spawn('cmd.exe',['/c','start','',SITE_PAIR_URL],{detached:true,stdio:'ignore',windowsHide:true}).unref()}catch{}
    }
    setTimeout(()=>process.exit(0),8000);
    return true;
  }catch(e){console.log('Não foi possível instalar ('+String(e?.message||e).slice(0,120)+'); rodando daqui mesmo.')}
  return false;
}

async function main(){
  if(handleCommand())return;
  console.log(`Pokémon Fichário - leitor de preços v${VERSION}`);
  if(installOnWindows())return;
  // Installed copy updated by an older version: add the site button and the task.
  if(process.platform==='win32'&&path.resolve(process.execPath).toLowerCase()===WIN_TARGET.toLowerCase()){
    try{registerProtocol()}catch{}
    try{require('child_process').execFileSync('schtasks.exe',['/Query','/TN',TASK_NAME],{stdio:'ignore',windowsHide:true})}catch{try{registerTask()}catch{}}
  }
  if(!await singleInstance()){
    log('Já existe um leitor aberto neste PC. Pode fechar esta janela.');
    return setTimeout(()=>process.exit(0),8000);
  }
  let key=readerKey();
  if(!key)log('Leitor sem conta: no site, clique em "Ligar leitor neste PC". Aguardando...');
  while(!key){await new Promise(r=>setTimeout(r,3000));key=readerKey()}
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
      // A page that never answers must not hold a slot forever.
      const answer=await Promise.race([
        runEngine(handler,p),
        new Promise(r=>setTimeout(()=>r({ok:false,error:'engine_timeout',message:'reader job timeout'}),90000))
      ]);
      await rpc('engine_respond',{p_key:key,p_id:job.id,p_response:answer});
      done++;
      const price=answer?.myp?.ok?` · R$ ${Number(answer.myp.avg||answer.myp.min||0).toFixed(2)}`:'';
      log(`${answer?.ok?'ok ':'-- '} ${label}${price} (${((Date.now()-started)/1000).toFixed(1)} s)`);
    }catch(e){
      log(`erro ${label}: ${String(e?.message||e).slice(0,160)}`);
    }finally{inflight--}
  };

  // Watchdog: if the loop stops turning (frozen request, suspended process),
  // exit; the Startup launcher opens the reader again in 15 s.
  let lastTurn=Date.now();
  setInterval(()=>{
    if(Date.now()-lastTurn>120000){log('Leitor travado há 2 min; reiniciando.');process.exit(3)}
  },30000).unref?.();
  for(;;){
    lastTurn=Date.now();
    key=readerKey()||key;
    let jobs=[];
    try{
      const free=CONCURRENCY-inflight;
      jobs=free>0?await rpc('engine_claim',{p_key:key,p_reader:readerId,p_limit:free,p_info:{...info,done}}):[];
      failures=0;
    }catch(e){
      failures++;
      if(/unauthorized/.test(String(e?.message))&&(failures===1||failures%30===0))log('Chave do leitor recusada: no site, clique em "Ligar leitor neste PC" de novo.');
      else if(failures===1||failures%30===0)log(`Sem conexão com o banco (${String(e?.message||e).slice(0,100)}). Tentando de novo...`);
    }
    for(const job of jobs||[])handle(job);
    if((jobs&&jobs.length)||inflight)lastWork=Date.now();
    const wait=(jobs&&jobs.length)?300:Date.now()-lastWork>5*60000?SLOW_POLL_MS:IDLE_POLL_MS;
    await new Promise(r=>setTimeout(r,wait));
  }
}

main();

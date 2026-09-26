// =============================================================
// POKÉMON BINDER BR — V4
// Supabase + TCGdex + MYP Cards + PWA + social + drag & drop
// =============================================================
const SUPABASE_URL="https://ryylegveltrypqclimqo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_Ved1tXBXQN1zofbJj3uPzQ_MqHxIEGw";
const TCGDEX_BASE="https://api.tcgdex.net/v2";
const db=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const LANG={"pt-br":"Português",en:"Inglês",ja:"Japonês"};
const STATUS={missing:"Não tenho",wanted:"Quero",owned:"Tenho",ordered:"Pedido"};
let currentUser=null,currentProfile=null,collection=[],currentPage=1,activeStatusFilter="all";
let settings={binder_name:"Meu Fichário",binder_pages:1,binder_background:"graphite",show_values:false,display_price_mode:"avg",total_price_mode:"avg",summary_value_scope:"all",binder_view_scope:"all"};
let selectedCard=null,selectedStatus="owned",selectedMarket=null,editingCardId=null,pendingPosition=null;
let friendships=[],profilesById=new Map(),catalogResults=[],catalogSelection=new Map(),contextCard=null,draggedCard=null,ocrLoaded=false;
let friendViewer={profile:null,binders:[],binderId:null,cards:[],page:1};
let catalogSearchSeq=0,catalogSearchTimer=null;
const catalogSearchCache=new Map();
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
const norm=v=>String(v??"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0));
function normalizedPriceMode(v){return["min","avg","max"].includes(v)?v:"avg"}
function priceModeLabel(v){return({min:"mínimo",avg:"médio",max:"máximo"})[normalizedPriceMode(v)]}
function priceModeValue(c,mode){return Number(c?.["price_"+normalizedPriceMode(mode)]||0)}
function currentPriceMode(){return normalizedPriceMode(settings.display_price_mode||settings.total_price_mode||"avg")}
function normalizeCollectorToken(v){
  const raw=String(v||"").trim().replace(/[^A-Za-z0-9]/g,"");
  if(!raw)return"";
  const m=raw.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  if(!m)return raw.toLowerCase();
  return (m[1]||"").toLowerCase()+String(Number(m[2]))+(m[3]||"").toLowerCase();
}
function numParts(v){
  const s=String(v||"");
  const token="[A-Za-z]{0,8}\\d{1,4}[A-Za-z]{0,4}";
  const m=s.match(new RegExp("("+token+")\\s*\\/\\s*("+token+")","i"));
  if(m){
    const n=normalizeCollectorToken(m[1]),d=normalizeCollectorToken(m[2]);
    return{n,d,full:n+"/"+d,rawN:m[1],rawD:m[2]};
  }
  const x=s.match(new RegExp(token,"i"));
  if(x){
    const n=normalizeCollectorToken(x[0]);
    return{n,d:"",full:n,rawN:x[0],rawD:""};
  }
  return{n:"",d:"",full:"",rawN:"",rawD:""};
}
function collectorTokenShape(v){
  const t=normalizeCollectorToken(v),m=t.match(/^([a-z]*)(\d+)([a-z]*)$/i);
  return m?{raw:t,prefix:m[1]||"",digits:String(Number(m[2])),suffix:m[3]||""}:{raw:t,prefix:"",digits:"",suffix:""};
}
function collectorTokenMatches(wanted,found){
  const w=collectorTokenShape(wanted),f=collectorTokenShape(found);
  if(!w.raw)return true;
  if(w.raw===f.raw)return true;
  return !w.prefix&&!w.suffix&&!!w.digits&&w.digits===f.digits;
}
function collectorNumberMatches(wantedValue,foundValue){
  const w=numParts(wantedValue),f=numParts(foundValue);
  if(w.n&&!collectorTokenMatches(w.n,f.n))return false;
  if(w.d&&f.d&&!collectorTokenMatches(w.d,f.d))return false;
  return true;
}
const SPECIAL_ORIGINAL_NUMBERS={
  cel25cc:{
    CC001:'2/102',CC002:'4/102',CC003:'15/102',CC004:'73/102',CC005:'8/82',
    CC006:'15/82',CC007:'15/132',CC008:'24',CC009:'20/111',CC010:'66/64',
    CC011:'9/95',CC012:'86/109',CC013:'88/92',CC014:'93/101',CC015:'17/17',
    CC016:'15/106',CC017:'109/111',CC018:'145/147',CC019:'107/123',CC020:'113/114',
    CC021:'114/114',CC022:'54/99',CC023:'97/146',CC024:'76/108',CC025:'60/145'
  },
  '30th-c':{
    '001':'4/102','002':'5/109','003':'11/113','004':'11/101','005':'18/132',
    '006':'19/109','007':'25/111','008':'33/181','009':'41/122','010':'43/146',
    '011':'47/127','012':'50/185','013':'57/111','014':'58/102','015':'69/132',
    '016':'85/124','017':'89/149','018':'94/102','019':'99/102','020':'100/102',
    '021':'101/101','022':'106/106','023':'106/160','024':'106/105','025':'108/115',
    '026':'114/264','027':'123/172','028':'138/202','029':'149/147','030':'203/193'
  }
};
function specialPrintedNumber(setId,localId){
  const set=String(setId||''),local=String(localId||'').trim();
  const digits=String(local).match(/(\d+)/)?.[1]||'';
  if(set==='cel25cc'&&digits)return String(Number(digits))+'/25';
  if(set==='30th-c'&&digits)return String(Number(digits))+'/30';
  return local;
}
function specialOriginalNumber(setId,localId){
  const set=String(setId||''),local=String(localId||'').trim();
  return SPECIAL_ORIGINAL_NUMBERS[set]?.[local]||'';
}
function isAnniversaryClassicSet(setId){
  return ['cel25cc','30th-c'].includes(String(setId||''));
}
function anniversaryHintInfo(value){
  const h=norm(value);
  if(!h)return null;
  const classic=/classic|classica|classico|colecao classica|collection classic/.test(h);
  const y25=(/\b25(?:th)?\b/.test(h)&&(h.includes('ano')||h.includes('anivers')||h.includes('celebr')))||h.includes('celebrations')||h.includes('celebracoes');
  if(y25)return{year:25,classic,ids:classic?['cel25cc']:['cel25','cel25cc']};
  const y30=(/\b30(?:th)?\b/.test(h)&&(h.includes('ano')||h.includes('anivers')||h.includes('celebr')))||h.includes('30th celebration');
  if(y30)return{year:30,classic,ids:classic?['30th-c']:['30th','30th-c']};
  return null;
}
function anniversarySetAliasScore(set,hint){
  const info=anniversaryHintInfo(hint);
  if(!info)return 0;
  const id=String(set?.id||'');
  if(!info.ids.includes(id))return 0;
  return info.classic?1190:1140;
}
function anniversaryCardSetMatches(card,setHint){
  const info=anniversaryHintInfo(setHint);
  if(!info)return false;
  const id=String(card?.setId||card?.set_id||'').toLowerCase();
  const name=norm(card?.setName||card?.set_name||card?.setTitle||card?.set_title||'');
  if(info.year===25){
    if(info.classic)return id==='cel25cc'||id==='cel25c'||(name.includes('celebr')&&name.includes('classic'));
    return id==='cel25'||id==='cel25cc'||id==='cel25c'||name.includes('celebr');
  }
  if(info.year===30){
    if(info.classic)return id==='30th-c'||(name.includes('30')&&name.includes('classic'));
    return id==='30th'||id==='30th-c'||(name.includes('30')&&name.includes('celebr'));
  }
  return false;
}
function toast(msg){const e=$("toast");if(!e)return;e.textContent=msg;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2400)}
function openDialog(id){const e=$(id);if(e&&!e.open)e.showModal()}
function closeDialog(id){const e=$(id);if(e?.open)e.close()}
function cardImage(c){const u=c?.imageUrl||c?.image_url||c?.market_image_pt||c?.market_image_en||"";return u&&u.includes("assets.tcgdex.net")&&!/\.(webp|png|jpe?g)$/i.test(u)?`${u}/high.webp`:u}
function ligaUrl(c){return"https://www.ligapokemon.com.br/?view=cards/search&card="+encodeURIComponent([c.name,c.number,c.setName||c.set_name].filter(Boolean).join(" "))}
function cardKey(c){const id=c.apiId||c.api_id||c.marketInternalCode||c.market_internal_code||"";const source=c.source||c.api_source||"catalog";const lang=c.languageCode||c.language_code||"";return id?`${source}|${id}|${lang}`:[c.name,c.setId||c.set_id,c.number,lang].map(norm).join("|")}
function busy(btn,on,text="Aguarde..."){if(!btn)return;if(on){btn.dataset.old=btn.textContent;btn.textContent=text;btn.disabled=true}else{btn.textContent=btn.dataset.old||btn.textContent;btn.disabled=false}}
let authMode="login";
function setAuthMode(m){authMode=m;$("tabLogin").classList.toggle("active",m==="login");$("tabSignup").classList.toggle("active",m==="signup");$("authSubmit").textContent=m==="login"?"Entrar":"Criar conta";$("authMessage").textContent=""}
async function handleAuth(e){e.preventDefault();const b=$("authSubmit");busy(b,true);try{const email=$("authEmail").value.trim(),password=$("authPassword").value;if(authMode==="signup"){const{data,error}=await db.auth.signUp({email,password});if(error)throw error;$("authMessage").textContent=data.session?"Conta criada.":"Conta criada. Confirme seu e-mail."}else{const{error}=await db.auth.signInWithPassword({email,password});if(error)throw error}}catch(err){$("authMessage").textContent=err.message||"Falha ao autenticar."}finally{busy(b,false)}}
async function ensureSettings(){const{data,error}=await db.from("pokemon_settings").select("*").eq("user_id",currentUser.id).maybeSingle();if(error)throw error;if(data)settings={...settings,...data};else{const{error:ie}=await db.from("pokemon_settings").upsert({user_id:currentUser.id},{onConflict:"user_id",ignoreDuplicates:true});if(ie)throw ie;const{data:i,error:se}=await db.from("pokemon_settings").select("*").eq("user_id",currentUser.id).single();if(se)throw se;settings={...settings,...i}}}
async function loadCurrentProfile(){const{data,error}=await db.from("pokemon_profiles").select("*").eq("user_id",currentUser.id).maybeSingle();if(error)throw error;currentProfile=data;if(data){$("userHandle").textContent=`@${data.username}`;$("profileUsername").value=data.username||"";$("profileVisibility").value=data.binder_visibility||"friends"}else{$("userHandle").textContent=currentUser.email||""}}
async function saveProfile(){const b=$("btnSaveProfile"),username=$("profileUsername").value.trim(),binder_visibility=$("profileVisibility").value;if(!/^[A-Za-z0-9_.-]{3,24}$/.test(username)){toast("Use 3 a 24 caracteres: letras, números, _, . ou -");return}busy(b,true,"Salvando...");try{const payload={user_id:currentUser.id,username,binder_visibility,display_name:currentProfile?.display_name||""};const{error}=await db.from("pokemon_profiles").upsert(payload,{onConflict:"user_id"});if(error)throw error;await loadCurrentProfile();toast("Perfil salvo.")}catch(err){console.error(err);toast(String(err.message||"").toLowerCase().includes("unique")||String(err.message||"").toLowerCase().includes("duplicate")?"Esse @usuário já existe.":`Erro ao salvar perfil: ${err.message||"tente novamente"}`)}finally{busy(b,false)}}
async function updateSettings(patch,silent=false){settings={...settings,...patch};applySettings();const{error}=await db.from("pokemon_settings").update(patch).eq("user_id",currentUser.id);if(error&&!silent)toast("Não consegui salvar a configuração.")}
function applySettings(){const n=settings.binder_name||"Meu Fichário",mode=currentPriceMode();$("binderTitleHeader").textContent=n;document.querySelector(".cover-title").innerHTML=esc(n).replace(/\s+/,"<br>");$("binderNameInput").value=n;$("binderStage").className=`binder-stage theme-${settings.binder_background||"graphite"}`;$("showValues").checked=!!settings.show_values;$("totalValueBox").classList.toggle("hidden",!settings.show_values);if($("priceMode"))$("priceMode").value=mode;if($("totalValueLabel"))$("totalValueLabel").textContent=`Valor ${priceModeLabel(mode)} salvo`;document.querySelectorAll(".theme-swatch").forEach(x=>x.classList.toggle("active",x.dataset.theme===settings.binder_background));currentPage=Math.min(Math.max(1,currentPage),Math.max(1,+settings.binder_pages||1))}
let lastAuthUserIdV17=null;
async function renderAuthState(session){currentUser=session?.user||null;
// INITIAL_SESSION / TOKEN_REFRESHED for the same user must not reload everything.
if(currentUser&&currentUser.id===lastAuthUserIdV17)return;lastAuthUserIdV17=currentUser?.id||null;
if(!currentUser){$("app").classList.add("hidden");$("authScreen").classList.remove("hidden");return}$("authScreen").classList.add("hidden");$("app").classList.remove("hidden");try{await Promise.all([ensureSettings(),loadCurrentProfile()]);applySettings();await loadCards(false)}catch(e){console.error(e);toast("Não consegui iniciar seu fichário.")}}
async function loadCards(show=true){const{data,error}=await db.from("pokemon_cards").select("*").eq("user_id",currentUser.id).order("binder_page").order("binder_slot");if(error){console.error(error);toast("Erro ao carregar cartas.");return}collection=data||[];const max=Math.max(1,...collection.map(c=>+c.binder_page||1));if(max>(+settings.binder_pages||1))await updateSettings({binder_pages:max},true);renderAll();if(show)toast("Fichário atualizado.")}
const cardsOnPage=p=>collection.filter(c=>+(c.binder_page||1)===+p);
const getCardAt=(p,s)=>collection.find(c=>+(c.binder_page||1)===+p&&+c.binder_slot===+s);
function freePositions(start=currentPage,count=1){const out=[];let pages=Math.max(1,+settings.binder_pages||1);for(let p=start;p<=pages&&out.length<count;p++)for(let s=1;s<=9&&out.length<count;s++)if(!getCardAt(p,s))out.push({page:p,slot:s});for(let p=1;p<start&&out.length<count;p++)for(let s=1;s<=9&&out.length<count;s++)if(!getCardAt(p,s))out.push({page:p,slot:s});while(out.length<count){pages++;for(let s=1;s<=9&&out.length<count;s++)out.push({page:pages,slot:s})}return out}
function renderAll(){applySettings();renderBinder();renderSummary();renderPagesGrid()}
function renderBinder(){const g=$("binderSheet");g.innerHTML="";for(let slot=1;slot<=9;slot++){const pocket=document.createElement("div");pocket.className="binder-pocket";pocket.dataset.page=currentPage;pocket.dataset.slot=slot;const c=getCardAt(currentPage,slot);if(c)pocket.appendChild(renderPocketCard(c));else{const b=document.createElement("button");b.className="pocket-empty-btn";b.type="button";b.textContent="＋";b.title=`Adicionar no bolso ${slot}`;b.onclick=()=>openAddForPosition(currentPage,slot);pocket.appendChild(b)}pocket.addEventListener("dragover",e=>{e.preventDefault();pocket.classList.add("drag-over")});pocket.addEventListener("dragleave",()=>pocket.classList.remove("drag-over"));pocket.addEventListener("drop",async e=>{e.preventDefault();pocket.classList.remove("drag-over");if(draggedCard)await moveCard(draggedCard,currentPage,slot)});g.appendChild(pocket)}const pages=Math.max(1,+settings.binder_pages||1);$("pageLabel").textContent=`Página ${currentPage} · ${currentPage}/${pages}`;$("prevPage").disabled=currentPage<=1;$("nextPage").disabled=currentPage>=pages}
function renderPocketCard(c){const st=c.collection_status||"owned",b=document.createElement("button");b.className=`pocket-card status-${st}`;b.type="button";b.draggable=true;b.dataset.id=c.id;if(activeStatusFilter!=="all"&&st!==activeStatusFilter)b.classList.add("filtered-out");const img=cardImage(c),q=Math.max(0,+c.quantity||0),pv=priceModeValue(c,currentPriceMode()),v=pv*Math.max(q,1);b.innerHTML=`${img?`<img src="${esc(img)}" alt="${esc(c.name)}" loading="lazy">`:`<span>${esc(c.name)}</span>`}<span class="card-status-ribbon">${esc(STATUS[st]||st)}</span>${st==="owned"&&q>1?`<span class="card-qty">x${q}</span>`:""}${settings.show_values&&pv>0?`<span class="card-value">${money(v)}</span>`:""}`;b.addEventListener("click",()=>openExistingCard(c));b.addEventListener("dblclick",()=>openExistingCard(c,true));b.addEventListener("contextmenu",e=>{e.preventDefault();showContextMenu(c,e.clientX,e.clientY)});b.addEventListener("dragstart",e=>{draggedCard=c;b.classList.add("dragging");e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",c.id)});b.addEventListener("dragend",()=>{draggedCard=null;b.classList.remove("dragging")});let press;const start=e=>{press=setTimeout(()=>showContextMenu(c,e.clientX||innerWidth/2,e.clientY||innerHeight/2),620)};b.addEventListener("pointerdown",e=>{if(e.pointerType!=="mouse")start(e)});["pointerup","pointercancel","pointermove"].forEach(ev=>b.addEventListener(ev,()=>clearTimeout(press)));return b}
async function moveCard(card,page,slot){if(+card.binder_page===+page&&+card.binder_slot===+slot)return;try{const{error}=await db.rpc("pokemon_move_card",{p_card_id:card.id,p_target_page:+page,p_target_slot:+slot});if(error)throw error;if(page>+settings.binder_pages)await updateSettings({binder_pages:page},true);await loadCards(false);currentPage=page;renderAll();toast("Carta movida.")}catch(e){console.error(e);toast("Não consegui mover a carta.")}}
function showContextMenu(c,x,y){contextCard=c;const m=$("cardContextMenu");m.classList.remove("hidden");m.style.left=Math.min(x,innerWidth-205)+"px";m.style.top=Math.min(y,innerHeight-260)+"px"}
function hideContext(){$("cardContextMenu").classList.add("hidden")}
async function contextAction(a){const c=contextCard;if(!c)return;hideContext();if(a==="view")return openExistingCard(c,true);if(a==="move"){const v=prompt("Mover para página e bolso. Ex.: 2,5",`${c.binder_page},${c.binder_slot}`);if(!v)return;const[p,s]=v.split(/[,;\s]+/).map(Number);if(p>=1&&s>=1&&s<=9)return moveCard(c,p,s);return toast("Use página,bolso. Ex.: 2,5")}if(a==="delete"){if(confirm(`Remover ${c.name}?`)){const{error}=await db.from("pokemon_cards").delete().eq("id",c.id).eq("user_id",currentUser.id);if(error)return toast("Não consegui remover a carta.");await loadCards(false);toast("Carta removida.")}return}if(["owned","wanted","ordered","missing"].includes(a)){const{error}=await db.from("pokemon_cards").update({collection_status:a,quantity:a==="owned"?Math.max(1,+c.quantity||1):0}).eq("id",c.id).eq("user_id",currentUser.id);if(error)return toast("Não consegui mudar o status.");await loadCards(false);toast(`Status: ${STATUS[a]}`)}}
function renderSummary(){const counts={missing:0,wanted:0,owned:0,ordered:0};collection.forEach(c=>counts[c.collection_status||"owned"]++);const total=collection.length,cap=Math.max(1,+settings.binder_pages||1)*9,empty=Math.max(0,cap-total),pct=total?Math.round(counts.owned/total*100):0,value=collection.filter(c=>(c.collection_status||"owned")==="owned").reduce((s,c)=>s+priceModeValue(c,currentPriceMode())*Math.max(+c.quantity||1,1),0);$("completionPercent").textContent=pct+"%";$("progressBar").style.width=pct+"%";$("progressText").textContent=`${counts.owned} de ${total} marcadas como Tenho`;for(const[k,id]of Object.entries({sumTotal:total,sumOwned:counts.owned,sumWanted:counts.wanted,sumOrdered:counts.ordered,sumMissing:counts.missing,sumEmpty:empty,filterAllCount:total,filterOwnedCount:counts.owned,filterWantedCount:counts.wanted,filterOrderedCount:counts.ordered,filterMissingCount:counts.missing,coverSlots:cap,coverOwned:counts.owned,coverWanted:counts.wanted}))$(k).textContent=id;if($("totalValueLabel"))$("totalValueLabel").textContent=`Valor ${priceModeLabel(currentPriceMode())} salvo`;$("totalValue").textContent=money(value);$("binderHeaderStats").textContent=`${total} cartas · ${counts.owned} tenho · ${counts.wanted} quero · ${pct}% completo`;document.querySelectorAll("[data-status-filter]").forEach(b=>b.classList.toggle("active",b.dataset.statusFilter===activeStatusFilter))}
function setStatusFilter(s){activeStatusFilter=s;renderBinder();renderSummary()}
async function addPage(){const n=Math.max(1,+settings.binder_pages||1)+1;await updateSettings({binder_pages:n});currentPage=n;renderAll();toast(`Página ${n} adicionada.`)}
function goToPage(p){currentPage=Math.min(Math.max(1,+p||1),Math.max(1,+settings.binder_pages||1));renderBinder();renderPagesGrid()}
function renderPagesGrid(){const g=$("pagesGrid");if(!g)return;g.innerHTML="";for(let p=1;p<=Math.max(1,+settings.binder_pages||1);p++){const b=document.createElement("button");b.className="page-thumb"+(p===currentPage?" active":"");const cells=[];for(let s=1;s<=9;s++){const c=getCardAt(p,s),img=c?cardImage(c):"";cells.push(`<span class="page-mini-pocket">${img?`<img src="${esc(img)}">`:""}</span>`)}b.innerHTML=`<strong>Página ${p}</strong><div class="page-mini-grid">${cells.join("")}</div><small>${cardsOnPage(p).length}/9</small>`;b.onclick=()=>{goToPage(p);closeDialog("pagesDialog")};g.appendChild(b)}}
function openAddForPosition(page=currentPage,slot=null){pendingPosition=slot?{page,slot}:freePositions(page,1)[0];catalogSelection.clear();updateSelectionTray();$("searchName").value="";$("searchNumber").value="";$("searchSet").value="";$("resultsList").innerHTML="";$("searchStatus").textContent=`Primeira carta irá para página ${pendingPosition.page}, bolso ${pendingPosition.slot}.`;openDialog("addDialog");setTimeout(()=>$("searchName").focus(),100)}
// V17: MYP lists every printing it sells (new sets, promos, Japanese, reprint
// collections) under its own search. /api/myp-search runs that search on the
// server for signed-in users and returns one entry per product.
async function searchMypCards(name,number,setHint,language){
  if(!name)return{cards:[],needsToken:false};
  try{
    const {data:{session}}=await db.auth.getSession();
    if(!session?.access_token)return{cards:[],needsToken:false};
    // With a number, also search by name alone: reprint collections are titled
    // with the original printed number on MYP (Classic Collection Lugia = 149/147).
    const queries=[String(name).trim()+(number?" ("+String(number).trim()+")":"")];
    if(number)queries.push(String(name).trim());
    const ask=q=>fetch("/api/myp-search?q="+encodeURIComponent(q),{cache:"no-store",headers:{Authorization:"Bearer "+session.access_token}}).then(r=>r.json()).catch(()=>null);
    let answers=await Promise.all(queries.map(ask));
    // A cold server or a slow MYP page can fail once: retry before giving up.
    if(!answers.some(a=>a?.ok)){await new Promise(r=>setTimeout(r,1500));answers=await Promise.all(queries.map(ask))}
    const byId=new Map();
    for(const a of answers)for(const c of (a?.ok?a.cards:[])||[])if(!byId.has(c.productId))byId.set(c.productId,c);
    const j={ok:answers.some(a=>a?.ok),cards:[...byId.values()]};
    if(!j.ok)return{cards:[],needsToken:false,message:"A MYP não respondeu agora; clique em Buscar de novo em instantes."};
    const chosen=language&&language!=="all"?language:"pt-br";
    return{cards:(j.cards||[]).map(c=>{
      // Japanese titles are known. Otherwise honour the chosen language; with
      // "Todos", a card is Portuguese only when MYP has a Portuguese scan.
      const lang=c.japanese?"ja":(language&&language!=="all"&&language!=="ja"?language:(c.imagePt?"pt-br":"en"));
      const image=lang==="pt-br"&&c.imagePt?c.imagePt:(c.imageEn||c.image||"");
      return{
        source:"MYP Cards",apiId:"myp-"+c.productId,marketInternalCode:c.productId,
        name:c.name,namePt:c.name,nameEn:"",languageCode:lang,language:LANG[lang]||lang,
        setName:c.editionName||c.setCode,setId:c.setCode,setCode:c.setCode,
        number:c.number,internalNumber:c.numberToken,originalNumber:c.number,numberAliases:[c.number],
        rarity:"",type:"",imageUrl:image,imagePt:c.imagePt||"",imageEn:c.imageEn||c.image||"",
        mypLink:c.link,
        market:c.lowestPrice?{source:"MYP Cards",min:c.lowestPrice,avg:0,max:0,link:c.link,availableQuantity:c.stock,internalCode:c.productId}:null,
        marketScore:c.stock?10:0
      };
    }),needsToken:false};
  }catch(e){return{cards:[],needsToken:false,message:"Mercado BR indisponível."}}
}

// MYP set codes for TCGdex set ids: TCGdex "abbreviation.official" (SIT, SSP...)
// plus the collections whose MYP code differs or that TCGdex leaves blank.
const MYP_SET_CODE_OVERRIDES={"30th":"30C","30th-c":"30CC","cel25":"CEL","cel25cc":"CCC","mep":"MEP","svp":"SVP"};
const mypSetCodeCache=new Map();
function mypCodeForSet(id){
  const key=String(id||"").trim();
  if(!key)return Promise.resolve("");
  if(MYP_SET_CODE_OVERRIDES[key])return Promise.resolve(MYP_SET_CODE_OVERRIDES[key]);
  if(!mypSetCodeCache.has(key)){
    mypSetCodeCache.set(key,fetch(TCGDEX_BASE+"/en/sets/"+encodeURIComponent(key)).then(r=>r.ok?r.json():null).then(s=>String(s?.abbreviation?.official||"").toUpperCase()).catch(()=>""));
  }
  return mypSetCodeCache.get(key);
}
async function mypCodesForSets(setIds){
  const codes=await Promise.all((setIds||[]).slice(0,40).map(mypCodeForSet));
  return new Set(codes.filter(Boolean));
}

// The same printing from TCGdex and MYP becomes one result: TCGdex keeps its
// data, and gains MYP's image (when it has none) and product link.
function mergeMypIntoCatalog(pool,setCodeOf){
  const myp=pool.filter(c=>c.source==="MYP Cards"),rest=pool.filter(c=>c.source!=="MYP Cards");
  const used=new Set();
  for(const card of rest){
    const n=numParts(card.number||card.internalNumber);
    const match=myp.find(m=>{
      if(used.has(m))return false;
      const mn=numParts(m.number);
      if(!n.n||mn.n!==n.n)return false;
      if(n.d&&mn.d&&n.d!==mn.d)return false;
      if(!catalogNameMatches(card.name,m)&&!catalogNameMatches(m.name,card))return false;
      const code=setCodeOf(card);
      return !code||!m.setCode||code===m.setCode;
    });
    if(!match)continue;
    used.add(match);
    if(!cardImage(card)&&match.imageUrl){card.imageUrl=match.imageUrl;card.imageFallbackSource="MYP Cards"}
    card.mypLink=match.mypLink;
    card.marketInternalCode=card.marketInternalCode||match.marketInternalCode;
    if(match.market&&!card.market)card.market=match.market;
  }
  // Reprint collections (Classic Collection...) keep the ORIGINAL number on
  // MYP: match by set code + name when exactly one MYP result fits.
  for(const card of rest){
    if(card.mypLink)continue;
    const code=setCodeOf(card);
    if(!code)continue;
    const fits=myp.filter(m=>!used.has(m)&&m.setCode===code&&(catalogNameMatches(card.name,m)||catalogNameMatches(m.name,card)));
    if(fits.length!==1)continue;
    const match=fits[0];
    used.add(match);
    if(!cardImage(card)&&match.imageUrl){card.imageUrl=match.imageUrl;card.imageFallbackSource="MYP Cards"}
    card.mypLink=match.mypLink;
    card.marketInternalCode=card.marketInternalCode||match.marketInternalCode;
    if(match.market&&!card.market)card.market=match.market;
  }
  return [...rest,...myp.filter(m=>!used.has(m))];
}
async function searchMypCatalogPublic(name,number,setHint,language,options={}){
  const raw=String(name||"").trim();
  if(raw.length<2)return[];
  const live=!!options.live;
  if(live&&norm(raw).replace(/\s+/g,"").length<4)return[];
  try{
    const p=new URLSearchParams({
      name:raw,
      lang:language==="all"?"pt-br":language,
      limit:String(live?24:60)
    });
    if(number)p.set("number",number);
    if(setHint)p.set("set",setHint);
    const rr=await fetch("/api/myp-catalog-public?"+p.toString(),{cache:"no-store"});
    if(!rr.ok)return[];
    const j=await rr.json();
    return j?.ok&&Array.isArray(j.cards)?j.cards:[];
  }catch(e){
    console.warn("MYP public catalog",e);
    return[];
  }
}
async function searchMypRelatedCatalog(name,language,seeds,options={}){
  const raw=String(name||"").trim();
  const urls=[...new Set((seeds||[]).map(String).filter(x=>/^https:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\//i.test(x)))].slice(0,3);
  if(raw.length<2||!urls.length)return[];
  const live=!!options.live;
  if(live&&norm(raw).replace(/\s+/g,"").length<4)return[];
  try{
    const p=new URLSearchParams({
      name:raw,
      lang:language==="all"?"pt-br":language,
      seeds:urls.join("|")
    });
    const rr=await fetch("/api/myp-related-catalog?"+p.toString(),{cache:"no-store"});
    if(!rr.ok)return[];
    const j=await rr.json();
    return j?.ok&&Array.isArray(j.cards)?j.cards:[];
  }catch(e){
    console.warn("MYP related catalog",e);
    return[];
  }
}
function mapMyp(c){const isJa=!!c.isJapanese||norm(c.rawLanguage)==="ja"||norm(c.rawLanguage)==="jp";const lang=isJa?"ja":(c.imagePt?"pt-br":"en");return{source:"MYP Cards",apiId:`myp-${c.internalCode}`,marketInternalCode:c.internalCode,name:c.nameEn||c.namePt||"",namePt:c.namePt||"",nameEn:c.nameEn||"",languageCode:lang,language:isJa?"Japonês":(lang==="pt-br"?"Português":"Inglês"),setName:c.editionPt||c.editionEn||"",setId:c.editionCode||"",number:c.number||"",internalNumber:c.internalNumber||c.numerator||"",originalNumber:c.originalNumber||"",numberAliases:[c.number,c.internalNumber,c.originalNumber,...(Array.isArray(c.numberAliases)?c.numberAliases:[]),...(Array.isArray(c.deckLabels)?c.deckLabels:[])].filter(Boolean),rarity:"",type:"",imageUrl:isJa?(c.imageJa||c.imageEn||c.imagePt||""):(c.imagePt||c.imageEn||""),imagePt:c.imagePt||"",imageEn:c.imageEn||"",imageJa:c.imageJa||"",market:{source:"MYP Cards",min:+c.minPrice||0,avg:+c.avgPrice||0,max:+c.maxPrice||0,link:c.link||"",availableQuantity:c.availableQuantity,internalCode:c.internalCode,namePt:c.namePt||"",editionPt:c.editionPt||"",imagePt:c.imagePt||"",imageEn:c.imageEn||""},marketScore:+c.matchScore||0}}
async function searchLimitlessVariants(name,number,cards,language){
  const wanted=numParts(number);
  if(!String(name||"").trim()||!wanted.n||language==="ja")return[];
  const qn=norm(name),bases=(cards||[]).filter(c=>{
    if(!c?.setId&&!c?.setName)return false;
    const cn=norm(c.name||"");
    if(qn&&!(cn===qn||cn.includes(qn)||qn.includes(cn)))return false;
    return collectorTokenMatches(wanted.n,numParts(c.number).n);
  });
  const sets=[],seen=new Set();
  const collectSets=list=>{
    for(const c of list||[]){
      if(!c?.setId&&!c?.setName)continue;
      const cn=norm(c.name||"");
      if(qn&&!(cn===qn||cn.includes(qn)||qn.includes(cn)))continue;
      const key=[c.setId||"",c.setName||""].join("|");
      if(seen.has(key))continue;
      seen.add(key);
      sets.push({id:c.setId||"",name:c.setName||"",total:c.printedTotal||""});
      if(sets.length>=6)break;
    }
  };
  collectSets(bases);

  // If an exact lettered number such as 177a is absent from TCGdex, use
  // name-only results to discover the physical set, then ask Limitless for
  // that exact alternate print.
  if(!sets.length&&wanted.suffix){
    const discoveryLangs=language==="all"?["pt-br","en"]:[language];
    try{
      const discovery=(await Promise.all(
        discoveryLangs.filter(l=>l!=="ja").map(l=>searchTCGdex(l,name,"",{live:false}))
      )).flat();
      collectSets(discovery);
    }catch(e){console.warn("Limitless set discovery",e)}
  }

  if(!sets.length)return[];
  try{
    const p=new URLSearchParams({
      name:String(name||""),
      number:String(number||""),
      lang:language==="pt-br"?"pt":"en",
      sets:JSON.stringify(sets)
    });
    const r=await fetch("/api/limitless-variants?"+p.toString(),{cache:"no-store"});
    if(!r.ok)return[];
    const j=await r.json();
    return j?.ok&&Array.isArray(j.cards)?j.cards:[];
  }catch(e){
    console.warn("Limitless variants",e);
    return[];
  }
}
async function searchLegacyCards(name,number,setHint,options={}){
  const raw=String(name||"").trim();
  if(!raw)return[];
  const live=!!options.live;
  if(live&&norm(raw).replace(/\s+/g,"").length<4)return[];
  const p=new URLSearchParams({name:raw,limit:String(live?30:80)});
  if(number)p.set("number",number);
  if(setHint)p.set("set",setHint);
  const key="legacy|"+p.toString(),cached=catalogSearchCache.get(key);
  if(cached&&Date.now()-cached.at<10*60*1000)return cached.items;
  try{
    const r=await fetch("/api/legacy-card-search?"+p.toString(),{cache:"no-store"});
    if(!r.ok)return[];
    const j=await r.json();
    const items=j?.ok&&Array.isArray(j.cards)?j.cards:[];
    catalogSearchCache.set(key,{at:Date.now(),items});
    return items;
  }catch(e){
    console.warn("Legacy card search",e);
    return[];
  }
}
async function searchJapaneseOfficial(name,number,setHint,options={}){
  const raw=String(name||"").trim();
  if(!raw)return[];
  const live=!!options.live;
  if(live&&norm(raw).replace(/\s+/g,"").length<4)return[];
  const p=new URLSearchParams({name:raw,limit:String(live?18:60)});
  if(number)p.set("number",number);
  if(setHint)p.set("set",setHint);
  const key="jp-official|"+p.toString();
  const cached=catalogSearchCache.get(key);
  if(cached&&Date.now()-cached.at<(live?2:10)*60*1000)return cached.items;
  try{
    const r=await fetch("/api/jp-card-search?"+p.toString(),{cache:"no-store"});
    if(!r.ok)return[];
    const j=await r.json();
    const items=j?.ok&&Array.isArray(j.cards)?j.cards:[];
    catalogSearchCache.set(key,{at:Date.now(),items});
    return items;
  }catch(e){
    console.warn("Japanese official search",e);
    return[];
  }
}
function tcgApiLang(lang){return lang==="pt-br"?"pt":lang}
function tcgNameVariants(value){
  const raw=String(value||"").trim();
  if(!raw)return[];
  const clean=raw.replace(/[-_]+/g," ").replace(/\s+/g," ").trim();
  const words=clean.split(/\s+/).filter(Boolean);
  const broad=words.length>1?words[0]:"";
  return [...new Set([raw,clean,broad].filter(Boolean))];
}
function levenshtein(a,b){
  a=norm(a);b=norm(b);
  if(a===b)return 0;
  if(!a.length)return b.length;
  if(!b.length)return a.length;
  let prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){
    cur[0]=i;
    for(let j=1;j<=b.length;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+cost);
    }
    [prev,cur]=[cur,prev];
  }
  return prev[b.length];
}
function nameSimilarity(a,b){
  const x=norm(a),y=norm(b),m=Math.max(x.length,y.length);
  if(!m)return 1;
  return 1-levenshtein(x,y)/m;
}
function fuzzyNamePrefixes(value){
  const clean=String(value||"").replace(/[-_]+/g," ").replace(/\s+/g," ").trim();
  if(!clean)return[];
  const suffix=/^(ex|gx|v|vmax|vstar|break|lv\.?x)$/i;
  const words=clean.split(/\s+/).filter(Boolean);
  while(words.length>1&&suffix.test(words[words.length-1]))words.pop();
  const base=words.join(" ").trim();
  if(base.length<4)return[];
  const lengths=[base.length-1,base.length-2,Math.ceil(base.length*.7),4,3]
    .filter(n=>n>=3&&n<base.length);
  return [...new Set(lengths.map(n=>base.slice(0,n).trim()).filter(x=>x.length>=3))];
}
async function fetchTCGdexList(apiLang,q){
  const p=new URLSearchParams();
  if(q.name)p.set("name",q.name);
  if(q.localId)p.set("localId",q.localId);
  p.set("pagination:itemsPerPage","60");
  const key=apiLang+"|"+p.toString();
  const cached=catalogSearchCache.get(key);
  if(cached&&Date.now()-cached.at<5*60*1000)return cached.items;
  try{
    const r=await fetch(`${TCGDEX_BASE}/${apiLang}/cards?${p}`);
    if(!r.ok)return[];
    const a=await r.json();
    const items=Array.isArray(a)?a:[];
    catalogSearchCache.set(key,{at:Date.now(),items});
    return items;
  }catch(e){
    console.warn("TCGdex list",apiLang,q,e);
    return[];
  }
}
async function fetchTCGdexSets(apiLang){
  const key="sets|"+apiLang,cached=catalogSearchCache.get(key);
  if(cached&&Date.now()-cached.at<10*60*1000)return cached.items;
  try{
    const r=await fetch(`${TCGDEX_BASE}/${apiLang}/sets`);
    if(!r.ok)return[];
    const a=await r.json(),items=Array.isArray(a)?a:[];
    catalogSearchCache.set(key,{at:Date.now(),items});
    return items;
  }catch(e){
    console.warn("TCGdex sets",apiLang,e);
    return[];
  }
}
function setSearchScore(s,hint){
  const h=norm(hint),name=norm(s?.name),id=norm(s?.id);
  if(!h)return 0;
  const anniversaryScore=anniversarySetAliasScore(s,hint);
  if(anniversaryScore)return anniversaryScore;
  if(name===h||id===h)return 1200;
  if(name.startsWith(h)||id.startsWith(h))return 980;
  if(name.includes(h)||h.includes(name)||id.includes(h)||h.includes(id))return 820;
  const words=h.split(" ").filter(Boolean),target=new Set(name.split(" ").filter(Boolean));
  const hits=words.filter(w=>target.has(w)).length;
  let score=hits?420+hits*80:0;
  const sim=Math.max(nameSimilarity(h,name),nameSimilarity(h,id));
  if(sim>=.9)score=Math.max(score,760);
  else if(sim>=.8)score=Math.max(score,620);
  else if(sim>=.68)score=Math.max(score,430);
  else if(sim>=.55)score=Math.max(score,260);
  return score;
}
async function findTCGdexSets(lang,hint,limit=4){
  const h=String(hint||"").trim();
  if(!h)return[];
  const apiLang=tcgApiLang(lang),sets=await fetchTCGdexSets(apiLang);
  return sets.map(s=>({s,score:setSearchScore(s,h)}))
    .filter(x=>x.score>=220)
    .sort((a,b)=>b.score-a.score||String(a.s.name||"").localeCompare(String(b.s.name||"")))
    .slice(0,limit)
    .map(x=>x.s);
}
async function resolveCatalogSetIds(langs,hint){
  const h=String(hint||"").trim();
  if(!h)return[];
  const all=(await Promise.all((langs||[]).map(async lang=>{
    const sets=await fetchTCGdexSets(tcgApiLang(lang));
    return sets.map(s=>({id:String(s?.id||""),name:s?.name||"",score:setSearchScore(s,h)}));
  }))).flat().filter(x=>x.id&&x.score>=220);
  if(!all.length)return[];
  const byId=new Map();
  for(const x of all){
    const old=byId.get(x.id);
    if(!old||x.score>old.score)byId.set(x.id,x);
  }
  const ranked=[...byId.values()].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  const best=ranked[0]?.score||0;
  // Coleção é filtro: só aceitamos o(s) set(s) realmente próximos do melhor match.
  const floor=best>=1000?best-60:best>=800?best-110:Math.max(430,best-90);
  return ranked.filter(x=>x.score>=floor).slice(0,4).map(x=>x.id);
}
function cardMatchesSetFilter(c,setHint,setIds=[]){
  const ids=new Set((setIds||[]).map(String));
  const cid=String(c?.setId||c?.set_id||"");
  // Geração escolhida sem coleção: setIds contém TODAS as coleções daquela geração.
  // Portanto ela também é um filtro rígido, não apenas um peso de ranking.
  if(!String(setHint||"").trim()){
    if(!ids.size)return true;
    return !!cid&&ids.has(cid);
  }
  if(anniversaryCardSetMatches(c,setHint))return true;
  if(ids.size&&cid&&ids.has(cid))return true;
  // Para catálogo TCGdex, se a coleção foi resolvida por ID, outro set é proibido.
  if(ids.size&&(c?.source==="TCGdex"||c?.api_source==="TCGdex"))return false;
  // Fontes de mercado nem sempre usam o ID TCGdex: exigimos o nome/código da coleção.
  const h=norm(setHint),name=norm(c?.setName||c?.set_name||""),id=norm(cid),title=norm(c?.setTitle||c?.set_title||"");
  if(!h)return true;
  if(name===h||id===h||title===h||name.includes(h)||h.includes(name)||id.includes(h)||h.includes(id)||title.includes(h)||h.includes(title))return true;
  return Math.max(nameSimilarity(h,name),nameSimilarity(h,id),nameSimilarity(h,title))>=.78;
}
function cardNumberMatches(wanted,card){
  if(!String(wanted||'').trim())return true;
  const values=[card?.number,card?.internalNumber,...(Array.isArray(card?.numberAliases)?card.numberAliases:[])].filter(Boolean);
  return values.some(v=>collectorNumberMatches(wanted,v));
}
function catalogNameMatches(name,card){
  const q=norm(name),cn=norm(card?.name);
  if(!q)return true;
  if(!cn)return false;
  if(cn===q||cn.startsWith(q+" ")||q.startsWith(cn+" "))return true;

  const suffix=/\b(ex|gx|v|vmax|vstar|break|lv x)\b/g;
  const qBase=q.replace(suffix," ").replace(/\s+/g," ").trim();
  const cBase=cn.replace(suffix," ").replace(/\s+/g," ").trim();
  if(!qBase||!cBase)return false;

  if(cBase===qBase||cBase.startsWith(qBase+" ")||qBase.startsWith(cBase+" "))return true;

  // Typo tolerance is only allowed when the names are genuinely close.
  // This prevents "number 38" from returning every unrelated card #38.
  const sim=nameSimilarity(qBase,cBase);
  const firstQ=qBase.slice(0,3),firstC=cBase.slice(0,3);
  return firstQ===firstC && sim>=0.78;
}

function hardFilterCatalog(cards,{name="",number="",setHint="",setIds=[],language="all"}={}){
  return (cards||[]).filter(c=>{
    if(language!=="all"&&c.languageCode!==language)return false;
    if(name&&!catalogNameMatches(name,c))return false;
    if(number&&!cardNumberMatches(number,c))return false;
    if(!cardMatchesSetFilter(c,setHint,setIds))return false;
    return true;
  });
}
async function fetchTCGdexSet(lang,setId){
  const apiLang=tcgApiLang(lang),key=`set|${apiLang}|${setId}`,cached=catalogSearchCache.get(key);
  if(cached&&Date.now()-cached.at<10*60*1000)return cached.item;
  try{
    const r=await fetch(`${TCGDEX_BASE}/${apiLang}/sets/${encodeURIComponent(setId)}`);
    if(!r.ok)return null;
    let item=await r.json();
    // Algumas coleções especiais existem em PT apenas como cabeçalho (cards: []).
    // Nestes casos usamos a lista canônica EN, preservando o nome traduzido da coleção.
    if(apiLang!=="en"&&Array.isArray(item?.cards)&&item.cards.length===0){
      try{
        const er=await fetch(`${TCGDEX_BASE}/en/sets/${encodeURIComponent(setId)}`);
        if(er.ok){
          const en=await er.json();
          if(Array.isArray(en?.cards)&&en.cards.length)item={...en,name:item.name||en.name,serie:item.serie||en.serie,localizedFallback:true};
        }
      }catch{}
    }
    catalogSearchCache.set(key,{at:Date.now(),item});
    return item;
  }catch(e){
    console.warn("TCGdex set",apiLang,setId,e);
    return null;
  }
}
function mapTCGSetBrief(c,set,lang){
  const local=String(c?.localId||""),setId=set?.id||"",image=c?.image||"";
  const marketNumber=specialPrintedNumber(setId,local),originalNumber=specialOriginalNumber(setId,local),parts=numParts(marketNumber);
  return{source:"TCGdex",apiId:c?.id||`${setId}-${local}`,name:c?.name||"",languageCode:lang,language:LANG[lang]||lang,setName:set?.name||setId,setId,number:marketNumber,internalNumber:local,originalNumber,numberAliases:[local,marketNumber,originalNumber].filter(Boolean),printedTotal:parts.rawD||String(set?.cardCount?.official||""),rarity:c?.rarity||"",type:c?.category||"",category:c?.category||"",hp:c?.hp??null,imageUrl:image,pricing:c?.pricing||null};
}
function quickCatalogScore(c,name,number){
  let s=0;
  const qn=norm(name),cn=norm(c?.name),wanted=numParts(number).n;
  if(qn){
    if(cn===qn)s+=900;
    else if(cn.startsWith(qn))s+=720;
    else if(cn.includes(qn)||qn.includes(cn))s+=580;
    else s+=Math.round(nameSimilarity(qn,cn)*420);
  }
  if(wanted)s+=cardNumberMatches(number,c)?800:-250;
  return s;
}
async function searchAnniversaryClassicCollections(langs,name,number,options={}){
  const qn=norm(name),wanted=String(number||'').trim(),live=!!options.live;
  if(!qn||qn.length<2)return[];
  const ids=['cel25cc','30th-c'],out=[];
  for(const lang of (langs||[]).filter(l=>l!=='ja')){
    for(const id of ids){
      const set=await fetchTCGdexSet(lang,id);
      if(!set)continue;
      const candidates=(Array.isArray(set.cards)?set.cards:[])
        .map(card=>mapTCGSetBrief(card,set,lang))
        .filter(card=>{
          const cn=norm(card.name);
          const nameOk=cn===qn||cn.includes(qn)||qn.includes(cn)||nameSimilarity(cn,qn)>=.78;
          if(!nameOk)return false;
          return !wanted||cardNumberMatches(wanted,card);
        })
        .sort((a,b)=>quickCatalogScore(b,name,number)-quickCatalogScore(a,name,number))
        .slice(0,live?8:20);
      for(const card of candidates){
        const full=await fetchTCGdexCard(lang,card.apiId,card);
        if(full)out.push(full);
      }
    }
  }
  return out;
}
async function searchTCGdex(lang,name,number,options={}){
  const parsedNumber=numParts(number),n=parsedNumber.n,lookupLocalId=parsedNumber.rawN||parsedNumber.n,setHint=String(options.setHint||"").trim(),live=!!options.live;
  const setIds=Array.isArray(options.setIds)?options.setIds.filter(Boolean):[];
  const names=tcgNameVariants(name),seenIds=new Map();
  let fuzzyUsed=false,fuzzyTerm="";

  // Quando a coleção já foi reconhecida em qualquer idioma, o ID canônico manda.
  // Ex.: "Tempestade Prateada" resolve para o mesmo set usado por "Silver Tempest".
  if(setIds.length||setHint){
    let ids=setIds;
    if(!ids.length)ids=(await findTCGdexSets(lang,setHint,live?2:4)).map(s=>s.id);
    if(ids.length){
      const sets=(await Promise.all(ids.map(id=>fetchTCGdexSet(lang,id)))).filter(Boolean);
      let pool=[];
      for(const set of sets){
        for(const card of Array.isArray(set.cards)?set.cards:[])pool.push(mapTCGSetBrief(card,set,lang));
      }
      // Número + coleção é interseção obrigatória, nunca só um bônus de ranking.
      if(n)pool=pool.filter(c=>cardNumberMatches(number,c));
      pool.sort((a,b)=>quickCatalogScore(b,name,number)-quickCatalogScore(a,name,number));
      const cap=!String(name||"").trim()&&!n?400:(live?48:120);
      pool=pool.slice(0,cap);
      if(String(name||"").trim()||n){
        const details=await Promise.all(pool.map(c=>fetchTCGdexCard(lang,c.apiId,c)));
        const out=details.filter(Boolean);
        out.fuzzyUsed=false;out.fuzzyTerm="";
        return out;
      }

      // V15.01: buscas por coleção inteira também precisam hidratar a ficha
      // completa. O retorno resumido do endpoint de sets muitas vezes traz
      // nome/número, mas não traz image. Isso deixava coleções inteiras sem arte.
      if(pool.length<=120){
        const details=await Promise.all(pool.map(c=>fetchTCGdexCard(lang,c.apiId,c)));
        const out=details.filter(Boolean);
        out.fuzzyUsed=false;out.fuzzyTerm="";
        return out;
      }

      pool.fuzzyUsed=false;pool.fuzzyTerm="";
      return pool;
    }
  }

  const addList=items=>{
    for(const x of items||[])if(x?.id&&!seenIds.has(x.id))seenIds.set(x.id,x);
  };

  if(!String(name||"").trim()&&!n){
    const empty=[];empty.fuzzyUsed=false;empty.fuzzyTerm="";return empty;
  }

  for(const candidate of names){
    if(n)addList(await fetchTCGdexList(tcgApiLang(lang),{name:candidate,localId:lookupLocalId}));
    addList(await fetchTCGdexList(tcgApiLang(lang),{name:candidate}));
    if(seenIds.size>=40)break;
  }
  if(!seenIds.size&&n)addList(await fetchTCGdexList(tcgApiLang(lang),{localId:lookupLocalId}));

  if(!seenIds.size&&String(name||"").trim()){
    for(const prefix of fuzzyNamePrefixes(name)){
      const items=await fetchTCGdexList(tcgApiLang(lang),{name:prefix});
      if(items.length){
        addList(items);fuzzyUsed=true;fuzzyTerm=prefix;break;
      }
    }
  }

  const limit=live?36:60;
  let list=[...seenIds.values()];
  if(n)list=list.filter(x=>collectorTokenMatches(n,numParts(x.localId).n));
  list=list.slice(0,limit);
  const details=await Promise.all(list.map(x=>fetchTCGdexCard(lang,x.id,x)));
  const out=details.filter(Boolean);
  out.fuzzyUsed=fuzzyUsed;
  out.fuzzyTerm=fuzzyTerm;
  return out;
}
function tcgplayerImageFromTCGdex(card){
  if(!card)return"";
  const ids=[];
  for(const variant of Array.isArray(card.variants_detailed)?card.variants_detailed:[]){
    const id=variant?.thirdParty?.tcgplayer||
      variant?.pricing?.tcgplayer?.holofoil?.productId||
      variant?.pricing?.tcgplayer?.normal?.productId||
      variant?.pricing?.tcgplayer?.reverseHolofoil?.productId;
    if(id)ids.push({id,size:String(variant?.size||"standard"),type:String(variant?.type||"")});
  }
  const root=card?.pricing?.tcgplayer||{};
  for(const key of Object.keys(root)){
    const id=root?.[key]?.productId;
    if(id)ids.push({id,size:"standard",type:key});
  }
  const chosen=ids.find(x=>x.size==="standard")||ids[0];
  if(!chosen?.id)return"";
  const direct="https://tcgplayer-cdn.tcgplayer.com/product/"+encodeURIComponent(String(chosen.id))+"_in_1000x1000.jpg";
  return "/api/image-proxy?url="+encodeURIComponent(direct);
}
async function hydrateMissingCatalogImage(card,lang){
  if(!card||cardImage(card))return card;

  // First choice for missing scans: resolve the exact TCGdex printing. If its
  // localized scan is absent, the server uses the TCGplayer product id carried
  // by that exact TCGdex record. This prevents blank Promo thumbnails.
  if(card.apiId){
    try{
      const p=new URLSearchParams({id:card.apiId,lang:lang||card.languageCode||"en"});
      const url="/api/tcgdex-card-image?"+p.toString();
      const probe=await fetch(url,{cache:"force-cache"});
      if(probe.ok){
        card.imageUrl=url;
        card.imageFallbackSource="TCGdex/TCGplayer · impressão exata";
        return card;
      }
    }catch(e){console.warn("Exact card image resolver",card.apiId,e)}
  }

  // Keep Limitless only as a later fallback; its image CDN can reject server-side requests.
  try{
    const p=new URLSearchParams({
      set:card.setId||card.setName||"",
      setName:card.setName||"",
      number:card.number||"",
      lang:lang||card.languageCode||"en"
    });
    const url="/api/limitless-image?"+p.toString();
    const probe=await fetch(url,{cache:"force-cache"});
    if(probe.ok){
      card.imageUrl=url;
      card.imageFallbackSource="Limitless TCG";
      return card;
    }
  }catch(e){console.warn("Limitless image fallback",card?.name,e)}

  // TCGdex can know the exact printing and TCGplayer product id while omitting
  // its own scan. Use that exact product id as the safest image fallback.
  if(card.apiId){
    try{
      const apiLang=tcgApiLang(lang||card.languageCode||"en");
      const r=await fetch(`${TCGDEX_BASE}/${apiLang}/cards/${encodeURIComponent(card.apiId)}`,{cache:"force-cache"});
      if(r.ok){
        const exact=await r.json();
        const tcgplayerImage=tcgplayerImageFromTCGdex(exact);
        if(tcgplayerImage){
          card.imageUrl=tcgplayerImage;
          card.imageFallbackSource="TCGplayer · impressão exata";
          return card;
        }
      }
    }catch(e){console.warn("TCGplayer image fallback",card.apiId,e)}
  }

  // Localized TCGdex records (especially PT promo sets) can have metadata but no image.
  // First try the exact same canonical card ID in EN, preserving PT metadata/language.
  if(lang!=="en"&&card.apiId){
    try{
      const r=await fetch(`${TCGDEX_BASE}/en/cards/${encodeURIComponent(card.apiId)}`,{cache:"force-cache"});
      if(r.ok){
        const en=await r.json();
        if(en?.image){
          card.imageUrl=en.image;
          card.imageFallbackSource="TCGdex EN · mesma impressão";
          return card;
        }
        const tcgplayerImage=tcgplayerImageFromTCGdex(en);
        if(tcgplayerImage){
          card.imageUrl=tcgplayerImage;
          card.imageFallbackSource="TCGplayer · mesma impressão";
          return card;
        }
      }
    }catch(e){console.warn("TCGdex image EN fallback",card.apiId,e)}
  }

  // Second safe fallback: resolve by name + collector number + set.
  try{
    const p=new URLSearchParams({
      name:card.name||"",
      number:card.number||"",
      hp:String(card.hp||""),
      rarity:card.rarity||"",
      set:card.setId||card.setName||""
    });
    const r=await fetch("/api/card-image-fallback?"+p.toString(),{cache:"force-cache"});
    if(r.ok){
      const j=await r.json();
      if(j?.ok&&j.url){
        card.imageUrl=j.url;
        card.imageFallbackSource=j.source||"fallback";
      }
    }
  }catch(e){console.warn("Catalog image fallback",card?.name,e)}
  return card;
}
async function fetchTCGdexCard(lang,id,fallback=null){
  const apiLang=tcgApiLang(lang),fb=()=>fallback?(fallback.source==="TCGdex"?fallback:mapTCG(fallback,lang)):null;
  try{
    const r=await fetch(`${TCGDEX_BASE}/${apiLang}/cards/${encodeURIComponent(id)}`);
    const card=r.ok?mapTCG(await r.json(),lang):fb();
    return await hydrateMissingCatalogImage(card,lang);
  }catch{
    return await hydrateMissingCatalogImage(fb(),lang);
  }
}
function mapTCG(c,lang){const s=c.set||{},local=String(c.localId||""),setId=s.id||"",total=String(s.cardCount?.official||"");const marketNumber=specialPrintedNumber(setId,local),originalNumber=specialOriginalNumber(setId,local),parts=numParts(marketNumber);const displayNumber=isAnniversaryClassicSet(setId)?marketNumber:(/^\d+$/.test(local)&&/^\d+$/.test(total)?String(Number(local))+"/"+String(Number(total)):local);let image=c.image||"";if(!image&&lang==="ja"){const p=new URLSearchParams({set:setId,localId:local,name:c.name||"",hp:String(c.hp||""),rarity:c.rarity||""});image="/api/jp-card-image?"+p.toString()}return{source:"TCGdex",apiId:c.id||"",name:c.name||"",languageCode:lang,language:LANG[lang]||lang,setName:s.name||s.id||"",setId,number:displayNumber,internalNumber:local,originalNumber,numberAliases:[local,displayNumber,originalNumber].filter(Boolean),printedTotal:parts.rawD||total,rarity:c.rarity||"",type:Array.isArray(c.types)?c.types.join(", "):(c.category||""),category:c.category||"",hp:c.hp??null,imageUrl:image,imageFallbackJa:!c.image&&lang==="ja",pricing:c.pricing||null}}
function rank(cards,q){
  const qn=norm(q.name),num=numParts(q.number),set=norm(q.setHint);
  return [...cards].sort((a,b)=>score(b)-score(a));
  function score(c){
    let s=0,cn=norm(c.name),cs=norm(c.setName),ci=norm(c.setId),nn=numParts(c.number).n;
    if(c.source==="MYP Cards")s+=140+(+c.marketScore||0)*.15;
    if(c.source==="Pokémon Japão Oficial")s+=230;
    if(c.languageCode==="pt-br")s+=320;else if(c.languageCode==="en")s+=100;else if(c.languageCode==="ja")s+=70;
    if(q.language!=="all"&&c.languageCode===q.language)s+=250;
    if(qn){
      if(cn===qn)s+=720;
      else if(cn.startsWith(qn))s+=520;
      else if(cn.includes(qn)||qn.includes(cn))s+=390;
      else{
        const sim=nameSimilarity(qn,cn);
        if(sim>=.9)s+=360;
        else if(sim>=.8)s+=260;
        else if(sim>=.68)s+=120;
        else s-=180;
      }
    }
    if(num.n){
      if(cardNumberMatches(q.number,c))s+=910;
      else s-=420;
    }
    if(set){
      if(cs===set||ci===set)s+=760;
      else if(cs.startsWith(set)||ci.startsWith(set))s+=620;
      else if(cs.includes(set)||set.includes(cs)||ci.includes(set)||set.includes(ci))s+=500;
      else{
        const sim=Math.max(nameSimilarity(set,cs),nameSimilarity(set,ci));
        if(sim>=.88)s+=380;
        else if(sim>=.76)s+=220;
        else if(sim>=.62)s+=80;
        else s-=360;
      }
    }
    if(c.market?.avg||c.market?.min)s+=70;
    if(c.imageUrl)s+=15;
    return s;
  }
}
function dedupe(a){const seen=new Set;return a.filter(c=>{const k=[c.source,c.apiId,c.languageCode,c.name,c.number,c.setId].join("|");if(seen.has(k))return false;seen.add(k);return true})}
async function searchTCGdexClean(lang,name,number,{setIds=[],live=false}={}){
  const apiLang=tcgApiLang(lang);
  const rawName=String(name||"").trim();
  const wanted=numParts(number);
  const localId=wanted.rawN||wanted.n;
  const seen=new Map();

  const add=items=>{
    for(const item of items||[]){
      if(item?.id&&!seen.has(item.id))seen.set(item.id,item);
    }
  };

  // Selected collection/generation is authoritative.
  if(Array.isArray(setIds)&&setIds.length){
    const sets=(await Promise.all(setIds.map(id=>fetchTCGdexSet(lang,id)))).filter(Boolean);
    let pool=[];
    for(const set of sets){
      for(const item of Array.isArray(set.cards)?set.cards:[])pool.push(mapTCGSetBrief(item,set,lang));
    }
    if(rawName)pool=pool.filter(card=>catalogNameMatches(rawName,card));
    if(String(number||"").trim())pool=pool.filter(card=>cardNumberMatches(number,card));
    pool=pool.slice(0,live?40:120);
    return (await Promise.all(pool.map(card=>fetchTCGdexCard(lang,card.apiId,card)))).filter(Boolean);
  }

  // First pass: exact API intersection.
  if(rawName&&localId)add(await fetchTCGdexList(apiLang,{name:rawName,localId}));
  if(rawName)add(await fetchTCGdexList(apiLang,{name:rawName}));

  // If the API does not understand a typo but a number was supplied, fetch
  // that collector number and let the strict name matcher choose the card.
  if(rawName&&localId&&seen.size===0)add(await fetchTCGdexList(apiLang,{localId}));

  // Name-only typo fallback: use progressively shorter prefixes, but still
  // apply strict local matching before anything is rendered.
  if(rawName&&seen.size===0){
    for(const prefix of fuzzyNamePrefixes(rawName)){
      add(await fetchTCGdexList(apiLang,{name:prefix}));
      if(seen.size)break;
    }
  }

  // Number-only search remains supported.
  if(!rawName&&localId)add(await fetchTCGdexList(apiLang,{localId}));

  let list=[...seen.values()];
  if(rawName)list=list.filter(item=>catalogNameMatches(rawName,{name:item.name||""}));
  if(String(number||"").trim()){
    list=list.filter(item=>collectorNumberMatches(number,item.localId||item.id||""));
  }
  list=list.slice(0,live?36:100);

  return (await Promise.all(list.map(item=>fetchTCGdexCard(lang,item.id,mapTCG(item,lang))))).filter(Boolean);
}

function cleanCatalogDedupe(cards){
  const byKey=new Map();
  for(const card of cards||[]){
    if(!card?.name)continue;
    const key=[
      norm(card.name),
      norm(card.setId||card.setName),
      norm(numParts(card.number||card.internalNumber).full||card.number||card.internalNumber),
      norm(card.languageCode)
    ].join("|");
    const old=byKey.get(key);
    if(!old){
      byKey.set(key,card);
      continue;
    }
    // Prefer the result with a usable image, then MYP metadata.
    const oldScore=(cardImage(old)?10:0)+(old.source==="MYP Cards"?2:0);
    const newScore=(cardImage(card)?10:0)+(card.source==="MYP Cards"?2:0);
    if(newScore>oldScore)byKey.set(key,card);
  }
  return [...byKey.values()];
}

// An explicit search (button, Enter, collection) queries MYP too and takes a
// few seconds. A live typing search must not start meanwhile: it would get a
// newer sequence number and make the explicit results be discarded.
let catalogExplicitSearch=false;
async function searchCards(options={}){
  const live=!!options.live;
  if(live&&catalogExplicitSearch)return;
  if(!live){clearTimeout(catalogSearchTimer);clearTimeout(catalogAutoFullTimer);catalogExplicitSearch=true}
  const requestId=++catalogSearchSeq;

  let name=$("searchName").value.trim();
  let number=$("searchNumber").value.trim();
  const language=$("searchLanguage").value;

  const seriesEl=$("searchSeries");
  const setEl=$("searchSet");
  const hasGeneration=!!(seriesEl&&seriesEl.selectedIndex>0);
  const hasSet=!!(setEl&&setEl.selectedIndex>0&&String(setEl.value||"").trim());
  const selectedSetId=hasSet?String(setEl.value||"").trim():"";
  const selectedSetLabel=hasSet?String(setEl.selectedOptions?.[0]?.textContent||"").trim():"";
  const generationLabel=hasGeneration?String(seriesEl.selectedOptions?.[0]?.textContent||"").trim():"";

  // "Pikachu 25/102" in the name field is allowed, but EX/GX/V are NEVER
  // interpreted as collection names.
  const inline=name.match(/^(.*?)(?:\s+)([A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4})(?:\/([A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4}))?$/);
  if(inline&&!number){
    name=inline[1].trim();
    number=inline[2]+(inline[3]?"/"+inline[3]:"");
  }

  if(!name&&!number&&!hasSet&&!hasGeneration){
    catalogExplicitSearch=false;
    catalogResults=[];
    populateRarityFilter();
    renderCatalog();
    $("searchStatus").textContent="";
    return;
  }

  if(live&&!number&&norm(name).replace(/\s+/g,"").length<2&&!hasSet&&!hasGeneration){
    catalogResults=[];
    populateRarityFilter();
    renderCatalog();
    $("searchStatus").textContent="Digite pelo menos 2 letras.";
    return;
  }

  const button=$("btnSearchCards");
  if(!live)busy(button,true,"Buscando...");
  $("searchStatus").textContent=live?"Buscando…":(name?"Buscando no TCGdex e na MYP…":"Buscando cartas…");

  try{
    const langs=language==="all"?["pt-br","en","ja"]:[language];

    let setIds=[];
    if(hasSet){
      setIds=[selectedSetId];
    }else if(hasGeneration){
      setIds=[...new Set([...(setEl?.options||[])]
        .map(option=>String(option.value||"").trim())
        .filter(Boolean))];
    }

    const tcgPromise=Promise.all(
      langs.map(lang=>searchTCGdexClean(lang,name,number,{setIds,live}))
    );

    // MYP is a secondary PT-BR source. It may add old/special printings that
    // TCGdex lacks, but it never bypasses the same final filters.
    // MYP (server-side search) only on explicit searches: button, Enter,
    // collection change. Live typing stays on TCGdex.
    const mypPromise=(name&&!live)
      ? searchMypCards(name,number,hasSet?selectedSetLabel:"",language)
      : Promise.resolve({cards:[],needsToken:false});
    const mypCodesPromise=setIds.length?mypCodesForSets(setIds):Promise.resolve(new Set());

    const jpPromise=(name&&(language==="all"||language==="ja"))
      ? searchJapaneseOfficial(name,number,hasSet?selectedSetLabel:"",{live})
      : Promise.resolve([]);

    const [tcgGroups,mypResult,jpCards,wantedMypCodes]=await Promise.all([tcgPromise,mypPromise,jpPromise,mypCodesPromise]);
    if(requestId!==catalogSearchSeq)return;

    let pool=[
      ...tcgGroups.flat(),
      ...(mypResult?.cards||[]),
      ...(jpCards||[])
    ];

    // One final deterministic intersection. Every supplied criterion is mandatory.
    pool=pool.filter(card=>{
      if(language!=="all"&&card.languageCode!==language)return false;
      if(name&&!catalogNameMatches(name,card))return false;
      if(number&&!cardNumberMatches(number,card))return false;
      if(setIds.length){
        const cid=String(card.setId||card.set_id||"");
        if(cid&&setIds.includes(cid))return true;
        // MYP results carry MYP set codes (30CC, SIT...): accept them when the
        // code belongs to the selected collection(s).
        if(card.source==="MYP Cards"){
          return !!card.setCode&&wantedMypCodes.has(String(card.setCode).toUpperCase());
        }
        return false;
      }
      return true;
    });

    const poolSets=[...new Set(pool.filter(c=>c.source!=="MYP Cards").map(c=>String(c.setId||"")).filter(Boolean))].slice(0,40);
    const codeBySet=new Map(await Promise.all(poolSets.map(async id=>[id,await mypCodeForSet(id)])));
    pool=mergeMypIntoCatalog(pool,card=>codeBySet.get(String(card.setId||""))||"");
    pool=cleanCatalogDedupe(pool);

    // Rank only after filtering; ranking can never make an unrelated card appear.
    catalogResults=rank(pool,{
      name,
      number,
      setHint:hasSet?selectedSetLabel:"",
      language
    }).slice(0,hasSet||hasGeneration?400:120);

    populateRarityFilter();
    renderCatalog();

    // Image hydration is asynchronous and never changes search identity.
    const missing=catalogResults.filter(card=>!cardImage(card)).slice(0,120);
    if(missing.length){
      (async()=>{
        let cursor=0;
        const workers=Math.min(6,missing.length);
        const run=async()=>{
          while(requestId===catalogSearchSeq){
            const index=cursor++;
            if(index>=missing.length)return;
            const card=missing[index];
            await hydrateMissingCatalogImage(card,card.languageCode||language||"en");
            if(index%4===0&&requestId===catalogSearchSeq)renderCatalog();
          }
        };
        await Promise.all(Array.from({length:workers},run));
        if(requestId===catalogSearchSeq)renderCatalog();
      })().catch(e=>console.warn("Catalog image hydration",e));
    }

    const br=catalogResults.filter(card=>card.languageCode==="pt-br").length;
    const criteria=[
      name&&`nome “${name}”`,
      number&&`nº ${number}`,
      hasSet&&`coleção “${selectedSetLabel}”`,
      !hasSet&&hasGeneration&&`geração “${generationLabel}”`,
      language!=="all"&&LANG[language]
    ].filter(Boolean).join(" + ");

    $("searchStatus").textContent=
      `${catalogResults.length} resultado(s) · ${br} em português${criteria?` · correspondendo a: ${criteria}`:""}.`+(mypResult?.message?` ${mypResult.message}`:"");
  }catch(error){
    if(requestId!==catalogSearchSeq)return;
    console.error("[Catálogo V16]",error);
    catalogResults=[];
    populateRarityFilter();
    renderCatalog();
    $("searchStatus").textContent="Erro ao buscar cartas.";
  }finally{
    if(!live&&requestId===catalogSearchSeq){catalogExplicitSearch=false;busy(button,false)}
  }
}

let catalogAutoFullTimer=null;
function queueLiveCatalogSearch(delay=420){
  clearTimeout(catalogSearchTimer);
  catalogSearchTimer=setTimeout(()=>searchCards({live:true}),delay);
  // When typing pauses, run the full search (TCGdex + MYP) automatically, so
  // new sets and promos appear without clicking "Buscar".
  clearTimeout(catalogAutoFullTimer);
  catalogAutoFullTimer=setTimeout(()=>{
    if(norm($("searchName")?.value||"").replace(/s+/g,"").length>=3)searchCards({live:false});
  },1500);
}
function isPromoCard(c){
  if(!c)return false;
  if(c.isPromo===true)return true;
  return /promo|black star/i.test(String(c.rarity||"")+" "+String(c.setName||"")+" "+String(c.setId||""));
}
function rarityMatches(c,rar){
  if(rar==="all")return true;
  if(rar==="Promo")return isPromoCard(c);
  return c.rarity===rar;
}
function populateRarityFilter(){const sel=$("resultRarityFilter"),current=sel.value;const rs=[...new Set(catalogResults.map(c=>c.rarity).filter(Boolean))];if(catalogResults.some(isPromoCard)&&!rs.includes("Promo"))rs.push("Promo");rs.sort();sel.innerHTML='<option value="all">Todas as raridades</option>'+rs.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join("");if(rs.includes(current))sel.value=current}
function renderCatalog(){const g=$("resultsList"),rar=$("resultRarityFilter").value;g.innerHTML="";catalogResults.filter(c=>rarityMatches(c,rar)).forEach(c=>{const key=cardKey(c),sel=catalogSelection.has(key),el=document.createElement("button");el.type="button";el.className="catalog-card"+(sel?" selected":"");const img=cardImage(c),p=c.market?.avg||c.market?.min||0,native=c.nativeName&&norm(c.nativeName)!==norm(c.name)?`<small class="catalog-native">${esc(c.nativeName)}</small>`:"",setLabel=c.setTitle&&norm(c.setTitle)!==norm(c.setName)?`${c.setName||"-"} · ${c.setTitle}`:(c.setName||"-");el.innerHTML=`<span class="catalog-check">✓</span>${img?`<img src="${esc(img)}" loading="lazy">`:""}<h3>${esc(c.name)}</h3>${native}<p>${esc(setLabel)} · ${esc(c.number||"-")}</p><div class="catalog-tags"><span>${esc(c.language||"-")}</span>${c.languageCode==="pt-br"?'<span class="br">PT-BR</span>':""}${c.source==="Pokémon Japão Oficial"?'<span>JP oficial</span>':""}${c.rarity?`<span>${esc(c.rarity)}</span>`:""}${p?`<span class="br">${money(p)}</span>`:""}</div>`;el.onclick=()=>toggleCatalogCard(c);g.appendChild(el)})}
function toggleCatalogCard(c){const k=cardKey(c);catalogSelection.has(k)?catalogSelection.delete(k):catalogSelection.set(k,c);renderCatalog();updateSelectionTray()}
function updateSelectionTray(){const n=catalogSelection.size;$("selectedCount").textContent=`${n} carta${n===1?"":"s"} escolhida${n===1?"":"s"}`;$("btnAddSelected").disabled=!n}
async function findMarket(c){if(c.market&&(c.market.min||c.market.avg||c.market.max))return c.market;const m=await searchMypCards(c.namePt||c.name,c.number,c.setId||c.setName);if(m.cards.length){const r=rank(m.cards,{name:c.namePt||c.name,number:c.number,setHint:c.setId||c.setName,language:"pt-br"});if(r[0]?.market)return r[0].market}return{source:"MYP Cards",needsToken:m.needsToken,min:0,avg:0,max:0,link:""}}
function inferFinish(c){const r=norm(c.rarity);if(r.includes("holo"))return"Holo";if(r.includes("full art")||r.includes("ultra"))return"Full-Art";if(norm(c.setName).includes("promo"))return"Promo";return"Normal"}
async function addSelectedCards(){const cards=[...catalogSelection.values()];if(!cards.length)return;const b=$("btnAddSelected");busy(b,true,"Adicionando...");try{const positions=freePositions(pendingPosition?.page||currentPage,cards.length);const maxPage=Math.max(...positions.map(p=>p.page));if(maxPage>+settings.binder_pages)await updateSettings({binder_pages:maxPage},true);for(let i=0;i<cards.length;i++){const c=cards[i],pos=positions[i],market=await findMarket(c),payload=cardPayload(c,{page:pos.page,slot:pos.slot,status:"owned",quantity:1,condition:"Nova",finish:inferFinish(c),notes:""},market);const{data:existing}=await db.from("pokemon_cards").select("id,quantity").eq("user_id",currentUser.id).eq("card_key",payload.card_key).eq("condition",payload.condition).eq("finish",payload.finish).maybeSingle();if(existing)await db.from("pokemon_cards").update({quantity:(+existing.quantity||0)+1}).eq("id",existing.id).eq("user_id",currentUser.id);else{const{error}=await db.from("pokemon_cards").insert(payload);if(error)throw error}}catalogSelection.clear();closeDialog("addDialog");currentPage=positions[0]?.page||currentPage;await loadCards(false);toast(`${cards.length} carta${cards.length===1?"":"s"} adicionada${cards.length===1?"":"s"}.`)}catch(e){console.error(e);toast("Não consegui adicionar todas as cartas.")}finally{busy(b,false)}}
function cardPayload(c,v,m={}){return{user_id:currentUser.id,card_key:cardKey(c),api_source:c.source||"catalog",api_id:c.apiId||"",name:c.name||"",language_code:c.languageCode||"",language:c.language||"",set_name:c.setName||"",set_id:c.setId||"",number:c.number||"",rarity:c.rarity||"",card_type:c.type||"",image_url:cardImage(c),quantity:v.status==="owned"?Math.max(1,+v.quantity||1):0,condition:v.condition||"Nova",finish:v.finish||"Normal",collection_status:v.status||"owned",binder_page:+v.page||1,binder_slot:+v.slot||1,price_min:+m.min||0,price_avg:+m.avg||0,price_max:+m.max||0,currency:"BRL",price_source:m.min||m.avg||m.max?"MYP Cards":"Sem preço BR",price_link:m.link||ligaUrl(c),price_br_source:m.min||m.avg||m.max?"MYP Cards":null,price_br_link:m.link||null,myp_price_link:m.link||c.mypLink||null,market_internal_code:m.internalCode||c.marketInternalCode||null,market_name_pt:m.namePt||c.namePt||null,market_edition_pt:m.editionPt||null,market_image_pt:m.imagePt||c.imagePt||null,market_image_en:m.imageEn||c.imageEn||null,price_checked_at:new Date().toISOString(),notes:v.notes||""}}
async function chooseCatalogCard(c){selectedCard=c;editingCardId=null;selectedStatus="owned";selectedMarket=null;if(!pendingPosition)pendingPosition=freePositions(currentPage,1)[0];fillInspector(c,{...pendingPosition,quantity:1,condition:"Nova",finish:inferFinish(c),notes:"",status:"owned"});closeDialog("addDialog");openDialog("cardDialog");await refreshMarket()}
function fillInspector(c,v){$("selectedTitle").textContent=c.name||"Carta";$("selectedMeta").textContent=`${c.setName||c.set_name||"-"} · ${c.language||"-"}`;$("selectedLangBadge").textContent=c.language||"";$("detailRarity").textContent=c.rarity?`Raridade · ${c.rarity}`:"Raridade · —";$("detailType").textContent=c.type?`Tipo · ${c.type}`:"Tipo · —";$("detailNumber").textContent=`# ${c.number||"—"}`;const img=cardImage(c);$("card3dImage").src=img||"";$("card3d").classList.remove("flipped");$("cardQuantity").value=v.quantity??1;$("cardCondition").value=v.condition||"Nova";$("cardFinish").value=v.finish||"Normal";$("cardPage").value=v.page||currentPage;$("cardSlot").value=v.slot||1;$("cardNotes").value=v.notes||"";$("btnDeleteSelected").classList.toggle("hidden",!editingCardId);setSelectedStatus(v.status||"owned");$("ligaSearchLink").href=ligaUrl(c);$("mypcardsLink").classList.add("hidden");setPrices(0,0,0);$("marketStatus").textContent="Consultando mercado brasileiro...";$("globalPriceLine").textContent=c.pricing?"TCGdex também possui referência de mercado global para esta impressão.":""}
async function refreshMarket(){if(!selectedCard)return;const m=await findMarket(selectedCard);selectedMarket=m;setPrices(m.min,m.avg,m.max);if(m.link){$("mypcardsLink").href=m.link;$("mypcardsLink").classList.remove("hidden")}$("marketStatus").textContent=m.min||m.avg||m.max?`MYP Cards · ${m.availableQuantity??"?"} oferta(s)`:m.needsToken?"MYP Cards aguardando chave API":"Sem cotação BR automática agora"}
const setPrices=(a,b,c)=>{$("priceMinLabel").textContent=a?money(a):"—";$("priceAvgLabel").textContent=b?money(b):"—";$("priceMaxLabel").textContent=c?money(c):"—"};
function setSelectedStatus(s){selectedStatus=s;document.querySelectorAll("[data-card-status]").forEach(b=>b.classList.toggle("active",b.dataset.cardStatus===s));if(s!=="owned")$("cardQuantity").value=0;else if(+$("cardQuantity").value<1)$("cardQuantity").value=1}
function openExistingCard(c,focus3d=false){editingCardId=c.id;selectedStatus=c.collection_status||"owned";selectedMarket={min:+c.price_min||0,avg:+c.price_avg||0,max:+c.price_max||0,link:c.price_br_link||c.price_link||"",source:c.price_br_source||c.price_source||"",internalCode:c.market_internal_code,namePt:c.market_name_pt,editionPt:c.market_edition_pt,imagePt:c.market_image_pt,imageEn:c.market_image_en};selectedCard={source:c.api_source||"saved",apiId:c.api_id||"",name:c.name,languageCode:c.language_code,language:c.language,setName:c.set_name,setId:c.set_id,number:c.number,rarity:c.rarity,type:c.card_type,imageUrl:c.image_url,pricing:null,marketInternalCode:c.market_internal_code};pendingPosition={page:c.binder_page||1,slot:c.binder_slot||1};fillInspector(selectedCard,{page:c.binder_page,slot:c.binder_slot,quantity:c.quantity,condition:c.condition,finish:c.finish,notes:c.notes,status:selectedStatus});setPrices(c.price_min,c.price_avg,c.price_max);if(selectedMarket.link){$("mypcardsLink").href=selectedMarket.link;$("mypcardsLink").classList.remove("hidden")}$("marketStatus").textContent=+c.price_avg?`Última cotação: ${c.price_br_source||c.price_source||"mercado BR"}`:"Sem cotação BR salva";openDialog("cardDialog");if(!focus3d)refreshMarket()}
async function saveSelectedCard(){if(!selectedCard)return;const b=$("btnSaveCard"),page=Math.max(1,+$("cardPage").value||1),slot=Math.min(9,Math.max(1,+$("cardSlot").value||1)),condition=$("cardCondition").value,finish=$("cardFinish").value,quantity=selectedStatus==="owned"?Math.max(1,+$("cardQuantity").value||1):0,occ=getCardAt(page,slot);if(occ&&occ.id!==editingCardId){toast("Esse bolso está ocupado. Arraste a carta para trocar de lugar.");return}busy(b,true,"Salvando...");try{if(page>+settings.binder_pages)await updateSettings({binder_pages:page},true);const payload=cardPayload(selectedCard,{page,slot,status:selectedStatus,quantity,condition,finish,notes:$("cardNotes").value.trim()},selectedMarket||{});if(editingCardId){const{error}=await db.from("pokemon_cards").update(payload).eq("id",editingCardId).eq("user_id",currentUser.id);if(error)throw error}else{const{data:existing,error:e}=await db.from("pokemon_cards").select("id,quantity").eq("user_id",currentUser.id).eq("card_key",payload.card_key).eq("condition",condition).eq("finish",finish).maybeSingle();if(e)throw e;if(existing){const{error}=await db.from("pokemon_cards").update({...payload,user_id:undefined,quantity:selectedStatus==="owned"?(+existing.quantity||0)+quantity:0}).eq("id",existing.id).eq("user_id",currentUser.id);if(error)throw error}else{const{error}=await db.from("pokemon_cards").insert(payload);if(error)throw error}}closeDialog("cardDialog");editingCardId=null;await loadCards(false);toast("Carta salva.")}catch(e){console.error(e);toast(`Erro ao salvar: ${e.message||"tente novamente"}`)}finally{busy(b,false)}}
async function deleteSelectedCard(){if(!editingCardId)return;const c=collection.find(x=>x.id===editingCardId);if(!c||!confirm(`Excluir ${c.name}?`))return;const{error}=await db.from("pokemon_cards").delete().eq("id",editingCardId).eq("user_id",currentUser.id);if(error)return toast("Não consegui excluir.");closeDialog("cardDialog");editingCardId=null;await loadCards(false);toast("Carta excluída.")}
async function ensureOCR(){if(window.Tesseract)return true;if(ocrLoaded)return!!window.Tesseract;ocrLoaded=true;return new Promise(r=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";s.onload=()=>r(true);s.onerror=()=>r(false);document.head.appendChild(s)})}
async function usePhotoHints(){const f=$("cardPhoto").files?.[0];if(!f)return toast("Tire uma foto primeiro.");$("ocrStatus").textContent="Lendo pistas...";if(!await ensureOCR())return $("ocrStatus").textContent="OCR indisponível.";try{const r=await Tesseract.recognize(f,"por+eng",{logger:m=>{if(m.progress)$("ocrStatus").textContent=`Lendo ${Math.round(m.progress*100)}%`}}),t=r?.data?.text||"",num=t.match(/(\d{1,4})\s*\/\s*(\d{1,4})/),lines=t.split(/\n+/).map(v=>v.replace(/[^\p{L}\p{N}\s.'-]/gu," ").replace(/\s+/g," ").trim()).filter(v=>v.length>2),name=lines.find(v=>!(/^(basico|basic|hp|habilidade|ability|trainer|treinador)/i.test(v)));if(name&&!$("searchName").value)$("searchName").value=name.replace(/\bHP\s*\d+.*/i,"").trim();if(num)$("searchNumber").value=`${num[1]}/${num[2]}`;$("ocrStatus").textContent="Pistas preenchidas. O reconhecimento visual definitivo virá depois.";searchCards()}catch(e){$("ocrStatus").textContent="OCR não conseguiu ler esta carta. Use a busca visual/manual."}}
async function saveAppearance(){await updateSettings({binder_name:$("binderNameInput").value.trim()||"Meu Fichário",binder_background:document.querySelector(".theme-swatch.active")?.dataset.theme||"graphite"});renderAll();closeDialog("appearanceDialog");toast("Aparência salva.")}
function exportCSV(){const h=["Nome","Coleção","Número","Idioma","Status","Quantidade","Condição","Acabamento","Preço médio BR","Página","Bolso","Link"],rows=collection.map(c=>[c.name,c.set_name,c.number,c.language,STATUS[c.collection_status],c.quantity,c.condition,c.finish,c.price_avg,c.binder_page,c.binder_slot,c.price_br_link||c.price_link]),csv=[h,...rows].map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\n"),blob=new Blob(["\ufeff"+csv],{type:"text/csv"}),u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download="pokemon-fichario.csv";a.click();URL.revokeObjectURL(u)}
async function loadFriendships(){
  const{data,error}=await db.from("pokemon_friendships")
    .select("*")
    .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`)
    .order("created_at",{ascending:false});
  if(error)throw error;
  friendships=data||[];
  const ids=[...new Set(friendships.flatMap(f=>[f.requester_id,f.addressee_id]).filter(x=>x!==currentUser.id))];
  profilesById=new Map();
  if(ids.length){
    const{data:p,error:pe}=await db.from("pokemon_profiles")
      .select("user_id,username,display_name,avatar_url,binder_visibility")
      .in("user_id",ids);
    if(pe)throw pe;
    (p||[]).forEach(x=>profilesById.set(x.user_id,x));
  }
  renderFriends();
}
async function openFriendsPanel(){
  if(!currentUser)return toast("Entre na sua conta para usar Amigos.");
  try{
    // O painel social deve abrir mesmo se a barra superior tiver sido recriada
    // pela camada V14 ou se o perfil ainda não existir.
    if(!currentProfile)await loadCurrentProfile().catch(()=>null);
    await loadFriendships();
    openDialog("friendsDialog");
  }catch(error){
    console.error("[Amigos]",error);
    toast("Não consegui carregar Amigos agora.");
  }
}
window.openPokemonFriends=openFriendsPanel;

function socialItem(p,actions){
  const e=document.createElement("div");
  e.className="social-item";
  const visibility=p?.binder_visibility==="public"?"Público":p?.binder_visibility==="private"?"Privado":"Amigos";
  e.innerHTML=`<div class="v1451-social-copy"><strong>@${esc(p?.username||"usuário")}</strong><small>${esc(p?.display_name||"")}</small><em>${esc(visibility)}</em></div><div class="social-actions"></div>`;
  actions.forEach(a=>{
    const b=document.createElement("button");
    b.type="button";
    b.textContent=a.label;
    if(a.kind)b.className=a.kind;
    b.disabled=!!a.disabled;
    b.onclick=a.action;
    e.querySelector(".social-actions").appendChild(b);
  });
  return e;
}
function renderFriends(){
  const r=$("friendRequests"),f=$("friendsList");
  r.innerHTML=f.innerHTML="";
  const rec=friendships.filter(x=>x.status==="pending"&&x.addressee_id===currentUser.id);
  const sent=friendships.filter(x=>x.status==="pending"&&x.requester_id===currentUser.id);
  const acc=friendships.filter(x=>x.status==="accepted");
  if(!rec.length)r.innerHTML='<p class="muted">Nenhum pedido recebido.</p>';
  rec.forEach(x=>r.appendChild(socialItem(profilesById.get(x.requester_id),[
    {label:"Aceitar",kind:"primary",action:()=>updateFriendship(x.id,"accepted")},
    {label:"Recusar",kind:"danger",action:()=>removeFriendship(x.id)}
  ])));
  if(sent.length){
    const h=document.createElement("p");h.className="v1451-sent-title";h.textContent="Pedidos enviados";r.appendChild(h);
    sent.forEach(x=>r.appendChild(socialItem(profilesById.get(x.addressee_id),[
      {label:"Pendente",disabled:true,action:()=>{}},
      {label:"Cancelar",kind:"danger",action:()=>removeFriendship(x.id)}
    ])));
  }
  if(!acc.length)f.innerHTML='<p class="muted">Adicione amigos para compartilhar seus fichários.</p>';
  acc.forEach(x=>{
    const id=x.requester_id===currentUser.id?x.addressee_id:x.requester_id,p=profilesById.get(id);
    f.appendChild(socialItem(p,[
      {label:"Ver fichários",kind:"primary",action:()=>viewFriendBinders(p)},
      {label:"Remover",kind:"danger",action:()=>removeFriendship(x.id)}
    ]));
  });
}
async function searchFriends(){
  const q=$("friendSearch").value.trim().replace(/^@/,""),box=$("friendSearchResults");
  box.innerHTML="";
  if(q.length<2)return toast("Digite pelo menos 2 caracteres.");
  const{data,error}=await db.from("pokemon_profiles")
    .select("user_id,username,display_name,avatar_url,binder_visibility")
    .ilike("username",`%${q}%`)
    .neq("user_id",currentUser.id)
    .limit(20);
  if(error)return toast("Erro na busca.");
  if(!data?.length)return box.innerHTML='<p class="muted">Nenhum usuário encontrado.</p>';
  data.forEach(p=>{
    const ex=friendships.find(f=>(f.requester_id===p.user_id||f.addressee_id===p.user_id));
    const actions=ex
      ? [{label:ex.status==="accepted"?"Amigo":"Pendente",disabled:true,action:()=>{}}]
      : [{label:"Adicionar",kind:"primary",action:()=>sendFriendRequest(p.user_id)}];
    if(ex?.status==="accepted")actions.push({label:"Ver fichários",action:()=>viewFriendBinders(p)});
    box.appendChild(socialItem(p,actions));
  });
}
async function sendFriendRequest(id){
  const existing=friendships.find(f=>f.requester_id===id||f.addressee_id===id);
  if(existing)return toast(existing.status==="accepted"?"Vocês já são amigos.":"Já existe um pedido pendente.");
  const{error}=await db.from("pokemon_friendships").insert({requester_id:currentUser.id,addressee_id:id,status:"pending"});
  if(error)return toast("Não consegui enviar o pedido.");
  await loadFriendships();
  await searchFriends();
  toast("Pedido enviado.");
}
async function updateFriendship(id,status){
  const{error}=await db.from("pokemon_friendships").update({status,updated_at:new Date().toISOString()}).eq("id",id);
  if(error)return toast("Erro ao atualizar.");
  await loadFriendships();
  toast("Pedido aceito.");
}
async function removeFriendship(id){
  const{error}=await db.from("pokemon_friendships").delete().eq("id",id);
  if(error)return toast("Não consegui remover.");
  await loadFriendships();
}
function friendBinderAnchor(page,pages){
  page=Math.min(Math.max(1,+page||1),Math.max(1,+pages||1));
  if(page<=1)return 1;
  return page%2===0?page:page-1;
}
function friendBinderLastAnchor(pages){
  return friendBinderAnchor(Math.max(1,+pages||1),pages);
}
function friendCardHtml(card){
  const img=cardImage(card);
  const status=STATUS[card.collection_status||"owned"]||"";
  return '<div class="v1451-friend-card" title="'+esc([card.name,card.set_name,card.number].filter(Boolean).join(" · "))+'">'+
    (img?'<img src="'+esc(img)+'" alt="'+esc(card.name||"Carta")+'" loading="lazy">':'<span>'+esc(card.name||"Carta")+'</span>')+
    '<b>'+esc(status)+'</b>'+
    '</div>';
}
function friendPageHtml(page){
  let html='<section class="v1451-friend-page" data-page="'+page+'"><span class="v1451-friend-page-number">Página '+page+'</span><div class="v1451-friend-pockets">';
  for(let slot=1;slot<=9;slot++){
    const card=friendViewer.cards.find(c=>+(c.binder_page||1)===+page&&+(c.binder_slot||0)===slot);
    html+='<div class="v1451-friend-pocket">'+(card?friendCardHtml(card):'')+'</div>';
  }
  return html+'</div></section>';
}
function renderFriendBinder(){
  const binder=friendViewer.binders.find(b=>String(b.id)===String(friendViewer.binderId));
  const spread=$("friendBinderSpread"),label=$("friendBinderPageLabel");
  if(!spread||!binder)return;
  const pages=Math.max(1,+binder.pages||1);
  friendViewer.page=friendBinderAnchor(friendViewer.page,pages);
  const p=friendViewer.page;
  const second=p>=2&&p+1<=pages?p+1:null;
  spread.className="v1451-friend-spread"+(second?" double":"");
  spread.innerHTML=friendPageHtml(p)+(second?friendPageHtml(second):"");
  label.textContent=second?`Páginas ${p}–${second} · ${pages} páginas`:`Página ${p} · ${pages} páginas`;
  $("friendBinderMeta").textContent=[binder.binder_kind==="set"?"Master Set":"Fichário",binder.set_name,binder.set_language].filter(Boolean).join(" · ");
  $("friendBinderPrev").disabled=p<=1;
  $("friendBinderNext").disabled=p>=friendBinderLastAnchor(pages);
}
async function loadFriendBinderSelection(id,resetPage=true){
  const binder=friendViewer.binders.find(b=>String(b.id)===String(id));
  if(!binder)return;
  friendViewer.binderId=binder.id;
  if(resetPage)friendViewer.page=1;
  $("friendBinderSelect").value=String(binder.id);
  $("friendBinderStatus").textContent="Carregando fichário…";
  const{data,error}=await db.from("pokemon_cards")
    .select("id,name,set_name,number,image_url,market_image_pt,market_image_en,collection_status,binder_page,binder_slot,quantity")
    .eq("user_id",friendViewer.profile.user_id)
    .eq("binder_id",binder.id)
    .order("binder_page")
    .order("binder_slot");
  if(error){
    console.error("[Amigos fichário]",error);
    friendViewer.cards=[];
    $("friendBinderStatus").textContent="Este fichário não está disponível para sua conta.";
    renderFriendBinder();
    return;
  }
  friendViewer.cards=data||[];
  $("friendBinderStatus").textContent=`${friendViewer.cards.length} cartas · somente leitura`;
  renderFriendBinder();
}
async function viewFriendBinders(p){
  if(!p)return;
  friendViewer={profile:p,binders:[],binderId:null,cards:[],page:1};
  $("friendBinderTitle").textContent=`@${p.username||"usuário"}`;
  $("friendBinderStatus").textContent="Carregando fichários…";
  $("friendBinderMeta").textContent="";
  $("friendBinderSpread").innerHTML="";
  const{data,error}=await db.from("pokemon_binders")
    .select("id,user_id,name,pages,background,binder_kind,set_id,set_name,set_language,sort_order")
    .eq("user_id",p.user_id)
    .order("sort_order")
    .order("created_at");
  if(error){
    console.error("[Amigos]",error);
    return toast("Esses fichários não estão disponíveis.");
  }
  friendViewer.binders=data||[];
  const sel=$("friendBinderSelect");
  sel.innerHTML="";
  if(!friendViewer.binders.length){
    sel.innerHTML='<option value="">Nenhum fichário visível</option>';
    sel.disabled=true;
    $("friendBinderStatus").textContent=p.binder_visibility==="private"
      ?"Este usuário mantém os fichários privados."
      :"Nenhum fichário disponível.";
  }else{
    sel.disabled=false;
    sel.innerHTML=friendViewer.binders.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name||"Fichário")+'</option>').join("");
  }
  closeDialog("friendsDialog");
  openDialog("friendBinderDialog");
  if(friendViewer.binders.length)await loadFriendBinderSelection(friendViewer.binders[0].id,true);
}
function viewFriendBinder(p){return viewFriendBinders(p)}
function setup3d(){const el=$("card3d");el.addEventListener("pointermove",e=>{if(el.classList.contains("flipped"))return;const r=el.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;el.querySelector(".card-3d-inner").style.transform=`rotateY(${x*18}deg) rotateX(${-y*18}deg)`});el.addEventListener("pointerleave",()=>{if(!el.classList.contains("flipped"))el.querySelector(".card-3d-inner").style.transform="rotateY(0) rotateX(0)"});el.addEventListener("dblclick",()=>el.classList.toggle("flipped"))}
function bindEvents(){$("tabLogin").onclick=()=>setAuthMode("login");$("tabSignup").onclick=()=>setAuthMode("signup");$("authForm").onsubmit=handleAuth;$("btnLogout").onclick=()=>db.auth.signOut();$("btnOpenAdd").onclick=()=>openAddForPosition(currentPage);$("btnMobileScan").onclick=()=>openAddForPosition(currentPage);$("prevPage").onclick=()=>goToPage(currentPage-1);$("nextPage").onclick=()=>goToPage(currentPage+1);$("btnPages").onclick=()=>{renderPagesGrid();openDialog("pagesDialog")};$("btnAddPage").onclick=addPage;$("btnAddPageModal").onclick=addPage;$("btnBackground").onclick=()=>openDialog("appearanceDialog");$("btnSummarySettings").onclick=()=>openDialog("appearanceDialog");$("btnSaveAppearance").onclick=saveAppearance;document.querySelectorAll(".theme-swatch").forEach(b=>b.onclick=()=>{document.querySelectorAll(".theme-swatch").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("binderStage").className=`binder-stage theme-${b.dataset.theme}`});$("showValues").onchange=async e=>{await updateSettings({show_values:e.target.checked},true);renderAll()};$("priceMode").onchange=async e=>{const mode=normalizedPriceMode(e.target.value);await updateSettings({display_price_mode:mode,total_price_mode:mode},true);renderBinder();renderSummary()};document.querySelectorAll("[data-status-filter]").forEach(b=>b.onclick=()=>setStatusFilter(b.dataset.statusFilter));$("btnExport").onclick=exportCSV;$("btnPrint").onclick=()=>window.print();$("btnSearchCards").onclick=()=>searchCards();$("searchName").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();clearTimeout(catalogSearchTimer);searchCards()}});["searchName","searchNumber"].forEach(id=>$(id).addEventListener("input",()=>queueLiveCatalogSearch()));$("searchLanguage").addEventListener("change",()=>queueLiveCatalogSearch(80));$("resultRarityFilter").onchange=renderCatalog;$("btnClearSelection").onclick=()=>{catalogSelection.clear();renderCatalog();updateSelectionTray()};$("btnAddSelected").onclick=addSelectedCards;$("btnUsePhotoHints").onclick=usePhotoHints;$("cardPhoto").onchange=()=>{$("ocrStatus").textContent="Foto pronta. Toque em Ler foto."};document.querySelectorAll("[data-card-status]").forEach(b=>b.onclick=()=>setSelectedStatus(b.dataset.cardStatus));$("btnSaveCard").onclick=saveSelectedCard;$("btnDeleteSelected").onclick=deleteSelectedCard;$("btnFriends").onclick=$("btnMobileFriends").onclick=$("btnMobileProfile").onclick=openFriendsPanel;$("btnSaveProfile").onclick=saveProfile;$("btnSearchFriends").onclick=searchFriends;$("friendSearch").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchFriends()}});$("friendBinderSelect").onchange=e=>loadFriendBinderSelection(e.target.value,true);$("friendBinderPrev").onclick=()=>{const b=friendViewer.binders.find(x=>String(x.id)===String(friendViewer.binderId));if(!b)return;friendViewer.page=friendViewer.page<=2?1:Math.max(2,friendViewer.page-2);renderFriendBinder()};$("friendBinderNext").onclick=()=>{const b=friendViewer.binders.find(x=>String(x.id)===String(friendViewer.binderId));if(!b)return;const last=friendBinderLastAnchor(b.pages);friendViewer.page=friendViewer.page<=1?Math.min(last,2):Math.min(last,friendViewer.page+2);renderFriendBinder()};$("btnMobileSummary").onclick=()=>$("summaryPanel").classList.add("mobile-open");$("btnCloseSummary").onclick=()=>$("summaryPanel").classList.remove("mobile-open");document.addEventListener("click",e=>{const c=e.target.closest("[data-close]");if(c)closeDialog(c.dataset.close);if(!e.target.closest("#cardContextMenu"))hideContext()});$("cardContextMenu").addEventListener("click",e=>{const b=e.target.closest("[data-ctx]");if(b)contextAction(b.dataset.ctx)});setup3d()}
// A new build must not reload the page under an open dialog (unsaved card
// edits, Master Set builder...). Wait until every dialog is closed.
function whenNoDialogOpen(fn){
  if(window.__pbReloadPending)return;
  window.__pbReloadPending=true;
  const busy=()=>!!document.querySelector('dialog[open]');
  if(!busy())return fn();
  const timer=setInterval(()=>{if(!busy()){clearInterval(timer);fn()}},2000);
}
async function registerPWA(){
  if(!("serviceWorker"in navigator))return;
  try{
    const build=String(window.POKEMON_BINDER_BUILD||'V15.11').replace(/^V/i,'');
    let reloading=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(reloading)return;
      reloading=true;
      whenNoDialogOpen(()=>{
        const u=new URL(location.href);
        u.searchParams.set('pbv',build);
        location.replace(u.href);
      });
    });
    const reg=await navigator.serviceWorker.register("/sw.js?v="+encodeURIComponent(build),{updateViaCache:"none"});
    await reg.update();
    if(reg.waiting)reg.waiting.postMessage({type:"SKIP_WAITING"});
    reg.addEventListener("updatefound",()=>{
      const worker=reg.installing;
      if(!worker)return;
      worker.addEventListener("statechange",()=>{
        if(worker.state==="installed"){
          worker.postMessage({type:"SKIP_WAITING"});
        }
      });
    });
  }catch(e){console.warn(e)}
}

async function reconcileLiveBuild(){
  try{
    const current=String(window.POKEMON_BINDER_BUILD||'').replace(/^V/i,'');
    const rr=await fetch('/index.html?buildcheck='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
    if(!rr.ok)return;
    const html=await rr.text();
    const match=html.match(/POKEMON_BINDER_BUILD=['"]V?([^'"]+)['"]/i);
    const live=String(match?.[1]||'').replace(/^V/i,'');
    if(live&&current&&live!==current){
      whenNoDialogOpen(()=>{
        const u=new URL(location.href);
        u.searchParams.set('pbv',live);
        location.replace(u.href);
      });
    }
  }catch(e){console.warn('[Build check]',e)}
}

async function boot(){
  bindEvents();
  registerPWA();
  reconcileLiveBuild();
  setInterval(reconcileLiveBuild,60_000);
  const{data}=await db.auth.getSession();
  await renderAuthState(data.session);
  db.auth.onAuthStateChange((_e,s)=>setTimeout(()=>renderAuthState(s),0))
}
document.addEventListener("DOMContentLoaded",boot);

// ===== V5 RELIABLE SLOT DRAG =====
function dragCardFromEvent(e){
  const id=(e.dataTransfer&&e.dataTransfer.getData('text/plain'))||draggedCard?.id||'';
  return collection.find(c=>String(c.id)===String(id))||draggedCard||null;
}
function binderDrop(e,pocket,page,slot){
  e.preventDefault();
  e.stopPropagation();
  pocket?.classList.remove('drag-over');
  const source=dragCardFromEvent(e);
  if(source) moveCard(source,+page,+slot);
}
function renderBinder(){
  const g=$('binderSheet');
  g.innerHTML='';
  for(let slot=1;slot<=9;slot++){
    const pocket=document.createElement('div');
    pocket.className='binder-pocket';
    pocket.dataset.page=currentPage;
    pocket.dataset.slot=slot;
    const c=getCardAt(currentPage,slot);
    if(c){
      pocket.appendChild(renderPocketCard(c));
    }else{
      const b=document.createElement('button');
      b.className='pocket-empty-btn';
      b.type='button';
      b.textContent='＋';
      b.title=`Adicionar no bolso ${slot}`;
      b.onclick=()=>openAddForPosition(currentPage,slot);
      pocket.appendChild(b);
    }
    pocket.addEventListener('dragenter',e=>{e.preventDefault();pocket.classList.add('drag-over')});
    pocket.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';pocket.classList.add('drag-over')});
    pocket.addEventListener('dragleave',e=>{if(!pocket.contains(e.relatedTarget))pocket.classList.remove('drag-over')});
    pocket.addEventListener('drop',e=>binderDrop(e,pocket,currentPage,slot));
    g.appendChild(pocket);
  }
  const pages=Math.max(1,+settings.binder_pages||1);
  $('pageLabel').textContent=`Página ${currentPage} · ${currentPage}/${pages}`;
  $('prevPage').disabled=currentPage<=1;
  $('nextPage').disabled=currentPage>=pages;
}
function renderPocketCard(c){
  const st=c.collection_status||'owned';
  const b=document.createElement('button');
  b.className=`pocket-card status-${st}`;
  b.type='button';
  b.draggable=true;
  b.dataset.id=c.id;
  if(activeStatusFilter!=='all'&&st!==activeStatusFilter)b.classList.add('filtered-out');
  const img=cardImage(c),q=Math.max(0,+c.quantity||0),pv=priceModeValue(c,currentPriceMode()),v=pv*Math.max(q,1);
  b.innerHTML=`${img?`<img src="${esc(img)}" alt="${esc(c.name)}" loading="lazy" draggable="false">`:`<span>${esc(c.name)}</span>`}<span class="card-status-ribbon">${esc(STATUS[st]||st)}</span>${st==='owned'&&q>1?`<span class="card-qty">x${q}</span>`:''}${settings.show_values&&pv>0?`<span class="card-value">${money(v)}</span>`:''}`;
  b.addEventListener('click',()=>{if(!b.dataset.justDragged)openExistingCard(c)});
  b.addEventListener('dblclick',()=>openExistingCard(c,true));
  b.addEventListener('contextmenu',e=>{e.preventDefault();showContextMenu(c,e.clientX,e.clientY)});
  b.addEventListener('dragstart',e=>{
    draggedCard=c;
    b.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',String(c.id));
    try{e.dataTransfer.setDragImage(b,Math.round(b.offsetWidth/2),Math.round(b.offsetHeight/2))}catch{}
  });
  b.addEventListener('dragend',()=>{
    draggedCard=null;
    b.classList.remove('dragging');
    document.querySelectorAll('.binder-pocket.drag-over').forEach(p=>p.classList.remove('drag-over'));
  });
  b.addEventListener('dragenter',e=>{e.preventDefault();e.stopPropagation();b.closest('.binder-pocket')?.classList.add('drag-over')});
  b.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';b.closest('.binder-pocket')?.classList.add('drag-over')});
  b.addEventListener('drop',e=>{
    const p=b.closest('.binder-pocket');
    binderDrop(e,p,p?.dataset.page,p?.dataset.slot);
  });
  let press;
  const start=e=>{press=setTimeout(()=>showContextMenu(c,e.clientX||innerWidth/2,e.clientY||innerHeight/2),620)};
  b.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')start(e)});
  ['pointerup','pointercancel','pointermove'].forEach(ev=>b.addEventListener(ev,()=>clearTimeout(press)));
  return b;
}

let touchBinderDrag=null;
let suppressPocketClick=false;
document.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse')return;
  const card=e.target.closest('.pocket-card');
  if(!card)return;
  touchBinderDrag={id:card.dataset.id,x:e.clientX,y:e.clientY,moved:false,card};
},{passive:true});
document.addEventListener('pointermove',e=>{
  if(!touchBinderDrag||e.pointerType==='mouse')return;
  const dx=e.clientX-touchBinderDrag.x,dy=e.clientY-touchBinderDrag.y;
  if(!touchBinderDrag.moved&&Math.hypot(dx,dy)>12){
    touchBinderDrag.moved=true;
    touchBinderDrag.card.classList.add('dragging');
  }
  if(!touchBinderDrag.moved)return;
  document.querySelectorAll('.binder-pocket.drag-over').forEach(p=>p.classList.remove('drag-over'));
  document.elementFromPoint(e.clientX,e.clientY)?.closest('.binder-pocket')?.classList.add('drag-over');
},{passive:true});
document.addEventListener('pointerup',e=>{
  if(!touchBinderDrag||e.pointerType==='mouse')return;
  const state=touchBinderDrag;
  touchBinderDrag=null;
  state.card.classList.remove('dragging');
  const pocket=document.elementFromPoint(e.clientX,e.clientY)?.closest('.binder-pocket');
  document.querySelectorAll('.binder-pocket.drag-over').forEach(p=>p.classList.remove('drag-over'));
  if(state.moved&&pocket){
    suppressPocketClick=true;
    const source=collection.find(c=>String(c.id)===String(state.id));
    if(source)moveCard(source,+pocket.dataset.page,+pocket.dataset.slot);
  }
},{passive:true});
document.addEventListener('click',e=>{
  if(suppressPocketClick&&e.target.closest('.pocket-card')){
    e.preventDefault();e.stopImmediatePropagation();suppressPocketClick=false;
  }
},true);

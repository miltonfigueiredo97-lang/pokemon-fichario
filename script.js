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
async function ensureSettings(){const{data,error}=await db.from("pokemon_settings").select("*").eq("user_id",currentUser.id).maybeSingle();if(error)throw error;if(data)settings={...settings,...data};else{const{data:i,error:ie}=await db.from("pokemon_settings").insert({user_id:currentUser.id}).select("*").single();if(ie)throw ie;settings={...settings,...i}}}
async function loadCurrentProfile(){const{data,error}=await db.from("pokemon_profiles").select("*").eq("user_id",currentUser.id).maybeSingle();if(error)throw error;currentProfile=data;if(data){$("userHandle").textContent=`@${data.username}`;$("profileUsername").value=data.username||"";$("profileVisibility").value=data.binder_visibility||"friends"}else{$("userHandle").textContent=currentUser.email||""}}
async function saveProfile(){const b=$("btnSaveProfile"),username=$("profileUsername").value.trim(),binder_visibility=$("profileVisibility").value;if(!/^[A-Za-z0-9_.-]{3,24}$/.test(username)){toast("Use 3 a 24 caracteres: letras, números, _, . ou -");return}busy(b,true,"Salvando...");try{const payload={user_id:currentUser.id,username,binder_visibility,display_name:currentProfile?.display_name||""};const{error}=await db.from("pokemon_profiles").upsert(payload,{onConflict:"user_id"});if(error)throw error;await loadCurrentProfile();toast("Perfil salvo.")}catch(err){console.error(err);toast(String(err.message||"").toLowerCase().includes("unique")||String(err.message||"").toLowerCase().includes("duplicate")?"Esse @usuário já existe.":`Erro ao salvar perfil: ${err.message||"tente novamente"}`)}finally{busy(b,false)}}
async function updateSettings(patch,silent=false){settings={...settings,...patch};applySettings();const{error}=await db.from("pokemon_settings").update(patch).eq("user_id",currentUser.id);if(error&&!silent)toast("Não consegui salvar a configuração.")}
function applySettings(){const n=settings.binder_name||"Meu Fichário",mode=currentPriceMode();$("binderTitleHeader").textContent=n;document.querySelector(".cover-title").innerHTML=esc(n).replace(/\s+/,"<br>");$("binderNameInput").value=n;$("binderStage").className=`binder-stage theme-${settings.binder_background||"graphite"}`;$("showValues").checked=!!settings.show_values;$("totalValueBox").classList.toggle("hidden",!settings.show_values);if($("priceMode"))$("priceMode").value=mode;if($("totalValueLabel"))$("totalValueLabel").textContent=`Valor ${priceModeLabel(mode)} salvo`;document.querySelectorAll(".theme-swatch").forEach(x=>x.classList.toggle("active",x.dataset.theme===settings.binder_background));currentPage=Math.min(Math.max(1,currentPage),Math.max(1,+settings.binder_pages||1))}
async function renderAuthState(session){currentUser=session?.user||null;if(!currentUser){$("app").classList.add("hidden");$("authScreen").classList.remove("hidden");return}$("authScreen").classList.add("hidden");$("app").classList.remove("hidden");try{await Promise.all([ensureSettings(),loadCurrentProfile()]);applySettings();await loadCards(false)}catch(e){console.error(e);toast("Não consegui iniciar seu fichário.")}}
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
async function contextAction(a){const c=contextCard;if(!c)return;hideContext();if(a==="view")return openExistingCard(c,true);if(a==="move"){const v=prompt("Mover para página e bolso. Ex.: 2,5",`${c.binder_page},${c.binder_slot}`);if(!v)return;const[p,s]=v.split(/[,;\s]+/).map(Number);if(p>=1&&s>=1&&s<=9)return moveCard(c,p,s);return toast("Use página,bolso. Ex.: 2,5")}if(a==="delete"){if(confirm(`Remover ${c.name}?`)){await db.from("pokemon_cards").delete().eq("id",c.id).eq("user_id",currentUser.id);await loadCards(false);toast("Carta removida.")}return}if(["owned","wanted","ordered","missing"].includes(a)){await db.from("pokemon_cards").update({collection_status:a,quantity:a==="owned"?Math.max(1,+c.quantity||1):0}).eq("id",c.id).eq("user_id",currentUser.id);await loadCards(false);toast(`Status: ${STATUS[a]}`)}}
function renderSummary(){const counts={missing:0,wanted:0,owned:0,ordered:0};collection.forEach(c=>counts[c.collection_status||"owned"]++);const total=collection.length,cap=Math.max(1,+settings.binder_pages||1)*9,empty=Math.max(0,cap-total),pct=total?Math.round(counts.owned/total*100):0,value=collection.filter(c=>(c.collection_status||"owned")==="owned").reduce((s,c)=>s+priceModeValue(c,currentPriceMode())*Math.max(+c.quantity||1,1),0);$("completionPercent").textContent=pct+"%";$("progressBar").style.width=pct+"%";$("progressText").textContent=`${counts.owned} de ${total} marcadas como Tenho`;for(const[k,id]of Object.entries({sumTotal:total,sumOwned:counts.owned,sumWanted:counts.wanted,sumOrdered:counts.ordered,sumMissing:counts.missing,sumEmpty:empty,filterAllCount:total,filterOwnedCount:counts.owned,filterWantedCount:counts.wanted,filterOrderedCount:counts.ordered,filterMissingCount:counts.missing,coverSlots:cap,coverOwned:counts.owned,coverWanted:counts.wanted}))$(k).textContent=id;if($("totalValueLabel"))$("totalValueLabel").textContent=`Valor ${priceModeLabel(currentPriceMode())} salvo`;$("totalValue").textContent=money(value);$("binderHeaderStats").textContent=`${total} cartas · ${counts.owned} tenho · ${counts.wanted} quero · ${pct}% completo`;document.querySelectorAll("[data-status-filter]").forEach(b=>b.classList.toggle("active",b.dataset.statusFilter===activeStatusFilter))}
function setStatusFilter(s){activeStatusFilter=s;renderBinder();renderSummary()}
async function addPage(){const n=Math.max(1,+settings.binder_pages||1)+1;await updateSettings({binder_pages:n});currentPage=n;renderAll();toast(`Página ${n} adicionada.`)}
function goToPage(p){currentPage=Math.min(Math.max(1,+p||1),Math.max(1,+settings.binder_pages||1));renderBinder();renderPagesGrid()}
function renderPagesGrid(){const g=$("pagesGrid");if(!g)return;g.innerHTML="";for(let p=1;p<=Math.max(1,+settings.binder_pages||1);p++){const b=document.createElement("button");b.className="page-thumb"+(p===currentPage?" active":"");const cells=[];for(let s=1;s<=9;s++){const c=getCardAt(p,s),img=c?cardImage(c):"";cells.push(`<span class="page-mini-pocket">${img?`<img src="${esc(img)}">`:""}</span>`)}b.innerHTML=`<strong>Página ${p}</strong><div class="page-mini-grid">${cells.join("")}</div><small>${cardsOnPage(p).length}/9</small>`;b.onclick=()=>{goToPage(p);closeDialog("pagesDialog")};g.appendChild(b)}}
function openAddForPosition(page=currentPage,slot=null){pendingPosition=slot?{page,slot}:freePositions(page,1)[0];catalogSelection.clear();updateSelectionTray();$("searchName").value="";$("searchNumber").value="";$("searchSet").value="";$("resultsList").innerHTML="";$("searchStatus").textContent=`Primeira carta irá para página ${pendingPosition.page}, bolso ${pendingPosition.slot}.`;openDialog("addDialog");setTimeout(()=>$("searchName").focus(),100)}
async function searchMypCards(name,number,setHint){if(!name)return{cards:[],needsToken:false};try{const p=new URLSearchParams({name});if(number)p.set("number",number);if(setHint)p.set("set",setHint);const r=await fetch(`/api/mypcards?${p}`,{cache:"no-store"}),j=await r.json();return j.ok?{cards:(j.cards||[]).map(mapMyp),needsToken:false}:{cards:[],needsToken:!!j.needsToken,message:j.message||""}}catch(e){return{cards:[],needsToken:false,message:"Mercado BR indisponível."}}}
function mapMyp(c){const isJa=!!c.isJapanese||norm(c.rawLanguage)==="ja"||norm(c.rawLanguage)==="jp";const lang=isJa?"ja":(c.imagePt?"pt-br":"en");return{source:"MYP Cards",apiId:`myp-${c.internalCode}`,marketInternalCode:c.internalCode,name:c.nameEn||c.namePt||"",namePt:c.namePt||"",nameEn:c.nameEn||"",languageCode:lang,language:isJa?"Japonês":(lang==="pt-br"?"Português":"Inglês"),setName:c.editionPt||c.editionEn||"",setId:c.editionCode||"",number:c.number||"",rarity:"",type:"",imageUrl:isJa?(c.imageJa||c.imageEn||c.imagePt||""):(c.imagePt||c.imageEn||""),imagePt:c.imagePt||"",imageEn:c.imageEn||"",imageJa:c.imageJa||"",market:{source:"MYP Cards",min:+c.minPrice||0,avg:+c.avgPrice||0,max:+c.maxPrice||0,link:c.link||"",availableQuantity:c.availableQuantity,internalCode:c.internalCode,namePt:c.namePt||"",editionPt:c.editionPt||"",imagePt:c.imagePt||"",imageEn:c.imageEn||""},marketScore:+c.matchScore||0}}
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
  if(!String(setHint||"").trim())return true;
  const ids=new Set((setIds||[]).map(String));
  const cid=String(c?.setId||c?.set_id||"");
  if(ids.size&&cid&&ids.has(cid))return true;
  // Para catálogo TCGdex, se a coleção foi resolvida por ID, outro set é proibido.
  if(ids.size&&(c?.source==="TCGdex"||c?.api_source==="TCGdex"))return false;
  // Fontes de mercado nem sempre usam o ID TCGdex: exigimos o nome/código da coleção.
  const h=norm(setHint),name=norm(c?.setName||c?.set_name||""),id=norm(cid),title=norm(c?.setTitle||c?.set_title||"");
  if(!h)return true;
  if(name===h||id===h||title===h||name.includes(h)||h.includes(name)||id.includes(h)||h.includes(id)||title.includes(h)||h.includes(title))return true;
  return Math.max(nameSimilarity(h,name),nameSimilarity(h,id),nameSimilarity(h,title))>=.78;
}
function hardFilterCatalog(cards,{number="",setHint="",setIds=[],language="all"}={}){
  return (cards||[]).filter(c=>{
    if(language!=="all"&&c.languageCode!==language)return false;
    if(number&&!collectorNumberMatches(number,c.number))return false;
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
    const item=await r.json();
    catalogSearchCache.set(key,{at:Date.now(),item});
    return item;
  }catch(e){
    console.warn("TCGdex set",apiLang,setId,e);
    return null;
  }
}
function mapTCGSetBrief(c,set,lang){
  const local=String(c?.localId||""),setId=set?.id||"",image=c?.image||"";
  return{source:"TCGdex",apiId:c?.id||`${setId}-${local}`,name:c?.name||"",languageCode:lang,language:LANG[lang]||lang,setName:set?.name||setId,setId,number:local,printedTotal:String(set?.cardCount?.official||""),rarity:c?.rarity||"",type:c?.category||"",category:c?.category||"",hp:c?.hp??null,imageUrl:image,pricing:c?.pricing||null};
}
function quickCatalogScore(c,name,number){
  let s=0;
  const qn=norm(name),cn=norm(c?.name),wanted=numParts(number).n,actual=numParts(c?.number).n;
  if(qn){
    if(cn===qn)s+=900;
    else if(cn.startsWith(qn))s+=720;
    else if(cn.includes(qn)||qn.includes(cn))s+=580;
    else s+=Math.round(nameSimilarity(qn,cn)*420);
  }
  if(wanted)s+=collectorTokenMatches(wanted,actual)?800:-250;
  return s;
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
      if(n)pool=pool.filter(c=>collectorTokenMatches(n,numParts(c.number).n));
      pool.sort((a,b)=>quickCatalogScore(b,name,number)-quickCatalogScore(a,name,number));
      const cap=!String(name||"").trim()&&!n?400:(live?48:120);
      pool=pool.slice(0,cap);
      if(String(name||"").trim()||n){
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
function mapTCG(c,lang){const s=c.set||{},local=String(c.localId||""),setId=s.id||"";let image=c.image||"";if(!image&&lang==="ja"){const p=new URLSearchParams({set:setId,localId:local,name:c.name||"",hp:String(c.hp||""),rarity:c.rarity||""});image="/api/jp-card-image?"+p.toString()}return{source:"TCGdex",apiId:c.id||"",name:c.name||"",languageCode:lang,language:LANG[lang]||lang,setName:s.name||s.id||"",setId,number:local,printedTotal:String(s.cardCount?.official||""),rarity:c.rarity||"",type:Array.isArray(c.types)?c.types.join(", "):(c.category||""),category:c.category||"",hp:c.hp??null,imageUrl:image,imageFallbackJa:!c.image&&lang==="ja",pricing:c.pricing||null}}
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
      if(collectorTokenMatches(num.n,nn))s+=650;else s-=420;
      const foundParts=numParts(c.number);
      if(num.d&&(collectorTokenMatches(num.d,foundParts.d)||collectorTokenMatches(num.d,String(c.printedTotal||""))))s+=260;
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
async function searchCards(options={}){
  const live=!!options.live,requestId=++catalogSearchSeq;
  let raw=$("searchName").value.trim(),number=$("searchNumber").value.trim(),setHint=$("searchSet").value.trim(),language=$("searchLanguage").value;

  const typedLetters=norm(raw).replace(/\s+/g,"").length;
  const setLetters=norm(setHint).replace(/\s+/g,"").length;
  if(!raw&&!number&&!setHint){
    catalogResults=[];populateRarityFilter();renderCatalog();$("searchStatus").textContent="";return;
  }
  if(live&&!number&&typedLetters<2&&setLetters<2){
    catalogResults=[];populateRarityFilter();renderCatalog();
    $("searchStatus").textContent="Digite pelo menos 2 letras no nome ou na coleção para buscar automaticamente.";
    return;
  }

  const inline=raw.match(/^(.*?)(?:\s+)([A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4})(?:\/([A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4}))?$/);
  if(inline&&!number){raw=inline[1].trim();number=inline[2]+(inline[3]?`/${inline[3]}`:"")}

  const b=$("btnSearchCards");
  if(!live)busy(b,true,"Buscando...");
  $("searchStatus").textContent=live?"Refinando resultados enquanto você digita…":"Cruzando todos os critérios informados…";

  try{
    const langs=language==="all"?["pt-br","en","ja"]:[language];
    const setIds=setHint?await resolveCatalogSetIds(langs,setHint):[];
    const wantsJa=language==="all"||language==="ja";
    const wantsLegacy=language==="all"||language==="en";
    const [groups,jpOfficial,mypSearch,legacyCards]=await Promise.all([
      Promise.all(langs.map(l=>searchTCGdex(l,raw,number,{live,setHint,setIds}))),
      wantsJa?searchJapaneseOfficial(raw,number,setHint,{live}):Promise.resolve([]),
      raw?searchMypCards(raw,number,setHint):Promise.resolve({cards:[],needsToken:false}),
      wantsLegacy&&raw?searchLegacyCards(raw,number,setHint,{live}):Promise.resolve([])
    ]);
    if(requestId!==catalogSearchSeq)return;

    const mypCards=mypSearch.cards||[];
    const tcgFlat=groups.flat();
    const basePool=language==="ja"&&jpOfficial.length
      ? [...jpOfficial,...mypCards.filter(c=>c.languageCode==="ja")]
      : [...tcgFlat,...legacyCards,...jpOfficial,...mypCards];
    const limitlessVariants=number&&raw
      ? await searchLimitlessVariants(raw,number,basePool,language)
      : [];
    const sourcePool=[...basePool,...limitlessVariants];
    let results=hardFilterCatalog(dedupe(sourcePool),{number,setHint,setIds,language});
    const maxResults=setHint&&!raw&&!number?400:100;
    catalogResults=rank(results,{name:raw,number,setHint,language}).slice(0,maxResults);
    populateRarityFilter();renderCatalog();

    const br=catalogResults.filter(c=>c.languageCode==="pt-br").length;
    const jpOfficialCount=catalogResults.filter(c=>c.source==="Pokémon Japão Oficial").length;
    const criteria=[raw&&`nome “${raw}”`,number&&`nº ${number}`,setHint&&`coleção “${setHint}”`,language!=="all"&&LANG[language]].filter(Boolean).join(" + ");
    $("searchStatus").textContent=`${catalogResults.length} resultado(s) · ${br} em português${jpOfficialCount?` · ${jpOfficialCount} impressão(ões) japonesa(s) oficial(is)`:``}${criteria?` · correspondendo a: ${criteria}`:""}.`;
  }catch(e){
    if(requestId!==catalogSearchSeq)return;
    console.error(e);$("searchStatus").textContent="Erro ao buscar.";
  }finally{
    if(!live&&requestId===catalogSearchSeq)busy(b,false);
  }
}
function queueLiveCatalogSearch(delay=420){
  clearTimeout(catalogSearchTimer);
  catalogSearchTimer=setTimeout(()=>searchCards({live:true}),delay);
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
function cardPayload(c,v,m={}){return{user_id:currentUser.id,card_key:cardKey(c),api_source:c.source||"catalog",api_id:c.apiId||"",name:c.name||"",language_code:c.languageCode||"",language:c.language||"",set_name:c.setName||"",set_id:c.setId||"",number:c.number||"",rarity:c.rarity||"",card_type:c.type||"",image_url:cardImage(c),quantity:v.status==="owned"?Math.max(1,+v.quantity||1):0,condition:v.condition||"Nova",finish:v.finish||"Normal",collection_status:v.status||"owned",binder_page:+v.page||1,binder_slot:+v.slot||1,price_min:+m.min||0,price_avg:+m.avg||0,price_max:+m.max||0,currency:"BRL",price_source:m.min||m.avg||m.max?"MYP Cards":"Sem preço BR",price_link:m.link||ligaUrl(c),price_br_source:m.min||m.avg||m.max?"MYP Cards":null,price_br_link:m.link||null,market_internal_code:m.internalCode||c.marketInternalCode||null,market_name_pt:m.namePt||c.namePt||null,market_edition_pt:m.editionPt||null,market_image_pt:m.imagePt||c.imagePt||null,market_image_en:m.imageEn||c.imageEn||null,price_checked_at:new Date().toISOString(),notes:v.notes||""}}
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
async function loadFriendships(){const{data,error}=await db.from("pokemon_friendships").select("*").or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`).order("created_at",{ascending:false});if(error)throw error;friendships=data||[];const ids=[...new Set(friendships.flatMap(f=>[f.requester_id,f.addressee_id]).filter(x=>x!==currentUser.id))];profilesById=new Map;if(ids.length){const{data:p}=await db.from("pokemon_profiles").select("user_id,username,display_name,binder_visibility").in("user_id",ids);(p||[]).forEach(x=>profilesById.set(x.user_id,x))}renderFriends()}
function socialItem(p,actions){const e=document.createElement("div");e.className="social-item";e.innerHTML=`<div><strong>@${esc(p?.username||"usuário")}</strong><small>${esc(p?.display_name||"")}</small></div><div class="social-actions"></div>`;actions.forEach(a=>{const b=document.createElement("button");b.textContent=a.label;b.onclick=a.action;e.querySelector(".social-actions").appendChild(b)});return e}
function renderFriends(){const r=$("friendRequests"),f=$("friendsList");r.innerHTML=f.innerHTML="";const rec=friendships.filter(x=>x.status==="pending"&&x.addressee_id===currentUser.id),acc=friendships.filter(x=>x.status==="accepted");if(!rec.length)r.innerHTML='<p class="muted">Nenhum pedido pendente.</p>';rec.forEach(x=>r.appendChild(socialItem(profilesById.get(x.requester_id),[{label:"Aceitar",action:()=>updateFriendship(x.id,"accepted")},{label:"Recusar",action:()=>removeFriendship(x.id)}])));if(!acc.length)f.innerHTML='<p class="muted">Adicione amigos para ver os fichários deles.</p>';acc.forEach(x=>{const id=x.requester_id===currentUser.id?x.addressee_id:x.requester_id,p=profilesById.get(id);f.appendChild(socialItem(p,[{label:"Ver fichário",action:()=>viewFriendBinder(p)},{label:"Remover",action:()=>removeFriendship(x.id)}]))})}
async function searchFriends(){const q=$("friendSearch").value.trim().replace(/^@/,""),box=$("friendSearchResults");box.innerHTML="";if(q.length<2)return toast("Digite pelo menos 2 caracteres.");const{data,error}=await db.from("pokemon_profiles").select("user_id,username,display_name,binder_visibility").ilike("username",`%${q}%`).neq("user_id",currentUser.id).limit(20);if(error)return toast("Erro na busca.");if(!data?.length)return box.innerHTML='<p class="muted">Nenhum usuário encontrado.</p>';data.forEach(p=>{const ex=friendships.find(f=>f.requester_id===p.user_id||f.addressee_id===p.user_id);box.appendChild(socialItem(p,ex?[{label:ex.status==="accepted"?"Amigo":"Pendente",action:()=>{}}]:[{label:"Adicionar",action:()=>sendFriendRequest(p.user_id)}]))})}
async function sendFriendRequest(id){const{error}=await db.from("pokemon_friendships").insert({requester_id:currentUser.id,addressee_id:id,status:"pending"});if(error)return toast("Não consegui enviar.");await loadFriendships();await searchFriends();toast("Pedido enviado.")}
async function updateFriendship(id,status){const{error}=await db.from("pokemon_friendships").update({status}).eq("id",id);if(error)return toast("Erro ao atualizar.");await loadFriendships();toast("Pedido aceito.")}
async function removeFriendship(id){await db.from("pokemon_friendships").delete().eq("id",id);await loadFriendships()}
async function viewFriendBinder(p){if(!p)return;const{data,error}=await db.from("pokemon_cards").select("*").eq("user_id",p.user_id).order("binder_page").order("binder_slot");if(error)return toast("Esse fichário não está disponível.");$("friendBinderTitle").textContent=`@${p.username}`;const g=$("friendBinderGrid");g.innerHTML="";(data||[]).forEach(c=>{const e=document.createElement("div");e.className="friend-card";const img=cardImage(c);e.innerHTML=`${img?`<img src="${esc(img)}">`:""}<strong>${esc(c.name)}</strong><small>${esc(c.set_name||"")} · ${esc(c.number||"")}</small>`;g.appendChild(e)});closeDialog("friendsDialog");openDialog("friendBinderDialog")}
function setup3d(){const el=$("card3d");el.addEventListener("pointermove",e=>{if(el.classList.contains("flipped"))return;const r=el.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;el.querySelector(".card-3d-inner").style.transform=`rotateY(${x*18}deg) rotateX(${-y*18}deg)`});el.addEventListener("pointerleave",()=>{if(!el.classList.contains("flipped"))el.querySelector(".card-3d-inner").style.transform="rotateY(0) rotateX(0)"});el.addEventListener("dblclick",()=>el.classList.toggle("flipped"))}
function bindEvents(){$("tabLogin").onclick=()=>setAuthMode("login");$("tabSignup").onclick=()=>setAuthMode("signup");$("authForm").onsubmit=handleAuth;$("btnLogout").onclick=()=>db.auth.signOut();$("btnOpenAdd").onclick=()=>openAddForPosition(currentPage);$("btnMobileScan").onclick=()=>openAddForPosition(currentPage);$("prevPage").onclick=()=>goToPage(currentPage-1);$("nextPage").onclick=()=>goToPage(currentPage+1);$("btnPages").onclick=()=>{renderPagesGrid();openDialog("pagesDialog")};$("btnAddPage").onclick=addPage;$("btnAddPageModal").onclick=addPage;$("btnBackground").onclick=()=>openDialog("appearanceDialog");$("btnSummarySettings").onclick=()=>openDialog("appearanceDialog");$("btnSaveAppearance").onclick=saveAppearance;document.querySelectorAll(".theme-swatch").forEach(b=>b.onclick=()=>{document.querySelectorAll(".theme-swatch").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("binderStage").className=`binder-stage theme-${b.dataset.theme}`});$("showValues").onchange=async e=>{await updateSettings({show_values:e.target.checked},true);renderAll()};$("priceMode").onchange=async e=>{const mode=normalizedPriceMode(e.target.value);await updateSettings({display_price_mode:mode,total_price_mode:mode},true);renderBinder();renderSummary()};document.querySelectorAll("[data-status-filter]").forEach(b=>b.onclick=()=>setStatusFilter(b.dataset.statusFilter));$("btnExport").onclick=exportCSV;$("btnPrint").onclick=()=>window.print();$("btnSearchCards").onclick=()=>searchCards();$("searchName").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();clearTimeout(catalogSearchTimer);searchCards()}});["searchName","searchNumber","searchSet"].forEach(id=>$(id).addEventListener("input",()=>queueLiveCatalogSearch()));$("searchLanguage").addEventListener("change",()=>queueLiveCatalogSearch(80));$("resultRarityFilter").onchange=renderCatalog;$("btnClearSelection").onclick=()=>{catalogSelection.clear();renderCatalog();updateSelectionTray()};$("btnAddSelected").onclick=addSelectedCards;$("btnUsePhotoHints").onclick=usePhotoHints;$("cardPhoto").onchange=()=>{$("ocrStatus").textContent="Foto pronta. Toque em Ler foto."};document.querySelectorAll("[data-card-status]").forEach(b=>b.onclick=()=>setSelectedStatus(b.dataset.cardStatus));$("btnSaveCard").onclick=saveSelectedCard;$("btnDeleteSelected").onclick=deleteSelectedCard;$("btnFriends").onclick=$("btnMobileFriends").onclick=$("btnMobileProfile").onclick=async()=>{await loadFriendships();openDialog("friendsDialog")};$("btnSaveProfile").onclick=saveProfile;$("btnSearchFriends").onclick=searchFriends;$("btnMobileSummary").onclick=()=>$("summaryPanel").classList.add("mobile-open");$("btnCloseSummary").onclick=()=>$("summaryPanel").classList.remove("mobile-open");document.addEventListener("click",e=>{const c=e.target.closest("[data-close]");if(c)closeDialog(c.dataset.close);if(!e.target.closest("#cardContextMenu"))hideContext()});$("cardContextMenu").addEventListener("click",e=>{const b=e.target.closest("[data-ctx]");if(b)contextAction(b.dataset.ctx)});setup3d()}
async function registerPWA(){
  if(!("serviceWorker"in navigator))return;
  try{
    let reloading=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(reloading)return;
      reloading=true;
      location.reload();
    });
    const reg=await navigator.serviceWorker.register("/sw.js?v=14.41",{updateViaCache:"none"});
    await reg.update();
    if(reg.waiting)reg.waiting.postMessage({type:"SKIP_WAITING"});
    reg.addEventListener("updatefound",()=>{
      const worker=reg.installing;
      if(!worker)return;
      worker.addEventListener("statechange",()=>{
        if(worker.state==="installed"&&navigator.serviceWorker.controller){
          worker.postMessage({type:"SKIP_WAITING"});
        }
      });
    });
  }catch(e){console.warn(e)}
}
async function boot(){bindEvents();registerPWA();const{data}=await db.auth.getSession();await renderAuthState(data.session);db.auth.onAuthStateChange((_e,s)=>setTimeout(()=>renderAuthState(s),0))}
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

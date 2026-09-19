/* Pokémon Binder BR — V14 architecture layer */
(()=>{
  'use strict';

  const V14={
    binders:[],
    allCards:[],
    activeBinderId:null,
    original:{},
    jpImageCache:new Map(),
    priceJobs:new Map(),
    priceQueue:[],
    priceWorkers:0,
    scan:{stream:null,timer:null,busy:false,evidenceNames:new Map(),evidenceNumbers:new Map()},
    setsCache:new Map(),
    masterPreview:null
  };
  window.PB14=V14;

  const byId=id=>document.getElementById(id);
  const nrm=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function activeBinder(){
    return V14.binders.find(b=>b.id===V14.activeBinderId)||null;
  }
  function isGeneral(){return V14.activeBinderId==='all'}
  function activeSort(){
    if(isGeneral())return settings.general_sort_mode||'manual';
    return activeBinder()?.sort_mode||'manual';
  }
  function canMove(){return !isGeneral()&&activeSort()==='manual'}
  function binderForCard(card){return V14.binders.find(b=>b.id===card?.binder_id)||null}
  function currentBinderPages(){
    const b=activeBinder();
    if(b)return Math.max(1,+b.pages||1);
    return Math.max(1,Math.ceil(V14.allCards.length/9));
  }
  function syncLegacySettings(){
    const b=activeBinder();
    if(b){
      settings.binder_name=b.name||'Meu Fichário';
      settings.binder_pages=Math.max(1,+b.pages||1);
      settings.binder_background=b.background||'graphite';
    }else{
      settings.binder_name='Geral';
      settings.binder_pages=Math.max(1,Math.ceil(V14.allCards.length/9));
      settings.binder_background='graphite';
    }
  }
  function physicalCollection(){
    if(isGeneral())return V14.allCards;
    return V14.allCards.filter(c=>c.binder_id===V14.activeBinderId);
  }
  function numberValue(v){
    const m=String(v||'').match(/\d+/);
    return m?Number(m[0]):999999;
  }
  function orderedViewCards(){
    const arr=[...physicalCollection()];
    const mode=activeSort();
    if(mode==='manual'){
      if(isGeneral()){
        const order=new Map(V14.binders.map((b,i)=>[b.id,i]));
        arr.sort((a,b)=>(order.get(a.binder_id)??999)-(order.get(b.binder_id)??999)||(+a.binder_page||1)-(+b.binder_page||1)||(+a.binder_slot||1)-(+b.binder_slot||1));
      }else arr.sort((a,b)=>(+a.binder_page||1)-(+b.binder_page||1)||(+a.binder_slot||1)-(+b.binder_slot||1));
      return arr;
    }
    const cmpText=(a,b)=>String(a||'').localeCompare(String(b||''),'pt-BR',{sensitivity:'base'});
    arr.sort((a,b)=>{
      if(mode==='name')return cmpText(a.name,b.name)||numberValue(a.number)-numberValue(b.number);
      if(mode==='type')return cmpText(a.card_type,b.card_type)||cmpText(a.name,b.name);
      if(mode==='rarity')return cmpText(a.rarity,b.rarity)||cmpText(a.name,b.name);
      if(mode==='number')return cmpText(a.set_name,b.set_name)||numberValue(a.number)-numberValue(b.number)||cmpText(a.finish,b.finish);
      return 0;
    });
    return arr;
  }

  function injectUI(){
    if(!byId('v14BinderControls')){
      const host=document.querySelector('.header-actions');
      if(host){
        const wrap=document.createElement('div');
        wrap.id='v14BinderControls';
        wrap.className='v14-binder-controls';
        wrap.innerHTML=
          '<select id="v14BinderSelect" aria-label="Fichário"></select>'+
          '<select id="v14SortSelect" aria-label="Ordenação">'+
            '<option value="manual">Ordem do fichário</option>'+
            '<option value="name">Alfabética</option>'+
            '<option value="type">Tipo</option>'+
            '<option value="rarity">Raridade</option>'+
            '<option value="number">Número da coleção</option>'+
          '</select>'+
          '<button id="v14RenameBinder" class="icon-text-btn" type="button">Renomear</button>'+
          '<button id="v14DeleteBinder" class="icon-text-btn" type="button">Excluir</button>'+
          '<button id="v14AddBinder" class="btn btn-primary" type="button">＋ Fichário</button>';
        host.insertBefore(wrap,host.firstChild);
      }
    }
    if(!byId('v14BinderDialog')){
      const d=document.createElement('dialog');
      d.id='v14BinderDialog';
      d.className='sheet-dialog v14-binder-dialog';
      d.innerHTML=
        '<div class="dialog-shell">'+
          '<div class="dialog-head"><div><p class="kicker">FICHÁRIOS</p><h2>Novo fichário</h2><p class="muted compact-copy">Crie vazio ou monte um Master Set completo de uma coleção.</p></div><button class="icon-only" data-v14-close="v14BinderDialog" type="button">×</button></div>'+
          '<div class="v14-create-tabs"><button id="v14TabEmpty" class="active" type="button">Fichário vazio</button><button id="v14TabSet" type="button">Por coleção / Master Set</button></div>'+
          '<section id="v14EmptyPane" class="v14-create-pane">'+
            '<label>Nome<input id="v14EmptyName" type="text" value="Novo Fichário" maxlength="50"></label>'+
            '<label>Páginas iniciais<input id="v14EmptyPages" type="number" min="1" max="200" value="4"></label>'+
            '<button id="v14CreateEmpty" class="btn btn-primary" type="button">Criar fichário</button>'+
          '</section>'+
          '<section id="v14SetPane" class="v14-create-pane hidden">'+
            '<div class="v14-set-search-row"><select id="v14MasterLang"><option value="pt">Português</option><option value="en">Inglês</option><option value="ja">Japonês</option></select><input id="v14SetSearch" type="search" placeholder="Coleção — ex.: Fagulhas Impetuosas"></div>'+
            '<p id="v14SetStatus" class="form-message">Digite o nome da coleção.</p>'+
            '<div id="v14SetResults" class="v14-set-results"></div>'+
            '<div id="v14MasterStep" class="hidden">'+
              '<div class="v14-master-head"><div><strong id="v14MasterTitle">Coleção</strong><small id="v14MasterMeta"></small></div><div><b id="v14OwnedCount">0</b> marcadas como Tenho</div></div>'+
              '<p class="v14-master-help">Marque as variantes que você já possui. As demais entram como Não tenho. Normal, Holo, Reverse, Poké Ball, Master Ball e outras variantes só aparecem quando existem na base.</p>'+
              '<div id="v14MasterGrid" class="v14-master-grid"></div>'+
              '<button id="v14CreateMaster" class="btn btn-primary full" type="button">Criar Master Set</button>'+
            '</div>'+
          '</section>'+
        '</div>';
      document.body.appendChild(d);
    }
    if(!byId('v14ScanCandidates')){
      const d=document.createElement('dialog');
      d.id='v14ScanCandidates';
      d.className='sheet-dialog';
      d.innerHTML=
        '<div class="dialog-shell">'+
          '<div class="dialog-head"><div><p class="kicker">SCANNER</p><h2>Confirme a carta</h2><p id="v14ScanReadout" class="muted compact-copy"></p></div><button class="icon-only" data-v14-close="v14ScanCandidates" type="button">×</button></div>'+
          '<div id="v14ScanCandidateGrid" class="catalog-grid"></div>'+
          '<button id="v14ScanAgain" class="btn btn-secondary full" type="button">Escanear novamente</button>'+
        '</div>';
      document.body.appendChild(d);
    }

    document.querySelectorAll('[data-v14-close]').forEach(b=>b.onclick=()=>{const d=byId(b.dataset.v14Close);if(d?.open)d.close()});
    byId('v14TabEmpty')?.addEventListener('click',()=>switchCreateTab('empty'));
    byId('v14TabSet')?.addEventListener('click',()=>switchCreateTab('set'));
    byId('v14CreateEmpty')?.addEventListener('click',createEmptyBinder);
    byId('v14AddBinder')?.addEventListener('click',()=>{switchCreateTab('empty');byId('v14BinderDialog')?.showModal()});
    byId('v14RenameBinder')?.addEventListener('click',renameBinder);
    byId('v14DeleteBinder')?.addEventListener('click',deleteBinder);
    byId('v14BinderSelect')?.addEventListener('change',e=>selectBinder(e.target.value));
    byId('v14SortSelect')?.addEventListener('change',e=>setSortMode(e.target.value));
    byId('v14SetSearch')?.addEventListener('input',queueSetSearch);
    byId('v14MasterLang')?.addEventListener('change',queueSetSearch);
    byId('v14CreateMaster')?.addEventListener('click',createMasterBinder);
    byId('v14ScanAgain')?.addEventListener('click',()=>{if(byId('v14ScanCandidates')?.open)byId('v14ScanCandidates').close();startScanner()});
  }

  function switchCreateTab(which){
    const empty=which==='empty';
    byId('v14TabEmpty')?.classList.toggle('active',empty);
    byId('v14TabSet')?.classList.toggle('active',!empty);
    byId('v14EmptyPane')?.classList.toggle('hidden',!empty);
    byId('v14SetPane')?.classList.toggle('hidden',empty);
  }

  async function ensureFirstBinder(){
    if(V14.binders.length)return;
    const payload={user_id:currentUser.id,name:'Meu Fichário',pages:Math.max(1,+settings.binder_pages||1),background:settings.binder_background||'graphite',sort_order:1};
    const {data,error}=await db.from('pokemon_binders').insert(payload).select('*').single();
    if(error)throw error;
    V14.binders=[data];
    V14.activeBinderId=data.id;
    await db.from('pokemon_settings').update({current_binder_id:data.id}).eq('user_id',currentUser.id);
  }

  async function loadBinders(){
    if(!currentUser)return;
    const {data,error}=await db.from('pokemon_binders').select('*').eq('user_id',currentUser.id).order('sort_order').order('created_at');
    if(error)throw error;
    V14.binders=data||[];
    await ensureFirstBinder();
    if(V14.activeBinderId==null){
      const stored=settings.current_binder_id;
      V14.activeBinderId=stored&&V14.binders.some(b=>b.id===stored)?stored:'all';
    }else if(V14.activeBinderId!=='all'&&!V14.binders.some(b=>b.id===V14.activeBinderId)){
      V14.activeBinderId=V14.binders[0]?.id||'all';
    }
    renderBinderControls();
  }

  function renderBinderControls(){
    const sel=byId('v14BinderSelect');
    if(sel){
      sel.innerHTML='<option value="all">Geral — todos os fichários</option>'+
        V14.binders.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('');
      sel.value=V14.activeBinderId||'all';
    }
    const sort=byId('v14SortSelect');if(sort)sort.value=activeSort();
    const rename=byId('v14RenameBinder');if(rename)rename.disabled=isGeneral();
    const del=byId('v14DeleteBinder');if(del)del.disabled=isGeneral()||V14.binders.length<=1;
    const add=byId('btnOpenAdd');if(add)add.disabled=isGeneral();
    const hint=document.querySelector('.binder-hint');
    if(hint)hint.textContent=canMove()?'Arraste cartas entre bolsos · clique para detalhes':'Visualização ordenada · movimentação desativada';
  }

  async function selectBinder(id){
    V14.activeBinderId=id||'all';
    currentPage=1;
    await db.from('pokemon_settings').update({current_binder_id:isGeneral()?null:V14.activeBinderId}).eq('user_id',currentUser.id);
    collection=physicalCollection();
    syncLegacySettings();
    renderBinderControls();
    renderAll();
  }

  async function setSortMode(mode){
    mode=['manual','name','type','rarity','number'].includes(mode)?mode:'manual';
    currentPage=1;
    if(isGeneral()){
      settings.general_sort_mode=mode;
      await db.from('pokemon_settings').update({general_sort_mode:mode}).eq('user_id',currentUser.id);
    }else{
      const b=activeBinder();if(!b)return;
      b.sort_mode=mode;
      await db.from('pokemon_binders').update({sort_mode:mode,updated_at:new Date().toISOString()}).eq('id',b.id).eq('user_id',currentUser.id);
    }
    renderBinderControls();
    renderAll();
  }

  async function renameBinder(){
    const b=activeBinder();if(!b)return;
    const name=prompt('Novo nome do fichário:',b.name||'Meu Fichário');
    if(!name?.trim())return;
    const {error}=await db.from('pokemon_binders').update({name:name.trim(),updated_at:new Date().toISOString()}).eq('id',b.id).eq('user_id',currentUser.id);
    if(error)return toast('Não consegui renomear.');
    b.name=name.trim();
    syncLegacySettings();renderBinderControls();renderAll();toast('Fichário renomeado.');
  }

  async function deleteBinder(){
    const b=activeBinder();if(!b)return;
    if(V14.binders.length<=1)return toast('Mantenha pelo menos um fichário.');
    if(!confirm('Excluir o fichário "'+b.name+'" e todas as cartas que estão somente nele?'))return;
    const {error}=await db.from('pokemon_binders').delete().eq('id',b.id).eq('user_id',currentUser.id);
    if(error)return toast('Não consegui excluir o fichário.');
    V14.binders=V14.binders.filter(x=>x.id!==b.id);
    V14.allCards=V14.allCards.filter(x=>x.binder_id!==b.id);
    V14.activeBinderId=V14.binders[0]?.id||'all';
    await db.from('pokemon_settings').update({current_binder_id:isGeneral()?null:V14.activeBinderId}).eq('user_id',currentUser.id);
    collection=physicalCollection();syncLegacySettings();renderBinderControls();renderAll();toast('Fichário excluído.');
  }

  async function createEmptyBinder(){
    const name=(byId('v14EmptyName')?.value||'Novo Fichário').trim()||'Novo Fichário';
    const pages=Math.max(1,Math.min(200,+byId('v14EmptyPages')?.value||4));
    const sortOrder=(Math.max(0,...V14.binders.map(b=>+b.sort_order||0))+1);
    const {data,error}=await db.from('pokemon_binders').insert({user_id:currentUser.id,name,pages,background:'graphite',sort_order:sortOrder,binder_kind:'custom'}).select('*').single();
    if(error)return toast('Não consegui criar o fichário.');
    V14.binders.push(data);
    if(byId('v14BinderDialog')?.open)byId('v14BinderDialog').close();
    await selectBinder(data.id);
    toast('Fichário criado.');
  }

  let setSearchTimer=null;
  function queueSetSearch(){clearTimeout(setSearchTimer);setSearchTimer=setTimeout(searchSets,260)}
  async function fetchSets(lang){
    const key=lang;
    if(V14.setsCache.has(key))return V14.setsCache.get(key);
    const r=await fetch('https://api.tcgdex.net/v2/'+lang+'/sets');
    if(!r.ok)throw new Error('TCGdex '+r.status);
    const data=await r.json();
    V14.setsCache.set(key,Array.isArray(data)?data:[]);
    return V14.setsCache.get(key);
  }
  async function searchSets(){
    const q=nrm(byId('v14SetSearch')?.value);
    const lang=byId('v14MasterLang')?.value||'pt';
    if(q.length<2){byId('v14SetResults').innerHTML='';byId('v14SetStatus').textContent='Digite pelo menos 2 letras.';return}
    byId('v14SetStatus').textContent='Buscando coleções…';
    try{
      const sets=await fetchSets(lang);
      const score=s=>{
        const name=nrm(s.name),id=nrm(s.id);
        if(name===q)return 1000;
        if(name.startsWith(q))return 800;
        if(name.includes(q))return 600;
        const words=q.split(' ').filter(Boolean);
        return words.reduce((n,w)=>n+(name.includes(w)?80:0),0)+(id.includes(q)?100:0);
      };
      const found=sets.map(s=>({s,score:score(s)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,30).map(x=>x.s);
      byId('v14SetStatus').textContent=found.length+' coleção(ões) encontrada(s).';
      byId('v14SetResults').innerHTML=found.map(s=>
        '<button type="button" data-set-id="'+esc(s.id)+'"><strong>'+esc(s.name)+'</strong><small>'+esc(s.id)+' · '+esc(String(s.cardCount?.total||s.cardCount?.official||''))+' cartas</small></button>'
      ).join('');
      byId('v14SetResults').querySelectorAll('[data-set-id]').forEach(b=>b.onclick=()=>loadMasterPreview(lang,b.dataset.setId));
    }catch(e){console.error(e);byId('v14SetStatus').textContent='Não consegui carregar as coleções.'}
  }

  async function loadMasterPreview(lang,setId){
    byId('v14SetStatus').textContent='Carregando cartas e variantes do Master Set…';
    byId('v14MasterStep').classList.add('hidden');
    try{
      const r=await fetch('/api/master-set?lang='+encodeURIComponent(lang)+'&set='+encodeURIComponent(setId),{cache:'no-store'});
      const j=await r.json();
      if(!j?.ok)throw new Error(j?.message||'Falha no Master Set');
      V14.masterPreview={...j,owned:new Set(),lang};
      byId('v14MasterTitle').textContent=j.set.name;
      byId('v14MasterMeta').textContent=[j.set.series,j.set.releaseDate,j.entries.length+' entradas/variantes'].filter(Boolean).join(' · ');
      renderMasterGrid();
      byId('v14SetStatus').textContent='Master Set pronto para conferência.';
      byId('v14MasterStep').classList.remove('hidden');
    }catch(e){console.error(e);byId('v14SetStatus').textContent='Erro ao montar a coleção: '+(e.message||e)}
  }

  function masterImage(entry){
    const u=entry.imageUrl||'';
    return u&&u.includes('assets.tcgdex.net')&&!/\.(webp|png|jpe?g)$/i.test(u)?u+'/high.webp':u;
  }
  function renderMasterGrid(){
    const p=V14.masterPreview,g=byId('v14MasterGrid');if(!p||!g)return;
    g.innerHTML=p.entries.map((e,i)=>{
      const owned=p.owned.has(i),img=masterImage(e);
      return '<button type="button" class="v14-master-card '+(owned?'owned':'')+'" data-master-index="'+i+'">'+
        (img?'<img src="'+esc(img)+'" loading="lazy" alt="'+esc(e.name)+'">':'<div class="v14-no-img">'+esc(e.name)+'</div>')+
        '<strong>'+esc(e.name)+'</strong><small>#'+esc(e.number)+' · '+esc(e.variantLabel)+'</small><span>'+(owned?'TENHO':'NÃO TENHO')+'</span>'+
      '</button>';
    }).join('');
    g.querySelectorAll('[data-master-index]').forEach(b=>b.onclick=()=>{
      const i=+b.dataset.masterIndex;
      if(p.owned.has(i))p.owned.delete(i);else p.owned.add(i);
      b.classList.toggle('owned',p.owned.has(i));
      b.querySelector('span').textContent=p.owned.has(i)?'TENHO':'NÃO TENHO';
      byId('v14OwnedCount').textContent=p.owned.size;
    });
    byId('v14OwnedCount').textContent=p.owned.size;
  }

  async function createMasterBinder(){
    const p=V14.masterPreview;if(!p)return;
    const btn=byId('v14CreateMaster');busy(btn,true,'Criando fichário…');
    try{
      const pages=Math.max(1,Math.ceil(p.entries.length/9));
      const sortOrder=Math.max(0,...V14.binders.map(b=>+b.sort_order||0))+1;
      const {data:binder,error:be}=await db.from('pokemon_binders').insert({
        user_id:currentUser.id,name:p.set.name,pages,background:'graphite',sort_order:sortOrder,binder_kind:'set',
        set_id:p.set.id,set_name:p.set.name,set_language:p.set.languageCode,master_language:p.set.languageCode,master_total:p.entries.length
      }).select('*').single();
      if(be)throw be;
      const rows=p.entries.map((e,i)=>{
        const owned=p.owned.has(i),page=Math.floor(i/9)+1,slot=i%9+1;
        const base={
          source:e.source,apiId:e.apiId,name:e.name,languageCode:e.languageCode,language:e.language,
          setName:e.setName,setId:e.setId,number:e.printedTotal?e.number+'/'+e.printedTotal:e.number,
          rarity:e.rarity,type:e.type,imageUrl:e.imageUrl
        };
        const payload=cardPayload(base,{page,slot,status:owned?'owned':'missing',quantity:owned?1:0,condition:'Nova',finish:e.finish,finishConfirmed:true,notes:e.variantLabel},{});
        payload.user_id=currentUser.id;
        payload.binder_id=binder.id;
        payload.card_key=(payload.card_key||cardKey(base))+'|variant:'+String(e.variantKey||e.variantLabel||e.finish);
        payload.price_pending=owned;
        payload.price_checked_at=null;
        return payload;
      });
      for(let i=0;i<rows.length;i+=100){
        const {error}=await db.from('pokemon_cards').insert(rows.slice(i,i+100));
        if(error)throw error;
      }
      V14.binders.push(binder);
      if(byId('v14BinderDialog')?.open)byId('v14BinderDialog').close();
      V14.masterPreview=null;
      await selectBinder(binder.id);
      const ownedCards=collection.filter(c=>c.collection_status==='owned');
      queueBackgroundPrices(ownedCards);
      toast('Master Set criado: '+rows.length+' entradas. Preços atualizando em segundo plano.');
    }catch(e){console.error(e);toast('Erro ao criar Master Set: '+(e.message||e))}
    finally{busy(btn,false)}
  }

  async function loadCardsV14(show=true){
    if(!currentUser)return;
    await loadBinders();
    const {data,error}=await db.from('pokemon_cards').select('*').eq('user_id',currentUser.id).order('binder_page').order('binder_slot');
    if(error){console.error(error);toast('Erro ao carregar cartas.');return}
    V14.allCards=data||[];
    collection=physicalCollection();
    syncLegacySettings();
    renderBinderControls();
    renderAll();
    if(show)toast('Fichário atualizado.');
  }

  async function updateSettingsV14(patch,silent=false){
    const binderFields={};
    const globalPatch={...patch};
    if(!isGeneral()){
      if(Object.prototype.hasOwnProperty.call(globalPatch,'binder_name')){binderFields.name=globalPatch.binder_name;delete globalPatch.binder_name}
      if(Object.prototype.hasOwnProperty.call(globalPatch,'binder_pages')){binderFields.pages=Math.max(1,+globalPatch.binder_pages||1);delete globalPatch.binder_pages}
      if(Object.prototype.hasOwnProperty.call(globalPatch,'binder_background')){binderFields.background=globalPatch.binder_background;delete globalPatch.binder_background}
      if(Object.keys(binderFields).length){
        binderFields.updated_at=new Date().toISOString();
        const b=activeBinder();
        const {error}=await db.from('pokemon_binders').update(binderFields).eq('id',b.id).eq('user_id',currentUser.id);
        if(error&&!silent)toast('Não consegui salvar o fichário.');
        Object.assign(b,binderFields);
      }
    }
    if(Object.keys(globalPatch).length){
      settings={...settings,...globalPatch};
      const {error}=await db.from('pokemon_settings').update(globalPatch).eq('user_id',currentUser.id);
      if(error&&!silent)toast('Não consegui salvar a configuração.');
    }
    syncLegacySettings();applySettings();
  }

  function applySettingsV14(){
    syncLegacySettings();
    V14.original.applySettings();
    renderBinderControls();
  }

  function renderPocketCardV14(card){
    const b=V14.original.renderPocketCard(card);
    const movable=canMove();
    b.draggable=movable;
    b.classList.toggle('v14-no-drag',!movable);
    if(card.price_pending){
      const tag=document.createElement('span');tag.className='v14-price-pending';tag.textContent='Preço…';b.appendChild(tag);
    }
    return b;
  }

  function customViewPages(){
    return Math.max(1,Math.ceil(orderedViewCards().length/9));
  }
  function renderBinderV14(){
    if(!isGeneral()&&activeSort()==='manual')return V14.original.renderBinder();
    const g=byId('binderSheet');if(!g)return;
    const cards=orderedViewCards(),pages=customViewPages();
    currentPage=Math.min(Math.max(1,currentPage),pages);
    const slice=cards.slice((currentPage-1)*9,currentPage*9);
    g.innerHTML='';
    for(let slot=0;slot<9;slot++){
      const pocket=document.createElement('div');pocket.className='binder-pocket v14-ordered-pocket';
      const c=slice[slot];
      if(c)pocket.appendChild(renderPocketCard(c));
      else{const empty=document.createElement('div');empty.className='v14-empty-ordered';empty.textContent='';pocket.appendChild(empty)}
      g.appendChild(pocket);
    }
    byId('pageLabel').textContent='Página '+currentPage+' · '+currentPage+'/'+pages;
    byId('prevPage').disabled=currentPage<=1;
    byId('nextPage').disabled=currentPage>=pages;
  }

  function renderPagesGridV14(){
    if(!isGeneral()&&activeSort()==='manual')return V14.original.renderPagesGrid();
    const g=byId('pagesGrid');if(!g)return;
    const cards=orderedViewCards(),pages=customViewPages();g.innerHTML='';
    for(let p=1;p<=pages;p++){
      const b=document.createElement('button');b.className='page-thumb'+(p===currentPage?' active':'');
      const chunk=cards.slice((p-1)*9,p*9);
      const cells=[];
      for(let s=0;s<9;s++){
        const c=chunk[s],img=c?cardImage(c):'';
        cells.push('<span class="page-mini-pocket">'+(img?'<img src="'+esc(img)+'">':'')+'</span>');
      }
      b.innerHTML='<strong>Página '+p+'</strong><div class="page-mini-grid">'+cells.join('')+'</div><small>'+chunk.length+'/9</small>';
      b.onclick=()=>{currentPage=p;renderBinder();renderPagesGrid();closeDialog('pagesDialog')};
      g.appendChild(b);
    }
  }

  function renderSummaryV14(){
    const oldPages=settings.binder_pages;
    if(isGeneral())settings.binder_pages=Math.max(1,Math.ceil(collection.length/9));
    V14.original.renderSummary();
    settings.binder_pages=oldPages;
    if(isGeneral())byId('sumEmpty').textContent='—';
  }

  async function moveCardV14(card,page,slot){
    if(!canMove())return toast('Movimentação só fica disponível em Ordem do fichário.');
    return V14.original.moveCard(card,page,slot);
  }
  async function contextActionV14(action){
    if(action==='move'&&!canMove()){hideContext();return toast('Mover só fica disponível em Ordem do fichário.')}
    return V14.original.contextAction(action);
  }
  function openAddV14(page=currentPage,slot=null){
    if(isGeneral())return toast('Escolha um fichário antes de adicionar cartas.');
    return V14.original.openAddForPosition(page,slot);
  }
  async function addPageV14(){
    if(isGeneral())return toast('Escolha um fichário físico para adicionar páginas.');
    return V14.original.addPage();
  }

  function patchCardPayload(){
    const original=cardPayload;
    cardPayload=function(c,v,m={}){
      const p=original(c,v,m);
      const existing=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null;
      p.binder_id=existing?.binder_id||(isGeneral()?null:V14.activeBinderId);
      return p;
    };
  }

  function selectionVariantValues(key){
    const encoded=encodeURIComponent(key);
    const finish=document.querySelector('[data-finish-key="'+CSS.escape(encoded)+'"]')?.value||'';
    const condition=document.querySelector('[data-condition-key="'+CSS.escape(encoded)+'"]')?.value||'';
    return{finish,condition};
  }

  async function addSelectedFast(){
    let cards=[];try{cards=[...catalogSelection.entries()]}catch{}
    if(!cards.length)return;
    if(isGeneral())return toast('Escolha um fichário antes de adicionar.');
    for(const [key] of cards){
      const v=selectionVariantValues(key);
      if(!v.finish||!v.condition)return toast('Escolha o acabamento e a condição antes de adicionar.');
    }
    const b=byId('btnAddSelected');busy(b,true,'Adicionando…');
    const saved=[];
    try{
      const positions=freePositions(pendingPosition?.page||currentPage,cards.length);
      const maxPage=Math.max(...positions.map(p=>p.page));
      if(maxPage>currentBinderPages())await updateSettings({binder_pages:maxPage},true);
      for(let i=0;i<cards.length;i++){
        const [key,raw]=cards[i],pos=positions[i],v=selectionVariantValues(key),card={...raw};
        const payload=cardPayload(card,{page:pos.page,slot:pos.slot,status:'owned',quantity:1,condition:v.condition,finish:v.finish,finishConfirmed:true,notes:''},{});
        payload.user_id=currentUser.id;
        payload.binder_id=V14.activeBinderId;
        payload.price_pending=true;
        payload.price_checked_at=null;
        const {data:existing,error:findErr}=await db.from('pokemon_cards')
          .select('*').eq('user_id',currentUser.id).eq('binder_id',V14.activeBinderId)
          .eq('card_key',payload.card_key).eq('condition',payload.condition).eq('finish',payload.finish).maybeSingle();
        if(findErr)throw findErr;
        if(existing){
          const {data,error}=await db.from('pokemon_cards').update({quantity:(+existing.quantity||0)+1,collection_status:'owned',price_pending:true})
            .eq('id',existing.id).eq('user_id',currentUser.id).select('*').single();
          if(error)throw error;saved.push(data);
        }else{
          const {data,error}=await db.from('pokemon_cards').insert(payload).select('*').single();
          if(error)throw error;saved.push(data);
        }
      }
      catalogSelection.clear();
      if(byId('addDialog')?.open)byId('addDialog').close();
      currentPage=positions[0]?.page||currentPage;
      busy(b,false);
      await loadCards(false);
      toast(cards.length+' carta'+(cards.length===1?'':'s')+' adicionada'+(cards.length===1?'':'s')+'. Preço atualizando em segundo plano.');
      queueBackgroundPrices(saved);
    }catch(e){console.error(e);toast('Não consegui adicionar todas as cartas.');busy(b,false)}
  }

  function queueBackgroundPrices(cards){
    for(const card of cards||[]){
      if(!card?.id||V14.priceJobs.has(card.id)||V14.priceQueue.some(x=>x.id===card.id))continue;
      V14.priceQueue.push(card);
      V14.priceJobs.set(card.id,true);
    }
    while(V14.priceWorkers<2&&V14.priceQueue.length)runPriceWorker();
  }
  async function runPriceWorker(){
    V14.priceWorkers++;
    try{
      while(V14.priceQueue.length){
        const card=V14.priceQueue.shift();
        try{
          const cardForPrice={
            ...card,
            apiId:card.api_id,api_id:card.api_id,
            name:card.name,number:card.number,setName:card.set_name,setId:card.set_id,
            languageCode:card.language_code,finish:card.finish,condition:card.condition,
            myp_price_link:card.myp_price_link,price_br_link:card.price_br_link,price_link:card.price_link
          };
          const dual=await window.queryBothMarketsV122(cardForPrice,card.finish||'Normal',card.condition||'Nova');
          const m=dual?.myp;
          const patch={price_pending:false};
          if(m&&(Number(m.min)||Number(m.avg)||Number(m.max))){
            Object.assign(patch,{
              myp_price_min:+m.min||0,myp_price_avg:+m.avg||0,myp_price_max:+m.max||0,myp_price_link:m.link||card.myp_price_link||null,myp_price_checked_at:m.checkedAt||new Date().toISOString(),
              price_min:+m.min||0,price_avg:+m.avg||+m.min||+m.max||0,price_max:+m.max||0,currency:'BRL',
              price_source:'MYP Cards',price_link:m.link||card.price_link||'',price_br_source:'MYP Cards',price_br_link:m.link||card.price_br_link||null,price_checked_at:m.checkedAt||new Date().toISOString()
            });
          }
          const {error}=await db.from('pokemon_cards').update(patch).eq('id',card.id).eq('user_id',currentUser.id);
          if(error)throw error;
          const target=V14.allCards.find(x=>x.id===card.id);if(target)Object.assign(target,patch);
          const visible=collection.find(x=>x.id===card.id);if(visible)Object.assign(visible,patch);
          try{renderBinder();renderSummary()}catch{}
        }catch(e){
          console.warn('[V14 preço em segundo plano]',card.name,e);
          try{await db.from('pokemon_cards').update({price_pending:false}).eq('id',card.id).eq('user_id',currentUser.id)}catch{}
        }finally{
          V14.priceJobs.delete(card.id);
          await sleep(450);
        }
      }
    }finally{
      V14.priceWorkers=Math.max(0,V14.priceWorkers-1);
      if(V14.priceQueue.length&&V14.priceWorkers<2)runPriceWorker();
    }
  }

  async function saveSelectedCardV14(){
    if(!selectedCard)return;
    const existingEditing=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null;
    const binderId=existingEditing?.binder_id||(isGeneral()?null:V14.activeBinderId);
    if(!binderId)return toast('Escolha um fichário antes de salvar.');
    const b=byId('btnSaveCard'),page=Math.max(1,+byId('cardPage').value||1),slot=Math.min(9,Math.max(1,+byId('cardSlot').value||1));
    const condition=byId('cardCondition').value,finish=byId('cardFinish').value,quantity=selectedStatus==='owned'?Math.max(1,+byId('cardQuantity').value||1):0;
    busy(b,true,'Salvando…');
    try{
      const payload=cardPayload(selectedCard,{page,slot,status:selectedStatus,quantity,condition,finish,notes:byId('cardNotes').value.trim()},selectedMarket||{});
      payload.binder_id=binderId;
      if(editingCardId){
        const {error}=await db.from('pokemon_cards').update(payload).eq('id',editingCardId).eq('user_id',currentUser.id);if(error)throw error;
      }else{
        const {data:existing,error:e}=await db.from('pokemon_cards').select('id,quantity').eq('user_id',currentUser.id).eq('binder_id',binderId).eq('card_key',payload.card_key).eq('condition',condition).eq('finish',finish).maybeSingle();
        if(e)throw e;
        if(existing){
          const {error}=await db.from('pokemon_cards').update({...payload,user_id:undefined,quantity:selectedStatus==='owned'?(+existing.quantity||0)+quantity:0}).eq('id',existing.id).eq('user_id',currentUser.id);if(error)throw error;
        }else{
          const {error}=await db.from('pokemon_cards').insert(payload);if(error)throw error;
        }
      }
      closeDialog('cardDialog');editingCardId=null;await loadCards(false);toast('Carta salva.');
    }catch(e){console.error(e);toast('Erro ao salvar: '+(e.message||'tente novamente'))}
    finally{busy(b,false)}
  }

  async function japaneseImageFallback(card){
    if(!card||card.imageUrl||card.languageCode!=='ja')return card?.imageUrl||'';
    const key=[card.apiId,card.name,card.number].join('|');
    if(V14.jpImageCache.has(key))return V14.jpImageCache.get(key);
    try{
      const p=new URLSearchParams({name:card.name||'',number:card.number||'',rarity:card.rarity||'',hp:card.hp||''});
      const r=await fetch('/api/card-image-fallback?'+p.toString());
      const j=await r.json();
      const url=j?.ok?j.url:'';
      V14.jpImageCache.set(key,url);
      return url;
    }catch{V14.jpImageCache.set(key,'');return''}
  }

  function patchJapaneseImages(){
    const original=fetchTCGdexCard;
    fetchTCGdexCard=async function(lang,id,fallback=null){
      const card=await original(lang,id,fallback);
      if(card&&lang==='ja'&&!card.imageUrl){
        try{
          const raw=await fetch(TCGDEX_BASE+'/ja/cards/'+encodeURIComponent(id)).then(r=>r.ok?r.json():null);
          if(raw){card.hp=raw.hp||null;card.rarity=card.rarity||raw.rarity||''}
        }catch{}
        const img=await japaneseImageFallback(card);
        if(img){card.imageUrl=img;card.imageFallback=true}
      }
      return card;
    };
  }

  function cleanOCRLine(v){
    return String(v||'').replace(/[^\p{L}\p{N}\s.'\-]/gu,' ').replace(/\s+/g,' ').trim();
  }
  function parseOCRTexts(texts){
    const all=texts.join('\n');
    const numbers=[];
    for(const m of all.matchAll(/(\d{1,4})\s*[\/|I]\s*(\d{1,4})/g)){
      const a=+m[1],b=+m[2];if(a>0&&b>0&&a<=9999&&b<=9999)numbers.push(a+'/'+b);
    }
    const ignore=/^(basic|b[aá]sico|stage|est[aá]gio|hp|ability|habilidade|trainer|treinador|weakness|fraqueza|resistance|resist[eê]ncia|retreat|recuo|illus|illustrator|pokemon|pok[eé]mon)$/i;
    const names=[];
    for(const t of texts){
      const lines=String(t||'').split(/\n+/).map(cleanOCRLine).filter(Boolean);
      for(let line of lines.slice(0,18)){
        line=line.replace(/\bHP\s*\d+.*/i,'').replace(/^\W+|\W+$/g,'').trim();
        if(line.length<3||line.length>32||ignore.test(line))continue;
        if(/\b(ataque|damage|dano|energia|energy|fraqueza|weakness|resistencia|retreat)\b/i.test(line))continue;
        if((line.match(/\d/g)||[]).length>2)continue;
        if(/[A-Za-zÀ-ÿ]{3}/.test(line))names.push(line);
      }
    }
    const count=a=>{const m=new Map();for(const x of a){const k=nrm(x);if(!k)continue;const old=m.get(k)||{value:x,count:0};old.count++;if(x.length<old.value.length+8)old.value=x;m.set(k,old)}return [...m.values()].sort((a,b)=>b.count-a.count||a.value.length-b.value.length)};
    return{nameCandidates:count(names).slice(0,6),numberCandidates:count(numbers).slice(0,4)};
  }
  function scannerCardCanvas(videoOrImage){
    const sw=videoOrImage.videoWidth||videoOrImage.naturalWidth||videoOrImage.width;
    const sh=videoOrImage.videoHeight||videoOrImage.naturalHeight||videoOrImage.height;
    const ratio=63/88;
    let cw=Math.min(sw*.88,sh*.82*ratio),ch=cw/ratio;
    if(ch>sh*.9){ch=sh*.9;cw=ch*ratio}
    const sx=(sw-cw)/2,sy=(sh-ch)/2;
    const canvas=document.createElement('canvas');canvas.width=720;canvas.height=Math.round(720/ratio);
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(videoOrImage,sx,sy,cw,ch,0,0,canvas.width,canvas.height);
    return canvas;
  }
  function cropCanvas(src,y0,y1,threshold=false){
    const c=document.createElement('canvas');c.width=src.width;c.height=Math.max(1,Math.round(src.height*(y1-y0)));
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(src,0,src.height*y0,src.width,src.height*(y1-y0),0,0,c.width,c.height);
    if(threshold){
      const im=ctx.getImageData(0,0,c.width,c.height),d=im.data;
      for(let i=0;i<d.length;i+=4){const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];const v=g>145?255:0;d[i]=d[i+1]=d[i+2]=v}
      ctx.putImageData(im,0,0);
    }
    return c;
  }
  async function ocrCard(source,status){
    if(typeof ensureOCR!=='function'||!await ensureOCR())throw new Error('OCR indisponível');
    const full=scannerCardCanvas(source);
    const regions=[
      cropCanvas(full,0,.30,true),
      cropCanvas(full,.68,1,true),
      cropCanvas(full,0,.34,false),
      cropCanvas(full,.62,1,false)
    ];
    const texts=[];
    for(let i=0;i<regions.length;i++){
      if(status)status.textContent='Lendo carta · etapa '+(i+1)+'/'+regions.length+'…';
      try{
        const r=await window.Tesseract.recognize(regions[i],'por+eng');
        texts.push(r?.data?.text||'');
      }catch{}
    }
    return parseOCRTexts(texts);
  }
  function evidenceBest(map){
    return [...map.entries()].sort((a,b)=>b[1].count-a[1].count||b[1].value.length-a[1].value.length)[0]?.[1]||null;
  }
  function mergeEvidence(hint){
    for(const x of hint.nameCandidates||[]){const k=nrm(x.value),old=V14.scan.evidenceNames.get(k)||{value:x.value,count:0};old.count+=x.count;V14.scan.evidenceNames.set(k,old)}
    for(const x of hint.numberCandidates||[]){const k=x.value,old=V14.scan.evidenceNumbers.get(k)||{value:x.value,count:0};old.count+=x.count;V14.scan.evidenceNumbers.set(k,old)}
    return{name:evidenceBest(V14.scan.evidenceNames)?.value||'',number:evidenceBest(V14.scan.evidenceNumbers)?.value||''};
  }
  async function showScanCandidates(hint){
    stopScanner();
    if(byId('scanDialog')?.open)byId('scanDialog').close();
    openAddForPosition(currentPage);
    byId('searchLanguage').value='all';
    byId('searchName').value=hint.name||'';
    byId('searchNumber').value=hint.number||'';
    byId('ocrStatus').textContent='Scanner: '+[hint.name,hint.number].filter(Boolean).join(' · ')+' · confirme a carta abaixo.';
    await searchCards({live:false});
    const best=[...catalogResults].slice(0,6);
    if(!best.length){byId('ocrStatus').textContent='Scanner leu '+[hint.name,hint.number].filter(Boolean).join(' · ')+' mas não encontrou candidato seguro. Ajuste a foto ou use busca manual.';return}
    const dlg=byId('v14ScanCandidates'),grid=byId('v14ScanCandidateGrid');
    byId('v14ScanReadout').textContent='Leitura: '+[hint.name,hint.number].filter(Boolean).join(' · ')+' · escolha a impressão correta.';
    grid.innerHTML=best.map((c,i)=>{
      const img=cardImage(c);
      return '<button type="button" class="catalog-card" data-scan-index="'+i+'">'+(img?'<img src="'+esc(img)+'" alt="'+esc(c.name)+'">':'')+'<strong>'+esc(c.name)+'</strong><small>'+esc(c.setName||'')+' · '+esc(c.number||'')+'</small></button>';
    }).join('');
    grid.querySelectorAll('[data-scan-index]').forEach(b=>b.onclick=()=>{
      const c=best[+b.dataset.scanIndex],key=cardKey(c);
      catalogSelection.clear();catalogSelection.set(key,c);updateSelectionTray();
      byId('resultsList')?.dispatchEvent(new Event('click',{bubbles:true}));
      if(dlg.open)dlg.close();
      if(byId('addDialog')&&!byId('addDialog').open)byId('addDialog').showModal();
      setTimeout(()=>{try{const target=[...document.querySelectorAll('#resultsList .catalog-card')].find(x=>x.textContent.includes(c.name));target?.scrollIntoView({block:'center'})}catch{}},80);
    });
    if(dlg&&!dlg.open)dlg.showModal();
  }
  async function scanLiveTick(){
    if(!V14.scan.stream||V14.scan.busy)return;
    const video=byId('scanVideo'),status=byId('scanLiveStatus');
    if(!video?.videoWidth){V14.scan.timer=setTimeout(scanLiveTick,500);return}
    V14.scan.busy=true;
    try{
      const hint=mergeEvidence(await ocrCard(video,status));
      if(status)status.textContent='Lido: '+([hint.name,hint.number].filter(Boolean).join(' · ')||'procurando…');
      const num=evidenceBest(V14.scan.evidenceNumbers),name=evidenceBest(V14.scan.evidenceNames);
      if((num&&name)||(num&&num.count>=2)||(name&&name.count>=2&&name.value.length>=4)){
        await showScanCandidates(hint);return;
      }
    }catch(e){console.warn('[Scanner V14]',e);if(status)status.textContent='Ajuste distância, foco e reflexo — tentando novamente…'}
    finally{
      V14.scan.busy=false;
      if(V14.scan.stream)V14.scan.timer=setTimeout(scanLiveTick,1200);
    }
  }
  function stopScanner(){
    if(V14.scan.timer){clearTimeout(V14.scan.timer);V14.scan.timer=null}
    if(V14.scan.stream){V14.scan.stream.getTracks().forEach(t=>t.stop());V14.scan.stream=null}
    V14.scan.busy=false;
    const v=byId('scanVideo');if(v)v.srcObject=null;
  }
  async function startScanner(){
    if(isGeneral())return toast('Escolha um fichário antes de escanear e adicionar uma carta.');
    stopScanner();V14.scan.evidenceNames.clear();V14.scan.evidenceNumbers.clear();
    if(byId('addDialog')?.open)byId('addDialog').close();
    if(!byId('scanDialog')?.open)byId('scanDialog').showModal();
    const status=byId('scanLiveStatus');if(status)status.textContent='Abrindo câmera traseira…';
    try{
      V14.scan.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:2560},focusMode:{ideal:'continuous'}},audio:false});
      const v=byId('scanVideo');v.srcObject=V14.scan.stream;await v.play();
      if(status)status.textContent='Mantenha a carta inteira na moldura · leitura em múltiplas regiões';
      V14.scan.timer=setTimeout(scanLiveTick,500);
    }catch(e){console.error(e);if(status)status.textContent='Não consegui abrir a câmera. Verifique a permissão.'}
  }
  async function analyzePhoto(file){
    if(!file)return;
    const status=byId('ocrStatus');if(status)status.textContent='Analisando foto inteira, nome e número…';
    try{
      const img=new Image(),url=URL.createObjectURL(file);
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});
      const hint=await ocrCard(img,status);URL.revokeObjectURL(url);
      const merged={name:hint.nameCandidates?.[0]?.value||'',number:hint.numberCandidates?.[0]?.value||''};
      if(!merged.name&&!merged.number){if(status)status.textContent='Não consegui ler nome nem número. Tente uma foto mais reta, focada e sem reflexo.';return}
      await showScanCandidates(merged);
    }catch(e){console.error(e);if(status)status.textContent='Não consegui analisar a foto. Tente outra imagem.'}
  }

  function wireScanner(){
    const live=byId('btnLiveScan'),mobile=byId('btnMobileScan'),close=byId('btnCloseLiveScan'),manual=byId('btnScanManual'),photo=byId('cardPhoto');
    if(live)live.onclick=startScanner;
    if(mobile)mobile.onclick=startScanner;
    if(close)close.onclick=()=>{stopScanner();if(byId('scanDialog')?.open)byId('scanDialog').close()};
    if(manual)manual.onclick=()=>{stopScanner();if(byId('scanDialog')?.open)byId('scanDialog').close();openAddForPosition(currentPage)};
    if(photo)photo.onchange=()=>{const f=photo.files?.[0];if(f)analyzePhoto(f)};
    byId('scanDialog')?.addEventListener('close',stopScanner);
  }

  function patchFunctions(){
    V14.original={
      loadCards,updateSettings,applySettings,renderBinder,renderSummary,renderPagesGrid,renderPocketCard,moveCard,contextAction,openAddForPosition,addPage,saveSelectedCard
    };
    loadCards=loadCardsV14;
    updateSettings=updateSettingsV14;
    applySettings=applySettingsV14;
    renderBinder=renderBinderV14;
    renderSummary=renderSummaryV14;
    renderPagesGrid=renderPagesGridV14;
    renderPocketCard=renderPocketCardV14;
    moveCard=moveCardV14;
    contextAction=contextActionV14;
    openAddForPosition=openAddV14;
    addPage=addPageV14;
    saveSelectedCard=saveSelectedCardV14;
    patchCardPayload();
    patchJapaneseImages();
  }

  function wireFastAdd(){
    const b=byId('btnAddSelected');if(b)b.onclick=addSelectedFast;
    const save=byId('btnSaveCard');if(save)save.onclick=saveSelectedCardV14;
  }

  async function bootV14(){
    injectUI();
    wireScanner();
    wireFastAdd();
    if(currentUser){
      try{await loadCardsV14(false)}catch(e){console.error('[V14 init]',e)}
    }
    const app=byId('app');
    if(app)new MutationObserver(async()=>{
      if(currentUser&&!app.classList.contains('hidden')&&!V14.binders.length){
        try{await loadCardsV14(false)}catch(e){console.error(e)}
      }
      wireFastAdd();wireScanner();
    }).observe(app,{attributes:true,attributeFilter:['class']});
    const add=byId('addDialog');
    if(add)new MutationObserver(()=>wireFastAdd()).observe(add,{attributes:true,attributeFilter:['open']});
  }

  patchFunctions();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootV14);
  else bootV14();
})();

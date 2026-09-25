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
    singlePriceWatch:null,
    bulkPriceWatch:null,
    scan:{stream:null,timer:null,busy:false,evidenceNames:new Map(),evidenceNumbers:new Map(),lastFingerprint:null,lastVisualDescriptors:[],imageDescriptorCache:new Map(),pendingPosition:null,setHint:'',visualFrameCount:0,visualIndex:null,visualIndexPromise:null},
    setsCache:new Map(),
    seriesCache:new Map(),
    masterPreview:null,
    masterSelections:[],
    masterEpoch:0,
    favoritesOnly:false,
    binderSearchQuery:'',
    binderSearchMatches:[],
    viewScope:'all',
    rarityFilters:new Set(),
    priceAuditWatchSeq:0,
    priceAuditBatch:null,
    priceAuditPollTimer:0
  };
  window.PB14=V14;

  const byId=id=>document.getElementById(id);
  const nrm=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function activeBinder(){
    return V14.binders.find(b=>b.id===V14.activeBinderId)||null;
  }
  function wishlistBinder(){return V14.binders.find(b=>b.binder_kind==='wishlist')||null}
  function isWishlistBinder(b=activeBinder()){return !!b&&b.binder_kind==='wishlist'}
  async function ensureWishlistBinder(){
    if(!currentUser)return null;
    let wishlist=wishlistBinder();
    if(wishlist)return wishlist;
    const legacy=V14.binders.find(b=>['quero comprar','lista de desejos'].includes(nrm(b.name)));
    if(legacy){
      const {data,error}=await db.from('pokemon_binders')
        .update({name:'Lista de Desejos',binder_kind:'wishlist',updated_at:new Date().toISOString()})
        .eq('id',legacy.id).eq('user_id',currentUser.id).select('*').single();
      if(error)throw error;
      Object.assign(legacy,data||{name:'Lista de Desejos',binder_kind:'wishlist'});
      const {error:cardsError}=await db.from('pokemon_cards')
        .update({collection_status:'wanted',quantity:0,updated_at:new Date().toISOString()})
        .eq('binder_id',legacy.id).eq('user_id',currentUser.id);
      if(cardsError)throw cardsError;
      return legacy;
    }
    const sortOrder=Math.max(0,...V14.binders.map(b=>+b.sort_order||0))+1;
    const {data,error}=await db.from('pokemon_binders').insert({
      user_id:currentUser.id,name:'Lista de Desejos',pages:4,background:'graphite',
      sort_order:sortOrder,binder_kind:'wishlist',sort_mode:'manual_asc'
    }).select('*').single();
    if(error)throw error;
    V14.binders.push(data);
    return data;
  }
  function isFavorites(){return V14.activeBinderId==='favorites'}
  function isGeneral(){return V14.activeBinderId==='all'||isFavorites()}
  function normalizeSortMode(mode){
    return ({
      manual:'manual_asc',
      name:'name_asc',
      type:'type_asc',
      rarity:'rarity_asc',
      number:'number_asc'
    })[mode]||mode||'manual_asc';
  }
  function activeSort(){
    if(isGeneral())return normalizeSortMode(settings.general_sort_mode||'manual_asc');
    return normalizeSortMode(activeBinder()?.sort_mode||'manual_asc');
  }
  function binderViewScope(){
    return ['all','owned','missing'].includes(V14.viewScope)?V14.viewScope:'all';
  }
  function canMove(){return !isGeneral()&&activeSort()==='manual_asc'&&binderViewScope()==='all'&&!V14.favoritesOnly&&!V14.binderSearchQuery&&!(V14.rarityFilters?.size)}
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
      settings.binder_name=isFavorites()?'Favoritas':'Geral';
      settings.binder_pages=Math.max(1,Math.ceil(groupedVirtualCards(physicalCollection()).length/9));
      settings.binder_background='graphite';
    }
  }
  function physicalCollection(){
    const base=isGeneral()?V14.allCards:V14.allCards.filter(c=>c.binder_id===V14.activeBinderId);
    return (isFavorites()||V14.favoritesOnly)?base.filter(c=>!!c.is_favorite):base;
  }
  function numberValue(v){
    const m=String(v||'').match(/\d+/);
    return m?Number(m[0]):999999;
  }
  function canonicalCardIdentityKey(card){
    // Used ONLY by virtual views (Geral/Favoritas). Physical binders never group.
    // Language is mandatory: JP/PT/EN are different cards even with same art/name.
    const lang=nrm(card?.language_code||card?.languageCode||'');
    const set=nrm(card?.set_id||card?.setId||card?.set_name||card?.setName||'');
    const parts=typeof numParts==='function'?numParts(card?.number||''):{full:String(card?.number||'')};
    const number=nrm(parts.full||card?.number||'');
    const name=nrm(card?.name||'');
    const finish=nrm(card?.finish||'Normal');
    const condition=nrm(card?.condition||'Nova');
    return [lang,set,number,name,finish,condition].join('|');
  }
  function groupedVirtualCards(cards){
    const groups=new Map();
    for(const card of cards||[]){
      const key=canonicalCardIdentityKey(card);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(card);
    }
    const out=[];
    const priceFields=[
      'price_min','price_avg','price_max','price_source','price_link','price_checked_at',
      'price_br_source','price_br_link','myp_price_min','myp_price_avg','myp_price_max',
      'myp_price_link','myp_price_checked_at','currency'
    ];
    for(const rows of groups.values()){
      const owned=rows.filter(x=>(x.collection_status||'owned')==='owned');
      const representative=owned[0]||rows[0];
      const priced=[...rows].sort((a,b)=>{
        const at=Date.parse(a.myp_price_checked_at||a.price_checked_at||a.updated_at||0)||0;
        const bt=Date.parse(b.myp_price_checked_at||b.price_checked_at||b.updated_at||0)||0;
        return bt-at;
      }).find(x=>Number(x.price_avg||x.price_min||x.price_max||x.myp_price_avg||x.myp_price_min||x.myp_price_max))||representative;
      const quantity=owned.reduce((sum,x)=>sum+Math.max(0,+x.quantity||0),0);
      const status=owned.length?'owned':
        rows.some(x=>x.collection_status==='ordered')?'ordered':
        rows.some(x=>x.collection_status==='wanted')?'wanted':'missing';
      const grouped={...representative,
        quantity,
        collection_status:status,
        is_favorite:rows.some(x=>!!x.is_favorite),
        price_pending:rows.some(x=>!!x.price_pending),
        _grouped:true,
        _group_count:rows.length,
        _group_ids:rows.map(x=>x.id),
        _group_cards:rows
      };
      for(const field of priceFields)if(priced?.[field]!=null)grouped[field]=priced[field];
      out.push(grouped);
    }
    return out;
  }
  function summaryValueScope(){
    return ['all','owned','missing'].includes(settings.summary_value_scope)?settings.summary_value_scope:'all';
  }
  function viewScopedCards(cards){
    const scope=binderViewScope();
    if(scope==='owned')return cards.filter(c=>(c.collection_status||'owned')==='owned');
    if(scope==='missing')return cards.filter(c=>(c.collection_status||'owned')!=='owned');
    return cards;
  }
  function rarityFilterTagsV1603(card){
    const tags=new Map();
    const add=(key,label)=>{if(key&&label)tags.set(key,label)};
    const rarity=String(card?.rarity||'').trim();
    const finish=String(card?.finish||'').trim();
    if(rarity)add('rarity:'+nrm(rarity),rarity);
    if(finish)add('finish:'+nrm(finish),finish);

    const f=nrm(finish);
    const r=nrm(rarity);
    if(f==='normal'||f==='non holo'||f==='non-holo')add('group:non-holo','Non-Holo / Normal');
    if((f.includes('holo')||f.includes('foil')||r.includes('holo'))&&!f.includes('reverse'))add('group:holo','Holo / Foil');
    if(f.includes('reverse'))add('group:reverse','Reverse Holo');
    return tags;
  }
  function cardMatchesRarityFiltersV1603(card){
    if(!V14.rarityFilters?.size)return true;
    const tags=rarityFilterTagsV1603(card);
    for(const key of V14.rarityFilters)if(tags.has(key))return true;
    return false;
  }
  function renderRarityFilterV1603(){
    const box=byId('v1603RarityOptions');
    const summary=byId('v1603RaritySummary');
    if(!box||!summary)return;
    const options=new Map();
    for(const card of physicalCollection()){
      for(const [key,label] of rarityFilterTagsV1603(card))options.set(key,label);
    }
    const sorted=[...options.entries()].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR',{sensitivity:'base'}));
    // Drop selections that no longer exist in the active binder.
    for(const key of [...V14.rarityFilters])if(!options.has(key))V14.rarityFilters.delete(key);
    box.innerHTML=sorted.length?sorted.map(([key,label])=>
      '<label><input type="checkbox" value="'+esc(key)+'" '+(V14.rarityFilters.has(key)?'checked':'')+'><span>'+esc(label)+'</span></label>'
    ).join(''):'<small>Nenhuma raridade/acabamento cadastrado neste fichário.</small>';
    summary.textContent=V14.rarityFilters.size?V14.rarityFilters.size+' selecionada'+(V14.rarityFilters.size===1?'':'s'):'Todas';
    box.querySelectorAll('input[type="checkbox"]').forEach(input=>input.onchange=()=>{
      if(input.checked)V14.rarityFilters.add(input.value);else V14.rarityFilters.delete(input.value);
      currentPage=1;
      renderBinder();
      renderPagesGrid();
      renderSummary();
    });
    const clear=byId('v1603RarityClear');
    if(clear)clear.disabled=!V14.rarityFilters.size;
  }
  function ensureRarityFilterUIV1603(){
    if(byId('v1603RarityFilter'))return;
    const list=document.querySelector('#summaryPanel .status-filter-list');
    if(!list)return;
    const details=document.createElement('details');
    details.id='v1603RarityFilter';
    details.className='v1603-rarity-filter';
    details.innerHTML='<summary><span>Raridade / acabamento</span><b id="v1603RaritySummary">Todas</b></summary>'+
      '<div class="v1603-rarity-body"><div id="v1603RarityOptions" class="v1603-rarity-options"></div>'+
      '<button id="v1603RarityClear" type="button" class="mini-btn">Limpar seleção</button></div>';
    list.parentElement.appendChild(details);
    byId('v1603RarityClear').onclick=()=>{
      V14.rarityFilters.clear();
      currentPage=1;
      renderBinder();renderPagesGrid();renderSummary();
    };
    renderRarityFilterV1603();
  }

  function orderedViewCards(){
    const physical=physicalCollection();
    let arr=isGeneral()?viewScopedCards(groupedVirtualCards(physical)):[...viewScopedCards(physical)];
    if(typeof activeStatusFilter!=='undefined'&&activeStatusFilter!=='all'){
      arr=arr.filter(c=>(c.collection_status||'owned')===activeStatusFilter);
    }
    if(V14.rarityFilters?.size)arr=arr.filter(cardMatchesRarityFiltersV1603);
    const mode=activeSort();
    const direction=mode.endsWith('_desc')?-1:1;
    const baseMode=mode.replace(/_(asc|desc)$/,'');
    const cmpText=(a,b)=>String(a||'').localeCompare(String(b||''),'pt-BR',{sensitivity:'base'});
    const manualCmp=(a,b)=>{
      if(isGeneral()){
        const order=new Map(V14.binders.map((binder,i)=>[binder.id,i]));
        return (order.get(a.binder_id)??999)-(order.get(b.binder_id)??999)||
          (+a.binder_page||1)-(+b.binder_page||1)||
          (+a.binder_slot||1)-(+b.binder_slot||1);
      }
      return (+a.binder_page||1)-(+b.binder_page||1)||(+a.binder_slot||1)-(+b.binder_slot||1);
    };
    arr.sort((a,b)=>{
      let result=0;
      if(baseMode==='manual')result=manualCmp(a,b);
      else if(baseMode==='name')result=cmpText(a.name,b.name)||numberValue(a.number)-numberValue(b.number);
      else if(baseMode==='type')result=cmpText(a.card_type,b.card_type)||cmpText(a.name,b.name);
      else if(baseMode==='rarity')result=cmpText(a.rarity,b.rarity)||cmpText(a.name,b.name);
      else if(baseMode==='number')result=cmpText(a.set_name,b.set_name)||numberValue(a.number)-numberValue(b.number)||cmpText(a.finish,b.finish);
      else if(baseMode==='price'){
        const av=priceModeValue(a,currentPriceMode()),bv=priceModeValue(b,currentPriceMode());
        result=av-bv||cmpText(a.name,b.name);
      }
      return result*direction;
    });

    const q=String(V14.binderSearchQuery||'').trim();
    if(!q){V14.binderSearchMatches=[];return arr}
    const tokens=nrm(q).split(' ').filter(Boolean);
    const scored=arr.map((card,index)=>{
      const hay=nrm([card.name,card.number,card.set_name,card.finish,card.rarity,card.card_type].filter(Boolean).join(' '));
      const tokenHits=tokens.reduce((sum,t)=>sum+(hay.includes(t)?1:0),0);
      return{card,index,score:binderSearchScore(card,q),tokenHits,allTokens:tokens.length>0&&tokenHits===tokens.length};
    });
    let found=scored.filter(x=>x.allTokens);
    if(!found.length){
      const ranked=scored.filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
      if(ranked.length){
        const best=ranked[0].score;
        found=ranked.filter(x=>x.score>=Math.max(45,best-170)).slice(0,18);
      }
    }else{
      found.sort((a,b)=>b.score-a.score||a.index-b.index);
    }
    V14.binderSearchMatches=found.map(x=>x.card);
    return V14.binderSearchMatches;
  }

  function positionUnifiedTopbar(){
    const area=document.querySelector('.binder-area');
    const bar=byId('v14UnifiedTopbar');
    const spread=document.querySelector('#binderStage .binder-spread');
    if(!area||!bar||!spread)return;
    if(window.matchMedia('(max-width:820px)').matches){
      bar.style.removeProperty('left');bar.style.removeProperty('right');
      bar.style.removeProperty('width');bar.style.removeProperty('max-width');
      bar.style.removeProperty('transform');return;
    }
    const ar=area.getBoundingClientRect(),sr=spread.getBoundingClientRect();
    if(ar.width<40||sr.width<20)return;
    const barHeight=Math.max(1,bar.getBoundingClientRect().height);
    bar.style.left='10px';bar.style.right='10px';bar.style.width='auto';bar.style.maxWidth='none';
    bar.style.top=Math.max(6,sr.top-ar.top-barHeight-5)+'px';
    bar.style.transform='none';
  }

  function ensureUnifiedTopbar(){
    const host=document.querySelector('.binder-area');
    const pageCenter=document.querySelector('.page-center');
    if(!host||!pageCenter)return null;
    let bar=byId('v14UnifiedTopbar');
    if(!bar){
      bar=document.createElement('div');
      bar.id='v14UnifiedTopbar';
      bar.className='v14-unified-topbar';
      host.insertBefore(bar,host.firstChild);
    }
    if(pageCenter.parentElement!==bar)bar.appendChild(pageCenter);
    if(!byId('v14GoStart')){
      const start=document.createElement('button');
      start.id='v14GoStart';
      start.className='mini-btn v14-go-start';
      start.type='button';
      start.title='Voltar ao início do fichário';
      start.setAttribute('aria-label','Voltar ao início do fichário');
      start.textContent='↤ Início';
      pageCenter.insertBefore(start,byId('btnPages')||null);
    }
    return bar;
  }

  function installPageAddControlsV1443(){
    const toolbar=document.querySelector('.binder-toolbar');
    if(!toolbar)return;
    const make=(id,label)=>{
      let b=byId(id);
      if(b)return b;
      b=document.createElement('button');
      b.id=id;
      b.type='button';
      b.className='v1443-page-add';
      b.textContent='＋';
      b.title=label;
      b.setAttribute('aria-label',label);
      b.onclick=e=>{
        e.preventDefault();
        e.stopPropagation();
        addPageV14();
      };
      toolbar.appendChild(b);
      return b;
    };
    make('v1443AddPageLeft','Adicionar página');
    make('v1443AddPageRight','Adicionar página');
    requestAnimationFrame(()=>window.fitBinderV11?.());
  }

  function injectUI(){
    installPageAddControlsV1443();
    if(!byId('v14BinderControls')){
      const host=ensureUnifiedTopbar();
      if(host){
        const wrap=document.createElement('div');
        wrap.id='v14BinderControls';
        wrap.className='v14-binder-controls';
        wrap.innerHTML=
          '<select id="v14BinderSelect" aria-label="Fichário"></select>'+
          '<label class="v14-binder-search" title="Pesquisar dentro deste fichário"><span>⌕</span><input id="v14BinderSearch" type="search" autocomplete="off" placeholder="Buscar carta…"></label>'+
          '<select id="v14SortSelect" aria-label="Ordenação">'+
            '<option value="manual_asc">Ordem do fichário · 0 → X</option>'+
            '<option value="manual_desc">Ordem do fichário · X → 0</option>'+
            '<option value="name_asc">Alfabética · A → Z</option>'+
            '<option value="name_desc">Alfabética · Z → A</option>'+
            '<option value="type_asc">Tipo · A → Z</option>'+
            '<option value="type_desc">Tipo · Z → A</option>'+
            '<option value="rarity_asc">Raridade · A → Z</option>'+
            '<option value="rarity_desc">Raridade · Z → A</option>'+
            '<option value="number_asc">Número da coleção · 0 → X</option>'+
            '<option value="number_desc">Número da coleção · X → 0</option>'+
            '<option value="price_asc">Preço · menor → maior</option>'+
            '<option value="price_desc">Preço · maior → menor</option>'+
          '</select>'+
          '<button id="v14RenameBinder" class="v14-rename-binder" type="button" aria-label="Renomear fichário" title="Renomear fichário">✎ Renomear fichário</button>'+
          '<button id="v14DeleteBinder" class="v14-delete-binder" type="button" aria-label="Excluir fichário">🗑 Excluir fichário</button>'+
          '<button id="v14Friends" class="v1451-friends-btn" type="button" aria-label="Amigos">♙ Amigos</button>'+
          '<button id="v14AddBinder" class="btn btn-primary" type="button">＋ Fichário</button>';
        host.appendChild(wrap);
        requestAnimationFrame(positionUnifiedTopbar);
      }
    }else{
      ensureUnifiedTopbar();
      requestAnimationFrame(positionUnifiedTopbar);
    }
    // Migração defensiva: se o usuário veio de uma UI V14 já montada antes
    // do botão social existir, adiciona "Amigos" sem exigir recriar a topbar.
    const binderControls=byId('v14BinderControls');
    if(binderControls&&!byId('v14RenameBinder')){
      const renameButton=document.createElement('button');
      renameButton.id='v14RenameBinder';renameButton.className='v14-rename-binder';renameButton.type='button';
      renameButton.setAttribute('aria-label','Renomear fichário');renameButton.title='Renomear fichário';renameButton.textContent='✎ Renomear fichário';
      binderControls.insertBefore(renameButton,byId('v14DeleteBinder')||null);
    }
    if(binderControls&&!byId('v14Friends')){
      const friendsButton=document.createElement('button');
      friendsButton.id='v14Friends';
      friendsButton.className='v1451-friends-btn';
      friendsButton.type='button';
      friendsButton.setAttribute('aria-label','Amigos');
      friendsButton.textContent='♙ Amigos';
      binderControls.insertBefore(friendsButton,byId('v14AddBinder')||null);
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
            '<div class="v14-master-select-flow">'+
              '<label>Idioma<select id="v14MasterLang"><option value="pt">Português</option><option value="en">Inglês</option><option value="ja">Japonês</option></select></label>'+
              '<label>1. Geração<select id="v14SeriesSelect"><option value="">Carregando gerações…</option></select></label>'+
              '<label>2. Coleção<select id="v14SetSelect" disabled><option value="">Escolha primeiro a geração</option></select></label>'+
            '</div>'+
            '<p id="v14SetStatus" class="form-message">Escolha a geração e depois a coleção.</p>'+
            '<p id="v14PromoNotice" class="v14-promo-notice hidden"></p>'+
            '<div id="v14MasterStep" class="hidden">'+
              '<div class="v14-master-head"><div><strong id="v14MasterTitle">Coleção</strong><small id="v14MasterMeta"></small></div><div><b id="v14OwnedCount">0</b> marcadas como Tenho</div></div>'+
              '<p class="v14-master-help">Marque as variantes que você já possui. As demais entram como Não tenho. Normal, Holo, Reverse, Poké Ball, Master Ball e outras variantes só aparecem quando existem na base.</p>'+
              '<div class="v1418-master-bulk"><button id="v1418MarkAll" class="btn btn-secondary" type="button">✓ Marcar todas como Tenho</button><button id="v1418ClearAll" class="btn btn-secondary" type="button">Limpar marcações</button></div>'+
              '<div id="v14MasterGrid" class="v14-master-grid"></div>'+
              '<div id="v1418MasterQueue" class="v1418-master-queue hidden"></div>'+
              '<div class="v1418-master-actions"><button id="v1418AddAnotherMaster" class="btn btn-secondary" type="button">＋ Adicionar outro Master Set</button><button id="v14CreateMaster" class="btn btn-primary" type="button">Criar Master Set</button></div>'+
            '</div>'+
          '</section>'+
        '</div>';
      document.body.appendChild(d);
    }
    if(!byId('v14DeleteDialog')){
      const d=document.createElement('dialog');
      d.id='v14DeleteDialog';
      d.className='sheet-dialog v14-delete-dialog';
      d.innerHTML=
        '<div class="dialog-shell v14-delete-shell">'+
          '<div class="dialog-head"><div><p class="kicker v14-danger-kicker">EXCLUSÃO PERMANENTE</p><h2 id="v14DeleteTitle">Excluir fichário?</h2><p id="v14DeleteMessage" class="muted compact-copy"></p></div><button class="icon-only" data-v14-close="v14DeleteDialog" type="button" aria-label="Cancelar exclusão">×</button></div>'+
          '<div class="v14-delete-warning"><strong>Esta ação não pode ser desfeita.</strong><span>As cartas deste fichário deixam de existir na sua base de dados, junto com preços, status, posições e favoritos salvos nelas.</span></div>'+
          '<div class="v14-delete-actions"><button id="v14CancelDelete" class="btn btn-secondary" type="button">Cancelar</button><button id="v14ConfirmDelete" class="btn v14-danger-button" type="button">Excluir fichário</button></div>'+
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

    if(!byId('v14ValueScope')){
      const controls=document.querySelector('.price-mode-controls');
      if(controls){
        const label=document.createElement('label');
        label.className='v14-value-scope-control';
        label.innerHTML='<span>Somar valor de</span><select id="v14ValueScope" aria-label="Cartas consideradas no valor"><option value="all">Todas as cartas</option><option value="owned">Só as que tenho</option><option value="missing">Só as que não tenho</option></select>';
        controls.appendChild(label);
      }
    }
    if(!byId('v14BinderViewScope')){
      const list=document.querySelector('.status-filter-list');
      if(list){
        const label=document.createElement('label');
        label.className='v14-binder-view-scope';
        label.innerHTML='<span>Mostrar no fichário</span><select id="v14BinderViewScope" aria-label="Cartas mostradas no fichário"><option value="all">Todas as cartas</option><option value="owned">Só as que tenho</option><option value="missing">Só as que não tenho</option></select>';
        list.parentElement.insertBefore(label,list);
      }
    }
    ensureRarityFilterUIV1603();

    document.querySelectorAll('[data-v14-close]').forEach(b=>b.onclick=()=>{
      const id=b.dataset.v14Close,d=byId(id);
      hardCloseDialog(d);
      if(id==='v14BinderDialog')resetMasterBuilderState({resetCatalog:true});
      releaseMobileInteraction();
    });
    const creatorDialog=byId('v14BinderDialog');
    if(creatorDialog&&!creatorDialog.dataset.v1415CloseGuard){
      creatorDialog.dataset.v1415CloseGuard='1';
      creatorDialog.addEventListener('close',()=>{
        resetMasterBuilderState({resetCatalog:true});
        releaseMobileInteraction();
      });
      creatorDialog.addEventListener('cancel',()=>{
        resetMasterBuilderState({resetCatalog:true});
        setTimeout(releaseMobileInteraction,0);
      });
    }
    byId('v14TabEmpty')?.addEventListener('click',()=>switchCreateTab('empty'));
    byId('v14TabSet')?.addEventListener('click',()=>switchCreateTab('set'));
    byId('v14CreateEmpty')?.addEventListener('click',createEmptyBinder);
    byId('v14AddBinder')?.addEventListener('click',openBinderCreator);
    byId('v14RenameBinder')?.addEventListener('click',renameBinder);
    byId('v14DeleteBinder')?.addEventListener('click',openDeleteBinderDialog);
    byId('v14CancelDelete')?.addEventListener('click',()=>{const d=byId('v14DeleteDialog');if(d?.open)d.close()});
    byId('v14ConfirmDelete')?.addEventListener('click',confirmDeleteBinder);
    byId('v14BinderSelect')?.addEventListener('change',e=>selectBinder(e.target.value));
    byId('v14SortSelect')?.addEventListener('change',e=>setSortMode(e.target.value));
    byId('v14GoStart')?.addEventListener('click',goToBinderStart);
    byId('v14BinderSearch')?.addEventListener('input',e=>applyBinderSearch(e.currentTarget.value));
    byId('v14BinderSearch')?.addEventListener('keydown',e=>{
      if(e.key==='Enter'){
        e.preventDefault();
        const card=V14.binderSearchMatches[0];
        if(card)goToBinderSearchCard(card);
        else if(e.currentTarget.value.trim())toast('Carta não encontrada neste fichário.');
      }else if(e.key==='Escape'){
        e.currentTarget.value='';
        applyBinderSearch('');
      }
    });
    byId('v14ValueScope')?.addEventListener('change',async e=>{
      const value=['all','owned','missing'].includes(e.target.value)?e.target.value:'all';
      settings.summary_value_scope=value;
      await updateSettings({summary_value_scope:value},true);
      renderSummary();
    });
    byId('v14BinderViewScope')?.addEventListener('change',e=>{
      V14.viewScope=['all','owned','missing'].includes(e.target.value)?e.target.value:'all';
      try{activeStatusFilter='all'}catch{}
      currentPage=1;
      renderBinder();
      renderPagesGrid();
      renderBinderControls();
      renderSummary();
    });
    byId('v14MasterLang')?.addEventListener('change',()=>loadGenerationOptions(true));
    byId('v14SeriesSelect')?.addEventListener('change',()=>loadCollectionsForGeneration());
    byId('v14SetSelect')?.addEventListener('change',e=>{
      const setId=e.target.value;
      if(setId)loadMasterPreview(byId('v14MasterLang')?.value||'pt',setId);
      else{
        V14.masterPreview=null;
        byId('v14MasterStep')?.classList.add('hidden');
      }
    });
    byId('v1418MarkAll')?.addEventListener('click',()=>markAllMasterOwned(true));
    byId('v1418ClearAll')?.addEventListener('click',()=>markAllMasterOwned(false));
    byId('v1418AddAnotherMaster')?.addEventListener('click',addAnotherMasterSet);
    byId('v14CreateMaster')?.addEventListener('click',createMasterBinder);
    byId('v14ScanAgain')?.addEventListener('click',()=>{if(byId('v14ScanCandidates')?.open)byId('v14ScanCandidates').close();startScanner()});
  }

  function physicalManualViewV14(){
    return !V14.binderSearchQuery&&!isGeneral()&&activeSort()==='manual_asc'&&binderViewScope()==='all'&&!V14.favoritesOnly&&!(V14.rarityFilters?.size);
  }
  function binderSessionAnchorV14(page,pages=currentBinderPages()){
    pages=Math.max(1,+pages||1);
    page=Math.min(pages,Math.max(1,+page||1));
    if(page<=1)return 1;
    return page%2===0?page:page-1;
  }
  function binderLastSessionAnchorV14(pages=currentBinderPages()){
    return binderSessionAnchorV14(Math.max(1,+pages||1),pages);
  }
  function binderSessionTargetV14(page,dir,pages=currentBinderPages()){
    const anchor=binderSessionAnchorV14(page,pages);
    const last=binderLastSessionAnchorV14(pages);
    if(dir>0){
      if(anchor<=1)return Math.min(last,2);
      return Math.min(last,anchor+2);
    }
    if(anchor<=2)return 1;
    return Math.max(2,anchor-2);
  }
  window.binderSessionTargetV14=binderSessionTargetV14;

  function goToBinderSessionV14(dir){
    if(!physicalManualViewV14())return goToPage(currentPage+(dir>0?1:-1));
    const target=binderSessionTargetV14(currentPage,dir,currentBinderPages());
    if(target===currentPage)return;
    try{window.cancelBinderPageFlipV14?.({suppress:true})}catch{}
    currentPage=target;
    renderBinder();
    renderPagesGrid();
    syncTopbarNavigation();
  }

  function wireSpreadNavigationV14(){
    const prev=byId('prevPage'),next=byId('nextPage');
    const mobile=()=>window.matchMedia('(max-width:820px)').matches;
    const inActiveCore=e=>{
      if(!mobile())return true;
      const r=e.currentTarget.getBoundingClientRect();
      const x=(Number.isFinite(e.clientX)?e.clientX:r.left+r.width/2)-r.left-r.width/2;
      const y=(Number.isFinite(e.clientY)?e.clientY:r.top+r.height/2)-r.top-r.height/2;
      // V16.05: only the central 36px circle changes page. The thin outer
      // guard catches imprecise taps so they cannot fall through to a card.
      return Math.hypot(x,y)<=18;
    };
    const wire=(button,dir)=>{
      if(!button)return;
      button.onpointerdown=e=>{e.stopPropagation();};
      button.onpointerup=e=>{e.stopPropagation();};
      button.onclick=e=>{
        e.preventDefault();
        e.stopPropagation();
        if(!inActiveCore(e))return;
        goToBinderSessionV14(dir);
      };
    };
    wire(prev,-1);
    wire(next,1);
  }

  function syncTopbarNavigation(){
    const start=byId('v14GoStart');
    if(start)start.disabled=currentPage<=1;
    const disableAdd=isGeneral();
    ['v1443AddPageLeft','v1443AddPageRight'].forEach(id=>{
      const b=byId(id);if(b)b.disabled=disableAdd;
    });
    if(physicalManualViewV14()){
      const pages=currentBinderPages(),last=binderLastSessionAnchorV14(pages);
      const prev=byId('prevPage'),next=byId('nextPage');
      if(prev)prev.disabled=currentPage<=1;
      if(next)next.disabled=currentPage>=last;
    }
    requestAnimationFrame(()=>window.fitBinderV11?.());
  }

  function goToBinderStart(){
    try{window.cancelBinderPageFlipV14?.({suppress:true})}catch{}
    currentPage=1;
    renderBinder();
    renderPagesGrid();
    syncTopbarNavigation();
  }

  function binderSearchLabel(card){
    const binder=isGeneral()?binderForCard(card):null;
    return [
      card.name||'Carta',
      card.number?'#'+card.number:'',
      card.set_name||'',
      binder?.name||''
    ].filter(Boolean).join(' · ');
  }

  function binderSearchScore(card,query){
    const q=nrm(query);
    if(!q)return 0;
    const name=nrm(card.name),number=nrm(card.number),set=nrm(card.set_name),finish=nrm(card.finish);
    const all=[name,number,set,finish].join(' ');
    let score=0;
    if(name===q)score+=1000;
    else if(name.startsWith(q))score+=700;
    else if(name.includes(q))score+=500;
    if(number===q||number.replace(/\s/g,'')===q.replace(/\s/g,''))score+=650;
    else if(number.includes(q))score+=300;
    if(set.includes(q))score+=180;
    if(finish.includes(q))score+=80;
    const words=q.split(' ').filter(Boolean);
    score+=words.reduce((sum,w)=>sum+(all.includes(w)?45:0),0);
    return score;
  }

  function applyBinderSearch(value){
    V14.binderSearchQuery=String(value||'').trim();
    currentPage=1;
    renderBinder();
    renderPagesGrid();
    renderBinderControls();
  }

  function goToBinderSearchCard(card){
    const cards=orderedViewCards();
    let page=1;
    if(!V14.binderSearchQuery&&!isGeneral()&&activeSort()==='manual_asc'&&binderViewScope()==='all'&&!V14.favoritesOnly){
      page=binderSessionAnchorV14(Math.max(1,+card.binder_page||1),currentBinderPages());
    }else{
      const index=cards.findIndex(c=>String(c.id)===String(card.id)||c._group_ids?.includes?.(card.id));
      if(index<0)return toast('Essa carta não está visível com os filtros atuais.');
      page=Math.floor(index/9)+1;
    }
    try{window.cancelBinderPageFlipV14?.({suppress:true})}catch{}
    currentPage=page;
    renderBinder();
    renderPagesGrid();
    syncTopbarNavigation();
    const input=byId('v14BinderSearch');
    if(input)input.value=V14.binderSearchQuery||card.name||'';
    setTimeout(()=>{
      const target=[...document.querySelectorAll('#binderStage .pocket-card')].find(el=>String(el.dataset.id)===String(card.id));
      if(!target)return;
      target.classList.add('v14-search-hit');
      target.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'smooth'});
      setTimeout(()=>target.classList.remove('v14-search-hit'),1700);
    },80);
  }

  function resetMasterBuilderState({resetCatalog=false,keepSelections=false}={}){
    V14.masterEpoch++;
    V14.masterPreview=null;
    if(!keepSelections)V14.masterSelections=[];
    const step=byId('v14MasterStep');if(step)step.classList.add('hidden');
    const notice=byId('v14PromoNotice');if(notice){notice.classList.add('hidden');notice.textContent=''}
    const grid=byId('v14MasterGrid');if(grid)grid.innerHTML='';
    const owned=byId('v14OwnedCount');if(owned)owned.textContent='0';
    const title=byId('v14MasterTitle');if(title)title.textContent='Coleção';
    const meta=byId('v14MasterMeta');if(meta)meta.textContent='';
    const status=byId('v14SetStatus');if(status)status.textContent='Escolha a geração e depois a coleção.';
    const set=byId('v14SetSelect');
    if(set){
      set.value='';
      set.disabled=true;
      set.innerHTML='<option value="">Escolha primeiro a geração</option>';
    }
    const series=byId('v14SeriesSelect');
    if(series){
      series.value='';
      if(resetCatalog){
        series.disabled=true;
        series.innerHTML='<option value="">Carregando gerações…</option>';
      }
    }
    renderMasterQueue();
  }

  function hardCloseDialog(dialog){
    const d=typeof dialog==='string'?byId(dialog):dialog;
    if(!d)return;
    try{if(d.open)d.close()}catch{}
    // Android/WebView can occasionally leave a dialog/backdrop in the top layer.
    // Re-check on the next frames and clear any stale open attribute as fallback.
    requestAnimationFrame(()=>{
      try{if(d.open)d.close()}catch{}
      if(d.hasAttribute('open'))d.removeAttribute('open');
    });
  }

  function releaseMobileInteraction(){
    if(!window.matchMedia?.('(max-width:820px)').matches)return;
    ['v14BinderDialog','v14DeleteDialog','v14ScanCandidates'].forEach(id=>hardCloseDialog(id));
    document.querySelectorAll('[inert]').forEach(el=>el.removeAttribute('inert'));
    document.body.style.removeProperty('pointer-events');
    document.documentElement.style.removeProperty('pointer-events');
    try{window.setMobileView?.('binder')}catch{}
    requestAnimationFrame(()=>{try{window.fitBinderV11?.()}catch{}});
  }

  function openBinderCreator(){
    resetMasterBuilderState({resetCatalog:true});
    switchCreateTab('empty');
    const d=byId('v14BinderDialog');
    if(d&&!d.open){
      // Native showModal() makes the entire document inert. Some Android
      // WebViews kept that inert state after creating/rendering a large set.
      // On mobile this creator is already fullscreen, so non-modal show()
      // gives the same UX without ever disabling Resumo/Amigos/etc.
      if(window.matchMedia?.('(max-width:820px)').matches)d.show();
      else d.showModal();
    }
    // Reconcile binder names/existence from the database instead of trusting
    // an old in-memory list after delete/create cycles.
    loadBinders().catch(console.warn);
  }

  function switchCreateTab(which){
    const empty=which==='empty';
    byId('v14TabEmpty')?.classList.toggle('active',empty);
    byId('v14TabSet')?.classList.toggle('active',!empty);
    byId('v14EmptyPane')?.classList.toggle('hidden',!empty);
    byId('v14SetPane')?.classList.toggle('hidden',empty);
    if(!empty)setTimeout(()=>loadGenerationOptions(true),0);
  }

  async function ensureFirstBinder(){
    if(V14.binders.some(b=>b.binder_kind!=='wishlist'))return;
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
    await ensureWishlistBinder();
    await ensureFirstBinder();
    if(V14.activeBinderId==null){
      const stored=settings.current_binder_id;
      V14.activeBinderId=stored&&V14.binders.some(b=>b.id===stored)?stored:'all';
    }else if(!isGeneral()&&!V14.binders.some(b=>b.id===V14.activeBinderId)){
      V14.activeBinderId=V14.binders[0]?.id||'all';
    }
    renderBinderControls();
  }

  function renderBinderControls(){
    const sel=byId('v14BinderSelect');
    if(sel){
      sel.innerHTML='<option value="all">Geral — todos os fichários</option><option value="favorites">★ Favoritas</option>'+
        V14.binders.map(b=>'<option value="'+esc(b.id)+'">'+(b.binder_kind==='wishlist'?'Desejos · ':'')+esc(b.name)+'</option>').join('');
      sel.value=V14.activeBinderId||'all';
    }
    const sort=byId('v14SortSelect');if(sort)sort.value=activeSort();
    const rename=byId('v14RenameBinder');
    if(rename){rename.disabled=isGeneral()||isWishlistBinder();rename.classList.toggle('hidden',isGeneral()||isWishlistBinder())}
    const del=byId('v14DeleteBinder');
    if(del){del.disabled=isGeneral()||isWishlistBinder();del.classList.toggle('hidden',isGeneral()||isWishlistBinder())}
    const add=byId('btnOpenAdd');if(add)add.disabled=isGeneral();
    const hint=document.querySelector('.binder-hint');
    if(hint)hint.textContent=canMove()?'Arraste cartas entre bolsos · clique para detalhes':(V14.favoritesOnly?'Filtro de favoritos ativo · movimentação desativada':'Visualização filtrada/ordenada · movimentação desativada');
    if(byId('v14BinderViewScope'))byId('v14BinderViewScope').value=binderViewScope();
    syncTopbarNavigation();
    requestAnimationFrame(positionUnifiedTopbar);
  }

  async function selectBinder(id){
    V14.activeBinderId=id||'all';
    V14.favoritesOnly=isFavorites();
    V14.viewScope='all';
    V14.binderSearchQuery='';
    V14.rarityFilters.clear();
    currentPage=1;
    try{activeStatusFilter='all'}catch{}
    if(byId('v14BinderSearch'))byId('v14BinderSearch').value='';
    if(byId('v14BinderViewScope'))byId('v14BinderViewScope').value='all';
    V14.binderSearchMatches=[];
    await db.from('pokemon_settings').update({current_binder_id:isGeneral()?null:V14.activeBinderId}).eq('user_id',currentUser.id);
    collection=physicalCollection();
    syncLegacySettings();
    renderBinderControls();
    renderAll();
  }

  async function setSortMode(mode){
    const allowed=['manual_asc','manual_desc','name_asc','name_desc','type_asc','type_desc','rarity_asc','rarity_desc','number_asc','number_desc','price_asc','price_desc'];
    mode=allowed.includes(mode)?mode:'manual_asc';
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

  async function toggleFavoritesFilter(){
    await selectBinder(isFavorites()?'all':'favorites');
  }

  async function toggleFavoriteCard(card){
    if(!card?.id)return;
    const identity=canonicalCardIdentityKey(card);
    const matches=V14.allCards.filter(x=>canonicalCardIdentityKey(x)===identity);
    const ids=matches.map(x=>x.id).filter(Boolean);
    if(!ids.length)return;
    const next=!matches.some(x=>!!x.is_favorite);
    const {error}=await db.from('pokemon_cards')
      .update({is_favorite:next})
      .eq('user_id',currentUser.id)
      .in('id',ids);
    if(error){toast('Não consegui atualizar o favorito.');return}
    for(const row of matches)row.is_favorite=next;
    card.is_favorite=next;
    collection=physicalCollection();
    renderBinderControls();
    renderAll();
  }

  async function renameBinder(){
    const b=activeBinder();if(!b||isWishlistBinder(b))return;
    const name=prompt('Novo nome do fichário:',b.name||'Meu Fichário');
    if(!name?.trim())return;
    const {error}=await db.from('pokemon_binders').update({name:name.trim(),updated_at:new Date().toISOString()}).eq('id',b.id).eq('user_id',currentUser.id);
    if(error)return toast('Não consegui renomear.');
    b.name=name.trim();
    syncLegacySettings();renderBinderControls();renderAll();toast('Fichário renomeado.');
  }

  function openDeleteBinderDialog(){
    const b=activeBinder();if(!b||isWishlistBinder(b))return;
    const cards=V14.allCards.filter(x=>x.binder_id===b.id);
    const count=cards.length;
    const d=byId('v14DeleteDialog');if(!d)return;
    d.dataset.binderId=b.id;
    byId('v14DeleteTitle').textContent='Excluir "'+b.name+'"?';
    byId('v14DeleteMessage').textContent=count
      ? count+' carta'+(count===1?' será':'s serão')+' excluída'+(count===1?'':'s')+' permanentemente da sua base de dados.'
      :'Este fichário está vazio e será excluído permanentemente.';
    const confirm=byId('v14ConfirmDelete');
    if(confirm)confirm.textContent=count
      ? 'Excluir fichário e '+count+' carta'+(count===1?'':'s')
      :'Excluir fichário vazio';
    d.showModal();
  }

  async function confirmDeleteBinder(){
    const d=byId('v14DeleteDialog');
    const id=d?.dataset?.binderId;
    const b=V14.binders.find(x=>x.id===id);
    if(!b)return;
    const cardIds=V14.allCards.filter(x=>x.binder_id===b.id).map(x=>x.id);
    const btn=byId('v14ConfirmDelete');
    busy(btn,true,'Excluindo…');
    try{
      const {data,error}=await db.from('pokemon_binders')
        .delete()
        .eq('id',b.id)
        .eq('user_id',currentUser.id)
        .select('id');
      if(error)throw error;
      if(!data?.length)throw new Error('Fichário não encontrado para exclusão.');

      V14.binders=V14.binders.filter(x=>x.id!==b.id);
      V14.allCards=V14.allCards.filter(x=>x.binder_id!==b.id);
      V14.priceQueue=V14.priceQueue.filter(x=>x.binder_id!==b.id);
      for(const cardId of cardIds)V14.priceJobs.delete(cardId);

      if(!V14.binders.length){
        V14.activeBinderId=null;
        await ensureFirstBinder();
      }else{
        V14.activeBinderId=V14.binders[0].id;
      }
      V14.viewScope='all';
      V14.binderSearchQuery='';
      currentPage=1;
      try{activeStatusFilter='all'}catch{}
      await db.from('pokemon_settings')
        .update({current_binder_id:V14.activeBinderId})
        .eq('user_id',currentUser.id);
      collection=physicalCollection();
      syncLegacySettings();
      renderBinderControls();
      renderAll();
      hardCloseDialog(d);
      resetMasterBuilderState({resetCatalog:true});
      releaseMobileInteraction();
      setTimeout(releaseMobileInteraction,180);
      toast('Fichário e suas cartas foram excluídos permanentemente.');
    }catch(error){
      console.error(error);
      toast('Não consegui excluir o fichário: '+(error?.message||'erro no banco'));
    }finally{
      busy(btn,false);
    }
  }

  async function createEmptyBinder(){
    const name=(byId('v14EmptyName')?.value||'Novo Fichário').trim()||'Novo Fichário';
    const pages=Math.max(1,Math.min(200,+byId('v14EmptyPages')?.value||4));
    const sortOrder=(Math.max(0,...V14.binders.map(b=>+b.sort_order||0))+1);
    const {data,error}=await db.from('pokemon_binders').insert({user_id:currentUser.id,name,pages,background:'graphite',sort_order:sortOrder,binder_kind:'custom'}).select('*').single();
    if(error)return toast('Não consegui criar o fichário.');
    V14.binders.push(data);

    // Close the modal BEFORE any binder reload/render. On mobile, rendering
    // while a modal is still in the top layer could leave the whole app inert.
    hardCloseDialog('v14BinderDialog');
    resetMasterBuilderState({resetCatalog:true});
    releaseMobileInteraction();

    await selectBinder(data.id);
    releaseMobileInteraction();
    setTimeout(releaseMobileInteraction,180);
    toast('Fichário criado.');
  }

  function catalogLangV1450(){
    const value=byId('searchLanguage')?.value||'all';
    if(value==='ja')return'ja';
    if(value==='en')return'en';
    return'pt';
  }

  async function loadCatalogGenerationOptionsV1450(force=false){
    const series=byId('searchSeries'),sets=byId('searchSet');
    if(!series||!sets)return;
    if(!force&&series.options.length>1)return;
    const lang=catalogLangV1450();
    const oldSeries=force?'':series.value;
    series.disabled=true;
    series.innerHTML='<option value="">Carregando gerações…</option>';
    if(force){
      sets.disabled=true;
      sets.innerHTML='<option value="">Coleção — escolha a geração</option>';
    }
    try{
      const list=[...(await fetchSeries(lang))];
      let englishById=new Map();
      if(lang==='ja'){
        try{
          const en=await fetchSeries('en');
          englishById=new Map(en.map(s=>[String(s.id||'').toLowerCase(),s.name||s.id]));
        }catch{}
      }
      series.innerHTML='<option value="">Geração — todas</option>'+list.map(s=>{
        const label=lang==='ja'?(englishById.get(String(s.id||'').toLowerCase())||s.name||s.id):(s.name||s.id);
        return '<option value="'+esc(s.id)+'">'+esc(label)+'</option>';
      }).join('');
      series.disabled=false;
      if(oldSeries&&[...series.options].some(o=>o.value===oldSeries)){
        series.value=oldSeries;
        await loadCatalogCollectionsV1450(false);
      }
    }catch(e){
      console.error('[Catálogo gerações]',e);
      series.innerHTML='<option value="">Geração indisponível</option>';
    }
  }

  async function loadCatalogCollectionsV1450(runSearch=false){
    const series=byId('searchSeries'),sets=byId('searchSet');
    if(!series||!sets)return;
    const seriesId=series.value||'';
    if(!seriesId){
      sets.disabled=true;
      sets.innerHTML='<option value="">Coleção — escolha a geração</option>';
      if(runSearch&&typeof searchCards==='function')searchCards({live:false});
      return;
    }
    const lang=catalogLangV1450();
    sets.disabled=true;
    sets.innerHTML='<option value="">Carregando coleções…</option>';
    try{
      const r=await fetch('/api/set-catalog?lang='+encodeURIComponent(lang)+'&series='+encodeURIComponent(seriesId),{cache:'no-store'});
      const j=await r.json();
      if(!j?.ok)throw new Error(j?.message||'Falha ao carregar coleções');
      const list=Array.isArray(j.sets)?j.sets:[];
      sets.innerHTML='<option value="">Coleção — todas da geração</option>'+list.map(s=>
        '<option value="'+esc(s.id)+'">'+esc(s.displayName||s.name||s.id)+(s.isPromo?' · PROMOS':'')+'</option>'
      ).join('');
      sets.disabled=false;
      if(runSearch&&typeof searchCards==='function')searchCards({live:false});
    }catch(e){
      console.error('[Catálogo coleções]',e);
      sets.innerHTML='<option value="">Coleções indisponíveis</option>';
      sets.disabled=true;
    }
  }

  function wireCatalogCollectionSearchV1450(){
    const lang=byId('searchLanguage'),series=byId('searchSeries'),sets=byId('searchSet');
    if(!series||!sets||series.dataset.v1450==='1')return;
    series.dataset.v1450='1';
    series.addEventListener('change',async()=>{
      await loadCatalogCollectionsV1450(false);
      if(typeof searchCards==='function')searchCards({live:false});
    });
    sets.addEventListener('change',()=>{if(typeof searchCards==='function')searchCards({live:false})});
    if(lang&&!lang.dataset.v1450Catalog){
      lang.dataset.v1450Catalog='1';
      lang.addEventListener('change',()=>loadCatalogGenerationOptionsV1450(true));
    }
    loadCatalogGenerationOptionsV1450(false);
  }

  const ANNIVERSARY_COMPLETE_MASTER_SETS=[
    {
      id:'anniv20-complete',
      label:'Completa 20 Anos',
      coreIds:['g1'],
      summaryLabels:['Gerações','Evoluções','Promos oficiais 20 anos','extras regionais quando existirem no idioma'],
      series:'20º Aniversário',
      releaseDate:'2016',
      components:[
        {id:'g1',label:'Gerações',required:true},
        {id:'xy12',label:'Evolutions',lang:'en',required:true},
        {
          id:'xyp',label:'Promos brasileiras 20 anos · Copag',required:true,
          fetchLang:'en',physicalLang:'pt',
          only:[
            'XY110','XY111','XY112','XY113','XY114','XY115','XY116','XY117','XY118','XY119','XY120',
            'XY121','XY122','XY123','XY124'
          ]
        },
        {
          id:'xyp',label:'Promos internacionais oficiais 20 anos',lang:'en',required:true,
          only:[
            'XY110','XY111','XY112','XY113','XY114','XY115','XY116','XY117','XY118','XY119','XY120',
            'XY121','XY122','XY123','XY124','XY125','XY126','XY143','XY148',
            'XY160','XY161','XY162','XY163','XY179',
            'XY202','XY203','XY204','XY205','XY206','XY207','XY208','XY209','XY210'
          ]
        },
        {
          id:'g1',label:'Generations · selos 20th / Toys R Us',lang:'en',all:true,
          only:['8','14','22','26','32','43','50','53'],transform:'stamp20'
        },
        {
          id:'xyp',label:'Red & Blue · Jumbos internacionais',lang:'en',all:true,jumbo:true,
          only:['XY121','XY122','XY123','XY124'],
          transform:'jumboOnly',ensureJumbo:['XY121','XY122','XY123','XY124']
        }
      ]
    },
    {
      id:'anniv25-complete',
      label:'Completa 25 Anos',
      coreIds:['cel25','cel25cc'],
      summaryLabels:['Celebrações','Classic Collection','McDonald’s','General Mills','promos','Metal','First Partner Jumbo'],
      series:'25º Aniversário',
      releaseDate:'2021',
      components:[
        {id:'cel25',label:'Celebrações',required:true},
        {id:'cel25cc',label:'Classic Collection',required:true},
        {id:'2021swsh',label:'McDonald’s Collection 2021',all:true},
        {
          id:'swshp',label:'General Mills · promos 25 anos',lang:'en',all:true,
          only:['SWSH010','SWSH011','SWSH012','SWSH013','SWSH039','SWSH040'],transform:'generalMillsHolo'
        },
        {
          id:'swsh1',label:'General Mills · cartas regulares',lang:'en',all:true,
          only:['63','73','89','117','127','136'],transform:'generalMillsNormal'
        },
        {
          id:'swsh2',label:'General Mills · cartas regulares',lang:'en',all:true,
          only:['89','94'],transform:'generalMillsNormal'
        },
        {
          id:'swshp',label:'Promos dos produtos Celebrations',all:true,
          only:['SWSH062','SWSH132','SWSH133','SWSH134','SWSH135','SWSH136','SWSH137','SWSH138',
            'SWSH139','SWSH140','SWSH141','SWSH142','SWSH143','SWSH144','SWSH145','SWSH146','SWSH167','SWSH178']
        },
        {
          id:'swshp',label:'Jumbos dos produtos Celebrations',lang:'en',all:true,jumbo:true,
          only:['SWSH132','SWSH133','SWSH134','SWSH136','SWSH137','SWSH138','SWSH139'],
          transform:'jumboOnly',ensureJumbo:['SWSH132','SWSH133','SWSH134','SWSH136','SWSH137','SWSH138','SWSH139']
        },
        {id:'base1',label:'Ultra-Premium Collection · Metal',lang:'en',all:true,only:['4','58'],transform:'metalOnly'},
        {id:'base1',label:'First Partner · Kanto',lang:'en',all:true,jumbo:true,only:['44','46','58','63'],transform:'jumboOnly'},
        {id:'neo1',label:'First Partner · Johto',lang:'en',all:true,jumbo:true,only:['54','57','81'],transform:'jumboOnly'},
        {id:'ex1',label:'First Partner · Hoenn',lang:'en',all:true,jumbo:true,only:['59','74','76'],transform:'jumboOnly'},
        {id:'dp1',label:'First Partner · Sinnoh',lang:'en',all:true,jumbo:true,only:['76','93','103'],transform:'jumboOnly'},
        {id:'bwp',label:'First Partner · Unova',lang:'en',all:true,jumbo:true,only:['BW01','BW02','BW03'],transform:'jumboOnly'},
        {id:'xyp',label:'First Partner · Kalos',lang:'en',all:true,jumbo:true,only:['XY01','XY02','XY03'],transform:'jumboOnly'},
        {id:'smp',label:'First Partner · Alola',lang:'en',all:true,jumbo:true,only:['SM01','SM02','SM03'],transform:'jumboOnly'},
        {id:'swshp',label:'First Partner · Galar',lang:'en',all:true,jumbo:true,only:['SWSH001','SWSH002','SWSH003'],transform:'jumboOnly'}
      ]
    },
    {
      id:'anniv30-complete',
      label:'Completa 30 Anos',
      coreIds:['30th','30th-c'],
      summaryLabels:['30th Celebration','Coleção Clássica','Energias 30th','promos MEP','extras de produto'],
      series:'30º Aniversário',
      releaseDate:'2026',
      components:[
        {id:'30th',label:'Celebração de 30 Anos',required:true,all:true},
        {id:'30th-c',label:'Coleção Clássica',required:true,all:true},
        {id:'mee',label:'Energias Básicas 30th',all:true,only:['9','10','11','12','13','14','15','16']},
        {
          id:'mep',label:'Promos 30th · produtos 2026',all:true,jumbo:true,
          only:['94','95','96','97','98','99','100','101','102','103','104','105','106','107','108','109']
        }
      ],
      syntheticEntries:[
        {
          apiId:'30th-rgb-r',name:'Mew',number:'R/RGB',printedTotal:'',setId:'30th',setName:'30th Celebration',
          seriesName:'30º Aniversário',releaseDate:'2026',rarity:'RGB',type:'Pokémon',category:'Pokémon',hp:60,imageUrl:'',
          variantKey:'rgb-red',variantLabel:'RGB Mew · Red · extra não listado',finish:'Especial',variantOrder:6,
          variantType:'special',variantFoil:'rgb-red',variantSubtype:'',variantStamps:[],variantSize:'standard',
          source:'Anniversary extra',languageCode:'en',language:'Inglês',anniversaryExtra:true,anniversaryUnlisted:true
        },
        {
          apiId:'30th-rgb-g',name:'Mew',number:'G/RGB',printedTotal:'',setId:'30th',setName:'30th Celebration',
          seriesName:'30º Aniversário',releaseDate:'2026',rarity:'RGB',type:'Pokémon',category:'Pokémon',hp:60,imageUrl:'',
          variantKey:'rgb-green',variantLabel:'RGB Mew · Green · extra não listado',finish:'Especial',variantOrder:6,
          variantType:'special',variantFoil:'rgb-green',variantSubtype:'',variantStamps:[],variantSize:'standard',
          source:'Anniversary extra',languageCode:'en',language:'Inglês',anniversaryExtra:true,anniversaryUnlisted:true
        },
        {
          apiId:'30th-rgb-b',name:'Mew',number:'B/RGB',printedTotal:'',setId:'30th',setName:'30th Celebration',
          seriesName:'30º Aniversário',releaseDate:'2026',rarity:'RGB',type:'Pokémon',category:'Pokémon',hp:60,imageUrl:'',
          variantKey:'rgb-blue',variantLabel:'RGB Mew · Blue · extra não listado',finish:'Especial',variantOrder:6,
          variantType:'special',variantFoil:'rgb-blue',variantSubtype:'',variantStamps:[],variantSize:'standard',
          source:'Anniversary extra',languageCode:'en',language:'Inglês',anniversaryExtra:true,anniversaryUnlisted:true
        }
      ]
    }
  ];

  function completeAnniversaryForCatalog(list){
    const ids=new Set((list||[]).map(x=>String(x?.id||'')));
    return ANNIVERSARY_COMPLETE_MASTER_SETS.filter(x=>(x.coreIds||[]).every(id=>ids.has(id)));
  }

  function completeAnniversaryById(id){
    return ANNIVERSARY_COMPLETE_MASTER_SETS.find(x=>x.id===String(id||''))||null;
  }

  function anniversaryLocalId(entry){
    const api=String(entry?.apiId||'');
    const set=String(entry?.setId||'');
    if(set&&api.startsWith(set+'-'))return api.slice(set.length+1).toUpperCase();
    return String(entry?.number||'').split('/')[0].trim().toUpperCase();
  }

  function anniversaryGroupEntries(entries){
    const map=new Map();
    for(const entry of entries||[]){
      const key=String(entry?.apiId||anniversaryLocalId(entry));
      if(!map.has(key))map.set(key,[]);
      map.get(key).push(entry);
    }
    return [...map.values()];
  }

  function anniversaryClone(entry,suffix,label,patch={}){
    return {
      ...entry,
      ...patch,
      variantKey:String(entry?.variantKey||'normal')+'|anniversary:'+suffix,
      variantLabel:label,
      anniversaryExtra:true
    };
  }

  function anniversaryBest(group,predicate){
    return group.find(predicate)||group.find(e=>String(e?.variantSize||'').toLowerCase()!=='jumbo')||group[0]||null;
  }

  function transformAnniversaryComponent(entries,spec){
    const list=Array.isArray(entries)?entries:[];
    const mode=spec?.transform||'';
    if(mode==='stamp20'){
      const out=[];
      for(const group of anniversaryGroupEntries(list)){
        const base=anniversaryBest(group,e=>e.finish==='Normal')||group[0];
        if(!base)continue;
        const toys=group.find(e=>/toys|r-us|r us/i.test(String(e.variantLabel||'')+' '+String(e.variantStamps||'')));
        const anniv=group.find(e=>/20th|annivers/i.test(String(e.variantLabel||'')+' '+String(e.variantStamps||'')));
        out.push(toys||anniversaryClone(base,'20th-toysrus',"Toys 'R' Us stamp",{finish:base.finish||'Normal'}));
        out.push(anniv||anniversaryClone(base,'20th-anniversary','20th Anniversary stamp',{finish:base.finish||'Normal'}));
      }
      return out;
    }
    if(mode==='generalMillsHolo'){
      return anniversaryGroupEntries(list).map(group=>{
        const chosen=anniversaryBest(group,e=>/25th|annivers|sequin/i.test(String(e.variantLabel||'')+' '+String(e.variantStamps||'')))||
          anniversaryBest(group,e=>e.finish==='Foil'||String(e.variantType||'').toLowerCase()==='holo');
        return chosen?anniversaryClone(chosen,'25th-general-mills-holo','General Mills 25 Anos · Sequin Holo',{finish:'Foil'}):null;
      }).filter(Boolean);
    }
    if(mode==='generalMillsNormal'){
      return anniversaryGroupEntries(list).map(group=>{
        const chosen=anniversaryBest(group,e=>e.finish==='Normal'&&String(e.variantSize||'standard').toLowerCase()!=='jumbo');
        return chosen?anniversaryClone(chosen,'25th-general-mills-normal','General Mills 25 Anos · Normal',{finish:'Normal'}):null;
      }).filter(Boolean);
    }
    if(mode==='jumboOnly'){
      return anniversaryGroupEntries(list).map(group=>{
        const jumbo=group.find(e=>String(e.variantSize||'').toLowerCase()==='jumbo'||/jumbo/i.test(String(e.variantLabel||'')));
        const chosen=jumbo||anniversaryBest(group,e=>String(e.variantSize||'standard').toLowerCase()!=='jumbo');
        return chosen?(jumbo?jumbo:anniversaryClone(chosen,'25th-jumbo','Jumbo · 25º Aniversário',{variantSize:'jumbo',finish:chosen.finish||'Normal'})):null;
      }).filter(Boolean);
    }
    if(mode==='metalOnly'){
      return anniversaryGroupEntries(list).map(group=>{
        const metal=group.find(e=>String(e.variantType||'').toLowerCase()==='metal'||/metal/i.test(String(e.variantLabel||'')));
        const chosen=metal||anniversaryBest(group,e=>String(e.variantSize||'standard').toLowerCase()!=='jumbo');
        return chosen?(metal?metal:anniversaryClone(chosen,'25th-metal','Metal · Celebrations Ultra-Premium Collection',{variantType:'metal',finish:'Especial'})):null;
      }).filter(Boolean);
    }
    return list;
  }

  function ensureAnniversaryJumbos(entries,spec){
    const wanted=Array.isArray(spec?.ensureJumbo)?spec.ensureJumbo.map(x=>String(x).toUpperCase()):[];
    if(!wanted.length)return entries;
    const out=[...(entries||[])];
    for(const localId of wanted){
      const same=out.filter(e=>anniversaryLocalId(e)===localId);
      if(!same.length)continue;
      if(same.some(e=>String(e.variantSize||'').toLowerCase()==='jumbo'||/jumbo/i.test(String(e.variantLabel||''))))continue;
      const base=anniversaryBest(same,e=>String(e.variantSize||'standard').toLowerCase()!=='jumbo');
      if(base)out.push(anniversaryClone(base,'jumbo-'+localId.toLowerCase(),'Jumbo',{variantSize:'jumbo'}));
    }
    return out;
  }

  async function fetchAnniversaryComponent(masterLang,spec){
    // lang = restrição física real. fetchLang = apenas fonte técnica de metadados.
    if(spec.lang&&spec.lang!==masterLang){
      return {ok:true,set:{id:spec.id,name:spec.label||spec.id,languageCode:spec.lang},entries:[],__spec:spec,__excludedByLanguage:true};
    }
    if(spec.physicalLang&&spec.physicalLang!==masterLang){
      return {ok:true,set:{id:spec.id,name:spec.label||spec.id,languageCode:spec.physicalLang},entries:[],__spec:spec,__excludedByLanguage:true};
    }
    const fetchLang=spec.fetchLang||masterLang;
    const forcePhysical=!!spec.physicalLang;
    const p=new URLSearchParams({v:'28',lang:fetchLang,set:spec.id,strictLang:forcePhysical?'0':'1'});
    if(spec.all)p.set('all','1');
    if(spec.jumbo)p.set('jumbo','1');
    if(Array.isArray(spec.only)&&spec.only.length)p.set('only',spec.only.join(','));
    const r=await fetch('/api/master-set?'+p.toString(),{cache:'no-store'});
    const data=await r.json();
    if(!r.ok||!data?.ok)throw new Error(data?.message||('Falha ao carregar '+(spec.label||spec.id)));
    let entries=Array.isArray(data.entries)?data.entries:[];
    if(forcePhysical){
      const physicalCode=spec.physicalLang==='pt'?'pt-br':spec.physicalLang;
      const physicalLabel=spec.physicalLang==='pt'?'Português':spec.physicalLang==='ja'?'Japonês':'Inglês';
      entries=entries.map(e=>({...e,languageCode:physicalCode,language:physicalLabel,anniversaryLocalizedOverride:true}));
    }else{
      entries=entries.filter(e=>{
        const code=String(e?.languageCode||'').toLowerCase();
        return masterLang==='pt'?code==='pt-br':code===masterLang;
      });
    }
    entries=transformAnniversaryComponent(entries,spec);
    entries=ensureAnniversaryJumbos(entries,spec);
    if(spec.required&&!entries.length){
      throw new Error((spec.label||spec.id)+' retornou 0 cartas no idioma selecionado. O Master Set foi bloqueado para não criar uma coleção incompleta.');
    }
    return {...data,entries,__spec:spec};
  }

  async function fetchSeries(lang){
    const key='series|'+lang;
    if(V14.seriesCache.has(key))return V14.seriesCache.get(key);
    const r=await fetch('https://api.tcgdex.net/v2/'+lang+'/series',{cache:'force-cache'});
    if(!r.ok)throw new Error('TCGdex '+r.status);
    const data=await r.json();
    const list=Array.isArray(data)?data:[];
    V14.seriesCache.set(key,list);
    return list;
  }
  async function fetchSeriesDetail(lang,seriesId){
    const key='series-detail|'+lang+'|'+seriesId;
    if(V14.seriesCache.has(key))return V14.seriesCache.get(key);
    const r=await fetch('https://api.tcgdex.net/v2/'+lang+'/series/'+encodeURIComponent(seriesId),{cache:'force-cache'});
    if(!r.ok)throw new Error('TCGdex '+r.status);
    const data=await r.json();
    V14.seriesCache.set(key,data||{});
    return data||{};
  }
  async function loadGenerationOptions(force=false){
    const epoch=V14.masterEpoch;
    const lang=byId('v14MasterLang')?.value||'pt',series=byId('v14SeriesSelect'),sets=byId('v14SetSelect');
    if(!series||!sets)return;
    if(!force&&series.options.length>1)return;
    series.disabled=true;sets.disabled=true;
    series.innerHTML='<option value="">Carregando gerações…</option>';
    sets.innerHTML='<option value="">Escolha primeiro a geração</option>';
    byId('v14MasterStep')?.classList.add('hidden');
    byId('v14PromoNotice')?.classList.add('hidden');
    V14.masterPreview=null;
    try{
      const list=[...(await fetchSeries(lang))];
      if(epoch!==V14.masterEpoch)return;
      let englishById=new Map();
      if(lang==='ja'){
        try{
          const en=await fetchSeries('en');
          if(epoch!==V14.masterEpoch)return;
          englishById=new Map(en.map(s=>[String(s.id||'').toLowerCase(),s.name||s.id]));
        }catch{}
      }
      series.innerHTML='<option value="">Selecione a geração</option>'+list.map(s=>{
        const label=lang==='ja'?(englishById.get(String(s.id||'').toLowerCase())||s.name||s.id):(s.name||s.id);
        return '<option value="'+esc(s.id)+'">'+esc(label)+'</option>';
      }).join('');
      series.disabled=false;
      byId('v14SetStatus').textContent='Escolha a geração e depois a coleção.';
    }catch(e){
      console.error(e);series.innerHTML='<option value="">Erro ao carregar gerações</option>';
      byId('v14SetStatus').textContent='Não consegui carregar as gerações.';
    }
  }
  async function loadCollectionsForGeneration(){
    const epoch=V14.masterEpoch;
    const lang=byId('v14MasterLang')?.value||'pt',seriesId=byId('v14SeriesSelect')?.value||'',sets=byId('v14SetSelect');
    V14.masterPreview=null;
    byId('v14MasterStep')?.classList.add('hidden');
    byId('v14PromoNotice')?.classList.add('hidden');
    if(!sets)return;
    if(!seriesId){sets.disabled=true;sets.innerHTML='<option value="">Escolha primeiro a geração</option>';return}
    sets.disabled=true;sets.innerHTML='<option value="">Carregando coleções…</option>';
    byId('v14SetStatus').textContent='Carregando coleções da geração…';
    try{
      const r=await fetch('/api/set-catalog?lang='+encodeURIComponent(lang)+'&series='+encodeURIComponent(seriesId),{cache:'no-store'});
      const catalog=await r.json();
      if(epoch!==V14.masterEpoch)return;
      if(!catalog?.ok)throw new Error(catalog?.message||'Falha ao carregar as coleções');
      const list=Array.isArray(catalog.sets)?catalog.sets:[];
      const completeAnniversaries=completeAnniversaryForCatalog(list);
      const completeOptions=completeAnniversaries.map(s=>
        '<option value="'+esc(s.id)+'">'+esc(s.label)+' · '+esc((s.summaryLabels||[]).join(' + '))+'</option>'
      ).join('');
      sets.innerHTML='<option value="">Selecione a coleção</option>'+completeOptions+list.map(s=>
        '<option value="'+esc(s.id)+'">'+esc(s.displayName||s.name||s.id)+(s.isPromo?' · PROMOS':'')+'</option>'
      ).join('');
      sets.disabled=false;
      const promoCount=list.filter(s=>s.isPromo).length;
      byId('v14SetStatus').textContent=list.length+' coleções em ordem de lançamento'+
        (completeAnniversaries.length?' · '+completeAnniversaries.length+' opção completa de aniversário':'')+
        (promoCount?' · '+promoCount+' coleção de promos disponível':'')+'.';
    }catch(e){
      console.error(e);sets.innerHTML='<option value="">Erro ao carregar coleções</option>';
      byId('v14SetStatus').textContent='Não consegui carregar as coleções desta geração.';
    }
  }

  async function generationPromoEntriesV1603(lang,seriesId,selectedSetId){
    if(!seriesId)return{entries:[],sets:[]};
    try{
      const catalogRes=await fetch('/api/set-catalog?lang='+encodeURIComponent(lang)+'&series='+encodeURIComponent(seriesId),{cache:'no-store'});
      const catalog=await catalogRes.json();
      if(!catalog?.ok)return{entries:[],sets:[]};
      const promoSets=(catalog.sets||[]).filter(s=>s?.isPromo&&String(s.id)!==String(selectedSetId));
      if(!promoSets.length)return{entries:[],sets:[]};

      const parts=await Promise.all(promoSets.map(async promo=>{
        try{
          const p=new URLSearchParams({
            v:'30',strictLang:'1',all:'1',lang:String(lang||'pt'),set:String(promo.id)
          });
          const rr=await fetch('/api/master-set?'+p.toString(),{cache:'no-store'});
          const jj=await rr.json();
          if(!jj?.ok)return null;
          return{set:promo,entries:(jj.entries||[]).map(entry=>({
            ...entry,
            autoPromo:true,
            promoOriginSetId:promo.id,
            promoOriginSetName:promo.displayName||promo.name||promo.id
          }))};
        }catch(error){
          console.warn('[Master Set promos]',promo?.id,error);
          return null;
        }
      }));

      const entries=[],seen=new Set(),sets=[];
      for(const part of parts.filter(Boolean)){
        sets.push({id:part.set.id,name:part.set.displayName||part.set.name||part.set.id,count:part.entries.length});
        for(const entry of part.entries){
          const key=[entry.apiId,entry.variantKey,entry.languageCode].join('|');
          if(seen.has(key))continue;
          seen.add(key);
          entries.push(entry);
        }
      }
      return{entries,sets};
    }catch(error){
      console.warn('[Master Set promos da geração]',error);
      return{entries:[],sets:[]};
    }
  }

  async function loadMasterPreview(lang,setId){
    const epoch=V14.masterEpoch;
    byId('v14SetStatus').textContent='Carregando cartas e variantes do Master Set…';
    byId('v14MasterStep').classList.add('hidden');
    try{
      const complete=completeAnniversaryById(setId);
      let j;
      if(complete){
        const parts=[];
        const warnings=[];
        for(const spec of complete.components||[]){
          try{
            parts.push(await fetchAnniversaryComponent(lang,spec));
          }catch(error){
            if(spec.required)throw error;
            console.warn('[Master comemorativo]',spec.label||spec.id,error);
            warnings.push((spec.label||spec.id)+': '+(error?.message||error));
          }
        }
        if(epoch!==V14.masterEpoch)return;
        const combined=[];
        const seen=new Set();
        for(const part of parts){
          for(const entry of part.entries||[]){
            const key=[entry.apiId,entry.variantKey,entry.languageCode].join('|');
            if(seen.has(key))continue;
            seen.add(key);
            combined.push(entry);
          }
        }
        for(const entry of complete.syntheticEntries||[]){
          const code=String(entry?.languageCode||'').toLowerCase();
          const matchesLanguage=lang==='pt'?code==='pt-br':code===lang;
          if(!matchesLanguage)continue;
          const key=[entry.apiId,entry.variantKey,entry.languageCode].join('|');
          if(seen.has(key))continue;
          seen.add(key);
          combined.push({...entry});
        }
        j={
          ok:true,
          set:{
            id:complete.id,
            name:complete.label,
            series:complete.series,
            releaseDate:complete.releaseDate,
            languageCode:lang==='pt'?'pt-br':lang,
            isPromoSet:false,
            isCompositeAnniversary:true
          },
          entries:combined,
          components:parts.map(x=>({
            id:x.set?.id||x.__spec?.id,
            name:x.__spec?.label||x.set?.name||x.__spec?.id,
            entries:Array.isArray(x.entries)?x.entries.length:0,
            uniqueCards:new Set((x.entries||[]).map(e=>e.apiId)).size
          })),
          anniversaryWarnings:warnings
        };
      }else{
        const r=await fetch('/api/master-set?v=30&strictLang=1&lang='+encodeURIComponent(lang)+'&set='+encodeURIComponent(setId),{cache:'no-store'});
        j=await r.json();
        if(epoch!==V14.masterEpoch)return;
        if(!j?.ok)throw new Error(j?.message||'Falha no Master Set');

        // V16.03: every normal Master Set automatically includes the official
        // promo collection(s) of the selected generation. Promo sets themselves
        // are not duplicated, and every entry still obeys the chosen language.
        if(!j.set?.isPromoSet){
          const seriesId=byId('v14SeriesSelect')?.value||'';
          const promos=await generationPromoEntriesV1603(lang,seriesId,setId);
          if(epoch!==V14.masterEpoch)return;
          const seen=new Set((j.entries||[]).map(entry=>[entry.apiId,entry.variantKey,entry.languageCode].join('|')));
          let added=0;
          for(const entry of promos.entries){
            const key=[entry.apiId,entry.variantKey,entry.languageCode].join('|');
            if(seen.has(key))continue;
            seen.add(key);
            j.entries.push(entry);
            added++;
          }
          j.autoPromoSets=promos.sets;
          j.autoPromoEntries=added;
        }
      }
      if(!j?.ok)throw new Error(j?.message||'Falha no Master Set');
      const selectedLabel=(byId('v14SetSelect')?.selectedOptions?.[0]?.textContent||j.set.name||'')
        .replace(/\s*·\s*PROMOS\s*$/i,'')
        .replace(/\s*·\s*(?:Gerações|Celebrações|Celebração de 30 Anos)\s*\+.*$/i,'')
        .trim();
      V14.masterPreview={...j,owned:new Set(),lang,displaySetName:complete?.label||selectedLabel||j.set.name};
      byId('v14MasterTitle').textContent=V14.masterPreview.displaySetName;
      const componentText=complete?(complete.summaryLabels||[]).join(' + '):'';
      const componentBreakdown=complete&&Array.isArray(j.components)
        ?j.components.filter(c=>c.entries>0).map(c=>c.name+': '+c.entries).join(' · ')
        :'';
      byId('v14MasterMeta').textContent=[j.set.series,j.set.releaseDate,componentText,componentBreakdown,j.entries.length+' entradas/variantes',(!complete&&j.autoPromoEntries?j.autoPromoEntries+' promo(s) oficial(is) incluída(s) automaticamente':'')].filter(Boolean).join(' · ');
      const notice=byId('v14PromoNotice');
      if(notice){
        if(complete){
          const warnings=Array.isArray(j.anniversaryWarnings)&&j.anniversaryWarnings.length
            ?' Atenção: '+j.anniversaryWarnings.length+' grupo(s) extra(s) não puderam ser carregados agora.'
            :'';
          notice.textContent=complete.label+' reúne set principal, subsets, promos, distribuições especiais e extras físicos disponíveis no idioma selecionado. O filtro de idioma é estrito: cartas que só existem em outro idioma não entram. Jumbos e cards Metal entram como entradas próprias.'+warnings;
        }else if(j.set.isPromoSet){
          notice.textContent='Esta é a coleção de promos da geração; as promos desta coleção entram normalmente no Master Set.';
        }else{
          notice.textContent=j.autoPromoEntries
            ?'Este Master Set já inclui automaticamente '+j.autoPromoEntries+' entrada(s) promocional(is) oficial(is) da mesma geração, no idioma selecionado. Você não precisa criar um fichário separado de PROMOS.'
            :'Não encontrei uma coleção oficial de promos separada nesta geração para acrescentar automaticamente.';
        }
        notice.classList.remove('hidden');
      }
      renderMasterGrid();
      renderMasterQueue();
      byId('v14SetStatus').textContent=complete?'Coleção completa de aniversário pronta para conferência.':'Master Set pronto para conferência.';
      byId('v14MasterStep').classList.remove('hidden');
    }catch(e){console.error(e);byId('v14SetStatus').textContent='Erro ao montar a coleção: '+(e.message||e)}
  }

  function masterSelectionKey(p){
    return String(p?.lang||p?.set?.languageCode||'')+'|'+String(p?.set?.id||'');
  }

  function masterPreviewsForCreate(){
    const out=[...V14.masterSelections];
    if(V14.masterPreview){
      const key=masterSelectionKey(V14.masterPreview);
      const ix=out.findIndex(x=>masterSelectionKey(x)===key);
      if(ix>=0)out[ix]=V14.masterPreview;
      else out.push(V14.masterPreview);
    }
    return out;
  }

  function renderMasterQueue(){
    const box=byId('v1418MasterQueue');
    const create=byId('v14CreateMaster');
    if(!box||!create)return;
    const list=V14.masterSelections;
    box.classList.toggle('hidden',!list.length);
    box.innerHTML=list.length
      ?'<div class="v1418-master-queue-head"><strong>Master Sets no fichário</strong><small>'+list.length+' adicionado'+(list.length===1?'':'s')+'</small></div>'+
        list.map((p,i)=>'<div class="v1418-master-queue-item"><span><strong>'+esc(p.displaySetName||p.set?.name||'Master Set')+'</strong><small>'+p.entries.length+' entradas · '+p.owned.size+' Tenho</small></span><button type="button" data-v1418-remove-master="'+i+'" aria-label="Remover Master Set">×</button></div>').join('')
      :'';
    box.querySelectorAll('[data-v1418-remove-master]').forEach(b=>b.onclick=()=>{
      V14.masterSelections.splice(+b.dataset.v1418RemoveMaster,1);
      renderMasterQueue();
    });
    const total=masterPreviewsForCreate().length;
    create.textContent=total>1?'Criar fichário com '+total+' Master Sets':'Criar Master Set';
  }

  function markAllMasterOwned(owned){
    const p=V14.masterPreview;if(!p)return;
    p.owned=owned?new Set(p.entries.map((_,i)=>i)):new Set();
    renderMasterGrid();
  }

  function addAnotherMasterSet(){
    const p=V14.masterPreview;
    if(!p)return toast('Escolha e carregue um Master Set primeiro.');
    const key=masterSelectionKey(p);
    const ix=V14.masterSelections.findIndex(x=>masterSelectionKey(x)===key);
    if(ix>=0)V14.masterSelections[ix]=p;
    else V14.masterSelections.push(p);

    V14.masterEpoch++;
    V14.masterPreview=null;
    byId('v14MasterStep')?.classList.remove('hidden');
    byId('v14PromoNotice')?.classList.add('hidden');
    const grid=byId('v14MasterGrid');if(grid)grid.innerHTML='';
    const title=byId('v14MasterTitle');if(title)title.textContent='Escolha outro Master Set';
    const meta=byId('v14MasterMeta');if(meta)meta.textContent='Os Master Sets já adicionados continuam no fichário.';
    const owned=byId('v14OwnedCount');if(owned)owned.textContent='0';
    const set=byId('v14SetSelect');if(set)set.value='';
    const status=byId('v14SetStatus');
    if(status)status.textContent=V14.masterSelections.length+' Master Set'+(V14.masterSelections.length===1?'':'s')+' adicionado'+(V14.masterSelections.length===1?'':'s')+'. Escolha outra coleção ou crie o fichário agora.';
    renderMasterQueue();
    toast('Master Set adicionado ao fichário. Você pode escolher outro ou criar agora.');
  }

  function masterImage(entry){
    if(!entry)return'';
    const apiId=String(entry.apiId||'').trim();
    const lang=String(entry.languageCode||'en').toLowerCase()==='pt-br'?'pt':String(entry.languageCode||'en').toLowerCase();
    // V16.02: Master Set image identity is the exact card id, not whatever
    // asset URL happened to come in the set payload. The resolver already
    // handles localized scan -> EN same printing -> TCGplayer fallback.
    if(entry.source==='TCGdex'&&apiId){
      return '/api/tcgdex-card-image?id='+encodeURIComponent(apiId)+'&lang='+encodeURIComponent(lang);
    }
    const u=entry.imageUrl||'';
    return u&&u.includes('assets.tcgdex.net')&&!/\.(webp|png|jpe?g)$/i.test(u)?u+'/high.webp':u;
  }
  function renderMasterGrid(){
    const p=V14.masterPreview,g=byId('v14MasterGrid');if(!p||!g)return;
    g.innerHTML=p.entries.map((e,i)=>{
      const owned=p.owned.has(i),img=masterImage(e);
      return '<button type="button" class="v14-master-card '+(owned?'owned':'')+'" data-master-index="'+i+'">'+
        (img?'<img src="'+esc(img)+'" loading="lazy" alt="'+esc(e.name)+'" data-master-img="'+i+'">':'<div class="v14-no-img" data-master-fallback="'+i+'">'+esc(e.name)+'</div>')+
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
    hydrateMasterPreviewImages();
  }

  async function masterImageFallbackV1473(entry){
    if(!entry)return'';
    const exact=masterImage(entry);
    if(exact)return exact;
    if(entry.languageCode==='ja')return japaneseImageFallback({...entry,languageCode:'ja'});
    V14.masterImageFallbackCache=V14.masterImageFallbackCache||new Map();
    const key=[entry.apiId,entry.setId,entry.number,entry.name].join('|');
    if(V14.masterImageFallbackCache.has(key))return V14.masterImageFallbackCache.get(key);
    try{
      const p=new URLSearchParams({
        name:entry.name||'',
        number:entry.number||'',
        set:entry.setId||entry.setName||'',
        rarity:entry.rarity||'',
        hp:String(entry.hp||'')
      });
      const r=await fetch('/api/card-image-fallback?'+p.toString(),{cache:'force-cache'});
      const j=await r.json();
      const url=j?.ok?j.url:'';
      V14.masterImageFallbackCache.set(key,url);
      return url;
    }catch{
      V14.masterImageFallbackCache.set(key,'');
      return'';
    }
  }

  function hydrateMasterPreviewImages(){
    const p=V14.masterPreview;if(!p)return;
    const root=byId('v14MasterGrid');
    const nodes=[...document.querySelectorAll('[data-master-fallback]')];
    const io=new IntersectionObserver(entries=>{
      for(const ent of entries){
        if(!ent.isIntersecting)continue;
        io.unobserve(ent.target);
        const i=+ent.target.dataset.masterFallback,e=p.entries[i];
        masterImageFallbackV1473(e).then(url=>{
          if(!url||!ent.target.isConnected)return;
          const img=document.createElement('img');
          img.src=url;img.loading='lazy';img.alt=e.name||'Carta';img.dataset.masterImg=String(i);
          ent.target.replaceWith(img);e.imageUrl=url;
        }).catch(()=>{});
      }
    },{root,rootMargin:'250px'});
    nodes.forEach(n=>io.observe(n));

    root?.querySelectorAll('img[data-master-img]').forEach(img=>{
      img.addEventListener('error',()=>{
        if(img.dataset.fallbackTried==='1')return;
        img.dataset.fallbackTried='1';
        const i=+img.dataset.masterImg,e=p.entries[i];
        if(!e)return;
        e.imageUrl='';
        masterImageFallbackV1473(e).then(url=>{
          if(!url||!img.isConnected)return;
          img.src=url;e.imageUrl=url;
        }).catch(()=>{});
      },{once:false});
    });
  }

  async function liveMasterBinderName(base,setId){
    const {data,error}=await db.from('pokemon_binders')
      .select('id,name')
      .eq('user_id',currentUser.id)
      .eq('binder_kind','set')
      .eq('set_id',setId);
    if(error)throw error;
    const same=Array.isArray(data)?data:[];
    if(!same.length)return base;
    return base+' ('+(same.length+1)+')';
  }

  function fullMasterEntryNumberV1450(entry){
    const n=String(entry?.number||'').trim();
    const total=String(entry?.printedTotal||'').trim();
    if(!n)return'';
    const setId=String(entry?.setId||'').trim().toLowerCase();
    // Generations possui a Radiant Collection própria RC1–RC32. TCGdex
    // informa o total principal 83, então sem esta correção o app gravava
    // RC1/83, RC29/83 etc. e a MYP nunca encontrava a impressão correta.
    if(setId==='g1'&&/^rc\d+$/i.test(n))return n.toUpperCase()+'/RC32';
    if(setId==='g1'&&/^rc\d+\/83$/i.test(n))return n.replace(/\/83$/i,'/RC32').toUpperCase();
    if(n.includes('/'))return n;
    return total?n+'/'+total:n;
  }

  async function createMasterBinder(){
    const previews=masterPreviewsForCreate();
    if(!previews.length)return toast('Escolha pelo menos um Master Set.');
    const btn=byId('v14CreateMaster');busy(btn,true,previews.length>1?'Criando fichário…':'Criando Master Set…');
    let createdBinder=null;
    try{
      await loadBinders();

      const flat=[];
      for(const preview of previews){
        preview.entries.forEach((entry,index)=>flat.push({preview,entry,index}));
      }
      const pages=Math.max(1,Math.ceil(flat.length/9));
      const sortOrder=Math.max(0,...V14.binders.map(b=>+b.sort_order||0))+1;
      const names=previews.map(p=>p.displaySetName||p.set.name);
      let baseName=names.join(' + ');
      if(baseName.length>50)baseName=(names.slice(0,2).join(' + ')+' + '+(names.length-2)+' set'+(names.length-2===1?'':'s')).slice(0,50);

      let binderName=baseName;
      if(previews.length===1){
        binderName=await liveMasterBinderName(baseName,previews[0].set.id);
      }else{
        let n=2;
        const existing=new Set(V14.binders.map(b=>String(b.name||'').toLowerCase()));
        while(existing.has(binderName.toLowerCase())){
          const suffix=' ('+n+++')';
          binderName=baseName.slice(0,Math.max(1,50-suffix.length))+suffix;
        }
      }

      const single=previews.length===1?previews[0]:null;
      const {data:binder,error:be}=await db.from('pokemon_binders').insert({
        user_id:currentUser.id,
        name:binderName,
        pages,
        background:'graphite',
        sort_order:sortOrder,
        binder_kind:'set',
        set_id:single?single.set.id:null,
        set_name:single?(single.displaySetName||single.set.name):names.join(' + '),
        set_language:single?single.set.languageCode:null,
        master_language:single?single.set.languageCode:null,
        master_total:flat.length
      }).select('*').single();
      if(be)throw be;
      createdBinder=binder;

      V14.masterPriceRequestedAt=new Date().toISOString();
      const rows=flat.map(({preview:p,entry:e,index:localIndex},globalIndex)=>{
        const owned=p.owned.has(localIndex),page=Math.floor(globalIndex/9)+1,slot=globalIndex%9+1;
        const base={
          source:e.source,apiId:e.apiId,name:e.name,languageCode:e.languageCode,language:e.language,
          setName:e.setName,setId:e.setId,number:fullMasterEntryNumberV1450(e),
          rarity:e.rarity,type:e.type,imageUrl:masterImage(e)||e.imageUrl||''
        };
        const payload=cardPayload(base,{page,slot,status:owned?'owned':'missing',quantity:owned?1:0,condition:'Nova',finish:e.finish,finishConfirmed:true,notes:e.variantLabel},{});
        payload.user_id=currentUser.id;
        payload.binder_id=binder.id;
        payload.card_key=(payload.card_key||cardKey(base))+'|variant:'+String(e.variantKey||e.variantLabel||e.finish);
        const requestedAt=V14.masterPriceRequestedAt||new Date().toISOString();
        // Todo Master Set entra na fila de cotação, tenha ou não tenha a carta.
        // O worker do servidor controla prioridade, retries e conclusão.
        payload.price_pending=true;
        payload.price_processing_at=null;
        payload.price_requested_at=requestedAt;
        payload.price_next_retry_at=requestedAt;
        payload.price_attempts=0;
        // Master Set pode criar centenas de linhas de uma vez. Mantém prioridade
        // abaixo de cartas adicionadas manualmente para não bloquear a fila.
        payload.price_priority=500;
        payload.price_last_error=null;
        payload.price_checked_at=null;
        return payload;
      });

      for(let i=0;i<rows.length;i+=100){
        const {error}=await db.from('pokemon_cards').insert(rows.slice(i,i+100));
        if(error)throw error;
      }

      hardCloseDialog('v14BinderDialog');
      resetMasterBuilderState({resetCatalog:true});
      releaseMobileInteraction();

      V14.activeBinderId=binder.id;
      V14.favoritesOnly=false;
      V14.viewScope='all';
      currentPage=1;
      try{activeStatusFilter='all'}catch{}
      await db.from('pokemon_settings').update({current_binder_id:binder.id}).eq('user_id',currentUser.id);
      await loadCardsV14(false);
      const createdPending=collection.filter(x=>x.binder_id===binder.id&&x.price_pending);
      kickPriceWorkerNow();
      setTimeout(kickPriceWorkerNow,2500);
      if(createdPending.length)watchVisiblePriceBatch(createdPending,{resume:true}).catch(()=>{});
      V14.masterPriceRequestedAt=null;

      releaseMobileInteraction();
      setTimeout(releaseMobileInteraction,180);
      setTimeout(releaseMobileInteraction,650);
      queueBackgroundPrices(createdPending,{front:true});

      const ownedCount=rows.filter(x=>x.collection_status==='owned').length;
      const setText=previews.length>1?' · '+previews.length+' Master Sets':'';
      toast('Fichário criado: '+rows.length+' entradas · '+ownedCount+' Tenho'+setText+'.');
    }catch(e){
      console.error(e);
      if(createdBinder?.id){
        try{await db.from('pokemon_binders').delete().eq('id',createdBinder.id).eq('user_id',currentUser.id)}catch{}
      }
      toast('Erro ao criar Master Set: '+(e.message||e));
    }finally{
      V14.masterPriceRequestedAt=null;
      busy(btn,false);
      releaseMobileInteraction();
    }
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
    const pending=V14.allCards.filter(c=>!!c.price_pending);
    if(pending.length)setTimeout(()=>queueBackgroundPrices(pending),60);
    const unresolved=V14.allCards.filter(card=>{
      const hasPrice=Number(card.price_min||card.price_avg||card.price_max||card.myp_price_min||card.myp_price_avg||card.myp_price_max||card.liga_price_min||card.liga_price_avg||card.liga_price_max||0)>0;
      return !hasPrice&&!card.price_pending&&!card.price_processing_at;
    });
    if(unresolved.length){
      const now=new Date().toISOString();
      for(let i=0;i<unresolved.length;i+=150){
        const ids=unresolved.slice(i,i+150).map(x=>x.id);
        db.from('pokemon_cards').update({price_pending:true,price_processing_at:null,price_requested_at:now,price_next_retry_at:now,price_attempts:0,price_priority:20})
          .eq('user_id',currentUser.id).in('id',ids).then(()=>{}).catch(()=>{});
      }
      unresolved.forEach(card=>{card.price_pending=true;card.price_processing_at=null;card.price_next_retry_at=now;card.price_attempts=0;card.price_priority=20});
      setTimeout(()=>queueBackgroundPrices(unresolved),120);
    }
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

  function wishlistCardMatch(card){
    const wishlist=wishlistBinder();if(!wishlist||!card)return null;
    const key=canonicalCardIdentityKey(card);
    return V14.allCards.find(x=>x.binder_id===wishlist.id&&canonicalCardIdentityKey(x)===key)||null;
  }
  function nextWishlistPosition(wishlist){
    const used=new Set(V14.allCards.filter(x=>x.binder_id===wishlist.id).map(x=>(+x.binder_page||1)+':'+(+x.binder_slot||1)));
    const pages=Math.max(1,+wishlist.pages||1);
    for(let page=1;page<=pages;page++)for(let slot=1;slot<=9;slot++)if(!used.has(page+':'+slot))return{page,slot};
    return{page:pages+1,slot:1};
  }
  async function toggleWishlistCard(card){
    if(!card?.id||isWishlistBinder())return;
    const wishlist=wishlistBinder()||await ensureWishlistBinder();
    const existing=wishlistCardMatch(card);
    if(existing){
      const {error}=await db.from('pokemon_cards').delete().eq('id',existing.id).eq('user_id',currentUser.id);
      if(error)return toast('Não consegui remover da Lista de Desejos.');
      V14.allCards=V14.allCards.filter(x=>x.id!==existing.id);collection=physicalCollection();renderAll();
      return toast('Removida da Lista de Desejos.');
    }
    const pos=nextWishlistPosition(wishlist);
    if(pos.page>(+wishlist.pages||1)){
      const {error:pageError}=await db.from('pokemon_binders').update({pages:pos.page,updated_at:new Date().toISOString()}).eq('id',wishlist.id).eq('user_id',currentUser.id);
      if(pageError)return toast('Não consegui ampliar a Lista de Desejos.');
      wishlist.pages=pos.page;
    }
    const payload={...card};delete payload.id;delete payload.created_at;delete payload.updated_at;
    payload.user_id=currentUser.id;payload.binder_id=wishlist.id;payload.binder_page=pos.page;payload.binder_slot=pos.slot;
    payload.collection_status='wanted';payload.quantity=0;payload.price_processing_at=null;
    payload.price_pending=!Number(card.price_min||card.price_avg||card.price_max||0);
    payload.price_requested_at=new Date().toISOString();payload.price_next_retry_at=payload.price_pending?payload.price_requested_at:null;
    payload.price_attempts=0;payload.price_priority=payload.price_pending?5000:0;
    const {data,error}=await db.from('pokemon_cards').insert(payload).select('*').single();
    if(error)return toast('Não consegui adicionar à Lista de Desejos.');
    V14.allCards.push(data);collection=physicalCollection();renderAll();toast('Adicionada à Lista de Desejos.');
  }
  function renderPocketCardV14(card){
    const b=V14.original.renderPocketCard(card);
    const movable=canMove();
    b.draggable=false;
    b.dataset.v14Movable=movable?'1':'0';
    b.classList.toggle('v14-no-drag',!movable);
    b.title=movable?'Arraste para outro bolso. Leve até a borda para trocar de página.':'Para mover cartas, selecione Ordem do fichário.';

    const star=document.createElement('span');
    star.className='v14-favorite-star'+(card.is_favorite?' active':'');
    star.setAttribute('role','button');
    star.setAttribute('tabindex','0');
    star.setAttribute('aria-label',card.is_favorite?'Remover dos favoritos':'Adicionar aos favoritos');
    star.textContent=card.is_favorite?'★':'☆';
    const act=e=>{e.preventDefault();e.stopPropagation();toggleFavoriteCard(card)};
    star.addEventListener('click',act);
    star.addEventListener('pointerdown',e=>e.stopPropagation());
    star.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act(e)}});
    b.appendChild(star);
    if(isWishlistBinder()){
      const ribbon=b.querySelector('.card-status-ribbon');
      if(ribbon){
        ribbon.setAttribute('role','button');
        ribbon.setAttribute('tabindex','0');
        ribbon.title='Escolher fichário e decidir se a carta foi comprada';
        ribbon.setAttribute('aria-label','Mover esta carta da Lista de Desejos para um fichário');
        const openMove=e=>{e.preventDefault();e.stopPropagation();openWishlistTransferV1494(card)};
        ribbon.addEventListener('click',openMove);
        ribbon.addEventListener('pointerdown',e=>e.stopPropagation());
        ribbon.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openMove(e)}});
        ribbon.classList.add('v1497-wishlist-move-ribbon');
      }
    }else{
      const wished=!!wishlistCardMatch(card);
      const wish=document.createElement('span');
      wish.className='v1493-wishlist-dollar'+(wished?' active':'');
      wish.setAttribute('role','button');wish.setAttribute('tabindex','0');
      wish.setAttribute('aria-label',wished?'Remover da Lista de Desejos':'Adicionar à Lista de Desejos');
      wish.title=wished?'Já está na Lista de Desejos · clique para remover':'Adicionar à Lista de Desejos';
      wish.textContent=String.fromCharCode(36);
      const wishAct=e=>{e.preventDefault();e.stopPropagation();toggleWishlistCard(card)};
      wish.addEventListener('click',wishAct);wish.addEventListener('pointerdown',e=>e.stopPropagation());
      wish.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();wishAct(e)}});
      b.appendChild(wish);
    }

    const processingAt=Date.parse(card.price_processing_at||0);
    const hasSavedPrice=Number(card.price_min||card.price_avg||card.price_max||card.myp_price_min||card.myp_price_avg||card.myp_price_max||card.liga_price_min||card.liga_price_avg||card.liga_price_max||0)>0;
    const activelyProcessing=!hasSavedPrice&&!!(processingAt&&processingAt>Date.now()-40_000);
    if(activelyProcessing){
      const tag=document.createElement('span');
      tag.className='v14-price-pending processing';
      tag.textContent='ATUALIZANDO…';
      tag.setAttribute('aria-label','Preço sendo atualizado agora');
      b.appendChild(tag);
    }else if(card.price_pending&&!hasSavedPrice){
      const tag=document.createElement('span');
      tag.className='v14-price-pending queued';
      tag.textContent='NA FILA';
      tag.setAttribute('aria-label','Cotação aguardando processamento automático');
      b.appendChild(tag);
    }else if(!hasSavedPrice&&card.price_last_error){
      const tag=document.createElement('span');
      tag.className='v14-price-unavailable v1494-price-searching';
      tag.textContent='BUSCANDO COTAÇÃO';
      tag.setAttribute('aria-label','Cotação ainda não localizada; o sistema continuará tentando automaticamente');
      b.appendChild(tag);
    }
    return b;
  }

  function customViewPages(){
    const visible=Math.max(1,Math.ceil(orderedViewCards().length/9));
    if(!isGeneral()&&!V14.binderSearchQuery&&binderViewScope()==='all'&&!V14.favoritesOnly){
      return Math.max(currentBinderPages(),visible);
    }
    return visible;
  }
  function resetSpreadV1433(){
    const spread=document.querySelector('#binderStage .binder-spread');
    const cover=spread?.querySelector('.binder-cover');
    const leftWrap=spread?.querySelector('.binder-sheet-wrap:not(.v1433-secondary-sheet)');
    spread?.classList.remove('v1433-two-sheets','v1433-last-single');
    cover?.classList.remove('v1433-cover-hidden');
    leftWrap?.classList.remove('v1433-sheet-left');
    spread?.querySelector('.v1433-secondary-sheet')?.remove();
  }

  function prepareSpreadV1433(pages){
    const spread=document.querySelector('#binderStage .binder-spread');
    const cover=spread?.querySelector('.binder-cover');
    const leftWrap=spread?.querySelector('.binder-sheet-wrap:not(.v1433-secondary-sheet)');
    const leftSheet=byId('binderSheet');
    if(!spread||!cover||!leftWrap||!leftSheet)return{leftSheet,rightSheet:null,double:false};

    const desktop=window.matchMedia?.('(min-width:821px)').matches;
    const afterCover=desktop&&currentPage>=2;
    const double=afterCover&&(currentPage+1)<=pages;
    const lastSingle=afterCover&&!double;

    spread.classList.toggle('v1433-two-sheets',double);
    spread.classList.toggle('v1433-last-single',lastSingle);
    cover.classList.toggle('v1433-cover-hidden',afterCover);
    leftWrap.classList.toggle('v1433-sheet-left',double);

    let rightWrap=spread.querySelector('.v1433-secondary-sheet');
    if(double){
      if(!rightWrap){
        rightWrap=document.createElement('section');
        rightWrap.className='binder-sheet-wrap v1433-secondary-sheet';
        rightWrap.innerHTML='<div class="binder-spine"></div><div id="binderSheetRight" class="binder-sheet"></div><span class="v1433-sheet-page-label"></span>';
        spread.appendChild(rightWrap);
      }
      return{leftSheet,rightSheet:rightWrap.querySelector('#binderSheetRight'),double:true};
    }

    rightWrap?.remove();
    return{leftSheet,rightSheet:null,double:false};
  }

  function renderPhysicalPageV1433(sheet,page){
    if(!sheet)return;
    sheet.dataset.page=String(page);
    sheet.innerHTML='';
    for(let slot=1;slot<=9;slot++){
      const pocket=document.createElement('div');
      pocket.className='binder-pocket';
      pocket.dataset.page=page;
      pocket.dataset.slot=slot;

      const card=getCardAt(page,slot);
      if(card){
        pocket.appendChild(renderPocketCard(card));
      }else{
        const add=document.createElement('button');
        add.className='pocket-empty-btn v1425-slot-add';
        add.type='button';
        add.textContent='＋';
        add.title='Adicionar no bolso '+slot+' da página '+page;
        add.setAttribute('aria-label','Adicionar carta na página '+page+', bolso '+slot);
        add.onclick=()=>openAddForPosition(page,slot);
        pocket.appendChild(add);
      }
      sheet.appendChild(pocket);
    }
  }

  function renderBinderV14(){
    const physicalManual=!V14.binderSearchQuery&&!isGeneral()&&activeSort()==='manual_asc'&&binderViewScope()==='all'&&!V14.favoritesOnly&&!(V14.rarityFilters?.size);

    if(physicalManual){
      const pages=Math.max(1,currentBinderPages());
      currentPage=binderSessionAnchorV14(currentPage,pages);
      const spread=prepareSpreadV1433(pages);
      renderPhysicalPageV1433(spread.leftSheet,currentPage);
      if(spread.double)renderPhysicalPageV1433(spread.rightSheet,currentPage+1);

      const rightLabel=document.querySelector('.v1433-secondary-sheet .v1433-sheet-page-label');
      if(rightLabel)rightLabel.textContent='Página '+(currentPage+1);

      const label=byId('pageLabel');
      if(label){
        label.textContent=spread.double
          ? 'Páginas '+currentPage+'–'+(currentPage+1)+' · '+currentPage+'/'+pages
          : 'Página '+currentPage+' · '+currentPage+'/'+pages;
      }
      byId('prevPage').disabled=currentPage<=1;
      byId('nextPage').disabled=currentPage>=binderLastSessionAnchorV14(pages);
      syncTopbarNavigation();
      requestAnimationFrame(positionUnifiedTopbar);
      return;
    }

    // Virtual/filtered views remain one sheet so their ordering is unambiguous.
    resetSpreadV1433();
    const g=byId('binderSheet');if(!g)return;
    const cards=orderedViewCards(),pages=customViewPages();
    currentPage=Math.min(Math.max(1,currentPage),pages);
    const slice=cards.slice((currentPage-1)*9,currentPage*9);
    g.innerHTML='';
    for(let slot=0;slot<9;slot++){
      const pocket=document.createElement('div');
      pocket.className='binder-pocket v14-ordered-pocket';
      const card=slice[slot];
      if(card)pocket.appendChild(renderPocketCard(card));
      else if(!isGeneral()){
        const add=document.createElement('button');
        add.className='pocket-empty-btn v1425-slot-add';
        add.type='button';
        add.textContent='＋';
        add.title='Adicionar carta neste fichário';
        add.setAttribute('aria-label','Adicionar carta neste fichário');
        add.onclick=()=>openAddForPosition(currentPage);
        pocket.appendChild(add);
      }else{
        const empty=document.createElement('div');
        empty.className='v14-empty-ordered';
        pocket.appendChild(empty);
      }
      g.appendChild(pocket);
    }
    byId('pageLabel').textContent='Página '+currentPage+' · '+currentPage+'/'+pages;
    byId('prevPage').disabled=currentPage<=1;
    byId('nextPage').disabled=currentPage>=pages;
    syncTopbarNavigation();
    requestAnimationFrame(positionUnifiedTopbar);
  }

  function renderPagesGridV14(){
    if(!V14.binderSearchQuery&&!isGeneral()&&activeSort()==='manual_asc'&&binderViewScope()==='all'&&!V14.favoritesOnly)return V14.original.renderPagesGrid();
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
    const oldCollection=collection;
    const raw=physicalCollection();
    const view=isGeneral()?groupedVirtualCards(raw):oldCollection;
    if(isGeneral()){
      collection=view;
      settings.binder_pages=Math.max(1,Math.ceil(view.length/9));
    }
    V14.original.renderSummary();
    collection=oldCollection;
    settings.binder_pages=oldPages;
    if(isGeneral())byId('sumEmpty').textContent='—';

    const scope=summaryValueScope();
    const selected=scope==='owned'?raw.filter(c=>(c.collection_status||'owned')==='owned'):
      scope==='missing'?raw.filter(c=>(c.collection_status||'owned')!=='owned'):raw;
    const value=selected.reduce((sum,c)=>{
      const status=c.collection_status||'owned';
      const units=status==='owned'?Math.max(+c.quantity||1,1):1;
      return sum+priceModeValue(c,currentPriceMode())*units;
    },0);
    const scopeLabel={all:'Todas',owned:'Tenho',missing:'Não tenho'}[scope];
    if(byId('v14ValueScope'))byId('v14ValueScope').value=scope;
    if(byId('v14BinderViewScope'))byId('v14BinderViewScope').value=binderViewScope();
    if(byId('totalValueLabel'))byId('totalValueLabel').textContent='Valor '+priceModeLabel(currentPriceMode())+' · '+scopeLabel;
    if(byId('totalValue'))byId('totalValue').textContent=money(value);
    renderUnpricedAuditV1466();
    renderRarityFilterV1603();
  }

  function setStatusFilterV14(status){
    V14.viewScope='all';
    if(byId('v14BinderViewScope'))byId('v14BinderViewScope').value='all';
    currentPage=1;
    return V14.original.setStatusFilter(status);
  }

  async function moveCardV14(card,page,slot){
    if(!canMove())return toast('Para mover cartas, selecione Ordem do fichário.');
    const binder=activeBinder();
    if(!binder||String(card?.binder_id||'')!==String(binder.id))return toast('Essa carta não pertence ao fichário aberto.');
    page=Math.max(1,+page||1);slot=Math.min(9,Math.max(1,+slot||1));
    try{
      if(page>currentBinderPages()){
        const {error:pageError}=await db.from('pokemon_binders')
          .update({pages:page,updated_at:new Date().toISOString()})
          .eq('id',binder.id).eq('user_id',currentUser.id);
        if(pageError)throw pageError;
        binder.pages=page;
      }
      const {error}=await db.rpc('pokemon_move_card',{p_card_id:card.id,p_target_page:page,p_target_slot:slot});
      if(error)throw error;
      currentPage=binderSessionAnchorV14(page,currentBinderPages());
      await loadCardsV14(false);
      renderAll();
      toast('Carta movida.');
    }catch(e){
      console.error('[Mover carta]',e);
      toast('Não consegui mover a carta.');
    }
  }
  async function contextActionV14(action){
    if(action==='move'&&!canMove()){hideContext();return toast('Para mover cartas, selecione Ordem do fichário.')}
    return V14.original.contextAction(action);
  }
  function openAddV14(page=currentPage,slot=null){
    if(isGeneral())return toast('Escolha um fichário antes de adicionar cartas.');
    return V14.original.openAddForPosition(page,slot);
  }
  async function addPageV14(){
    if(isGeneral())return toast('Escolha um fichário físico para adicionar páginas.');
    const binder=activeBinder();if(!binder)return;
    const next=currentBinderPages()+1;
    try{
      const {error}=await db.from('pokemon_binders')
        .update({pages:next,updated_at:new Date().toISOString()})
        .eq('id',binder.id).eq('user_id',currentUser.id);
      if(error)throw error;
      binder.pages=next;
      settings.binder_pages=next;
      currentPage=binderSessionAnchorV14(next,next);
      renderAll();
      toast('Página '+next+' adicionada.');
    }catch(e){
      console.error('[Adicionar página]',e);
      toast('Não consegui adicionar a página.');
    }
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

  // V15.28: when Add was opened from a specific empty pocket, the first
  // selected card MUST go to that exact pocket. Additional cards continue
  // forward from there, skipping occupied pockets and never jumping back to
  // earlier empty slots.
  function positionsFromClickedPocketV1528(count){
    const wanted=Math.max(1,Number(count)||1);
    const startPage=Math.max(1,Number(pendingPosition?.page)||Number(currentPage)||1);
    const startSlot=Math.min(9,Math.max(1,Number(pendingPosition?.slot)||1));
    const out=[];
    let pages=Math.max(currentBinderPages(),startPage);

    for(let p=startPage;p<=pages&&out.length<wanted;p++){
      const first=p===startPage?startSlot:1;
      for(let s=first;s<=9&&out.length<wanted;s++){
        if(!getCardAt(p,s))out.push({page:p,slot:s});
      }
    }

    while(out.length<wanted){
      pages++;
      for(let s=1;s<=9&&out.length<wanted;s++)out.push({page:pages,slot:s});
    }
    return out;
  }

  async function addSelectedFast(){
    let cards=[];try{cards=[...catalogSelection.entries()]}catch{}
    if(!cards.length)return;
    if(isGeneral())return toast('Escolha um fichário antes de adicionar.');
    for(const [key] of cards){
      const variant=selectionVariantValues(key);
      if(!variant.finish||!variant.condition)return toast('Escolha o acabamento e a condição antes de adicionar.');
    }

    const button=byId('btnAddSelected');
    busy(button,true,'Adicionando…');
    const saved=[];
    try{
      const positions=positionsFromClickedPocketV1528(cards.length);
      const maxPage=Math.max(...positions.map(p=>p.page));
      if(maxPage>currentBinderPages())await updateSettings({binder_pages:maxPage},true);

      for(let i=0;i<cards.length;i++){
        const [key,raw]=cards[i],pos=positions[i],variant=selectionVariantValues(key),card={...raw};
        const wishlistMode=isWishlistBinder();
        const payload=cardPayload(card,{
          page:pos.page,slot:pos.slot,status:wishlistMode?'wanted':'owned',quantity:wishlistMode?0:1,
          condition:variant.condition,finish:variant.finish,finishConfirmed:true,notes:''
        },{});
        payload.user_id=currentUser.id;payload.binder_id=V14.activeBinderId;
        payload.collection_status=wishlistMode?'wanted':'owned';payload.quantity=wishlistMode?0:1;
        payload.price_pending=true;
        payload.price_checked_at=null;
        payload.price_processing_at=null;
        payload.price_requested_at=new Date().toISOString();
        payload.price_next_retry_at=payload.price_requested_at;
        payload.price_attempts=0;
        // Carta adicionada manualmente deve passar na frente de backfills e
        // Master Sets; o usuário acabou de adicioná-la e espera cotação rápida.
        payload.price_priority=5000;
        payload.price_last_error=null;

        // One database row = one physical card in one pocket.
        // Never merge by card_key/condition/finish inside a real binder.
        const {data,error}=await db.from('pokemon_cards').insert(payload).select('*').single();
        if(error)throw error;
        saved.push(data);
      }

      catalogSelection.clear();
      if(byId('addDialog')?.open)byId('addDialog').close();
      currentPage=positions[0]?.page||currentPage;
      busy(button,false);
      await loadCardsV14(false);
      toast(cards.length+' carta'+(cards.length===1?'':'s')+' adicionada'+(cards.length===1?'':'s')+'. Preço atualizando em segundo plano.');
      queueBackgroundPrices(saved);
    }catch(error){
      console.error('[Adicionar cartas]',error);
      toast('Não consegui adicionar todas as cartas: '+(error?.message||'erro no banco'));
      busy(button,false);
    }
  }

  function uniquePriceCards(cards){
    const seen=new Set(),out=[];
    for(const card of cards||[]){
      if(!card?.id||seen.has(card.id))continue;
      seen.add(card.id);out.push(card);
    }
    return out;
  }

  function cardForPrice(card){
    return {
      ...card,
      apiId:card.api_id,api_id:card.api_id,
      name:card.name,number:card.number,setName:card.set_name,setId:card.set_id,
      languageCode:card.language_code,finish:card.finish,condition:card.condition,
      myp_price_link:card.myp_price_link,price_br_link:card.price_br_link,price_link:card.price_link
    };
  }

  function pricePatchFromDual(card,dual){
    const liga=dual?.liga,myp=dual?.myp;
    const hasLiga=!!(liga&&(Number(liga.min)||Number(liga.avg)||Number(liga.max)));
    const hasMyp=!!(myp&&(Number(myp.min)||Number(myp.avg)||Number(myp.max)));
    if(!hasLiga&&!hasMyp)return null;

    const market=hasLiga&&Number(liga.avg)>0?liga:
      hasMyp&&Number(myp.avg)>0?myp:
      hasLiga?liga:myp;
    const source=market===liga?'Liga Pokémon':'MYP Cards';
    const checked=market.checkedAt||new Date().toISOString();
    const patch={
      price_min:+market.min||0,
      price_avg:+market.avg||+market.min||+market.max||0,
      price_max:+market.max||0,currency:'BRL',
      price_source:source,price_link:market.link||'',
      price_br_source:source,price_br_link:market.link||null,
      price_checked_at:checked,
      price_pending:false,price_processing_at:null,price_next_retry_at:null,
      price_priority:0,price_last_error:null
    };
    if(hasLiga)Object.assign(patch,{
      liga_price_min:+liga.min||0,liga_price_avg:+liga.avg||0,liga_price_max:+liga.max||0,
      liga_price_link:liga.link||card.liga_price_link||null,
      liga_price_checked_at:liga.checkedAt||checked
    });
    if(hasMyp)Object.assign(patch,{
      myp_price_min:+myp.min||0,myp_price_avg:+myp.avg||0,myp_price_max:+myp.max||0,
      myp_price_link:myp.link||card.myp_price_link||null,
      myp_price_checked_at:myp.checkedAt||checked
    });
    return patch;
  }

  function priceFailureCode(dual,error){
    return String(dual?.liga?.error||dual?.myp?.error||dual?.error||error?.name||error?.message||'temporary_error');
  }

  function terminalPriceFailure(code){
    return ['variant_not_found','wrong_product','product_not_found','no_price_data'].includes(String(code||''));
  }

  function applyLocalPricePatch(cardId,patch){
    const target=V14.allCards.find(x=>x.id===cardId);if(target)Object.assign(target,patch);
    const visible=collection.find(x=>x.id===cardId);if(visible)Object.assign(visible,patch);
  }

  async function markCardsForPrice(cards,priority=0){
    const list=uniquePriceCards(cards);
    if(!list.length)return [];
    const now=new Date().toISOString();
    const patch={
      price_pending:true,price_processing_at:null,price_requested_at:now,price_next_retry_at:now,
      price_attempts:0,price_priority:priority,price_last_error:null
    };
    for(let i=0;i<list.length;i+=150){
      const ids=list.slice(i,i+150).map(x=>x.id);
      const {error}=await db.from('pokemon_cards').update(patch).eq('user_id',currentUser.id).in('id',ids);
      if(error)throw error;
    }
    for(const card of list){Object.assign(card,patch);applyLocalPricePatch(card.id,patch)}
    return list;
  }

  function queueBackgroundPrices(cards,{front=false}={}){
    const source=uniquePriceCards(cards);
    const mobile=window.matchMedia?.('(max-width:820px)').matches;
    // Filas grandes já são persistentes no Supabase. Não duplicamos centenas
    // de consultas/renders no aparelho; no mobile, todo processamento em lote
    // fica exclusivamente com o worker do servidor.
    if(mobile||source.length>8){
      if(mobile){
        V14.priceQueue.length=0;
        V14.priceJobs.clear();
      }
      return;
    }
    const add=[];
    for(const card of source){
      if(!card?.id||V14.priceJobs.has(card.id)||V14.priceQueue.some(x=>x.id===card.id))continue;
      const retryAt=Date.parse(card.price_next_retry_at||0);
      if(retryAt&&retryAt>Date.now())continue;
      const processingAt=Date.parse(card.price_processing_at||0);
      if(processingAt&&processingAt>Date.now()-5*60_000)continue;
      add.push(card);V14.priceJobs.set(card.id,true);
    }
    V14.priceQueue=front?[...add,...V14.priceQueue]:[...V14.priceQueue,...add];
    while(V14.priceWorkers<2&&V14.priceQueue.length)runPriceWorker();
  }

  async function finishPriceFailure(card,dual,error,attempts){
    const code=priceFailureCode(dual,error);
    const terminal=terminalPriceFailure(code)||attempts>=6;
    const clearIdentity=['wrong_product','product_not_found'].includes(code);
    const patch=terminal?{
      price_pending:false,price_processing_at:null,price_next_retry_at:null,price_priority:0,price_last_error:code,
      ...(clearIdentity?{
        myp_price_min:0,myp_price_avg:0,myp_price_max:0,myp_price_link:null,myp_price_checked_at:null,
        price_min:0,price_avg:0,price_max:0,price_source:'Sem preço BR',price_link:null,
        price_br_source:null,price_br_link:null,price_checked_at:null
      }:{})
    }:{
      price_pending:true,price_processing_at:null,
      price_next_retry_at:new Date(Date.now()+Math.min(30,Math.pow(2,Math.min(attempts,4)))*60_000).toISOString(),
      price_last_error:code
    };
    await db.from('pokemon_cards').update(patch).eq('id',card.id).eq('user_id',currentUser.id);
    applyLocalPricePatch(card.id,patch);
    return {terminal,code};
  }

  async function runPriceWorker(){
    V14.priceWorkers++;
    try{
      while(V14.priceQueue.length){
        const queued=V14.priceQueue.shift();
        const card=V14.allCards.find(x=>x.id===queued.id)||queued;
        let dual=null;
        const attempts=(+card.price_attempts||0)+1;
        try{
          const now=new Date().toISOString();
          await db.from('pokemon_cards').update({
            price_pending:true,price_processing_at:now,price_attempts:attempts,
            price_requested_at:card.price_requested_at||now,price_next_retry_at:now
          }).eq('id',card.id).eq('user_id',currentUser.id);
          Object.assign(card,{price_pending:true,price_processing_at:now,price_attempts:attempts,price_next_retry_at:now});

          dual=await window.queryBothMarketsV122(cardForPrice(card),card.finish||'Normal',card.condition||'Nova');
          const patch=pricePatchFromDual(card,dual);
          if(patch){
            const {error}=await db.from('pokemon_cards').update(patch).eq('id',card.id).eq('user_id',currentUser.id);
            if(error)throw error;
            applyLocalPricePatch(card.id,patch);
          }else{
            await finishPriceFailure(card,dual,null,attempts);
          }
          try{renderBinder();renderSummary()}catch{}
        }catch(e){
          console.warn('[V14 preço em segundo plano]',card.name,e);
          try{await finishPriceFailure(card,dual,e,attempts)}catch{}
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

  function visiblePriceTargetCards(){
    const physical=physicalCollection();
    const visible=orderedViewCards();
    const ids=new Set(
      visible.flatMap(card=>Array.isArray(card?._group_ids)?card._group_ids:[card?.id]).filter(Boolean)
    );
    return uniquePriceCards(physical.filter(card=>ids.has(card.id)));
  }

  function fullPriceTargetCardsV1477(){
    return uniquePriceCards(physicalCollection());
  }

  function unpricedPriceTargetCardsV1477(){
    return uniquePriceCards(physicalCollection().filter(card=>!hasBrazilQuoteV1466(card)));
  }

  function priceScopeCardsV1477(scope){
    if(scope==='all')return fullPriceTargetCardsV1477();
    if(scope==='unpriced')return unpricedPriceTargetCardsV1477();
    return visiblePriceTargetCards();
  }

  function setVisiblePriceButtonState({active=false,total=0,pending=0,label=''}={}){
    const b=byId('v12UpdatePrices');
    const status=byId('v12PriceProgress');
    if(!b)return;
    if(active){
      const done=Math.max(0,total-pending);
      b.disabled=true;
      b.classList.add('v1433-price-running');
      b.textContent=label||('↻ ATUALIZANDO PREÇOS… '+done+'/'+total);
      if(status)status.textContent=pending
        ? pending+' de '+total+' carta(s) ainda estão sendo atualizadas.'
        : total+' carta(s) concluída(s).';
    }else{
      b.disabled=false;
      b.classList.remove('v1433-price-running');
      b.textContent='↻ Atualizar cotações';
    }
  }

  async function watchVisiblePriceBatch(cards,{resume=false}={}){
    const ids=uniquePriceCards(cards).map(c=>c.id).filter(Boolean);
    if(!ids.length){setVisiblePriceButtonState({active:false});return}

    if(V14.bulkPriceWatch)V14.bulkPriceWatch.cancelled=true;
    const watch={ids,total:ids.length,cancelled:false,promise:null};
    V14.bulkPriceWatch=watch;
    setVisiblePriceButtonState({active:true,total:watch.total,pending:watch.total});

    watch.promise=(async()=>{
      const started=Date.now();
      while(!watch.cancelled&&Date.now()-started<8*60_000){
        const {data,error}=await db.from('pokemon_cards')
          .select('id,price_pending,price_processing_at,price_min,price_avg,price_max,price_source,price_link,price_br_source,price_br_link,myp_price_min,myp_price_avg,myp_price_max,myp_price_link,myp_price_checked_at,price_checked_at,price_last_error')
          .eq('user_id',currentUser.id)
          .in('id',ids);

        if(!error&&Array.isArray(data)){
          for(const row of data)applyLocalPricePatch(row.id,row);
          const pending=data.filter(row=>row.price_pending).length;
          setVisiblePriceButtonState({active:pending>0,total:watch.total,pending});
          try{renderBinder();renderSummary()}catch{}
          if(!pending)return;
        }
        await sleep(2200);
      }
    })();

    try{await watch.promise}
    finally{
      if(V14.bulkPriceWatch===watch)V14.bulkPriceWatch=null;
      setVisiblePriceButtonState({active:false});
    }
  }

  let v1514StatusPollTimer=0;
  function startGlobalPriceStatusPollV1514(){
    if(v1514StatusPollTimer)return;
    const tick=async()=>{
      if(!currentUser){v1514StatusPollTimer=setTimeout(tick,2500);return}
      try{
        const visible=visiblePriceTargetCards().filter(c=>c.price_pending||c.price_processing_at);
        const ids=visible.map(c=>c.id).filter(Boolean);
        if(ids.length){
          const {data}=await db.from('pokemon_cards')
            .select('id,price_pending,price_processing_at,price_min,price_avg,price_max,price_source,price_link,price_br_source,price_br_link,myp_price_min,myp_price_avg,myp_price_max,myp_price_link,myp_price_checked_at,price_checked_at,price_last_error,price_attempts')
            .eq('user_id',currentUser.id)
            .in('id',ids);
          if(Array.isArray(data)){
            data.forEach(row=>applyLocalPricePatch(row.id,row));
            try{renderBinder();renderSummary()}catch{}
          }
        }
      }catch(e){console.warn('[Price status poll]',e)}
      v1514StatusPollTimer=setTimeout(tick,1800);
    };
    v1514StatusPollTimer=setTimeout(tick,400);
  }

  function resumeVisiblePriceWatch(){
    if(V14.bulkPriceWatch)return;
    const pending=visiblePriceTargetCards().filter(c=>!!c.price_pending);
    if(pending.length)setTimeout(()=>watchVisiblePriceBatch(pending,{resume:true}),0);
    else setVisiblePriceButtonState({active:false});
  }

  function ensurePriceScopeDialogV1477(){
    let d=byId('v1477PriceScopeDialog');
    if(d)return d;
    d=document.createElement('dialog');
    d.id='v1477PriceScopeDialog';
    d.className='v1477-price-scope-dialog';
    d.innerHTML=`<div class="v1477-price-scope-shell">
      <div class="v1477-price-scope-head">
        <div><p class="kicker">ATUALIZAR COTAÇÕES</p><h2>O que você quer atualizar?</h2><p class="muted">Escolha exatamente quais cartas entram na fila.</p></div>
        <button id="v1477PriceScopeClose" class="icon-only" type="button" aria-label="Fechar">×</button>
      </div>
      <div class="v1477-price-scope-options">
        <button type="button" data-price-scope="all">
          <span class="v1477-price-scope-icon">▦</span>
          <span><strong>Coleção inteira</strong><small>Todas as cartas deste fichário, ignorando filtros e pesquisa.</small></span>
          <b data-price-count="all">0</b>
        </button>
        <button type="button" data-price-scope="visible">
          <span class="v1477-price-scope-icon">◉</span>
          <span><strong>Apenas cartas visíveis no momento</strong><small>Respeita os filtros e a pesquisa que estão ativos agora.</small></span>
          <b data-price-count="visible">0</b>
        </button>
        <button type="button" data-price-scope="unpriced">
          <span class="v1477-price-scope-icon">!</span>
          <span><strong>Apenas cartas sem cotação</strong><small>Somente cartas sem nenhum valor brasileiro salvo.</small></span>
          <b data-price-count="unpriced">0</b>
        </button>
      </div>
    </div>`;
    document.body.appendChild(d);
    byId('v1477PriceScopeClose').onclick=()=>d.close();
    d.addEventListener('click',e=>{if(e.target===d)d.close()});
    d.querySelectorAll('[data-price-scope]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const scope=btn.dataset.priceScope||'visible';
        d.close();
        updatePriceScopeV1477(scope);
      });
    });
    return d;
  }

  function openPriceScopeDialogV1477(){
    if(V14.bulkPriceWatch)return toast('Já existe uma atualização de preços em andamento.');
    const d=ensurePriceScopeDialogV1477();
    for(const scope of ['all','visible','unpriced']){
      const count=priceScopeCardsV1477(scope).length;
      const el=d.querySelector('[data-price-count="'+scope+'"]');
      if(el)el.textContent=String(count);
      const btn=d.querySelector('[data-price-scope="'+scope+'"]');
      if(btn)btn.disabled=count===0;
    }
    if(!d.open)d.showModal();
  }

  async function updatePriceScopeV1477(scope='visible'){
    const cards=priceScopeCardsV1477(scope);
    const labels={
      all:'coleção inteira',
      visible:'cartas visíveis',
      unpriced:'cartas sem cotação'
    };
    if(!cards.length)return toast('Nenhuma '+(labels[scope]||'carta')+' para atualizar.');
    if(V14.bulkPriceWatch)return toast('Já existe uma atualização de preços em andamento.');

    const status=byId('v12PriceProgress');
    setVisiblePriceButtonState({
      active:true,total:cards.length,pending:cards.length,
      label:'↻ PREPARANDO '+cards.length+' CARTA'+(cards.length===1?'':'S')+'…'
    });
    try{
      const priority=scope==='unpriced'?200:scope==='visible'?100:50;
      await markCardsForPrice(cards,priority);
      queueBackgroundPrices(cards,{front:scope!=='all'});
      kickPriceWorkerNow();
      setTimeout(kickPriceWorkerNow,1200);
      if(status)status.textContent=cards.length+' carta(s) de '+(labels[scope]||'seleção')+' foram colocadas na fila.';
      try{renderBinder();renderSummary()}catch{}
      watchVisiblePriceBatch(cards);
    }catch(error){
      console.error('[Atualizar cotações '+scope+']',error);
      setVisiblePriceButtonState({active:false});
      toast('Não consegui iniciar esta atualização.');
    }
  }

  V14.updateVisiblePrices=()=>updatePriceScopeV1477('visible');
  V14.updatePriceScope=updatePriceScopeV1477;

  function rewireFilteredPriceButton(){
    const old=byId('v12UpdatePrices');
    if(old){old.hidden=true;old.style.display='none'}
  }

  function manualMoneyV1469(value){
    const raw=String(value||'').trim().replace(/R\$/gi,'').replace(/\s/g,'');
    if(!raw)return 0;
    let normalized=raw;
    if(raw.includes(','))normalized=raw.replace(/\./g,'').replace(',','.');
    const n=Number(normalized);
    return Number.isFinite(n)&&n>=0?n:0;
  }

  function ensureManualPriceDialogV1469(){
    let d=byId('v1469ManualPriceDialog');
    if(d)return d;
    d=document.createElement('dialog');
    d.id='v1469ManualPriceDialog';
    d.className='v1469-manual-price-dialog';
    d.innerHTML=`<div class="dialog-shell narrow v1469-manual-price-shell">
      <div class="dialog-head">
        <div><p class="kicker">COTAÇÃO MANUAL</p><h2 id="v1469ManualPriceTitle">Editar cotação</h2><p class="muted compact-copy">Use somente quando quiser substituir manualmente a cotação automática desta carta.</p></div>
        <button id="v1469ManualPriceClose" class="icon-only" type="button">×</button>
      </div>
      <div class="v1469-manual-price-grid">
        <label>Mínimo (R$)<input id="v1469ManualMin" inputmode="decimal" placeholder="0,00"></label>
        <label>Médio (R$)<input id="v1469ManualAvg" inputmode="decimal" placeholder="0,00"></label>
        <label>Máximo (R$)<input id="v1469ManualMax" inputmode="decimal" placeholder="0,00"></label>
      </div>
      <label>Link MYP Cards<input id="v1469ManualLink" type="url" placeholder="https://mypcards.com/pokemon/produto/..."></label>
      <div class="v1509-link-fetch-row">
        <button id="v1509FetchMypLink" class="btn btn-secondary" type="button">↻ Puxar valores deste link</button>
        <small id="v1509FetchMypStatus" class="muted">Cole o link exato da carta na MYP.</small>
      </div>
      <div class="dialog-actions">
        <button id="v1469ManualCancel" class="btn btn-secondary" type="button">Cancelar</button>
        <button id="v1469ManualSave" class="btn btn-primary" type="button">Salvar cotação manual</button>
      </div>
    </div>`;
    document.body.appendChild(d);
    byId('v1469ManualPriceClose').onclick=()=>d.close();
    byId('v1469ManualCancel').onclick=()=>d.close();
    byId('v1469ManualSave').onclick=saveManualPriceV1469;
    byId('v1509FetchMypLink').onclick=fetchManualMypLinkV1509;
    byId('v1469ManualLink').addEventListener('paste',()=>{
      const s=byId('v1509FetchMypStatus');
      if(s)s.textContent='Link colado. Clique em “Puxar valores deste link”.';
    });
    return d;
  }

  function ensureManualPriceButtonV1469(){
    const auto=byId('btnUpdateCardPrice');
    if(!auto||byId('btnManualCardPrice'))return;
    const b=document.createElement('button');
    b.id='btnManualCardPrice';
    b.type='button';
    b.className='btn btn-secondary v1469-manual-price-button hidden';
    b.textContent='✎ Editar cotação manualmente';
    b.onclick=openManualPriceV1469;
    auto.insertAdjacentElement('afterend',b);
  }

  function openManualPriceV1469(){
    const card=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null;
    if(!card)return toast('Abra uma carta já salva para editar a cotação.');
    const d=ensureManualPriceDialogV1469();
    byId('v1469ManualPriceTitle').textContent='Cotação manual · '+(card.name||'Carta');
    const current={
      min:Number(card.myp_price_min||card.price_min||0),
      avg:Number(card.myp_price_avg||card.price_avg||0),
      max:Number(card.myp_price_max||card.price_max||0)
    };
    byId('v1469ManualMin').value=current.min?String(current.min).replace('.',','):'';
    byId('v1469ManualAvg').value=current.avg?String(current.avg).replace('.',','):'';
    byId('v1469ManualMax').value=current.max?String(current.max).replace('.',','):'';
    byId('v1469ManualLink').value=card.myp_price_link||(/mypcards\.com/i.test(String(card.price_link||''))?card.price_link:'')||'';
    if(!d.open)d.showModal();
  }

  async function fetchManualMypLinkV1509(){
    const card=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null;
    if(!card)return toast('Abra uma carta já salva para consultar o link.');
    const link=String(byId('v1469ManualLink')?.value||'').trim();
    if(!/^https?:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\//i.test(link)){
      return toast('Cole um link de produto válido da MYP Cards.');
    }

    const button=byId('v1509FetchMypLink');
    const status=byId('v1509FetchMypStatus');
    busy(button,true,'Consultando link…');
    if(status)status.textContent='Lendo a página exata da MYP…';

    const params=new URLSearchParams({
      name:String(card.name||''),
      number:String(card.number||''),
      set:String(card.set_name||''),
      setId:String(card.set_id||''),
      apiId:String(card.api_id||''),
      lang:String(card.language_code||'pt-br'),
      finish:String(card.finish||'Normal'),
      condition:String(card.condition||'Nova'),
      link,
      directBrowser:'1'
    });

    try{
      let response=await fetch('/api/mypcards-public?'+params.toString(),{cache:'no-store'});
      let data=await response.json().catch(()=>({}));
      let hasPrice=Number(data?.min||0)>0||Number(data?.avg||0)>0||Number(data?.max||0)>0;

      // Se a variante específica não estiver rotulada na MYP, consulte a mesma
      // página como impressão Normal. O produto continua sendo exatamente o link
      // informado pelo usuário.
      if(!hasPrice&&String(card.finish||'Normal').toLowerCase()!=='normal'){
        params.set('finish','Normal');
        response=await fetch('/api/mypcards-public?'+params.toString(),{cache:'no-store'});
        data=await response.json().catch(()=>({}));
        hasPrice=Number(data?.min||0)>0||Number(data?.avg||0)>0||Number(data?.max||0)>0;
      }

      if(!response.ok||!hasPrice){
        if(status)status.textContent='Não consegui ler valores desse link agora.';
        return toast('O link é válido, mas a MYP não devolveu uma cotação legível agora.');
      }

      const min=Number(data.min||0),avg=Number(data.avg||0),max=Number(data.max||0);
      byId('v1469ManualMin').value=min?String(min).replace('.',','):'';
      byId('v1469ManualAvg').value=avg?String(avg).replace('.',','):'';
      byId('v1469ManualMax').value=max?String(max).replace('.',','):'';
      byId('v1469ManualLink').value=data.link||link;

      if(status){
        const parts=[min&&('mín. '+money(min)),avg&&('méd. '+money(avg)),max&&('máx. '+money(max))].filter(Boolean);
        status.textContent='Cotação encontrada: '+parts.join(' · ');
      }
      toast('Valores carregados diretamente da MYP.');
    }catch(error){
      console.error('[MYP link manual]',error);
      if(status)status.textContent='Falha ao consultar o link.';
      toast('Não consegui consultar esse link da MYP agora.');
    }finally{
      busy(button,false);
    }
  }

  async function saveManualPriceV1469(){
    const card=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null;
    if(!card)return;
    const min=manualMoneyV1469(byId('v1469ManualMin')?.value);
    const avg=manualMoneyV1469(byId('v1469ManualAvg')?.value);
    const max=manualMoneyV1469(byId('v1469ManualMax')?.value);
    const link=String(byId('v1469ManualLink')?.value||'').trim();
    if(!(min||avg||max))return toast('Informe pelo menos um valor para a cotação manual.');
    if(link&&!/^https?:\/\/(?:www\.)?mypcards\.com\/pokemon\/produto\/\d+\//i.test(link)){
      return toast('O link informado não é uma página de produto da MYP Cards.');
    }

    const b=byId('v1469ManualSave');
    busy(b,true,'Salvando…');
    const now=new Date().toISOString();
    const finalLink=link||card.myp_price_link||null;
    const patch={
      myp_price_min:min,myp_price_avg:avg,myp_price_max:max,myp_price_link:finalLink,myp_price_checked_at:now,
      price_min:min,price_avg:avg,price_max:max,price_source:'MYP Cards · manual',price_link:finalLink,
      price_br_source:'MYP Cards · manual',price_br_link:finalLink,price_checked_at:now,
      price_pending:false,price_processing_at:null,price_next_retry_at:null,price_priority:0,price_attempts:0,price_last_error:null
    };
    try{
      const {error}=await db.from('pokemon_cards').update(patch).eq('id',card.id).eq('user_id',currentUser.id);
      if(error)throw error;
      if(V14.singlePriceWatch?.cardId===card.id)V14.singlePriceWatch.cancelled=true;
      applyLocalPricePatch(card.id,patch);
      selectedMarket={source:'MYP Cards · manual',min,avg,max,link:finalLink,checkedAt:now};
      setPrices(min,avg,max);
      if(byId('marketStatus'))byId('marketStatus').textContent='Cotação manual · salvo agora';
      if(finalLink&&byId('mypcardsLink')){
        byId('mypcardsLink').href=finalLink;
        byId('mypcardsLink').classList.remove('hidden');
      }
      ensureManualPriceDialogV1469().close();
      renderUnpricedAuditV1466();
      if(byId('v1468UnpricedDialog')?.open)renderUnpricedPopupV1468();
      try{renderBinder();renderSummary()}catch{}
      toast('Cotação manual salva.');
    }catch(error){
      console.error('[Cotação manual]',error);
      toast('Não consegui salvar a cotação manual.');
    }finally{
      busy(b,false);
    }
  }

  function syncSingleCardPriceButton(){
    const b=byId('btnUpdateCardPrice');if(!b)return;
    ensureManualPriceButtonV1469();
    const card=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null;
    const visible=!!card;
    const watching=!!(V14.singlePriceWatch&&V14.singlePriceWatch.cardId===editingCardId);
    b.classList.toggle('hidden',!visible);
    b.disabled=!visible||watching;
    const manual=byId('btnManualCardPrice');
    if(manual){
      manual.classList.toggle('hidden',!visible);
      manual.disabled=!visible;
    }
    if(watching)b.textContent=V14.singlePriceWatch.label||'Atualizando preço…';
    else if(visible&&card.price_pending&&Number(card.price_priority||0)>=1000){
      setTimeout(()=>resumeSinglePriceWatch(card),0);
    }
  }

  function setSinglePriceWatchLabel(label){
    const watch=V14.singlePriceWatch;
    if(!watch)return;
    watch.label=label;
    const b=byId('btnUpdateCardPrice');
    if(b&&editingCardId===watch.cardId){
      b.disabled=true;
      b.textContent=label;
    }
    if(byId('marketStatus')&&editingCardId===watch.cardId)byId('marketStatus').textContent=label;
  }

  function kickPriceWorkerNow(){
    try{
      const task=db.functions?.invoke?.('pokemon-price-worker',{body:{reason:'manual-single-card'}});
      if(task?.catch)task.catch(e=>console.warn('[V14 worker kick]',e));
    }catch(e){console.warn('[V14 worker kick]',e)}
  }

  function priceRowHasFreshResult(row,requestedAt){
    const checked=Date.parse(row?.price_checked_at||row?.myp_price_checked_at||0);
    const requested=Date.parse(requestedAt||0);
    const hasPrice=Number(row?.price_min||0)>0||Number(row?.price_avg||0)>0||Number(row?.price_max||0)>0;
    return hasPrice&&checked>=requested-1000&&row?.price_pending===false;
  }

  function renderFreshSinglePrice(cardId,row){
    applyLocalPricePatch(cardId,row);
    if(editingCardId===cardId){
      setPrices(row.price_min,row.price_avg,row.price_max);
      selectedMarket={
        source:row.price_source||row.price_br_source||'MYP Cards',
        min:Number(row.price_min||0),avg:Number(row.price_avg||0),max:Number(row.price_max||0),
        link:row.myp_price_link||row.price_br_link||row.price_link||'',
        checkedAt:row.price_checked_at||row.myp_price_checked_at||null
      };
      if(byId('marketStatus'))byId('marketStatus').textContent=(row.price_source||row.price_br_source||'Mercado BR')+' · atualizado agora';
      const link=selectedMarket.link;
      if(link&&byId('mypcardsLink')){
        byId('mypcardsLink').href=link;
        byId('mypcardsLink').classList.remove('hidden');
      }
    }
    try{renderBinder();renderSummary()}catch{}
  }

  async function waitForSinglePrice(card,requestedAt,{resume=false}={}){
    const cardId=card.id;
    if(V14.singlePriceWatch?.cardId===cardId)return V14.singlePriceWatch.promise;
    if(V14.singlePriceWatch)V14.singlePriceWatch.cancelled=true;

    const watch={cardId,requestedAt,cancelled:false,label:'Atualizando preço…',promise:null};
    V14.singlePriceWatch=watch;
    syncSingleCardPriceButton();

    watch.promise=(async()=>{
      const started=Date.now();
      let lastKick=0;
      let consecutiveErrors=0;
      while(!watch.cancelled&&Date.now()-started<5*60_000){
        if(Date.now()-lastKick>25_000){
          kickPriceWorkerNow();
          lastKick=Date.now();
        }

        const {data,error}=await db.from('pokemon_cards')
          .select('id,price_min,price_avg,price_max,currency,price_source,price_link,price_br_source,price_br_link,liga_price_min,liga_price_avg,liga_price_max,liga_price_link,liga_price_checked_at,myp_price_min,myp_price_avg,myp_price_max,myp_price_link,myp_price_checked_at,price_checked_at,price_pending,price_processing_at,price_requested_at,price_next_retry_at,price_attempts,price_priority,price_last_error')
          .eq('id',cardId).eq('user_id',currentUser.id).maybeSingle();

        if(error){
          consecutiveErrors++;
          if(consecutiveErrors>=3)setSinglePriceWatchLabel('Reconectando ao preço…');
        }else if(!data){
          setSinglePriceWatchLabel('Carta não encontrada.');
          return{state:'missing'};
        }else{
          consecutiveErrors=0;
          applyLocalPricePatch(cardId,data);
          if(priceRowHasFreshResult(data,requestedAt)){
            renderFreshSinglePrice(cardId,data);
            return{state:'updated',data};
          }
          const sameRequest=Date.parse(data.price_requested_at||0)>=Date.parse(requestedAt||0)-1000;
          if(sameRequest&&data.price_pending===false&&data.price_last_error){
            setSinglePriceWatchLabel('Sem cotação disponível');
            return{state:'unavailable',data};
          }
          const processingAge=Date.now()-Date.parse(data.price_processing_at||0);
          setSinglePriceWatchLabel(data.price_processing_at&&processingAge<35_000?'Atualizando no servidor…':'Na fila…');
        }

        const elapsed=Date.now()-started;
        await sleep(elapsed<35_000?1200:3000);
      }
      return{state:'timeout'};
    })();

    try{
      const result=await watch.promise;
      if(result.state==='updated')toast(resume?'Preço atualizado automaticamente.':'Preço desta carta atualizado.');
      else if(result.state==='unavailable')toast('O servidor concluiu, mas não encontrou cotação compatível.');
      else if(result.state==='timeout')toast('O servidor ainda está tentando. O preço aparecerá automaticamente quando concluir.');
      return result;
    }finally{
      if(V14.singlePriceWatch===watch)V14.singlePriceWatch=null;
      const b=byId('btnUpdateCardPrice');
      if(b&&editingCardId===cardId){
        b.textContent=b.dataset.old||'↻ Atualizar preço desta carta';
        b.disabled=false;
      }
      syncSingleCardPriceButton();
    }
  }

  function resumeSinglePriceWatch(card){
    if(!card?.id||V14.singlePriceWatch?.cardId===card.id)return;
    const requestedAt=card.price_requested_at||new Date().toISOString();
    waitForSinglePrice(card,requestedAt,{resume:true}).catch(e=>console.warn('[V14 resume price watch]',e));
  }

  async function querySingleCardPriceFast(card){
    const finish=card.finish||'Normal',condition=card.condition||'Nova';
    const p=new URLSearchParams({
      name:String(card.market_name_pt||card.name_pt||card.name||''),
      number:String(card.number||''),
      set:String(card.set_name||''),
      setId:String(card.set_id||''),
      lang:String(card.language_code||''),
      finish,condition,
      fast:'1',
      _:String(Date.now())
    });
    const link=[card.myp_price_link,card.price_br_link,card.price_link].find(v=>/mypcards\.com/i.test(String(v||'')));
    if(link)p.set('link',link);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),11000);
    try{
      const r=await fetch('/api/mypcards-public?'+p.toString(),{cache:'no-store',signal:controller.signal});
      const j=await r.json();
      if(!j?.ok)return{
        source:'Sem preço BR',min:0,avg:0,max:0,link:j?.link||'',
        checkedAt:new Date().toISOString(),
        myp:{source:'MYP Cards',failed:true,error:j?.error||'fast_unavailable',message:j?.message||'',link:j?.link||''}
      };
      const myp={
        source:'MYP Cards',failed:false,provider:j.provider||'Fast Reader',
        min:Number(j.min||0),avg:Number(j.avg||0),max:Number(j.max||0),
        link:j.link||'',checkedAt:j.checkedAt||new Date().toISOString(),
        samples:j.samples??null,availableQuantity:j.availableQuantity??null,
        exactVariant:j.exactVariant!==false,complete:j.complete===true
      };
      return{source:'MYP Cards',min:myp.min,avg:myp.avg,max:myp.max,link:myp.link,checkedAt:myp.checkedAt,myp,finish,condition};
    }finally{clearTimeout(timer)}
  }

  async function updateEditingCardPriceNow(){
    const card=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null;
    if(!card)return toast('Abra uma carta já salva para atualizar o preço.');
    if(V14.singlePriceWatch?.cardId===card.id)return;
    const b=byId('btnUpdateCardPrice');
    busy(b,true,'Atualizando preço…');
    let dual=null;
    const requestedAt=new Date().toISOString();
    try{
      // A atualização manual recebe prioridade máxima. Se a consulta rápida
      // não resolver, o botão continua ocupado enquanto observamos a mesma
      // linha no Supabase até o worker gravar o preço.
      const pending={
        price_pending:true,price_processing_at:null,price_requested_at:requestedAt,price_next_retry_at:requestedAt,
        price_attempts:0,price_priority:1000,price_last_error:null
      };
      const {error:pendingError}=await db.from('pokemon_cards').update(pending).eq('id',card.id).eq('user_id',currentUser.id);
      if(pendingError)throw pendingError;
      Object.assign(card,pending);
      applyLocalPricePatch(card.id,pending);

      dual=await querySingleCardPriceFast(card);
      const patch=pricePatchFromDual(card,dual);
      if(patch){
        Object.assign(patch,{
          price_pending:true,price_processing_at:null,price_requested_at:requestedAt,
          price_next_retry_at:new Date().toISOString(),price_attempts:0,price_priority:1000,
          price_last_error:null
        });
        const {error}=await db.from('pokemon_cards').update(patch).eq('id',card.id).eq('user_id',currentUser.id);
        if(error)throw error;
        applyLocalPricePatch(card.id,patch);
        setPrices(patch.price_min,patch.price_avg,patch.price_max);
        setSinglePriceWatchLabel('MYP encontrada · conferindo Liga…');
        kickPriceWorkerNow();
        await waitForSinglePrice(card,requestedAt);
        return;
      }

      const code=dual?.myp?.error||'fast_unavailable';
      const keepQueued={
        price_pending:true,price_processing_at:null,price_requested_at:requestedAt,
        price_next_retry_at:new Date().toISOString(),price_attempts:0,
        price_priority:1000,price_last_error:code
      };
      const {error:queueError}=await db.from('pokemon_cards').update(keepQueued).eq('id',card.id).eq('user_id',currentUser.id);
      if(queueError)throw queueError;
      applyLocalPricePatch(card.id,keepQueued);
      setSinglePriceWatchLabel('Aguardando servidor…');
      kickPriceWorkerNow();
      await waitForSinglePrice(card,requestedAt);
    }catch(e){
      console.error(e);
      const keepQueued={
        price_pending:true,price_processing_at:null,price_requested_at:requestedAt,
        price_next_retry_at:new Date().toISOString(),price_priority:1000,
        price_last_error:e?.name==='AbortError'?'fast_timeout':String(e?.message||'fast_error')
      };
      try{
        await db.from('pokemon_cards').update(keepQueued).eq('id',card.id).eq('user_id',currentUser.id);
        applyLocalPricePatch(card.id,keepQueued);
        kickPriceWorkerNow();
        await waitForSinglePrice(card,requestedAt);
      }catch(watchError){
        console.warn('[V14 manual price watch]',watchError);
        toast('Não consegui acompanhar a atualização agora, mas ela continua no servidor.');
      }
    }finally{
      if(!V14.singlePriceWatch||V14.singlePriceWatch.cardId!==card.id){
        busy(b,false);
        syncSingleCardPriceButton();
      }
    }
  }

  async function saveSelectedCardV14(){
    if(!selectedCard)return;
    const existingEditing=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null;
    const binderId=existingEditing?.binder_id||(isGeneral()?null:V14.activeBinderId);
    if(!binderId)return toast('Escolha um fichário antes de salvar.');

    const button=byId('btnSaveCard');
    const page=Math.max(1,+byId('cardPage').value||1);
    const slot=Math.min(9,Math.max(1,+byId('cardSlot').value||1));
    const condition=byId('cardCondition').value;
    const finish=byId('cardFinish').value;
    const quantity=selectedStatus==='owned'?1:0;

    // The pocket is physical. Another row cannot be silently replaced.
    const occupant=V14.allCards.find(c=>c.binder_id===binderId&&+c.binder_page===page&&+c.binder_slot===slot&&c.id!==editingCardId);
    if(occupant)return toast('Esse bolso já tem uma carta. Mova a carta ou escolha outro bolso.');

    busy(button,true,'Salvando…');
    try{
      if(page>currentBinderPages())await updateSettings({binder_pages:page},true);
      const payload=cardPayload(selectedCard,{
        page,slot,status:selectedStatus,quantity,condition,finish,
        notes:byId('cardNotes').value.trim()
      },selectedMarket||{});
      payload.binder_id=binderId;
      payload.quantity=quantity;

      if(editingCardId){
        // Editing means this exact physical copy only.
        if(existingEditing?.card_key)payload.card_key=existingEditing.card_key;
        const {error}=await db.from('pokemon_cards')
          .update(payload)
          .eq('id',editingCardId)
          .eq('user_id',currentUser.id);
        if(error)throw error;
      }else{
        // New physical copy: always INSERT, even if the exact same card already exists.
        payload.user_id=currentUser.id;
        const {error}=await db.from('pokemon_cards').insert(payload);
        if(error)throw error;
      }

      closeDialog('cardDialog');
      editingCardId=null;
      await loadCardsV14(false);
      toast('Carta salva.');
    }catch(error){
      console.error('[Salvar carta]',error);
      toast('Erro ao salvar: '+(error?.message||'tente novamente'));
    }finally{
      busy(button,false);
    }
  }

  async function japaneseImageFallback(card){
    if(!card||card.imageUrl||card.languageCode!=='ja')return card?.imageUrl||'';
    const key=[card.apiId,card.setId||card.set_id,card.number,card.name].join('|');
    if(V14.jpImageCache.has(key))return V14.jpImageCache.get(key);

    // Fonte prioritária: site oficial japonês, usando coleção + número exatos.
    const setId=card.setId||card.set_id||'';
    const local=String(card.number||'').match(/\d+/)?.[0]||'';
    if(setId&&local){
      const p=new URLSearchParams({set:setId,localId:local,name:card.name||'',hp:String(card.hp||''),rarity:card.rarity||''});
      const exact='/api/jp-card-image?'+p.toString();
      V14.jpImageCache.set(key,exact);
      return exact;
    }

    // Último fallback: só aceita imagem equivalente com score seguro.
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
  function imageFingerprint(source){
    const c=document.createElement('canvas');c.width=12;c.height=17;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(source,0,0,c.width,c.height);
    const d=ctx.getImageData(0,0,c.width,c.height).data,values=[];
    for(let i=0;i<d.length;i+=4)values.push(.299*d[i]+.587*d[i+1]+.114*d[i+2]);
    const mean=values.reduce((s,v)=>s+v,0)/Math.max(1,values.length);
    const variance=values.reduce((s,v)=>s+(v-mean)*(v-mean),0)/Math.max(1,values.length);
    const sd=Math.max(12,Math.sqrt(variance));
    return values.map(v=>(v-mean)/sd);
  }
  function fingerprintDistance(a,b){
    if(!a||!b||a.length!==b.length)return Number.POSITIVE_INFINITY;
    let sum=0;
    for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);
    return sum/a.length;
  }
  function cropRectCanvas(src,x0,y0,x1,y1,width=360){
    const sw=src.videoWidth||src.naturalWidth||src.width,sh=src.videoHeight||src.naturalHeight||src.height;
    if(!sw||!sh)return null;
    const sx=Math.max(0,Math.round(sw*x0)),sy=Math.max(0,Math.round(sh*y0));
    const cw=Math.max(1,Math.min(sw-sx,Math.round(sw*(x1-x0))));
    const ch=Math.max(1,Math.min(sh-sy,Math.round(sh*(y1-y0))));
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=Math.max(1,Math.round(width*(ch/cw)));
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(src,sx,sy,cw,ch,0,0,canvas.width,canvas.height);
    return canvas;
  }
  function scannerVisualCanvases(source){
    const sw=source.videoWidth||source.naturalWidth||source.width,sh=source.videoHeight||source.naturalHeight||source.height;
    if(!sw||!sh)return[];
    const ratio=63/88,out=[],seen=new Set();

    const add=(heightFrac,cx=.5,cy=.5,angle=0)=>{
      let ch=sh*heightFrac,cw=ch*ratio;
      if(cw>sw*.96){cw=sw*.96;ch=cw/ratio}
      const sx=Math.max(0,Math.min(sw-cw,sw*cx-cw/2));
      const sy=Math.max(0,Math.min(sh-ch,sh*cy-ch/2));
      const key=[Math.round(sx),Math.round(sy),Math.round(cw),Math.round(ch),angle].join('|');
      if(seen.has(key))return;seen.add(key);

      const canvas=document.createElement('canvas');
      canvas.width=252;canvas.height=352;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.save();
      ctx.translate(canvas.width/2,canvas.height/2);
      ctx.rotate(angle*Math.PI/180);
      const scale=Math.abs(angle)>0?.94:1;
      ctx.scale(scale,scale);
      ctx.drawImage(source,sx,sy,cw,ch,-canvas.width/2,-canvas.height/2,canvas.width,canvas.height);
      ctx.restore();
      out.push(canvas);
    };

    [0.72,0.80,0.88,0.94].forEach(h=>{
      [[.50,.50],[.47,.50],[.53,.50],[.50,.47],[.50,.53]].forEach(([cx,cy])=>add(h,cx,cy,0));
    });
    [-6,-3,3,6].forEach(a=>add(.84,.5,.5,a));
    const legacy=scannerCardCanvas(source);if(legacy)out.unshift(legacy);
    return out.slice(0,25);
  }

  function normalizedGrayPatch(source,x0,y0,x1,y1,w,h){
    const crop=cropRectCanvas(source,x0,y0,x1,y1,w);
    if(!crop)return null;
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(crop,0,0,w,h);
    const d=ctx.getImageData(0,0,w,h).data,v=[];
    for(let i=0;i<d.length;i+=4)v.push((.299*d[i]+.587*d[i+1]+.114*d[i+2])/255);
    const mean=v.reduce((a,b)=>a+b,0)/Math.max(1,v.length);
    const variance=v.reduce((a,b)=>a+(b-mean)*(b-mean),0)/Math.max(1,v.length);
    const sd=Math.max(.045,Math.sqrt(variance));
    return{v:v.map(x=>Math.max(-3,Math.min(3,(x-mean)/sd))),w,h};
  }

  function dHashPatch(source,x0,y0,x1,y1,w,h){
    const crop=cropRectCanvas(source,x0,y0,x1,y1,w+1);
    if(!crop)return null;
    const c=document.createElement('canvas');c.width=w+1;c.height=h;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(crop,0,0,w+1,h);
    const d=ctx.getImageData(0,0,w+1,h).data,g=[];
    for(let i=0;i<d.length;i+=4)g.push(.299*d[i]+.587*d[i+1]+.114*d[i+2]);
    const out=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)out.push(g[y*(w+1)+x+1]>=g[y*(w+1)+x]?1:0);
    return out;
  }

  function colorHistogram(source,x0=.03,y0=.04,x1=.97,y1=.88){
    const crop=cropRectCanvas(source,x0,y0,x1,y1,28);
    if(!crop)return null;
    const c=document.createElement('canvas');c.width=28;c.height=28;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(crop,0,0,28,28);
    const d=ctx.getImageData(0,0,28,28).data,hist=new Array(16).fill(0);
    let total=0;
    for(let i=0;i<d.length;i+=4){
      const r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
      const sat=max?delta/max:0;
      if(sat<.16){
        hist[12+Math.min(3,Math.floor(max*4))]++;total++;continue;
      }
      let hue=0;
      if(delta){
        if(max===r)hue=((g-b)/delta)%6;
        else if(max===g)hue=(b-r)/delta+2;
        else hue=(r-g)/delta+4;
        hue=(hue*60+360)%360;
      }
      hist[Math.min(11,Math.floor(hue/30))]++;total++;
    }
    return hist.map(x=>x/Math.max(1,total));
  }

  function edgeDescriptor(source,x0=0,y0=0,x1=1,y1=1){
    const cols=20,rows=28,crop=cropRectCanvas(source,x0,y0,x1,y1,cols);
    if(!crop)return null;
    const c=document.createElement('canvas');c.width=cols;c.height=rows;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(crop,0,0,cols,rows);
    const d=ctx.getImageData(0,0,cols,rows).data,g=[];
    for(let i=0;i<d.length;i+=4)g.push(.299*d[i]+.587*d[i+1]+.114*d[i+2]);
    const out=[];
    for(let y=1;y<rows-1;y++)for(let x=1;x<cols-1;x++){
      const gx=g[y*cols+x+1]-g[y*cols+x-1],gy=g[(y+1)*cols+x]-g[(y-1)*cols+x];
      const mag=Math.hypot(gx,gy);
      if(mag<18){out.push(8);continue}
      const a=(Math.atan2(gy,gx)+Math.PI)/(2*Math.PI);
      out.push(Math.min(7,Math.floor(a*8)));
    }
    return out;
  }

  function visualDescriptor(source){
    return{
      art:normalizedGrayPatch(source,.055,.10,.945,.61,28,17),
      center:normalizedGrayPatch(source,.08,.18,.92,.82,24,24),
      full:normalizedGrayPatch(source,.035,.035,.965,.965,22,31),
      artHash:dHashPatch(source,.05,.10,.95,.61,20,12),
      fullHash:dHashPatch(source,.04,.04,.96,.96,16,22),
      color:colorHistogram(source),
      edge:edgeDescriptor(source,.04,.05,.96,.90)
    };
  }

  function shiftedCorrelationDistance(a,b,maxShift=1){
    if(!a?.v||!b?.v||a.w!==b.w||a.h!==b.h)return Number.POSITIVE_INFINITY;
    let best=Number.POSITIVE_INFINITY;
    for(let dy=-maxShift;dy<=maxShift;dy++)for(let dx=-maxShift;dx<=maxShift;dx++){
      let dot=0,aa=0,bb=0,n=0;
      for(let y=0;y<a.h;y++){
        const by=y+dy;if(by<0||by>=b.h)continue;
        for(let x=0;x<a.w;x++){
          const bx=x+dx;if(bx<0||bx>=b.w)continue;
          const av=a.v[y*a.w+x],bv=b.v[by*b.w+bx];
          dot+=av*bv;aa+=av*av;bb+=bv*bv;n++;
        }
      }
      if(n<Math.min(a.v.length,b.v.length)*.70)continue;
      const corr=(aa&&bb)?dot/Math.sqrt(aa*bb):0;
      const dist=(1-Math.max(-1,Math.min(1,corr)))/2;
      if(dist<best)best=dist;
    }
    return best;
  }

  function binaryDistance(a,b){
    if(!a||!b||a.length!==b.length)return Number.POSITIVE_INFINITY;
    let diff=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])diff++;
    return diff/a.length;
  }

  function histogramDistance(a,b){
    if(!a||!b||a.length!==b.length)return Number.POSITIVE_INFINITY;
    let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);
    return sum/2;
  }

  function categoricalDistance(a,b){
    if(!a||!b||a.length!==b.length)return Number.POSITIVE_INFINITY;
    let diff=0,valid=0;
    for(let i=0;i<a.length;i++){
      if(a[i]===8&&b[i]===8)continue;
      valid++;if(a[i]!==b[i])diff++;
    }
    return valid?diff/valid:1;
  }

  function visualDescriptorDistance(a,b){
    if(!a||!b)return Number.POSITIVE_INFINITY;
    const parts=[
      [shiftedCorrelationDistance(a.art,b.art,2),.36],
      [shiftedCorrelationDistance(a.center,b.center,2),.21],
      [shiftedCorrelationDistance(a.full,b.full,1),.16],
      [binaryDistance(a.artHash,b.artHash),.10],
      [binaryDistance(a.fullHash,b.fullHash),.06],
      [histogramDistance(a.color,b.color),.07],
      [categoricalDistance(a.edge,b.edge),.04]
    ];
    let sum=0,weight=0;
    for(const [d,w] of parts){if(Number.isFinite(d)){sum+=d*w;weight+=w}}
    return weight?sum/weight:Number.POSITIVE_INFINITY;
  }

  function bestVisualDistance(reference,targets){
    if(!reference||!targets?.length)return Number.POSITIVE_INFINITY;
    let best=Number.POSITIVE_INFINITY;
    for(const target of targets){
      const d=visualDescriptorDistance(reference,target);
      if(d<best)best=d;
    }
    return best;
  }

  async function descriptorForCard(card){
    let url=cardImage(card);
    if(!url)return null;
    const cacheKey=url;
    const cached=V14.scan.imageDescriptorCache.get(cacheKey);
    if(cached)return cached;
    const job=(async()=>{
      try{
        if(/assets\.tcgdex\.net/i.test(url))url=url.replace(/\/high\.webp(?:\?.*)?$/i,'/low.webp');
        const requestUrl=url.startsWith('/')?url:'/api/image-proxy?url='+encodeURIComponent(url);
        const r=await fetch(requestUrl,{cache:'force-cache'});
        if(!r.ok)return null;
        const blob=await r.blob(),bitmap=await createImageBitmap(blob);
        const c=document.createElement('canvas');c.width=252;c.height=352;
        c.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,0,0,c.width,c.height);
        bitmap.close?.();
        return visualDescriptor(c);
      }catch(e){
        console.warn('[Scanner imagem candidata]',card?.name,e);
        return null;
      }
    })();
    V14.scan.imageDescriptorCache.set(cacheKey,job);
    const result=await job;
    if(!result)V14.scan.imageDescriptorCache.delete(cacheKey);
    return result;
  }
  function bitsToHex(bits){
    if(!bits?.length)return'';
    let out='';
    for(let i=0;i<bits.length;i+=4){
      let n=0;
      for(let j=0;j<4;j++)n=(n<<1)|(bits[i+j]?1:0);
      out+=n.toString(16);
    }
    return out;
  }
  function colorFloatsToHex(values){
    if(!values?.length)return'';
    return values.map(v=>Math.max(0,Math.min(255,Math.round(v*255))).toString(16).padStart(2,'0')).join('');
  }
  const NIBBLE_POPCOUNT=[0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
  function hexHamming(a,b){
    if(!a||!b||a.length!==b.length)return Number.POSITIVE_INFINITY;
    let diff=0;
    for(let i=0;i<a.length;i++){
      const x=parseInt(a[i],16)^parseInt(b[i],16);
      diff+=NIBBLE_POPCOUNT[x]||0;
    }
    return diff/(a.length*4);
  }
  function colorHexDistance(a,b){
    if(!a||!b||a.length!==b.length)return Number.POSITIVE_INFINITY;
    let sum=0,n=0;
    for(let i=0;i<a.length;i+=2){
      const x=parseInt(a.slice(i,i+2),16),y=parseInt(b.slice(i,i+2),16);
      if(Number.isFinite(x)&&Number.isFinite(y)){sum+=Math.abs(x-y)/255;n++}
    }
    return n?sum/n:Number.POSITIVE_INFINITY;
  }
  function compactSignature(descriptor){
    if(!descriptor)return null;
    return{
      fh:bitsToHex(descriptor.fullHash),
      ah:bitsToHex(descriptor.artHash),
      ch:colorFloatsToHex(descriptor.color)
    };
  }
  async function loadVisualIndex(status){
    if(V14.scan.visualIndex?.cards?.length)return V14.scan.visualIndex;
    if(V14.scan.visualIndexPromise)return V14.scan.visualIndexPromise;
    V14.scan.visualIndexPromise=(async()=>{
      try{
        if(status)status.textContent='Carregando índice visual das cartas…';
        const r=await fetch('/data/card-visual-index.json?v=1',{cache:'force-cache'});
        if(!r.ok)return null;
        const data=await r.json();
        if(!Array.isArray(data?.cards)||!data.cards.length)return null;
        V14.scan.visualIndex=data;
        return data;
      }catch(e){
        console.warn('[Scanner índice visual]',e);
        return null;
      }finally{
        V14.scan.visualIndexPromise=null;
      }
    })();
    return V14.scan.visualIndexPromise;
  }
  async function visualIndexCandidates(status,limit=100){
    const index=await loadVisualIndex(status);
    if(!index?.cards?.length)return[];
    const targetSigs=(V14.scan.lastVisualDescriptors||[])
      .slice(0,10).map(compactSignature).filter(x=>x?.fh&&x?.ah);
    if(!targetSigs.length)return[];

    const selectedLang=String(byId('searchLanguage')?.value||'all');
    const scored=[];
    for(const row of index.cards){
      if(!Array.isArray(row)||row.length<8)continue;
      const [lang,id,localId,name,image,fh,ah,ch]=row;
      if(selectedLang!=='all'&&selectedLang&&lang!==selectedLang)continue;
      let best=Number.POSITIVE_INFINITY;
      for(const target of targetSigs){
        const art=hexHamming(ah,target.ah),full=hexHamming(fh,target.fh),color=colorHexDistance(ch,target.ch);
        const d=(Number.isFinite(art)?art*.64:0)+(Number.isFinite(full)?full*.27:0)+(Number.isFinite(color)?color*.09:0);
        if(d<best)best=d;
      }
      if(Number.isFinite(best))scored.push({row,d:best});
    }
    scored.sort((a,b)=>a.d-b.d);
    const top=scored.slice(0,Math.max(20,limit));
    if(status)status.textContent='Imagem comparada com '+index.cards.length.toLocaleString('pt-BR')+' impressões. Refinando as mais parecidas…';
    return top.map(({row,d})=>({
      source:'TCGdex Visual',apiId:String(row[1]||''),name:String(row[3]||'Carta'),
      languageCode:String(row[0]||'en'),language:LANG?.[row[0]]||String(row[0]||''),
      setName:'',setId:'',number:String(row[2]||''),printedTotal:'',rarity:'',type:'',
      imageUrl:String(row[4]||''),_scanCoarseDistance:d
    }));
  }
  async function hydrateVisualCandidates(cards){
    return Promise.all((cards||[]).map(async card=>{
      if(card?.source!=='TCGdex Visual')return card;
      const confidence=card._scanVisualConfidence,distance=card._scanVisualDistance,coarse=card._scanCoarseDistance;
      try{
        const full=await fetchTCGdexCard(card.languageCode||'en',card.apiId,card);
        if(full){
          full._scanVisualConfidence=confidence;
          full._scanVisualDistance=distance;
          full._scanCoarseDistance=coarse;
          return full;
        }
      }catch{}
      return card;
    }));
  }
  function scannerNames(hint){
    const items=[hint?.name,...(hint?.nameCandidates||[]).map(x=>x?.value||x)].map(x=>String(x||'').trim()).filter(Boolean);
    return [...new Set(items.map(x=>nrm(x)).filter(Boolean))].map(k=>items.find(x=>nrm(x)===k)).slice(0,5);
  }
  function scannerNumbers(hint){
    const items=[hint?.number,...(hint?.numberCandidates||[]).map(x=>x?.value||x)].map(x=>String(x||'').trim()).filter(Boolean);
    return [...new Set(items)].slice(0,4);
  }
  function scanTextScore(card,hint){
    const names=scannerNames(hint),numbers=scannerNumbers(hint);
    let score=0;
    if(names.length){
      const sim=Math.max(...names.map(name=>nameSimilarity(name,card.name||'')));
      score+=sim*500;
      if(sim>=.96)score+=260;else if(sim>=.84)score+=130;
    }
    if(numbers.length){
      const cn=numParts(card.number),printed=String(card.printedTotal||'');
      let best=0;
      for(const raw of numbers){
        const q=numParts(raw);
        let s=0;
        if(q.n&&cn.n===q.n)s+=520;
        if(q.d&&(q.d===cn.d||q.d===printed))s+=300;
        best=Math.max(best,s);
      }
      score+=best;
    }
    if(card.languageCode==='pt-br')score+=90;else if(card.languageCode==='en')score+=35;
    if(card.imageUrl)score+=20;
    return score;
  }
  async function scanSetCandidates(hint,status){
    const binder=activeBinder();
    const langs=['pt-br','en','ja'];
    let setIds=[];
    if(binder?.set_id)setIds=[binder.set_id];
    const typedSet=String(V14.scan.setHint||byId('searchSet')?.value||'').trim();
    if(!setIds.length&&typedSet&&typeof resolveCatalogSetIds==='function'){
      try{setIds=await resolveCatalogSetIds(langs,typedSet)}catch{}
    }
    if(!setIds.length)return[];
    if(status)status.textContent='Coleção identificada. Montando o banco visual…';
    const groups=[];
    for(const lang of langs){
      for(const setId of setIds.slice(0,3)){
        try{
          const set=await fetchTCGdexSet(lang,setId);
          if(!set)continue;
          for(const card of Array.isArray(set.cards)?set.cards:[])groups.push(mapTCGSetBrief(card,set,lang));
        }catch{}
      }
    }
    const numbers=scannerNumbers(hint);
    if(numbers.length){
      const wanted=new Set(numbers.map(x=>numParts(x).n).filter(Boolean));
      const exact=groups.filter(c=>wanted.has(numParts(c.number).n));
      if(exact.length)return dedupe(exact);
    }
    return dedupe(groups);
  }
  function savedCardAsCandidate(c){
    return{
      source:c.api_source||'Fichário',apiId:c.api_id||c.id,name:c.name||'',languageCode:c.language_code||'',
      language:c.language||'',setName:c.set_name||'',setId:c.set_id||'',number:c.number||'',
      printedTotal:'',rarity:c.rarity||'',type:c.card_type||'',imageUrl:c.image_url||''
    };
  }

  async function scanCandidatePool(hint,status){
    const names=scannerNames(hint),numbers=scannerNumbers(hint),langs=['pt-br','en','ja'];
    const setCards=await scanSetCandidates(hint,status);
    if(setCards.length){
      setCards.sort((a,b)=>scanTextScore(b,hint)-scanTextScore(a,hint));
      return setCards.slice(0,260);
    }

    // A busca visual global roda independentemente de OCR. Isso é o que
    // permite reconhecer a carta mesmo quando nome/número não foram lidos.
    const visualFirstPromise=visualIndexCandidates(status,110).catch(()=>[]);
    const jobs=[];
    for(const lang of langs){
      for(const number of numbers.slice(0,3))jobs.push(searchTCGdex(lang,'',number,{live:false}));
      for(const name of names.slice(0,3))jobs.push(searchTCGdex(lang,name,'',{live:false}));
      if(names[0]&&numbers[0])jobs.push(searchTCGdex(lang,names[0],numbers[0],{live:false}));
    }
    if(names[0]&&typeof searchJapaneseOfficial==='function'){
      jobs.push(searchJapaneseOfficial(names[0],numbers[0]||'',V14.scan.setHint||'',{live:false}));
    }
    if(names[0]&&typeof searchMypCards==='function'){
      jobs.push(searchMypCards(names[0],numbers[0]||'',V14.scan.setHint||'').then(x=>x?.cards||[]).catch(()=>[]));
    }

    const [visualFirst,groups]=await Promise.all([
      visualFirstPromise,
      jobs.length?Promise.all(jobs):Promise.resolve([])
    ]);
    let cards=dedupe([...(visualFirst||[]),...groups.flat().filter(Boolean)]);

    if(!cards.length){
      const fallback=[
        ...(Array.isArray(catalogResults)?catalogResults:[]),
        ...((V14.allCards||[]).map(savedCardAsCandidate))
      ].filter(c=>cardImage(c));
      cards=dedupe(fallback);
    }

    cards.sort((x,y)=>{
      const xd=Number.isFinite(x?._scanCoarseDistance)?x._scanCoarseDistance:null;
      const yd=Number.isFinite(y?._scanCoarseDistance)?y._scanCoarseDistance:null;
      if(xd!=null||yd!=null){
        if(xd==null)return 1;if(yd==null)return-1;
        if(Math.abs(xd-yd)>.006)return xd-yd;
      }
      return scanTextScore(y,hint)-scanTextScore(x,hint);
    });
    return cards.slice(0,280);
  }

  async function visuallyRankCandidates(cards,hint={}){
    const targets=V14.scan.lastVisualDescriptors||[];
    if(!targets.length||!cards?.length)return cards||[];

    const prelim=[...cards].sort((a,b)=>{
      const ad=Number.isFinite(a?._scanCoarseDistance)?a._scanCoarseDistance:null;
      const bd=Number.isFinite(b?._scanCoarseDistance)?b._scanCoarseDistance:null;
      if(ad!=null||bd!=null){
        if(ad==null)return 1;if(bd==null)return-1;
        if(Math.abs(ad-bd)>.006)return ad-bd;
      }
      return scanTextScore(b,hint)-scanTextScore(a,hint);
    });
    const maxVisual=prelim.length>180?120:prelim.length;
    const sample=prelim.slice(0,Math.max(48,maxVisual));
    const scored=[];
    const concurrency=12;

    for(let i=0;i<sample.length;i+=concurrency){
      const batch=sample.slice(i,i+concurrency);
      const rows=await Promise.all(batch.map(async(card,index)=>{
        const descriptor=await descriptorForCard(card);
        const distance=bestVisualDistance(descriptor,targets);
        card._scanVisualDistance=distance;
        return{card,distance,textScore:scanTextScore(card,hint),order:i+index};
      }));
      scored.push(...rows.filter(x=>Number.isFinite(x.distance)));
    }

    scored.sort((a,b)=>{
      const delta=a.distance-b.distance;
      if(Math.abs(delta)>.012)return delta;
      return b.textScore-a.textScore||a.order-b.order;
    });

    const best=scored[0]?.distance,runner=scored[1]?.distance;
    for(const row of scored){
      const absolute=Number.isFinite(row.distance)?Math.max(0,1-row.distance*1.75):0;
      const margin=Number.isFinite(runner)&&row===scored[0]?Math.max(0,Math.min(1,(runner-best)*7)):0;
      row.card._scanVisualConfidence=Math.round(Math.max(0,Math.min(1,absolute*.82+margin*.18))*100);
    }

    const ranked=scored.map(x=>x.card);
    const used=new Set(ranked.map(card=>[card.apiId,card.languageCode,card.setId,card.number].join('|')));
    return ranked.concat(cards.filter(card=>!used.has([card.apiId,card.languageCode,card.setId,card.number].join('|'))));
  }
  function cleanTitleLine(v){
    let s=cleanOCRLine(v)
      .replace(/\b(b[aá]sico|basic|stage\s*\d*|est[aá]gio\s*\d*)\b/ig,' ')
      .replace(/\b(?:hp|ps)\s*\d{1,4}\b/ig,' ')
      .replace(/\b\d{2,4}\s*(?:hp|ps)\b/ig,' ')
      .replace(/\s+/g,' ').trim();
    s=s.replace(/^[^\p{L}]+|[^\p{L}\p{N}.'\- ]+$/gu,'').trim();
    return s;
  }
  function parseScannerOCR(nameTexts,numberTexts){
    const names=[];
    for(const t of nameTexts||[]){
      const lines=String(t||'').split(/\n+/).map(cleanTitleLine).filter(Boolean);
      for(let line of lines.slice(0,10)){
        if(line.length<3||line.length>28)continue;
        if(/\b(habilidade|ability|energia|energy|fraqueza|weakness|resist|recuo|retreat)\b/i.test(line))continue;
        if((line.match(/\d/g)||[]).length>2)continue;
        if(/[A-Za-zÀ-ÿ]{3}/.test(line))names.push(line);
      }
    }
    const allNumbers=(numberTexts||[]).join('\n'),numbers=[];
    for(const m of allNumbers.matchAll(/(\d{1,4})\s*[\/|Iil]\s*(\d{1,4})/g)){
      const a=+m[1],b=+m[2];if(a>0&&b>0&&a<=9999&&b<=9999)numbers.push(a+'/'+b);
    }
    const count=a=>{const m=new Map();for(const x of a){const k=nrm(x);if(!k)continue;const old=m.get(k)||{value:x,count:0};old.count++;if(x.length<old.value.length+8)old.value=x;m.set(k,old)}return [...m.values()].sort((a,b)=>b.count-a.count||a.value.length-b.value.length)};
    return{nameCandidates:count(names).slice(0,8),numberCandidates:count(numbers).slice(0,5)};
  }
  async function recognizeRegion(region,lang='por+eng'){
    try{
      const r=await window.Tesseract.recognize(region,lang);
      return r?.data?.text||'';
    }catch{return''}
  }
  async function ocrCard(source,status){
    const full=scannerCardCanvas(source);
    V14.scan.lastFingerprint=imageFingerprint(full);
    const frameVisual=scannerVisualCanvases(source).map(visualDescriptor).filter(Boolean);
    V14.scan.visualFrameCount=(V14.scan.visualFrameCount||0)+1;
    V14.scan.lastVisualDescriptors=[...frameVisual,...(V14.scan.lastVisualDescriptors||[])].slice(0,48);

    if(activeBinder()?.set_id){
      if(status)status.textContent='Imagem capturada. Comparando com as artes da coleção…';
      return{nameCandidates:[],numberCandidates:[]};
    }

    if(typeof ensureOCR!=='function'||!await ensureOCR())return{nameCandidates:[],numberCandidates:[]};

    const thresholdRegion=(canvas,cut)=>{
      if(!canvas)return canvas;
      const ctx=canvas.getContext('2d',{willReadFrequently:true}),im=ctx.getImageData(0,0,canvas.width,canvas.height),d=im.data;
      for(let i=0;i<d.length;i+=4){
        const g=.299*d[i]+.587*d[i+1]+.114*d[i+2],v=g>cut?255:0;
        d[i]=d[i+1]=d[i+2]=v;
      }
      ctx.putImageData(im,0,0);
      return canvas;
    };

    const bottomThreshold=thresholdRegion(cropRectCanvas(full,.02,.76,.98,.998,760),146);
    if(status)status.textContent='Lendo só o número para reduzir o banco visual…';
    let numberTexts=[await recognizeRegion(bottomThreshold,'eng')];
    let parsed=parseScannerOCR([],numberTexts);
    if(parsed.numberCandidates.length)return parsed;

    const bottomRaw=cropRectCanvas(full,.02,.74,.98,.998,760);
    numberTexts.push(await recognizeRegion(bottomRaw,'eng'));
    parsed=parseScannerOCR([],numberTexts);
    if(parsed.numberCandidates.length)return parsed;

    if(status)status.textContent='Número não legível. Tentando o nome como pista…';
    const titleThreshold=thresholdRegion(cropRectCanvas(full,.025,.0,.975,.205,760),142);
    const titleRaw=cropRectCanvas(full,.025,.0,.975,.205,760);
    const nameTexts=[await recognizeRegion(titleThreshold),await recognizeRegion(titleRaw)];
    parsed=parseScannerOCR(nameTexts,numberTexts);

    if(!parsed.nameCandidates.length){
      const fallback=parseOCRTexts([...nameTexts,...numberTexts]);
      parsed.nameCandidates=fallback.nameCandidates||[];
      if(!parsed.numberCandidates.length)parsed.numberCandidates=fallback.numberCandidates||[];
    }
    return parsed;
  }
  function evidenceBest(map){
    return [...map.entries()].sort((a,b)=>b[1].count-a[1].count||b[1].value.length-a[1].value.length)[0]?.[1]||null;
  }
  function mergeEvidence(hint){
    for(const x of hint.nameCandidates||[]){const k=nrm(x.value),old=V14.scan.evidenceNames.get(k)||{value:x.value,count:0};old.count+=x.count;V14.scan.evidenceNames.set(k,old)}
    for(const x of hint.numberCandidates||[]){const k=x.value,old=V14.scan.evidenceNumbers.get(k)||{value:x.value,count:0};old.count+=x.count;V14.scan.evidenceNumbers.set(k,old)}
    const nameCandidates=[...V14.scan.evidenceNames.values()].sort((a,b)=>b.count-a.count||a.value.length-b.value.length).slice(0,8);
    const numberCandidates=[...V14.scan.evidenceNumbers.values()].sort((a,b)=>b.count-a.count).slice(0,5);
    return{name:nameCandidates[0]?.value||'',number:numberCandidates[0]?.value||'',nameCandidates,numberCandidates};
  }
  async function showScanCandidates(hint){
    stopScanner();
    if(byId('scanDialog')?.open)byId('scanDialog').close();

    const saved=V14.scan.pendingPosition;
    openAddForPosition(saved?.page||currentPage,saved?.slot||null);
    if(byId('searchLanguage'))byId('searchLanguage').value='all';
    if(byId('searchName'))byId('searchName').value=hint.name||'';
    if(byId('searchNumber'))byId('searchNumber').value=hint.number||'';
    if(byId('searchSet')&&V14.scan.setHint)byId('searchSet').value=V14.scan.setHint;
    const status=byId('ocrStatus');
    if(status)status.textContent='Foto capturada · preparando comparação visual…';

    let best=await scanCandidatePool(hint,status);
    if(!best.length&&(hint.name||hint.number)){
      await searchCards({live:false});
      best=[...catalogResults].slice(0,80);
    }
    if(!best.length){
      if(status)status.textContent='Não consegui montar candidatos suficientes. Em fichário de coleção a comparação é 100% visual; em fichário livre deixe o número inferior visível.';
      return;
    }

    if(status)status.textContent='Comparando sua foto com '+best.length+' imagens do banco…';
    best=(await visuallyRankCandidates(best,hint)).filter(c=>Number.isFinite(c._scanVisualDistance)).slice(0,8);
    best=await hydrateVisualCandidates(best);
    if(!best.length){
      if(status)status.textContent='As imagens candidatas não puderam ser comparadas agora. Tente novamente.';
      return;
    }
    catalogResults=[...best];
    populateRarityFilter();renderCatalog();

    const dlg=byId('v14ScanCandidates'),grid=byId('v14ScanCandidateGrid');
    byId('v14ScanReadout').textContent='Resultado ordenado pela imagem da carta'+((hint.name||hint.number)?' · texto usado somente para montar o banco de candidatos':' · banco visual local')+'.';
    grid.innerHTML=best.map((card,i)=>{
      const img=cardImage(card),distance=card._scanVisualDistance,confidence=card._scanVisualConfidence;
      const visual=Number.isFinite(confidence)?'<small>Confiança visual '+confidence+'%</small>':(Number.isFinite(distance)?'<small>Comparação visual concluída</small>':'');
      return '<button type="button" class="catalog-card" data-scan-index="'+i+'">'+(img?'<img src="'+esc(img)+'" alt="'+esc(card.name)+'">':'')+'<strong>'+esc(card.name)+'</strong><small>'+esc(card.setName||'')+' · '+esc(card.number||'')+'</small>'+visual+'</button>';
    }).join('');
    grid.querySelectorAll('[data-scan-index]').forEach(b=>b.onclick=()=>{
      const card=best[+b.dataset.scanIndex],key=cardKey(card);
      catalogSelection.clear();catalogSelection.set(key,card);updateSelectionTray();
      if(dlg.open)dlg.close();
      if(byId('addDialog')&&!byId('addDialog').open)byId('addDialog').showModal();
      setTimeout(()=>{try{const target=[...document.querySelectorAll('#resultsList .catalog-card')].find(x=>x.textContent.includes(card.name));target?.scrollIntoView({block:'center'})}catch{}},80);
    });
    if(dlg&&!dlg.open)dlg.showModal();
  }
  async function scanLiveTick(){
    if(!V14.scan.stream||V14.scan.busy)return;
    const video=byId('scanVideo'),status=byId('scanLiveStatus');
    if(!video?.videoWidth){V14.scan.timer=setTimeout(scanLiveTick,500);return}
    V14.scan.busy=true;
    try{
      const raw=await ocrCard(video,status);
      const hint=mergeEvidence(raw);
      const num=evidenceBest(V14.scan.evidenceNumbers),name=evidenceBest(V14.scan.evidenceNames);
      const hasSetBank=!!activeBinder()?.set_id;
      if(status)status.textContent=hasSetBank?'Imagem pronta · iniciando comparação visual…':'Pista: '+([hint.number,hint.name].filter(Boolean).join(' · ')||'procurando…');
      if((hasSetBank&&V14.scan.visualFrameCount>=2)||num||(name&&name.value.length>=4)||V14.scan.visualFrameCount>=3){
        await showScanCandidates(hint);return;
      }
    }catch(e){console.warn('[Scanner V14]',e);if(status)status.textContent='Ajuste distância, foco e reflexo — tentando novamente…'}
    finally{
      V14.scan.busy=false;
      if(V14.scan.stream)V14.scan.timer=setTimeout(scanLiveTick,900);
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
    V14.scan.pendingPosition=pendingPosition?{...pendingPosition}:{page:currentPage,slot:null};
    V14.scan.setHint=String(byId('searchSet')?.value||'').trim();
    stopScanner();V14.scan.evidenceNames.clear();V14.scan.evidenceNumbers.clear();V14.scan.lastFingerprint=null;V14.scan.lastVisualDescriptors=[];V14.scan.visualFrameCount=0;
    if(byId('addDialog')?.open)byId('addDialog').close();
    if(!byId('scanDialog')?.open)byId('scanDialog').showModal();
    const status=byId('scanLiveStatus');if(status)status.textContent='Abrindo câmera traseira…';
    try{
      V14.scan.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:2560},focusMode:{ideal:'continuous'}},audio:false});
      const v=byId('scanVideo');v.srcObject=V14.scan.stream;await v.play();
      if(status)status.textContent=activeBinder()?.set_id?'Mantenha a carta inteira na moldura · comparação visual com a coleção':'Mantenha a carta inteira na moldura · o número reduz o banco, a imagem decide';
      V14.scan.timer=setTimeout(scanLiveTick,350);
    }catch(e){console.error(e);if(status)status.textContent='Não consegui abrir a câmera. Verifique a permissão.'}
  }
  async function analyzePhoto(file){
    if(!file)return;
    V14.scan.pendingPosition=pendingPosition?{...pendingPosition}:{page:currentPage,slot:null};
    V14.scan.setHint=String(byId('searchSet')?.value||'').trim();
    V14.scan.lastVisualDescriptors=[];V14.scan.visualFrameCount=0;
    const status=byId('ocrStatus');if(status)status.textContent='Preparando comparação visual…';
    let url='';
    try{
      const img=new Image();url=URL.createObjectURL(file);
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});
      const hint=await ocrCard(img,status);
      const merged={
        name:hint.nameCandidates?.[0]?.value||'',
        number:hint.numberCandidates?.[0]?.value||'',
        nameCandidates:hint.nameCandidates||[],
        numberCandidates:hint.numberCandidates||[]
      };
      await showScanCandidates(merged);
    }catch(e){console.error(e);if(status)status.textContent='Não consegui analisar a foto. Tente outra imagem.'}
    finally{if(url)URL.revokeObjectURL(url)}
  }

  function enhanceSelectionTrayV1493(){
    const tray=document.querySelector('#addDialog .selection-tray'),box=byId('v122FinishBox');
    if(!tray||!box)return;
    if(!box.dataset.v1493){box.dataset.v1493='1';box.classList.add('v1493-collapsed')}
    const title=box.querySelector('.v122-finish-title');
    if(title&&!title.querySelector('.v1493-selection-toggle')){
      const toggle=document.createElement('button');toggle.type='button';toggle.className='v1493-selection-toggle';
      toggle.setAttribute('aria-label','Abrir ou minimizar cartas selecionadas');
      toggle.innerHTML='<span>Ver seleção</span><b>⌃</b>';
      toggle.onclick=e=>{e.preventDefault();e.stopPropagation();box.classList.toggle('v1493-collapsed');toggle.querySelector('span').textContent=box.classList.contains('v1493-collapsed')?'Ver seleção':'Minimizar'};
      title.appendChild(toggle);
    }
  }
  function wireSelectionTrayV1493(){
    const tray=document.querySelector('#addDialog .selection-tray');if(!tray||tray.dataset.v1493)return;
    tray.dataset.v1493='1';new MutationObserver(()=>setTimeout(enhanceSelectionTrayV1493,0)).observe(tray,{childList:true,subtree:true});
    setTimeout(enhanceSelectionTrayV1493,0);
  }
  function nextPositionForBinderV1494(binder){
    const used=new Set(V14.allCards.filter(x=>x.binder_id===binder.id).map(x=>(+x.binder_page||1)+':'+(+x.binder_slot||1)));
    const pages=Math.max(1,+binder.pages||1);
    for(let page=1;page<=pages;page++)for(let slot=1;slot<=9;slot++)if(!used.has(page+':'+slot))return{page,slot};
    return{page:pages+1,slot:1};
  }
  function syncWishlistTransferButtonV1494(){
    const btn=byId('v1494WishlistTransfer');if(!btn)return;
    const card=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null,wishlist=wishlistBinder();
    btn.classList.toggle('hidden',!(card&&wishlist&&card.binder_id===wishlist.id));
  }
  function ensureWishlistTransferUIV1494(){
    const actions=document.querySelector('#cardDialog .v1417-card-actions');
    if(actions&&!byId('v1494WishlistTransfer')){
      const btn=document.createElement('button');btn.id='v1494WishlistTransfer';btn.type='button';
      btn.className='btn btn-secondary v1494-wishlist-transfer hidden';btn.textContent='↗ Colocar em outro fichário';btn.onclick=openWishlistTransferV1494;actions.prepend(btn);
    }
    if(!byId('v1494WishlistMoveDialog')){
      const d=document.createElement('dialog');d.id='v1494WishlistMoveDialog';d.className='sheet-dialog v1494-wishlist-move-dialog';
      d.innerHTML='<div class="dialog-shell narrow v1494-wishlist-move-shell">'+
        '<div class="dialog-head"><div><p class="kicker">LISTA DE DESEJOS</p><h2>Colocar carta em um fichário</h2><p class="muted compact-copy">Escolha para onde esta carta deve ir e se ela continua na Lista de Desejos.</p></div><button id="v1494WishlistMoveClose" class="icon-only" type="button">×</button></div>'+
        '<label class="v1494-target-label">Fichário de destino<select id="v1494WishlistTarget"></select></label>'+
        '<div class="v1494-wishlist-choice"><button id="v1494WishlistBought" type="button"><strong>✓ Remover da Lista de Desejos — comprei</strong><span>Entra no fichário escolhido como Tenho e sai da Lista de Desejos.</span></button>'+
        '<button id="v1494WishlistKeep" type="button"><strong>&#36; Colocar sem remover da Lista de Desejos</strong><span>Não foi comprada: entra no fichário escolhido como Não tenho e continua também na Lista de Desejos.</span></button></div></div>';
      document.body.appendChild(d);byId('v1494WishlistMoveClose').onclick=()=>d.close();
      d.addEventListener('click',e=>{if(e.target===d)d.close()});
      byId('v1494WishlistBought').onclick=()=>applyWishlistTransferV1494(true);byId('v1494WishlistKeep').onclick=()=>applyWishlistTransferV1494(false);
    }
  }
  function openWishlistTransferV1494(cardArg=null){
    ensureWishlistTransferUIV1494();
    const card=cardArg||(editingCardId?V14.allCards.find(x=>x.id===editingCardId):null),wishlist=wishlistBinder();
    if(!card||!wishlist||card.binder_id!==wishlist.id)return;
    const targets=V14.binders.filter(b=>b.id!==wishlist.id),select=byId('v1494WishlistTarget');
    select.innerHTML=targets.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+(b.binder_kind==='set'?' · Master Set':'')+'</option>').join('');
    if(!targets.length)return toast('Crie outro fichário antes de mover esta carta.');
    const d=byId('v1494WishlistMoveDialog');d.dataset.cardId=card.id;d.showModal();
  }
  async function applyWishlistTransferV1494(bought){
    const d=byId('v1494WishlistMoveDialog'),card=V14.allCards.find(x=>x.id===d?.dataset?.cardId);
    const target=V14.binders.find(b=>b.id===byId('v1494WishlistTarget')?.value),wishlist=wishlistBinder();
    if(!card||!target||!wishlist)return;
    const clicked=bought?byId('v1494WishlistBought'):byId('v1494WishlistKeep');busy(clicked,true,bought?'Marcando como comprada…':'Adicionando…');
    try{
      const key=canonicalCardIdentityKey(card),existing=V14.allCards.find(x=>x.binder_id===target.id&&canonicalCardIdentityKey(x)===key);
      if(existing){
        if(bought){
          const {error}=await db.from('pokemon_cards').update({collection_status:'owned',quantity:Math.max(1,+existing.quantity||1),updated_at:new Date().toISOString()}).eq('id',existing.id).eq('user_id',currentUser.id);
          if(error)throw error;
        }
      }else{
        const pos=nextPositionForBinderV1494(target);
        if(pos.page>(+target.pages||1)){
          const {error:pageError}=await db.from('pokemon_binders').update({pages:pos.page,updated_at:new Date().toISOString()}).eq('id',target.id).eq('user_id',currentUser.id);
          if(pageError)throw pageError;target.pages=pos.page;
        }
        const payload={...card};delete payload.id;delete payload.created_at;delete payload.updated_at;
        payload.user_id=currentUser.id;payload.binder_id=target.id;payload.binder_page=pos.page;payload.binder_slot=pos.slot;
        payload.collection_status=bought?'owned':'missing';payload.quantity=bought?1:0;payload.price_processing_at=null;
        payload.price_pending=!Number(card.price_min||card.price_avg||card.price_max||0);payload.price_requested_at=new Date().toISOString();
        payload.price_next_retry_at=payload.price_pending?payload.price_requested_at:null;payload.price_attempts=0;payload.price_priority=payload.price_pending?30:0;
        const {error}=await db.from('pokemon_cards').insert(payload);if(error)throw error;
      }
      if(bought){const {error}=await db.from('pokemon_cards').delete().eq('id',card.id).eq('user_id',currentUser.id);if(error)throw error}
      d.close();closeDialog('cardDialog');editingCardId=null;await loadCardsV14(false);
      toast(bought?'Carta comprada: movida para o fichário e removida da Lista de Desejos.':'Carta colocada no fichário e mantida na Lista de Desejos.');
    }catch(error){console.error('[Lista de Desejos → fichário]',error);toast('Não consegui concluir a movimentação: '+(error?.message||'erro no banco'))}
    finally{busy(clicked,false)}
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
      loadCards,updateSettings,applySettings,renderBinder,renderSummary,renderPagesGrid,renderPocketCard,moveCard,contextAction,openAddForPosition,addPage,saveSelectedCard,setStatusFilter
    };
    loadCards=loadCardsV14;
    updateSettings=updateSettingsV14;
    applySettings=applySettingsV14;
    renderBinder=renderBinderV14;
    renderSummary=renderSummaryV14;
    renderPagesGrid=renderPagesGridV14;
    renderPocketCard=renderPocketCardV14;
    setStatusFilter=setStatusFilterV14;
    moveCard=moveCardV14;
    contextAction=contextActionV14;
    openAddForPosition=openAddV14;
    addPage=addPageV14;
    saveSelectedCard=saveSelectedCardV14;
    patchCardPayload();
    patchJapaneseImages();
  }

  function mountFriendsSummaryV14(body){
    if(!body)return;
    body.classList.add('v1458-friends-body');
    const searchCard=byId('friendSearch')?.closest('.social-card');
    const columns=byId('friendRequests')?.closest('.social-columns');
    const profileCard=byId('profileUsername')?.closest('.social-card');
    // Ordem intencional: buscar primeiro, depois pedidos/amigos, perfil por último.
    [searchCard,columns,profileCard].filter(Boolean).forEach(node=>body.appendChild(node));
  }

  async function refreshFriendsSummaryV14(){
    if(!currentUser)return;
    try{
      if(typeof loadCurrentProfile==='function')await loadCurrentProfile().catch(()=>null);
      await loadFriendships();
    }catch(error){
      console.error('[Amigos resumo]',error);
      toast('Não consegui carregar Amigos agora.');
    }
  }

  function openFriendsSummaryV14(){
    const panel=byId('summaryPanel');
    if(panel&&window.matchMedia('(max-width:820px)').matches)panel.classList.add('mobile-open');
    organizeSummaryActionsV14();
    const details=byId('v1411Group_friends');
    if(!details)return;
    details.parentElement?.querySelectorAll('.v1411-action-group[open]').forEach(other=>{if(other!==details)other.open=false});
    details.open=true;
    closeDialog('friendsDialog');
    refreshFriendsSummaryV14();
    setTimeout(()=>byId('friendSearch')?.focus(),80);
  }
  window.openPokemonFriends=openFriendsSummaryV14;

  function hasBrazilQuoteV1466(card){
    return [
      card?.price_min,card?.price_avg,card?.price_max,
      card?.myp_price_min,card?.myp_price_avg,card?.myp_price_max,
      card?.liga_price_min,card?.liga_price_avg,card?.liga_price_max
    ].some(v=>Number(v||0)>0);
  }

  function priceAuditBinderCardsV1603(binderId='all'){
    let cards=[...V14.allCards];
    if(binderId&&binderId!=='all')cards=cards.filter(card=>String(card.binder_id||'')===String(binderId));
    return uniquePriceCards(cards);
  }

  function unpricedCardsV1466(){
    return priceAuditBinderCardsV1603('all')
      .filter(card=>!hasBrazilQuoteV1466(card))
      .sort((a,b)=>{
        const binder=String(binderForCard(a)?.name||'').localeCompare(String(binderForCard(b)?.name||''),'pt-BR');
        if(binder)return binder;
        const set=String(a.set_name||'').localeCompare(String(b.set_name||''),'pt-BR');
        if(set)return set;
        return numberValue(a.number)-numberValue(b.number)||String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
      });
  }

  function priceProblemTextV1466(card){
    const raw=String(card?.price_last_error||'').trim();
    const parts=raw.split('|').map(x=>x.trim()).filter(Boolean);
    const friendly=parts.map(part=>{
      const pair=part.split(':');
      const source=pair.length>1?pair.shift():'';
      const code=pair.join(':')||part;
      const label=({
        timeout:'tempo esgotado',not_found:'não encontrada',product_not_found:'produto não encontrado',
        wrong_product:'produto/link incorreto',variant_not_found:'acabamento/condição não encontrado',
        no_price_data:'sem ofertas válidas',price_connector_unavailable:'conector indisponível',
        cloudflare_blocked:'bloqueio Cloudflare',browser_error:'erro no navegador',
        upstream_error:'erro na consulta',fast_timeout:'tempo esgotado',fast_unavailable:'consulta indisponível'
      })[code]||code.replace(/_/g,' ');
      return (source?source.toUpperCase()+': ':'')+label;
    });
    const history=friendly.length?' · última tentativa: '+friendly.join(' · '):'';
    const hasSavedQuote=hasBrazilQuoteV1466(card);
    if(!hasSavedQuote&&card?.price_processing_at)return 'ATUALIZANDO'+history;
    if(!hasSavedQuote&&card?.price_pending){
      const hasMyp=/mypcards\.com/i.test(String(card?.myp_price_link||card?.price_br_link||card?.price_link||''));
      return 'NA FILA · '+(hasMyp?'link MYP localizado':'procurando link MYP')+history;
    }
    if(hasSavedQuote)return 'Cotação salva';
    if(friendly.length)return 'FORA DA FILA · '+friendly.join(' · ');
    if(Number(card?.price_attempts||0)>0)return 'FORA DA FILA · tentativas concluídas sem cotação salva';
    return 'Sem cotação salva no app';
  }

  function unpricedProblemKindV1468(card){
    if(hasBrazilQuoteV1466(card))return 'priced';
    if(card?.price_processing_at||card?.price_pending)return 'queued';
    const raw=String(card?.price_last_error||'').toLowerCase();
    if(raw.includes('timeout'))return 'timeout';
    if(raw.includes('variant_not_found'))return 'variant';
    if(raw.includes('not_found')||raw.includes('product_not_found')||raw.includes('wrong_product'))return 'not_found';
    return 'other';
  }

  function ensureUnpricedDialogV1468(){
    let d=byId('v1468UnpricedDialog');
    if(d)return d;
    d=document.createElement('dialog');
    d.id='v1468UnpricedDialog';
    d.className='v1468-unpriced-dialog v1603-price-audit-dialog';
    d.innerHTML=`<div class="v1468-unpriced-shell">
      <header class="v1468-unpriced-head">
        <div><p class="kicker">COTAÇÕES</p><div class="v1468-unpriced-title"><h2>Cartas para ajustar</h2><span id="v1468UnpricedTotal">0</span></div><p id="v1468UnpricedSubtitle" class="muted"></p></div>
        <button id="v1468UnpricedClose" class="icon-only" type="button" aria-label="Fechar">×</button>
      </header>
      <div class="v1603-price-audit-filters">
        <label><span>Fichário</span><select id="v1603PriceBinder"></select></label>
        <label><span>Valores</span><select id="v1603PriceState">
          <option value="all">Todas as cartas</option>
          <option value="unpriced" selected>Somente sem valores</option>
          <option value="priced">Somente com valores</option>
        </select></label>
        <label><span>Situação</span><select id="v1468UnpricedProblem">
          <option value="all">Todas as situações</option>
          <option value="timeout">Tempo esgotado</option>
          <option value="not_found">Não encontrada</option>
          <option value="variant">Acabamento / condição</option>
          <option value="queued">Na fila / atualizando</option>
          <option value="other">Outros</option>
        </select></label>
        <label class="v1603-price-audit-search"><span>Busca</span><input id="v1468UnpricedSearch" type="search" placeholder="Nome, número ou coleção"></label>
      </div>
      <div class="v1603-price-audit-actions">
        <button id="v1603UpdateFilteredPrices" class="btn btn-primary" type="button">↻ Atualizar conforme filtros</button>
        <span id="v1603PriceAuditProgress" class="muted"></span>
      </div>
      <div id="v1604PriceProgressCard" class="v1604-price-progress-card">
        <div class="v1604-progress-copy">
          <strong id="v1604PriceProgressTitle">Progresso das cotações</strong>
          <span id="v1604PriceProgressPct">0%</span>
        </div>
        <div class="v1604-progress-track"><i id="v1604PriceProgressBar"></i></div>
        <div id="v1604PriceProgressMeta" class="v1604-progress-meta"></div>
      </div>
      <div id="v1468UnpricedStats" class="v1468-unpriced-stats"></div>
      <div id="v1468UnpricedList" class="v1468-unpriced-list"></div>
    </div>`;
    document.body.appendChild(d);
    byId('v1468UnpricedClose').onclick=()=>d.close();
    d.addEventListener('close',()=>{
      if(V14.priceAuditPollTimer){clearTimeout(V14.priceAuditPollTimer);V14.priceAuditPollTimer=0}
    });
    d.addEventListener('click',e=>{if(e.target===d)d.close()});
    for(const id of ['v1468UnpricedSearch','v1468UnpricedProblem','v1603PriceBinder','v1603PriceState']){
      byId(id)?.addEventListener(id==='v1468UnpricedSearch'?'input':'change',renderUnpricedPopupV1468);
    }
    byId('v1603UpdateFilteredPrices').onclick=updateFilteredAuditPricesV1603;
    return d;
  }

  function populatePriceAuditBindersV1603(){
    const select=byId('v1603PriceBinder');if(!select)return;
    const old=select.value||'all';
    select.innerHTML='<option value="all">Todos os fichários</option>'+
      V14.binders.map(b=>'<option value="'+esc(b.id)+'">'+esc((b.binder_kind==='wishlist'?'Desejos · ':'')+(b.name||'Fichário'))+'</option>').join('');
    select.value=[...select.options].some(o=>o.value===old)?old:'all';
  }

  function priceAuditStageV1604(card){
    if(hasBrazilQuoteV1466(card))return{key:'priced',rank:3,label:'COM VALOR'};
    const processingAt=Date.parse(card?.price_processing_at||0)||0;
    const freshProcessing=processingAt&&processingAt>Date.now()-60_000;
    if(freshProcessing)return{key:'processing',rank:0,label:'ATUALIZANDO'};
    if(card?.price_pending)return{key:'queued',rank:1,label:'NA FILA'};
    return{key:'waiting',rank:2,label:'AGUARDANDO AJUSTE'};
  }

  function priceAuditScopeStatsV1604(){
    const binderId=byId('v1603PriceBinder')?.value||'all';
    const all=priceAuditBinderCardsV1603(binderId);
    const counts={total:all.length,priced:0,processing:0,queued:0,waiting:0};
    for(const card of all){
      const stage=priceAuditStageV1604(card).key;
      if(stage==='priced')counts.priced++;
      else if(stage==='processing')counts.processing++;
      else if(stage==='queued')counts.queued++;
      else counts.waiting++;
    }
    return counts;
  }

  function renderPriceAuditProgressV1604(){
    const title=byId('v1604PriceProgressTitle');
    const pctEl=byId('v1604PriceProgressPct');
    const bar=byId('v1604PriceProgressBar');
    const meta=byId('v1604PriceProgressMeta');
    if(!title||!pctEl||!bar||!meta)return;

    const batch=V14.priceAuditBatch;
    if(batch?.total){
      const done=Math.max(0,Math.min(batch.total,Number(batch.done||0)));
      const pct=Math.round(done/batch.total*100);
      title.textContent='Lote em atualização';
      pctEl.textContent=pct+'%';
      bar.style.width=pct+'%';
      meta.textContent=[
        done+' de '+batch.total+' processadas',
        (batch.processing||0)+' atualizando agora',
        (batch.queued||0)+' na fila',
        (batch.priced||0)+' com valor'
      ].join(' · ');
      return;
    }

    const stats=priceAuditScopeStatsV1604();
    const pct=stats.total?Math.round(stats.priced/stats.total*100):100;
    title.textContent='Cobertura de preços no escopo';
    pctEl.textContent=pct+'%';
    bar.style.width=pct+'%';
    meta.textContent=[
      stats.priced+' com valor',
      stats.processing+' atualizando agora',
      stats.queued+' na fila',
      stats.waiting+' aguardando ajuste'
    ].join(' · ');
  }

  async function pollPriceAuditV1604(){
    if(V14.priceAuditPollTimer)clearTimeout(V14.priceAuditPollTimer);
    const dialog=byId('v1468UnpricedDialog');
    if(!dialog?.open){V14.priceAuditPollTimer=0;return}
    try{
      const {data,error}=await db.from('pokemon_cards')
        .select('id,price_min,price_avg,price_max,price_source,price_link,price_br_source,price_br_link,myp_price_min,myp_price_avg,myp_price_max,myp_price_link,myp_price_checked_at,liga_price_min,liga_price_avg,liga_price_max,price_checked_at,price_pending,price_processing_at,price_attempts,price_last_error')
        .eq('user_id',currentUser.id);
      if(!error&&Array.isArray(data)){
        data.forEach(row=>applyLocalPricePatch(row.id,row));
        renderUnpricedPopupV1468();
        renderUnpricedAuditV1466();
      }
    }catch(error){
      console.warn('[Cotações · atualização ao vivo]',error);
    }
    V14.priceAuditPollTimer=setTimeout(pollPriceAuditV1604,4200);
  }

  function priceAuditFilteredCardsV1603(){
    const binderId=byId('v1603PriceBinder')?.value||'all';
    const state=byId('v1603PriceState')?.value||'unpriced';
    const problem=byId('v1468UnpricedProblem')?.value||'all';
    const query=nrm(byId('v1468UnpricedSearch')?.value||'');
    return priceAuditBinderCardsV1603(binderId).filter(card=>{
      const priced=hasBrazilQuoteV1466(card);
      if(state==='unpriced'&&priced)return false;
      if(state==='priced'&&!priced)return false;
      if(problem!=='all'&&unpricedProblemKindV1468(card)!==problem)return false;
      if(query&&!nrm([card.name,card.number,card.set_name,card.finish,card.rarity,binderForCard(card)?.name,priceProblemTextV1466(card)].filter(Boolean).join(' ')).includes(query))return false;
      return true;
    }).sort((a,b)=>{
      const sa=priceAuditStageV1604(a),sb=priceAuditStageV1604(b);
      if(sa.rank!==sb.rank)return sa.rank-sb.rank;
      if(sa.key==='processing'){
        const at=Date.parse(a.price_processing_at||0)||0,bt=Date.parse(b.price_processing_at||0)||0;
        if(at!==bt)return bt-at;
      }
      const ba=String(binderForCard(a)?.name||''),bb=String(binderForCard(b)?.name||'');
      return ba.localeCompare(bb,'pt-BR')||String(a.set_name||'').localeCompare(String(b.set_name||''),'pt-BR')||
        numberValue(a.number)-numberValue(b.number)||String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
    });
  }

  function renderUnpricedPopupV1468(){
    ensureUnpricedDialogV1468();
    populatePriceAuditBindersV1603();
    const all=priceAuditBinderCardsV1603(byId('v1603PriceBinder')?.value||'all');
    const cards=priceAuditFilteredCardsV1603();
    const unpriced=all.filter(card=>!hasBrazilQuoteV1466(card)).length;
    const priced=all.length-unpriced;

    byId('v1468UnpricedTotal').textContent=String(cards.length);
    byId('v1468UnpricedSubtitle').textContent=all.length+' carta(s) no escopo · '+unpriced+' sem valor · '+priced+' com valor.';
    byId('v1468UnpricedStats').textContent=cards.length+' carta(s) correspondem aos filtros atuais.';
    renderPriceAuditProgressV1604();

    const list=byId('v1468UnpricedList');
    list.innerHTML='';
    if(!cards.length){
      list.innerHTML='<div class="v1468-unpriced-empty"><strong>Nenhuma carta encontrada</strong><small>Ajuste os filtros acima.</small></div>';
      return ensureUnpricedDialogV1468();
    }

    for(const card of cards){
      const row=document.createElement('button');
      const stage=priceAuditStageV1604(card);
      row.type='button';row.className='v1468-unpriced-row v1604-stage-'+stage.key;
      const image=cardImage(card),binder=binderForCard(card);
      const min=Number(card.price_min||card.myp_price_min||card.liga_price_min||0);
      const avg=Number(card.price_avg||card.myp_price_avg||card.liga_price_avg||0);
      row.innerHTML=
        '<span class="v1468-unpriced-thumb">'+(image?'<img src="'+esc(image)+'" alt="" loading="lazy">':'?')+'</span>'+
        '<span class="v1468-unpriced-info"><span class="v1468-unpriced-name"><strong>'+esc(card.name||'Carta sem nome')+'</strong><b>'+esc(card.number?'#'+card.number:'Sem número')+'</b></span>'+
        '<small>'+esc([binder?.name||'Fichário',card.set_name||'Coleção',card.finish||'Normal',card.rarity||''].filter(Boolean).join(' · '))+'</small>'+
        '<em><b class="v1604-stage-chip">'+esc(stage.label)+'</b><span>'+esc(priceProblemTextV1466(card))+(hasBrazilQuoteV1466(card)?' · '+esc(money(min||avg)):'')+'</span></em></span>'+
        '<span class="v1468-unpriced-open"><small>Conferir</small><b>›</b></span>';
      row.onclick=()=>{ensureUnpricedDialogV1468().close();byId('summaryPanel')?.classList.remove('mobile-open');openExistingCard(card,true)};
      list.appendChild(row);
    }
    return ensureUnpricedDialogV1468();
  }

  async function syncPriceAuditRowsV1603(){
    const ids=V14.allCards.map(c=>c.id).filter(Boolean);
    if(!ids.length||!currentUser?.id)return;
    for(let i=0;i<ids.length;i+=180){
      const {data,error}=await db.from('pokemon_cards')
        .select('id,price_min,price_avg,price_max,price_source,price_link,price_br_source,price_br_link,myp_price_min,myp_price_avg,myp_price_max,myp_price_link,myp_price_checked_at,liga_price_min,liga_price_avg,liga_price_max,price_checked_at,price_pending,price_processing_at,price_attempts,price_last_error')
        .eq('user_id',currentUser.id).in('id',ids.slice(i,i+180));
      if(error)throw error;
      for(const row of data||[])applyLocalPricePatch(row.id,row);
    }
  }

  async function watchAuditPriceBatchV1603(cards){
    const seq=++V14.priceAuditWatchSeq;
    const ids=uniquePriceCards(cards).map(c=>c.id).filter(Boolean);
    const total=ids.length;
    const progress=byId('v1603PriceAuditProgress');
    const started=Date.now();
    V14.priceAuditBatch={ids,total,done:0,processing:0,queued:total,priced:0,started};

    while(seq===V14.priceAuditWatchSeq&&Date.now()-started<15*60_000){
      const {data}=await db.from('pokemon_cards')
        .select('id,price_pending,price_processing_at,price_min,price_avg,price_max,myp_price_min,myp_price_avg,myp_price_max,liga_price_min,liga_price_avg,liga_price_max,price_last_error')
        .eq('user_id',currentUser.id).in('id',ids);
      if(Array.isArray(data)){
        data.forEach(row=>applyLocalPricePatch(row.id,row));
        const now=Date.now();
        const processing=data.filter(row=>{
          const t=Date.parse(row.price_processing_at||0)||0;
          return !hasBrazilQuoteV1466(row)&&t&&t>now-60_000;
        }).length;
        const queued=data.filter(row=>!hasBrazilQuoteV1466(row)&&row.price_pending).length-processing;
        const priced=data.filter(row=>hasBrazilQuoteV1466(row)).length;
        const pending=data.filter(row=>row.price_pending).length;
        const done=Math.max(0,total-pending);

        V14.priceAuditBatch={ids,total,done,processing:Math.max(0,processing),queued:Math.max(0,queued),priced,started};
        const pct=total?Math.round(done/total*100):100;
        if(progress)progress.textContent=pending
          ?pct+'% concluído · '+processing+' atualizando · '+Math.max(0,queued)+' na fila'
          :'100% processado · '+priced+' com valor neste lote';

        renderUnpricedPopupV1468();
        renderUnpricedAuditV1466();
        if(!pending){
          V14.priceAuditBatch={...V14.priceAuditBatch,done:total,processing:0,queued:0};
          renderPriceAuditProgressV1604();
          setTimeout(()=>{
            if(V14.priceAuditBatch?.ids===ids)V14.priceAuditBatch=null;
            renderPriceAuditProgressV1604();
          },3500);
          break;
        }
      }
      await sleep(2200);
    }
  }

  async function updateFilteredAuditPricesV1603(){
    const cards=priceAuditFilteredCardsV1603();
    if(!cards.length)return toast('Nenhuma carta corresponde aos filtros.');
    const button=byId('v1603UpdateFilteredPrices');
    const progress=byId('v1603PriceAuditProgress');
    busy(button,true,'Colocando '+cards.length+' na fila…');
    try{
      const unpricedOnly=(byId('v1603PriceState')?.value||'')==='unpriced';
      await markCardsForPrice(cards,unpricedOnly?600:250);
      queueBackgroundPrices(cards,{front:unpricedOnly});
      kickPriceWorkerNow();
      setTimeout(kickPriceWorkerNow,1200);
      V14.priceAuditBatch={ids:cards.map(card=>card.id).filter(Boolean),total:cards.length,done:0,processing:0,queued:cards.length,priced:cards.filter(hasBrazilQuoteV1466).length,started:Date.now()};
      if(progress)progress.textContent='0% concluído · '+cards.length+' na fila';
      renderUnpricedPopupV1468();
      watchAuditPriceBatchV1603(cards).catch(console.warn);
    }catch(error){
      console.error('[Auditoria de preços]',error);
      toast('Não consegui iniciar a atualização deste filtro.');
    }finally{
      busy(button,false);
    }
  }

  async function openUnpricedPopupV1468(){
    const d=ensureUnpricedDialogV1468();
    populatePriceAuditBindersV1603();
    if(byId('v1603PriceBinder'))byId('v1603PriceBinder').value='all';
    if(byId('v1603PriceState'))byId('v1603PriceState').value='unpriced';
    if(byId('v1468UnpricedProblem'))byId('v1468UnpricedProblem').value='all';
    byId('v1468UnpricedStats').textContent='Sincronizando cotações…';
    if(!d.open)d.showModal();
    try{await syncPriceAuditRowsV1603()}catch(error){console.warn('[Cotações · sincronização]',error)}
    renderUnpricedAuditV1466();
    renderUnpricedPopupV1468();
    if(!V14.priceAuditPollTimer)V14.priceAuditPollTimer=setTimeout(pollPriceAuditV1604,1200);
    setTimeout(()=>byId('v1468UnpricedSearch')?.focus(),80);
  }

  function renderUnpricedAuditV1466(){
    const details=byId('v1411Group_unpriced');
    if(!details)return;
    const count=V14.allCards.filter(card=>!hasBrazilQuoteV1466(card)).length;
    const badge=details.querySelector('[data-v1466-unpriced-count]');
    const hint=details.querySelector('[data-v1466-unpriced-hint]');
    if(badge)badge.textContent=String(count);
    if(hint)hint.textContent=count===1?'1 carta sem valor em todos os fichários':count+' cartas sem valor em todos os fichários';
  }

  function setCleanBinderModeV1498(enabled){
    const on=!!enabled;
    document.body.classList.toggle('v1498-clean-binder',on);
    try{localStorage.setItem('pokemon-binder-clean-view',on?'1':'0')}catch{}
    const btn=byId('v1498CleanBinder');
    if(btn){
      btn.classList.toggle('active',on);
      btn.innerHTML=on
        ? '<span class="v1498-clean-icon">↩</span><span><strong>Voltar ao fichário normal</strong><small>Mostrar status, favoritos e atalhos</small></span>'
        : '<span class="v1498-clean-icon">◫</span><span><strong>Ver fichário limpo</strong><small>Mostrar somente as cartas e o preço</small></span>';
      btn.setAttribute('aria-pressed',on?'true':'false');
    }
  }

  function ensureCleanBinderButtonV1498(){
    const panel=byId('summaryPanel');
    const root=document.querySelector('#summaryPanel .action-grid');
    if(!panel||!root)return;
    let btn=byId('v1498CleanBinder');
    if(!btn){
      btn=document.createElement('button');
      btn.id='v1498CleanBinder';
      btn.type='button';
      btn.className='v1498-clean-binder-btn';
      btn.onclick=()=>setCleanBinderModeV1498(!document.body.classList.contains('v1498-clean-binder'));
      root.parentElement?.insertBefore(btn,root);
    }
    let saved=false;
    try{saved=localStorage.getItem('pokemon-binder-clean-view')==='1'}catch{}
    setCleanBinderModeV1498(saved);
  }

  function pdfEscapeV1500(value){
    return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function exportBinderPdfV1500(){
    const binder=activeBinder();
    if(!binder){
      toast('Escolha um fichário específico para exportar em PDF.');
      return;
    }

    const popup=window.open('','_blank');
    if(!popup){
      toast('O navegador bloqueou a janela do PDF. Libere pop-ups e tente novamente.');
      return;
    }

    const cards=V14.allCards
      .filter(card=>card.binder_id===binder.id)
      .sort((a,b)=>(+a.binder_page||1)-(+b.binder_page||1)||(+a.binder_slot||1)-(+b.binder_slot||1));
    const pageCount=Math.max(1,+binder.pages||1,Math.ceil(cards.length/9));
    const byPosition=new Map(cards.map(card=>[(+card.binder_page||1)+':'+(+card.binder_slot||1),card]));
    const mode=currentPriceMode();
    const modeLabel=priceModeLabel(mode);
    const moneyPdf=value=>money(Number(value||0));

    const pages=[];
    for(let page=1;page<=pageCount;page++){
      const slots=[];
      for(let slot=1;slot<=9;slot++){
        const card=byPosition.get(page+':'+slot);
        if(!card){
          slots.push('<div class="slot empty"></div>');
          continue;
        }
        const src=cardImage(card)||card.image_url||'';
        const price=priceModeValue(card,mode);
        const status=String(card.collection_status||'owned');
        const statusLabel=({owned:'Tenho',wanted:'Quero',missing:'Não tenho',ordered:'Pedido'})[status]||status;
        slots.push(
          '<div class="slot">'+
            '<div class="card">'+
              (src?'<img src="'+pdfEscapeV1500(src)+'" alt="'+pdfEscapeV1500(card.name||'Carta')+'">':'<div class="noimg">'+pdfEscapeV1500(card.name||'Carta')+'</div>')+
              '<div class="price">'+(price>0?pdfEscapeV1500(moneyPdf(price)):'Buscando cotação')+'</div>'+
            '</div>'+
            '<div class="meta"><strong>'+pdfEscapeV1500(card.name||'')+'</strong><span>'+pdfEscapeV1500(card.number||'')+(card.set_name?' · '+pdfEscapeV1500(card.set_name):'')+'</span><small>'+pdfEscapeV1500(statusLabel)+'</small></div>'+
          '</div>'
        );
      }
      pages.push(
        '<section class="sheet">'+
          '<header><div><h1>'+pdfEscapeV1500(binder.name||'Fichário Pokémon')+'</h1><p>Página '+page+' de '+pageCount+'</p></div><div class="price-mode">Valor '+pdfEscapeV1500(modeLabel)+'</div></header>'+
          '<div class="grid">'+slots.join('')+'</div>'+
        '</section>'
      );
    }

    popup.document.open();
    popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+pdfEscapeV1500(binder.name||'Fichário Pokémon')+' — PDF</title>'+
      '<style>'+
      '@page{size:A4 portrait;margin:9mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}'+
      '.sheet{min-height:277mm;page-break-after:always;display:flex;flex-direction:column}.sheet:last-child{page-break-after:auto}'+
      'header{height:16mm;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #d8d8d8;margin-bottom:4mm;padding-bottom:2.5mm}'+
      'h1{font-size:15pt;margin:0 0 1mm}header p,.price-mode{margin:0;font-size:8pt;color:#555}.price-mode{font-weight:700;padding-top:1mm}'+
      '.grid{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:1.4mm;flex:1;align-items:start}'+
      '.slot{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:.7mm;overflow:hidden;background:transparent;border:0;border-radius:0}'+
      '.slot.empty{background:transparent;border:0}.card{position:relative;width:48mm;max-width:100%;aspect-ratio:63/88;display:flex;align-items:center;justify-content:center}.card img{width:100%;height:100%;object-fit:contain;border-radius:1.4mm;filter:none!important}'+
      '.price{position:absolute;left:2mm;right:2mm;bottom:2mm;background:rgba(0,0,0,.88);color:#fff;border-radius:1.5mm;padding:1.3mm;text-align:center;font-size:8.5pt;font-weight:800}.noimg{width:100%;height:100%;display:flex;align-items:center;justify-content:center;border:1px dashed #bbb;color:#777;font-size:9pt;text-align:center;padding:4mm}'+
      '.meta{width:100%;display:grid;gap:.35mm;margin-top:.8mm;text-align:center;line-height:1.08}.meta strong{font-size:7.2pt}.meta span{font-size:6.1pt;color:#555}.meta small{font-size:5.8pt;color:#777}'+
      '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{break-after:page}.sheet:last-child{break-after:auto}}'+
      '</style></head><body>'+pages.join('')+
      '<script>window.addEventListener("load",function(){var imgs=[].slice.call(document.images);Promise.all(imgs.map(function(i){return i.complete?Promise.resolve():new Promise(function(r){i.onload=i.onerror=r})})).then(function(){setTimeout(function(){window.print()},250)});setTimeout(function(){window.print()},3500)});<\/script>'+
      '</body></html>');
    popup.document.close();
  }

  function organizeSummaryActionsV14(){
    const root=document.querySelector('#summaryPanel .action-grid');
    if(!root)return;
    byId('v1411Group_prices')?.remove();
    const legacyPriceButton=byId('v12UpdatePrices');
    if(legacyPriceButton){legacyPriceButton.hidden=true;legacyPriceButton.style.display='none'}
    ensureCleanBinderButtonV1498();
    if(!byId('v1500ExportPdf')){
      const pdf=document.createElement('button');
      pdf.id='v1500ExportPdf';
      pdf.type='button';
      pdf.className='action-btn';
      pdf.textContent='Exportar fichário em PDF';
      pdf.onclick=exportBinderPdfV1500;
      root.appendChild(pdf);
    }

    const defs=[
      {id:'unpriced',icon:'!',title:'Cotações',hint:'Cartas para ajustar e atualizar',items:[]},
      {id:'excel',icon:'▦',title:'Planilhas e backup',hint:'Excel e importação',items:['v122ExportExcel','v122TemplateExcel','v122ImportExcel']},
      {id:'export',icon:'⇩',title:'Exportar e imprimir',hint:'PDF, CSV e impressão',items:['v1500ExportPdf','btnExport','btnPrint']},
      {id:'friends',icon:'♙',title:'Amigos',hint:'Buscar usuários e ver fichários',items:[]},
      {id:'settings',icon:'⚙',title:'Configurações',hint:'Aparência e conta',items:['btnSummarySettings','v112Logout']}
    ];

    for(const def of defs){
      let details=byId('v1411Group_'+def.id);
      if(!details){
        details=document.createElement('details');
        details.id='v1411Group_'+def.id;
        details.className='v1411-action-group';
        const summary=document.createElement('summary');
        summary.innerHTML='<span class="v1411-action-icon">'+def.icon+'</span><span class="v1411-action-copy"><strong>'+def.title+'</strong><small'+(def.id==='unpriced'?' data-v1466-unpriced-hint':'')+'>'+def.hint+'</small></span>'+(def.id==='unpriced'?'<span class="v1466-unpriced-count" data-v1466-unpriced-count>0</span>':'')+'<span class="v1411-action-chevron">⌄</span>';
        const body=document.createElement('div');
        body.className='v1411-action-body';
        details.append(summary,body);
        details.addEventListener('toggle',()=>{
          if(!details.open)return;
          if(def.id==='unpriced'){details.open=false;openUnpricedPopupV1468();return}
          root.querySelectorAll('.v1411-action-group[open]').forEach(other=>{if(other!==details)other.open=false});
          if(def.id==='friends')refreshFriendsSummaryV14();
        });
        if(def.id==='unpriced')summary.addEventListener('click',e=>{e.preventDefault();openUnpricedPopupV1468()});
        if(def.id==='friends'&&byId('v1411Group_settings'))root.insertBefore(details,byId('v1411Group_settings'));
        else root.appendChild(details);
      }
      const body=details.querySelector('.v1411-action-body');
      if(def.id==='friends')mountFriendsSummaryV14(body);
      if(def.id==='unpriced')renderUnpricedAuditV1466();
      for(const id of def.items){
        const el=byId(id);
        if(el&&el.parentElement!==body)body.appendChild(el);
      }
    }
    const fileInput=byId('v122ExcelInput');
    if(fileInput&&fileInput.parentElement!==root)root.appendChild(fileInput);
  }

  function openRemoveCardDialog(){
    const card=editingCardId?V14.allCards.find(x=>x.id===editingCardId):null;
    if(!card)return toast('Esta carta ainda não foi salva no fichário.');
    const binder=V14.binders.find(b=>b.id===card.binder_id);
    const d=byId('v1417RemoveCardDialog');if(!d)return;
    d.dataset.cardId=card.id;
    const title=byId('v1417RemoveCardTitle');
    const msg=byId('v1417RemoveCardMessage');
    if(title)title.textContent='Remover '+(card.name||'esta carta')+'?';
    if(msg)msg.textContent='Ela será removida de "'+(binder?.name||'este fichário')+'" e deixará de existir nessa posição.';
    if(!d.open)d.showModal();
  }

  async function confirmRemoveCardFromBinder(){
    const d=byId('v1417RemoveCardDialog');
    const id=d?.dataset?.cardId;
    const card=V14.allCards.find(x=>String(x.id)===String(id));
    if(!card)return;
    const btn=byId('v1417ConfirmRemoveCard');
    busy(btn,true,'Removendo…');
    try{
      const {data,error}=await db.from('pokemon_cards')
        .delete()
        .eq('id',card.id)
        .eq('user_id',currentUser.id)
        .select('id');
      if(error)throw error;
      if(!data?.length)throw new Error('Carta não encontrada para remoção.');

      if(V14.singlePriceWatch?.cardId===card.id)V14.singlePriceWatch.cancelled=true;
      V14.priceQueue=V14.priceQueue.filter(x=>x.id!==card.id);
      V14.priceJobs.delete(card.id);
      V14.allCards=V14.allCards.filter(x=>x.id!==card.id);
      collection=collection.filter(x=>x.id!==card.id);

      hardCloseDialog(d);
      hardCloseDialog('cardDialog');
      editingCardId=null;
      selectedCard=null;
      selectedMarket=null;
      pendingPosition=null;

      await loadCardsV14(false);
      releaseMobileInteraction();
      toast('Carta removida deste fichário.');
    }catch(error){
      console.error(error);
      toast('Não consegui remover a carta: '+(error?.message||'erro no banco'));
    }finally{
      busy(btn,false);
    }
  }

  function wireRemoveCardAction(){
    const remove=byId('btnDeleteSelected');
    if(remove)remove.onclick=openRemoveCardDialog;
    const removeDetails=byId('v1422RemoveCardDetails');
    if(removeDetails)removeDetails.onclick=openRemoveCardDialog;
    const cancel=byId('v1417CancelRemoveCard');
    if(cancel)cancel.onclick=()=>hardCloseDialog('v1417RemoveCardDialog');
    const close=byId('v1417RemoveCardDialog')?.querySelector('[data-v1417-close-remove]');
    if(close)close.onclick=()=>hardCloseDialog('v1417RemoveCardDialog');
    const confirm=byId('v1417ConfirmRemoveCard');
    if(confirm)confirm.onclick=confirmRemoveCardFromBinder;
  }

  function wireFastAdd(){
    wireCatalogCollectionSearchV1450();
    const b=byId('btnAddSelected');if(b)b.onclick=addSelectedFast;
    const save=byId('btnSaveCard');if(save)save.onclick=saveSelectedCardV14;
    const one=byId('btnUpdateCardPrice');if(one)one.onclick=updateEditingCardPriceNow;
    ensureManualPriceButtonV1469();
    const manual=byId('btnManualCardPrice');if(manual)manual.onclick=openManualPriceV1469;
    wireRemoveCardAction();
    wireSpreadNavigationV14();
    const friends=byId('v14Friends');
    if(friends)friends.onclick=openFriendsSummaryV14;
    const headerFriends=byId('btnFriends');
    if(headerFriends)headerFriends.onclick=openFriendsSummaryV14;
    const mobileFriends=byId('btnMobileFriends');
    if(mobileFriends)mobileFriends.onclick=openFriendsSummaryV14;
    const mobileProfile=byId('btnMobileProfile');
    if(mobileProfile)mobileProfile.onclick=openFriendsSummaryV14;
    window.openPokemonFriends=openFriendsSummaryV14;
    syncSingleCardPriceButton();
    rewireFilteredPriceButton();
    organizeSummaryActionsV14();
  }

  async function bootV14(){
    injectUI();
    wireScanner();
    wireFastAdd();
    wireSelectionTrayV1493();
    ensureWishlistTransferUIV1494();
    syncWishlistTransferButtonV1494();
    startGlobalPriceStatusPollV1514();
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
    const cardDialog=byId('cardDialog');
    if(cardDialog)new MutationObserver(()=>{
      wireFastAdd();ensureWishlistTransferUIV1494();syncWishlistTransferButtonV1494();
      if(cardDialog.open)syncSingleCardPriceButton();
    }).observe(cardDialog,{attributes:true,attributeFilter:['open']});
    const summaryActions=document.querySelector('#summaryPanel .action-grid');
    if(summaryActions)new MutationObserver(()=>setTimeout(organizeSummaryActionsV14,0)).observe(summaryActions,{childList:true});
    setTimeout(organizeSummaryActionsV14,80);
    setTimeout(organizeSummaryActionsV14,700);
    const area=document.querySelector('.binder-area');
    const spread=document.querySelector('#binderStage .binder-spread');
    if(typeof ResizeObserver!=='undefined'){
      const ro=new ResizeObserver(()=>positionUnifiedTopbar());
      if(area)ro.observe(area);
      if(spread)ro.observe(spread);
    }
    window.addEventListener('resize',positionUnifiedTopbar,{passive:true});
    setTimeout(positionUnifiedTopbar,60);
  }

  patchFunctions();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootV14);
  else bootV14();
})();

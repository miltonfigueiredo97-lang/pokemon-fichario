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
    scan:{stream:null,timer:null,busy:false,evidenceNames:new Map(),evidenceNumbers:new Map(),lastFingerprint:null},
    setsCache:new Map(),
    seriesCache:new Map(),
    masterPreview:null,
    favoritesOnly:false,
    binderSearchMatches:[],
    binderSearchLookup:new Map()
  };
  window.PB14=V14;

  const byId=id=>document.getElementById(id);
  const nrm=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function activeBinder(){
    return V14.binders.find(b=>b.id===V14.activeBinderId)||null;
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
    return ['all','owned','missing'].includes(settings.binder_view_scope)?settings.binder_view_scope:'all';
  }
  function canMove(){return !isGeneral()&&activeSort()==='manual_asc'&&binderViewScope()==='all'&&!V14.favoritesOnly}
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
    const raw=String(card?.card_key||cardKey(card)||'').replace(/\|variant:[^|]+$/i,'');
    const lang=card?.language_code||card?.languageCode||'';
    const finish=card?.finish||'Normal';
    return [raw,lang,finish].join('|');
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
  function orderedViewCards(){
    const physical=physicalCollection();
    const arr=isGeneral()?viewScopedCards(groupedVirtualCards(physical)):[...viewScopedCards(physical)];
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
    return arr;
  }

  function positionUnifiedTopbar(){
    const area=document.querySelector('.binder-area');
    const bar=byId('v14UnifiedTopbar');
    const spread=document.querySelector('#binderStage .binder-spread');
    if(!area||!bar||!spread)return;
    if(window.matchMedia('(max-width:820px)').matches){
      bar.style.removeProperty('left');
      bar.style.removeProperty('max-width');
      return;
    }
    const ar=area.getBoundingClientRect(),sr=spread.getBoundingClientRect();
    if(sr.width<20)return;
    const desired=sr.left-ar.left+(sr.width/2);
    bar.style.left=desired+'px';
    bar.style.maxWidth=Math.max(520,sr.width-8)+'px';
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

  function injectUI(){
    if(!byId('v14BinderControls')){
      const host=ensureUnifiedTopbar();
      if(host){
        const wrap=document.createElement('div');
        wrap.id='v14BinderControls';
        wrap.className='v14-binder-controls';
        wrap.innerHTML=
          '<select id="v14BinderSelect" aria-label="Fichário"></select>'+
          '<label class="v14-binder-search" title="Pesquisar dentro deste fichário"><span>⌕</span><input id="v14BinderSearch" type="search" list="v14BinderSearchList" autocomplete="off" placeholder="Buscar carta…"><datalist id="v14BinderSearchList"></datalist></label>'+
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
          '<button id="v14FavoritesOnly" class="icon-text-btn v14-fav-filter" type="button" aria-pressed="false">☆ Favoritos</button>'+
          '<button id="v14RenameBinder" class="icon-text-btn" type="button">Renomear</button>'+
          '<button id="v14DeleteBinder" class="icon-text-btn" type="button">Excluir</button>'+
          '<button id="v14AddBinder" class="btn btn-primary" type="button">＋ Fichário</button>';
        host.appendChild(wrap);
        requestAnimationFrame(positionUnifiedTopbar);
      }
    }else{
      ensureUnifiedTopbar();
      requestAnimationFrame(positionUnifiedTopbar);
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

    document.querySelectorAll('[data-v14-close]').forEach(b=>b.onclick=()=>{const d=byId(b.dataset.v14Close);if(d?.open)d.close()});
    byId('v14TabEmpty')?.addEventListener('click',()=>switchCreateTab('empty'));
    byId('v14TabSet')?.addEventListener('click',()=>switchCreateTab('set'));
    byId('v14CreateEmpty')?.addEventListener('click',createEmptyBinder);
    byId('v14AddBinder')?.addEventListener('click',()=>{switchCreateTab('empty');byId('v14BinderDialog')?.showModal()});
    byId('v14RenameBinder')?.addEventListener('click',renameBinder);
    byId('v14DeleteBinder')?.addEventListener('click',deleteBinder);
    byId('v14BinderSelect')?.addEventListener('change',e=>selectBinder(e.target.value));
    byId('v14SortSelect')?.addEventListener('change',e=>setSortMode(e.target.value));
    byId('v14GoStart')?.addEventListener('click',goToBinderStart);
    byId('v14BinderSearch')?.addEventListener('input',updateBinderSearchSuggestions);
    byId('v14BinderSearch')?.addEventListener('change',e=>openBinderSearchSelection(e.target.value));
    byId('v14BinderSearch')?.addEventListener('keydown',e=>{
      if(e.key==='Enter'){
        e.preventDefault();
        const exact=V14.binderSearchLookup.get(e.currentTarget.value);
        const card=exact||V14.binderSearchMatches[0];
        if(card)goToBinderSearchCard(card);
        else if(e.currentTarget.value.trim())toast('Carta não encontrada neste fichário.');
      }else if(e.key==='Escape'){
        e.currentTarget.value='';
        updateBinderSearchSuggestions({currentTarget:e.currentTarget});
      }
    });
    byId('v14FavoritesOnly')?.addEventListener('click',toggleFavoritesFilter);
    byId('v14ValueScope')?.addEventListener('change',async e=>{
      const value=['all','owned','missing'].includes(e.target.value)?e.target.value:'all';
      settings.summary_value_scope=value;
      await updateSettings({summary_value_scope:value},true);
      renderSummary();
    });
    byId('v14BinderViewScope')?.addEventListener('change',async e=>{
      const value=['all','owned','missing'].includes(e.target.value)?e.target.value:'all';
      settings.binder_view_scope=value;
      currentPage=1;
      await updateSettings({binder_view_scope:value},true);
      renderBinder();
      renderPagesGrid();
      renderBinderControls();
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
    byId('v14CreateMaster')?.addEventListener('click',createMasterBinder);
    byId('v14ScanAgain')?.addEventListener('click',()=>{if(byId('v14ScanCandidates')?.open)byId('v14ScanCandidates').close();startScanner()});
  }

  function syncTopbarNavigation(){
    const start=byId('v14GoStart');
    if(start)start.disabled=currentPage<=1;
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

  function updateBinderSearchSuggestions(e){
    const input=e?.currentTarget||byId('v14BinderSearch');
    const list=byId('v14BinderSearchList');
    if(!input||!list)return;
    const q=input.value.trim();
    V14.binderSearchLookup.clear();
    V14.binderSearchMatches=[];
    list.innerHTML='';
    if(!q)return;
    const cards=orderedViewCards();
    const found=cards.map((card,index)=>({card,index,score:binderSearchScore(card,q)}))
      .filter(x=>x.score>0)
      .sort((a,b)=>b.score-a.score||a.index-b.index)
      .slice(0,20)
      .map(x=>x.card);
    V14.binderSearchMatches=found;
    for(const card of found){
      let label=binderSearchLabel(card),unique=label,n=2;
      while(V14.binderSearchLookup.has(unique))unique=label+' · '+n++;
      V14.binderSearchLookup.set(unique,card);
      const option=document.createElement('option');
      option.value=unique;
      list.appendChild(option);
    }
  }

  function openBinderSearchSelection(value){
    const card=V14.binderSearchLookup.get(value);
    if(card)goToBinderSearchCard(card);
  }

  function goToBinderSearchCard(card){
    const cards=orderedViewCards();
    let page=1;
    if(!isGeneral()&&activeSort()==='manual_asc'&&binderViewScope()==='all'&&!V14.favoritesOnly){
      page=Math.max(1,+card.binder_page||1);
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
    if(input)input.value=binderSearchLabel(card);
    setTimeout(()=>{
      const target=[...document.querySelectorAll('#binderSheet .pocket-card')].find(el=>String(el.dataset.id)===String(card.id));
      if(!target)return;
      target.classList.add('v14-search-hit');
      target.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'smooth'});
      setTimeout(()=>target.classList.remove('v14-search-hit'),1700);
    },80);
  }

  function switchCreateTab(which){
    const empty=which==='empty';
    byId('v14TabEmpty')?.classList.toggle('active',empty);
    byId('v14TabSet')?.classList.toggle('active',!empty);
    byId('v14EmptyPane')?.classList.toggle('hidden',!empty);
    byId('v14SetPane')?.classList.toggle('hidden',empty);
    if(!empty)setTimeout(()=>loadGenerationOptions(false),0);
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
    }else if(!isGeneral()&&!V14.binders.some(b=>b.id===V14.activeBinderId)){
      V14.activeBinderId=V14.binders[0]?.id||'all';
    }
    renderBinderControls();
  }

  function renderBinderControls(){
    const sel=byId('v14BinderSelect');
    if(sel){
      sel.innerHTML='<option value="all">Geral — todos os fichários</option><option value="favorites">★ Favoritas</option>'+
        V14.binders.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('');
      sel.value=V14.activeBinderId||'all';
    }
    const sort=byId('v14SortSelect');if(sort)sort.value=activeSort();
    const rename=byId('v14RenameBinder');if(rename)rename.disabled=isGeneral();
    const del=byId('v14DeleteBinder');if(del)del.disabled=isGeneral();
    const add=byId('btnOpenAdd');if(add)add.disabled=isGeneral();
    const fav=byId('v14FavoritesOnly');
    if(fav){
      fav.classList.toggle('active',isFavorites());
      fav.setAttribute('aria-pressed',String(isFavorites()));
      fav.textContent=isFavorites()?'★ Favoritas':'☆ Favoritas';
    }
    const hint=document.querySelector('.binder-hint');
    if(hint)hint.textContent=canMove()?'Arraste cartas entre bolsos · clique para detalhes':(V14.favoritesOnly?'Filtro de favoritos ativo · movimentação desativada':'Visualização filtrada/ordenada · movimentação desativada');
    if(byId('v14BinderViewScope'))byId('v14BinderViewScope').value=binderViewScope();
    syncTopbarNavigation();
    requestAnimationFrame(positionUnifiedTopbar);
  }

  async function selectBinder(id){
    V14.activeBinderId=id||'all';
    V14.favoritesOnly=isFavorites();
    currentPage=1;
    if(byId('v14BinderSearch'))byId('v14BinderSearch').value='';
    V14.binderSearchMatches=[];
    V14.binderSearchLookup.clear();
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
    if(!confirm('Excluir o fichário "'+b.name+'" e todas as cartas dele? Esta ação não pode ser desfeita.'))return;
    const {error}=await db.from('pokemon_binders').delete().eq('id',b.id).eq('user_id',currentUser.id);
    if(error){console.error(error);return toast('Não consegui excluir o fichário: '+(error.message||'erro no banco'))}
    V14.binders=V14.binders.filter(x=>x.id!==b.id);
    V14.allCards=V14.allCards.filter(x=>x.binder_id!==b.id);
    if(!V14.binders.length){
      V14.activeBinderId=null;
      await ensureFirstBinder();
    }else V14.activeBinderId=V14.binders[0].id;
    currentPage=1;
    await db.from('pokemon_settings').update({current_binder_id:V14.activeBinderId}).eq('user_id',currentUser.id);
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
      const list=[...(await fetchSeries(lang))].reverse();
      series.innerHTML='<option value="">Selecione a geração</option>'+list.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name||s.id)+'</option>').join('');
      series.disabled=false;
      byId('v14SetStatus').textContent='Escolha a geração e depois a coleção.';
    }catch(e){
      console.error(e);series.innerHTML='<option value="">Erro ao carregar gerações</option>';
      byId('v14SetStatus').textContent='Não consegui carregar as gerações.';
    }
  }
  async function loadCollectionsForGeneration(){
    const lang=byId('v14MasterLang')?.value||'pt',seriesId=byId('v14SeriesSelect')?.value||'',sets=byId('v14SetSelect');
    V14.masterPreview=null;
    byId('v14MasterStep')?.classList.add('hidden');
    byId('v14PromoNotice')?.classList.add('hidden');
    if(!sets)return;
    if(!seriesId){sets.disabled=true;sets.innerHTML='<option value="">Escolha primeiro a geração</option>';return}
    sets.disabled=true;sets.innerHTML='<option value="">Carregando coleções…</option>';
    byId('v14SetStatus').textContent='Carregando coleções da geração…';
    try{
      const serie=await fetchSeriesDetail(lang,seriesId),list=Array.isArray(serie.sets)?serie.sets:[];
      const promo=s=>/promo|black star/i.test(String(s.name||'')+' '+String(s.id||''));
      list.sort((a,b)=>Number(promo(a))-Number(promo(b))||String(a.name||'').localeCompare(String(b.name||''),'pt-BR',{numeric:true}));
      sets.innerHTML='<option value="">Selecione a coleção</option>'+list.map(s=>
        '<option value="'+esc(s.id)+'">'+esc(s.name||s.id)+(promo(s)?' · PROMOS':'')+'</option>'
      ).join('');
      sets.disabled=false;
      const promoCount=list.filter(promo).length;
      byId('v14SetStatus').textContent=list.length+' coleções nesta geração'+(promoCount?' · '+promoCount+' coleção de promos disponível':'')+'.';
    }catch(e){
      console.error(e);sets.innerHTML='<option value="">Erro ao carregar coleções</option>';
      byId('v14SetStatus').textContent='Não consegui carregar as coleções desta geração.';
    }
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
      const notice=byId('v14PromoNotice');
      if(notice){
        if(j.set.isPromoSet){
          notice.textContent='Esta é a coleção de promos da geração; as promos desta coleção entram normalmente no Master Set.';
        }else{
          notice.textContent='Promos não são misturadas automaticamente com esta coleção. Para cadastrá-las, escolha a coleção de PROMOS da mesma geração ou adicione depois pela busca, manualmente ou pelo scanner.';
        }
        notice.classList.remove('hidden');
      }
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
        (img?'<img src="'+esc(img)+'" loading="lazy" alt="'+esc(e.name)+'">':'<div class="v14-no-img" data-master-fallback="'+i+'">'+esc(e.name)+'</div>')+
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

  function hydrateMasterPreviewImages(){
    const p=V14.masterPreview;if(!p||p.set.languageCode!=='ja')return;
    const nodes=[...document.querySelectorAll('[data-master-fallback]')];
    const io=new IntersectionObserver(entries=>{
      for(const ent of entries){
        if(!ent.isIntersecting)continue;
        io.unobserve(ent.target);
        const i=+ent.target.dataset.masterFallback,e=p.entries[i];
        japaneseImageFallback({...e,languageCode:'ja'}).then(url=>{
          if(!url||!ent.target.isConnected)return;
          const img=document.createElement('img');img.src=url;img.loading='lazy';img.alt=e.name||'Carta';
          ent.target.replaceWith(img);e.imageUrl=url;
        }).catch(()=>{});
      }
    },{root:byId('v14MasterGrid'),rootMargin:'250px'});
    nodes.forEach(n=>io.observe(n));
  }

  function nextMasterBinderName(base,setId){
    const same=V14.binders.filter(b=>b.binder_kind==='set'&&b.set_id===setId);
    if(!same.length)return base;
    return base+' ('+(same.length+1)+')';
  }
  async function createMasterBinder(){
    const p=V14.masterPreview;if(!p)return;
    const btn=byId('v14CreateMaster');busy(btn,true,'Criando fichário…');
    let createdBinder=null;
    try{
      const pages=Math.max(1,Math.ceil(p.entries.length/9));
      const sortOrder=Math.max(0,...V14.binders.map(b=>+b.sort_order||0))+1;
      const binderName=nextMasterBinderName(p.set.name,p.set.id);
      const {data:binder,error:be}=await db.from('pokemon_binders').insert({
        user_id:currentUser.id,name:binderName,pages,background:'graphite',sort_order:sortOrder,binder_kind:'set',
        set_id:p.set.id,set_name:p.set.name,set_language:p.set.languageCode,master_language:p.set.languageCode,master_total:p.entries.length
      }).select('*').single();
      if(be)throw be;
      createdBinder=binder;
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
        payload.price_pending=true;
        payload.price_checked_at=null;
        return payload;
      });
      for(let i=0;i<rows.length;i+=100){
        const {error}=await db.from('pokemon_cards').insert(rows.slice(i,i+100));
        if(error)throw error;
      }

      // Troca para o novo fichário e recarrega do banco antes de renderizar.
      // Sem isto o Master Set era criado corretamente no Supabase, mas aparecia vazio até atualizar a página.
      V14.activeBinderId=binder.id;
      V14.favoritesOnly=false;
      currentPage=1;
      await db.from('pokemon_settings').update({current_binder_id:binder.id}).eq('user_id',currentUser.id);
      await loadCardsV14(false);

      if(byId('v14BinderDialog')?.open)byId('v14BinderDialog').close();
      V14.masterPreview=null;
      queueBackgroundPrices([...collection]);

      const ownedCount=rows.filter(x=>x.collection_status==='owned').length;
      const promoText=p.set.isPromoSet
        ?' Promos incluídas porque este é um set de promos.'
        :' Promos desta geração não são adicionadas automaticamente; use a coleção PROMOS, busca manual ou scanner.';
      toast('Master Set criado: '+rows.length+' entradas · '+ownedCount+' Tenho.'+promoText);
    }catch(e){
      console.error(e);
      if(createdBinder?.id){
        try{await db.from('pokemon_binders').delete().eq('id',createdBinder.id).eq('user_id',currentUser.id)}catch{}
      }
      toast('Erro ao criar Master Set: '+(e.message||e));
    }finally{busy(btn,false)}
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

    if(card.price_pending){
      const tag=document.createElement('span');tag.className='v14-price-pending';tag.textContent='Preço…';b.appendChild(tag);
    }
    return b;
  }

  function customViewPages(){
    return Math.max(1,Math.ceil(orderedViewCards().length/9));
  }
  function renderBinderV14(){
    if(!isGeneral()&&activeSort()==='manual_asc'&&binderViewScope()==='all'&&!V14.favoritesOnly){
      const out=V14.original.renderBinder();
      syncTopbarNavigation();
      return out;
    }
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
    syncTopbarNavigation();
  }

  function renderPagesGridV14(){
    if(!isGeneral()&&activeSort()==='manual_asc'&&binderViewScope()==='all'&&!V14.favoritesOnly)return V14.original.renderPagesGrid();
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
      if(existingEditing?.card_key)payload.card_key=existingEditing.card_key;
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
  async function fingerprintForCard(card){
    const url=cardImage(card);
    if(!url||url.startsWith('/'))return null;
    try{
      const r=await fetch('/api/image-proxy?url='+encodeURIComponent(url),{cache:'force-cache'});
      if(!r.ok)return null;
      const blob=await r.blob();
      const bitmap=await createImageBitmap(blob);
      const c=document.createElement('canvas');c.width=252;c.height=352;
      c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);
      bitmap.close?.();
      return imageFingerprint(c);
    }catch{return null}
  }
  async function visuallyRankCandidates(cards){
    const target=V14.scan.lastFingerprint;
    if(!target||!cards?.length)return cards||[];
    const sample=cards.slice(0,8);
    const scored=await Promise.all(sample.map(async(card,index)=>{
      const fp=await fingerprintForCard(card);
      const d=fingerprintDistance(target,fp);
      return{card,index,d};
    }));
    scored.sort((a,b)=>{
      const ad=Number.isFinite(a.d)?a.d+a.index*.045:999+a.index;
      const bd=Number.isFinite(b.d)?b.d+b.index*.045:999+b.index;
      return ad-bd;
    });
    const ranked=scored.map(x=>x.card);
    return ranked.concat(cards.slice(sample.length));
  }
  async function ocrCard(source,status){
    if(typeof ensureOCR!=='function'||!await ensureOCR())throw new Error('OCR indisponível');
    const full=scannerCardCanvas(source);
    V14.scan.lastFingerprint=imageFingerprint(full);
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
    let best=[...catalogResults].slice(0,12);
    if(!best.length){byId('ocrStatus').textContent='Scanner leu '+[hint.name,hint.number].filter(Boolean).join(' · ')+' mas não encontrou candidato seguro. Ajuste a foto ou use busca manual.';return}
    best=(await visuallyRankCandidates(best)).slice(0,6);
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
    stopScanner();V14.scan.evidenceNames.clear();V14.scan.evidenceNumbers.clear();V14.scan.lastFingerprint=null;
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

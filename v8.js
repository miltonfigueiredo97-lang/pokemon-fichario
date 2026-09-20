// Pokémon Binder BR — V11.1 behavior layer
(function(){
  'use strict';

  const $id=id=>document.getElementById(id);
  const isMobile=()=>window.matchMedia('(max-width:820px)').matches;
  let dragState=null;
  let suppressClickUntil=0;
  let liveScanStream=null;
  let liveScanTimer=null;
  let liveScanBusy=false;

  // -------------------------------------------------------------
  // MOBILE VIEW
  // -------------------------------------------------------------
  function setMobileView(view){
    const panel=$id('summaryPanel');
    const binderBtn=$id('btnMobileBinder');
    const summaryBtn=$id('btnMobileSummary');
    const showSummary=view==='summary';
    if(panel)panel.classList.toggle('mobile-open',showSummary);
    if(binderBtn)binderBtn.classList.toggle('active',!showSummary);
    if(summaryBtn)summaryBtn.classList.toggle('active',showSummary);
  }
  window.setMobileView=setMobileView;

  function installMobileNav(){
    window.addEventListener('click',e=>{
      const binder=e.target.closest&&e.target.closest('#btnMobileBinder');
      const summary=e.target.closest&&e.target.closest('#btnMobileSummary');
      const close=e.target.closest&&e.target.closest('#btnCloseSummary');
      if(!binder&&!summary&&!close)return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setMobileView(summary?'summary':'binder');
      requestAnimationFrame(fitBinder);
    },true);
  }

  // -------------------------------------------------------------
  // DESKTOP TOOL RAIL
  // -------------------------------------------------------------
  function makeTool(kind,label,title,handler){
    const b=document.createElement('button');
    b.type='button';
    b.className='v11-tool';
    b.dataset.kind=kind;
    b.textContent=label;
    b.title=title;
    b.setAttribute('aria-label',title);
    b.addEventListener('click',handler);
    return b;
  }

  function toggleSummary(force){
    const w=document.querySelector('.workspace');
    if(!w)return;
    const collapsed=typeof force==='boolean'?force:!w.classList.contains('v11-summary-collapsed');
    w.classList.toggle('v11-summary-collapsed',collapsed);
    try{localStorage.setItem('pokemonBinderSummaryCollapsed',collapsed?'1':'0')}catch(_e){}
    setTimeout(fitBinder,230);
  }

  async function toggleFullscreen(){
    const area=document.querySelector('.binder-area');
    if(!area)return;
    try{
      if(!document.fullscreenElement){
        await area.requestFullscreen();
      }else{
        await document.exitFullscreen();
      }
    }catch(_e){
      area.classList.toggle('v11-fullscreen-fallback');
      document.body.classList.toggle('v11-fullscreen-body',area.classList.contains('v11-fullscreen-fallback'));
      requestAnimationFrame(fitBinder);
    }
  }

  function installToolRail(){
    // V14.11: the desktop rail was redundant with the top bar and summary.
    // Remove any rail left by an older cached build and do not recreate it.
    document.querySelectorAll('.v11-rail').forEach(el=>el.remove());
    try{
      if(localStorage.getItem('pokemonBinderSummaryCollapsed')==='1')toggleSummary(true);
    }catch(_e){}
  }

  // -------------------------------------------------------------
  // BINDER FIT + NAV POSITIONING
  // -------------------------------------------------------------
  function px(v){const n=parseFloat(v);return Number.isFinite(n)?n:0}

  function positionPageControls(){
    const area=document.querySelector('.binder-area');
    const spread=$id('binderStage')?.querySelector('.binder-spread');
    const prev=$id('prevPage');
    const next=$id('nextPage');
    if(!area||!spread||!prev||!next)return;
    const ar=area.getBoundingClientRect();
    const sr=spread.getBoundingClientRect();
    if(sr.width<20||sr.height<20)return;

    const size=isMobile()?38:42;
    const gap=isMobile()?6:12;
    const left=Math.max(6,sr.left-ar.left-size-gap);
    const right=Math.min(ar.width-size-6,sr.right-ar.left+gap);
    const top=Math.max(48,sr.top-ar.top+sr.height/2-size/2);

    prev.style.left=left+'px';
    prev.style.top=top+'px';
    prev.style.right='auto';
    next.style.left=right+'px';
    next.style.top=top+'px';
    next.style.right='auto';
  }

  function fitBinder(){
    const stage=$id('binderStage');
    const spread=stage?.querySelector('.binder-spread');
    const cover=stage?.querySelector('.binder-cover');
    const sheet=stage?.querySelector('.binder-sheet-wrap');
    if(!stage||!spread||!sheet)return;

    const cs=getComputedStyle(stage);
    const availW=Math.max(120,stage.clientWidth-px(cs.paddingLeft)-px(cs.paddingRight));
    const availH=Math.max(160,stage.clientHeight-px(cs.paddingTop)-px(cs.paddingBottom));
    const ratio=189/264;

    if(isMobile()){
      const h=Math.floor(Math.min(availH,availW/ratio));
      const w=Math.floor(h*ratio);
      spread.style.setProperty('grid-template-columns','none','important');
      spread.style.setProperty('width',w+'px','important');
      spread.style.setProperty('height',h+'px','important');
      sheet.style.setProperty('width',w+'px','important');
      sheet.style.setProperty('height',h+'px','important');
      if(cover){cover.style.removeProperty('width');cover.style.removeProperty('height')}
    }else{
      const gap=12;
      // Mantém o fichário grande, mas nunca colado nas bordas da viewport.
      // A reserva vertical evita o corte inferior visto em telas 16:9 / browser com barra.
      const safeVertical=28;
      const safeH=Math.max(160,availH-safeVertical);
      const h=Math.floor(Math.min(safeH,(availW-gap)/(2*ratio)));
      const w=Math.floor(h*ratio);
      spread.style.setProperty('grid-template-columns',w+'px '+w+'px','important');
      spread.style.setProperty('width',(w*2+gap)+'px','important');
      spread.style.setProperty('height',h+'px','important');
      sheet.style.setProperty('width',w+'px','important');
      sheet.style.setProperty('height',h+'px','important');
      if(cover){
        cover.style.setProperty('width',w+'px','important');
        cover.style.setProperty('height',h+'px','important');
      }
    }
    requestAnimationFrame(positionPageControls);
  }
  window.fitBinderV11=fitBinder;

  function installBinderFit(){
    const stage=$id('binderStage');
    const sheet=$id('binderSheet');
    const area=document.querySelector('.binder-area');
    if(!stage)return;

    const ro=new ResizeObserver(()=>requestAnimationFrame(fitBinder));
    ro.observe(stage);
    if(area)ro.observe(area);

    if(sheet){
      const mo=new MutationObserver(()=>requestAnimationFrame(fitBinder));
      mo.observe(sheet,{childList:true,subtree:false});
    }

    window.addEventListener('resize',()=>requestAnimationFrame(fitBinder),{passive:true});
    window.visualViewport?.addEventListener('resize',()=>requestAnimationFrame(fitBinder),{passive:true});
    document.addEventListener('fullscreenchange',()=>{
      setTimeout(fitBinder,40);
      setTimeout(positionPageControls,80);
    });
    setTimeout(fitBinder,40);
    setTimeout(fitBinder,300);
  }

  // -------------------------------------------------------------
  // CARD DETAILS — FREE 3D ROTATION + ZOOM
  // -------------------------------------------------------------
  function installDetailsLabel(){
    document.querySelectorAll('[data-ctx="view"]').forEach(btn=>{
      btn.textContent='Detalhes da carta';
      btn.setAttribute('aria-label','Detalhes da carta');
    });
  }

  function installReal3D(){
    const old=$id('card3d');
    if(!old)return;
    const el=old.cloneNode(true);
    old.replaceWith(el);
    const inner=el.querySelector('.card-3d-inner');
    if(!inner)return;

    const showcase=el.closest('.card-showcase');
    let controls=showcase?.querySelector('.viewer-controls');
    if(showcase&&!controls){
      controls=document.createElement('div');
      controls.className='viewer-controls';
      controls.innerHTML='<button type="button" data-viewer="out">−</button><span>100%</span><button type="button" data-viewer="in">＋</button><button type="button" data-viewer="reset">↺</button>';
      showcase.appendChild(controls);
    }
    const zoomLabel=controls?.querySelector('span');
    const help=showcase?.querySelector('.showcase-help');
    if(help)help.textContent='Arraste para girar · roda/pinça para zoom · ↺ para centralizar';

    let rx=0,ry=0,scale=1,raf=0;
    let activePointer=null,lastX=0,lastY=0;
    let pinchStart=0,pinchScale=1;
    const pointers=new Map();

    const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
    const distance=()=>{
      const p=[...pointers.values()];
      return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
    };
    function render(){
      raf=0;
      inner.style.transform=`scale(${scale}) rotateX(${rx}deg) rotateY(${ry}deg)`;
      if(zoomLabel)zoomLabel.textContent=Math.round(scale*100)+'%';
    }
    function queue(){if(!raf)raf=requestAnimationFrame(render)}
    function reset(){
      rx=0;ry=0;scale=1;pinchStart=0;pinchScale=1;
      inner.style.transition='transform .22s ease-out';
      queue();
      setTimeout(()=>{inner.style.transition='none'},230);
    }

    el.addEventListener('pointerdown',e=>{
      e.preventDefault();
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      try{el.setPointerCapture(e.pointerId)}catch(_e){}
      if(pointers.size===1){activePointer=e.pointerId;lastX=e.clientX;lastY=e.clientY}
      if(pointers.size===2){pinchStart=distance();pinchScale=scale}
    });
    el.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId))return;
      e.preventDefault();
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size>=2){
        const d=distance();
        if(pinchStart&&d){scale=clamp(pinchScale*(d/pinchStart),.65,3.4);queue()}
        return;
      }
      if(activePointer===e.pointerId){
        const dx=e.clientX-lastX,dy=e.clientY-lastY;
        lastX=e.clientX;lastY=e.clientY;
        ry+=dx*.68;
        rx=clamp(rx-dy*.58,-88,88);
        inner.style.transition='none';
        queue();
      }
    },{passive:false});
    function release(e){
      pointers.delete(e.pointerId);
      if(activePointer===e.pointerId)activePointer=null;
      if(pointers.size===1){const [id,p]=[...pointers.entries()][0];activePointer=id;lastX=p.x;lastY=p.y}
      if(pointers.size<2){pinchStart=0;pinchScale=scale}
    }
    el.addEventListener('pointerup',release);
    el.addEventListener('pointercancel',release);
    el.addEventListener('wheel',e=>{
      e.preventDefault();
      scale=clamp(scale*(e.deltaY<0?1.11:.90),.65,3.4);
      inner.style.transition='transform .08s linear';
      queue();
    },{passive:false});
    el.addEventListener('dblclick',e=>{e.preventDefault();reset()});
    controls?.addEventListener('click',e=>{
      const b=e.target.closest('button[data-viewer]');
      if(!b)return;
      e.preventDefault();e.stopPropagation();
      if(b.dataset.viewer==='in')scale=clamp(scale*1.2,.65,3.4);
      else if(b.dataset.viewer==='out')scale=clamp(scale/1.2,.65,3.4);
      else reset();
      queue();
    });
    $id('cardDialog')?.addEventListener('close',reset);
    reset();
  }

  // -------------------------------------------------------------
  // TOUCH DRAG — long press is ONLY drag; never context menu
  // -------------------------------------------------------------
  function sourceCardById(id){
    try{
      const all=window.PB14?.allCards;
      if(Array.isArray(all)){
        const found=all.find(c=>String(c.id)===String(id));
        if(found)return found;
      }
      if(typeof collection!=='undefined'&&Array.isArray(collection))return collection.find(c=>String(c.id)===String(id))||null;
    }catch(_e){}
    return null;
  }
  function clearDrag(){
    if(!dragState)return;
    clearTimeout(dragState.timer);
    clearTimeout(dragState.edgeTimer);
    dragState.ghost?.remove();
    dragState.card?.classList.remove('v11-drag-source');
    document.querySelectorAll('.binder-pocket.v11-drop-target').forEach(p=>p.classList.remove('v11-drop-target'));
    dragState=null;
  }

  function activatePointerDrag(state){
    if(!state||dragState!==state||state.active)return;
    state.active=true;
    state.card.classList.add('v11-drag-source');
    const r=state.card.getBoundingClientRect();
    const ghost=state.card.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.className='v11-drag-ghost';
    ghost.style.width=r.width+'px';ghost.style.height=r.height+'px';
    ghost.style.left=(state.x-state.offsetX)+'px';ghost.style.top=(state.y-state.offsetY)+'px';
    document.body.appendChild(ghost);state.ghost=ghost;
    if(state.pointerType!=='mouse')navigator.vibrate?.(22);
  }

  function queueEdgePage(state,x){
    if(!state?.active)return;
    const wrap=document.querySelector('#binderStage .binder-spread')||$id('binderStage');
    if(!wrap)return;
    const r=wrap.getBoundingClientRect();
    const threshold=Math.max(42,Math.min(78,r.width*.10));
    let dir=0;
    if(x>=r.right-threshold)dir=1;
    else if(x<=r.left+threshold)dir=-1;

    const prev=$id('prevPage'),next=$id('nextPage');
    if((dir<0&&prev?.disabled)||(dir>0&&next?.disabled))dir=0;
    if(!dir){
      clearTimeout(state.edgeTimer);state.edgeTimer=null;state.edgeDir=0;return;
    }
    if(state.edgeDir===dir&&state.edgeTimer)return;
    clearTimeout(state.edgeTimer);state.edgeDir=dir;
    state.edgeTimer=setTimeout(()=>{
      if(dragState!==state||!state.active)return;
      try{window.cancelBinderPageFlipV14?.({suppress:true})}catch(_e){}
      let page=1;try{page=Number(currentPage||1)}catch(_e){}
      const target=typeof window.binderSessionTargetV14==='function'
        ? window.binderSessionTargetV14(page,dir)
        : page+dir;
      if(target<1||target===page)return;
      try{
        currentPage=target;
        renderBinder();
        renderPagesGrid();
      }catch(_e){return}
      state.edgeTimer=null;
      state.edgeDir=0;
      document.querySelectorAll('.binder-pocket.v11-drop-target').forEach(p=>p.classList.remove('v11-drop-target'));
    },380);
  }

  function installTouchDrag(){
    let lastTouch=0;
    window.addEventListener('contextmenu',e=>{
      const card=e.target.closest&&e.target.closest('.pocket-card');
      if(card&&(window.matchMedia('(pointer:coarse)').matches||Date.now()-lastTouch<2500)){
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },true);

    window.addEventListener('pointerdown',e=>{
      const card=e.target.closest&&e.target.closest('.pocket-card');
      if(!card||e.target.closest?.('.v14-favorite-star'))return;
      if(card.dataset.v14Movable==='0'||card.classList.contains('v14-no-drag'))return;
      if(e.pointerType!=='mouse')lastTouch=Date.now();
      clearDrag();
      const rect=card.getBoundingClientRect();
      const state={
        id:card.dataset.id,card,pointerId:e.pointerId,pointerType:e.pointerType,
        startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,
        offsetX:Math.max(0,Math.min(rect.width,e.clientX-rect.left)),
        offsetY:Math.max(0,Math.min(rect.height,e.clientY-rect.top)),
        active:false,ghost:null,timer:null,edgeTimer:null,edgeDir:0
      };
      dragState=state;
      if(e.pointerType!=='mouse'){
        state.timer=setTimeout(()=>activatePointerDrag(state),210);
        e.stopImmediatePropagation();
      }
    },true);

    window.addEventListener('pointermove',e=>{
      const s=dragState;
      if(!s||e.pointerId!==s.pointerId)return;
      s.x=e.clientX;s.y=e.clientY;
      const distance=Math.hypot(e.clientX-s.startX,e.clientY-s.startY);
      if(!s.active){
        if(s.pointerType==='mouse'){
          if(distance<5)return;
          activatePointerDrag(s);
        }else{
          if(distance>18){clearTimeout(s.timer);dragState=null}
          e.stopImmediatePropagation();
          return;
        }
      }
      e.preventDefault();e.stopImmediatePropagation();
      if(s.ghost){s.ghost.style.left=(e.clientX-s.offsetX)+'px';s.ghost.style.top=(e.clientY-s.offsetY)+'px'}
      document.querySelectorAll('.binder-pocket.v11-drop-target').forEach(p=>p.classList.remove('v11-drop-target'));
      const hit=document.elementFromPoint(e.clientX,e.clientY);
      hit?.closest('.binder-pocket')?.classList.add('v11-drop-target');
      queueEdgePage(s,e.clientX);
    },{capture:true,passive:false});

    window.addEventListener('pointerup',e=>{
      const s=dragState;
      if(!s||e.pointerId!==s.pointerId)return;
      clearTimeout(s.timer);clearTimeout(s.edgeTimer);
      if(s.active){
        e.preventDefault();e.stopImmediatePropagation();
        const hit=document.elementFromPoint(e.clientX,e.clientY);
        const pocket=hit?.closest('.binder-pocket');
        const source=sourceCardById(s.id);
        suppressClickUntil=Date.now()+750;
        if(source&&pocket&&typeof moveCard==='function'){
          moveCard(source,Number(pocket.dataset.page),Number(pocket.dataset.slot));
        }
      }
      clearDrag();
    },true);
    window.addEventListener('pointercancel',e=>{if(dragState&&e.pointerId===dragState.pointerId)clearDrag()},true);
    window.addEventListener('click',e=>{
      if(Date.now()<suppressClickUntil&&e.target.closest?.('.pocket-card')){
        e.preventDefault();e.stopImmediatePropagation();
      }
    },true);
  }

  // -------------------------------------------------------------
  // SEARCH — language buttons really change the data source// -------------------------------------------------------------
  // SEARCH — language buttons really change the data source
  // -------------------------------------------------------------
  function parseSmartQuery(){
    let raw=($id('searchName')?.value||'').trim();
    let number=($id('searchNumber')?.value||'').trim();
    let setHint=($id('searchSet')?.value||'').trim();
    const language=$id('searchLanguage')?.value||'all';

    if(!number){
      const full=raw.match(/(?:^|\s)([A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4})\s*\/\s*([A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4})(?=\s|$)/);
      if(full){number=`${full[1]}/${full[2]}`;raw=raw.replace(full[0],' ').replace(/\s+/g,' ').trim()}
    }
    if(!setHint&&number){
      const tail=raw.match(/^(.*\S)\s+(\d{2,4}|[A-Za-z]{2,8})$/);
      if(tail){raw=tail[1].trim();setHint=tail[2]}
    }
    if(!number){
      const single=raw.match(/^(.*\S)\s+([A-Za-z]{0,8}\d{1,4}[A-Za-z]{0,4})$/);
      if(single){raw=single[1].trim();number=single[2]}
    }
    return{raw,number,setHint,language};
  }

  function nameRelevant(cardName,query){
    if(!query)return true;
    const a=norm(cardName||''),b=norm(query||'');
    if(!a||!b)return false;
    if(a===b||a.includes(b)||b.includes(a))return true;
    const qa=b.split(' ').filter(Boolean),ca=new Set(a.split(' ').filter(Boolean));
    const hits=qa.filter(t=>ca.has(t)).length;
    return hits>=Math.max(1,Math.ceil(qa.length*.7));
  }
  function setRelevant(c,hint){
    if(!hint)return true;
    const h=norm(hint),s=norm(c.setName||''),id=norm(c.setId||'');
    return s.includes(h)||id===h||id.includes(h)||h.includes(id);
  }

  async function smartSearchCards(){
    const q=parseSmartQuery();
    if(!q.raw&&!q.number&&!q.setHint){toast('Digite nome, número ou coleção.');return}
    const btn=$id('btnSearchCards');
    busy(btn,true,'Buscando...');
    const status=$id('searchStatus');
    if(status)status.textContent='Cruzando todos os critérios informados…';

    try{
      const langs=q.language==='all'?['pt-br','en','ja']:[q.language];
      const setIds=q.setHint?await resolveCatalogSetIds(langs,q.setHint):[];
      const mypPromise=q.raw?searchMypCards(q.raw,q.number,q.setHint):Promise.resolve({cards:[],needsToken:false});
      const jpPromise=(q.language==='ja'||q.language==='all')&&q.raw?searchJapaneseOfficial(q.raw,q.number,q.setHint,{live:false}):Promise.resolve([]);
      const legacyPromise=(q.language==='en'||q.language==='all')&&q.raw?searchLegacyCards(q.raw,q.number,q.setHint,{live:false}):Promise.resolve([]);
      const [myp,jpOfficial,legacyCards,...groups]=await Promise.all([
        mypPromise,
        jpPromise,
        legacyPromise,
        ...langs.map(l=>searchTCGdex(l,q.raw,q.number,{setHint:q.setHint,setIds,live:false}))
      ]);

      const mypCards=myp.cards||[];
      const basePool=q.language==='ja'&&jpOfficial.length
        ? [...jpOfficial,...mypCards.filter(c=>c.languageCode==='ja')]
        : [...groups.flat(),...legacyCards,...jpOfficial,...mypCards];
      const limitlessVariants=q.number&&q.raw
        ? await searchLimitlessVariants(q.raw,q.number,basePool,q.language)
        : [];
      const tcgPool=[...basePool,...limitlessVariants];
      let tcg=hardFilterCatalog(dedupe(tcgPool),{number:q.number,setHint:q.setHint,setIds,language:q.language});
      let market=[];

      const maxResults=q.setHint&&!q.raw&&!q.number?400:100;
      catalogResults=rank(dedupe([...market,...tcg]),{name:q.raw,number:q.number,setHint:q.setHint,language:q.language}).slice(0,maxResults);
      populateRarityFilter();renderCatalog();

      const pt=catalogResults.filter(c=>c.languageCode==='pt-br').length;
      const jpOfficialCount=catalogResults.filter(c=>c.source==='Pokémon Japão Oficial').length;
      const criteria=[q.raw&&`nome “${q.raw}”`,q.number&&`nº ${q.number}`,q.setHint&&`coleção “${q.setHint}”`,q.language!=='all'&&q.language].filter(Boolean).join(' + ');
      if(status){
        status.textContent=`${catalogResults.length} resultado(s) · ${pt} em português${jpOfficialCount?` · ${jpOfficialCount} impressão(ões) japonesa(s) oficial(is)`:''}${criteria?` · correspondendo a: ${criteria}`:''}.`;
        if(myp.needsToken){
          const a=document.createElement('a');
          a.href='https://mypcards.github.io/mypcards-api/';
          a.target='_blank';a.rel='noopener';a.className='v11-myp-note';
          a.textContent='MYP: token oficial necessário';
          status.appendChild(document.createTextNode(' '));status.appendChild(a);
        }
      }
    }catch(err){
      console.error('Busca V11:',err);
      if(status)status.textContent='Erro ao buscar. Tente novamente.';
    }finally{busy(btn,false)}
  }
window.smartSearchCardsV11=smartSearchCards;

  function installSearchUX(){
    const select=$id('searchLanguage');
    const toolbar=document.querySelector('.catalog-toolbar');
    if(select&&toolbar&&!document.querySelector('.v11-language-tabs')){
      const tabs=document.createElement('div');
      tabs.className='v11-language-tabs';
      [['all','Todos'],['pt-br','Português'],['en','Inglês'],['ja','Japonês']].forEach(([value,label])=>{
        const b=document.createElement('button');
        b.type='button';b.className='v11-lang-btn';b.dataset.lang=value;b.textContent=label;
        b.onclick=()=>{
          select.value=value;
          tabs.querySelectorAll('.v11-lang-btn').forEach(x=>x.classList.toggle('active',x.dataset.lang===value));
          if(($id('searchName')?.value||'').trim()||($id('searchNumber')?.value||'').trim()||($id('searchSet')?.value||'').trim())smartSearchCards();
        };
        tabs.appendChild(b);
      });
      toolbar.insertAdjacentElement('afterend',tabs);
      tabs.querySelector('[data-lang="all"]')?.classList.add('active');
      select.style.display='none';
    }
    const searchBtn=$id('btnSearchCards');
    if(searchBtn)searchBtn.onclick=smartSearchCards;
    ['searchName','searchNumber','searchSet'].forEach(id=>{
      $id(id)?.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();smartSearchCards()}
      },true);
    });
  }

  // -------------------------------------------------------------
  // MYP STATUS HELP
  // -------------------------------------------------------------
  function installMypHelp(){
    const status=$id('marketStatus');
    const board=document.querySelector('.market-board');
    if(!status||!board)return;
    const sync=()=>{
      const missing=/aguardando chave|token|sem cotação br|sem cotação/i.test(status.textContent||'');
      let note=board.querySelector('.v11-myp-note');
      if(missing&&!note){
        note=document.createElement('a');
        note.className='v11-myp-note';
        note.href='https://mypcards.github.io/mypcards-api/';
        note.target='_blank';note.rel='noopener';
        note.textContent='Solicitar acesso à API MYP';
        board.appendChild(note);
      }
      if(!missing&&note)note.remove();
    };
    new MutationObserver(sync).observe(status,{childList:true,characterData:true,subtree:true});
    sync();
  }

  // -------------------------------------------------------------
  // LIVE SCANNER
  // -------------------------------------------------------------
  function stopLiveScan(){
    if(liveScanTimer){clearTimeout(liveScanTimer);liveScanTimer=null}
    liveScanBusy=false;
    if(liveScanStream){liveScanStream.getTracks().forEach(t=>t.stop());liveScanStream=null}
    const video=$id('scanVideo');if(video)video.srcObject=null;
  }
  window.stopLiveScan=stopLiveScan;

  function normalizeOCRLine(v){return String(v||'').replace(/[^\p{L}\p{N}\s.'-]/gu,' ').replace(/\s+/g,' ').trim()}
  function parseScanText(text){
    const raw=String(text||'');
    const num=raw.match(/(\d{1,4})\s*[\/|]\s*(\d{1,4})/);
    const lines=raw.split(/\n+/).map(normalizeOCRLine).filter(Boolean);
    const ignored=/^(b[aá]sico|basic|stage|est[aá]gio|hp|ability|habilidade|trainer|treinador|weakness|fraqueza|resistance|resist[eê]ncia|retreat|recuo|illus|illustrator)$/i;
    let name=lines.find(line=>!ignored.test(line)&&line.length>=3&&line.length<=28&&/[A-Za-zÀ-ÿ]{3}/.test(line)&&!/\b(ataque|damage|dano|energia|energy)\b/i.test(line))||'';
    name=name.replace(/\bHP\s*\d+.*/i,'').replace(/\b\d{2,4}\b.*$/,'').trim();
    return{name,number:num?`${num[1]}/${num[2]}`:''};
  }
  function drawScannerHints(video,canvas){
    const vw=video.videoWidth,vh=video.videoHeight;
    const frameH=Math.floor(vh*.76),frameW=Math.min(Math.floor(frameH*63/88),Math.floor(vw*.78));
    const sx=Math.max(0,Math.floor((vw-frameW)/2)),sy=Math.max(0,Math.floor((vh-frameH)/2));
    canvas.width=520;canvas.height=305;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,520,305);
    ctx.drawImage(video,sx,sy,frameW,Math.floor(frameH*.25),0,0,520,155);
    ctx.drawImage(video,sx,sy+Math.floor(frameH*.72),frameW,Math.floor(frameH*.28),0,155,520,150);
  }
  async function scanLiveFrame(){
    if(!liveScanStream||liveScanBusy)return;
    liveScanBusy=true;
    const status=$id('scanLiveStatus');
    try{
      const video=$id('scanVideo'),canvas=$id('scanCanvas');
      if(!video||!canvas||!video.videoWidth){liveScanTimer=setTimeout(scanLiveFrame,500);return}
      if(status)status.textContent='Lendo a carta automaticamente…';
      if(typeof ensureOCR!=='function'||!await ensureOCR())throw new Error('OCR indisponível');
      drawScannerHints(video,canvas);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.84));
      const result=await window.Tesseract.recognize(blob,'por+eng');
      const hint=parseScanText(result?.data?.text||'');
      if(hint.name&&(hint.number||hint.name.length>=4)){
        stopLiveScan();
        if(typeof closeDialog==='function')closeDialog('scanDialog');
        if(typeof openAddForPosition==='function')openAddForPosition(typeof currentPage!=='undefined'?currentPage:1);
        if($id('searchName'))$id('searchName').value=hint.name;
        if($id('searchNumber')&&hint.number)$id('searchNumber').value=hint.number;
        if($id('ocrStatus'))$id('ocrStatus').textContent='Detectado ao vivo: '+[hint.name,hint.number].filter(Boolean).join(' · ');
        await smartSearchCards();
        return;
      }
      if(status)status.textContent='Mantenha a carta na moldura — procurando…';
    }catch(err){
      console.warn('Scanner:',err);
      if(status)status.textContent='Procurando… ajuste distância e reflexo';
    }finally{
      liveScanBusy=false;
      if(liveScanStream)liveScanTimer=setTimeout(scanLiveFrame,1400);
    }
  }
  async function startLiveScan(){
    const status=$id('scanLiveStatus');
    stopLiveScan();
    try{
      const add=$id('addDialog');if(add?.open&&typeof closeDialog==='function')closeDialog('addDialog');
      if(typeof openDialog==='function')openDialog('scanDialog');
      if(status)status.textContent='Abrindo câmera traseira…';
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Câmera indisponível');
      liveScanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:1920}},audio:false});
      const video=$id('scanVideo');if(!video)throw new Error('Vídeo ausente');
      video.srcObject=liveScanStream;await video.play();
      if(status)status.textContent='Câmera ativa · leitura automática';
      liveScanTimer=setTimeout(scanLiveFrame,650);
    }catch(err){
      console.error(err);
      if(status)status.textContent='Não consegui abrir a câmera. Verifique a permissão do Chrome.';
    }
  }
  function installScanner(){
    const live=$id('btnLiveScan'),mobile=$id('btnMobileScan'),close=$id('btnCloseLiveScan'),manual=$id('btnScanManual'),dialog=$id('scanDialog');
    if(live)live.onclick=startLiveScan;
    if(mobile)mobile.onclick=startLiveScan;
    if(close)close.onclick=()=>{stopLiveScan();if(typeof closeDialog==='function')closeDialog('scanDialog')};
    if(manual)manual.onclick=()=>{stopLiveScan();if(typeof closeDialog==='function')closeDialog('scanDialog');if(typeof openAddForPosition==='function')openAddForPosition(typeof currentPage!=='undefined'?currentPage:1)};
    dialog?.addEventListener('close',stopLiveScan);
  }

  // -------------------------------------------------------------
  // INSTALL
  // -------------------------------------------------------------
  function install(){
    installDetailsLabel();
    installMobileNav();
    installToolRail();
    installBinderFit();
    installReal3D();
    installTouchDrag();
    installSearchUX();
    installMypHelp();
    installScanner();
    requestAnimationFrame(fitBinder);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})();

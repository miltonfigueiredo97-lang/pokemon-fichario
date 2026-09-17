// Pokémon Binder BR — V11 binder-first behavior layer
(function(){
  'use strict';

  const $id = id => document.getElementById(id);
  const isMobile = () => window.matchMedia('(max-width:820px)').matches;
  let dragState = null;
  let suppressClickUntil = 0;
  let liveScanStream = null;
  let liveScanTimer = null;
  let liveScanBusy = false;

  // -------------------------------------------------------------
  // LAYOUT: remove toolbar, move page controls beside the binder,
  // add collapsible summary and real fullscreen.
  // -------------------------------------------------------------
  function moveNavigationIntoStage(){
    const stage = $id('binderStage');
    const prev = $id('prevPage');
    const next = $id('nextPage');
    const center = document.querySelector('.page-center');
    if(!stage || !prev || !next || !center) return;

    prev.classList.add('v11-page-prev');
    next.classList.add('v11-page-next');
    center.classList.add('v11-page-hud');
    stage.appendChild(prev);
    stage.appendChild(next);
    stage.appendChild(center);
  }

  function makeTool(kind, text, title, onClick){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'v11-stage-tool';
    b.dataset.v11 = kind;
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  }

  function installStageTools(){
    const stage = $id('binderStage');
    const workspace = document.querySelector('.workspace');
    if(!stage || !workspace || stage.querySelector('.v11-stage-tools')) return;

    const rail = document.createElement('div');
    rail.className = 'v11-stage-tools';

    rail.appendChild(makeTool('add','＋','Adicionar cartas',()=>{
      const b=$id('btnOpenAdd'); if(b) b.click();
    }));
    rail.appendChild(makeTool('friends','♙','Amigos',()=>{
      const b=$id('btnFriends'); if(b) b.click();
    }));
    const summaryBtn = makeTool('summary','▤','Mostrar/ocultar resumo',()=>{
      workspace.classList.toggle('v11-summary-collapsed');
      summaryBtn.textContent = workspace.classList.contains('v11-summary-collapsed') ? '▥' : '▤';
      setTimeout(fitBinder,230);
    });
    rail.appendChild(summaryBtn);
    rail.appendChild(makeTool('fullscreen','⛶','Fichário em tela cheia',toggleBinderFullscreen));
    rail.appendChild(makeTool('settings','⚙','Aparência',()=>{
      const b=$id('btnSummarySettings')||$id('btnBackground'); if(b) b.click();
    }));
    rail.appendChild(makeTool('logout','↗','Sair',()=>{
      const b=$id('btnLogout'); if(b) b.click();
    }));
    stage.appendChild(rail);
  }

  function setMobileView(view){
    const panel = $id('summaryPanel');
    const binderBtn = $id('btnMobileBinder');
    const summaryBtn = $id('btnMobileSummary');
    const showSummary = view === 'summary';
    if(panel) panel.classList.toggle('mobile-open',showSummary);
    if(binderBtn) binderBtn.classList.toggle('active',!showSummary);
    if(summaryBtn) summaryBtn.classList.toggle('active',showSummary);
  }
  window.setMobileView = setMobileView;

  function installMobileNav(){
    window.addEventListener('click',e=>{
      const binder=e.target.closest&&e.target.closest('#btnMobileBinder');
      const summary=e.target.closest&&e.target.closest('#btnMobileSummary');
      const close=e.target.closest&&e.target.closest('#btnCloseSummary');
      if(!binder&&!summary&&!close)return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setMobileView(summary?'summary':'binder');
    },true);
  }

  function fitBinder(){
    const stage=$id('binderStage');
    const spread=stage&&stage.querySelector('.binder-spread');
    const cover=stage&&stage.querySelector('.binder-cover');
    const sheet=stage&&stage.querySelector('.binder-sheet-wrap');
    if(!stage||!spread||!sheet)return;
    const r=stage.getBoundingClientRect();
    if(r.width<120||r.height<180)return;

    const pageRatio=189/264;
    if(isMobile()){
      const availW=Math.max(180,r.width-10);
      const availH=Math.max(240,r.height-10);
      const h=Math.floor(Math.min(availH,availW/pageRatio));
      const w=Math.floor(h*pageRatio);
      spread.style.width=w+'px';
      spread.style.height=h+'px';
      spread.style.gridTemplateColumns='none';
      sheet.style.width=w+'px';
      sheet.style.height=h+'px';
      if(cover){cover.style.width='';cover.style.height='';}
    }else{
      const gap=12;
      const sideReserve=112;
      const availW=Math.max(500,r.width-sideReserve);
      const availH=Math.max(420,r.height-22);
      const h=Math.floor(Math.min(availH,(availW-gap)/(2*pageRatio),930));
      const w=Math.floor(h*pageRatio);
      spread.style.gridTemplateColumns=w+'px '+w+'px';
      spread.style.width=(w*2+gap)+'px';
      spread.style.height=h+'px';
      sheet.style.width=w+'px';
      sheet.style.height=h+'px';
      if(cover){cover.style.width=w+'px';cover.style.height=h+'px';}
    }
  }
  window.fitBinderV11=fitBinder;

  function installBinderFit(){
    const stage=$id('binderStage');
    const sheet=$id('binderSheet');
    if(!stage)return;
    const ro=new ResizeObserver(()=>requestAnimationFrame(fitBinder));
    ro.observe(stage);
    if(sheet){
      const mo=new MutationObserver(()=>requestAnimationFrame(fitBinder));
      mo.observe(sheet,{childList:true});
    }
    window.addEventListener('resize',()=>requestAnimationFrame(fitBinder),{passive:true});
    if(window.visualViewport)window.visualViewport.addEventListener('resize',()=>requestAnimationFrame(fitBinder),{passive:true});
    setTimeout(fitBinder,60);
    setTimeout(fitBinder,350);
    setTimeout(fitBinder,900);
  }

  async function toggleBinderFullscreen(){
    const stage=$id('binderStage');
    if(!stage)return;
    try{
      if(document.fullscreenElement===stage){
        await document.exitFullscreen();
        return;
      }
      if(document.fullscreenElement){
        await document.exitFullscreen();
      }
      if(stage.requestFullscreen){
        await stage.requestFullscreen();
      }else{
        stage.classList.toggle('v11-pseudo-fullscreen');
        document.body.classList.toggle('v11-lock-scroll',stage.classList.contains('v11-pseudo-fullscreen'));
        fitBinder();
      }
    }catch(_e){
      stage.classList.toggle('v11-pseudo-fullscreen');
      document.body.classList.toggle('v11-lock-scroll',stage.classList.contains('v11-pseudo-fullscreen'));
      fitBinder();
    }
  }

  function installFullscreenEffects(){
    const stage=$id('binderStage');
    if(!stage)return;
    document.addEventListener('fullscreenchange',()=>{
      stage.classList.toggle('v11-fullscreen',document.fullscreenElement===stage);
      setTimeout(fitBinder,50);
    });
    stage.addEventListener('pointermove',e=>{
      if(document.fullscreenElement!==stage&&!stage.classList.contains('v11-pseudo-fullscreen'))return;
      if(e.pointerType!=='mouse')return;
      const spread=stage.querySelector('.binder-spread');
      if(!spread)return;
      const r=stage.getBoundingClientRect();
      const nx=((e.clientX-r.left)/r.width-.5)*2;
      const ny=((e.clientY-r.top)/r.height-.5)*2;
      spread.style.transform=`rotateX(${-ny*2.2}deg) rotateY(${nx*2.8}deg) translateZ(8px)`;
    });
    stage.addEventListener('pointerleave',()=>{
      const spread=stage.querySelector('.binder-spread');
      if(spread)spread.style.transform='rotateX(0deg) rotateY(0deg) translateZ(0)';
    });
  }

  // -------------------------------------------------------------
  // CARD VIEWER: free 3D rotation + zoom + pan when zoomed.
  // -------------------------------------------------------------
  function installReal3DViewer(){
    const old=$id('card3d');
    if(!old)return;
    const el=old.cloneNode(true);
    old.replaceWith(el);
    const inner=el.querySelector('.card-3d-inner');
    if(!inner)return;
    const showcase=el.closest('.card-showcase');

    let controls=showcase&&showcase.querySelector('.viewer-controls');
    if(showcase&&!controls){
      controls=document.createElement('div');
      controls.className='viewer-controls';
      controls.innerHTML='<button type="button" data-viewer="out" aria-label="Diminuir">−</button><span>100%</span><button type="button" data-viewer="in" aria-label="Aumentar">＋</button><button type="button" data-viewer="reset" aria-label="Resetar">↺</button>';
      showcase.appendChild(controls);
    }
    const zoomLabel=controls&&controls.querySelector('span');
    const help=showcase&&showcase.querySelector('.showcase-help');
    if(help)help.textContent='Arraste para girar · zoom com roda/pinça · com zoom, arraste para mover';

    let rx=0,ry=0,scale=1,tx=0,ty=0,raf=0;
    const pointers=new Map();
    let lastX=0,lastY=0,activePointer=null,pinchStart=0,pinchScale=1,lastMid=null;
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const queue=()=>{if(!raf)raf=requestAnimationFrame(render)};
    function render(){
      raf=0;
      inner.style.transform=`translate3d(${tx}px,${ty}px,0) scale(${scale}) rotateX(${rx}deg) rotateY(${ry}deg)`;
      if(zoomLabel)zoomLabel.textContent=Math.round(scale*100)+'%';
    }
    function reset(){
      rx=0;ry=0;scale=1;tx=0;ty=0;pinchStart=0;pinchScale=1;lastMid=null;
      inner.style.transition='transform .22s ease-out';
      queue();
      setTimeout(()=>{inner.style.transition='none'},230);
    }
    function dist(){
      const p=[...pointers.values()];
      return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
    }
    function mid(){
      const p=[...pointers.values()];
      if(p.length<2)return null;
      return{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};
    }

    el.addEventListener('pointerdown',e=>{
      e.preventDefault();
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      try{el.setPointerCapture(e.pointerId)}catch(_e){}
      if(pointers.size===1){activePointer=e.pointerId;lastX=e.clientX;lastY=e.clientY}
      if(pointers.size===2){pinchStart=dist();pinchScale=scale;lastMid=mid()}
    });
    el.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId))return;
      e.preventDefault();
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size>=2){
        const d=dist();
        const m=mid();
        if(pinchStart>0&&d>0)scale=clamp(pinchScale*(d/pinchStart),.7,3.4);
        if(m&&lastMid){tx+=m.x-lastMid.x;ty+=m.y-lastMid.y;lastMid=m}
        queue();
        return;
      }
      if(activePointer!==e.pointerId)return;
      const dx=e.clientX-lastX,dy=e.clientY-lastY;
      lastX=e.clientX;lastY=e.clientY;
      if(scale>1.08||e.shiftKey){
        tx+=dx;ty+=dy;
      }else{
        ry+=dx*.72;
        rx=clamp(rx-dy*.58,-84,84);
      }
      inner.style.transition='none';
      queue();
    },{passive:false});
    function release(e){
      pointers.delete(e.pointerId);
      if(activePointer===e.pointerId)activePointer=null;
      if(pointers.size===1){const [id,p]=[...pointers.entries()][0];activePointer=id;lastX=p.x;lastY=p.y}
      if(pointers.size<2){pinchStart=0;pinchScale=scale;lastMid=null}
    }
    el.addEventListener('pointerup',release);
    el.addEventListener('pointercancel',release);
    el.addEventListener('wheel',e=>{
      e.preventDefault();
      scale=clamp(scale*(e.deltaY<0?1.12:.90),.7,3.4);
      if(scale<=1.02){tx=0;ty=0}
      queue();
    },{passive:false});
    el.addEventListener('dblclick',e=>{e.preventDefault();reset()});
    if(controls)controls.addEventListener('click',e=>{
      const b=e.target.closest('button[data-viewer]');
      if(!b)return;
      e.preventDefault();e.stopPropagation();
      if(b.dataset.viewer==='in')scale=clamp(scale*1.20,.7,3.4);
      else if(b.dataset.viewer==='out')scale=clamp(scale/1.20,.7,3.4);
      else reset();
      if(scale<=1.02){tx=0;ty=0}
      queue();
    });
    const img=$id('card3dImage');
    if(img)img.addEventListener('load',reset);
    const dialog=$id('cardDialog');
    if(dialog)dialog.addEventListener('close',reset);
    reset();
  }

  // -------------------------------------------------------------
  // TOUCH DRAG: long press is only drag, never opens context menu.
  // -------------------------------------------------------------
  function sourceCardById(id){
    try{
      if(typeof collection!=='undefined'&&Array.isArray(collection))return collection.find(c=>String(c.id)===String(id))||null;
    }catch(_e){}
    return null;
  }
  function clearDrag(){
    if(!dragState)return;
    clearTimeout(dragState.timer);
    if(dragState.ghost)dragState.ghost.remove();
    if(dragState.card)dragState.card.classList.remove('v11-drag-source');
    document.querySelectorAll('.binder-pocket.v11-drop-target').forEach(p=>p.classList.remove('v11-drop-target'));
    dragState=null;
  }
  function installTouchDrag(){
    let lastTouch=0;
    window.addEventListener('contextmenu',e=>{
      const card=e.target.closest&&e.target.closest('.pocket-card');
      if(card&&(Date.now()-lastTouch<2000||window.matchMedia('(pointer:coarse)').matches)){
        e.preventDefault();e.stopImmediatePropagation();
      }
    },true);
    window.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse')return;
      const card=e.target.closest&&e.target.closest('.pocket-card');
      if(!card)return;
      lastTouch=Date.now();
      clearDrag();
      const state={id:card.dataset.id,card,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false,ghost:null,timer:null};
      state.timer=setTimeout(()=>{
        if(dragState!==state)return;
        state.active=true;
        card.classList.add('v11-drag-source');
        const rect=card.getBoundingClientRect();
        const ghost=card.cloneNode(true);
        ghost.removeAttribute('id');ghost.className='v11-drag-ghost';
        ghost.style.width=rect.width+'px';ghost.style.height=rect.height+'px';ghost.style.left=state.x+'px';ghost.style.top=state.y+'px';
        document.body.appendChild(ghost);state.ghost=ghost;
        try{card.setPointerCapture(state.pointerId)}catch(_e){}
        if(navigator.vibrate)navigator.vibrate(22);
      },210);
      dragState=state;
      // capture stops the old 620ms context-menu long press in script.js
      e.stopImmediatePropagation();
    },true);
    window.addEventListener('pointermove',e=>{
      const s=dragState;
      if(!s||e.pointerType==='mouse'||e.pointerId!==s.pointerId)return;
      s.x=e.clientX;s.y=e.clientY;
      if(!s.active){
        if(Math.hypot(e.clientX-s.startX,e.clientY-s.startY)>18){clearTimeout(s.timer);dragState=null}
        e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();e.stopImmediatePropagation();
      if(s.ghost){s.ghost.style.left=e.clientX+'px';s.ghost.style.top=e.clientY+'px'}
      document.querySelectorAll('.binder-pocket.v11-drop-target').forEach(p=>p.classList.remove('v11-drop-target'));
      const hit=document.elementFromPoint(e.clientX,e.clientY);
      const pocket=hit&&hit.closest('.binder-pocket');
      if(pocket)pocket.classList.add('v11-drop-target');
    },{capture:true,passive:false});
    window.addEventListener('pointerup',e=>{
      const s=dragState;
      if(!s||e.pointerType==='mouse'||e.pointerId!==s.pointerId)return;
      clearTimeout(s.timer);
      if(s.active){
        e.preventDefault();e.stopImmediatePropagation();
        const hit=document.elementFromPoint(e.clientX,e.clientY);
        const pocket=hit&&hit.closest('.binder-pocket');
        const source=sourceCardById(s.id);
        if(source&&pocket&&typeof moveCard==='function'){
          suppressClickUntil=Date.now()+700;
          moveCard(source,Number(pocket.dataset.page),Number(pocket.dataset.slot));
        }
      }
      clearDrag();
    },true);
    window.addEventListener('pointercancel',e=>{if(dragState&&e.pointerId===dragState.pointerId)clearDrag()},true);
    window.addEventListener('click',e=>{
      if(Date.now()<suppressClickUntil&&e.target.closest&&e.target.closest('.pocket-card')){e.preventDefault();e.stopImmediatePropagation()}
    },true);
  }

  // -------------------------------------------------------------
  // SEARCH: strict name/number matching + real language buttons.
  // -------------------------------------------------------------
  function parseSearch(){
    let raw=($id('searchName')?.value||'').trim();
    let number=($id('searchNumber')?.value||'').trim();
    let setHint=($id('searchSet')?.value||'').trim();
    const language=$id('searchLanguage')?.value||'all';

    const full=raw.match(/(?:^|\s)(\d{1,4})\s*\/\s*(\d{1,4})(?=\s|$)/);
    if(full&&!number){number=`${full[1]}/${full[2]}`;raw=raw.replace(full[0],' ').replace(/\s+/g,' ').trim()}
    if(!number){
      const single=raw.match(/^(.*\S)\s+(\d{1,4})$/);
      if(single){raw=single[1].trim();number=single[2]}
    }
    if(!setHint){
      const setTail=raw.match(/^(.*\S)\s+(\d{3}|[A-Za-z]{2,8})$/);
      if(setTail&&number){raw=setTail[1].trim();setHint=setTail[2]}
    }
    return{raw,number,setHint,language};
  }

  function relevantName(cardName,query){
    if(!query)return true;
    const a=norm(cardName||''),b=norm(query||'');
    if(!a||!b)return false;
    if(a===b||a.includes(b)||b.includes(a))return true;
    const qa=b.split(' ').filter(Boolean),ca=new Set(a.split(' ').filter(Boolean));
    const hit=qa.filter(t=>ca.has(t)).length;
    return hit>=Math.max(1,Math.ceil(qa.length*.67));
  }
  function setRelevant(c,hint){
    if(!hint)return true;
    const h=norm(hint),s=norm(c.setName||''),id=norm(c.setId||'');
    return s.includes(h)||id===h||id.includes(h)||h.includes(id);
  }

  async function smartSearchCards(){
    const q=parseSearch();
    if(!q.raw&&!q.number){toast('Digite nome ou número.');return}
    const btn=$id('btnSearchCards');
    busy(btn,true,'Buscando...');
    const status=$id('searchStatus');
    if(status)status.textContent='Buscando por nome + número + coleção…';
    try{
      // Always use EN as a pivot because its catalogue coverage is strongest,
      // then resolve the same IDs in PT-BR/JP when requested.
      const order=q.language==='all'?['pt-br','en','ja']:[q.language,'en','pt-br','ja'].filter((v,i,a)=>a.indexOf(v)===i);
      const tasks=order.map(l=>searchTCGdex(l,q.raw,q.number));
      const mypPromise=(q.language==='ja')?Promise.resolve({cards:[],needsToken:false}):searchMypCards(q.raw,q.number,q.setHint);
      const[myp,...groups]=await Promise.all([mypPromise,...tasks]);
      let tcg=dedupe(groups.flat());

      const np=numParts(q.number);
      tcg=tcg.filter(c=>{
        if(q.raw&&!relevantName(c.name,q.raw))return false;
        if(np.n&&numParts(c.number).n!==np.n)return false;
        return true;
      });

      // If a language was explicitly selected, try to resolve candidate IDs
      // directly in that language instead of merely hiding EN cards.
      if(q.language!=='all'){
        const direct=tcg.filter(c=>c.languageCode===q.language);
        const ids=[...new Set(tcg.map(c=>c.apiId).filter(Boolean))].slice(0,28);
        const localized=(await Promise.all(ids.map(id=>fetchTCGdexCard(q.language,id)))).filter(Boolean).filter(c=>{
          if(q.raw&&!relevantName(c.name,q.raw))return false;
          if(np.n&&numParts(c.number).n!==np.n)return false;
          return true;
        });
        tcg=dedupe([...direct,...localized]).filter(c=>c.languageCode===q.language);
      }

      if(q.setHint){
        const setMatches=tcg.filter(c=>setRelevant(c,q.setHint));
        if(setMatches.length)tcg=setMatches;
      }

      let market=(myp.cards||[]).filter(c=>{
        if(q.raw&&!relevantName(c.name,q.raw))return false;
        if(np.n&&numParts(c.number).n!==np.n)return false;
        if(q.setHint&&!setRelevant(c,q.setHint))return false;
        if(q.language!=='all'&&c.languageCode!==q.language)return false;
        return true;
      });

      catalogResults=rank(dedupe([...market,...tcg]),{name:q.raw,number:q.number,setHint:q.setHint,language:q.language}).slice(0,72);
      populateRarityFilter();
      renderCatalog();
      const br=catalogResults.filter(c=>c.languageCode==='pt-br').length;
      if(status){
        status.textContent=`${catalogResults.length} resultado(s) · ${br} em português.`;
        if(myp.needsToken){
          const a=document.createElement('a');
          a.href='https://mypcards.github.io/mypcards-api/';
          a.target='_blank';a.rel='noopener';a.className='v11-myp-note';
          a.textContent='MYP Cards: falta o token oficial da API';
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
      const opts=[['all','Todos'],['pt-br','Português'],['en','Inglês'],['ja','Japonês']];
      opts.forEach(([value,label])=>{
        const b=document.createElement('button');
        b.type='button';b.className='v11-lang-btn';b.dataset.lang=value;b.textContent=label;
        b.onclick=()=>{
          select.value=value;
          tabs.querySelectorAll('.v11-lang-btn').forEach(x=>x.classList.toggle('active',x.dataset.lang===value));
          if(($id('searchName')?.value||'').trim()||($id('searchNumber')?.value||'').trim())smartSearchCards();
        };
        tabs.appendChild(b);
      });
      toolbar.insertAdjacentElement('afterend',tabs);
      tabs.querySelector('[data-lang="all"]').classList.add('active');
      select.style.display='none';
    }
    const searchBtn=$id('btnSearchCards');
    if(searchBtn)searchBtn.onclick=smartSearchCards;
    ['searchName','searchNumber','searchSet'].forEach(id=>{
      const el=$id(id);if(!el)return;
      el.addEventListener('keydown',e=>{
        if(e.key==='Enter'){
          e.preventDefault();e.stopImmediatePropagation();smartSearchCards();
        }
      },true);
    });
  }

  // -------------------------------------------------------------
  // MYP API status helper. The API is official, but the token is
  // issued by MYP support, not generated by this app.
  // -------------------------------------------------------------
  function installMypHelp(){
    const board=document.querySelector('.market-board');
    const status=$id('marketStatus');
    if(!board||!status)return;
    const update=()=>{
      let note=board.querySelector('.v11-myp-note');
      const missing=/aguardando chave|token|sem cotação br automática/i.test(status.textContent||'');
      if(missing&&!note){
        note=document.createElement('a');
        note.className='v11-myp-note';
        note.href='https://mypcards.github.io/mypcards-api/';
        note.target='_blank';note.rel='noopener';
        note.textContent='API oficial MYP';
        board.appendChild(note);
      }else if(!missing&&note){note.remove()}
    };
    new MutationObserver(update).observe(status,{childList:true,characterData:true,subtree:true});
    update();
  }

  // -------------------------------------------------------------
  // LIVE SCANNER (keeps camera inside PWA; OCR remains fallback).
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
      const hint=parseScanText(result&&result.data?result.data.text:'');
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
      const add=$id('addDialog');if(add&&add.open&&typeof closeDialog==='function')closeDialog('addDialog');
      if(typeof openDialog==='function')openDialog('scanDialog');
      if(status)status.textContent='Abrindo câmera traseira…';
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Câmera indisponível');
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
    if(dialog)dialog.addEventListener('close',stopLiveScan);
  }

  function installDetailsLabel(){
    document.querySelectorAll('[data-ctx="view"]').forEach(btn=>{btn.textContent='Detalhes da carta';btn.setAttribute('aria-label','Detalhes da carta')});
  }

  function install(){
    installDetailsLabel();
    moveNavigationIntoStage();
    installStageTools();
    installMobileNav();
    installBinderFit();
    installFullscreenEffects();
    installReal3DViewer();
    installTouchDrag();
    installSearchUX();
    installMypHelp();
    installScanner();
    requestAnimationFrame(fitBinder);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})();

// Pokémon Binder BR — V10 behavior layer
(function(){
  'use strict';

  const $id = id => document.getElementById(id);
  let dragState = null;
  let suppressClickUntil = 0;
  let liveScanStream = null;
  let liveScanTimer = null;
  let liveScanBusy = false;

  function isMobile(){ return window.matchMedia('(max-width: 820px)').matches; }

  function setMobileView(view){
    const panel = $id('summaryPanel');
    const binderBtn = $id('btnMobileBinder');
    const summaryBtn = $id('btnMobileSummary');
    const showSummary = view === 'summary';
    if(panel) panel.classList.toggle('mobile-open', showSummary);
    if(binderBtn) binderBtn.classList.toggle('active', !showSummary);
    if(summaryBtn) summaryBtn.classList.toggle('active', showSummary);
  }
  window.setMobileView = setMobileView;

  function installMobileNav(){
    window.addEventListener('click', function(e){
      const binder = e.target.closest && e.target.closest('#btnMobileBinder');
      const summary = e.target.closest && e.target.closest('#btnMobileSummary');
      const close = e.target.closest && e.target.closest('#btnCloseSummary');
      if(!binder && !summary && !close) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setMobileView(summary ? 'summary' : 'binder');
    }, true);
  }

  function installDetailsLabel(){
    document.querySelectorAll('[data-ctx="view"]').forEach(btn => {
      btn.textContent = 'Detalhes da carta';
      btn.setAttribute('aria-label','Detalhes da carta');
    });
  }

  function fitBinder(){
    const stage = $id('binderStage');
    const spread = stage && stage.querySelector('.binder-spread');
    const cover = stage && stage.querySelector('.binder-cover');
    const sheet = stage && stage.querySelector('.binder-sheet-wrap');
    if(!stage || !spread || !sheet) return;

    const r = stage.getBoundingClientRect();
    if(r.width < 50 || r.height < 50) return;
    const ratio = 189 / 264;

    if(isMobile()){
      const availW = Math.max(120, r.width - 16);
      const availH = Math.max(180, r.height - 18);
      const h = Math.floor(Math.min(availH, availW / ratio));
      const w = Math.floor(h * ratio);
      spread.style.gridTemplateColumns = 'none';
      spread.style.width = w + 'px';
      spread.style.height = h + 'px';
      sheet.style.width = w + 'px';
      sheet.style.height = h + 'px';
      if(cover){ cover.style.width=''; cover.style.height=''; }
    }else{
      const gap = 12;
      const availW = Math.max(400, r.width - 40);
      const availH = Math.max(320, r.height - 34);
      const h = Math.floor(Math.min(availH, (availW - gap) / (2 * ratio), 690));
      const w = Math.floor(h * ratio);
      spread.style.gridTemplateColumns = w + 'px ' + w + 'px';
      spread.style.width = (w * 2 + gap) + 'px';
      spread.style.height = h + 'px';
      sheet.style.width = w + 'px';
      sheet.style.height = h + 'px';
      if(cover){ cover.style.width = w + 'px'; cover.style.height = h + 'px'; }
    }
  }
  window.fitBinderV10 = fitBinder;

  function installBinderFit(){
    const stage = $id('binderStage');
    const sheet = $id('binderSheet');
    if(!stage) return;
    const ro = new ResizeObserver(() => requestAnimationFrame(fitBinder));
    ro.observe(stage);
    if(sheet){
      const mo = new MutationObserver(() => requestAnimationFrame(fitBinder));
      mo.observe(sheet,{childList:true,subtree:false});
    }
    window.addEventListener('resize', () => requestAnimationFrame(fitBinder), {passive:true});
    if(window.visualViewport) window.visualViewport.addEventListener('resize', () => requestAnimationFrame(fitBinder), {passive:true});
    setTimeout(fitBinder,50);
    setTimeout(fitBinder,350);
  }

  function installReal3D(){
    const old = $id('card3d');
    if(!old) return;

    const el = old.cloneNode(true);
    old.replaceWith(el);
    const inner = el.querySelector('.card-3d-inner');
    if(!inner) return;

    const showcase = el.closest('.card-showcase');
    let controls = showcase && showcase.querySelector('.viewer-controls');
    if(showcase && !controls){
      controls = document.createElement('div');
      controls.className = 'viewer-controls';
      controls.innerHTML = '<button type="button" data-viewer="out">−</button><span>100%</span><button type="button" data-viewer="in">＋</button><button type="button" data-viewer="reset">↺</button>';
      showcase.appendChild(controls);
    }
    const zoomLabel = controls && controls.querySelector('span');
    const help = showcase && showcase.querySelector('.showcase-help');
    if(help) help.textContent = 'Arraste para girar · roda/pinça para zoom · ↺ para resetar';

    let rx = 0;
    let ry = 0;
    let scale = 1;
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    let activePointer = null;
    const pointers = new Map();
    let pinchStart = 0;
    let pinchScale = 1;

    function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
    function queue(){ if(!raf) raf=requestAnimationFrame(render); }
    function render(){
      raf = 0;
      inner.style.transform = `scale(${scale}) rotateX(${rx}deg) rotateY(${ry}deg)`;
      if(zoomLabel) zoomLabel.textContent = Math.round(scale*100) + '%';
    }
    function reset(){
      rx=0; ry=0; scale=1; pinchStart=0; pinchScale=1;
      inner.style.transition='transform .22s ease-out';
      queue();
      setTimeout(()=>{ inner.style.transition='none'; },230);
    }
    function distance(){
      const p=[...pointers.values()];
      if(p.length<2) return 0;
      return Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
    }

    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      try{ el.setPointerCapture(e.pointerId); }catch(_e){}
      if(pointers.size===1){
        activePointer=e.pointerId;
        lastX=e.clientX; lastY=e.clientY;
      }else if(pointers.size===2){
        pinchStart=distance();
        pinchScale=scale;
      }
    });

    el.addEventListener('pointermove', e => {
      if(!pointers.has(e.pointerId)) return;
      e.preventDefault();
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size>=2){
        const d=distance();
        if(pinchStart>0 && d>0){
          scale=clamp(pinchScale*(d/pinchStart),0.65,2.8);
          queue();
        }
        return;
      }
      if(activePointer===e.pointerId){
        const dx=e.clientX-lastX;
        const dy=e.clientY-lastY;
        lastX=e.clientX; lastY=e.clientY;
        ry += dx*0.65;
        rx = clamp(rx-dy*0.55,-82,82);
        inner.style.transition='none';
        queue();
      }
    },{passive:false});

    function release(e){
      pointers.delete(e.pointerId);
      if(activePointer===e.pointerId) activePointer=null;
      if(pointers.size===1){
        const [id,p]=[...pointers.entries()][0];
        activePointer=id; lastX=p.x; lastY=p.y;
      }
      if(pointers.size<2){ pinchStart=0; pinchScale=scale; }
    }
    el.addEventListener('pointerup',release);
    el.addEventListener('pointercancel',release);

    el.addEventListener('wheel', e => {
      e.preventDefault();
      scale=clamp(scale*(e.deltaY<0?1.10:0.90),0.65,2.8);
      inner.style.transition='transform .08s linear';
      queue();
    },{passive:false});

    el.addEventListener('dblclick', e => { e.preventDefault(); reset(); });

    if(controls){
      controls.addEventListener('click', e => {
        const b=e.target.closest('button[data-viewer]');
        if(!b) return;
        e.preventDefault(); e.stopPropagation();
        if(b.dataset.viewer==='in') scale=clamp(scale*1.18,0.65,2.8);
        else if(b.dataset.viewer==='out') scale=clamp(scale/1.18,0.65,2.8);
        else reset();
        queue();
      });
    }

    const dialog=$id('cardDialog');
    if(dialog) dialog.addEventListener('close', reset);
    reset();
  }

  function sourceCardById(id){
    try{
      if(typeof collection!=='undefined' && Array.isArray(collection)) return collection.find(c=>String(c.id)===String(id))||null;
    }catch(_e){}
    return null;
  }

  function clearDrag(){
    if(!dragState) return;
    clearTimeout(dragState.timer);
    if(dragState.ghost) dragState.ghost.remove();
    if(dragState.card) dragState.card.classList.remove('v10-drag-source');
    document.querySelectorAll('.binder-pocket.v10-drop-target').forEach(p=>p.classList.remove('v10-drop-target'));
    dragState=null;
  }

  function installTouchDrag(){
    let lastTouchAt=0;

    window.addEventListener('contextmenu', e => {
      const card=e.target.closest && e.target.closest('.pocket-card');
      if(card && (Date.now()-lastTouchAt<1800 || window.matchMedia('(pointer:coarse)').matches)){
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },true);

    window.addEventListener('pointerdown', e => {
      if(e.pointerType==='mouse') return;
      const card=e.target.closest && e.target.closest('.pocket-card');
      if(!card) return;
      lastTouchAt=Date.now();
      clearDrag();
      const state={
        id:card.dataset.id,card,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,
        x:e.clientX,y:e.clientY,active:false,ghost:null,timer:null
      };
      state.timer=setTimeout(()=>{
        if(dragState!==state) return;
        state.active=true;
        card.classList.add('v10-drag-source');
        const rect=card.getBoundingClientRect();
        const ghost=card.cloneNode(true);
        ghost.removeAttribute('id');
        ghost.className='v10-drag-ghost';
        ghost.style.width=rect.width+'px';
        ghost.style.height=rect.height+'px';
        ghost.style.left=state.x+'px';
        ghost.style.top=state.y+'px';
        document.body.appendChild(ghost);
        state.ghost=ghost;
        try{ card.setPointerCapture(state.pointerId); }catch(_e){}
        if(navigator.vibrate) navigator.vibrate(20);
      },210);
      dragState=state;
      e.stopPropagation();
    },true);

    window.addEventListener('pointermove', e => {
      const s=dragState;
      if(!s || e.pointerType==='mouse' || e.pointerId!==s.pointerId) return;
      s.x=e.clientX; s.y=e.clientY;
      if(!s.active){
        if(Math.hypot(e.clientX-s.startX,e.clientY-s.startY)>18){
          clearTimeout(s.timer);
          dragState=null;
        }
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if(s.ghost){ s.ghost.style.left=e.clientX+'px'; s.ghost.style.top=e.clientY+'px'; }
      document.querySelectorAll('.binder-pocket.v10-drop-target').forEach(p=>p.classList.remove('v10-drop-target'));
      const hit=document.elementFromPoint(e.clientX,e.clientY);
      const pocket=hit && hit.closest('.binder-pocket');
      if(pocket) pocket.classList.add('v10-drop-target');
    },{capture:true,passive:false});

    window.addEventListener('pointerup', e => {
      const s=dragState;
      if(!s || e.pointerType==='mouse' || e.pointerId!==s.pointerId) return;
      clearTimeout(s.timer);
      if(s.active){
        e.preventDefault();
        e.stopPropagation();
        const hit=document.elementFromPoint(e.clientX,e.clientY);
        const pocket=hit && hit.closest('.binder-pocket');
        const source=sourceCardById(s.id);
        if(source && pocket && typeof moveCard==='function'){
          suppressClickUntil=Date.now()+650;
          moveCard(source,Number(pocket.dataset.page),Number(pocket.dataset.slot));
        }
      }
      clearDrag();
    },true);

    window.addEventListener('pointercancel', e => {
      if(dragState && e.pointerId===dragState.pointerId) clearDrag();
    },true);

    window.addEventListener('click', e => {
      if(Date.now()<suppressClickUntil && e.target.closest && e.target.closest('.pocket-card')){
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },true);
  }

  function stopLiveScan(){
    if(liveScanTimer){clearTimeout(liveScanTimer);liveScanTimer=null;}
    liveScanBusy=false;
    if(liveScanStream){liveScanStream.getTracks().forEach(t=>t.stop());liveScanStream=null;}
    const video=$id('scanVideo'); if(video) video.srcObject=null;
  }
  window.stopLiveScan=stopLiveScan;

  function normalizeOCRLine(v){return String(v||'').replace(/[^\p{L}\p{N}\s.'-]/gu,' ').replace(/\s+/g,' ').trim();}
  function parseScanText(text){
    const raw=String(text||'');
    const num=raw.match(/(\d{1,4})\s*[\/|]\s*(\d{1,4})/);
    const lines=raw.split(/\n+/).map(normalizeOCRLine).filter(Boolean);
    const ignored=/^(b[aá]sico|basic|stage|est[aá]gio|hp|ability|habilidade|trainer|treinador|weakness|fraqueza|resistance|resist[eê]ncia|retreat|recuo|illus|illustrator)$/i;
    let name=lines.find(line=>!ignored.test(line)&&line.length>=3&&line.length<=28&&/[A-Za-zÀ-ÿ]{3}/.test(line)&&!/\b(ataque|damage|dano|energia|energy)\b/i.test(line))||'';
    name=name.replace(/\bHP\s*\d+.*/i,'').replace(/\b\d{2,4}\b.*$/,'').trim();
    return {name,number:num?`${num[1]}/${num[2]}`:''};
  }

  function drawScannerHints(video,canvas){
    const vw=video.videoWidth,vh=video.videoHeight;
    const frameH=Math.floor(vh*.76);
    const frameW=Math.min(Math.floor(frameH*63/88),Math.floor(vw*.78));
    const sx=Math.max(0,Math.floor((vw-frameW)/2)),sy=Math.max(0,Math.floor((vh-frameH)/2));
    const outW=520,topH=155,bottomH=150;
    canvas.width=outW;canvas.height=topH+bottomH;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(video,sx,sy,frameW,Math.floor(frameH*.25),0,0,outW,topH);
    ctx.drawImage(video,sx,sy+Math.floor(frameH*.72),frameW,Math.floor(frameH*.28),0,topH,outW,bottomH);
  }

  async function scanLiveFrame(){
    if(!liveScanStream||liveScanBusy)return;
    liveScanBusy=true;
    const status=$id('scanLiveStatus');
    try{
      const video=$id('scanVideo'),canvas=$id('scanCanvas');
      if(!video||!canvas||!video.videoWidth){liveScanTimer=setTimeout(scanLiveFrame,500);return;}
      if(status)status.textContent='Lendo a carta automaticamente…';
      if(typeof ensureOCR!=='function'||!await ensureOCR())throw new Error('OCR indisponível');
      drawScannerHints(video,canvas);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
      const result=await window.Tesseract.recognize(blob,'por+eng');
      const hint=parseScanText(result&&result.data?result.data.text:'');
      if(hint.name&&(hint.number||hint.name.length>=4)){
        stopLiveScan();
        if(typeof closeDialog==='function')closeDialog('scanDialog');
        if(typeof openAddForPosition==='function'){
          const page=(typeof pendingPosition!=='undefined'&&pendingPosition&&pendingPosition.page)?pendingPosition.page:(typeof currentPage!=='undefined'?currentPage:1);
          const slot=(typeof pendingPosition!=='undefined'&&pendingPosition)?pendingPosition.slot:undefined;
          openAddForPosition(page,slot);
        }
        if($id('searchName'))$id('searchName').value=hint.name;
        if($id('searchNumber')&&hint.number)$id('searchNumber').value=hint.number;
        if($id('ocrStatus'))$id('ocrStatus').textContent='Detectado ao vivo: '+[hint.name,hint.number].filter(Boolean).join(' · ');
        if(typeof searchCards==='function')await searchCards();
        return;
      }
      if(status)status.textContent='Mantenha a carta dentro da moldura — procurando…';
    }catch(err){
      console.warn('Scanner ao vivo:',err);
      if(status)status.textContent='Procurando… ajuste distância e reflexo da carta';
    }finally{
      liveScanBusy=false;
      if(liveScanStream)liveScanTimer=setTimeout(scanLiveFrame,1500);
    }
  }

  async function startLiveScan(){
    const status=$id('scanLiveStatus');
    stopLiveScan();
    try{
      if(typeof pendingPosition!=='undefined'&&!pendingPosition&&typeof freePositions==='function')pendingPosition=freePositions(typeof currentPage!=='undefined'?currentPage:1,1)[0];
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
  window.startLiveScan=startLiveScan;

  function installScannerControls(){
    const live=$id('btnLiveScan'),mobile=$id('btnMobileScan'),close=$id('btnCloseLiveScan'),manual=$id('btnScanManual'),dialog=$id('scanDialog');
    if(live)live.onclick=startLiveScan;
    if(mobile)mobile.onclick=()=>{
      if(typeof pendingPosition!=='undefined'&&typeof freePositions==='function')pendingPosition=freePositions(typeof currentPage!=='undefined'?currentPage:1,1)[0];
      startLiveScan();
    };
    if(close)close.onclick=()=>{stopLiveScan();if(typeof closeDialog==='function')closeDialog('scanDialog');};
    if(manual)manual.onclick=()=>{
      stopLiveScan();if(typeof closeDialog==='function')closeDialog('scanDialog');
      if(typeof openAddForPosition==='function')openAddForPosition(typeof currentPage!=='undefined'?currentPage:1);
    };
    if(dialog)dialog.addEventListener('close',stopLiveScan);
  }

  function install(){
    installDetailsLabel();
    installMobileNav();
    installBinderFit();
    installReal3D();
    installTouchDrag();
    installScannerControls();
    requestAnimationFrame(fitBinder);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})();

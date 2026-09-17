// Pokémon Binder BR — V8 safe behavior layer
(function(){
  'use strict';

  let liveScanStream = null;
  let liveScanTimer = null;
  let liveScanBusy = false;
  let holdDrag = null;

  function byId(id){ return document.getElementById(id); }

  function setMobileView(view){
    const panel = byId('summaryPanel');
    const binderBtn = byId('btnMobileBinder');
    const summaryBtn = byId('btnMobileSummary');
    const summary = view === 'summary';
    if(panel) panel.classList.toggle('mobile-open', summary);
    if(binderBtn) binderBtn.classList.toggle('active', !summary);
    if(summaryBtn) summaryBtn.classList.toggle('active', summary);
  }
  window.setMobileView = setMobileView;

  function reset3D(){
    const el = byId('card3d');
    const inner = el && el.querySelector('.card-3d-inner');
    if(!el || !inner) return;
    el.classList.remove('flipped');
    inner.style.transition = 'transform .22s ease-out';
    inner.style.transform = 'rotateX(0deg) rotateY(0deg)';
  }

  window.setup3d = function setup3dV8(){
    const el = byId('card3d');
    if(!el || el.dataset.v8Bound === '1') return;
    const inner = el.querySelector('.card-3d-inner');
    if(!inner) return;
    el.dataset.v8Bound = '1';

    let activePointer = null;
    let lastTap = 0;
    let raf = 0;
    let rx = 0;
    let ry = 0;

    function paint(){
      raf = 0;
      if(el.classList.contains('flipped')){
        inner.style.transform = 'rotateY(180deg)';
        return;
      }
      inner.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    }

    function setTilt(clientX, clientY){
      const r = el.getBoundingClientRect();
      if(!r.width || !r.height) return;
      const nx = Math.max(-0.5, Math.min(0.5, (clientX - r.left) / r.width - 0.5));
      const ny = Math.max(-0.5, Math.min(0.5, (clientY - r.top) / r.height - 0.5));
      ry = nx * 22;
      rx = -ny * 18;
      inner.style.transition = 'none';
      if(!raf) raf = requestAnimationFrame(paint);
    }

    function settle(){
      activePointer = null;
      if(el.classList.contains('flipped')) return;
      rx = 0; ry = 0;
      inner.style.transition = 'transform .24s ease-out';
      if(!raf) raf = requestAnimationFrame(paint);
    }

    function flip(){
      el.classList.toggle('flipped');
      inner.style.transition = 'transform .28s ease';
      inner.style.transform = el.classList.contains('flipped') ? 'rotateY(180deg)' : 'rotateX(0deg) rotateY(0deg)';
    }

    el.addEventListener('pointerdown', function(e){
      activePointer = e.pointerId;
      try{ el.setPointerCapture(e.pointerId); }catch(_e){}
      setTilt(e.clientX, e.clientY);
      if(e.pointerType !== 'mouse'){
        const now = Date.now();
        if(now - lastTap < 340) flip();
        lastTap = now;
      }
    });

    el.addEventListener('pointermove', function(e){
      if(e.pointerType === 'mouse' || activePointer === e.pointerId){
        e.preventDefault();
        setTilt(e.clientX, e.clientY);
      }
    }, {passive:false});

    el.addEventListener('pointerup', settle);
    el.addEventListener('pointercancel', settle);
    el.addEventListener('pointerleave', function(e){ if(e.pointerType === 'mouse') settle(); });
    el.addEventListener('dblclick', function(e){ if(e.pointerType !== 'touch') flip(); });

    const dialog = byId('cardDialog');
    if(dialog) dialog.addEventListener('close', reset3D);
  };

  function stopLiveScan(){
    if(liveScanTimer){ clearTimeout(liveScanTimer); liveScanTimer = null; }
    liveScanBusy = false;
    if(liveScanStream){
      liveScanStream.getTracks().forEach(function(track){ track.stop(); });
      liveScanStream = null;
    }
    const video = byId('scanVideo');
    if(video) video.srcObject = null;
  }
  window.stopLiveScan = stopLiveScan;

  function parseScanText(text){
    const clean = String(text || '');
    const num = clean.match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
    const lines = clean
      .split(/\n+/)
      .map(function(v){
        return v.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim();
      })
      .filter(function(v){ return v.length >= 3 && v.length <= 38; });

    const bad = /^(basico|básico|basic|stage|estagio|estágio|hp|habilidade|ability|trainer|treinador|fraqueza|resistencia|resistência|recuo|weakness|resistance|retreat)/i;
    let name = lines.find(function(v){
      return !bad.test(v) && /[A-Za-zÀ-ÿ]{3}/.test(v) && !/^\d+$/.test(v);
    }) || '';
    name = name.replace(/\bHP\s*\d+.*/i, '').trim();
    return { name:name, number:num ? `${num[1]}/${num[2]}` : '' };
  }

  async function scanLiveFrame(){
    if(!liveScanStream || liveScanBusy) return;
    liveScanBusy = true;
    const status = byId('scanLiveStatus');
    try{
      const video = byId('scanVideo');
      const canvas = byId('scanCanvas');
      if(!video || !canvas || !video.videoWidth){
        liveScanBusy = false;
        liveScanTimer = setTimeout(scanLiveFrame, 700);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cropH = Math.floor(vh * 0.76);
      const cropW = Math.min(Math.floor(cropH * 63 / 88), Math.floor(vw * 0.78));
      const sx = Math.max(0, Math.floor((vw - cropW) / 2));
      const sy = Math.max(0, Math.floor((vh - cropH) / 2));
      canvas.width = Math.max(420, cropW);
      canvas.height = Math.max(590, cropH);
      const ctx = canvas.getContext('2d', {willReadFrequently:true});
      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);

      if(status) status.textContent = 'Analisando carta...';
      if(typeof ensureOCR !== 'function' || !await ensureOCR()) throw new Error('OCR indisponível');

      const blob = await new Promise(function(resolve){ canvas.toBlob(resolve, 'image/jpeg', 0.88); });
      const result = await window.Tesseract.recognize(blob, 'por+eng');
      const hint = parseScanText(result && result.data ? result.data.text : '');

      if((hint.name && hint.number) || (hint.name && hint.name.length >= 5)){
        stopLiveScan();
        if(typeof closeDialog === 'function') closeDialog('scanDialog');
        if(typeof openAddForPosition === 'function'){
          const page = (typeof pendingPosition !== 'undefined' && pendingPosition && pendingPosition.page) ? pendingPosition.page : (typeof currentPage !== 'undefined' ? currentPage : 1);
          const slot = (typeof pendingPosition !== 'undefined' && pendingPosition) ? pendingPosition.slot : undefined;
          openAddForPosition(page, slot);
        }
        if(hint.name && byId('searchName')) byId('searchName').value = hint.name;
        if(hint.number && byId('searchNumber')) byId('searchNumber').value = hint.number;
        const ocrStatus = byId('ocrStatus');
        if(ocrStatus) ocrStatus.textContent = 'Scanner detectou: ' + [hint.name, hint.number].filter(Boolean).join(' · ');
        if(typeof searchCards === 'function') await searchCards();
        return;
      }

      if(status) status.textContent = 'Ainda procurando · aproxime e mantenha a carta parada';
    }catch(err){
      console.warn('Scanner ao vivo:', err);
      if(status) status.textContent = 'Ainda procurando · ajuste o enquadramento';
    }finally{
      liveScanBusy = false;
      if(liveScanStream) liveScanTimer = setTimeout(scanLiveFrame, 1250);
    }
  }

  async function startLiveScan(){
    const status = byId('scanLiveStatus');
    try{
      if(typeof pendingPosition !== 'undefined' && !pendingPosition && typeof freePositions === 'function'){
        pendingPosition = freePositions(typeof currentPage !== 'undefined' ? currentPage : 1, 1)[0];
      }
      const addDialog = byId('addDialog');
      if(addDialog && addDialog.open && typeof closeDialog === 'function') closeDialog('addDialog');
      if(typeof openDialog === 'function') openDialog('scanDialog');
      if(status) status.textContent = 'Abrindo câmera...';
      stopLiveScan();

      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        throw new Error('Câmera não suportada');
      }

      liveScanStream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:1920} },
        audio:false
      });
      const video = byId('scanVideo');
      video.srcObject = liveScanStream;
      await video.play();
      if(status) status.textContent = 'Câmera ativa · a leitura é automática';
      liveScanTimer = setTimeout(scanLiveFrame, 650);
    }catch(err){
      console.error(err);
      if(status) status.textContent = 'Não consegui abrir a câmera. Verifique a permissão do Chrome.';
    }
  }
  window.startLiveScan = startLiveScan;

  function clearHoldDrag(){
    if(!holdDrag) return;
    clearTimeout(holdDrag.timer);
    if(holdDrag.ghost) holdDrag.ghost.remove();
    if(holdDrag.card) holdDrag.card.classList.remove('dragging');
    document.querySelectorAll('.binder-pocket.drag-over').forEach(function(p){ p.classList.remove('drag-over'); });
    holdDrag = null;
  }

  function installHoldDrag(){
    document.addEventListener('pointerdown', function(e){
      if(e.pointerType === 'mouse') return;
      const card = e.target.closest('.pocket-card');
      if(!card) return;

      if(typeof touchBinderDrag !== 'undefined') touchBinderDrag = null;
      clearHoldDrag();

      const state = {
        card:card,
        id:card.dataset.id,
        pointerId:e.pointerId,
        startX:e.clientX,
        startY:e.clientY,
        x:e.clientX,
        y:e.clientY,
        active:false,
        ghost:null,
        timer:null
      };
      state.timer = setTimeout(function(){
        state.active = true;
        const rect = card.getBoundingClientRect();
        const ghost = card.cloneNode(true);
        ghost.className = 'mobile-drag-ghost';
        ghost.style.width = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        ghost.style.left = state.x + 'px';
        ghost.style.top = state.y + 'px';
        document.body.appendChild(ghost);
        state.ghost = ghost;
        card.classList.add('dragging');
        if(navigator.vibrate) navigator.vibrate(20);
      }, 260);
      holdDrag = state;

      // bloqueia o drag touch antigo da V5; o clique normal continua sendo gerado no pointerup.
      e.stopImmediatePropagation();
    }, true);

    document.addEventListener('pointermove', function(e){
      const s = holdDrag;
      if(!s || s.pointerId !== e.pointerId || e.pointerType === 'mouse') return;
      s.x = e.clientX; s.y = e.clientY;

      if(!s.active){
        if(Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > 12){
          clearTimeout(s.timer);
        }
        e.stopImmediatePropagation();
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      if(s.ghost){
        s.ghost.style.left = e.clientX + 'px';
        s.ghost.style.top = e.clientY + 'px';
      }
      document.querySelectorAll('.binder-pocket.drag-over').forEach(function(p){ p.classList.remove('drag-over'); });
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const pocket = hit && hit.closest('.binder-pocket');
      if(pocket) pocket.classList.add('drag-over');
    }, {capture:true, passive:false});

    document.addEventListener('pointerup', function(e){
      const s = holdDrag;
      if(!s || s.pointerId !== e.pointerId || e.pointerType === 'mouse') return;
      clearTimeout(s.timer);
      if(s.active){
        e.preventDefault();
        e.stopImmediatePropagation();
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const pocket = hit && hit.closest('.binder-pocket');
        const source = (typeof collection !== 'undefined') ? collection.find(function(c){ return String(c.id) === String(s.id); }) : null;
        if(source && pocket && typeof moveCard === 'function'){
          moveCard(source, Number(pocket.dataset.page), Number(pocket.dataset.slot));
        }
      }
      clearHoldDrag();
    }, true);

    document.addEventListener('pointercancel', function(e){
      if(holdDrag && holdDrag.pointerId === e.pointerId) clearHoldDrag();
    }, true);
  }

  function installControls(){
    const binderBtn = byId('btnMobileBinder');
    const summaryBtn = byId('btnMobileSummary');
    const closeSummary = byId('btnCloseSummary');
    const liveBtn = byId('btnLiveScan');
    const mobileScan = byId('btnMobileScan');
    const closeScan = byId('btnCloseLiveScan');
    const manualScan = byId('btnScanManual');
    const scanDialog = byId('scanDialog');
    const cardPhoto = byId('cardPhoto');

    if(binderBtn) binderBtn.onclick = function(){ setMobileView('binder'); };
    if(summaryBtn) summaryBtn.onclick = function(){ setMobileView('summary'); };
    if(closeSummary) closeSummary.onclick = function(){ setMobileView('binder'); };
    if(liveBtn) liveBtn.onclick = startLiveScan;
    if(mobileScan) mobileScan.onclick = function(){
      if(typeof pendingPosition !== 'undefined' && typeof freePositions === 'function'){
        pendingPosition = freePositions(typeof currentPage !== 'undefined' ? currentPage : 1, 1)[0];
      }
      startLiveScan();
    };
    if(closeScan) closeScan.onclick = function(){ stopLiveScan(); if(typeof closeDialog === 'function') closeDialog('scanDialog'); };
    if(manualScan) manualScan.onclick = function(){
      stopLiveScan();
      if(typeof closeDialog === 'function') closeDialog('scanDialog');
      if(typeof openAddForPosition === 'function'){
        const page = (typeof pendingPosition !== 'undefined' && pendingPosition && pendingPosition.page) ? pendingPosition.page : (typeof currentPage !== 'undefined' ? currentPage : 1);
        const slot = (typeof pendingPosition !== 'undefined' && pendingPosition) ? pendingPosition.slot : undefined;
        openAddForPosition(page, slot);
      }
    };
    if(scanDialog) scanDialog.addEventListener('close', stopLiveScan);
    if(cardPhoto) cardPhoto.onchange = function(){ if(cardPhoto.files && cardPhoto.files[0] && typeof usePhotoHints === 'function') usePhotoHints(); };

    // garante que o texto do menu rápido seja o correto mesmo se o HTML antigo estiver em cache.
    document.querySelectorAll('[data-ctx="view"]').forEach(function(btn){ btn.textContent = 'Detalhes da carta'; });

    window.setup3d();
    installHoldDrag();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', installControls);
  }else{
    installControls();
  }
})();

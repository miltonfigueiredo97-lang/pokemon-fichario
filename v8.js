// Pokémon Binder BR — V9 UX/mobile/scanner behavior layer
(function(){
  'use strict';

  let liveScanStream = null;
  let liveScanTimer = null;
  let liveScanBusy = false;
  let dragState = null;
  let suppressClickUntil = 0;

  const $id = (id) => document.getElementById(id);

  function setMobileView(view){
    const panel = $id('summaryPanel');
    const binderBtn = $id('btnMobileBinder');
    const summaryBtn = $id('btnMobileSummary');
    const showSummary = view === 'summary';

    if(panel){
      panel.classList.toggle('mobile-open', showSummary);
      panel.setAttribute('aria-hidden', showSummary ? 'false' : 'true');
    }
    if(binderBtn) binderBtn.classList.toggle('active', !showSummary);
    if(summaryBtn) summaryBtn.classList.toggle('active', showSummary);
  }
  window.setMobileView = setMobileView;

  function installMobileNav(){
    document.addEventListener('click', function(e){
      const binder = e.target.closest('#btnMobileBinder');
      const summary = e.target.closest('#btnMobileSummary');
      const close = e.target.closest('#btnCloseSummary');
      if(!binder && !summary && !close) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      setMobileView(summary ? 'summary' : 'binder');
    }, true);
  }

  function installDetailsLabel(){
    document.querySelectorAll('[data-ctx="view"]').forEach(function(btn){
      btn.textContent = 'Detalhes da carta';
      btn.setAttribute('aria-label', 'Detalhes da carta');
    });
  }

  function installCardDetails3D(){
    const old = $id('card3d');
    if(!old) return;

    const el = old.cloneNode(true);
    old.replaceWith(el);
    const inner = el.querySelector('.card-3d-inner');
    if(!inner) return;

    let pointerId = null;
    let pressed = false;
    let flipped = false;
    let tapAt = 0;
    let raf = 0;
    let rx = 0;
    let ry = 0;

    function render(){
      raf = 0;
      const y = flipped ? 180 + ry : ry;
      inner.style.transform = `rotateX(${rx}deg) rotateY(${y}deg)`;
    }

    function queue(){
      if(!raf) raf = requestAnimationFrame(render);
    }

    function tilt(x, y){
      const r = el.getBoundingClientRect();
      if(!r.width || !r.height) return;
      const nx = Math.max(-1, Math.min(1, ((x - r.left) / r.width - .5) * 2));
      const ny = Math.max(-1, Math.min(1, ((y - r.top) / r.height - .5) * 2));
      ry = nx * 14;
      rx = -ny * 11;
      inner.style.transition = 'transform 45ms linear';
      queue();
    }

    function settle(){
      pressed = false;
      pointerId = null;
      rx = 0;
      ry = 0;
      inner.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
      queue();
    }

    function flip(){
      flipped = !flipped;
      rx = 0;
      ry = 0;
      inner.style.transition = 'transform 320ms cubic-bezier(.2,.8,.2,1)';
      queue();
    }

    el.addEventListener('pointerdown', function(e){
      pressed = true;
      pointerId = e.pointerId;
      try{ el.setPointerCapture(e.pointerId); }catch(_e){}
      tilt(e.clientX, e.clientY);
    });

    el.addEventListener('pointermove', function(e){
      if(e.pointerType === 'mouse'){
        tilt(e.clientX, e.clientY);
        return;
      }
      if(pressed && e.pointerId === pointerId){
        e.preventDefault();
        tilt(e.clientX, e.clientY);
      }
    }, {passive:false});

    el.addEventListener('pointerup', function(e){
      const now = Date.now();
      if(e.pointerType !== 'mouse' && now - tapAt < 330) flip();
      tapAt = now;
      settle();
    });
    el.addEventListener('pointercancel', settle);
    el.addEventListener('pointerleave', function(e){ if(e.pointerType === 'mouse') settle(); });
    el.addEventListener('dblclick', function(e){ e.preventDefault(); flip(); });

    const dialog = $id('cardDialog');
    if(dialog){
      dialog.addEventListener('close', function(){
        flipped = false;
        settle();
      });
    }
  }

  function sourceCardById(id){
    try{
      if(typeof collection !== 'undefined' && Array.isArray(collection)){
        return collection.find(function(c){ return String(c.id) === String(id); }) || null;
      }
    }catch(_e){}
    return null;
  }

  function clearDrag(){
    if(!dragState) return;
    clearTimeout(dragState.timer);
    if(dragState.ghost) dragState.ghost.remove();
    if(dragState.card) dragState.card.classList.remove('v9-drag-source');
    document.querySelectorAll('.binder-pocket.v9-drop-target').forEach(function(p){ p.classList.remove('v9-drop-target'); });
    dragState = null;
  }

  function installMobileLongPressDrag(){
    document.addEventListener('pointerdown', function(e){
      if(e.pointerType === 'mouse') return;
      const card = e.target.closest('.pocket-card');
      if(!card) return;

      clearDrag();
      const state = {
        id: card.dataset.id,
        card: card,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        active: false,
        ghost: null,
        timer: null
      };

      state.timer = setTimeout(function(){
        if(dragState !== state) return;
        state.active = true;
        card.classList.add('v9-drag-source');
        try{ card.setPointerCapture(state.pointerId); }catch(_e){}

        const rect = card.getBoundingClientRect();
        const ghost = card.cloneNode(true);
        ghost.removeAttribute('id');
        ghost.className = 'v9-drag-ghost';
        ghost.style.width = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        ghost.style.left = state.x + 'px';
        ghost.style.top = state.y + 'px';
        document.body.appendChild(ghost);
        state.ghost = ghost;
        if(navigator.vibrate) navigator.vibrate(18);
      }, 200);

      dragState = state;
      e.stopImmediatePropagation();
    }, true);

    document.addEventListener('pointermove', function(e){
      const s = dragState;
      if(!s || e.pointerType === 'mouse' || e.pointerId !== s.pointerId) return;
      s.x = e.clientX;
      s.y = e.clientY;

      if(!s.active){
        if(Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > 24){
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

      document.querySelectorAll('.binder-pocket.v9-drop-target').forEach(function(p){ p.classList.remove('v9-drop-target'); });
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const pocket = hit && hit.closest('.binder-pocket');
      if(pocket) pocket.classList.add('v9-drop-target');
    }, {capture:true, passive:false});

    document.addEventListener('pointerup', function(e){
      const s = dragState;
      if(!s || e.pointerType === 'mouse' || e.pointerId !== s.pointerId) return;
      clearTimeout(s.timer);

      if(s.active){
        e.preventDefault();
        e.stopImmediatePropagation();
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const pocket = hit && hit.closest('.binder-pocket');
        const source = sourceCardById(s.id);
        if(source && pocket && typeof moveCard === 'function'){
          suppressClickUntil = Date.now() + 500;
          moveCard(source, Number(pocket.dataset.page), Number(pocket.dataset.slot));
        }
      }
      clearDrag();
    }, true);

    document.addEventListener('pointercancel', function(e){
      if(dragState && e.pointerId === dragState.pointerId) clearDrag();
    }, true);

    document.addEventListener('click', function(e){
      if(Date.now() < suppressClickUntil && e.target.closest('.pocket-card')){
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  function stopLiveScan(){
    if(liveScanTimer){ clearTimeout(liveScanTimer); liveScanTimer = null; }
    liveScanBusy = false;
    if(liveScanStream){
      liveScanStream.getTracks().forEach(function(t){ t.stop(); });
      liveScanStream = null;
    }
    const video = $id('scanVideo');
    if(video) video.srcObject = null;
  }
  window.stopLiveScan = stopLiveScan;

  function normalizeOCRLine(v){
    return String(v || '')
      .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseScanText(text){
    const raw = String(text || '');
    const num = raw.match(/(\d{1,4})\s*[\/|]\s*(\d{1,4})/);
    const lines = raw.split(/\n+/).map(normalizeOCRLine).filter(Boolean);
    const ignored = /^(b[aá]sico|basic|stage|est[aá]gio|hp|ability|habilidade|trainer|treinador|weakness|fraqueza|resistance|resist[eê]ncia|retreat|recuo|illus|illustrator)$/i;

    let name = lines.find(function(line){
      if(ignored.test(line)) return false;
      if(line.length < 3 || line.length > 28) return false;
      if(!/[A-Za-zÀ-ÿ]{3}/.test(line)) return false;
      if(/\b(ataque|damage|dano|energia|energy)\b/i.test(line)) return false;
      return true;
    }) || '';

    name = name.replace(/\bHP\s*\d+.*/i, '').replace(/\b\d{2,4}\b.*$/, '').trim();
    return {name:name, number:num ? `${num[1]}/${num[2]}` : ''};
  }

  function drawScannerHints(video, canvas){
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const frameH = Math.floor(vh * .76);
    const frameW = Math.min(Math.floor(frameH * 63 / 88), Math.floor(vw * .78));
    const sx = Math.max(0, Math.floor((vw - frameW) / 2));
    const sy = Math.max(0, Math.floor((vh - frameH) / 2));

    const outW = 520;
    const topH = 155;
    const bottomH = 150;
    canvas.width = outW;
    canvas.height = topH + bottomH;
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, sx, sy, frameW, Math.floor(frameH * .25), 0, 0, outW, topH);
    ctx.drawImage(video, sx, sy + Math.floor(frameH * .72), frameW, Math.floor(frameH * .28), 0, topH, outW, bottomH);

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for(let i=0;i<d.length;i+=4){
      const gray = .299*d[i] + .587*d[i+1] + .114*d[i+2];
      const value = gray > 145 ? 255 : gray < 80 ? 0 : gray;
      d[i] = d[i+1] = d[i+2] = value;
    }
    ctx.putImageData(img,0,0);
  }

  async function scanLiveFrame(){
    if(!liveScanStream || liveScanBusy) return;
    liveScanBusy = true;
    const status = $id('scanLiveStatus');

    try{
      const video = $id('scanVideo');
      const canvas = $id('scanCanvas');
      if(!video || !canvas || !video.videoWidth){
        liveScanTimer = setTimeout(scanLiveFrame, 500);
        return;
      }

      if(status) status.textContent = 'Lendo a carta automaticamente…';
      if(typeof ensureOCR !== 'function' || !await ensureOCR()) throw new Error('OCR indisponível');

      drawScannerHints(video, canvas);
      const blob = await new Promise(function(resolve){ canvas.toBlob(resolve, 'image/jpeg', .82); });
      const result = await window.Tesseract.recognize(blob, 'por+eng');
      const hint = parseScanText(result && result.data ? result.data.text : '');

      if(hint.name && (hint.number || hint.name.length >= 4)){
        stopLiveScan();
        if(typeof closeDialog === 'function') closeDialog('scanDialog');
        if(typeof openAddForPosition === 'function'){
          const page = (typeof pendingPosition !== 'undefined' && pendingPosition && pendingPosition.page)
            ? pendingPosition.page : (typeof currentPage !== 'undefined' ? currentPage : 1);
          const slot = (typeof pendingPosition !== 'undefined' && pendingPosition) ? pendingPosition.slot : undefined;
          openAddForPosition(page, slot);
        }
        if($id('searchName')) $id('searchName').value = hint.name;
        if($id('searchNumber') && hint.number) $id('searchNumber').value = hint.number;
        if($id('ocrStatus')) $id('ocrStatus').textContent = 'Detectado ao vivo: ' + [hint.name, hint.number].filter(Boolean).join(' · ');
        if(typeof searchCards === 'function') await searchCards();
        return;
      }

      if(status) status.textContent = 'Mantenha a carta dentro da moldura — procurando…';
    }catch(err){
      console.warn('Scanner ao vivo:', err);
      if(status) status.textContent = 'Procurando… ajuste distância e reflexo da carta';
    }finally{
      liveScanBusy = false;
      if(liveScanStream) liveScanTimer = setTimeout(scanLiveFrame, 1500);
    }
  }

  async function startLiveScan(){
    const status = $id('scanLiveStatus');
    stopLiveScan();
    try{
      if(typeof pendingPosition !== 'undefined' && !pendingPosition && typeof freePositions === 'function'){
        pendingPosition = freePositions(typeof currentPage !== 'undefined' ? currentPage : 1, 1)[0];
      }

      const add = $id('addDialog');
      if(add && add.open && typeof closeDialog === 'function') closeDialog('addDialog');
      if(typeof openDialog === 'function') openDialog('scanDialog');
      if(status) status.textContent = 'Abrindo câmera traseira…';

      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia indisponível');
      liveScanStream = await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:1920}},
        audio:false
      });

      const video = $id('scanVideo');
      if(!video) throw new Error('video ausente');
      video.srcObject = liveScanStream;
      await video.play();
      if(status) status.textContent = 'Scanner ativo — só mantenha a carta enquadrada';
      liveScanTimer = setTimeout(scanLiveFrame, 650);
    }catch(err){
      console.error(err);
      if(status) status.textContent = 'Não consegui abrir a câmera. Libere a permissão do Chrome.';
    }
  }
  window.startLiveScan = startLiveScan;

  function installScannerControls(){
    document.addEventListener('click', function(e){
      const live = e.target.closest('#btnLiveScan');
      const mobile = e.target.closest('#btnMobileScan');
      const close = e.target.closest('#btnCloseLiveScan');
      const manual = e.target.closest('#btnScanManual');
      if(!live && !mobile && !close && !manual) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      if(close){
        stopLiveScan();
        if(typeof closeDialog === 'function') closeDialog('scanDialog');
        return;
      }

      if(manual){
        stopLiveScan();
        if(typeof closeDialog === 'function') closeDialog('scanDialog');
        if(typeof openAddForPosition === 'function'){
          const page = (typeof pendingPosition !== 'undefined' && pendingPosition && pendingPosition.page)
            ? pendingPosition.page : (typeof currentPage !== 'undefined' ? currentPage : 1);
          const slot = (typeof pendingPosition !== 'undefined' && pendingPosition) ? pendingPosition.slot : undefined;
          openAddForPosition(page, slot);
        }
        return;
      }

      if(mobile && typeof pendingPosition !== 'undefined' && typeof freePositions === 'function'){
        pendingPosition = freePositions(typeof currentPage !== 'undefined' ? currentPage : 1, 1)[0];
      }
      startLiveScan();
    }, true);

    const dialog = $id('scanDialog');
    if(dialog) dialog.addEventListener('close', stopLiveScan);
  }

  function installGallery(){
    const input = $id('cardPhoto');
    if(!input) return;
    input.removeAttribute('capture');
    input.addEventListener('change', function(){
      if(input.files && input.files[0] && typeof usePhotoHints === 'function') usePhotoHints();
    });
  }

  function bootV9(){
    installMobileNav();
    installDetailsLabel();
    installCardDetails3D();
    installMobileLongPressDrag();
    installScannerControls();
    installGallery();
    setMobileView('binder');
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootV9);
  else bootV9();
})();
// Pokémon Binder BR — V11.4 surgical behavior fixes
(function(){
  'use strict';

  const $ = (s,root=document)=>root.querySelector(s);
  const $$ = (s,root=document)=>Array.from(root.querySelectorAll(s));

  function refitSoon(){
    [0,50,160,320].forEach(ms=>setTimeout(()=>{
      try{ window.fitBinderV11?.(); }catch(_e){}
    },ms));
  }

  function removeMypCTA(){
    $$('.market-board .v11-myp-note').forEach(el=>el.remove());
  }

  function installMypGuard(){
    removeMypCTA();
    const board=$('.market-board');
    if(!board)return;
    const mo=new MutationObserver(removeMypCTA);
    mo.observe(board,{childList:true,subtree:true});
  }

  function installClearLogout(){
    $$('.v11-tool[data-kind="logout"]').forEach(el=>el.remove());
    const actions=$('.summary-panel .action-grid');
    if(!actions||$('#v112Logout'))return;
    const b=document.createElement('button');
    b.id='v112Logout';
    b.type='button';
    b.className='action-btn v112-logout';
    b.textContent='Sair da conta';
    b.addEventListener('click',()=>document.getElementById('btnLogout')?.click());
    actions.appendChild(b);
  }

  function installFullscreenExit(){
    const area=$('.binder-area');
    if(!area||$('#v112ExitFullscreen'))return;
    const b=document.createElement('button');
    b.id='v112ExitFullscreen';
    b.type='button';
    b.className='v112-exit-fullscreen';
    b.textContent='Sair da tela cheia';
    b.addEventListener('click',async()=>{
      try{
        if(document.fullscreenElement) await document.exitFullscreen();
        else area.classList.remove('v11-fullscreen-fallback');
      }catch(_e){
        area.classList.remove('v11-fullscreen-fallback');
      }
      refitSoon();
    });
    area.appendChild(b);
  }

  function installPageStability(){
    ['prevPage','nextPage','btnPages','btnAddPage','btnAddPageModal'].forEach(id=>{
      document.getElementById(id)?.addEventListener('click',refitSoon,true);
    });
    const sheet=document.getElementById('binderSheet');
    if(sheet)new MutationObserver(refitSoon).observe(sheet,{childList:true,subtree:false});
    document.addEventListener('fullscreenchange',refitSoon);
    window.addEventListener('resize',refitSoon,{passive:true});
  }

  // ------------------------------------------------------------------
  // REALISTIC BINDER PAGE TURN
  // ------------------------------------------------------------------
  let pageFlipBusy=false;

  function injectPageFlipStyles(){
    if($('#v114PageFlipStyles'))return;
    const style=document.createElement('style');
    style.id='v114PageFlipStyles';
    style.textContent=`
      #binderStage.v114-page-flipping{perspective:1900px!important;overflow:hidden!important}
      #binderStage .v114-page-ghost{
        position:absolute!important;
        z-index:96!important;
        margin:0!important;
        pointer-events:none!important;
        transform-style:preserve-3d!important;
        backface-visibility:hidden!important;
        -webkit-backface-visibility:hidden!important;
        will-change:transform,opacity,filter!important;
        overflow:hidden!important;
        box-shadow:0 24px 55px rgba(0,0,0,.34)!important;
      }
      #binderStage .v114-page-ghost::after{
        content:""!important;
        position:absolute!important;
        inset:0!important;
        z-index:80!important;
        pointer-events:none!important;
        background:
          linear-gradient(90deg,rgba(0,0,0,.34),transparent 14%,transparent 72%,rgba(255,255,255,.08)),
          linear-gradient(100deg,transparent 44%,rgba(255,255,255,.05) 50%,transparent 58%)!important;
        opacity:.38!important;
      }
      #binderStage .v114-page-ghost.v114-next{
        transform-origin:left center!important;
        transform:perspective(1900px) rotateY(0deg)!important;
        transition:transform .62s cubic-bezier(.22,.72,.17,1),opacity .56s ease,filter .56s ease!important;
      }
      #binderStage .v114-page-ghost.v114-next.v114-run{
        transform:perspective(1900px) rotateY(-168deg)!important;
        opacity:.06!important;
        filter:brightness(.68)!important;
      }
      #binderStage .binder-sheet-wrap.v114-in-next{
        opacity:.64!important;
        transform:perspective(1900px) translateX(3px) scale(.994)!important;
        transition:opacity .56s ease,transform .56s ease!important;
      }
      #binderStage .binder-sheet-wrap.v114-in-next.v114-run{
        opacity:1!important;
        transform:perspective(1900px) translateX(0) scale(1)!important;
      }
      #binderStage .v114-page-ghost.v114-prev{
        transform:none!important;
        opacity:1!important;
        transition:opacity .55s ease,filter .55s ease!important;
      }
      #binderStage .v114-page-ghost.v114-prev.v114-run{
        opacity:.20!important;
        filter:brightness(.72)!important;
      }
      #binderStage .binder-sheet-wrap.v114-in-prev{
        transform-origin:left center!important;
        transform:perspective(1900px) rotateY(-168deg)!important;
        opacity:.10!important;
        transition:transform .62s cubic-bezier(.22,.72,.17,1),opacity .52s ease!important;
        will-change:transform,opacity!important;
      }
      #binderStage .binder-sheet-wrap.v114-in-prev.v114-run{
        transform:perspective(1900px) rotateY(0deg)!important;
        opacity:1!important;
      }
      #binderStage.v114-page-flipping .binder-sheet-wrap,
      #binderStage.v114-page-flipping .v114-page-ghost{transform-style:preserve-3d!important}
      @media (max-width:820px){
        #binderStage .v114-page-ghost.v114-next.v114-run{transform:perspective(1450px) rotateY(-166deg)!important}
        #binderStage .binder-sheet-wrap.v114-in-prev{transform:perspective(1450px) rotateY(-166deg)!important}
        #binderStage .binder-sheet-wrap.v114-in-prev.v114-run{transform:perspective(1450px) rotateY(0deg)!important}
      }
      @media (prefers-reduced-motion:reduce){
        #binderStage .v114-page-ghost,
        #binderStage .binder-sheet-wrap.v114-in-next,
        #binderStage .binder-sheet-wrap.v114-in-prev{transition:none!important}
      }
    `;
    document.head.appendChild(style);
  }

  function cleanCloneIds(root){
    if(root.id)root.removeAttribute('id');
    root.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
    root.querySelectorAll('button,input,select,textarea,a').forEach(el=>{
      el.tabIndex=-1;
      el.setAttribute('aria-hidden','true');
    });
  }

  function startPageFlip(direction){
    if(pageFlipBusy)return;
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const stage=$('#binderStage');
    const wrap=stage?.querySelector('.binder-sheet-wrap');
    if(!stage||!wrap)return;

    const stageRect=stage.getBoundingClientRect();
    const wrapRect=wrap.getBoundingClientRect();
    if(!wrapRect.width||!wrapRect.height)return;

    const ghost=wrap.cloneNode(true);
    cleanCloneIds(ghost);
    ghost.classList.remove('v114-in-next','v114-in-prev','v114-run');
    ghost.classList.add('v114-page-ghost',direction==='prev'?'v114-prev':'v114-next');
    ghost.style.setProperty('left',`${wrapRect.left-stageRect.left}px`,'important');
    ghost.style.setProperty('top',`${wrapRect.top-stageRect.top}px`,'important');
    ghost.style.setProperty('width',`${wrapRect.width}px`,'important');
    ghost.style.setProperty('height',`${wrapRect.height}px`,'important');
    ghost.style.setProperty('min-width','0','important');
    ghost.style.setProperty('min-height','0','important');
    ghost.style.setProperty('max-width','none','important');
    ghost.style.setProperty('max-height','none','important');

    pageFlipBusy=true;
    wrap.classList.remove('v114-in-next','v114-in-prev','v114-run');
    wrap.classList.add(direction==='prev'?'v114-in-prev':'v114-in-next');
    stage.classList.add('v114-page-flipping');
    stage.appendChild(ghost);

    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      ghost.classList.add('v114-run');
      wrap.classList.add('v114-run');
    }));

    setTimeout(()=>{
      ghost.remove();
      wrap.classList.remove('v114-in-next','v114-in-prev','v114-run');
      stage.classList.remove('v114-page-flipping');
      pageFlipBusy=false;
      refitSoon();
    },690);
  }

  function installPageTurn(){
    injectPageFlipStyles();
    document.addEventListener('click',e=>{
      const b=e.target.closest?.('button');
      if(!b)return;
      if(b.id==='nextPage'&&!b.disabled){startPageFlip('next');return}
      if(b.id==='prevPage'&&!b.disabled){startPageFlip('prev');return}
      if(b.classList.contains('page-thumb')){
        const txt=b.querySelector('strong')?.textContent||'';
        const target=Number((txt.match(/\d+/)||[])[0]||0);
        let now=0;
        try{now=Number(currentPage||0)}catch(_e){}
        if(target&&now&&target!==now)startPageFlip(target>now?'next':'prev');
      }
    },true);
  }

  function hardRemoveStatusFrames(){
    const clean=()=>{
      $$('.pocket-card').forEach(card=>{
        card.style.setProperty('border','0','important');
        card.style.setProperty('outline','0','important');
        card.style.setProperty('box-shadow','none','important');
      });
    };
    clean();
    const sheet=document.getElementById('binderSheet');
    if(sheet)new MutationObserver(clean).observe(sheet,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  }

  // ------------------------------------------------------------------
  // RIGHT SUMMARY PANEL: explicit collapse/restore button
  // ------------------------------------------------------------------
  function setSummaryCollapsed(collapsed){
    const workspace=$('.workspace');
    const btn=$('#v113SummaryToggle');
    if(!workspace)return;
    workspace.classList.toggle('v11-summary-collapsed',!!collapsed);
    if(btn){
      btn.textContent=collapsed?'Mostrar resumo ›':'Ocultar resumo ‹';
      btn.setAttribute('aria-expanded',collapsed?'false':'true');
    }
    try{localStorage.setItem('pokemonBinderSummaryCollapsed',collapsed?'1':'0')}catch(_e){}
    setTimeout(refitSoon,40);
  }

  function installSummaryCollapse(){
    const area=$('.binder-area');
    if(!area||$('#v113SummaryToggle'))return;
    const b=document.createElement('button');
    b.id='v113SummaryToggle';
    b.type='button';
    b.className='v113-summary-toggle';
    b.setAttribute('aria-label','Mostrar ou ocultar resumo');
    area.appendChild(b);
    let collapsed=false;
    try{collapsed=localStorage.getItem('pokemonBinderSummaryCollapsed')==='1'}catch(_e){}
    setSummaryCollapsed(collapsed);
    b.addEventListener('click',()=>{
      const w=$('.workspace');
      setSummaryCollapsed(!w?.classList.contains('v11-summary-collapsed'));
    });
  }

  // ------------------------------------------------------------------
  // CARD VISUAL PREFERENCES
  // ------------------------------------------------------------------
  function applyVisualPrefs(showBadges,grayMissing){
    document.body.classList.toggle('v113-hide-status-badges',showBadges===false);
    document.body.classList.toggle('v113-show-missing-color',grayMissing===false);
    const badge=$('#v113ShowBadges');
    const gray=$('#v113GrayMissing');
    if(badge)badge.checked=showBadges!==false;
    if(gray)gray.checked=grayMissing!==false;
  }

  async function saveVisualPref(key,value){
    try{
      if(typeof settings!=='undefined')settings[key]=value;
      if(typeof updateSettings==='function'){
        await updateSettings({[key]:value},true);
        return;
      }
      if(typeof currentUser!=='undefined'&&currentUser&&typeof db!=='undefined'){
        const {error}=await db.from('pokemon_settings').upsert({user_id:currentUser.id,[key]:value},{onConflict:'user_id'});
        if(error)throw error;
      }
    }catch(err){
      console.error('Preferência visual:',err);
      try{toast('Não consegui salvar essa preferência.')}catch(_e){}
    }
  }

  async function loadVisualPrefs(){
    try{
      if(typeof currentUser==='undefined'||!currentUser||typeof db==='undefined')return false;
      const {data,error}=await db.from('pokemon_settings')
        .select('show_status_badges,grayscale_missing')
        .eq('user_id',currentUser.id)
        .maybeSingle();
      if(error)throw error;
      const showBadges=data?.show_status_badges!==false;
      const grayMissing=data?.grayscale_missing!==false;
      if(typeof settings!=='undefined'){
        settings.show_status_badges=showBadges;
        settings.grayscale_missing=grayMissing;
      }
      applyVisualPrefs(showBadges,grayMissing);
      return true;
    }catch(err){
      console.warn('Preferências visuais:',err);
      applyVisualPrefs(true,true);
      return false;
    }
  }

  function installVisualControls(){
    const showValues=$('#showValues');
    const anchor=showValues?.closest('.control-block');
    if(!anchor||$('#v113VisualControls'))return;
    const section=document.createElement('section');
    section.id='v113VisualControls';
    section.className='control-block compact-block v113-visual-controls';
    section.innerHTML=`
      <p class="section-title">VISUAL DAS CARTAS</p>
      <label class="toggle-row">
        <span>Mostrar “Tenho / Quero / Pedido”</span>
        <input id="v113ShowBadges" type="checkbox" checked><i></i>
      </label>
      <label class="toggle-row">
        <span>P&B nas cartas “Não tenho”</span>
        <input id="v113GrayMissing" type="checkbox" checked><i></i>
      </label>`;
    anchor.insertAdjacentElement('afterend',section);

    $('#v113ShowBadges')?.addEventListener('change',e=>{
      const value=!!e.target.checked;
      const gray=$('#v113GrayMissing')?.checked!==false;
      applyVisualPrefs(value,gray);
      saveVisualPref('show_status_badges',value);
    });
    $('#v113GrayMissing')?.addEventListener('change',e=>{
      const value=!!e.target.checked;
      const badges=$('#v113ShowBadges')?.checked!==false;
      applyVisualPrefs(badges,value);
      saveVisualPref('grayscale_missing',value);
    });

    applyVisualPrefs(true,true);
    const tryLoad=()=>loadVisualPrefs();
    [150,500,1100,2200].forEach(ms=>setTimeout(tryLoad,ms));
    const app=$('#app');
    if(app)new MutationObserver(()=>{if(!app.classList.contains('hidden'))setTimeout(tryLoad,80)}).observe(app,{attributes:true,attributeFilter:['class']});
  }

  // ------------------------------------------------------------------
  // PROFILE SAVE: normalize @handle and show feedback INSIDE the modal
  // ------------------------------------------------------------------
  function normalizeHandle(raw){
    return String(raw||'')
      .trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/\s+/g,'_')
      .replace(/[^A-Za-z0-9_.-]/g,'_')
      .replace(/_+/g,'_')
      .replace(/^[_\-.]+|[_\-.]+$/g,'')
      .slice(0,24);
  }

  function profileMessage(text,type=''){
    const el=$('#v113ProfileStatus');
    if(!el)return;
    el.textContent=text||'';
    el.className='v113-profile-status'+(type?' '+type:'');
  }

  function installProfileSaveFix(){
    const btn=$('#btnSaveProfile');
    const input=$('#profileUsername');
    if(!btn||!input||btn.dataset.v113Fixed==='1')return;
    btn.dataset.v113Fixed='1';
    let status=$('#v113ProfileStatus');
    if(!status){
      status=document.createElement('p');
      status.id='v113ProfileStatus';
      status.className='v113-profile-status';
      btn.insertAdjacentElement('afterend',status);
    }

    btn.addEventListener('click',async e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      const original=btn.textContent;
      const raw=input.value;
      const username=normalizeHandle(raw);
      const visibility=$('#profileVisibility')?.value||'friends';

      if(username.length<3){
        profileMessage('Use pelo menos 3 caracteres no @usuário.','error');
        return;
      }
      if(typeof currentUser==='undefined'||!currentUser||typeof db==='undefined'){
        profileMessage('Sua sessão ainda não carregou. Tente novamente.','error');
        return;
      }

      input.value=username;
      btn.disabled=true;
      btn.textContent='Salvando…';
      profileMessage('');
      try{
        const payload={
          user_id:currentUser.id,
          username,
          binder_visibility:visibility,
          display_name:(typeof currentProfile!=='undefined'&&currentProfile?.display_name)||''
        };
        const {data,error}=await db.from('pokemon_profiles')
          .upsert(payload,{onConflict:'user_id'})
          .select('*')
          .single();
        if(error)throw error;
        try{currentProfile=data}catch(_e){}
        const handle=$('#userHandle');
        if(handle)handle.textContent='@'+username;
        profileMessage(`Salvo como @${username}`,'ok');
        btn.textContent='Salvo ✓';
        setTimeout(()=>{btn.textContent=original},1200);
      }catch(err){
        console.error('Salvar perfil:',err);
        const duplicate=String(err?.message||'').toLowerCase().includes('duplicate');
        profileMessage(duplicate?'Esse @usuário já está em uso.':'Não consegui salvar o perfil.','error');
        btn.textContent=original;
      }finally{
        btn.disabled=false;
      }
    },true);
  }

  function install(){
    installMypGuard();
    installClearLogout();
    installFullscreenExit();
    installPageStability();
    installPageTurn();
    hardRemoveStatusFrames();
    installSummaryCollapse();
    installVisualControls();
    installProfileSaveFix();
    refitSoon();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();

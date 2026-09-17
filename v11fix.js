// Pokémon Binder BR — V11.3 surgical behavior fixes
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
    hardRemoveStatusFrames();
    installSummaryCollapse();
    installVisualControls();
    installProfileSaveFix();
    refitSoon();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();

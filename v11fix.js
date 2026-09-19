// Pokémon Binder BR — V11.5 surgical behavior fixes
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
  let pageFlipGeneration=0;
  let pageFlipTimer=null;
  let pageFlipSuppressUntil=0;
  let lastPageFlipStartedAt=0;

  function injectPageFlipStyles(){
    if($('#v124PageFlipStyles'))return;
    $('#v114PageFlipStyles')?.remove();
    const style=document.createElement('style');
    style.id='v124PageFlipStyles';
    style.textContent=`
      #binderStage.v124-page-flipping{
        perspective:2600px!important;
        perspective-origin:50% 48%!important;
        overflow:hidden!important;
      }
      #binderStage .v124-curl-root{
        position:absolute!important;
        z-index:120!important;
        margin:0!important;
        pointer-events:none!important;
        transform-style:preserve-3d!important;
        overflow:visible!important;
        isolation:isolate!important;
        will-change:opacity!important;
      }
      #binderStage .v124-curl-strip{
        position:absolute!important;
        top:0!important;
        bottom:0!important;
        overflow:hidden!important;
        transform-style:preserve-3d!important;
        backface-visibility:visible!important;
        -webkit-backface-visibility:visible!important;
        will-change:transform,filter,opacity!important;
        transform-origin:left center!important;
        margin-left:-1px!important;
        -webkit-mask-image:linear-gradient(90deg,transparent 0,rgba(0,0,0,.92) 1.8px,#000 4px,#000 calc(100% - 4px),rgba(0,0,0,.92) calc(100% - 1.8px),transparent 100%)!important;
        mask-image:linear-gradient(90deg,transparent 0,rgba(0,0,0,.92) 1.8px,#000 4px,#000 calc(100% - 4px),rgba(0,0,0,.92) calc(100% - 1.8px),transparent 100%)!important;
      }
      #binderStage .v124-curl-strip::after{
        content:""!important;
        position:absolute!important;
        inset:-1px!important;
        z-index:30!important;
        pointer-events:none!important;
        background:
          linear-gradient(90deg,rgba(255,255,255,.09),rgba(255,255,255,.025) 30%,rgba(0,0,0,.09) 74%,rgba(0,0,0,.18))!important;
        opacity:.20!important;
        mix-blend-mode:soft-light!important;
        filter:blur(.35px)!important;
      }
      #binderStage .v124-strip-inner{
        position:absolute!important;
        top:0!important;
        margin:0!important;
        max-width:none!important;
        max-height:none!important;
        min-width:0!important;
        min-height:0!important;
        transform:none!important;
        filter:none!important;
        opacity:1!important;
        pointer-events:none!important;
      }
      #binderStage.v124-page-flipping::after{
        content:""!important;
        position:absolute!important;
        z-index:118!important;
        pointer-events:none!important;
        left:50%!important;
        top:7%!important;
        bottom:7%!important;
        width:38px!important;
        transform:translateX(-12px)!important;
        background:linear-gradient(90deg,rgba(0,0,0,.32),rgba(0,0,0,.08) 44%,rgba(255,255,255,.05) 72%,transparent)!important;
        filter:blur(7px)!important;
        opacity:.72!important;
      }
      #binderStage .binder-sheet-wrap.v124-under{
        transition:
          opacity 1.45s cubic-bezier(.16,.7,.18,1),
          transform 1.45s cubic-bezier(.16,.7,.18,1),
          filter 1.45s cubic-bezier(.16,.7,.18,1)!important;
        will-change:opacity,transform,filter!important;
      }
      #binderStage .binder-sheet-wrap.v124-under.v124-next{
        opacity:.42!important;
        transform:translateX(5px) scale(.991)!important;
        filter:brightness(.72)!important;
      }
      #binderStage .binder-sheet-wrap.v124-under.v124-prev{
        opacity:.62!important;
        transform:translateX(-3px) scale(.994)!important;
        filter:brightness(.80)!important;
      }
      #binderStage .binder-sheet-wrap.v124-under.v124-under-run{
        opacity:1!important;
        transform:translateX(0) scale(1)!important;
        filter:brightness(1)!important;
      }
      @media(max-width:820px){
        #binderStage.v124-page-flipping{perspective:1900px!important}
        #binderStage.v124-page-flipping::after{width:26px!important;filter:blur(5px)!important}
      }
      @media(prefers-reduced-motion:reduce){
        #binderStage .v124-curl-root{display:none!important}
        #binderStage .binder-sheet-wrap.v124-under{transition:none!important}
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

  function pageCurlPhases(count){
    const phaseAngles=(fn)=>Array.from({length:count},(_,i)=>{
      const t=count===1?1:i/(count-1);
      return fn(t);
    });
    return [
      {offset:0,angles:phaseAngles(()=>0)},
      {offset:.22,angles:phaseAngles(t=>-(3+48*Math.pow(t,1.55)))},
      {offset:.50,angles:phaseAngles(t=>-(16+98*Math.pow(t,1.18)))},
      {offset:.77,angles:phaseAngles(t=>-(52+116*Math.pow(t,.84)))},
      {offset:1,angles:phaseAngles(()=>-178)}
    ];
  }

  function phaseGeometry(angles,stripWidth,depthScale=.30){
    const out=[];
    let x=0,z=0;
    for(let i=0;i<angles.length;i++){
      const originalX=i*stripWidth;
      const angle=angles[i];
      const rad=angle*Math.PI/180;
      out.push({
        x:x-originalX,
        z:z*depthScale,
        angle
      });
      x+=stripWidth*Math.cos(rad);
      z+=-stripWidth*Math.sin(rad);
    }
    return out;
  }

  function createCurlRoot(stage,wrap){
    const stageRect=stage.getBoundingClientRect();
    const wrapRect=wrap.getBoundingClientRect();
    if(!wrapRect.width||!wrapRect.height)return null;

    const root=document.createElement('div');
    root.className='v124-curl-root';
    root.style.setProperty('left',`${wrapRect.left-stageRect.left}px`,'important');
    root.style.setProperty('top',`${wrapRect.top-stageRect.top}px`,'important');
    root.style.setProperty('width',`${wrapRect.width}px`,'important');
    root.style.setProperty('height',`${wrapRect.height}px`,'important');
    stage.appendChild(root);

    const count=window.matchMedia?.('(max-width:820px)').matches?16:22;
    const stripWidth=wrapRect.width/count;
    const strips=[];

    for(let i=0;i<count;i++){
      const strip=document.createElement('div');
      strip.className='v124-curl-strip';
      const left=i*stripWidth;
      strip.style.setProperty('left',`${left}px`,'important');
      strip.style.setProperty('width',`${stripWidth+3.2}px`,'important');

      const inner=wrap.cloneNode(true);
      cleanCloneIds(inner);
      inner.classList.remove('v124-under','v124-next','v124-prev','v124-under-run');
      inner.classList.add('v124-strip-inner');
      inner.style.setProperty('left',`${-left}px`,'important');
      inner.style.setProperty('width',`${wrapRect.width}px`,'important');
      inner.style.setProperty('height',`${wrapRect.height}px`,'important');

      strip.appendChild(inner);
      root.appendChild(strip);
      strips.push(strip);
    }

    return {root,strips,count,stripWidth};
  }

  function animateCurl(curl,direction){
    const {root,strips,count,stripWidth}=curl;
    const phases=pageCurlPhases(count);
    const geometries=phases.map(p=>phaseGeometry(p.angles,stripWidth));
    const ordered=direction==='prev'?[...phases].reverse():phases;
    const orderedGeo=direction==='prev'?[...geometries].reverse():geometries;
    const offsets=phases.map(p=>p.offset);
    const duration=1280;

    strips.forEach((strip,i)=>{
      const t=count===1?1:i/(count-1);
      const keyframes=ordered.map((phase,pIndex)=>{
        const g=orderedGeo[pIndex][i];
        const bend=Math.sin(Math.PI*t);
        const rx=(direction==='next'?1:-1)*bend*Math.min(2.4,Math.abs(g.angle)/70);
        const shade=Math.max(.58,1-Math.abs(g.angle)/330-(.10*t));
        const opacity=pIndex===ordered.length-1&&direction==='next'?.06:1;
        return {
          offset:offsets[pIndex],
          transform:`translate3d(${g.x.toFixed(2)}px,0,${g.z.toFixed(2)}px) rotateY(${g.angle.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg)`,
          filter:`brightness(${shade.toFixed(3)}) saturate(${(1-.12*Math.abs(g.angle)/180).toFixed(3)})`,
          opacity
        };
      });
      strip.animate(keyframes,{
        duration,
        easing:'cubic-bezier(.20,.72,.16,1)',
        fill:'forwards'
      });
    });

    root.animate(
      direction==='next'
        ?[
          {offset:0,opacity:1},
          {offset:.72,opacity:1},
          {offset:.90,opacity:.78},
          {offset:1,opacity:.03}
        ]
        :[
          {offset:0,opacity:.08},
          {offset:.12,opacity:.62},
          {offset:.28,opacity:1},
          {offset:1,opacity:1}
        ],
      {duration,easing:'cubic-bezier(.20,.72,.16,1)',fill:'forwards'}
    );

    return duration;
  }

  function cancelPageFlip({suppress=false}={}){
    pageFlipGeneration++;
    if(pageFlipTimer){clearTimeout(pageFlipTimer);pageFlipTimer=null}
    const stage=$('#binderStage');
    if(stage){
      stage.querySelectorAll('.v124-curl-root,.v124-curl-strip').forEach(el=>{
        try{el.getAnimations?.().forEach(a=>a.cancel())}catch(_e){}
      });
      stage.querySelectorAll('.v124-curl-root').forEach(el=>el.remove());
      stage.querySelectorAll('.binder-sheet-wrap').forEach(el=>el.classList.remove('v124-under','v124-next','v124-prev','v124-under-run'));
      stage.classList.remove('v124-page-flipping');
    }
    pageFlipBusy=false;
    if(suppress){
      const mobile=window.matchMedia?.('(max-width:820px)').matches;
      pageFlipSuppressUntil=performance.now()+(mobile?360:220);
    }
    refitSoon();
  }

  function startPageFlip(direction){
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const now=performance.now();
    const mobile=window.matchMedia?.('(max-width:820px)').matches;
    const rapidWindow=mobile?330:180;

    // Se o usuário navega antes de a folha terminar, a prioridade vira a navegação.
    // Cancela imediatamente a animação antiga e deixa os próximos cliques rápidos sem efeito visual.
    if(pageFlipBusy){
      cancelPageFlip({suppress:true});
      lastPageFlipStartedAt=now;
      return;
    }
    if(now<pageFlipSuppressUntil||now-lastPageFlipStartedAt<rapidWindow){
      pageFlipSuppressUntil=Math.max(pageFlipSuppressUntil,now+(mobile?260:140));
      lastPageFlipStartedAt=now;
      return;
    }

    const stage=$('#binderStage');
    const wrap=stage?.querySelector('.binder-sheet-wrap');
    if(!stage||!wrap)return;

    const generation=++pageFlipGeneration;
    lastPageFlipStartedAt=now;
    pageFlipBusy=true;
    stage.classList.add('v124-page-flipping');
    wrap.classList.remove('v124-under','v124-next','v124-prev','v124-under-run');
    wrap.classList.add('v124-under',direction==='prev'?'v124-prev':'v124-next');

    let curl=null;
    let duration=1650;

    if(direction==='next'){
      curl=createCurlRoot(stage,wrap);
      if(curl)duration=animateCurl(curl,'next');
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(generation!==pageFlipGeneration)return;
        wrap.classList.add('v124-under-run');
      }));
    }else{
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(generation!==pageFlipGeneration)return;
        const fresh=stage.querySelector('.binder-sheet-wrap');
        if(!fresh)return;
        curl=createCurlRoot(stage,fresh);
        if(curl)duration=animateCurl(curl,'prev');
        fresh.classList.add('v124-under','v124-prev');
        requestAnimationFrame(()=>{
          if(generation===pageFlipGeneration)fresh.classList.add('v124-under-run');
        });
      }));
    }

    pageFlipTimer=setTimeout(()=>{
      if(generation!==pageFlipGeneration)return;
      curl?.root?.remove();
      const fresh=stage.querySelector('.binder-sheet-wrap');
      fresh?.classList.remove('v124-under','v124-next','v124-prev','v124-under-run');
      stage.classList.remove('v124-page-flipping');
      pageFlipBusy=false;
      pageFlipTimer=null;
      refitSoon();
    },Math.min(1390,duration+80));
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
  // RIGHT SUMMARY PANEL
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
  // PROFILE SAVE
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

  // ------------------------------------------------------------------
  // CARD DETAILS: READ-ONLY FIRST, EDIT ONLY ON DEMAND
  // ------------------------------------------------------------------
  let editorSnapshot=null;

  function injectCardDetailsStyles(){
    if($('#v115CardDetailsStyles'))return;
    const style=document.createElement('style');
    style.id='v115CardDetailsStyles';
    style.textContent=`
      .card-details-panel{position:relative!important}
      .v115-details-head-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
      .v115-edit-btn,.v115-cancel-btn{
        height:34px;border-radius:999px;padding:0 13px;border:1px solid rgba(255,255,255,.14);
        background:#171c20;color:#ece9df;font-size:10px;font-weight:900;cursor:pointer
      }
      .v115-edit-btn:hover,.v115-cancel-btn:hover{background:#22292f}
      .v115-info-grid{
        display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0 10px
      }
      .v115-info-item{
        min-height:56px;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;
        background:rgba(255,255,255,.025);display:flex;flex-direction:column;gap:4px
      }
      .v115-info-item span{font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#7e878e;font-weight:900}
      .v115-info-item strong{font-size:12px;color:#f1eee6;font-weight:850;line-height:1.25}
      .v115-owned-view{
        display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0 12px
      }
      .v115-owned-view .v115-wide{grid-column:1/-1}
      .v115-status-pill{display:inline-flex;width:max-content;align-items:center;height:24px;padding:0 9px;border-radius:999px;font-size:9px;font-weight:950}
      .v115-status-pill.owned{background:rgba(46,201,143,.14);color:#59e0af}
      .v115-status-pill.wanted{background:rgba(255,194,73,.12);color:#ffd070}
      .v115-status-pill.ordered{background:rgba(99,151,255,.14);color:#9dbdff}
      .v115-status-pill.missing{background:rgba(255,255,255,.08);color:#c4c8ca}
      .card-details-panel:not(.v115-editing) #statusPicker,
      .card-details-panel:not(.v115-editing) .inspector-form,
      .card-details-panel:not(.v115-editing) #cardNotes,
      .card-details-panel:not(.v115-editing) #cardNotes + *,
      .card-details-panel:not(.v115-editing) .dialog-actions{display:none!important}
      .card-details-panel:not(.v115-editing) label:has(#cardNotes){display:none!important}
      .card-details-panel.v115-editing #v115CardInfo,
      .card-details-panel.v115-editing #v115OwnershipView{display:none!important}
      .v115-location-field{display:none!important}
      .card-details-panel.v115-editing .inspector-form{display:grid!important}
      .card-details-panel.v115-editing .dialog-actions{display:flex!important}
      .card-details-panel.v115-editing label:has(#cardNotes){display:block!important}
      #btnSaveCard{min-width:150px}
      @media(max-width:820px){
        .v115-info-grid,.v115-owned-view{grid-template-columns:1fr 1fr}
        .v115-info-item{min-height:50px;padding:9px 10px}
        .v115-details-head-actions{position:absolute;top:0;right:0}
      }
      @media(max-width:520px){
        .v115-info-grid,.v115-owned-view{grid-template-columns:1fr}
        .v115-owned-view .v115-wide{grid-column:auto}
      }
    `;
    document.head.appendChild(style);
  }

  function savedCardForEditor(){
    try{return editingCardId?collection.find(c=>c.id===editingCardId)||null:null}catch(_e){return null}
  }

  function statusLabel(status){
    try{return STATUS?.[status]||status||'—'}catch(_e){return status||'—'}
  }

  function detailValue(value){
    return value===null||value===undefined||String(value).trim()===''?'—':String(value);
  }

  function conditionLabel(value){
    const v=String(value||'').trim().toUpperCase();
    return ({
      'NOVA':'Nova',
      'NM':'Near Mint (NM)',
      'SP':'Slightly Played (SP)',
      'MP':'Moderately Played (MP)',
      'HP':'Heavily Played (HP)',
      'DM':'Damaged (DM)'
    })[v]||detailValue(value);
  }

  function renderCardReadOnly(){
    const panel=$('.card-details-panel');
    const info=$('#v115CardInfo');
    const own=$('#v115OwnershipView');
    if(!panel||!info||!own)return;

    const c=typeof selectedCard!=='undefined'&&selectedCard?selectedCard:{};
    const saved=savedCardForEditor();
    const status=(saved?.collection_status||selectedStatus||'owned');
    const setName=c.setName||c.set_name||saved?.set_name||'';
    const number=c.number||saved?.number||'';
    const rarity=c.rarity||saved?.rarity||'';
    const type=c.type||c.card_type||saved?.card_type||'';
    const lang=c.language||saved?.language||'';
    const quantity=saved?.quantity??$('#cardQuantity')?.value??0;
    const condition=saved?.condition||$('#cardCondition')?.value||'';
    const finish=saved?.finish||$('#cardFinish')?.value||'';
    const notes=saved?.notes||$('#cardNotes')?.value||'';

    info.innerHTML=`
      <div class="v115-info-item"><span>Coleção</span><strong>${esc(detailValue(setName))}</strong></div>
      <div class="v115-info-item"><span>Número</span><strong>${esc(detailValue(number))}</strong></div>
      <div class="v115-info-item"><span>Tipo</span><strong>${esc(detailValue(type))}</strong></div>
      <div class="v115-info-item"><span>Raridade</span><strong>${esc(detailValue(rarity))}</strong></div>
      <div class="v115-info-item"><span>Idioma</span><strong>${esc(detailValue(lang))}</strong></div>`;

    own.innerHTML=`
      <div class="v115-info-item"><span>Status</span><strong><i class="v115-status-pill ${esc(status)}">${esc(statusLabel(status))}</i></strong></div>
      <div class="v115-info-item"><span>Quantidade</span><strong>${esc(detailValue(quantity))}</strong></div>
      <div class="v115-info-item"><span>Condição</span><strong>${esc(conditionLabel(condition))}</strong></div>
      <div class="v115-info-item"><span>Acabamento</span><strong>${esc(detailValue(finish))}</strong></div>
      ${notes?`<div class="v115-info-item v115-wide"><span>Observações</span><strong>${esc(notes)}</strong></div>`:''}`;
  }

  function takeEditorSnapshot(){
    editorSnapshot={
      status:typeof selectedStatus!=='undefined'?selectedStatus:'owned',
      quantity:$('#cardQuantity')?.value||'1',
      condition:$('#cardCondition')?.value||'Nova',
      finish:$('#cardFinish')?.value||'Normal',
      notes:$('#cardNotes')?.value||''
    };
  }

  function restoreEditorSnapshot(){
    if(!editorSnapshot)return;
    if($('#cardQuantity'))$('#cardQuantity').value=editorSnapshot.quantity;
    if($('#cardCondition'))$('#cardCondition').value=editorSnapshot.condition;
    if($('#cardFinish'))$('#cardFinish').value=editorSnapshot.finish;
    if($('#cardNotes'))$('#cardNotes').value=editorSnapshot.notes;
    try{setSelectedStatus(editorSnapshot.status)}catch(_e){}
  }

  function setCardEditMode(editing){
    const panel=$('.card-details-panel');
    if(!panel)return;
    const btnEdit=$('#v115EditCard');
    const btnCancel=$('#v115CancelEdit');
    const btnSave=$('#btnSaveCard');
    const isExisting=!!(typeof editingCardId!=='undefined'&&editingCardId);

    panel.classList.toggle('v115-editing',!!editing);
    if(btnEdit)btnEdit.hidden=editing||!isExisting;
    if(btnCancel)btnCancel.hidden=!editing;
    if(btnSave){
      btnSave.hidden=!editing;
      btnSave.textContent=isExisting?'Salvar alterações':'Salvar no fichário';
    }
    if(editing)takeEditorSnapshot();
    else renderCardReadOnly();
  }

  function installCardDetailsMode(){
    injectCardDetailsStyles();
    const panel=$('.card-details-panel');
    const head=$('.card-details-panel .details-head');
    const chips=$('.card-details-panel .detail-chips');
    const market=$('.card-details-panel .market-board');
    if(!panel||!head||!chips||!market)return;

    $('#cardPage')?.closest('label')?.classList.add('v115-location-field');
    $('#cardSlot')?.closest('label')?.classList.add('v115-location-field');

    const conditionSelect=$('#cardCondition');
    if(conditionSelect){
      const values=[
        ['Nova','Nova'],
        ['NM','Near Mint (NM)'],
        ['SP','Slightly Played (SP)'],
        ['MP','Moderately Played (MP)'],
        ['HP','Heavily Played (HP)'],
        ['DM','Damaged (DM)']
      ];
      const current=conditionSelect.value;
      conditionSelect.innerHTML=values.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
      conditionSelect.value=current||'Nova';
    }

    if(!$('#v115DetailsHeadActions')){
      const actions=document.createElement('div');
      actions.id='v115DetailsHeadActions';
      actions.className='v115-details-head-actions';
      actions.innerHTML='<button id="v115EditCard" class="v115-edit-btn" type="button">Editar</button><button id="v115CancelEdit" class="v115-cancel-btn" type="button" hidden>Cancelar</button>';
      head.appendChild(actions);
      $('#v115EditCard')?.addEventListener('click',()=>setCardEditMode(true));
      $('#v115CancelEdit')?.addEventListener('click',()=>{
        if(!(typeof editingCardId!=='undefined'&&editingCardId)){
          try{closeDialog('cardDialog')}catch(_e){}
          return;
        }
        restoreEditorSnapshot();
        setCardEditMode(false);
      });
    }

    if(!$('#v115CardInfo')){
      const info=document.createElement('div');
      info.id='v115CardInfo';
      info.className='v115-info-grid';
      chips.insertAdjacentElement('afterend',info);
    }

    if(!$('#v115OwnershipView')){
      const own=document.createElement('div');
      own.id='v115OwnershipView';
      own.className='v115-owned-view';
      market.insertAdjacentElement('afterend',own);
    }

    // Existing card: open in read-only mode and NEVER refresh price merely by opening details.
    try{
      openExistingCard=function(c,focus3d=false){
        editingCardId=c.id;
        selectedStatus=c.collection_status||'owned';
        selectedMarket={
          min:+c.price_min||0,avg:+c.price_avg||0,max:+c.price_max||0,
          link:c.price_br_link||c.price_link||'',source:c.price_br_source||c.price_source||'',
          internalCode:c.market_internal_code,namePt:c.market_name_pt,editionPt:c.market_edition_pt,
          imagePt:c.market_image_pt,imageEn:c.market_image_en
        };
        selectedCard={
          source:c.api_source||'saved',apiId:c.api_id||'',name:c.name,
          languageCode:c.language_code,language:c.language,setName:c.set_name,setId:c.set_id,
          number:c.number,rarity:c.rarity,type:c.card_type,imageUrl:c.image_url,
          pricing:null,marketInternalCode:c.market_internal_code
        };
        pendingPosition={page:c.binder_page||1,slot:c.binder_slot||1};
        fillInspector(selectedCard,{
          page:c.binder_page,slot:c.binder_slot,quantity:c.quantity,
          condition:c.condition,finish:c.finish,notes:c.notes,status:selectedStatus
        });
        setPrices(c.price_min,c.price_avg,c.price_max);
        if(selectedMarket.link){
          $('#mypcardsLink').href=selectedMarket.link;
          $('#mypcardsLink').classList.remove('hidden');
        }
        $('#marketStatus').textContent=+c.price_avg?`Última cotação: ${c.price_br_source||c.price_source||'mercado BR'}`:'Sem cotação BR salva';
        openDialog('cardDialog');
        setTimeout(()=>setCardEditMode(false),0);
      };
    }catch(err){console.warn('Modo leitura da carta:',err)}

    // New card can still open directly in edit mode; price lookup on ADD remains allowed.
    try{
      const originalChoose=chooseCatalogCard;
      chooseCatalogCard=async function(c){
        await originalChoose(c);
        setCardEditMode(true);
      };
    }catch(_e){}

    const dialog=$('#cardDialog');
    if(dialog){
      new MutationObserver(()=>{
        if(dialog.open){
          setTimeout(()=>{
            const existing=!!(typeof editingCardId!=='undefined'&&editingCardId);
            setCardEditMode(!existing);
          },0);
        }
      }).observe(dialog,{attributes:true,attributeFilter:['open']});
    }
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
    installCardDetailsMode();
    refitSoon();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
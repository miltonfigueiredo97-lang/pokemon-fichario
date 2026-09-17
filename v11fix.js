// Pokémon Binder BR — V11.2 surgical behavior fixes
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
    if(sheet){
      new MutationObserver(refitSoon).observe(sheet,{childList:true,subtree:false});
    }
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

  function install(){
    installMypGuard();
    installClearLogout();
    installFullscreenExit();
    installPageStability();
    hardRemoveStatusFrames();
    refitSoon();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();

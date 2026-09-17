from pathlib import Path

css_path = Path('style.css')
js_path = Path('script.js')
sw_path = Path('sw.js')

css = css_path.read_text(encoding='utf-8')
marker = '/* ===== V5 PHYSICAL BINDER FIT ===== */'
if marker not in css:
    css += r'''

/* ===== V5 PHYSICAL BINDER FIT ===== */
@media (min-width:821px){
  .binder-stage{
    padding:10px 48px 12px 14px;
    overflow:hidden;
  }
  .binder-spread{
    width:min(100%,calc((100dvh - 62px - 44px - 24px) * 1.455));
    height:auto;
    max-height:100%;
    aspect-ratio:1.455 / 1;
    grid-template-columns:1fr 1fr;
    gap:8px;
    align-self:center;
    justify-self:center;
  }
  .binder-cover,.binder-sheet-wrap{
    width:100%;
    height:100%;
    min-height:0;
  }
  .binder-sheet-wrap{
    padding:8px 8px 8px 15px;
  }
  .binder-sheet{
    width:100%;
    height:100%;
    min-height:0;
    gap:5px;
    padding:6px;
    border:1px solid rgba(255,255,255,.16);
    background:
      linear-gradient(112deg,rgba(255,255,255,.055),transparent 18%,transparent 78%,rgba(255,255,255,.025)),
      rgba(7,10,13,.66);
    box-shadow:inset 0 0 35px rgba(0,0,0,.28);
  }
  .binder-pocket{
    min-width:0;
    min-height:0;
    overflow:hidden;
    padding:7px;
    border:1px solid rgba(255,255,255,.10)!important;
    border-radius:8px;
    background:
      linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.012) 34%,rgba(0,0,0,.12) 72%),
      rgba(16,20,24,.48);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.07),
      inset 0 -10px 22px rgba(0,0,0,.14);
  }
  .binder-pocket:before{
    content:"";
    position:absolute;
    inset:5px;
    border:1px solid rgba(255,255,255,.045);
    border-radius:6px;
    pointer-events:none;
  }
  .binder-pocket:after{
    background:linear-gradient(120deg,rgba(255,255,255,.055),transparent 22%,transparent 72%,rgba(255,255,255,.022));
  }
  .pocket-card{
    width:auto!important;
    height:calc(100% - 8px)!important;
    max-width:calc(100% - 8px)!important;
    max-height:calc(100% - 8px)!important;
    aspect-ratio:63 / 88;
    border-radius:7px;
    overflow:visible;
    filter:drop-shadow(0 7px 10px rgba(0,0,0,.30));
  }
  .pocket-card img{
    width:100%;
    height:100%;
    object-fit:contain;
  }
  .pocket-card.status-owned,.pocket-card.status-wanted,.pocket-card.status-ordered{
    box-shadow:none;
  }
  .pocket-card.status-owned:after,.pocket-card.status-wanted:after,.pocket-card.status-ordered:after{
    content:"";
    position:absolute;
    inset:-3px;
    border-radius:9px;
    pointer-events:none;
  }
  .pocket-card.status-owned:after{border:2px solid var(--green)}
  .pocket-card.status-wanted:after{border:2px solid var(--yellow)}
  .pocket-card.status-ordered:after{border:2px solid var(--blue)}
  .pocket-empty-btn{
    width:58%;
    max-height:78%;
    border-color:rgba(255,255,255,.075);
    background:rgba(0,0,0,.035);
    color:rgba(255,255,255,.13);
  }
  .binder-hint{bottom:2px;font-size:8px}
}

@media (min-width:821px) and (max-height:760px){
  .app-header{height:56px}
  .workspace{height:calc(100dvh - 56px)}
  .binder-toolbar{height:40px}
  .binder-stage{height:calc(100% - 40px);padding-top:7px;padding-bottom:8px}
  .binder-spread{width:min(100%,calc((100dvh - 56px - 40px - 18px) * 1.455))}
  .header-sub{display:none}
}

@media (max-width:820px){
  .binder-sheet{gap:4px;padding:5px}
  .binder-pocket{padding:4px;border:1px solid rgba(255,255,255,.09)!important;border-radius:6px;background:rgba(13,17,20,.60)}
  .pocket-card{width:auto!important;height:calc(100% - 6px)!important;max-width:calc(100% - 6px)!important;max-height:calc(100% - 6px)!important;aspect-ratio:63/88}
}
'''
    css_path.write_text(css, encoding='utf-8')

js = js_path.read_text(encoding='utf-8')
js_marker = '// ===== V5 RELIABLE SLOT DRAG ====='
if js_marker not in js:
    js += r'''

// ===== V5 RELIABLE SLOT DRAG =====
function dragCardFromEvent(e){
  const id=(e.dataTransfer&&e.dataTransfer.getData('text/plain'))||draggedCard?.id||'';
  return collection.find(c=>String(c.id)===String(id))||draggedCard||null;
}
function binderDrop(e,pocket,page,slot){
  e.preventDefault();
  e.stopPropagation();
  pocket?.classList.remove('drag-over');
  const source=dragCardFromEvent(e);
  if(source) moveCard(source,+page,+slot);
}
function renderBinder(){
  const g=$('binderSheet');
  g.innerHTML='';
  for(let slot=1;slot<=9;slot++){
    const pocket=document.createElement('div');
    pocket.className='binder-pocket';
    pocket.dataset.page=currentPage;
    pocket.dataset.slot=slot;
    const c=getCardAt(currentPage,slot);
    if(c){
      pocket.appendChild(renderPocketCard(c));
    }else{
      const b=document.createElement('button');
      b.className='pocket-empty-btn';
      b.type='button';
      b.textContent='＋';
      b.title=`Adicionar no bolso ${slot}`;
      b.onclick=()=>openAddForPosition(currentPage,slot);
      pocket.appendChild(b);
    }
    pocket.addEventListener('dragenter',e=>{e.preventDefault();pocket.classList.add('drag-over')});
    pocket.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';pocket.classList.add('drag-over')});
    pocket.addEventListener('dragleave',e=>{if(!pocket.contains(e.relatedTarget))pocket.classList.remove('drag-over')});
    pocket.addEventListener('drop',e=>binderDrop(e,pocket,currentPage,slot));
    g.appendChild(pocket);
  }
  const pages=Math.max(1,+settings.binder_pages||1);
  $('pageLabel').textContent=`Página ${currentPage} · ${currentPage}/${pages}`;
  $('prevPage').disabled=currentPage<=1;
  $('nextPage').disabled=currentPage>=pages;
}
function renderPocketCard(c){
  const st=c.collection_status||'owned';
  const b=document.createElement('button');
  b.className=`pocket-card status-${st}`;
  b.type='button';
  b.draggable=true;
  b.dataset.id=c.id;
  if(activeStatusFilter!=='all'&&st!==activeStatusFilter)b.classList.add('filtered-out');
  const img=cardImage(c),q=Math.max(0,+c.quantity||0),v=(+c.price_avg||0)*Math.max(q,1);
  b.innerHTML=`${img?`<img src="${esc(img)}" alt="${esc(c.name)}" loading="lazy" draggable="false">`:`<span>${esc(c.name)}</span>`}<span class="card-status-ribbon">${esc(STATUS[st]||st)}</span>${st==='owned'&&q>1?`<span class="card-qty">x${q}</span>`:''}${settings.show_values&&+c.price_avg>0?`<span class="card-value">${money(v)}</span>`:''}`;
  b.addEventListener('click',()=>{if(!b.dataset.justDragged)openExistingCard(c)});
  b.addEventListener('dblclick',()=>openExistingCard(c,true));
  b.addEventListener('contextmenu',e=>{e.preventDefault();showContextMenu(c,e.clientX,e.clientY)});
  b.addEventListener('dragstart',e=>{
    draggedCard=c;
    b.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',String(c.id));
    try{e.dataTransfer.setDragImage(b,Math.round(b.offsetWidth/2),Math.round(b.offsetHeight/2))}catch{}
  });
  b.addEventListener('dragend',()=>{
    draggedCard=null;
    b.classList.remove('dragging');
    document.querySelectorAll('.binder-pocket.drag-over').forEach(p=>p.classList.remove('drag-over'));
  });
  b.addEventListener('dragenter',e=>{e.preventDefault();e.stopPropagation();b.closest('.binder-pocket')?.classList.add('drag-over')});
  b.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';b.closest('.binder-pocket')?.classList.add('drag-over')});
  b.addEventListener('drop',e=>{
    const p=b.closest('.binder-pocket');
    binderDrop(e,p,p?.dataset.page,p?.dataset.slot);
  });
  let press;
  const start=e=>{press=setTimeout(()=>showContextMenu(c,e.clientX||innerWidth/2,e.clientY||innerHeight/2),620)};
  b.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')start(e)});
  ['pointerup','pointercancel','pointermove'].forEach(ev=>b.addEventListener(ev,()=>clearTimeout(press)));
  return b;
}

let touchBinderDrag=null;
let suppressPocketClick=false;
document.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse')return;
  const card=e.target.closest('.pocket-card');
  if(!card)return;
  touchBinderDrag={id:card.dataset.id,x:e.clientX,y:e.clientY,moved:false,card};
},{passive:true});
document.addEventListener('pointermove',e=>{
  if(!touchBinderDrag||e.pointerType==='mouse')return;
  const dx=e.clientX-touchBinderDrag.x,dy=e.clientY-touchBinderDrag.y;
  if(!touchBinderDrag.moved&&Math.hypot(dx,dy)>12){
    touchBinderDrag.moved=true;
    touchBinderDrag.card.classList.add('dragging');
  }
  if(!touchBinderDrag.moved)return;
  document.querySelectorAll('.binder-pocket.drag-over').forEach(p=>p.classList.remove('drag-over'));
  document.elementFromPoint(e.clientX,e.clientY)?.closest('.binder-pocket')?.classList.add('drag-over');
},{passive:true});
document.addEventListener('pointerup',e=>{
  if(!touchBinderDrag||e.pointerType==='mouse')return;
  const state=touchBinderDrag;
  touchBinderDrag=null;
  state.card.classList.remove('dragging');
  const pocket=document.elementFromPoint(e.clientX,e.clientY)?.closest('.binder-pocket');
  document.querySelectorAll('.binder-pocket.drag-over').forEach(p=>p.classList.remove('drag-over'));
  if(state.moved&&pocket){
    suppressPocketClick=true;
    const source=collection.find(c=>String(c.id)===String(state.id));
    if(source)moveCard(source,+pocket.dataset.page,+pocket.dataset.slot);
  }
},{passive:true});
document.addEventListener('click',e=>{
  if(suppressPocketClick&&e.target.closest('.pocket-card')){
    e.preventDefault();e.stopImmediatePropagation();suppressPocketClick=false;
  }
},true);
'''
    js_path.write_text(js, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = sw.replace("pokemon-binder-v4", "pokemon-binder-v5").replace("pokemon-binder-v3", "pokemon-binder-v5")
sw_path.write_text(sw, encoding='utf-8')

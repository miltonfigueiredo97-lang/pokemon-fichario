// Pokémon Binder BR — V12.0
(function(){
  'use strict';

  const APP_VERSION = 'V12.0';
  const $q = (s,root=document)=>root.querySelector(s);
  const sleep = ms => new Promise(r=>setTimeout(r,ms));

  const RELEASE_NOTES = [
    {
      version:'V12.0',
      title:'Preços MYP, links e notas da versão',
      items:[
        'Criado menu permanente de Notas da versão com a versão que está realmente carregada no navegador.',
        'Adicionado botão Atualizar preços no Resumo; ele percorre as cartas uma por uma, com intervalo entre consultas, e salva as novas cotações no Supabase.',
        'A inclusão de uma carta passa a tentar a página pública da MYP para obter preço e link, sem depender do token privado da API.',
        'Corrigido o link MYP Cards para nunca reaproveitar um link da Liga Pokémon.',
        'Corrigida a busca da Liga Pokémon para enviar somente Nome (número/total), sem coleção.',
        'Detalhes da carta continuam sem atualizar preço automaticamente; preço só é consultado ao adicionar ou ao usar Atualizar preços.'
      ]
    },
    {version:'V11.5',title:'Detalhes da carta',items:['Detalhes viraram uma tela de consulta.','Campos editáveis ficam escondidos até clicar em Editar.','Página e bolso deixaram de ser editados pelo painel de detalhes.']},
    {version:'V11.4',title:'Fichário físico',items:['Adicionada animação de virada de folha ao navegar entre páginas.']},
    {version:'V11.3',title:'Resumo e visual',items:['Resumo pode ser recolhido.','Adicionados controles para mostrar/esconder etiquetas de status e P&B em cartas Não tenho.','Correção do salvamento do perfil.','Ajustes de nitidez das imagens das cartas.']},
    {version:'V11.2',title:'Correções de interface',items:['Remoção do contorno verde da carta.','Correções de fullscreen e dimensionamento.','Removido CTA gigante da API MYP.','Logout ficou identificado por texto.']},
    {version:'V11.1',title:'Revisão do layout',items:['Refeito o dimensionamento do fichário em cima da base estável.','Navegação lateral e tela cheia reorganizadas.']},
    {version:'V11.0',title:'Nova estrutura do fichário',items:['Barra superior do fichário removida do fluxo principal.','Controles de página e painel lateral reorganizados.','Primeira versão da experiência de fichário em tela cheia.']}
  ];

  function money(v){
    try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0))}catch{return `R$ ${Number(v||0).toFixed(2)}`}
  }

  function ligaQuery(card){
    const name=String(card?.name||card?.namePt||card?.market_name_pt||'').trim();
    const number=String(card?.number||'').trim();
    return number?`${name} (${number})`:name;
  }

  function ligaUrlV12(card){
    return 'https://www.ligapokemon.com.br/?view=cards/search&card='+encodeURIComponent(ligaQuery(card));
  }

  function isMypUrl(value){
    try{return /(^|\.)mypcards\.com$/i.test(new URL(String(value||'')).hostname)}catch{return false}
  }

  function savedCardForDetails(){
    try{
      if(typeof editingCardId!=='undefined'&&editingCardId&&typeof collection!=='undefined'){
        return collection.find(c=>c.id===editingCardId)||null;
      }
    }catch{}
    return null;
  }

  function currentCardForLinks(){
    const saved=savedCardForDetails();
    if(saved)return saved;
    try{if(typeof selectedCard!=='undefined'&&selectedCard)return selectedCard}catch{}
    return null;
  }

  function fixSourceLinks(){
    const card=currentCardForLinks();
    if(!card)return;
    const liga=$q('#ligaSearchLink');
    if(liga)liga.href=ligaUrlV12(card);

    const myp=$q('#mypcardsLink');
    if(myp){
      let href='';
      const candidates=[
        card.price_br_link,
        card.myp_link,
        card.market_link,
        (()=>{try{return typeof selectedMarket!=='undefined'?selectedMarket?.link:''}catch{return ''}})()
      ];
      href=candidates.find(isMypUrl)||'';
      if(href){myp.href=href;myp.classList.remove('hidden')}
      else{myp.removeAttribute('href');myp.classList.add('hidden')}
    }
  }

  async function queryPublicMyp(card){
    if(!card)return null;
    const name=String(card.namePt||card.market_name_pt||card.name||'').trim();
    if(!name)return null;
    const p=new URLSearchParams({name});
    const number=String(card.number||'').trim();
    const set=String(card.setId||card.set_id||card.setName||card.set_name||card.market_edition_pt||'').trim();
    if(number)p.set('number',number);
    if(set)p.set('set',set);
    const known=[card.price_br_link,card.myp_link,card.market?.link].find(isMypUrl);
    if(known)p.set('link',known);
    const r=await fetch(`/api/mypcards-public?${p.toString()}`,{cache:'no-store'});
    const j=await r.json();
    if(!j?.ok)return null;
    return {
      source:'MYP Cards',
      min:Number(j.min||0),avg:Number(j.avg||0),max:Number(j.max||0),
      link:j.link||'',availableQuantity:j.availableQuantity??null,
      namePt:j.name||name,editionPt:j.edition||set,
      checkedAt:j.checkedAt||new Date().toISOString(),
      samples:Number(j.samples||0)
    };
  }

  async function publicFindMarket(card){
    if(card?.market&&(Number(card.market.min)||Number(card.market.avg)||Number(card.market.max)))return card.market;
    try{
      const market=await queryPublicMyp(card);
      if(market)return market;
    }catch(err){console.warn('MYP pública:',err)}
    return {source:'MYP Cards',min:0,avg:0,max:0,link:'',availableQuantity:null};
  }

  function installMarketOverride(){
    try{
      window.__v12OriginalFindMarket = typeof findMarket==='function'?findMarket:null;
      findMarket = publicFindMarket;
    }catch(_e){
      window.findMarket=publicFindMarket;
    }
    try{ligaUrl=ligaUrlV12}catch(_e){window.ligaUrl=ligaUrlV12}
  }

  function releaseNotesHtml(){
    return RELEASE_NOTES.map((note,i)=>`
      <section class="v12-release-item${i===0?' current':''}">
        <div class="v12-release-head"><strong>${note.version}</strong><span>${note.title}</span></div>
        <ul>${note.items.map(x=>`<li>${x}</li>`).join('')}</ul>
      </section>`).join('');
  }

  function openReleaseNotes(){
    let d=$q('#v12ReleaseDialog');
    if(!d){
      d=document.createElement('dialog');
      d.id='v12ReleaseDialog';
      d.className='sheet-dialog v12-release-dialog';
      d.innerHTML=`<div class="dialog-shell v12-release-shell">
        <div class="dialog-head"><div><p class="kicker">Pokémon Binder BR</p><h2>Notas da versão</h2><p class="muted">Versão carregada: <strong>${APP_VERSION}</strong></p></div><button id="v12ReleaseClose" class="icon-only" type="button">×</button></div>
        <div class="v12-release-list">${releaseNotesHtml()}</div>
      </div>`;
      document.body.appendChild(d);
      $q('#v12ReleaseClose',d)?.addEventListener('click',()=>d.close());
      d.addEventListener('click',e=>{if(e.target===d)d.close()});
    }
    if(!d.open)d.showModal();
  }

  function installVersionNotes(){
    const panel=$q('#summaryPanel');
    if(!panel||$q('#v12VersionButton'))return;
    const footer=document.createElement('section');
    footer.className='control-block compact-block v12-version-block';
    footer.innerHTML=`<button id="v12VersionButton" class="v12-version-button" type="button"><span>Versão</span><strong>${APP_VERSION}</strong><small>Notas da versão ›</small></button>`;
    panel.appendChild(footer);
    $q('#v12VersionButton')?.addEventListener('click',openReleaseNotes);
  }

  async function persistMarket(card,market){
    if(!market?.link)return false;
    try{
      if(typeof db==='undefined'||typeof currentUser==='undefined'||!currentUser)return false;
      const patch={
        price_min:Number(market.min||0),
        price_avg:Number(market.avg||0),
        price_max:Number(market.max||0),
        currency:'BRL',
        price_source:'MYP Cards',
        price_link:market.link,
        price_br_source:'MYP Cards',
        price_br_link:market.link,
        market_name_pt:market.namePt||card.market_name_pt||card.name||null,
        market_edition_pt:market.editionPt||card.market_edition_pt||card.set_name||null,
        price_checked_at:market.checkedAt||new Date().toISOString()
      };
      const {error}=await db.from('pokemon_cards').update(patch).eq('id',card.id).eq('user_id',currentUser.id);
      if(error)throw error;
      Object.assign(card,patch);
      return true;
    }catch(err){console.error('Salvar preço:',err);return false}
  }

  let updatingPrices=false;
  async function updateBinderPrices(){
    if(updatingPrices)return;
    let cards=[];
    try{cards=Array.isArray(collection)?[...collection]:[]}catch{}
    if(!cards.length){try{toast('Seu fichário ainda não tem cartas.')}catch{};return}

    const btn=$q('#v12UpdatePrices');
    const status=$q('#v12PriceProgress');
    updatingPrices=true;
    if(btn)btn.disabled=true;
    let updated=0,notFound=0,failed=0;

    try{
      for(let i=0;i<cards.length;i++){
        const card=cards[i];
        if(i>0)await sleep(1300);
        if(btn)btn.textContent=`Atualizando ${i+1}/${cards.length}…`;
        if(status)status.textContent=`Consultando ${card.name||'carta'} · ${i+1} de ${cards.length}`;
        try{
          const market=await queryPublicMyp(card);
          if(market){
            if(await persistMarket(card,market))updated++; else failed++;
          }else notFound++;
        }catch(err){console.warn('Preço da carta:',card?.name,err);failed++}
      }
      try{if(typeof loadCards==='function')await loadCards(false)}catch{}
      if(status)status.textContent=`Concluído: ${updated} atualizada(s) · ${notFound} sem cotação${failed?` · ${failed} erro(s)`:''}.`;
      try{toast(`Preços atualizados: ${updated}/${cards.length}.`)}catch{}
    }finally{
      updatingPrices=false;
      if(btn){btn.disabled=false;btn.textContent='↻ Atualizar preços'}
      fixSourceLinks();
    }
  }

  function installPriceUpdater(){
    const actions=$q('#summaryPanel .action-grid');
    if(!actions||$q('#v12UpdatePrices'))return;
    const btn=document.createElement('button');
    btn.id='v12UpdatePrices';
    btn.className='action-btn v12-price-update';
    btn.type='button';
    btn.textContent='↻ Atualizar preços';
    actions.prepend(btn);
    const status=document.createElement('p');
    status.id='v12PriceProgress';
    status.className='v12-price-progress';
    actions.insertAdjacentElement('afterend',status);
    btn.addEventListener('click',updateBinderPrices);
  }

  function installLinkGuard(){
    const dialog=$q('#cardDialog');
    if(dialog){
      new MutationObserver(()=>{if(dialog.open)setTimeout(fixSourceLinks,0)}).observe(dialog,{attributes:true,attributeFilter:['open']});
    }
    document.addEventListener('click',e=>{
      const liga=e.target.closest?.('#ligaSearchLink');
      if(liga){
        const card=currentCardForLinks();
        if(card)liga.href=ligaUrlV12(card);
      }
      const myp=e.target.closest?.('#mypcardsLink');
      if(myp&&!isMypUrl(myp.href)){
        e.preventDefault();
        try{toast('Ainda não há link MYP salvo. Use Atualizar preços.')}catch{}
      }
    },true);
  }

  function install(){
    installMarketOverride();
    installVersionNotes();
    installPriceUpdater();
    installLinkGuard();
    setTimeout(fixSourceLinks,200);
    window.POKEMON_BINDER_VERSION=APP_VERSION;
    document.documentElement.dataset.appVersion=APP_VERSION;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();

// Pokémon Binder BR — V12.2
(function(){
  'use strict';

  const APP_VERSION='V12.6';
  const $v=(s,r=document)=>r.querySelector(s);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const finishSelections=new Map();
  let bulkBusy=false;

  const FINISHES=[
    ['Normal','Normal / não foil'],
    ['Foil','Foil / holográfica'],
    ['Reverse Foil','Reverse Foil'],
    ['Pokeball Foil','Poké Ball Foil'],
    ['Masterball Foil','Master Ball Foil'],
    ['Full-Art','Full-Art'],
    ['Promo','Promo'],
    ['Especial','Especial / outra']
  ];

  const RELEASE_NOTES=[
    {version:'V12.6',title:'Diagnóstico real das fontes de preço',items:[
      'Confirmado em produção: MYP Cards e Liga Pokémon devolvem HTTP 403 com desafio Cloudflare para leituras automáticas vindas do servidor.',
      'Adicionado suporte a um conector com proxy brasileiro via Apify para consultar as duas fontes sem depender do acesso direto bloqueado.',
      'Falhas de fonte não apagam mais preços já salvos e o botão Atualizar preços agora distingue cotação, bloqueio e erro em vez de informar sucesso falso.',
      'Liga converte Damaged (DM) para o código D usado pelo marketplace; MYP usa dm.'
    ]},
    {version:'V12.5',title:'Curvatura mais natural e virada mais ágil',items:[
      'A folha passou a usar mais segmentos de curvatura com sobreposição e máscara suave para esconder as linhas entre as dobras.',
      'O sombreamento entre segmentos ficou mais discreto para a página parecer uma superfície contínua.',
      'A duração da virada foi reduzida de cerca de 1,65 s para aproximadamente 1,28 s.'
    ]},
    {version:'V12.4',title:'Virada de página flexível em 3D',items:[
      'A animação de troca de página foi refeita: a folha agora dobra em várias faixas 3D em vez de girar como uma placa rígida.',
      'A curvatura progride da borda externa até a lombada, com profundidade, sombra e brilho de plástico.',
      'A duração aumentou para cerca de 1,65 s e o retorno de página usa o movimento inverso para parecer um livro/fichário real.'
    ]},
    {version:'V12.3',title:'Planilha simples, detalhes limpos e mercado visível',items:[
      'O modelo de importação agora contém somente os campos que a pessoa realmente preenche; IDs, imagem, posição automática e preços ficam a cargo do app.',
      'A importação aceita tanto o modelo simples quanto uma planilha completa exportada pelo próprio fichário.',
      'Condição passou a aparecer por extenso nos detalhes, mantendo a sigla entre parênteses.',
      'Local no fichário (Página/Bolso) foi removido dos detalhes da carta.',
      'A virada de página ficou mais lenta para parecer uma folha física.',
      'O painel de mercado passa a sincronizar também o preço principal e tenta resolver o link da MYP mesmo quando ainda não existe link salvo.'
    ]},
    {version:'V12.2',title:'Variantes, dois mercados e Excel',items:[
      'Acabamento/variante passou a fazer parte da consulta de preço: Normal, Foil, Reverse Foil, Poké Ball Foil, Master Ball Foil, Full-Art, Promo e Especial.',
      'Depois de um scan, o acabamento precisa ser confirmado antes de adicionar a carta quando o scanner não puder distinguir o efeito físico.',
      'Atualizar preços agora varre Liga Pokémon e MYP Cards para cada carta; a média da Liga é a referência principal do fichário, com fallback para MYP.',
      'Detalhes mostram mínimo, médio e máximo de Liga e MYP separadamente.',
      'Adicionados Exportar Excel, Baixar modelo Excel e Importar Excel, com importação em lote no mesmo formato.'
    ]},
    {version:'V12.1',title:'Correspondência exata de carta e número completo',items:['Liga recebe Nome (número/total).','O total da coleção é recuperado pelo TCGdex quando necessário.','MYP valida nome, número, coleção e idioma.']},
    {version:'V12.0',title:'Preços públicos e notas da versão',items:['Criado menu de notas da versão.','Adicionado Atualizar preços no Resumo.','MYP pública passou a ser consultada sem token privado.','Links MYP/Liga foram separados.']},
    {version:'V11.5',title:'Detalhes da carta',items:['Detalhes viraram tela de consulta.','Campos editáveis aparecem só em Editar.','Página e bolso saíram da edição.']},
    {version:'V11.4',title:'Fichário físico',items:['Adicionada animação de virada de folha.']},
    {version:'V11.3',title:'Resumo e visual',items:['Resumo recolhível.','Controle das etiquetas de status e P&B.','Correções de perfil e nitidez.']},
    {version:'V11.2',title:'Correções de interface',items:['Contorno de status removido.','Fullscreen e dimensionamento corrigidos.','CTA da API MYP removido.']},
    {version:'V11.1',title:'Revisão do layout',items:['Dimensionamento e navegação do fichário refeitos.']},
    {version:'V11.0',title:'Nova estrutura do fichário',items:['Controles de página e painel lateral reorganizados.']}
  ];

  function fmt(v){try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0))}catch{return `R$ ${Number(v||0).toFixed(2)}`}}
  function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
  function hasPrice(m){return !!(m&&(Number(m.min)||Number(m.avg)||Number(m.max)))}
  function finishLabel(v){return FINISHES.find(([value])=>value===v)?.[1]||v||'Normal / não foil'}
  function normalizeFinish(v){const n=norm(v);if(!n)return'Normal';if(n.includes('master'))return'Masterball Foil';if(n.includes('poke')&&n.includes('ball'))return'Pokeball Foil';if(n.includes('reverse'))return'Reverse Foil';if(n.includes('full art'))return'Full-Art';if(n.includes('promo'))return'Promo';if(n==='holo'||n.includes('holograf')||n==='foil')return'Foil';if(n.includes('especial'))return'Especial';return'Normal'}
  function normalizeCondition(v){const s=String(v||'Nova').trim().toUpperCase();return['NM','SP','MP','HP','DM'].includes(s)?s:(s==='NOVA'?'Nova':'Nova')}
  function statusToInternal(v){const n=norm(v);if(n==='quero'||n==='wishlist')return'wanted';if(n==='pedido'||n==='encomendado')return'ordered';if(n==='nao tenho'||n==='faltando'||n==='missing')return'missing';return'owned'}
  function internalToStatus(v){return({owned:'Tenho',wanted:'Quero',ordered:'Pedido',missing:'Não tenho'})[v]||'Tenho'}
  function langCode(v){const n=norm(v);if(n.startsWith('jap')||n==='ja')return'ja';if(n.startsWith('ing')||n==='en')return'en';return'pt-br'}
  function langName(code){return code==='ja'?'Japonês':code==='en'?'Inglês':'Português'}

  async function resolveFullNumber(card){
    const raw=String(card?.number||'').trim();
    if(/\d+\s*\/\s*\d+/.test(raw))return raw.replace(/\s/g,'');
    if(!raw)return'';
    const printed=String(card?.printedTotal||card?.printed_total||'').trim();
    if(/^\d+$/.test(printed))return `${Number(raw)}/${Number(printed)}`;
    const apiId=String(card?.apiId||card?.api_id||'').trim();
    if(!apiId)return raw;
    try{
      const r=await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(apiId)}`,{cache:'force-cache'});
      if(r.ok){const d=await r.json();const total=Number(d?.set?.cardCount?.official||0);if(total>0)return `${Number(raw)}/${total}`}
    }catch{}
    return raw;
  }

  function ligaSearchUrl(card,fullNumber){const name=String(card?.name||'').trim();const number=fullNumber||String(card?.number||'').trim();return 'https://www.ligapokemon.com.br/?view=cards/search&card='+encodeURIComponent(number?`${name} (${number})`:name)}
  function isMypUrl(v){try{return /(^|\.)mypcards\.com$/i.test(new URL(String(v||'')).hostname)}catch{return false}}

  async function querySource(endpoint,source,card,finish,condition){
    const full=await resolveFullNumber(card);
    const p=new URLSearchParams({name:String(card?.market_name_pt||card?.namePt||card?.name||''),number:full,finish:finish||'Normal',condition:condition||'Nova'});
    const set=String(card?.setId||card?.set_id||card?.setName||card?.set_name||card?.market_edition_pt||'').trim();
    if(set)p.set('set',set);
    const lang=String(card?.languageCode||card?.language_code||'').trim();if(lang)p.set('lang',lang);
    if(source==='myp'){
      const known=[card?.myp_price_link,card?.price_br_link,card?.price_link].find(isMypUrl);if(known)p.set('link',known);
    }
    const r=await fetch(`${endpoint}?${p.toString()}`,{cache:'no-store'});const j=await r.json();
    if(!j?.ok){
      return {source:j?.source||source,failed:true,error:j?.error||'unknown',message:j?.message||'',needsApifyToken:!!j?.needsApifyToken,provider:j?.provider||''};
    }
    return {source:j.source||source,failed:false,provider:j.provider||'',min:Number(j.min||0),avg:Number(j.avg||0),max:Number(j.max||0),link:j.link||'',checkedAt:j.checkedAt||new Date().toISOString(),samples:j.samples??null,availableQuantity:j.availableQuantity??null,exactVariant:j.exactVariant!==false,namePt:j.name||card?.name||'',editionPt:j.edition||set,number:j.number||full,finish:finish||'Normal',condition:condition||'Nova'};
  }

  async function queryBothMarkets(card,finish='Normal',condition='Nova'){
    const [liga,myp]=await Promise.all([
      querySource('/api/liga-public','liga',card,finish,condition).catch(()=>null),
      querySource('/api/mypcards-public','myp',card,finish,condition).catch(()=>null)
    ]);
    const primary=hasPrice(liga)?liga:(hasPrice(myp)?myp:null);
    return {source:hasPrice(liga)?'Liga Pokémon':(hasPrice(myp)?'MYP Cards':'Sem preço BR'),min:Number(primary?.min||0),avg:Number(primary?.avg||0),max:Number(primary?.max||0),link:primary?.link||'',checkedAt:primary?.checkedAt||new Date().toISOString(),liga,myp,finish,condition};
  }
  window.queryBothMarketsV122=queryBothMarkets;

  function savedDual(card){
    if(!card)return {source:'Sem preço BR',min:0,avg:0,max:0,link:'',liga:null,myp:null};
    const liga={source:'Liga Pokémon',min:+card.liga_price_min||0,avg:+card.liga_price_avg||0,max:+card.liga_price_max||0,link:card.liga_price_link||'',checkedAt:card.liga_price_checked_at||null};
    const myp={source:'MYP Cards',min:+card.myp_price_min||0,avg:+card.myp_price_avg||0,max:+card.myp_price_max||0,link:card.myp_price_link||'',checkedAt:card.myp_price_checked_at||null};
    const primary=hasPrice(liga)?liga:(hasPrice(myp)?myp:null);
    return {source:hasPrice(liga)?'Liga Pokémon':(hasPrice(myp)?'MYP Cards':'Sem preço BR'),min:+primary?.min||0,avg:+primary?.avg||0,max:+primary?.max||0,link:primary?.link||'',liga,myp,finish:card.finish||'Normal',condition:card.condition||'Nova'};
  }

  function marketPatch(card,dual){
    const oldLiga={min:+card?.liga_price_min||0,avg:+card?.liga_price_avg||0,max:+card?.liga_price_max||0,link:card?.liga_price_link||'',checkedAt:card?.liga_price_checked_at||null};
    const oldMyp={min:+card?.myp_price_min||0,avg:+card?.myp_price_avg||0,max:+card?.myp_price_max||0,link:card?.myp_price_link||'',checkedAt:card?.myp_price_checked_at||null};
    const ligaFresh=dual?.liga&&!dual.liga.failed;
    const mypFresh=dual?.myp&&!dual.myp.failed;
    const liga=ligaFresh?dual.liga:oldLiga;
    const myp=mypFresh?dual.myp:oldMyp;
    const primary=hasPrice(liga)?liga:(hasPrice(myp)?myp:null);
    const anyFresh=ligaFresh||mypFresh;
    return {
      liga_price_min:+liga.min||0,liga_price_avg:+liga.avg||0,liga_price_max:+liga.max||0,liga_price_link:liga.link||null,liga_price_checked_at:liga.checkedAt||null,
      myp_price_min:+myp.min||0,myp_price_avg:+myp.avg||0,myp_price_max:+myp.max||0,myp_price_link:myp.link||null,myp_price_checked_at:myp.checkedAt||null,
      price_min:+primary?.min||(+card?.price_min||0),price_avg:+primary?.avg||(+card?.price_avg||0),price_max:+primary?.max||(+card?.price_max||0),currency:'BRL',
      price_source:hasPrice(liga)?'Liga Pokémon':(hasPrice(myp)?'MYP Cards':(card?.price_source||'Sem preço BR')),
      price_link:primary?.link||card?.price_link||ligaSearchUrl(card),
      price_br_source:hasPrice(liga)?'Liga Pokémon':(hasPrice(myp)?'MYP Cards':(card?.price_br_source||null)),
      price_br_link:primary?.link||card?.price_br_link||null,
      price_checked_at:anyFresh?(primary?.checkedAt||new Date().toISOString()):(card?.price_checked_at||null)
    };
  }

  function installCoreOverrides(){
    try{
      const originalPayload=cardPayload;
      cardPayload=function(c,v,m={}){
        const p=originalPayload(c,v,m);
        if(m?.liga||m?.myp)Object.assign(p,marketPatch(c,m));
        p.finish=normalizeFinish(v?.finish||p.finish);
        p.finish_confirmed=!!(v?.finishConfirmed||m?.finishConfirmed||false);
        return p;
      };
    }catch(e){console.warn('V12.2 cardPayload:',e)}
    try{findMarket=async c=>queryBothMarkets(c,normalizeFinish(c?.finish||'Normal'),c?.condition||'Nova')}catch{}
    try{
      refreshMarket=async function(){
        if(!selectedCard)return;
        if(editingCardId){
          const saved=collection.find(c=>c.id===editingCardId);const dual=savedDual(saved);selectedMarket=dual;setPrices(dual.min,dual.avg,dual.max);renderDualMarket(dual,saved);fixLinks(saved);return;
        }
        const finish=normalizeFinish($v('#cardFinish')?.value||'Normal'),condition=$v('#cardCondition')?.value||'Nova';
        const dual=await queryBothMarkets(selectedCard,finish,condition);selectedMarket=dual;setPrices(dual.min,dual.avg,dual.max);renderDualMarket(dual,selectedCard);fixLinks({...selectedCard,...marketPatch(selectedCard,dual)});
      };
    }catch(e){console.warn('V12.2 refreshMarket:',e)}
    try{inferFinish=c=>suggestFinish(c)}catch{}
  }

  function injectFinishOptions(){
    const sel=$v('#cardFinish');if(!sel)return;
    const current=normalizeFinish(sel.value);
    sel.innerHTML=FINISHES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    sel.value=current;
  }
  function suggestFinish(c){const r=norm(c?.rarity),set=norm(c?.setName||c?.set_name);if(r.includes('full art')||r.includes('ultra rare')||r.includes('rara ultra'))return'Full-Art';if(set.includes('promo'))return'Promo';if(r.includes('holo'))return'Foil';return'Normal'}

  function renderFinishControls(){
    const tray=$v('.selection-tray');if(!tray)return;
    let box=$v('#v122FinishBox',tray);
    const selected=[];try{catalogSelection.forEach((c,k)=>selected.push([k,c]))}catch{}
    if(!selected.length){box?.remove();return}
    if(!box){box=document.createElement('div');box.id='v122FinishBox';box.className='v122-finish-box';tray.prepend(box)}
    const scanMode=/detectado ao vivo/i.test($v('#ocrStatus')?.textContent||'');
    box.innerHTML='<div class="v122-finish-title"><strong>Acabamento / variante</strong><small>Isso altera o preço. Confirme antes de adicionar.</small></div>';
    selected.forEach(([key,c])=>{
      if(!finishSelections.has(key))finishSelections.set(key,scanMode?'':suggestFinish(c));
      const row=document.createElement('label');row.className='v122-finish-row';
      const val=finishSelections.get(key)||'';
      row.innerHTML=`<span>${c.name||'Carta'} <small>${c.number||''}</small></span><select data-finish-key="${encodeURIComponent(key)}"><option value="">Selecione o acabamento…</option>${FINISHES.map(([v,l])=>`<option value="${v}"${v===val?' selected':''}>${l}</option>`).join('')}</select>`;
      box.appendChild(row);
    });
    box.querySelectorAll('select[data-finish-key]').forEach(s=>s.addEventListener('change',()=>finishSelections.set(decodeURIComponent(s.dataset.finishKey),s.value)));
  }

  async function addSelectedV122(){
    let cards=[];try{cards=[...catalogSelection.entries()]}catch{}
    if(!cards.length)return;
    renderFinishControls();
    for(const [key] of cards){if(!finishSelections.get(key)){try{toast('Escolha o acabamento da carta antes de adicionar.')}catch{};$v('#v122FinishBox')?.scrollIntoView({behavior:'smooth',block:'nearest'});return}}
    const b=$v('#btnAddSelected');if(b){b.disabled=true;b.dataset.old=b.textContent;b.textContent='Adicionando…'}
    try{
      const positions=freePositions(pendingPosition?.page||currentPage,cards.length),maxPage=Math.max(...positions.map(p=>p.page));if(maxPage>+settings.binder_pages)await updateSettings({binder_pages:maxPage},true);
      for(let i=0;i<cards.length;i++){
        if(i>0)await sleep(1250);
        const [key,raw]=cards[i],pos=positions[i],finish=finishSelections.get(key),condition='Nova';
        const c={...raw};const full=await resolveFullNumber(c);if(full)c.number=full;
        const dual=await queryBothMarkets(c,finish,condition);dual.finishConfirmed=true;
        const payload=cardPayload(c,{page:pos.page,slot:pos.slot,status:'owned',quantity:1,condition,finish,finishConfirmed:true,notes:''},dual);
        const {data:existing,error:findErr}=await db.from('pokemon_cards').select('id,quantity').eq('user_id',currentUser.id).eq('card_key',payload.card_key).eq('condition',payload.condition).eq('finish',payload.finish).maybeSingle();if(findErr)throw findErr;
        if(existing){const patch={quantity:(+existing.quantity||0)+1,finish_confirmed:true,...marketPatch(c,dual)};const{error}=await db.from('pokemon_cards').update(patch).eq('id',existing.id).eq('user_id',currentUser.id);if(error)throw error}
        else{const{error}=await db.from('pokemon_cards').insert(payload);if(error)throw error}
      }
      catalogSelection.clear();finishSelections.clear();closeDialog('addDialog');currentPage=positions[0]?.page||currentPage;await loadCards(false);toast(`${cards.length} carta${cards.length===1?'':'s'} adicionada${cards.length===1?'':'s'}.`);
    }catch(e){console.error(e);toast('Não consegui adicionar todas as cartas.')}finally{if(b){b.disabled=false;b.textContent=b.dataset.old||'＋ Adicionar'}}
  }

  function installFinishConfirmation(){
    injectFinishOptions();
    const results=$v('#resultsList');if(results){results.addEventListener('click',()=>setTimeout(renderFinishControls,0));new MutationObserver(()=>setTimeout(renderFinishControls,0)).observe(results,{childList:true})}
    const clear=$v('#btnClearSelection');clear?.addEventListener('click',()=>{finishSelections.clear();setTimeout(renderFinishControls,0)});
    const add=$v('#btnAddSelected');if(add)add.onclick=addSelectedV122;
  }

  function ensureMarketBoard(){
    const board=$v('.market-board');if(!board||$v('#v122MarketSources'))return;
    const title=board.querySelector('.market-board-title');if(title){title.querySelector('span').textContent='Mercado brasileiro';title.querySelector('small').textContent='Referência: média Liga Pokémon'}
    const primary=document.createElement('p');primary.id='v122PrimaryNote';primary.className='v122-primary-note';primary.textContent='O valor do fichário usa a média da Liga; MYP é comparação e fallback.';board.appendChild(primary);
    const wrap=document.createElement('div');wrap.id='v122MarketSources';wrap.className='v122-market-sources';wrap.innerHTML=`
      <section data-market-source="liga"><header><strong>Liga Pokémon</strong><span>principal</span></header><div><b>Mín.</b><strong data-price="min">—</strong><b>Médio</b><strong data-price="avg">—</strong><b>Máx.</b><strong data-price="max">—</strong></div></section>
      <section data-market-source="myp"><header><strong>MYP Cards</strong><span>comparação</span></header><div><b>Mín.</b><strong data-price="min">—</strong><b>Médio</b><strong data-price="avg">—</strong><b>Máx.</b><strong data-price="max">—</strong></div></section>`;
    board.appendChild(wrap);
  }
  function renderSource(key,m){const box=$v(`[data-market-source="${key}"]`);if(!box)return;['min','avg','max'].forEach(k=>{const el=box.querySelector(`[data-price="${k}"]`);if(el)el.textContent=Number(m?.[k]||0)?fmt(m[k]):'—'});box.classList.toggle('no-data',!hasPrice(m))}
  function renderDualMarket(dual,card){
    ensureMarketBoard();
    renderSource('liga',dual?.liga);
    renderSource('myp',dual?.myp);
    const primary=hasPrice(dual?.liga)?dual.liga:(hasPrice(dual?.myp)?dual.myp:null);
    try{if(typeof setPrices==='function')setPrices(primary?.min||0,primary?.avg||0,primary?.max||0)}catch{}
    const status=$v('#marketStatus');
    if(!status)return;
    if(hasPrice(dual?.liga))status.textContent=`Liga Pokémon · ${finishLabel(card?.finish||dual?.finish)}`;
    else if(hasPrice(dual?.myp))status.textContent=`Liga sem cotação · usando MYP · ${finishLabel(card?.finish||dual?.finish)}`;
    else if(dual?.liga?.needsApifyToken||dual?.myp?.needsApifyToken)status.textContent='Leitura direta bloqueada pelos sites · conector de preços não configurado';
    else if(dual?.liga?.failed||dual?.myp?.failed)status.textContent='Não foi possível atualizar as fontes agora';
    else status.textContent='Sem cotação encontrada para esta variante';
  }

  async function fixLinks(card){
    if(!card)return;
    const full=await resolveFullNumber(card);
    const liga=$v('#ligaSearchLink');
    if(liga)liga.href=card.liga_price_link||ligaSearchUrl(card,full);
    const myp=$v('#mypcardsLink');
    if(myp){
      let u=[card.myp_price_link,card.price_br_link,card.price_link].find(isMypUrl)||'';
      if(!u){
        try{
          const resolved=await querySource('/api/mypcards-public','myp',card,normalizeFinish(card.finish||'Normal'),card.condition||'Nova');
          u=resolved?.link||'';
        }catch{}
      }
      if(u){myp.href=u;myp.classList.remove('hidden')}
      else{myp.removeAttribute('href');myp.classList.add('hidden')}
    }
  }

  function installExistingCardMarketView(){
    ensureMarketBoard();
    const dialog=$v('#cardDialog');if(!dialog)return;
    new MutationObserver(()=>{if(!dialog.open)return;setTimeout(()=>{let saved=null;try{saved=editingCardId?collection.find(c=>c.id===editingCardId):null}catch{};if(saved){const dual=savedDual(saved);renderDualMarket(dual,saved);fixLinks(saved)}},30)}).observe(dialog,{attributes:true,attributeFilter:['open']});
  }

  async function persistDual(card,dual){const patch=marketPatch(card,dual);const{error}=await db.from('pokemon_cards').update(patch).eq('id',card.id).eq('user_id',currentUser.id);if(error)throw error;Object.assign(card,patch);return true}
  async function updateAllPrices(){
    if(bulkBusy)return;let cards=[];try{cards=[...collection]}catch{};if(!cards.length){toast('Seu fichário ainda não tem cartas.');return}
    bulkBusy=true;const b=$v('#v12UpdatePrices'),status=$v('#v12PriceProgress');if(b)b.disabled=true;
    let both=0,one=0,unavailable=0,notFound=0,exceptions=0,needsConnector=false;
    try{
      for(let i=0;i<cards.length;i++){
        if(i>0)await sleep(1350);
        const card=cards[i];
        if(b)b.textContent=`Atualizando ${i+1}/${cards.length}…`;
        if(status)status.textContent=`${card.name} · ${finishLabel(card.finish)} · consultando Liga + MYP…`;
        try{
          const dual=await queryBothMarkets(card,normalizeFinish(card.finish),card.condition||'Nova');
          await persistDual(card,dual);
          const ligaOk=hasPrice(dual.liga),mypOk=hasPrice(dual.myp);
          if(ligaOk&&mypOk)both++;
          else if(ligaOk||mypOk)one++;
          else if(dual?.liga?.needsApifyToken||dual?.myp?.needsApifyToken){unavailable++;needsConnector=true}
          else if(dual?.liga?.failed||dual?.myp?.failed){
            const errors=[dual?.liga?.error,dual?.myp?.error].filter(Boolean);
            if(errors.every(x=>x==='not_found'))notFound++;else unavailable++;
          }else notFound++;
        }catch(e){console.warn(e);exceptions++}
      }
      await loadCards(false);
      const updated=both+one;
      if(status){
        status.textContent=needsConnector
          ?`Concluído: ${updated} com preço · ${unavailable} bloqueada(s) pelos sites. Configure o conector de preços.`
          :`Concluído: ${both} nos 2 mercados · ${one} em 1 mercado · ${notFound} sem cotação · ${unavailable+exceptions} falha(s).`;
      }
      toast(needsConnector?'Os sites bloquearam a leitura direta. Falta ativar o conector de preços.':`Preços atualizados: ${updated}/${cards.length}.`);
    }finally{bulkBusy=false;if(b){b.disabled=false;b.textContent='↻ Atualizar preços · Liga + MYP'}}
  }
  function rewirePriceButton(){const old=$v('#v12UpdatePrices');if(!old||old.dataset.v122==='1')return;const b=old.cloneNode(true);b.dataset.v122='1';b.textContent='↻ Atualizar preços · Liga + MYP';old.replaceWith(b);b.addEventListener('click',updateAllPrices)}

  function releaseHtml(){return RELEASE_NOTES.map((n,i)=>`<section class="v12-release-item${i===0?' current':''}"><div class="v12-release-head"><strong>${n.version}</strong><span>${n.title}</span></div><ul>${n.items.map(x=>`<li>${x}</li>`).join('')}</ul></section>`).join('')}
  function openNotes(){let d=$v('#v122ReleaseDialog');if(!d){d=document.createElement('dialog');d.id='v122ReleaseDialog';d.className='sheet-dialog v12-release-dialog';d.innerHTML=`<div class="dialog-shell v12-release-shell"><div class="dialog-head"><div><p class="kicker">Pokémon Binder BR</p><h2>Notas da versão</h2><p class="muted">Versão carregada: <strong>${APP_VERSION}</strong></p></div><button class="icon-only" type="button">×</button></div><div class="v12-release-list">${releaseHtml()}</div></div>`;document.body.appendChild(d);d.querySelector('.icon-only').onclick=()=>d.close();d.addEventListener('click',e=>{if(e.target===d)d.close()})}if(!d.open)d.showModal()}
  function upgradeVersionButton(){const old=$v('#v12VersionButton');if(!old)return;const b=old.cloneNode(true);b.querySelector('strong').textContent=APP_VERSION;b.querySelector('small').textContent='Notas da versão ›';old.replaceWith(b);b.addEventListener('click',openNotes);window.POKEMON_BINDER_VERSION=APP_VERSION;document.documentElement.dataset.appVersion=APP_VERSION}

  async function ensureXLSX(){if(window.XLSX)return true;return new Promise(resolve=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';s.onload=()=>resolve(true);s.onerror=()=>resolve(false);document.head.appendChild(s)})}
  const XLS_HEADERS=['Nome','Número','Coleção','Idioma','Status','Quantidade','Condição','Acabamento','Página','Bolso','Observações','API ID','Set ID','Imagem URL','Liga Mínimo','Liga Médio','Liga Máximo','Link Liga','MYP Mínimo','MYP Médio','MYP Máximo','Link MYP','Preço do Fichário','Fonte principal','Última atualização'];
  const IMPORT_HEADERS=['Nome','Número','Coleção','Idioma','Status','Quantidade','Condição','Acabamento','Observações'];
  const INSTRUCTIONS=[
    ['Coluna','Como preencher','Obrigatório?'],
    ['Nome','Nome da carta. Ex.: Lugia-EX','Sim'],
    ['Número','Número completo. Ex.: 134/135','Sim'],
    ['Coleção','Nome da coleção. Ex.: Tempestade de Plasma','Recomendado'],
    ['Idioma','Português, Inglês ou Japonês','Não'],
    ['Status','Tenho, Quero, Pedido ou Não tenho','Não'],
    ['Quantidade','Número inteiro; para Tenho use 1 ou mais','Não'],
    ['Condição','Nova, Near Mint (NM), Slightly Played (SP), Moderately Played (MP), Heavily Played (HP) ou Damaged (DM)','Não'],
    ['Acabamento','Normal, Foil, Reverse Foil, Pokeball Foil, Masterball Foil, Full-Art, Promo ou Especial','Recomendado'],
    ['Observações','Texto livre. Pode ficar vazio.','Não'],
    ['O app preenche sozinho','Página/bolso quando não vierem de um backup, API ID, Set ID, imagem, links e preços de Liga/MYP. Não coloque essas colunas no modelo simples.','Automático'],
    ['Importação','Aceita tanto este modelo simples quanto o arquivo completo gerado por “Baixar meu fichário em Excel”.','—']
  ];
  function rowsForExcel(){return collection.map(c=>({Nome:c.name||'',Número:c.number||'',Coleção:c.set_name||'',Idioma:c.language||'',Status:internalToStatus(c.collection_status),Quantidade:+c.quantity||0,Condição:c.condition||'Nova',Acabamento:normalizeFinish(c.finish),Página:+c.binder_page||'',Bolso:+c.binder_slot||'',Observações:c.notes||'','API ID':c.api_id||'','Set ID':c.set_id||'','Imagem URL':c.image_url||'','Liga Mínimo':+c.liga_price_min||0,'Liga Médio':+c.liga_price_avg||0,'Liga Máximo':+c.liga_price_max||0,'Link Liga':c.liga_price_link||'','MYP Mínimo':+c.myp_price_min||0,'MYP Médio':+c.myp_price_avg||0,'MYP Máximo':+c.myp_price_max||0,'Link MYP':c.myp_price_link||'','Preço do Fichário':+c.price_avg||0,'Fonte principal':c.price_source||'','Última atualização':c.price_checked_at||''}))}
  function buildWorkbook(rows,template=false){
    const wb=XLSX.utils.book_new();
    const headers=template?IMPORT_HEADERS:XLS_HEADERS;
    const data=template?[Object.fromEntries(headers.map(h=>[h,'']))]:rows;
    const ws=XLSX.utils.json_to_sheet(data,{header:headers});
    ws['!cols']=headers.map(h=>({wch:Math.min(30,Math.max(11,h.length+3))}));
    const lastCol=XLSX.utils.encode_col(headers.length-1);
    ws['!autofilter']={ref:`A1:${lastCol}${Math.max(2,data.length+1)}`};
    XLSX.utils.book_append_sheet(wb,ws,'Fichário');
    const ins=XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
    ins['!cols']=[{wch:22},{wch:82},{wch:16}];
    XLSX.utils.book_append_sheet(wb,ins,'Instruções');
    return wb;
  }
  async function exportExcel(template=false){
    if(!await ensureXLSX())return toast('Não consegui carregar o módulo de Excel.');
    const wb=buildWorkbook(template?[]:rowsForExcel(),template);
    XLSX.writeFile(wb,template?'modelo-importacao-pokemon.xlsx':'meu-fichario-pokemon-completo.xlsx');
  }
  function rowValue(row,...names){const keys=Object.keys(row);for(const name of names){const wanted=norm(name);const k=keys.find(x=>norm(x)===wanted);if(k!=null&&row[k]!=null)return row[k]}return''}
  async function resolveImportCard(row){const name=String(rowValue(row,'Nome')).trim(),number=String(rowValue(row,'Número')).trim(),setName=String(rowValue(row,'Coleção')).trim(),language=String(rowValue(row,'Idioma')).trim()||'Português',code=langCode(language),apiId=String(rowValue(row,'API ID')).trim(),setId=String(rowValue(row,'Set ID')).trim(),image=String(rowValue(row,'Imagem URL')).trim();let card=null;
    try{if(apiId&&typeof fetchTCGdexCard==='function')card=await fetchTCGdexCard(code,apiId)}catch{}
    if(!card){try{let found=await searchTCGdex(code,name,number);if(!found.length&&code!=='en')found=await searchTCGdex('en',name,number);const n=String(number).split('/')[0];const exact=found.filter(c=>norm(c.name)===norm(name)&&(!n||String(c.number)===String(Number(n))));card=(exact.length?exact:found)[0]||null}catch{}}
    if(card){card={...card,name:name||card.name,setName:setName||card.setName,setId:setId||card.setId,languageCode:code,language:langName(code)};const full=number.includes('/')?number:await resolveFullNumber(card);if(full)card.number=full;if(image)card.imageUrl=image;return card}
    return{source:'Importação',apiId,setId,name,number,setName,languageCode:code,language:langName(code),rarity:'',type:'',imageUrl:image,printedTotal:''}
  }
  function desiredPosition(row,used){
    const requestedPage=Number(rowValue(row,'Página')),requestedSlot=Number(rowValue(row,'Bolso'));
    const isFree=(page,slot)=>page>=1&&slot>=1&&slot<=9&&!getCardAt(page,slot)&&!used.has(`${page}:${slot}`);
    if(isFree(requestedPage,requestedSlot)){used.add(`${requestedPage}:${requestedSlot}`);return{page:requestedPage,slot:requestedSlot}}
    const basePages=Math.max(1,+settings.binder_pages||1);
    const start=Math.max(1,+currentPage||1);
    const scan=[];
    for(let page=start;page<=basePages;page++)scan.push(page);
    for(let page=1;page<start;page++)scan.push(page);
    for(const page of scan){for(let slot=1;slot<=9;slot++){if(isFree(page,slot)){used.add(`${page}:${slot}`);return{page,slot}}}}
    let page=basePages+1;
    while(true){for(let slot=1;slot<=9;slot++){if(!used.has(`${page}:${slot}`)){used.add(`${page}:${slot}`);return{page,slot}}}page++}
  }
  async function importExcelFile(file){if(!file)return;if(!await ensureXLSX())return toast('Não consegui carregar o módulo de Excel.');const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array'}),ws=wb.Sheets['Fichário']||wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:''});if(!rows.length)return toast('A planilha não tem cartas.');const valid=rows.filter(r=>String(rowValue(r,'Nome')).trim()&&String(rowValue(r,'Número')).trim());if(!valid.length)return toast('Preencha pelo menos Nome e Número.');const status=$v('#v12PriceProgress'),used=new Set();let added=0,failed=0,maxPage=+settings.binder_pages||1;bulkBusy=true;
    try{for(let i=0;i<valid.length;i++){if(i>0)await sleep(1350);const row=valid[i];if(status)status.textContent=`Importando ${i+1}/${valid.length} · ${rowValue(row,'Nome')}`;try{const card=await resolveImportCard(row),finish=normalizeFinish(rowValue(row,'Acabamento')),condition=normalizeCondition(rowValue(row,'Condição')),st=statusToInternal(rowValue(row,'Status')),quantity=st==='owned'?Math.max(1,Number(rowValue(row,'Quantidade'))||1):0,pos=desiredPosition(row,used);maxPage=Math.max(maxPage,pos.page);const dual=await queryBothMarkets(card,finish,condition);dual.finishConfirmed=true;const payload=cardPayload(card,{page:pos.page,slot:pos.slot,status:st,quantity,condition,finish,finishConfirmed:true,notes:String(rowValue(row,'Observações')||'')},dual);const{data:existing}=await db.from('pokemon_cards').select('id,quantity').eq('user_id',currentUser.id).eq('card_key',payload.card_key).eq('condition',payload.condition).eq('finish',payload.finish).maybeSingle();if(existing){const patch={quantity:st==='owned'?(+existing.quantity||0)+quantity:0,collection_status:st,finish_confirmed:true,...marketPatch(card,dual)};const{error}=await db.from('pokemon_cards').update(patch).eq('id',existing.id).eq('user_id',currentUser.id);if(error)throw error}else{const{error}=await db.from('pokemon_cards').insert(payload);if(error)throw error}added++}catch(e){console.error('Importação:',e);failed++}}
      if(maxPage>+settings.binder_pages)await updateSettings({binder_pages:maxPage},true);await loadCards(false);if(status)status.textContent=`Importação concluída: ${added} carta(s) · ${failed} erro(s).`;toast(`Importação concluída: ${added}/${valid.length}.`)
    }finally{bulkBusy=false}}
  function installExcelActions(){
    const actions=$v('#summaryPanel .action-grid');if(!actions||$v('#v122ExportExcel'))return;
    const mk=(id,text,title)=>{const b=document.createElement('button');b.id=id;b.type='button';b.className='action-btn';b.textContent=text;b.title=title;return b};
    const exp=mk('v122ExportExcel','Baixar meu fichário em Excel','Backup completo: inclui suas cartas, posições, links e preços salvos.');
    const tpl=mk('v122TemplateExcel','Baixar modelo para importar','Modelo simples: só os campos que você preenche; o app completa o restante.');
    const imp=mk('v122ImportExcel','Importar planilha Excel','Aceita o modelo simples ou um Excel completo exportado pelo fichário.');
    const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls';input.className='hidden';input.id='v122ExcelInput';
    actions.prepend(imp);actions.prepend(tpl);actions.prepend(exp);actions.appendChild(input);
    const help=document.createElement('p');help.className='v123-excel-help';help.innerHTML='<strong>Meu fichário:</strong> backup completo com preços e links.<br><strong>Modelo:</strong> somente o que você precisa preencher para importar.';
    actions.insertAdjacentElement('afterend',help);
    exp.onclick=()=>exportExcel(false);tpl.onclick=()=>exportExcel(true);imp.onclick=()=>input.click();
    input.onchange=async()=>{const f=input.files?.[0];input.value='';if(f)await importExcelFile(f)};
  }

  function install(){
    installCoreOverrides();
    installFinishConfirmation();
    installExistingCardMarketView();
    setTimeout(()=>{rewirePriceButton();upgradeVersionButton();installExcelActions();ensureMarketBoard()},0);
    setTimeout(()=>{rewirePriceButton();upgradeVersionButton();installExcelActions();ensureMarketBoard()},500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();

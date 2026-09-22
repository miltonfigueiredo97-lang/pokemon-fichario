// Pokémon Binder BR — V12.2
(function(){
  'use strict';

  const APP_VERSION='V14.50';
  const $v=(s,r=document)=>r.querySelector(s);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const finishSelections=new Map();
  const conditionSelections=new Map();
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

  const CONDITIONS=[
    ['Nova','Nova / Near Mint (NM)'],
    ['SP','Pouco jogada (SP)'],
    ['MP','Moderadamente jogada (MP)'],
    ['HP','Muito jogada (HP)'],
    ['DM','Danificada (DM)']
  ];

  const RELEASE_NOTES=[
    {version:'V14.50',title:'Preço MYP corrigido, busca por geração/coleção e fila persistente de Master Set',items:[
      'MYP não confunde mais a bandeira/localidade do vendedor com o idioma da carta; ofertas válidas da mesma página de produto entram novamente no cálculo.',
      'A busca de cartas agora segue Geração → Coleção, como o Master Set, reduzindo ambiguidades em Celebrações, promos e outras coleções especiais.',
      'Celebrações Coleção Clássica usa a numeração de mercado da coleção como número principal; Zekrom é 21/25, mantendo CC021 e 114/114 como aliases de busca.',
      'A coleção clássica de 30 anos também usa numeração da própria coleção (1/30…30/30), preservando os números originais como aliases.',
      'Master Sets entram completos na fila persistente com próxima tentativa, prioridade e contador inicializados; o worker do servidor continua processando mesmo com o app fechado.',
      'Falhas temporárias de mercado passam por mais tentativas e cartas realmente sem cotação exibem SEM COTAÇÃO em vez de simplesmente perder o indicador.'
    ]},
    {version:'V14.49',title:'Busca por coleções comemorativas e numeração especial',items:[
      'Celebrations Classic Collection passou a aceitar o número físico original como alias do número interno da base; Zekrom pode ser encontrado por 114/114 mesmo sendo CC021 no TCGdex.',
      'A busca reconhece 25 anos, Celebrations, Celebrações e Coleção Clássica como a mesma família de coleção.',
      'A coleção de 30 anos recebeu o mesmo tratamento: 30 anos, 30th Celebration e Classic Collection resolvem os sets 30th e 30th-c.',
      'As 30 cartas da 30th Classic Collection usam seus números físicos originais na pesquisa e no mercado, mesmo quando a base usa a sequência interna 001–030.',
      'Nome + número sem coleção agora também consulta automaticamente as Classic Collections comemorativas.',
      'A fonte legada deixou de exigir igualdade literal entre 114 e 114_A, evitando perder reprints com sufixo interno.',
      'Master Sets comemorativos 25/30 anos mantêm exatamente uma entrada física por carta, sem descartar cartas por causa do selo técnico de aniversário.'
    ]},
    {version:'V14.46',title:'Preços por variante correta e Master Set sem duplicações artificiais',items:[
      'MYP agora separa rigidamente idioma, condição e acabamento antes de calcular mínimo, médio e máximo; anúncios de outra qualidade ou versão não entram como fallback.',
      'A leitura de idioma da MYP também reconhece as bandeiras pela classe CSS, evitando misturar Português, Inglês e Japonês quando o atributo title não existe.',
      'Master Sets ignoram tratamentos promocionais avulsos, Jumbo, Gold, Metal, Cosmos e outros acabamentos que não pertencem ao conjunto principal.',
      'Na coleção 151, o gerador validado em produção ficou com 360 entradas; Mew #205, Substituição #206 e Energia Psíquica #207 aparecem uma vez cada.',
      'Os botões de adicionar página ficam acima das setas de navegação nos dois lados do fichário.',
      'Liga Pokémon e MYP continuam sendo consultadas separadamente, preservando links e cotações por fonte.'
    ]},
    {version:'V14.0',title:'Fichários múltiplos, Master Sets e scanner novo',items:[
      'Adição de cartas ficou imediata; a MYP atualiza preços em segundo plano.',
      'Cartas japonesas sem imagem recebem fallback seguro quando existe correspondência confiável.',
      'Scanner foi refeito com múltiplas regiões de OCR e confirmação por candidatos.',
      'Agora existem fichários ilimitados, seletor, renomear, excluir e visão Geral.',
      'Ordenação por ordem física, nome, tipo, raridade e número; arrastar só funciona na ordem física.',
      'Novo fichário pode ser vazio ou um Master Set gerado de uma coleção do TCGdex.',
      'Master Sets usam variantes reais da coleção, incluindo Normal, Holo, Reverse e variantes especiais quando disponíveis.'
    ]},
    {version:'V13.9',title:'Preço MYP respeita o idioma da carta',items:[
      'Ofertas da MYP agora são filtradas também pelo idioma antes de calcular mínimo, médio e máximo.',
      'Carta PT-BR ignora anúncios em Chinês, Inglês, Japonês e outros idiomas.',
      'Validado na Mew V 251/264: o anúncio chinês de R$ 449,90 deixou de entrar na cotação PT-BR.'
    ]},
    {version:'V13.8',title:'Busca ao vivo e tolerante a erros',items:[
      'As cartas aparecem automaticamente enquanto você digita, sem precisar clicar em Buscar.',
      'A busca espera uma pequena pausa na digitação para evitar requisições desnecessárias.',
      'Erros de digitação são tratados por aproximação: por exemplo, “umbreom ex” encontra e prioriza “Umbreon ex”.',
      'Buscas antigas são ignoradas quando você continua digitando, evitando resultados atrasados sobrescrevendo a busca atual.'
    ]},
    {version:'V13.7',title:'MYP como única fonte automática',items:[
      'O fichário usa um único seletor para mínimo, médio ou máximo, aplicado às cartas e à soma total.',
      'Liga Pokémon foi removida do quadro automático e não é mais consultada ao abrir ou atualizar cartas.',
      'O botão/link Liga Pokémon continua disponível para consulta manual.',
      'Atualizar preços agora consulta somente MYP Cards, reduzindo o tempo da atualização.'
    ]},
    {version:'V13.6',title:'Escolha do valor exibido e somado',items:[
      'Resumo ganhou seletores independentes para valor nas cartas e valor usado na soma: mínimo, médio ou máximo.',
      'As duas escolhas ficam salvas na conta.',
      'Ausência de oferta MYP para a condição escolhida é informada como sem oferta, sem apagar o preço anterior.'
    ]},
    {version:'V13.5',title:'Cotação por condição real',items:[
      'MYP calcula mínimo, médio e máximo somente entre ofertas da condição escolhida.',
      'Acabamento vazio na MYP conta como acabamento padrão da impressão; acabamentos explicitamente diferentes são excluídos.',
      'O painel mostra claramente a condição considerada e a quantidade de ofertas usadas.',
      'A lógica da Liga também permanece condicionada por estado/acabamento quando a fonte responde; o bloqueio de acesso da Liga é tratado separadamente.'
    ]},
    {version:'V13.4.1',title:'Atualização real pelo botão',items:[
      'O botão Atualizar preços consulta e salva MYP primeiro, sem esperar a Liga.',
      'A Liga passa a ser complementar: falha nela não impede nem apaga a cotação MYP.',
      'O teste de preço agora pode ser feito com o banco zerado, sem preenchimento manual.'
    ]},
    {version:'V13.4',title:'Preços completos e condição no scan',items:[
      'MYP agora usa o menor preço e o preço médio publicados pela própria página e calcula o maior anúncio regular da carta.',
      'Cartas novas consultam e salvam o preço da MYP antes de entrar no fichário; a Liga não bloqueia mais esse cadastro.',
      'Ao adicionar por foto/scan, acabamento e condição precisam ser confirmados antes de salvar.',
      'Condição escolhida é usada na consulta de preço e salva junto da carta.'
    ]},
    {version:'V13.3',title:'Preço automático em cartas novas',items:[
      'Cartas novas sem link MYP agora pesquisam automaticamente a própria MYP pelo nome.',
      'O sistema coleta as impressões candidatas, confere número e coleção e escolhe a página correta antes de ler as ofertas.',
      'Nome da coleção é usado para desempatar cartas com o mesmo número em produtos diferentes.',
      'Preço e link MYP são salvos já no cadastro da carta quando existe oferta compatível.'
    ]},
    {version:'V13.2',title:'Busca de cartas progressiva',items:[
      'Corrigido o idioma português do TCGdex: a API usa pt, enquanto o fichário internamente continua usando pt-br.',
      'Nome, número e coleção agora refinam a busca em vez de exigir correspondência exata.',
      'Lugia-V também tenta Lugia V e Lugia, mostrando alternativas próximas.',
      'A busca do catálogo não exibe mais aviso de token da MYP; MYP fica responsável pelo preço após a escolha.'
    ]},
    {version:'V13.1',title:'Leitura real e gratuita da MYP',items:[
      'MYP Cards agora é lida pela própria página pública em Chromium no backend, sem Apify e sem depender do navegador do usuário.',
      'Acabamento e condição são filtrados diretamente nas ofertas reais dos vendedores.',
      'Quando existe apenas uma oferta, mínimo é exibido e médio/máximo permanecem vazios; o valor principal da carta usa essa oferta como referência.',
      'Falhas continuam preservando qualquer cotação anterior salva.'
    ]},
    {version:'V12.9',title:'Preços reais e fichário maior',items:[
      'Corrigido o erro que transformava um único preço mínimo em mínimo, médio e máximo iguais.',
      'MYP e Liga agora continuam para o fallback quando a primeira fonte retorna cotação parcial, em vez de encerrar a busca cedo demais.',
      'A média da Liga continua sendo a referência; se a Liga não tiver média válida, a média da MYP vira fallback. Cotação parcial não é tratada como média.',
      'O fichário desktop e a tela cheia passam a ocupar muito mais da área disponível e os valores sobre as cartas ficam maiores.'
    ]},
    {version:'V12.8',title:'MYP sempre visível e cotações salvas',items:[
      'O link MYP Cards não desaparece mais: ele fica sempre visível e é atualizado para a página exata assim que a carta é resolvida.',
      'Quando a página exata da MYP é encontrada, o link é salvo no banco para as próximas consultas.',
      'Corrigido o carregamento do preço salvo nos detalhes, usando MYP como fallback visual quando a Liga ainda não tem cotação.'
    ]},
    {version:'V12.7',title:'Leitura de preços atrás do Cloudflare',items:[
      'MYP Cards e Liga agora usam Jina Reader como fallback quando o acesso direto do servidor é bloqueado pelo Cloudflare.',
      'Se o conector Apify falhar ou não retornar cotação, a consulta continua automaticamente no fallback em vez de encerrar com preço zero.',
      'O leitor da MYP continua filtrando nome, número, acabamento e condição; o link localizado é salvo para as próximas atualizações ficarem mais rápidas.'
    ]},
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
  function hasAverage(m){return !!(m&&Number(m.avg)>0)}
  function primaryMarket(liga,myp){return hasAverage(liga)?liga:(hasAverage(myp)?myp:(hasPrice(liga)?liga:(hasPrice(myp)?myp:null)))}
  function primarySource(liga,myp){const p=primaryMarket(liga,myp);return p===liga?'Liga Pokémon':(p===myp?'MYP Cards':'Sem preço BR')}
  function finishLabel(v){return FINISHES.find(([value])=>value===v)?.[1]||v||'Normal / não foil'}
  function conditionLabel(v){
    const c=String(v||'Nova').trim().toUpperCase();
    return ({NOVA:'Nova / NM',NM:'Near Mint (NM)',SP:'Pouco jogada (SP)',MP:'Moderadamente jogada (MP)',HP:'Muito jogada (HP)',DM:'Danificada (DM)',D:'Danificada (DM)'})[c]||v||'Nova / NM';
  }
  function normalizeFinish(v){const n=norm(v);if(!n)return'Normal';if(n.includes('master'))return'Masterball Foil';if(n.includes('poke')&&n.includes('ball'))return'Pokeball Foil';if(n.includes('reverse'))return'Reverse Foil';if(n.includes('full art'))return'Full-Art';if(n.includes('promo'))return'Promo';if(n==='holo'||n.includes('holograf')||n==='foil')return'Foil';if(n.includes('especial'))return'Especial';return'Normal'}
  function normalizeCondition(v){const s=String(v||'Nova').trim().toUpperCase();return['NM','SP','MP','HP','DM'].includes(s)?s:(s==='NOVA'?'Nova':'Nova')}
  function statusToInternal(v){const n=norm(v);if(n==='quero'||n==='wishlist')return'wanted';if(n==='pedido'||n==='encomendado')return'ordered';if(n==='nao tenho'||n==='faltando'||n==='missing')return'missing';return'owned'}
  function internalToStatus(v){return({owned:'Tenho',wanted:'Quero',ordered:'Pedido',missing:'Não tenho'})[v]||'Tenho'}
  function langCode(v){const n=norm(v);if(n.startsWith('jap')||n==='ja')return'ja';if(n.startsWith('ing')||n==='en')return'en';return'pt-br'}
  function langName(code){return code==='ja'?'Japonês':code==='en'?'Inglês':'Português'}

  async function resolveFullNumber(card){
    const raw=String(card?.number||'').trim().replace(/\s/g,'');
    if(/[A-Za-z]{0,8}\d+[A-Za-z]*\/[A-Za-z]{0,8}\d+[A-Za-z]*/i.test(raw))return raw;
    if(!raw)return'';
    if(!/^\d+$/.test(raw))return raw;
    const printed=String(card?.printedTotal||card?.printed_total||'').trim();
    if(/^\d+$/.test(printed))return `${Number(raw)}/${Number(printed)}`;
    const apiId=String(card?.apiId||card?.api_id||'').trim();
    if(!apiId)return raw;
    try{
      const rr=await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(apiId)}`,{cache:'force-cache'});
      if(rr.ok){
        const d=await rr.json(),local=String(d?.localId||raw).trim(),total=Number(d?.set?.cardCount?.official||0);
        if(/^\d+$/.test(local)&&total>0)return `${Number(local)}/${total}`;
      }
    }catch{}
    return raw;
  }

  function ligaSearchUrl(card,fullNumber){const name=String(card?.name||'').trim();const number=fullNumber||String(card?.number||'').trim();return 'https://www.ligapokemon.com.br/?view=cards/search&card='+encodeURIComponent(number?`${name} (${number})`:name)}
  function isMypUrl(v){try{return /(^|\.)mypcards\.com$/i.test(new URL(String(v||'')).hostname)}catch{return false}}

  async function querySource(endpoint,source,card,finish,condition){
    const full=await resolveFullNumber(card);
    const p=new URLSearchParams({name:String(card?.market_name_pt||card?.namePt||card?.name||''),number:full,finish:finish||'Normal',condition:condition||'Nova'});
    // Nome da coleção é necessário para desempatar impressões com o mesmo número
    // na MYP (ex.: Lugia V 138/195 existe em SIT e PPS).
    const setName=String(card?.setName||card?.set_name||card?.market_edition_pt||'').trim();
    const setId=String(card?.setId||card?.set_id||'').trim();
    if(setName)p.set('set',setName);
    if(setId)p.set('setId',setId);
    const apiId=String(card?.apiId||card?.api_id||'').trim();if(apiId)p.set('apiId',apiId);
    const set=setName||setId;
    const lang=String(card?.languageCode||card?.language_code||'').trim();if(lang)p.set('lang',lang);
    let known='';
    if(source==='myp'){
      known=[card?.myp_price_link,card?.price_br_link,card?.price_link].find(isMypUrl)||'';
      if(known)p.set('link',known);
    }
    let r,j;
    try{
      r=await fetch(`${endpoint}?${p.toString()}`,{cache:'no-store'});
      j=await r.json();
      if(source==='myp'&&known&&!j?.ok&&['wrong_product','product_not_found'].includes(j?.error)){
        p.delete('link');
        r=await fetch(`${endpoint}?${p.toString()}`,{cache:'no-store'});
        j=await r.json();
      }
    }catch(error){
      const out={source,failed:true,error:'network_error',message:error?.message||'Falha de rede',provider:''};
      console.warn('[Preços]',source,card?.name,card?.number,out);
      return out;
    }
    if(!j?.ok){
      const out={source:j?.source||source,failed:true,error:j?.error||'unknown',message:j?.message||'',needsApifyToken:!!j?.needsApifyToken,needsMypToken:!!j?.needsToken,provider:j?.provider||'',connector:j?.connector||'',httpStatus:r?.status||0};
      console.warn('[Preços]',source,card?.name,card?.number,out);
      return out;
    }
    const out={source:j.source||source,failed:false,provider:j.provider||'',min:Number(j.min||0),avg:Number(j.avg||0),max:Number(j.max||0),link:j.link||'',checkedAt:j.checkedAt||new Date().toISOString(),samples:j.samples??null,availableQuantity:j.availableQuantity??null,exactVariant:j.exactVariant!==false,complete:j.complete===true||(Number(j.min)>0&&Number(j.avg)>0&&Number(j.max)>0),namePt:j.name||card?.name||'',editionPt:j.edition||set,number:j.number||full,finish:finish||'Normal',condition:condition||'Nova'};
    if(!hasPrice(out)){out.failed=true;out.error='no_price_data';out.message='A fonte respondeu, mas não retornou preço.'}
    console.info('[Preços]',source,card?.name,card?.number,out);
    return out;
  }

  async function queryOfficialMyp(card){
    const full=await resolveFullNumber(card);
    const p=new URLSearchParams({
      name:String(card?.market_name_pt||card?.namePt||card?.name||''),
      number:full
    });
    const set=String(card?.setId||card?.set_id||card?.setName||card?.set_name||card?.market_edition_pt||'').trim();
    if(set)p.set('set',set);
    try{
      const r=await fetch('/api/mypcards?'+p.toString(),{cache:'no-store'});
      const j=await r.json();
      if(!j?.ok){
        const out={source:'MYP Cards',failed:true,error:j?.needsToken?'myp_token_required':(j?.error||'official_myp_failed'),message:j?.message||'',needsMypToken:!!j?.needsToken,provider:'MYP API oficial'};
        console.warn('[Preços] MYP oficial',card?.name,card?.number,out);
        return out;
      }
      const candidates=Array.isArray(j.cards)?j.cards:[];
      const best=candidates.find(x=>Number(x.avgPrice||x.minPrice||x.maxPrice)>0)||candidates[0];
      if(!best)return{source:'MYP Cards',failed:true,error:'not_found',message:'API oficial MYP não encontrou a carta.',provider:'MYP API oficial'};
      const out={
        source:'MYP Cards',failed:false,provider:'MYP API oficial',
        min:Number(best.minPrice||0),avg:Number(best.avgPrice||0),max:Number(best.maxPrice||0),
        link:best.link||'',availableQuantity:best.availableQuantity??null,
        checkedAt:new Date().toISOString(),samples:null,exactVariant:true,complete:!!(Number(best.minPrice)>0&&Number(best.avgPrice)>0&&Number(best.maxPrice)>0),
        namePt:best.namePt||card?.name||'',editionPt:best.editionPt||set,number:best.number||full
      };
      if(!hasPrice(out)){out.failed=true;out.error='no_price_data';out.message='API oficial MYP respondeu sem preço.'}
      console.info('[Preços] MYP oficial',card?.name,card?.number,out);
      return out;
    }catch(error){
      const out={source:'MYP Cards',failed:true,error:'network_error',message:error?.message||'Falha de rede',provider:'MYP API oficial'};
      console.warn('[Preços] MYP oficial',card?.name,card?.number,out);
      return out;
    }
  }

  async function queryBothMarkets(card,finish='Normal',condition='Nova'){
    const [myp,liga]=await Promise.all([
      querySource('/api/mypcards-public','myp',card,finish,condition)
        .catch(error=>({source:'MYP Cards',failed:true,error:'exception',message:error?.message||''})),
      querySource('/api/liga-public','liga',card,finish,condition)
        .catch(error=>({source:'Liga Pokémon',failed:true,error:'exception',message:error?.message||''}))
    ]);
    const primary=primaryMarket(liga,myp);
    const result={
      source:primarySource(liga,myp),
      min:Number(primary?.min||0),avg:Number(primary?.avg||0),max:Number(primary?.max||0),
      link:primary?.link||'',checkedAt:primary?.checkedAt||new Date().toISOString(),
      liga,myp,finish,condition
    };
    console.groupCollapsed?.(`[Preços] ${card?.name||'Carta'} ${card?.number||''}`);
    console.log?.('Liga:',liga);console.log?.('MYP:',myp);console.log?.('Resultado:',result);
    console.groupEnd?.();
    return result;
  }
  window.queryBothMarketsV122=queryBothMarkets;

  function savedDual(card){
    if(!card)return {source:'Sem preço BR',min:0,avg:0,max:0,link:'',liga:null,myp:null};
    const liga={
      source:'Liga Pokémon',
      min:+card.liga_price_min||0,avg:+card.liga_price_avg||0,max:+card.liga_price_max||0,
      link:card.liga_price_link||'',checkedAt:card.liga_price_checked_at||null
    };
    const myp={
      source:'MYP Cards',
      min:+card.myp_price_min||0,avg:+card.myp_price_avg||0,max:+card.myp_price_max||0,
      link:card.myp_price_link||'',checkedAt:card.myp_price_checked_at||null
    };
    const primary=primaryMarket(liga,myp);
    return {
      source:primarySource(liga,myp),
      min:+primary?.min||0,avg:+primary?.avg||+primary?.min||+primary?.max||0,max:+primary?.max||0,
      link:primary?.link||'',liga,myp,
      finish:card.finish||'Normal',condition:card.condition||'Nova'
    };
  }

  function marketPatch(card,dual){
    const oldLiga={min:+card?.liga_price_min||0,avg:+card?.liga_price_avg||0,max:+card?.liga_price_max||0,link:card?.liga_price_link||'',checkedAt:card?.liga_price_checked_at||null};
    const oldMyp={min:+card?.myp_price_min||0,avg:+card?.myp_price_avg||0,max:+card?.myp_price_max||0,link:card?.myp_price_link||'',checkedAt:card?.myp_price_checked_at||null};
    const liga=hasPrice(dual?.liga)?dual.liga:oldLiga;
    const myp=hasPrice(dual?.myp)?dual.myp:oldMyp;
    const primary=primaryMarket(liga,myp);
    const oldPrimary={
      min:+card?.price_min||0,avg:+card?.price_avg||0,max:+card?.price_max||0,
      source:card?.price_source||card?.price_br_source||'Sem preço BR',
      link:card?.price_br_link||card?.price_link||''
    };
    const hasPrimary=hasPrice(primary);
    return {
      liga_price_min:+liga.min||0,liga_price_avg:+liga.avg||0,liga_price_max:+liga.max||0,
      liga_price_link:liga.link||oldLiga.link||null,liga_price_checked_at:liga.checkedAt||oldLiga.checkedAt||null,
      myp_price_min:+myp.min||0,myp_price_avg:+myp.avg||0,myp_price_max:+myp.max||0,
      myp_price_link:myp.link||oldMyp.link||null,myp_price_checked_at:myp.checkedAt||oldMyp.checkedAt||null,
      price_min:hasPrimary?(+primary.min||0):oldPrimary.min,
      price_avg:hasPrimary?(+primary.avg||+primary.min||+primary.max||0):oldPrimary.avg,
      price_max:hasPrimary?(+primary.max||0):oldPrimary.max,
      currency:'BRL',
      price_source:hasPrimary?primarySource(liga,myp):oldPrimary.source,
      price_link:hasPrimary?(primary.link||oldPrimary.link||''):(oldPrimary.link||''),
      price_br_source:hasPrimary?primarySource(liga,myp):(card?.price_br_source||null),
      price_br_link:hasPrimary?(primary.link||card?.price_br_link||null):(card?.price_br_link||null),
      price_checked_at:hasPrimary?(primary.checkedAt||new Date().toISOString()):(card?.price_checked_at||null)
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
          const saved=collection.find(c=>c.id===editingCardId);
          if(!saved)return;
          // Abrir uma carta deve ser instantâneo. A atualização real só acontece
          // quando o usuário toca em "Atualizar preço desta carta".
          const cached=savedDual(saved);
          selectedMarket=cached;
          setPrices(cached.min,cached.avg,cached.max);
          renderDualMarket(cached,saved);
          fixLinks(saved);
          return;
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

    const photoMode=!!$v('#cardPhoto')?.files?.length||/foto|pistas|ocr|lendo|detectado/i.test($v('#ocrStatus')?.textContent||'');
    box.innerHTML='<div class="v122-finish-title"><strong>Acabamento e condição</strong><small>Esses dois campos definem a cotação correta. Em foto/scan, confirme ambos.</small></div>';

    selected.forEach(([key,c])=>{
      if(!finishSelections.has(key))finishSelections.set(key,photoMode?'':suggestFinish(c));
      if(!conditionSelections.has(key))conditionSelections.set(key,photoMode?'':'Nova');

      const row=document.createElement('div');row.className='v122-finish-row';
      const finish=finishSelections.get(key)||'',condition=conditionSelections.get(key)||'';
      row.innerHTML=`
        <span>${c.name||'Carta'} <small>${c.number||''}</small></span>
        <select data-finish-key="${encodeURIComponent(key)}" aria-label="Acabamento">
          <option value="">Selecione o acabamento…</option>
          ${FINISHES.map(([v,l])=>`<option value="${v}"${v===finish?' selected':''}>${l}</option>`).join('')}
        </select>
        <select data-condition-key="${encodeURIComponent(key)}" aria-label="Condição">
          <option value="">Selecione a condição…</option>
          ${CONDITIONS.map(([v,l])=>`<option value="${v}"${v===condition?' selected':''}>${l}</option>`).join('')}
        </select>`;
      box.appendChild(row);
    });

    box.querySelectorAll('select[data-finish-key]').forEach(s=>s.addEventListener('change',()=>finishSelections.set(decodeURIComponent(s.dataset.finishKey),s.value)));
    box.querySelectorAll('select[data-condition-key]').forEach(s=>s.addEventListener('change',()=>conditionSelections.set(decodeURIComponent(s.dataset.conditionKey),s.value)));
  }

  async function priceForNewCard(card,finish,condition){
    return queryBothMarkets(card,finish,condition);
  }

  async function backgroundPriceNewCard(saved,card,finish,condition){
    try{
      const full=await resolveFullNumber(card);
      if(full)card.number=full;
      const dual=await priceForNewCard(card,finish,condition);
      if(!hasPrice(dual?.myp)&&!hasPrice(dual?.liga))return false;
      const patch=marketPatch({...saved,...card},dual);
      if(full)patch.number=full;
      const{error}=await db.from('pokemon_cards')
        .update(patch)
        .eq('id',saved.id)
        .eq('user_id',currentUser.id);
      if(error)throw error;
      Object.assign(saved,patch);
      try{
        const local=collection.find(x=>x.id===saved.id);
        if(local)Object.assign(local,patch);
        renderSummary();
        renderBinder();
      }catch{}
      return true;
    }catch(error){
      console.warn('[Preço em segundo plano]',card?.name,error);
      return false;
    }
  }

  async function addSelectedV122(){
    let cards=[];try{cards=[...catalogSelection.entries()]}catch{}
    if(!cards.length)return;
    renderFinishControls();

    for(const [key] of cards){
      if(!finishSelections.get(key)||!conditionSelections.get(key)){
        try{toast('Escolha o acabamento e a condição antes de adicionar.')}catch{}
        $v('#v122FinishBox')?.scrollIntoView({behavior:'smooth',block:'nearest'});
        return;
      }
    }

    const b=$v('#btnAddSelected');
    if(b){b.disabled=true;b.dataset.old=b.textContent;b.textContent='Adicionando…'}

    const queued=[];
    try{
      const positions=freePositions(pendingPosition?.page||currentPage,cards.length),
        maxPage=Math.max(...positions.map(p=>p.page));
      if(maxPage>+settings.binder_pages)await updateSettings({binder_pages:maxPage},true);

      for(let i=0;i<cards.length;i++){
        const [key,raw]=cards[i],pos=positions[i],
          finish=finishSelections.get(key),
          condition=conditionSelections.get(key);
        if(b)b.textContent=`Adicionando ${i+1}/${cards.length}…`;

        const card={...raw};
        const emptyMarket={
          source:'Preço atualizando',
          min:0,avg:0,max:0,link:'',
          checkedAt:null,liga:null,myp:null,finish,condition
        };
        const payload=cardPayload(card,{
          page:pos.page,slot:pos.slot,status:'owned',quantity:1,
          condition,finish,finishConfirmed:true,notes:''
        },emptyMarket);
        payload.price_source='Preço atualizando';
        payload.price_br_source=null;
        payload.price_checked_at=null;

        const {data:existing,error:findErr}=await db.from('pokemon_cards')
          .select('id,quantity,*')
          .eq('user_id',currentUser.id)
          .eq('card_key',payload.card_key)
          .eq('condition',payload.condition)
          .eq('finish',payload.finish)
          .maybeSingle();
        if(findErr)throw findErr;

        if(existing){
          const patch={
            quantity:(+existing.quantity||0)+1,
            finish_confirmed:true
          };
          const{data:updated,error}=await db.from('pokemon_cards')
            .update(patch)
            .eq('id',existing.id)
            .eq('user_id',currentUser.id)
            .select('*').single();
          if(error)throw error;
          queued.push({saved:updated||{...existing,...patch},card,finish,condition});
        }else{
          const{data:inserted,error}=await db.from('pokemon_cards')
            .insert(payload)
            .select('*').single();
          if(error)throw error;
          queued.push({saved:inserted,card,finish,condition});
        }
      }

      catalogSelection.clear();
      finishSelections.clear();
      conditionSelections.clear();
      closeDialog('addDialog');
      currentPage=positions[0]?.page||currentPage;
      await loadCards(false);
      toast(`${cards.length} carta${cards.length===1?'':'s'} adicionada${cards.length===1?'':'s'}. Preço atualizando em segundo plano.`);

      // Não bloqueia o cadastro: preço continua depois que o modal já fechou.
      queued.forEach(item=>{
        backgroundPriceNewCard(item.saved,item.card,item.finish,item.condition)
          .then(ok=>{if(ok)console.info('[Preço em segundo plano] atualizado:',item.card?.name)})
          .catch(()=>{});
      });
    }catch(e){
      console.error(e);
      toast('Não consegui adicionar todas as cartas.');
    }finally{
      if(b){b.disabled=false;b.textContent=b.dataset.old||'＋ Adicionar'}
    }
  }

  function installFinishConfirmation(){
    injectFinishOptions();
    const results=$v('#resultsList');if(results){results.addEventListener('click',()=>setTimeout(renderFinishControls,0));new MutationObserver(()=>setTimeout(renderFinishControls,0)).observe(results,{childList:true})}
    const clear=$v('#btnClearSelection');clear?.addEventListener('click',()=>{finishSelections.clear();conditionSelections.clear();setTimeout(renderFinishControls,0)});
    const add=$v('#btnAddSelected');if(add)add.onclick=addSelectedV122;
    const photo=$v('#cardPhoto');photo?.addEventListener('change',()=>{finishSelections.clear();conditionSelections.clear();setTimeout(renderFinishControls,0)});
  }

  function ensureMarketBoard(){
    const board=$v('.market-board');if(!board||$v('#v122MarketSources'))return;
    const title=board.querySelector('.market-board-title');
    if(title){
      title.querySelector('span').textContent='Mercado brasileiro';
      title.querySelector('small').textContent='Liga Pokémon + MYP Cards';
    }
    const primary=document.createElement('p');
    primary.id='v122PrimaryNote';
    primary.className='v122-primary-note';
    primary.textContent='Liga e MYP são consultadas automaticamente. A Liga é a referência principal quando possui cotação válida; MYP funciona como fallback.';
    board.appendChild(primary);
    const wrap=document.createElement('div');
    wrap.id='v122MarketSources';
    wrap.className='v122-market-sources';
    wrap.innerHTML=`
      <section data-market-source="liga"><header><strong>Liga Pokémon</strong><span>fonte automática</span></header><div><b>Mín.</b><strong data-price="min">—</strong><b>Médio</b><strong data-price="avg">—</strong><b>Máx.</b><strong data-price="max">—</strong></div></section>
      <section data-market-source="myp"><header><strong>MYP Cards</strong><span>fonte automática</span></header><div><b>Mín.</b><strong data-price="min">—</strong><b>Médio</b><strong data-price="avg">—</strong><b>Máx.</b><strong data-price="max">—</strong></div></section>`;
    board.appendChild(wrap);
  }

  function renderSource(key,m,condition){
    const box=$v(`[data-market-source="${key}"]`);if(!box)return;
    ['min','avg','max'].forEach(k=>{
      const el=box.querySelector(`[data-price="${k}"]`);
      if(el)el.textContent=Number(m?.[k]||0)?fmt(m[k]):'—';
    });
    const meta=box.querySelector('header span');
    if(meta){
      const samples=Number(m?.samples||0);
      meta.textContent=hasPrice(m)
        ? `${conditionLabel(condition)}${samples?` · ${samples} oferta${samples===1?'':'s'}`:''}`
        : `${conditionLabel(condition)} · sem dados`;
    }
    box.classList.toggle('no-data',!hasPrice(m));
  }
  function renderDualMarket(dual,card){
    ensureMarketBoard();
    const condition=dual?.condition||card?.condition||'Nova';
    const liga=dual?.liga,myp=dual?.myp;
    renderSource('liga',liga,condition);
    renderSource('myp',myp,condition);
    const primary=primaryMarket(liga,myp);
    if(hasPrice(primary)){
      try{if(typeof setPrices==='function')setPrices(primary.min||0,primary.avg||0,primary.max||0)}catch{}
    }
    const status=$v('#marketStatus');
    if(!status)return;
    const variant=`${finishLabel(card?.finish||dual?.finish)} · ${conditionLabel(condition)}`;
    if(hasPrice(primary)){
      status.textContent=`${primarySource(liga,myp)} · ${variant} · Liga e MYP verificadas`;
    }else{
      const errors=[liga?.error,myp?.error].filter(Boolean).join(' / ');
      status.textContent=`Sem cotação BR automática · ${variant}${errors?' · '+errors:''}`;
    }
  }

  function ligaLinkMatchesNumber(link,full){
    if(!link||!full)return false;
    try{return decodeURIComponent(String(link)).replace(/\+/g,' ').includes(full)}
    catch{return String(link).includes(full)}
  }

  async function fixLinks(card){
    if(!card)return;
    const full=await resolveFullNumber(card);

    // Persist the canonical complete collector number so future market lookups
    // do not fall back to incomplete searches such as "146".
    if(full&&full!==String(card.number||'')&&full.includes('/')){
      card.number=full;
      try{
        const local=collection.find(x=>x.id===card.id);if(local)local.number=full;
        if(card.id&&typeof db!=='undefined'&&currentUser){
          db.from('pokemon_cards').update({number:full}).eq('id',card.id).eq('user_id',currentUser.id).then(()=>{}).catch(()=>{});
        }
      }catch{}
    }

    const liga=$v('#ligaSearchLink');
    if(liga){
      const verified=ligaLinkMatchesNumber(card.liga_price_link,full)?card.liga_price_link:'';
      liga.href=verified||ligaSearchUrl(card,full);
      liga.classList.remove('hidden');
    }

    const mypEl=$v('#mypcardsLink');
    if(!mypEl)return;
    let u=[card.myp_price_link,card.price_br_link,card.price_link].find(isMypUrl)||'https://mypcards.com/pokemon';
    mypEl.href=u;
    mypEl.classList.remove('hidden');

    try{
      const resolved=await querySource('/api/mypcards-public','myp',card,normalizeFinish(card.finish||'Normal'),card.condition||'Nova');
      if(resolved?.link&&isMypUrl(resolved.link)){
        u=resolved.link;
        mypEl.href=u;
        card.myp_price_link=u;
        card.price_last_error=null;
        if(card.id&&typeof db!=='undefined'&&currentUser){
          db.from('pokemon_cards')
            .update({myp_price_link:u,price_last_error:null})
            .eq('id',card.id).eq('user_id',currentUser.id)
            .then(()=>{}).catch(()=>{});
        }
      }
    }catch{}
  }

  function installExistingCardMarketView(){
    ensureMarketBoard();
    const dialog=$v('#cardDialog');if(!dialog)return;
    new MutationObserver(()=>{if(!dialog.open)return;setTimeout(async()=>{
      let saved=null;
      try{saved=editingCardId?collection.find(c=>c.id===editingCardId):null}catch{}
      if(saved){
        const dual=savedDual(saved);
        renderDualMarket(dual,saved);
        await fixLinks(saved);
        renderDualMarket(savedDual(saved),saved);
      }
    },30)}).observe(dialog,{attributes:true,attributeFilter:['open']});
  }

  async function persistDual(card,dual){const patch=marketPatch(card,dual);const{error}=await db.from('pokemon_cards').update(patch).eq('id',card.id).eq('user_id',currentUser.id);if(error)throw error;Object.assign(card,patch);return true}
  async function updateAllPrices(){
    if(bulkBusy)return;
    let cards=[];try{cards=[...collection]}catch{}
    if(!cards.length){toast('Seu fichário ainda não tem cartas.');return}

    bulkBusy=true;
    const b=$v('#v12UpdatePrices'),status=$v('#v12PriceProgress');
    if(b)b.disabled=true;

    let updated=0,failed=0,unavailable=0;
    const details=[];

    try{
      for(let i=0;i<cards.length;i++){
        if(i>0)await sleep(700);
        const card=cards[i];
        const finish=normalizeFinish(card.finish);
        const condition=card.condition||'Nova';

        if(b)b.textContent=`MYP ${i+1}/${cards.length}…`;
        if(status)status.textContent=`${card.name} · buscando MYP…`;

        try{
          const myp=await querySource('/api/mypcards-public','myp',card,finish,condition);
          if(hasPrice(myp)){
            const partial={
              source:'MYP Cards',
              min:Number(myp.min||0),
              avg:Number(myp.avg||0),
              max:Number(myp.max||0),
              link:myp.link||'',
              checkedAt:myp.checkedAt||new Date().toISOString(),
              liga:null,
              myp,
              finish,
              condition
            };
            await persistDual(card,partial);
            updated++;
          }else if(myp?.error==='variant_not_found'){
            unavailable++;
            details.push(`${card.name}: sem oferta para ${conditionLabel(condition)} / ${finishLabel(finish)}`);
          }else{
            failed++;
            details.push(`${card.name}: ${myp?.error||'sem preço'}`);
          }
        }catch(e){
          failed++;
          details.push(`${card.name}: ${e?.message||'erro inesperado'}`);
          console.error('[Preços] MYP',card.name,e);
        }
      }

      await loadCards(false);
      try{renderAll()}catch{}
      try{renderSummary()}catch{}

      if(status){
        const detail=details.length?(' · '+details.slice(0,2).join(' | ')):'';
        status.textContent=`Concluído: MYP ${updated}/${cards.length} · ${unavailable} sem oferta na condição · ${failed} falha(s)${detail}`;
        status.title=details.join('\n');
      }
      toast(updated
        ?`MYP atualizada automaticamente em ${updated}/${cards.length} carta(s).`
        :`A MYP não retornou preço para nenhuma carta.`);
    }finally{
      bulkBusy=false;
      if(b){b.disabled=false;b.textContent='↻ Atualizar preços · MYP'}
    }
  }
  function rewirePriceButton(){const old=$v('#v12UpdatePrices');if(!old||old.dataset.v122==='1')return;const b=old.cloneNode(true);b.dataset.v122='1';b.textContent='↻ Atualizar preços visíveis';old.replaceWith(b);b.addEventListener('click',()=>window.PB14?.updateVisiblePrices?window.PB14.updateVisiblePrices():updateAllPrices())}

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

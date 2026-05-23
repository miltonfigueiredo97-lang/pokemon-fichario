// =============================================================
// POKÉMON BINDER BR - CONFIGURAÇÃO PRINCIPAL
// 1) Depois que você implantar o Google Apps Script como Web App,
//    cole a URL abaixo no lugar de COLE_AQUI_A_URL_DO_APPS_SCRIPT.
// =============================================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbys5J81vcGxNQodij2OsOZsx_k_C1gbWaB1y4ieHdpHfFLN0NLlxAErXQxZg6cXVzBW0Q/exec;

const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const POKEMON_TCG_BASE = "https://api.pokemontcg.io/v2/cards";
const LANGUAGE_LABEL = { "pt-br": "Português", ja: "Japonês", en: "Inglês" };
const PAGE_SIZE = 9;

let collection = [];
let filteredCollection = [];
let currentPage = 1;
let selectedCard = null;

const $ = (id) => document.getElementById(id);
const money = (value, currency = "BRL") => {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n);
  } catch {
    return `R$ ${n.toFixed(2).replace(".", ",")}`;
  }
};

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}

function safeText(value) {
  return String(value || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

function normalizeNumber(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^0+(?=\d)/, "");
}

function buildLigaSearchUrl(card) {
  const terms = [card.name, card.localId || card.number, card.setName || card.set, "pokemon"]
    .filter(Boolean)
    .join(" ");
  return `https://www.ligapokemon.com.br/?view=cards/search&card=${encodeURIComponent(terms)}`;
}

function jsonpRequest(params) {
  return new Promise((resolve, reject) => {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("COLE_AQUI")) {
      reject(new Error("URL do Apps Script não configurada."));
      return;
    }

    const callbackName = `pokemonBinderCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const query = new URLSearchParams({ ...params, callback: callbackName, cacheBust: Date.now() });
    const script = document.createElement("script");
    const separator = APPS_SCRIPT_URL.includes("?") ? "&" : "?";
    script.src = `${APPS_SCRIPT_URL}${separator}${query.toString()}`;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Tempo esgotado ao falar com o Apps Script."));
    }, 25000);

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Falha ao carregar resposta do Apps Script."));
    };

    document.head.appendChild(script);
  });
}

async function apiGetCards() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("COLE_AQUI")) {
    toast("Configure a URL do Apps Script no script.js para carregar a planilha.");
    collection = JSON.parse(localStorage.getItem("pokemonBinderLocal") || "[]");
    applyFilters();
    return;
  }

  const data = await jsonpRequest({ action: "getCards" });
  if (!data.ok) throw new Error(data.error || "Falha ao buscar dados da planilha");
  collection = Array.isArray(data.cards) ? data.cards : [];
  applyFilters();
}

async function apiSaveCard(card) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("COLE_AQUI")) {
    const local = JSON.parse(localStorage.getItem("pokemonBinderLocal") || "[]");
    local.push(card);
    localStorage.setItem("pokemonBinderLocal", JSON.stringify(local));
    collection = local;
    applyFilters();
    toast("Carta salva localmente. Depois configure o Apps Script para salvar na planilha.");
    return;
  }

  const data = await jsonpRequest({
    action: "saveCard",
    payload: JSON.stringify(card),
  });

  if (!data.ok) throw new Error(data.error || "Erro ao salvar carta");
  await apiGetCards();
}

function applyFilters() {
  const text = $("filterText").value.toLowerCase().trim();
  const lang = $("filterLanguage").value;

  filteredCollection = collection.filter((card) => {
    const haystack = [card.name, card.setName, card.number, card.language, card.rarity]
      .join(" ")
      .toLowerCase();
    const matchText = !text || haystack.includes(text);
    const matchLang = lang === "all" || card.languageCode === lang;
    return matchText && matchLang;
  });

  currentPage = Math.min(currentPage, Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE)));
  renderBinder();
  renderStats();
}

function renderStats() {
  const totals = collection.reduce((acc, card) => {
    const qty = Number(card.quantity || 1);
    acc.qty += qty;
    acc.min += Number(card.priceMin || 0) * qty;
    acc.avg += Number(card.priceAvg || 0) * qty;
    acc.max += Number(card.priceMax || 0) * qty;
    return acc;
  }, { qty: 0, min: 0, avg: 0, max: 0 });

  $("totalCards").textContent = totals.qty;
  $("totalMin").textContent = money(totals.min, "BRL");
  $("totalAvg").textContent = money(totals.avg, "BRL");
  $("totalMax").textContent = money(totals.max, "BRL");
}

function renderBinder() {
  const grid = $("binderGrid");
  grid.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  $("pageInfo").textContent = `Página ${currentPage} de ${totalPages}`;

  const start = (currentPage - 1) * PAGE_SIZE;
  const cards = filteredCollection.slice(start, start + PAGE_SIZE);

  for (let i = 0; i < PAGE_SIZE; i++) {
    const card = cards[i];
    const slot = document.createElement("article");
    slot.className = `card-slot ${card ? "" : "empty"}`;

    if (!card) {
      slot.textContent = "Espaço vazio";
    } else {
      const img = card.imageUrl ? `${card.imageUrl}/high.webp` : "";
      slot.innerHTML = `
        <span class="qty-badge">x${safeText(card.quantity || 1)}</span>
        <div class="card-img-wrap">${img ? `<img src="${img}" alt="${safeText(card.name)}" loading="lazy" onerror="this.src='${safeText(card.imageUrl)}.webp'" />` : ""}</div>
        <div class="card-title">${safeText(card.name)}</div>
        <div class="card-meta">${safeText(card.setName || "Coleção não informada")}<br>${safeText(card.number || "-")} • ${safeText(card.language || "-")}</div>
        <div class="price-pill">${money(card.priceMin, "BRL")} - ${money(card.priceMax, "BRL")}</div>
        <div class="source-line">Fonte: ${safeText(card.priceSource || "Sem preço")}</div>
      `;
    }
    grid.appendChild(slot);
  }
}

async function runOCR() {
  const file = $("cardPhoto").files[0];
  if (!file) {
    toast("Escolha ou tire uma foto da carta primeiro.");
    return;
  }

  $("ocrStatus").textContent = "Lendo imagem... isso pode demorar alguns segundos.";
  try {
    const result = await Tesseract.recognize(file, "por+eng+jpn", {
      logger: (m) => {
        if (m.status) $("ocrStatus").textContent = `OCR: ${m.status} ${m.progress ? Math.round(m.progress * 100) + "%" : ""}`;
      }
    });
    const text = result?.data?.text || "";
    $("ocrText").value = text.trim();
    suggestFieldsFromOCR(text);
    $("ocrStatus").textContent = "OCR concluído. Confira/corrija os campos antes de buscar.";
  } catch (err) {
    console.error(err);
    $("ocrStatus").textContent = "Não consegui ler a imagem. Digite nome e número manualmente.";
  }
}

function suggestFieldsFromOCR(text) {
  const lines = String(text || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  const numberMatch = text.match(/([A-Z]{0,4}\s?\d{1,3}\s?\/\s?\d{1,3}|[A-Z]{1,5}\s?\d{1,3})/i);

  if (!$("searchName").value && lines[0]) {
    const cleaned = lines[0].replace(/[^\p{L}\p{N}\s.'-]/gu, "").trim();
    $("searchName").value = cleaned;
  }
  if (!$("searchNumber").value && numberMatch) {
    $("searchNumber").value = numberMatch[1].replace(/\s+/g, "");
  }
}

async function searchCards() {
  const name = $("searchName").value.trim();
  const number = $("searchNumber").value.trim();
  const lang = $("searchLanguage").value;

  if (!name && !number) {
    toast("Digite o nome ou o número/código da carta.");
    return;
  }

  $("searchStatus").textContent = "Buscando nas bases de cartas...";
  $("resultsList").innerHTML = "";

  try {
    const languages = lang === "all" ? ["pt-br", "ja", "en"] : [lang];
    const results = [];

    for (const language of languages) {
      const tcgResults = await searchTCGdex(language, name, number);
      results.push(...tcgResults);
    }

    if (results.length < 3 && name) {
      const fallback = await searchPokemonTCG(name, number);
      results.push(...fallback);
    }

    const unique = dedupeResults(results).slice(0, 24);
    renderSearchResults(unique);
    $("searchStatus").textContent = unique.length
      ? `${unique.length} resultado(s) encontrados. Escolha a carta correta.`
      : "Não encontrei resultados. Tente digitar só o nome, ou só o número.";
  } catch (err) {
    console.error(err);
    $("searchStatus").textContent = "Erro ao buscar cartas. Veja se a internet está funcionando e tente de novo.";
  }
}

async function searchTCGdex(language, name, number) {
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (number) params.set("localId", normalizeNumber(number.split("/")[0] || number));
  params.set("pagination:itemsPerPage", "40");

  let url = `${TCGDEX_BASE}/${language}/cards?${params.toString()}`;
  let brief = await fetch(url).then(r => r.ok ? r.json() : []);

  if (!Array.isArray(brief) || brief.length === 0) {
    const loose = new URLSearchParams();
    if (name) loose.set("name", name.split(" ")[0]);
    loose.set("pagination:itemsPerPage", "40");
    url = `${TCGDEX_BASE}/${language}/cards?${loose.toString()}`;
    brief = await fetch(url).then(r => r.ok ? r.json() : []);
  }

  const limited = (Array.isArray(brief) ? brief : []).slice(0, 16);
  const detailed = await Promise.all(limited.map(async (card) => {
    try {
      const full = await fetch(`${TCGDEX_BASE}/${language}/cards/${card.id}`).then(r => r.ok ? r.json() : card);
      return mapTCGdexCard(full, language);
    } catch {
      return mapTCGdexCard(card, language);
    }
  }));

  return detailed;
}

function mapTCGdexCard(card, language) {
  return {
    source: "TCGdex",
    apiId: card.id,
    name: card.name || "Sem nome",
    languageCode: language,
    language: LANGUAGE_LABEL[language] || language,
    localId: card.localId || "",
    number: card.localId || "",
    setName: card.set?.name || card.set?.id || "",
    setId: card.set?.id || "",
    rarity: card.rarity || "",
    imageUrl: card.image || "",
    raw: card,
  };
}

async function searchPokemonTCG(name, number) {
  const clauses = [];
  if (name) clauses.push(`name:*${name.replace(/\s+/g, "*")}*`);
  if (number) clauses.push(`number:${normalizeNumber(number.split("/")[0] || number)}`);
  const q = clauses.join(" ");
  const url = `${POKEMON_TCG_BASE}?q=${encodeURIComponent(q)}&pageSize=12`;
  const data = await fetch(url).then(r => r.ok ? r.json() : { data: [] });
  return (data.data || []).map((card) => ({
    source: "Pokémon TCG API",
    apiId: card.id,
    name: card.name || "Sem nome",
    languageCode: "en",
    language: "Inglês",
    localId: card.number || "",
    number: card.number || "",
    setName: card.set?.name || "",
    setId: card.set?.id || "",
    rarity: card.rarity || "",
    imageUrl: card.images?.large || card.images?.small || "",
    priceSourceSuggested: card.cardmarket ? "Cardmarket via Pokémon TCG API" : (card.tcgplayer ? "TCGPlayer via Pokémon TCG API" : "Sem preço"),
    suggestedPrices: extractPokemonTcgPrices(card),
    raw: card,
  }));
}

function extractPokemonTcgPrices(card) {
  if (card.cardmarket?.prices) {
    const p = card.cardmarket.prices;
    return { currency: "EUR", min: p.lowPrice || 0, avg: p.averageSellPrice || p.trendPrice || 0, max: p.avg1 || p.avg7 || p.avg30 || 0 };
  }
  if (card.tcgplayer?.prices) {
    const buckets = Object.values(card.tcgplayer.prices);
    const market = buckets.find(Boolean) || {};
    return { currency: "USD", min: market.low || 0, avg: market.market || market.mid || 0, max: market.high || 0 };
  }
  return { currency: "BRL", min: 0, avg: 0, max: 0 };
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter((card) => {
    const key = `${card.source}-${card.apiId}-${card.languageCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderSearchResults(results) {
  const list = $("resultsList");
  list.innerHTML = "";
  if (!results.length) return;

  results.forEach((card) => {
    const el = document.createElement("article");
    el.className = "result-card";
    const imgSrc = card.imageUrl ? (card.imageUrl.includes("tcgdex") ? `${card.imageUrl}/high.webp` : card.imageUrl) : "";
    el.innerHTML = `
      <img src="${safeText(imgSrc)}" alt="${safeText(card.name)}" loading="lazy" />
      <div class="result-info">
        <h3>${safeText(card.name)}</h3>
        <p>
          Coleção: ${safeText(card.setName || "-")}<br>
          Número: ${safeText(card.number || "-")} • Idioma: ${safeText(card.language)}<br>
          Raridade: ${safeText(card.rarity || "-")}<br>
          Identificação: ${safeText(card.source)}
        </p>
      </div>
      <button type="button" class="primary-btn">Escolher</button>
    `;
    el.querySelector("button").addEventListener("click", () => openPriceDialog(card));
    list.appendChild(el);
  });
}

function openPriceDialog(card) {
  selectedCard = card;
  $("selectedTitle").textContent = card.name;
  const imgSrc = card.imageUrl ? (card.imageUrl.includes("tcgdex") ? `${card.imageUrl}/high.webp` : card.imageUrl) : "";
  $("selectedPreview").innerHTML = `
    <img src="${safeText(imgSrc)}" alt="${safeText(card.name)}" />
    <div>
      <h3>${safeText(card.name)}</h3>
      <p class="card-meta">${safeText(card.setName || "-")}<br>${safeText(card.number || "-")} • ${safeText(card.language)}<br>${safeText(card.rarity || "-")}</p>
    </div>
  `;

  const suggested = card.suggestedPrices || { currency: "BRL", min: 0, avg: 0, max: 0 };
  $("priceSource").value = card.priceSourceSuggested || "Liga Pokémon";
  $("priceCurrency").value = suggested.currency || "BRL";
  $("priceMin").value = suggested.min || "";
  $("priceAvg").value = suggested.avg || "";
  $("priceMax").value = suggested.max || "";
  $("priceLink").value = "";

  const ligaUrl = buildLigaSearchUrl(card);
  $("ligaSearchLink").href = ligaUrl;
  $("priceLink").placeholder = ligaUrl;

  $("priceDialog").showModal();
}

async function saveSelectedCard() {
  if (!selectedCard) return;

  const now = new Date().toISOString();
  const ligaUrl = $("ligaSearchLink").href;
  const imageUrl = selectedCard.imageUrl?.replace(/\/high\.webp$|\.webp$/g, "") || selectedCard.imageUrl || "";

  const card = {
    internalId: `card_${Date.now()}`,
    apiId: selectedCard.apiId || "",
    name: selectedCard.name || "",
    languageCode: selectedCard.languageCode || "",
    language: selectedCard.language || "",
    setName: selectedCard.setName || "",
    setId: selectedCard.setId || "",
    number: selectedCard.number || selectedCard.localId || "",
    rarity: selectedCard.rarity || "",
    imageUrl,
    quantity: Number($("cardQuantity").value || 1),
    condition: $("cardCondition").value,
    finish: $("cardFinish").value,
    priceMin: Number($("priceMin").value || 0),
    priceAvg: Number($("priceAvg").value || 0),
    priceMax: Number($("priceMax").value || 0),
    currency: $("priceCurrency").value,
    priceSource: $("priceSource").value,
    priceLink: $("priceLink").value || ligaUrl,
    priceDate: now,
    createdAt: now,
    notes: $("cardNotes").value,
    ocrText: $("ocrText").value,
    verificationStatus: "Confirmada manualmente",
  };

  try {
    await apiSaveCard(card);
    $("priceDialog").close();
    $("addDialog").close();
    toast("Carta salva no fichário!");
  } catch (err) {
    console.error(err);
    toast("Erro ao salvar. Confira a URL do Apps Script e permissões.");
  }
}

function clearSearch() {
  ["searchName", "searchNumber", "searchSet", "ocrText"].forEach(id => $(id).value = "");
  $("resultsList").innerHTML = "";
  $("searchStatus").textContent = "";
  $("ocrStatus").textContent = "OCR opcional. Se falhar, digite nome e número manualmente.";
}

function initEvents() {
  $("btnOpenAdd").addEventListener("click", () => $("addDialog").showModal());
  $("btnRunOCR").addEventListener("click", runOCR);
  $("btnSearchCards").addEventListener("click", searchCards);
  $("btnClearSearch").addEventListener("click", clearSearch);
  $("btnSaveCard").addEventListener("click", saveSelectedCard);
  $("btnRefresh").addEventListener("click", apiGetCards);
  $("filterText").addEventListener("input", applyFilters);
  $("filterLanguage").addEventListener("change", applyFilters);
  $("prevPage").addEventListener("click", () => { currentPage--; renderBinder(); });
  $("nextPage").addEventListener("click", () => { currentPage++; renderBinder(); });
}

initEvents();
apiGetCards().catch((err) => {
  console.error(err);
  toast("Não consegui carregar a planilha. Usando modo local temporário.");
  collection = JSON.parse(localStorage.getItem("pokemonBinderLocal") || "[]");
  applyFilters();
});

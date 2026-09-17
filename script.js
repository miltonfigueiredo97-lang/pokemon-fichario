// =============================================================
// POKÉMON BINDER BR — PROFESSIONAL BINDER
// Supabase + TCGdex + MYP Cards market + Friends + PWA
// =============================================================

const SUPABASE_URL = "https://ryylegveltrypqclimqo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Ved1tXBXQN1zofbJj3uPzQ_MqHxIEGw";
const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const PAGE_SIZE = 9;

const LANGUAGE_LABEL = {
  "pt-br": "Português",
  "en": "Inglês",
  "ja": "Japonês"
};

const STATUS_META = {
  missing: { label: "Não tenho", short: "Falta" },
  wanted: { label: "Quero", short: "Quero" },
  owned: { label: "Tenho", short: "Tenho" },
  ordered: { label: "Pedido", short: "Pedido" }
};

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let currentUser = null;
let currentProfile = null;
let settings = {
  binder_name: "Meu Fichário",
  binder_pages: 1,
  binder_background: "graphite",
  show_values: false
};
let collection = [];
let currentPage = 1;
let activeStatusFilter = "all";
let selectedCard = null;
let selectedStatus = "owned";
let selectedMarket = null;
let editingCardId = null;
let pendingPosition = null;
let friendships = [];
let profilesById = new Map();
let ocrLoaded = false;

function $(id) { return document.getElementById(id); }

function safeText(value) {
  return String(value ?? "").replace(/[<>&"]/g, c => ({
    "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;"
  }[c]));
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCollectorNumber(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/(?:^|[^0-9])(\d{1,4})\s*\/\s*(\d{1,4})(?:[^0-9]|$)/);
  if (match) {
    return {
      numerator: String(Number(match[1])),
      denominator: String(Number(match[2])),
      full: `${Number(match[1])}/${Number(match[2])}`
    };
  }
  const single = raw.match(/(?:^|[^0-9])(\d{1,4})(?:[^0-9]|$)/);
  return single
    ? { numerator: String(Number(single[1])), denominator: "", full: String(Number(single[1])) }
    : { numerator: "", denominator: "", full: "" };
}

function normalizeNumerator(value) {
  return parseCollectorNumber(value).numerator || String(value || "").replace(/^0+(?=\d)/, "").trim();
}

function money(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(n) ? n : 0);
}

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2500);
}

function openDialog(id) {
  const el = $(id);
  if (el && !el.open) el.showModal();
}

function closeDialog(id) {
  const el = $(id);
  if (el?.open) el.close();
}

function getCardImage(card) {
  const image = card.imageUrl || card.image_url || card.market_image_pt || card.market_image_en || "";
  if (!image) return "";
  if (image.includes("assets.tcgdex.net") && !/\.(webp|png|jpe?g)$/i.test(image)) return `${image}/high.webp`;
  return image;
}

function buildLigaUrl(card) {
  const terms = [card.name, card.number, card.setName || card.set_name].filter(Boolean).join(" ");
  return "https://www.ligapokemon.com.br/?view=cards/search&card=" + encodeURIComponent(terms);
}

function buildCardKey(card) {
  const source = card.source || card.api_source || "catalog";
  const apiId = card.apiId || card.api_id || card.marketInternalCode || card.market_internal_code || "";
  const lang = card.languageCode || card.language_code || "";
  if (apiId) return `${source}|${apiId}|${lang}`;
  return [card.name, card.setId || card.set_id, card.number, lang].map(normalizeText).join("|");
}

function setButtonBusy(button, busy, text) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = text || "Aguarde...";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabSignup").classList.toggle("active", mode === "signup");
  $("authSubmit").textContent = mode === "login" ? "Entrar" : "Criar conta";
  $("authPassword").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authMessage").textContent = "";
}

async function handleAuth(event) {
  event.preventDefault();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const btn = $("authSubmit");
  setButtonBusy(btn, true, authMode === "login" ? "Entrando..." : "Criando...");
  try {
    if (authMode === "signup") {
      const { data, error } = await db.auth.signUp({ email, password });
      if (error) throw error;
      $("authMessage").textContent = data.session ? "Conta criada." : "Conta criada. Confirme seu e-mail e depois entre.";
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    console.error(error);
    $("authMessage").textContent = error.message || "Não foi possível autenticar.";
  } finally {
    setButtonBusy(btn, false);
  }
}

async function ensureSettings() {
  const { data, error } = await db.from("pokemon_settings").select("*").eq("user_id", currentUser.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: inserted, error: insertError } = await db
      .from("pokemon_settings")
      .insert({ user_id: currentUser.id })
      .select("*")
      .single();
    if (insertError) throw insertError;
    settings = { ...settings, ...inserted };
  } else {
    settings = { ...settings, ...data };
  }
}

async function loadCurrentProfile() {
  const { data, error } = await db.from("pokemon_profiles").select("*").eq("user_id", currentUser.id).maybeSingle();
  if (error) throw error;
  currentProfile = data;
  if (currentProfile) {
    $("userHandle").textContent = `@${currentProfile.username}`;
    $("profileUsername").value = currentProfile.username || "";
    $("profileVisibility").value = currentProfile.binder_visibility || "friends";
  } else {
    $("userHandle").textContent = currentUser.email || "";
  }
}

async function saveProfile() {
  const username = $("profileUsername").value.trim();
  const binderVisibility = $("profileVisibility").value;
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) {
    toast("Use 3 a 24 caracteres no @usuário.");
    return;
  }
  const { error } = await db
    .from("pokemon_profiles")
    .update({ username, binder_visibility: binderVisibility })
    .eq("user_id", currentUser.id);
  if (error) {
    toast(String(error.message || "").toLowerCase().includes("duplicate") ? "Esse @usuário já existe." : "Não consegui salvar o perfil.");
    return;
  }
  await loadCurrentProfile();
  toast("Perfil salvo.");
}

async function updateSettings(patch, silent = false) {
  settings = { ...settings, ...patch };
  applySettingsToUI();
  const { error } = await db.from("pokemon_settings").update(patch).eq("user_id", currentUser.id);
  if (error) {
    console.error(error);
    if (!silent) toast("Não consegui salvar a configuração.");
  }
}

function applySettingsToUI() {
  const name = settings.binder_name || "Meu Fichário";
  const pages = Math.max(1, Number(settings.binder_pages || 1));
  settings.binder_pages = pages;
  $("binderTitleHeader").textContent = name;
  $("binderNameInput").value = name;
  $("binderStage").className = `binder-stage theme-${settings.binder_background || "graphite"}`;
  $("showValues").checked = Boolean(settings.show_values);
  $("totalValueBox").classList.toggle("hidden", !settings.show_values);
  document.querySelectorAll(".theme-swatch").forEach(btn => btn.classList.toggle("active", btn.dataset.theme === settings.binder_background));
  currentPage = Math.min(Math.max(1, currentPage), pages);
}

async function renderAuthState(session) {
  currentUser = session?.user || null;
  if (!currentUser) {
    $("app").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
    collection = [];
    return;
  }
  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
  try {
    await Promise.all([ensureSettings(), loadCurrentProfile()]);
    applySettingsToUI();
    await loadCards(false);
  } catch (error) {
    console.error(error);
    toast("Não consegui iniciar seu fichário.");
  }
}

async function loadCards(showMessage = true) {
  if (!currentUser) return;
  if (showMessage) toast("Atualizando fichário...");
  const { data, error } = await db
    .from("pokemon_cards")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("binder_page", { ascending: true })
    .order("binder_slot", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    console.error(error);
    toast("Não consegui carregar o fichário.");
    return;
  }
  collection = data || [];
  const maxPage = collection.reduce((m, c) => Math.max(m, Number(c.binder_page || 1)), 1);
  if (maxPage > Number(settings.binder_pages || 1)) await updateSettings({ binder_pages: maxPage }, true);
  renderAll();
  if (showMessage) toast("Fichário atualizado.");
}

function cardsOnPage(page) {
  return collection.filter(card => Number(card.binder_page || 1) === Number(page));
}

function getCardAt(page, slot) {
  return collection.find(card => Number(card.binder_page || 1) === Number(page) && Number(card.binder_slot) === Number(slot));
}

function findFirstFreePosition(preferredPage = currentPage) {
  const pages = Math.max(1, Number(settings.binder_pages || 1));
  for (let p = Math.max(1, preferredPage); p <= pages; p++) {
    for (let s = 1; s <= 9; s++) if (!getCardAt(p, s)) return { page: p, slot: s };
  }
  for (let p = 1; p < Math.max(1, preferredPage); p++) {
    for (let s = 1; s <= 9; s++) if (!getCardAt(p, s)) return { page: p, slot: s };
  }
  return { page: pages + 1, slot: 1 };
}

function renderAll() {
  applySettingsToUI();
  renderBinder();
  renderSummary();
  renderPagesGrid();
}

function renderBinder() {
  const grid = $("binderSheet");
  grid.innerHTML = "";
  const pageCards = cardsOnPage(currentPage);

  for (let slot = 1; slot <= 9; slot++) {
    const pocket = document.createElement("div");
    pocket.className = "binder-pocket";
    const card = pageCards.find(c => Number(c.binder_slot) === slot);

    if (!card) {
      const empty = document.createElement("button");
      empty.className = "pocket-empty-btn";
      empty.type = "button";
      empty.title = `Adicionar no bolso ${slot}`;
      empty.textContent = "+";
      empty.addEventListener("click", () => openAddForPosition(currentPage, slot));
      pocket.appendChild(empty);
    } else {
      pocket.appendChild(renderPocketCard(card));
    }
    grid.appendChild(pocket);
  }

  const pages = Math.max(1, Number(settings.binder_pages || 1));
  $("pageLabel").textContent = `Capa + Pág. ${currentPage} · ${currentPage}/${pages}`;
  $("prevPage").disabled = currentPage <= 1;
  $("nextPage").disabled = currentPage >= pages;
}

function renderPocketCard(card) {
  const status = card.collection_status || "owned";
  const wrap = document.createElement("button");
  wrap.type = "button";
  wrap.className = `pocket-card status-${status}`;
  if (activeStatusFilter !== "all" && status !== activeStatusFilter) wrap.classList.add("filtered-out");
  const image = getCardImage(card);
  const statusLabel = STATUS_META[status]?.short || status;
  const qty = Math.max(0, Number(card.quantity || 0));
  const value = Number(card.price_avg || 0) * Math.max(qty, 1);
  wrap.innerHTML = `
    ${image ? `<img src="${safeText(image)}" alt="${safeText(card.name)}" loading="lazy">` : `<span>${safeText(card.name)}</span>`}
    <span class="card-status-ribbon">${safeText(statusLabel)}</span>
    ${status === "owned" && qty > 1 ? `<span class="card-qty">x${qty}</span>` : ""}
    ${settings.show_values && Number(card.price_avg || 0) > 0 ? `<span class="card-value">${money(value)}</span>` : ""}`;
  wrap.addEventListener("click", () => openExistingCard(card));
  return wrap;
}

function renderSummary() {
  const total = collection.length;
  const counts = { missing: 0, wanted: 0, owned: 0, ordered: 0 };
  collection.forEach(card => counts[card.collection_status || "owned"] = (counts[card.collection_status || "owned"] || 0) + 1);
  const capacity = Math.max(1, Number(settings.binder_pages || 1)) * 9;
  const empty = Math.max(0, capacity - total);
  const completion = total ? Math.round((counts.owned / total) * 100) : 0;
  const totalValue = collection
    .filter(c => (c.collection_status || "owned") === "owned")
    .reduce((sum, c) => sum + Number(c.price_avg || 0) * Math.max(Number(c.quantity || 1), 1), 0);

  $("completionPercent").textContent = `${completion}%`;
  $("progressBar").style.width = `${completion}%`;
  $("progressText").textContent = `${counts.owned} de ${total} carta${total === 1 ? "" : "s"} marcada${counts.owned === 1 ? "" : "s"} como “Tenho”`;
  $("sumTotal").textContent = total;
  $("sumMissing").textContent = counts.missing;
  $("sumOwned").textContent = counts.owned;
  $("sumWanted").textContent = counts.wanted;
  $("sumOrdered").textContent = counts.ordered;
  $("sumEmpty").textContent = empty;
  $("filterAllCount").textContent = total;
  $("filterMissingCount").textContent = counts.missing;
  $("filterWantedCount").textContent = counts.wanted;
  $("filterOwnedCount").textContent = counts.owned;
  $("filterOrderedCount").textContent = counts.ordered;
  $("totalValue").textContent = money(totalValue);
  $("coverSlots").textContent = capacity;
  $("coverOwned").textContent = counts.owned;
  $("coverWanted").textContent = counts.wanted;
  $("binderHeaderStats").textContent = `${total} carta${total === 1 ? "" : "s"} · ${counts.owned} tenho · ${counts.wanted} quero · ${completion}% completo`;

  document.querySelectorAll("[data-status-filter]").forEach(btn => btn.classList.toggle("active", btn.dataset.statusFilter === activeStatusFilter));
}

function setStatusFilter(status) {
  activeStatusFilter = status;
  renderBinder();
  renderSummary();
}

async function addPage() {
  const next = Math.max(1, Number(settings.binder_pages || 1)) + 1;
  await updateSettings({ binder_pages: next });
  currentPage = next;
  renderAll();
  toast(`Página ${next} adicionada.`);
}

function goToPage(page) {
  currentPage = Math.min(Math.max(1, Number(page || 1)), Math.max(1, Number(settings.binder_pages || 1)));
  renderBinder();
  renderPagesGrid();
}

function renderPagesGrid() {
  const grid = $("pagesGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const pages = Math.max(1, Number(settings.binder_pages || 1));
  for (let p = 1; p <= pages; p++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-thumb" + (p === currentPage ? " active" : "");
    const cells = [];
    for (let s = 1; s <= 9; s++) {
      const card = getCardAt(p, s);
      const img = card ? getCardImage(card) : "";
      cells.push(`<span class="page-mini-pocket">${img ? `<img src="${safeText(img)}" alt="">` : ""}</span>`);
    }
    btn.innerHTML = `<strong>Página ${p}</strong><div class="page-mini-grid">${cells.join("")}</div><small>${cardsOnPage(p).length}/9 preenchidos</small>`;
    btn.addEventListener("click", () => { goToPage(p); closeDialog("pagesDialog"); });
    grid.appendChild(btn);
  }
}

function openAddForPosition(page = currentPage, slot = null) {
  const position = slot ? { page, slot } : findFirstFreePosition(page);
  pendingPosition = position;
  editingCardId = null;
  selectedCard = null;
  selectedMarket = null;
  $("searchName").value = "";
  $("searchNumber").value = "";
  $("searchSet").value = "";
  $("resultsList").innerHTML = "";
  $("searchStatus").textContent = `Nova carta será posicionada na página ${position.page}, bolso ${position.slot}.`;
  openDialog("addDialog");
}

async function searchMypCards(name, number, setHint) {
  if (!name) return { cards: [], needsToken: false };
  try {
    const params = new URLSearchParams({ name });
    if (number) params.set("number", number);
    if (setHint) params.set("set", setHint);
    const response = await fetch(`/api/mypcards?${params.toString()}`, { cache: "no-store" });
    const json = await response.json();
    if (!json.ok) return { cards: [], needsToken: Boolean(json.needsToken), message: json.message || "" };
    return { cards: (json.cards || []).map(mapMypCard), needsToken: false };
  } catch (error) {
    console.warn("MYP Cards", error);
    return { cards: [], needsToken: false, message: "Mercado BR temporariamente indisponível." };
  }
}

function mapMypCard(card) {
  return {
    source: "MYP Cards",
    apiId: `myp-${card.internalCode}`,
    marketInternalCode: card.internalCode,
    name: card.namePt || card.nameEn || "",
    namePt: card.namePt || "",
    nameEn: card.nameEn || "",
    languageCode: card.imagePt ? "pt-br" : "en",
    language: card.imagePt ? "Português" : "Inglês",
    setName: card.editionPt || card.editionEn || "",
    setId: card.editionCode || "",
    number: card.number || "",
    rarity: "",
    type: "",
    imageUrl: card.imagePt || card.imageEn || "",
    imagePt: card.imagePt || "",
    imageEn: card.imageEn || "",
    market: {
      source: "MYP Cards",
      min: Number(card.minPrice || 0),
      avg: Number(card.avgPrice || 0),
      max: Number(card.maxPrice || 0),
      link: card.link || "",
      availableQuantity: card.availableQuantity,
      internalCode: card.internalCode,
      namePt: card.namePt || "",
      editionPt: card.editionPt || "",
      imagePt: card.imagePt || "",
      imageEn: card.imageEn || ""
    },
    marketScore: Number(card.matchScore || 0)
  };
}

async function searchTCGdex(lang, name, number) {
  const attempts = [];
  const numerator = parseCollectorNumber(number).numerator || normalizeNumerator(number);
  if (name && numerator) attempts.push({ name, localId: numerator });
  if (name) attempts.push({ name });
  if (numerator) attempts.push({ localId: numerator });
  const out = [];

  for (const query of attempts) {
    const params = new URLSearchParams();
    if (query.name) params.set("name", query.name);
    if (query.localId) params.set("localId", query.localId);
    params.set("pagination:itemsPerPage", "35");
    try {
      const response = await fetch(`${TCGDEX_BASE}/${lang}/cards?${params}`);
      if (!response.ok) continue;
      const list = await response.json();
      if (!Array.isArray(list)) continue;
      const details = await Promise.all(list.slice(0, 15).map(item => fetchTCGdexCard(lang, item.id, item)));
      out.push(...details.filter(Boolean));
    } catch (error) {
      console.warn("TCGdex search", lang, error);
    }
  }
  return out;
}

async function fetchTCGdexCard(lang, id, fallback = null) {
  try {
    const response = await fetch(`${TCGDEX_BASE}/${lang}/cards/${encodeURIComponent(id)}`);
    if (!response.ok) return fallback ? mapTCGdex(fallback, lang) : null;
    return mapTCGdex(await response.json(), lang);
  } catch {
    return fallback ? mapTCGdex(fallback, lang) : null;
  }
}

function mapTCGdex(card, lang) {
  const set = card.set || {};
  return {
    source: "TCGdex",
    apiId: card.id || "",
    name: card.name || "",
    languageCode: lang,
    language: LANGUAGE_LABEL[lang] || lang,
    setName: set.name || set.id || "",
    setId: set.id || "",
    number: String(card.localId || ""),
    printedTotal: String(set.cardCount?.official || ""),
    total: String(set.cardCount?.total || ""),
    rarity: card.rarity || "",
    type: Array.isArray(card.types) ? card.types.join(", ") : (card.category || ""),
    category: card.category || "",
    imageUrl: card.image || "",
    pricing: card.pricing || null
  };
}

async function hydratePortuguese(results) {
  const ids = [...new Set(results.filter(c => c.source === "TCGdex" && c.languageCode !== "pt-br").map(c => c.apiId).filter(Boolean))].slice(0, 18);
  const hydrated = await Promise.all(ids.map(id => fetchTCGdexCard("pt-br", id)));
  return hydrated.filter(Boolean);
}

function rankCatalog(cards, query) {
  const name = normalizeText(query.name);
  const number = parseCollectorNumber(query.number);
  const setHint = normalizeText(query.setHint);
  const language = query.language;

  return [...cards].sort((a, b) => score(b) - score(a));

  function score(card) {
    let s = 0;
    const cardName = normalizeText(card.name);
    const setName = normalizeText(card.setName);
    const setId = normalizeText(card.setId);
    const cardNum = parseCollectorNumber(card.number);

    if (card.source === "MYP Cards") s += 160 + Math.min(Number(card.marketScore || 0), 800) * .2;
    if (card.languageCode === "pt-br") s += 320;
    else if (card.languageCode === "en") s += 100;
    else if (card.languageCode === "ja") s += 70;
    if (language !== "all" && card.languageCode === language) s += 250;

    if (name) {
      if (cardName === name) s += 350;
      else if (cardName.includes(name) || name.includes(cardName)) s += 170;
      else s -= 150;
    }
    if (number.numerator) {
      const cardNumerator = cardNum.numerator || normalizeNumerator(card.number);
      if (cardNumerator === number.numerator) s += 430;
      else s -= 260;
      if (number.denominator && cardNum.denominator === number.denominator) s += 240;
      if (number.denominator && card.printedTotal === number.denominator) s += 120;
    }
    if (setHint && (setName.includes(setHint) || setId.includes(setHint))) s += 250;
    if (card.market?.avg || card.market?.min) s += 80;
    if (card.imageUrl) s += 15;
    return s;
  }
}

function dedupeCatalog(cards) {
  const seen = new Set();
  return cards.filter(card => {
    const key = [card.source, card.apiId, card.languageCode, card.name, card.number, card.setId].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchCards() {
  const name = $("searchName").value.trim();
  const number = $("searchNumber").value.trim();
  const setHint = $("searchSet").value.trim();
  const language = $("searchLanguage").value;
  if (!name && !number) {
    toast("Digite o nome ou o número da carta.");
    return;
  }
  const btn = $("btnSearchCards");
  setButtonBusy(btn, true, "Buscando...");
  $("searchStatus").textContent = "Consultando catálogo e mercado brasileiro...";
  $("resultsList").innerHTML = "";

  try {
    const languages = language === "all" ? ["pt-br", "en", "ja"] : [language];
    const [myp, ...tcgGroups] = await Promise.all([
      searchMypCards(name, number, setHint),
      ...languages.map(lang => searchTCGdex(lang, name, number))
    ]);
    let tcg = tcgGroups.flat();
    if (language === "all" || language === "pt-br") tcg.push(...await hydratePortuguese(tcg));

    const query = { name, number, setHint, language };
    const results = rankCatalog(dedupeCatalog([...(myp.cards || []), ...tcg]), query).slice(0, 30);
    renderResults(results);

    if (results.length) {
      const brCount = results.filter(c => c.languageCode === "pt-br").length;
      $("searchStatus").textContent = `${results.length} resultado(s) · ${brCount} em português${myp.needsToken ? " · preço BR requer token MYP" : ""}.`;
    } else {
      $("searchStatus").textContent = myp.needsToken
        ? "A base brasileira precisa de token MYP Cards. A busca TCGdex também não encontrou esta carta."
        : "Não encontrei essa impressão. Tente nome + número.";
    }
  } catch (error) {
    console.error(error);
    $("searchStatus").textContent = "Erro ao buscar. Tente novamente.";
  } finally {
    setButtonBusy(btn, false);
  }
}

function renderResults(results) {
  const list = $("resultsList");
  list.innerHTML = "";
  results.forEach(card => {
    const el = document.createElement("article");
    el.className = "result-card";
    const image = getCardImage(card);
    const brPrice = card.market?.avg || card.market?.min || 0;
    el.innerHTML = `
      ${image ? `<img src="${safeText(image)}" alt="${safeText(card.name)}" loading="lazy">` : `<div></div>`}
      <div>
        <h3>${safeText(card.name)}</h3>
        <p>${safeText(card.setName || "Coleção não informada")}<br>${safeText(card.number || "-")} · ${safeText(card.language || "-")}${card.rarity ? `<br>${safeText(card.rarity)}${card.type ? ` · ${safeText(card.type)}` : ""}` : ""}</p>
        <div class="result-badges">
          <span class="result-badge">${safeText(card.source)}</span>
          ${card.languageCode === "pt-br" ? `<span class="result-badge br">PT-BR</span>` : ""}
          ${brPrice ? `<span class="result-badge br">${money(brPrice)} BR</span>` : ""}
        </div>
      </div>
      <button class="btn btn-primary choose-result" type="button">Escolher</button>`;
    el.querySelector(".choose-result").addEventListener("click", () => chooseCatalogCard(card));
    list.appendChild(el);
  });
}

async function enrichCatalogCard(card) {
  let enriched = { ...card };
  if (card.source === "MYP Cards" && (!card.rarity || !card.type)) {
    const candidates = await searchTCGdex(card.languageCode === "pt-br" ? "pt-br" : "en", card.nameEn || card.name, card.number);
    const ranked = rankCatalog(candidates, { name: card.nameEn || card.name, number: card.number, setHint: card.setId || card.setName, language: card.languageCode });
    const best = ranked[0];
    if (best) {
      enriched.rarity = best.rarity || enriched.rarity;
      enriched.type = best.type || enriched.type;
      enriched.apiIdTcg = best.apiId;
      if (!enriched.imageUrl) enriched.imageUrl = best.imageUrl;
    }
  }
  return enriched;
}

async function findBrazilianMarket(card) {
  if (card.market && (card.market.min || card.market.avg || card.market.max)) return card.market;
  const myp = await searchMypCards(card.namePt || card.name, card.number, card.setId || card.setName);
  if (myp.cards.length) {
    const ranked = rankCatalog(myp.cards, { name: card.namePt || card.name, number: card.number, setHint: card.setId || card.setName, language: "pt-br" });
    if (ranked[0]?.market) return ranked[0].market;
  }
  return { source: "MYP Cards", needsToken: myp.needsToken, min: 0, avg: 0, max: 0, link: "" };
}

async function chooseCatalogCard(card) {
  selectedCard = await enrichCatalogCard(card);
  editingCardId = null;
  selectedStatus = "owned";
  selectedMarket = null;
  if (!pendingPosition) pendingPosition = findFirstFreePosition(currentPage);
  fillCardDialogBase(selectedCard, {
    page: pendingPosition.page,
    slot: pendingPosition.slot,
    quantity: 1,
    condition: "Nova",
    finish: inferFinish(selectedCard),
    notes: ""
  });
  closeDialog("addDialog");
  openDialog("cardDialog");
  await refreshMarketForSelected();
}

function inferFinish(card) {
  const rarity = normalizeText(card.rarity);
  if (rarity.includes("holo")) return "Holo";
  if (rarity.includes("full art") || rarity.includes("ultra")) return "Full-Art";
  if (normalizeText(card.setName).includes("promo")) return "Promo";
  return "Normal";
}

function fillCardDialogBase(card, values) {
  $("selectedTitle").textContent = card.name || "Carta";
  const image = getCardImage(card);
  $("selectedPreview").innerHTML = `
    ${image ? `<img src="${safeText(image)}" alt="${safeText(card.name)}">` : ""}
    <div>
      <h3>${safeText(card.name || "")}</h3>
      <p>${safeText(card.setName || card.set_name || "-")}<br>${safeText(card.number || "-")} · ${safeText(card.language || "-")}<br>${safeText(card.rarity || "Raridade não informada")}${card.type ? ` · ${safeText(card.type)}` : ""}</p>
    </div>`;
  $("cardQuantity").value = values.quantity ?? 1;
  $("cardCondition").value = values.condition || "Nova";
  $("cardFinish").value = values.finish || "Normal";
  $("cardPage").value = values.page || currentPage;
  $("cardSlot").value = values.slot || 1;
  $("cardNotes").value = values.notes || "";
  $("btnDeleteSelected").classList.toggle("hidden", !editingCardId);
  setSelectedStatus(values.status || selectedStatus || "owned");
  $("ligaSearchLink").href = buildLigaUrl(card);
  $("mypcardsLink").classList.add("hidden");
  setPriceLabels(0, 0, 0);
  $("marketStatus").className = "market-status";
  $("marketStatus").textContent = "Consultando mercado brasileiro...";
}

async function refreshMarketForSelected() {
  if (!selectedCard) return;
  $("marketStatus").className = "market-status";
  $("marketStatus").textContent = "Consultando MYP Cards em BRL...";
  const market = await findBrazilianMarket(selectedCard);
  selectedMarket = market;
  setPriceLabels(market.min || 0, market.avg || 0, market.max || 0);
  if (market.link) {
    $("mypcardsLink").href = market.link;
    $("mypcardsLink").classList.remove("hidden");
  }
  if (market.min || market.avg || market.max) {
    const qtyText = Number.isFinite(Number(market.availableQuantity)) && market.availableQuantity != null ? ` · ${market.availableQuantity} un. ofertada(s)` : "";
    $("marketStatus").className = "market-status ok";
    $("marketStatus").textContent = `Mercado brasileiro encontrado no MYP Cards${qtyText}. Valores em BRL.`;
  } else if (market.needsToken) {
    $("marketStatus").className = "market-status warn";
    $("marketStatus").textContent = "A API oficial do MYP Cards exige um token neste endpoint. O link brasileiro ficou disponível, mas o preço automático precisa da chave da API.";
  } else {
    $("marketStatus").className = "market-status warn";
    $("marketStatus").textContent = "Sem cotação BR automática para esta impressão agora. Use o link do MYP Cards/Liga para conferir.";
  }
}

function setPriceLabels(min, avg, max) {
  $("priceMinLabel").textContent = min ? money(min) : "—";
  $("priceAvgLabel").textContent = avg ? money(avg) : "—";
  $("priceMaxLabel").textContent = max ? money(max) : "—";
}

function setSelectedStatus(status) {
  selectedStatus = status;
  document.querySelectorAll("[data-card-status]").forEach(btn => btn.classList.toggle("active", btn.dataset.cardStatus === status));
  if (status !== "owned") $("cardQuantity").value = 0;
  else if (Number($("cardQuantity").value || 0) < 1) $("cardQuantity").value = 1;
}

function openExistingCard(card) {
  editingCardId = card.id;
  selectedStatus = card.collection_status || "owned";
  selectedMarket = {
    source: card.price_br_source || card.price_source || "",
    min: Number(card.price_min || 0),
    avg: Number(card.price_avg || 0),
    max: Number(card.price_max || 0),
    link: card.price_br_link || card.price_link || "",
    internalCode: card.market_internal_code,
    namePt: card.market_name_pt,
    editionPt: card.market_edition_pt,
    imagePt: card.market_image_pt,
    imageEn: card.market_image_en
  };
  selectedCard = {
    source: card.api_source || "saved",
    apiId: card.api_id || "",
    name: card.name,
    languageCode: card.language_code,
    language: card.language,
    setName: card.set_name,
    setId: card.set_id,
    number: card.number,
    rarity: card.rarity,
    type: card.card_type,
    imageUrl: card.image_url,
    marketInternalCode: card.market_internal_code
  };
  pendingPosition = { page: card.binder_page || 1, slot: card.binder_slot || 1 };
  fillCardDialogBase(selectedCard, {
    page: card.binder_page,
    slot: card.binder_slot,
    quantity: card.quantity,
    condition: card.condition,
    finish: card.finish,
    notes: card.notes,
    status: selectedStatus
  });
  setPriceLabels(card.price_min, card.price_avg, card.price_max);
  if (selectedMarket.link) {
    $("mypcardsLink").href = selectedMarket.link;
    $("mypcardsLink").classList.remove("hidden");
  }
  $("marketStatus").className = Number(card.price_avg || 0) ? "market-status ok" : "market-status warn";
  $("marketStatus").textContent = Number(card.price_avg || 0)
    ? `Última cotação BR salva: ${card.price_br_source || card.price_source || "mercado brasileiro"}.`
    : "Esta carta ainda não tem cotação BR salva.";
  openDialog("cardDialog");
  refreshMarketForSelected();
}

async function saveSelectedCard() {
  if (!selectedCard || !currentUser) return;
  const button = $("btnSaveCard");
  const page = Math.max(1, Number($("cardPage").value || 1));
  const slot = Math.min(9, Math.max(1, Number($("cardSlot").value || 1)));
  const condition = $("cardCondition").value;
  const finish = $("cardFinish").value;
  const quantity = selectedStatus === "owned" ? Math.max(1, Number($("cardQuantity").value || 1)) : 0;
  const occupant = getCardAt(page, slot);
  if (occupant && occupant.id !== editingCardId) {
    toast(`O bolso ${slot} da página ${page} já está ocupado.`);
    return;
  }

  setButtonBusy(button, true, "Salvando...");
  try {
    if (page > Number(settings.binder_pages || 1)) await updateSettings({ binder_pages: page }, true);
    const market = selectedMarket || {};
    const payload = {
      user_id: currentUser.id,
      card_key: buildCardKey(selectedCard),
      api_source: selectedCard.source || "catalog",
      api_id: selectedCard.apiId || "",
      name: selectedCard.name || "",
      language_code: selectedCard.languageCode || "",
      language: selectedCard.language || "",
      set_name: selectedCard.setName || "",
      set_id: selectedCard.setId || "",
      number: selectedCard.number || "",
      rarity: selectedCard.rarity || "",
      card_type: selectedCard.type || "",
      image_url: getCardImage(selectedCard),
      quantity,
      condition,
      finish,
      collection_status: selectedStatus,
      binder_page: page,
      binder_slot: slot,
      price_min: Number(market.min || 0),
      price_avg: Number(market.avg || 0),
      price_max: Number(market.max || 0),
      currency: "BRL",
      price_source: market.min || market.avg || market.max ? "MYP Cards" : "Sem preço BR",
      price_link: market.link || buildLigaUrl(selectedCard),
      price_br_source: market.min || market.avg || market.max ? "MYP Cards" : null,
      price_br_link: market.link || null,
      market_internal_code: market.internalCode || selectedCard.marketInternalCode || null,
      market_name_pt: market.namePt || selectedCard.namePt || null,
      market_edition_pt: market.editionPt || null,
      market_image_pt: market.imagePt || selectedCard.imagePt || null,
      market_image_en: market.imageEn || selectedCard.imageEn || null,
      price_checked_at: new Date().toISOString(),
      notes: $("cardNotes").value.trim()
    };

    if (editingCardId) {
      const { error } = await db.from("pokemon_cards").update(payload).eq("id", editingCardId).eq("user_id", currentUser.id);
      if (error) throw error;
      toast("Carta atualizada.");
    } else {
      const { data: existing, error: findError } = await db
        .from("pokemon_cards")
        .select("id,quantity,binder_page,binder_slot")
        .eq("user_id", currentUser.id)
        .eq("card_key", payload.card_key)
        .eq("condition", condition)
        .eq("finish", finish)
        .maybeSingle();
      if (findError) throw findError;

      if (existing) {
        const patch = {
          ...payload,
          quantity: selectedStatus === "owned" ? Number(existing.quantity || 0) + quantity : 0,
          binder_page: existing.binder_page || page,
          binder_slot: existing.binder_slot || slot
        };
        delete patch.user_id;
        const { error } = await db.from("pokemon_cards").update(patch).eq("id", existing.id).eq("user_id", currentUser.id);
        if (error) throw error;
        toast("Carta repetida agrupada.");
      } else {
        const { error } = await db.from("pokemon_cards").insert(payload);
        if (error) throw error;
        toast("Carta adicionada ao fichário.");
      }
    }

    closeDialog("cardDialog");
    pendingPosition = null;
    editingCardId = null;
    await loadCards(false);
  } catch (error) {
    console.error(error);
    toast("Não consegui salvar a carta.");
  } finally {
    setButtonBusy(button, false);
  }
}

async function deleteSelectedCard() {
  if (!editingCardId) return;
  const card = collection.find(c => c.id === editingCardId);
  if (!card || !confirm(`Excluir ${card.name} do fichário?`)) return;
  const { error } = await db.from("pokemon_cards").delete().eq("id", editingCardId).eq("user_id", currentUser.id);
  if (error) {
    toast("Não consegui excluir a carta.");
    return;
  }
  closeDialog("cardDialog");
  editingCardId = null;
  await loadCards(false);
  toast("Carta excluída.");
}

async function ensureOCRLibrary() {
  if (window.Tesseract) return true;
  if (ocrLoaded) return Boolean(window.Tesseract);
  ocrLoaded = true;
  return new Promise(resolve => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function usePhotoHints() {
  const file = $("cardPhoto").files?.[0];
  if (!file) { toast("Tire ou escolha uma foto primeiro."); return; }
  $("ocrStatus").textContent = "Carregando leitor...";
  if (!await ensureOCRLibrary()) {
    $("ocrStatus").textContent = "Leitor indisponível. Use a busca manual.";
    return;
  }
  try {
    const result = await window.Tesseract.recognize(file, "por+eng", {
      logger: m => { if (m.progress) $("ocrStatus").textContent = `Lendo pistas... ${Math.round(m.progress * 100)}%`; }
    });
    const text = result?.data?.text || "";
    const number = text.match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
    const lines = text.split(/\n+/).map(v => v.replace(/[^\p{L}\p{N}\s.'-]/gu, " ").replace(/\s+/g, " ").trim()).filter(v => v.length >= 3);
    const plausibleName = lines.find(line => !/^(basico|basic|hp|habilidade|ability|treinador|trainer)/i.test(line) && /[a-zA-ZÀ-ÿ]/.test(line));
    if (plausibleName && !$("searchName").value) $("searchName").value = plausibleName.replace(/\bHP\s*\d+.*/i, "").trim();
    if (number && !$("searchNumber").value) $("searchNumber").value = `${number[1]}/${number[2]}`;
    $("ocrStatus").textContent = "Pistas preenchidas. Confira e toque em Buscar.";
  } catch (error) {
    console.error(error);
    $("ocrStatus").textContent = "A leitura textual falhou. O scanner visual será a próxima etapa.";
  }
}

async function saveAppearance() {
  const binderName = $("binderNameInput").value.trim() || "Meu Fichário";
  const activeTheme = document.querySelector(".theme-swatch.active")?.dataset.theme || "graphite";
  await updateSettings({ binder_name: binderName, binder_background: activeTheme });
  renderAll();
  closeDialog("appearanceDialog");
  toast("Aparência salva.");
}

function exportCSV() {
  const headers = ["Nome","Coleção","Número","Idioma","Status","Quantidade","Condição","Acabamento","Preço mínimo BR","Preço médio BR","Preço máximo BR","Fonte","Página","Bolso","Link"];
  const rows = collection.map(c => [
    c.name,c.set_name,c.number,c.language,STATUS_META[c.collection_status || "owned"]?.label || c.collection_status,
    c.quantity,c.condition,c.finish,c.price_min,c.price_avg,c.price_max,c.price_br_source || c.price_source,c.binder_page,c.binder_slot,c.price_br_link || c.price_link
  ]);
  const csv = [headers, ...rows].map(row => row.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(settings.binder_name || "pokemon-fichario").replace(/[^a-z0-9-_]+/gi,"-")}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function loadFriendships() {
  const { data, error } = await db
    .from("pokemon_friendships")
    .select("*")
    .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  friendships = data || [];
  const ids = [...new Set(friendships.flatMap(f => [f.requester_id, f.addressee_id]).filter(id => id !== currentUser.id))];
  profilesById = new Map();
  if (ids.length) {
    const { data: profiles } = await db.from("pokemon_profiles").select("user_id,username,display_name,binder_visibility").in("user_id", ids);
    (profiles || []).forEach(p => profilesById.set(p.user_id, p));
  }
  renderFriends();
}

function renderFriends() {
  const requests = $("friendRequests");
  const friends = $("friendsList");
  requests.innerHTML = ""; friends.innerHTML = "";

  const received = friendships.filter(f => f.status === "pending" && f.addressee_id === currentUser.id);
  const accepted = friendships.filter(f => f.status === "accepted");

  if (!received.length) requests.innerHTML = `<p class="muted">Nenhum pedido pendente.</p>`;
  received.forEach(f => {
    const p = profilesById.get(f.requester_id);
    requests.appendChild(socialItem(p, [
      { label: "Aceitar", action: () => updateFriendship(f.id, "accepted") },
      { label: "Recusar", action: () => removeFriendship(f.id) }
    ]));
  });

  if (!accepted.length) friends.innerHTML = `<p class="muted">Adicione amigos para ver os fichários deles.</p>`;
  accepted.forEach(f => {
    const friendId = f.requester_id === currentUser.id ? f.addressee_id : f.requester_id;
    const p = profilesById.get(friendId);
    friends.appendChild(socialItem(p, [
      { label: "Ver fichário", action: () => viewFriendBinder(p) },
      { label: "Remover", action: () => removeFriendship(f.id) }
    ]));
  });
}

function socialItem(profile, actions) {
  const el = document.createElement("div");
  el.className = "social-item";
  el.innerHTML = `<div><strong>@${safeText(profile?.username || "usuário")}</strong><small>${safeText(profile?.display_name || "")}</small></div><div class="social-actions"></div>`;
  const box = el.querySelector(".social-actions");
  actions.forEach(a => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = a.label; btn.addEventListener("click", a.action); box.appendChild(btn);
  });
  return el;
}

async function searchFriends() {
  const q = $("friendSearch").value.trim();
  const box = $("friendSearchResults");
  box.innerHTML = "";
  if (q.length < 2) { toast("Digite pelo menos 2 caracteres."); return; }
  const { data, error } = await db
    .from("pokemon_profiles")
    .select("user_id,username,display_name,binder_visibility")
    .ilike("username", `%${q.replace(/^@/, "")}%`)
    .neq("user_id", currentUser.id)
    .limit(20);
  if (error) { toast("Não consegui buscar usuários."); return; }
  if (!data?.length) { box.innerHTML = `<p class="muted">Nenhum usuário encontrado.</p>`; return; }
  data.forEach(p => {
    const existing = friendships.find(f => (f.requester_id === p.user_id || f.addressee_id === p.user_id));
    const actions = existing
      ? [{ label: existing.status === "accepted" ? "Amigo" : "Pendente", action: () => {} }]
      : [{ label: "Adicionar", action: () => sendFriendRequest(p.user_id) }];
    box.appendChild(socialItem(p, actions));
  });
}

async function sendFriendRequest(userId) {
  const { error } = await db.from("pokemon_friendships").insert({ requester_id: currentUser.id, addressee_id: userId, status: "pending" });
  if (error) { toast("Não consegui enviar o pedido."); return; }
  await loadFriendships();
  await searchFriends();
  toast("Pedido enviado.");
}

async function updateFriendship(id, status) {
  const { error } = await db.from("pokemon_friendships").update({ status }).eq("id", id);
  if (error) { toast("Não consegui atualizar o pedido."); return; }
  await loadFriendships();
  toast("Pedido aceito.");
}

async function removeFriendship(id) {
  const { error } = await db.from("pokemon_friendships").delete().eq("id", id);
  if (error) { toast("Não consegui remover."); return; }
  await loadFriendships();
}

async function viewFriendBinder(profile) {
  if (!profile) return;
  const { data, error } = await db
    .from("pokemon_cards")
    .select("*")
    .eq("user_id", profile.user_id)
    .order("binder_page")
    .order("binder_slot");
  if (error) { toast("Esse fichário não está disponível para você."); return; }
  $("friendBinderTitle").textContent = `@${profile.username}`;
  const grid = $("friendBinderGrid");
  grid.innerHTML = "";
  (data || []).forEach(card => {
    const el = document.createElement("div");
    el.className = "friend-card";
    const image = getCardImage(card);
    el.innerHTML = `${image ? `<img src="${safeText(image)}" alt="${safeText(card.name)}">` : ""}<strong>${safeText(card.name)}</strong><small>${safeText(card.set_name || "")} · ${safeText(card.number || "")}</small>`;
    grid.appendChild(el);
  });
  closeDialog("friendsDialog");
  openDialog("friendBinderDialog");
}

function bindEvents() {
  $("tabLogin").addEventListener("click", () => setAuthMode("login"));
  $("tabSignup").addEventListener("click", () => setAuthMode("signup"));
  $("authForm").addEventListener("submit", handleAuth);
  $("btnLogout").addEventListener("click", () => db.auth.signOut());

  $("btnOpenAdd").addEventListener("click", () => openAddForPosition(currentPage));
  $("btnMobileScan").addEventListener("click", () => openAddForPosition(currentPage));
  $("prevPage").addEventListener("click", () => goToPage(currentPage - 1));
  $("nextPage").addEventListener("click", () => goToPage(currentPage + 1));
  $("btnPages").addEventListener("click", () => { renderPagesGrid(); openDialog("pagesDialog"); });
  $("btnAddPage").addEventListener("click", addPage);
  $("btnAddPageModal").addEventListener("click", addPage);
  $("btnBackground").addEventListener("click", () => openDialog("appearanceDialog"));
  $("btnSummarySettings").addEventListener("click", () => openDialog("appearanceDialog"));
  $("btnSaveAppearance").addEventListener("click", saveAppearance);

  document.querySelectorAll(".theme-swatch").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".theme-swatch").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    $("binderStage").className = `binder-stage theme-${btn.dataset.theme}`;
  }));

  $("showValues").addEventListener("change", async event => {
    await updateSettings({ show_values: event.target.checked }, true);
    renderAll();
  });
  document.querySelectorAll("[data-status-filter]").forEach(btn => btn.addEventListener("click", () => setStatusFilter(btn.dataset.statusFilter)));
  $("btnExport").addEventListener("click", exportCSV);
  $("btnPrint").addEventListener("click", () => window.print());

  $("btnSearchCards").addEventListener("click", searchCards);
  $("btnClearSearch").addEventListener("click", () => {
    $("searchName").value = ""; $("searchNumber").value = ""; $("searchSet").value = ""; $("resultsList").innerHTML = ""; $("searchStatus").textContent = "";
  });
  $("btnUsePhotoHints").addEventListener("click", usePhotoHints);
  $("cardPhoto").addEventListener("change", () => { if ($("cardPhoto").files?.[0]) $("ocrStatus").textContent = "Foto pronta. Toque em “Tentar ler nome/número” ou use a busca manual."; });
  document.querySelectorAll("[data-card-status]").forEach(btn => btn.addEventListener("click", () => setSelectedStatus(btn.dataset.cardStatus)));
  $("btnSaveCard").addEventListener("click", saveSelectedCard);
  $("btnDeleteSelected").addEventListener("click", deleteSelectedCard);

  $("btnFriends").addEventListener("click", async () => { await loadFriendships(); openDialog("friendsDialog"); });
  $("btnMobileFriends").addEventListener("click", async () => { await loadFriendships(); openDialog("friendsDialog"); });
  $("btnMobileProfile").addEventListener("click", async () => { await loadFriendships(); openDialog("friendsDialog"); });
  $("btnSaveProfile").addEventListener("click", saveProfile);
  $("btnSearchFriends").addEventListener("click", searchFriends);

  $("btnMobileSummary").addEventListener("click", () => $("summaryPanel").classList.add("mobile-open"));
  $("btnCloseSummary").addEventListener("click", () => $("summaryPanel").classList.remove("mobile-open"));

  document.addEventListener("click", event => {
    const close = event.target.closest("[data-close]");
    if (close) closeDialog(close.dataset.close);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Enter" && event.target.closest("dialog") && event.target.tagName !== "TEXTAREA") {
      if (event.target.closest("#addDialog")) {
        event.preventDefault();
        searchCards();
      }
    }
  });
}

async function registerPWA() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); } catch (error) { console.warn("SW", error); }
  }
}

async function boot() {
  bindEvents();
  registerPWA();
  const { data } = await db.auth.getSession();
  await renderAuthState(data.session);
  db.auth.onAuthStateChange((_event, session) => setTimeout(() => renderAuthState(session), 0));
}

document.addEventListener("DOMContentLoaded", boot);

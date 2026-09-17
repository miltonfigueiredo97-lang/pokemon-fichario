// =============================================================
// POKÉMON BINDER BR — SUPABASE
// Dados: public.pokemon_cards / public.pokemon_settings
// =============================================================

const SUPABASE_URL = "https://ryylegveltrypqclimqo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Ved1tXBXQN1zofbJj3uPzQ_MqHxIEGw";
const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const POKEMON_TCG_BASE = "https://api.pokemontcg.io/v2/cards";
const PAGE_SIZE = 9;

const LANGUAGE_LABEL = {
  "pt-br": "Português",
  "ja": "Japonês",
  "en": "Inglês"
};

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let currentUser = null;
let authMode = "login";
let collection = [];
let filteredCollection = [];
let currentPage = 1;
let selectedCard = null;

function $(id) { return document.getElementById(id); }

function safeText(value) {
  return String(value ?? "").replace(/[<>&"]/g, c => ({"<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;"}[c]));
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

function normalizeNumber(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
}

function parseMoney(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (text.includes(",")) return Number(text.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(text) || 0;
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2300);
}

function openModal(id) {
  const modal = $(id);
  if (modal && !modal.open) modal.showModal();
}

function closeModal(id) {
  const modal = $(id);
  if (modal?.open) modal.close();
}

function getCardImage(card) {
  const image = card.imageUrl || card.image_url || "";
  if (!image) return "";
  if (image.includes("assets.tcgdex.net") && !/\.(webp|png|jpg|jpeg)$/i.test(image)) return `${image}/high.webp`;
  return image;
}

function buildLigaSearchUrl(card) {
  const terms = [card.name, card.number, card.setName || card.set_name, "pokemon"].filter(Boolean).join(" ");
  return "https://www.ligapokemon.com.br/?view=cards/search&card=" + encodeURIComponent(terms);
}

function buildCardKey(card) {
  const source = card.source || card.api_source || "manual";
  const apiId = card.apiId || card.api_id || "";
  const lang = card.languageCode || card.language_code || "";
  if (apiId) return `${source}|${apiId}|${lang}`;
  return [card.name, card.setId || card.set_id, card.number, lang].map(normalizeText).join("|");
}

// =============================================================
// AUTH
// =============================================================

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
  btn.disabled = true;
  $("authMessage").textContent = authMode === "login" ? "Entrando..." : "Criando conta...";

  try {
    if (authMode === "signup") {
      const { data, error } = await db.auth.signUp({ email, password });
      if (error) throw error;
      $("authMessage").textContent = data.session
        ? "Conta criada."
        : "Conta criada. Confirme seu e-mail e depois entre.";
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      $("authMessage").textContent = "";
    }
  } catch (err) {
    console.error(err);
    $("authMessage").textContent = err.message || "Não foi possível autenticar.";
  } finally {
    btn.disabled = false;
  }
}

async function renderAuthState(session) {
  currentUser = session?.user || null;
  if (!currentUser) {
    $("app").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
    collection = [];
    applyFilters();
    return;
  }

  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("userEmail").textContent = currentUser.email || "";
  await ensureSettings();
  await loadCards(false);
}

async function ensureSettings() {
  const { data, error } = await db.from("pokemon_settings").select("user_id").eq("user_id", currentUser.id).maybeSingle();
  if (error) {
    console.error("settings select", error);
    return;
  }
  if (!data) {
    const { error: insertError } = await db.from("pokemon_settings").insert({ user_id: currentUser.id });
    if (insertError) console.error("settings insert", insertError);
  }
}

// =============================================================
// SUPABASE — FICHÁRIO
// =============================================================

async function loadCards(showMessage = true) {
  if (!currentUser) return;
  if (showMessage) toast("Atualizando fichário...");

  const { data, error } = await db
    .from("pokemon_cards")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    toast("Não consegui carregar o fichário.");
    return;
  }

  collection = data || [];
  applyFilters();
  if (showMessage) toast("Fichário atualizado.");
}

async function saveSelectedCard() {
  if (!selectedCard || !currentUser) return;

  const quantity = Math.max(1, Number($("cardQuantity").value || 1));
  const condition = $("cardCondition").value;
  const finish = $("cardFinish").value;
  const cardKey = buildCardKey(selectedCard);
  const button = $("btnSaveCard");
  const link = buildLigaSearchUrl(selectedCard);

  button.disabled = true;

  try {
    const { data: existing, error: findError } = await db
      .from("pokemon_cards")
      .select("id, quantity")
      .eq("user_id", currentUser.id)
      .eq("card_key", cardKey)
      .eq("condition", condition)
      .eq("finish", finish)
      .maybeSingle();

    if (findError) throw findError;

    const common = {
      price_min: parseMoney($("priceMin").value),
      price_avg: parseMoney($("priceAvg").value),
      price_max: parseMoney($("priceMax").value),
      currency: "BRL",
      price_source: $("priceSource").value,
      price_link: link,
      notes: $("cardNotes").value.trim()
    };

    if (existing) {
      const { error } = await db.from("pokemon_cards").update({
        ...common,
        quantity: Number(existing.quantity || 0) + quantity
      }).eq("id", existing.id).eq("user_id", currentUser.id);
      if (error) throw error;
      toast("Cópia agrupada na carta existente.");
    } else {
      const { error } = await db.from("pokemon_cards").insert({
        user_id: currentUser.id,
        card_key: cardKey,
        api_source: selectedCard.source || "TCGdex",
        api_id: selectedCard.apiId || "",
        name: selectedCard.name || "",
        language_code: selectedCard.languageCode || "",
        language: selectedCard.language || "",
        set_name: selectedCard.setName || "",
        set_id: selectedCard.setId || "",
        number: selectedCard.number || "",
        rarity: selectedCard.rarity || "",
        card_type: selectedCard.type || "",
        image_url: selectedCard.imageUrl || "",
        quantity,
        condition,
        finish,
        ...common
      });
      if (error) throw error;
      toast("Carta adicionada.");
    }

    closeModal("priceDialog");
    closeModal("addDialog");
    await loadCards(false);
  } catch (err) {
    console.error(err);
    if (String(err.message || "").includes("duplicate")) {
      toast("Essa carta já existe. Atualize e tente novamente.");
    } else {
      toast("Erro ao salvar a carta.");
    }
  } finally {
    button.disabled = false;
  }
}

async function deleteCard(id) {
  const card = collection.find(c => c.id === id);
  if (!card) return;

  const qty = Number(card.quantity || 1);
  const msg = qty > 1
    ? `Apagar ${qty} cópias agrupadas de ${card.name}?`
    : `Apagar ${card.name}?`;
  if (!confirm(msg)) return;

  const backup = [...collection];
  collection = collection.filter(c => c.id !== id);
  applyFilters();

  const { error } = await db.from("pokemon_cards").delete().eq("id", id).eq("user_id", currentUser.id);
  if (error) {
    console.error(error);
    collection = backup;
    applyFilters();
    toast("Não consegui apagar a carta.");
    return;
  }
  toast("Carta apagada.");
}

// =============================================================
// RENDER
// =============================================================

function applyFilters() {
  const text = normalizeText($("filterText")?.value || "");
  const lang = $("filterLanguage")?.value || "all";

  filteredCollection = collection.filter(card => {
    const haystack = normalizeText([card.name, card.set_name, card.number, card.language, card.rarity].join(" "));
    return (!text || haystack.includes(text)) && (lang === "all" || card.language_code === lang);
  });

  const totalPages = Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  renderBinder();
  renderStats();
}

function renderStats() {
  const totals = collection.reduce((acc, card) => {
    const qty = Number(card.quantity || 1);
    acc.qty += qty;
    acc.min += Number(card.price_min || 0) * qty;
    acc.avg += Number(card.price_avg || 0) * qty;
    acc.max += Number(card.price_max || 0) * qty;
    return acc;
  }, { qty: 0, min: 0, avg: 0, max: 0 });

  if ($("totalCards")) $("totalCards").textContent = totals.qty;
  if ($("totalMin")) $("totalMin").textContent = money(totals.min);
  if ($("totalAvg")) $("totalAvg").textContent = money(totals.avg);
  if ($("totalMax")) $("totalMax").textContent = money(totals.max);
}

function renderBinder() {
  const grid = $("binderGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE));
  $("pageInfo").textContent = `Página ${currentPage} de ${totalPages}`;
  const cards = filteredCollection.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  for (let i = 0; i < PAGE_SIZE; i++) {
    const card = cards[i];
    const slot = document.createElement("article");
    slot.className = "card-slot" + (card ? "" : " empty");

    if (!card) {
      slot.textContent = "Espaço vazio";
    } else {
      const image = getCardImage(card);
      slot.innerHTML = `
        <button type="button" class="delete-card-btn" data-card-id="${safeText(card.id)}" title="Apagar carta">×</button>
        <span class="qty-badge">x${safeText(card.quantity || 1)}</span>
        <div class="card-img-wrap">${image ? `<img src="${safeText(image)}" alt="${safeText(card.name)}" loading="lazy">` : ""}</div>
        <div class="card-title">${safeText(card.name || "Sem nome")}</div>
        <div class="card-meta">${safeText(card.set_name || "Coleção não informada")}<br>${safeText(card.number || "-")} • ${safeText(card.language || "-")}</div>
        <div class="price-pill">${money(card.price_min)} - ${money(card.price_max)}</div>
        <div class="source-line">Fonte: ${safeText(card.price_source || "Liga Pokémon")}</div>`;
    }
    grid.appendChild(slot);
  }
}

// =============================================================
// BUSCA DE CARTAS
// =============================================================

function parseCardSearch() {
  const rawName = $("searchName").value.trim();
  const rawNumber = $("searchNumber").value.trim();
  const setHint = $("searchSet").value.trim();
  const match = rawNumber.match(/^\s*([A-Za-z]*\d{1,4})\s*\/\s*(\d{1,4})\s*$/);
  return {
    name: rawName,
    number: normalizeNumber(match ? match[1] : rawNumber),
    denominator: match ? normalizeNumber(match[2]) : "",
    setHint,
    language: $("searchLanguage").value
  };
}

async function searchCards() {
  const search = parseCardSearch();
  if (!search.name && !search.number) {
    toast("Digite o nome ou o número da carta.");
    return;
  }

  $("searchStatus").textContent = "Buscando...";
  $("resultsList").innerHTML = "";

  try {
    const languages = search.language === "all" ? ["pt-br", "en", "ja"] : [search.language];
    let results = [];

    for (const lang of languages) {
      results.push(...await searchTCGdex(lang, search));
    }

    if (results.length < 3 && search.name) {
      results.push(...await searchPokemonTCG(search));
    }

    const finalResults = rankAndFilter(dedupeResults(results), search).slice(0, 30);
    renderResults(finalResults);
    $("searchStatus").textContent = finalResults.length
      ? `${finalResults.length} resultado(s). Português aparece primeiro quando disponível.`
      : "Não encontrei essa carta. Tente nome + número.";
  } catch (err) {
    console.error(err);
    $("searchStatus").textContent = "Erro ao buscar cartas.";
  }
}

async function searchTCGdex(lang, search) {
  const attempts = [];
  if (search.name && search.number) attempts.push({ name: search.name, localId: search.number });
  if (search.name) attempts.push({ name: search.name });
  if (search.number) attempts.push({ localId: search.number });

  const out = [];
  for (const query of attempts) {
    const params = new URLSearchParams();
    if (query.name) params.set("name", query.name);
    if (query.localId) params.set("localId", query.localId);
    params.set("pagination:itemsPerPage", "40");

    const response = await fetch(`${TCGDEX_BASE}/${lang}/cards?${params.toString()}`);
    if (!response.ok) continue;
    const brief = await response.json();
    if (!Array.isArray(brief)) continue;

    const details = await Promise.all(brief.slice(0, 20).map(async item => {
      try {
        const detailResponse = await fetch(`${TCGDEX_BASE}/${lang}/cards/${encodeURIComponent(item.id)}`);
        const full = detailResponse.ok ? await detailResponse.json() : item;
        return mapTCGdex(full, lang);
      } catch {
        return mapTCGdex(item, lang);
      }
    }));
    out.push(...details);
  }
  return out;
}

function mapTCGdex(card, lang) {
  return {
    source: "TCGdex",
    apiId: card.id || "",
    name: card.name || "",
    languageCode: lang,
    language: LANGUAGE_LABEL[lang] || lang,
    setName: card.set?.name || card.set?.id || "",
    setId: card.set?.id || "",
    number: String(card.localId || ""),
    printedTotal: String(card.set?.cardCount?.official || ""),
    total: String(card.set?.cardCount?.total || ""),
    rarity: card.rarity || "",
    type: card.category || "",
    imageUrl: card.image || ""
  };
}

async function searchPokemonTCG(search) {
  const clauses = [];
  if (search.name) clauses.push(`name:*${search.name.replace(/\s+/g, "*")}*`);
  if (search.number) clauses.push(`number:${search.number}`);
  const response = await fetch(`${POKEMON_TCG_BASE}?q=${encodeURIComponent(clauses.join(" "))}&pageSize=20`);
  if (!response.ok) return [];
  const json = await response.json();
  return (json.data || []).map(card => ({
    source: "Pokémon TCG API",
    apiId: card.id || "",
    name: card.name || "",
    languageCode: "en",
    language: "Inglês",
    setName: card.set?.name || "",
    setId: card.set?.id || "",
    number: String(card.number || ""),
    printedTotal: String(card.set?.printedTotal || ""),
    total: String(card.set?.total || ""),
    rarity: card.rarity || "",
    type: card.supertype || "",
    imageUrl: card.images?.large || card.images?.small || ""
  }));
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter(card => {
    const key = [card.source, card.apiId, card.languageCode, card.name, card.number, card.setId].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankAndFilter(results, search) {
  const wantedName = normalizeText(search.name);
  const wantedNumber = normalizeNumber(search.number);
  const wantedSet = normalizeText(search.setHint);
  const wantedDenominator = normalizeNumber(search.denominator);

  let candidates = results;

  if (wantedName) {
    const nameMatches = candidates.filter(card => {
      const name = normalizeText(card.name);
      return name === wantedName || name.includes(wantedName) || wantedName.includes(name);
    });
    if (nameMatches.length) candidates = nameMatches;
  }

  if (wantedNumber) {
    const numberMatches = candidates.filter(card => normalizeNumber(card.number) === wantedNumber);
    if (numberMatches.length) candidates = numberMatches;
  }

  return candidates.sort((a, b) => score(b) - score(a));

  function score(card) {
    let s = 0;
    const name = normalizeText(card.name);
    const setName = normalizeText(card.setName);
    const setId = normalizeText(card.setId);

    if (card.languageCode === "pt-br") s += 400;
    else if (card.languageCode === "en") s += 130;
    else if (card.languageCode === "ja") s += 80;

    if (wantedName && name === wantedName) s += 240;
    else if (wantedName && (name.includes(wantedName) || wantedName.includes(name))) s += 120;

    if (wantedNumber && normalizeNumber(card.number) === wantedNumber) s += 260;

    if (wantedSet && (setName.includes(wantedSet) || setId.includes(wantedSet))) s += 170;

    // O denominador ajuda no ranking, mas NÃO bloqueia a carta. Isso evita perder
    // cartas corretas quando a pessoa digita, por exemplo, "180/151" querendo dizer coleção 151.
    if (wantedDenominator) {
      if (normalizeNumber(card.printedTotal) === wantedDenominator) s += 70;
      if (normalizeNumber(card.total) === wantedDenominator) s += 45;
      if (setName.includes(wantedDenominator)) s += 35;
    }

    if (card.imageUrl) s += 10;
    return s;
  }
}

function renderResults(results) {
  const list = $("resultsList");
  list.innerHTML = "";

  for (const card of results) {
    const item = document.createElement("article");
    item.className = "result-card";
    const image = getCardImage(card);
    item.innerHTML = `
      ${image ? `<img src="${safeText(image)}" alt="${safeText(card.name)}" loading="lazy">` : "<div></div>"}
      <div class="result-info">
        <h3>${safeText(card.name)}</h3>
        <p>Coleção: ${safeText(card.setName || "-")}<br>Número: ${safeText(card.number || "-")} • ${safeText(card.language)}<br>Raridade: ${safeText(card.rarity || "-")}</p>
      </div>
      <button class="primary-btn choose-result" type="button">Escolher</button>`;
    item.querySelector(".choose-result").addEventListener("click", () => chooseCard(card));
    list.appendChild(item);
  }
}

function chooseCard(card) {
  selectedCard = card;
  $("selectedTitle").textContent = card.name || "Carta selecionada";
  const image = getCardImage(card);
  $("selectedPreview").innerHTML = `
    ${image ? `<img src="${safeText(image)}" alt="${safeText(card.name)}">` : ""}
    <div><h3>${safeText(card.name)}</h3><p class="card-meta">${safeText(card.setName || "-")}<br>${safeText(card.number || "-")} • ${safeText(card.language || "-")}<br>${safeText(card.rarity || "-")}</p></div>`;

  $("cardQuantity").value = 1;
  $("cardCondition").value = "Nova";
  $("cardFinish").value = "Normal";
  $("priceSource").value = "Liga Pokémon";
  $("priceMin").value = "";
  $("priceAvg").value = "";
  $("priceMax").value = "";
  $("cardNotes").value = "";

  const liga = buildLigaSearchUrl(card);
  $("priceLink").value = liga;
  $("ligaSearchLink").href = liga;
  openModal("priceDialog");
}

// =============================================================
// OCR
// =============================================================

async function runOCR() {
  const file = $("cardPhoto").files?.[0];
  if (!file) {
    toast("Escolha ou tire uma foto primeiro.");
    return;
  }
  if (!window.Tesseract) {
    toast("OCR não carregou. Use a busca manual.");
    return;
  }

  $("ocrStatus").textContent = "Lendo imagem...";
  try {
    const result = await window.Tesseract.recognize(file, "por+eng", {
      logger: m => {
        if (m.progress) $("ocrStatus").textContent = `Lendo imagem... ${Math.round(m.progress * 100)}%`;
      }
    });

    const text = result?.data?.text || "";
    $("ocrText").value = text.trim();
    const lines = text.split(/\n+/).map(v => v.trim()).filter(Boolean);
    const number = text.match(/([A-Za-z]*\d{1,4})\s*\/\s*(\d{1,4})/);
    if (!$("searchName").value && lines[0]) $("searchName").value = lines[0].replace(/[^\p{L}\p{N}\s.'-]/gu, "").trim();
    if (!$("searchNumber").value && number) $("searchNumber").value = `${number[1]}/${number[2]}`;
    $("ocrStatus").textContent = "OCR concluído. Confira os campos.";
  } catch (err) {
    console.error(err);
    $("ocrStatus").textContent = "Não consegui ler a imagem. Use a busca manual.";
  }
}

// =============================================================
// EVENTOS / INICIALIZAÇÃO
// =============================================================

function bindEvents() {
  $("tabLogin").addEventListener("click", () => setAuthMode("login"));
  $("tabSignup").addEventListener("click", () => setAuthMode("signup"));
  $("authForm").addEventListener("submit", handleAuth);
  $("btnLogout").addEventListener("click", () => db.auth.signOut());
  $("btnOpenAdd").addEventListener("click", () => openModal("addDialog"));
  $("btnRefresh").addEventListener("click", () => loadCards(true));
  $("btnRunOCR").addEventListener("click", runOCR);
  $("btnSearchCards").addEventListener("click", searchCards);
  $("btnClearSearch").addEventListener("click", () => {
    $("searchName").value = "";
    $("searchNumber").value = "";
    $("searchSet").value = "";
    $("ocrText").value = "";
    $("searchStatus").textContent = "";
    $("resultsList").innerHTML = "";
  });
  $("btnSaveCard").addEventListener("click", saveSelectedCard);
  $("filterText").addEventListener("input", applyFilters);
  $("filterLanguage").addEventListener("change", applyFilters);
  $("prevPage").addEventListener("click", () => { currentPage = Math.max(1, currentPage - 1); renderBinder(); });
  $("nextPage").addEventListener("click", () => {
    const max = Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE));
    currentPage = Math.min(max, currentPage + 1);
    renderBinder();
  });

  document.addEventListener("click", event => {
    const close = event.target.closest("[data-close]");
    if (close) closeModal(close.dataset.close);

    const del = event.target.closest("[data-card-id]");
    if (del) deleteCard(del.dataset.cardId);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Enter" && event.target.closest("dialog") && event.target.tagName !== "TEXTAREA") {
      event.preventDefault();
    }
  }, true);
}

async function boot() {
  bindEvents();
  const { data } = await db.auth.getSession();
  await renderAuthState(data.session);

  db.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => renderAuthState(session), 0);
  });
}

document.addEventListener("DOMContentLoaded", boot);

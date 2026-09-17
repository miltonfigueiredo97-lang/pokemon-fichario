// =============================================================
// POKÉMON BINDER BR — SUPABASE + PREÇO AUTOMÁTICO + AMIGOS
// Dados: public.pokemon_cards / pokemon_profiles / pokemon_friendships
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
let currentProfile = null;
let authMode = "login";
let collection = [];
let filteredCollection = [];
let currentPage = 1;
let selectedCard = null;
let selectedPriceMeta = null;

let friendships = [];
let profilesById = new Map();

let friendBinderCards = [];
let friendBinderPage = 1;
let currentFriendProfile = null;

const fxCache = new Map();

function $(id) { return document.getElementById(id); }

function safeText(value) {
  return String(value ?? "").replace(/[<>&"]/g, c => ({
    "<":"&lt;",
    ">":"&gt;",
    "&":"&amp;",
    '"':"&quot;"
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
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
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
  if (image.includes("assets.tcgdex.net") && !/\.(webp|png|jpg|jpeg)$/i.test(image)) {
    return `${image}/high.webp`;
  }
  return image;
}

function buildLigaSearchUrl(card) {
  const terms = [
    card.name,
    card.number,
    card.setName || card.set_name,
    "pokemon"
  ].filter(Boolean).join(" ");

  return "https://www.ligapokemon.com.br/?view=cards/search&card=" +
    encodeURIComponent(terms);
}

function buildCardKey(card) {
  const source = card.source || card.api_source || "manual";
  const apiId = card.apiId || card.api_id || "";
  const lang = card.languageCode || card.language_code || "";

  if (apiId) return `${source}|${apiId}|${lang}`;

  return [
    card.name,
    card.setId || card.set_id,
    card.number,
    lang
  ].map(normalizeText).join("|");
}

function firstFinite(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// =============================================================
// AUTH / PERFIL
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
    currentProfile = null;
    applyFilters();
    return;
  }

  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");

  await ensureSettings();
  await loadCurrentProfile();
  await loadCards(false);
}

async function ensureSettings() {
  const { data, error } = await db
    .from("pokemon_settings")
    .select("user_id")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("settings select", error);
    return;
  }

  if (!data) {
    const { error: insertError } = await db
      .from("pokemon_settings")
      .insert({ user_id: currentUser.id });

    if (insertError) console.error("settings insert", insertError);
  }
}

async function loadCurrentProfile() {
  const { data, error } = await db
    .from("pokemon_profiles")
    .select("*")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("profile", error);
    return;
  }

  currentProfile = data || null;

  if (currentProfile) {
    $("userHandle").textContent = `@${currentProfile.username}`;
    $("profileUsername").value = currentProfile.username || "";
    $("profileVisibility").value = currentProfile.binder_visibility || "friends";
  } else {
    $("userHandle").textContent = currentUser.email || "";
  }
}

async function saveProfile() {
  if (!currentUser) return;

  const username = $("profileUsername").value.trim();
  const visibility = $("profileVisibility").value;

  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) {
    toast("Use 3 a 24 caracteres: letras, números, ponto, _ ou -.");
    return;
  }

  const { error } = await db
    .from("pokemon_profiles")
    .update({
      username,
      binder_visibility: visibility
    })
    .eq("user_id", currentUser.id);

  if (error) {
    console.error(error);
    if (String(error.message || "").toLowerCase().includes("duplicate")) {
      toast("Esse @usuário já está em uso.");
    } else {
      toast("Não consegui salvar o perfil.");
    }
    return;
  }

  await loadCurrentProfile();
  toast("Perfil salvo.");
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
    .eq("user_id", currentUser.id)
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
  const ligaLink = buildLigaSearchUrl(selectedCard);

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
      price_link: ligaLink,
      notes: $("cardNotes").value.trim(),
      price_checked_at: selectedPriceMeta?.checkedAt || null,
      price_market_updated_at: selectedPriceMeta?.marketUpdatedAt || null,
      price_original_currency: selectedPriceMeta?.currency || null,
      price_original_min: selectedPriceMeta?.originalMin || null,
      price_original_avg: selectedPriceMeta?.originalAvg || null,
      price_original_max: selectedPriceMeta?.originalMax || null,
      price_fx_rate: selectedPriceMeta?.fxRate || null
    };

    if (existing) {
      const { error } = await db
        .from("pokemon_cards")
        .update({
          ...common,
          quantity: Number(existing.quantity || 0) + quantity
        })
        .eq("id", existing.id)
        .eq("user_id", currentUser.id);

      if (error) throw error;
      toast("Cópia agrupada na carta existente.");
    } else {
      const { error } = await db
        .from("pokemon_cards")
        .insert({
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
    toast("Erro ao salvar a carta.");
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

  const { error } = await db
    .from("pokemon_cards")
    .delete()
    .eq("id", id)
    .eq("user_id", currentUser.id);

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
// RENDER DO MEU FICHÁRIO
// =============================================================

function applyFilters() {
  const text = normalizeText($("filterText")?.value || "");
  const lang = $("filterLanguage")?.value || "all";

  filteredCollection = collection.filter(card => {
    const haystack = normalizeText([
      card.name,
      card.set_name,
      card.number,
      card.language,
      card.rarity
    ].join(" "));

    return (!text || haystack.includes(text)) &&
      (lang === "all" || card.language_code === lang);
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

  $("totalCards").textContent = totals.qty;
  $("totalMin").textContent = money(totals.min);
  $("totalAvg").textContent = money(totals.avg);
  $("totalMax").textContent = money(totals.max);
}

function renderBinder() {
  renderCardGrid($("binderGrid"), filteredCollection, currentPage, true);
  const totalPages = Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE));
  $("pageInfo").textContent = `Página ${currentPage} de ${totalPages}`;
}

function renderCardGrid(grid, cards, page, editable) {
  if (!grid) return;
  grid.innerHTML = "";

  const pageCards = cards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  for (let i = 0; i < PAGE_SIZE; i++) {
    const card = pageCards[i];
    const slot = document.createElement("article");
    slot.className = "card-slot" + (card ? "" : " empty");

    if (!card) {
      slot.textContent = "Espaço vazio";
      grid.appendChild(slot);
      continue;
    }

    const image = getCardImage(card);

    slot.innerHTML = `
      ${editable ? `<button type="button" class="delete-card-btn" data-card-id="${safeText(card.id)}" title="Apagar carta">×</button>` : ""}
      <span class="qty-badge">x${safeText(card.quantity || 1)}</span>
      <div class="card-img-wrap">${image ? `<img src="${safeText(image)}" alt="${safeText(card.name)}" loading="lazy">` : ""}</div>
      <div class="card-title">${safeText(card.name || "Sem nome")}</div>
      <div class="card-meta">${safeText(card.set_name || "Coleção não informada")}<br>${safeText(card.number || "-")} • ${safeText(card.language || "-")}</div>
      <div class="price-pill">${money(card.price_min)} - ${money(card.price_max)}</div>
      <div class="source-line">Fonte: ${safeText(card.price_source || "Sem preço")}</div>`;

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
    const languages = search.language === "all"
      ? ["pt-br", "en", "ja"]
      : [search.language];

    let results = [];

    for (const lang of languages) {
      results.push(...await searchTCGdex(lang, search));
    }

    if (results.length < 3 && search.name) {
      results.push(...await searchPokemonTCG(search));
    }

    const finalResults = rankAndFilter(
      dedupeResults(results),
      search
    ).slice(0, 30);

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

    const details = await Promise.all(
      brief.slice(0, 20).map(async item => {
        try {
          const detailResponse = await fetch(
            `${TCGDEX_BASE}/${lang}/cards/${encodeURIComponent(item.id)}`
          );

          const full = detailResponse.ok
            ? await detailResponse.json()
            : item;

          return mapTCGdex(full, lang);
        } catch {
          return mapTCGdex(item, lang);
        }
      })
    );

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
    imageUrl: card.image || "",
    pricing: card.pricing || null
  };
}

async function searchPokemonTCG(search) {
  const clauses = [];
  if (search.name) clauses.push(`name:*${search.name.replace(/\s+/g, "*")}*`);
  if (search.number) clauses.push(`number:${search.number}`);

  const response = await fetch(
    `${POKEMON_TCG_BASE}?q=${encodeURIComponent(clauses.join(" "))}&pageSize=20`
  );

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
    imageUrl: card.images?.large || card.images?.small || "",
    pricing: {
      tcgplayer: card.tcgplayer?.prices
        ? {
            unit: "USD",
            updated: card.tcgplayer.updatedAt || null,
            ...card.tcgplayer.prices
          }
        : null,
      cardmarket: card.cardmarket?.prices
        ? {
            unit: "EUR",
            updated: card.cardmarket.updatedAt || null,
            ...card.cardmarket.prices
          }
        : null
    }
  }));
}

function dedupeResults(results) {
  const seen = new Set();

  return results.filter(card => {
    const key = [
      card.source,
      card.apiId,
      card.languageCode,
      card.name,
      card.number,
      card.setId
    ].join("|");

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
      return name === wantedName ||
        name.includes(wantedName) ||
        wantedName.includes(name);
    });

    if (nameMatches.length) candidates = nameMatches;
  }

  if (wantedNumber) {
    const numberMatches = candidates.filter(
      card => normalizeNumber(card.number) === wantedNumber
    );

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
    else if (
      wantedName &&
      (name.includes(wantedName) || wantedName.includes(name))
    ) s += 120;

    if (wantedNumber && normalizeNumber(card.number) === wantedNumber) s += 260;

    if (wantedSet && (setName.includes(wantedSet) || setId.includes(wantedSet))) {
      s += 170;
    }

    if (wantedDenominator) {
      if (normalizeNumber(card.printedTotal) === wantedDenominator) s += 70;
      if (normalizeNumber(card.total) === wantedDenominator) s += 45;
      if (setName.includes(wantedDenominator)) s += 35;
    }

    if (card.imageUrl) s += 10;
    if (card.pricing?.tcgplayer || card.pricing?.cardmarket) s += 20;

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
        <p>
          Coleção: ${safeText(card.setName || "-")}<br>
          Número: ${safeText(card.number || "-")} • ${safeText(card.language)}<br>
          Raridade: ${safeText(card.rarity || "-")}
        </p>
      </div>
      <button class="primary-btn choose-result" type="button">Escolher</button>`;

    item
      .querySelector(".choose-result")
      .addEventListener("click", () => chooseCard(card));

    list.appendChild(item);
  }
}

// =============================================================
// PREÇO AUTOMÁTICO
// =============================================================

async function chooseCard(card) {
  selectedCard = card;
  selectedPriceMeta = null;

  $("selectedTitle").textContent = card.name || "Carta selecionada";

  const image = getCardImage(card);

  $("selectedPreview").innerHTML = `
    ${image ? `<img src="${safeText(image)}" alt="${safeText(card.name)}">` : ""}
    <div>
      <h3>${safeText(card.name)}</h3>
      <p class="card-meta">
        ${safeText(card.setName || "-")}<br>
        ${safeText(card.number || "-")} • ${safeText(card.language || "-")}<br>
        ${safeText(card.rarity || "-")}
      </p>
    </div>`;

  $("cardQuantity").value = 1;
  $("cardCondition").value = "Nova";
  $("cardFinish").value = "Normal";
  $("priceSource").value = "Sem preço";
  $("priceMin").value = "";
  $("priceAvg").value = "";
  $("priceMax").value = "";
  $("cardNotes").value = "";

  const liga = buildLigaSearchUrl(card);
  $("priceLink").value = liga;
  $("ligaSearchLink").href = liga;

  setPriceStatus("Buscando preço atual...", "");
  openModal("priceDialog");

  await autoFillCurrentPrice(card, true);
}

function setPriceStatus(text, type) {
  const el = $("priceStatus");
  el.textContent = text;
  el.classList.remove("ok", "warn");
  if (type) el.classList.add(type);
}

async function ensurePricing(card) {
  if (card.pricing?.tcgplayer || card.pricing?.cardmarket) return card;

  if (card.source === "TCGdex" && card.apiId) {
    const languages = [
      card.languageCode || "pt-br",
      "en",
      "pt-br"
    ].filter((v, i, arr) => arr.indexOf(v) === i);

    for (const lang of languages) {
      try {
        const response = await fetch(
          `${TCGDEX_BASE}/${lang}/cards/${encodeURIComponent(card.apiId)}`
        );

        if (!response.ok) continue;

        const full = await response.json();

        if (full?.pricing?.tcgplayer || full?.pricing?.cardmarket) {
          card.pricing = full.pricing;
          return card;
        }
      } catch {}
    }
  }

  if (card.name) {
    try {
      const clauses = [`name:*${card.name.replace(/\s+/g, "*")}*`];
      if (card.number) clauses.push(`number:${card.number}`);

      const response = await fetch(
        `${POKEMON_TCG_BASE}?q=${encodeURIComponent(clauses.join(" "))}&pageSize=10`
      );

      if (response.ok) {
        const json = await response.json();
        const candidates = json.data || [];

        const exact = candidates.find(c =>
          normalizeText(c.name) === normalizeText(card.name) &&
          (!card.number || normalizeNumber(c.number) === normalizeNumber(card.number))
        ) || candidates[0];

        if (exact) {
          const mapped = searchCardPricingFromPokemonTCG(exact);
          if (mapped?.tcgplayer || mapped?.cardmarket) {
            card.pricing = mapped;
            return card;
          }
        }
      }
    } catch {}
  }

  return card;
}

function searchCardPricingFromPokemonTCG(card) {
  return {
    tcgplayer: card.tcgplayer?.prices
      ? {
          unit: "USD",
          updated: card.tcgplayer.updatedAt || null,
          ...card.tcgplayer.prices
        }
      : null,
    cardmarket: card.cardmarket?.prices
      ? {
          unit: "EUR",
          updated: card.cardmarket.updatedAt || null,
          ...card.cardmarket.prices
        }
      : null
  };
}

function tcgPlayerVariantCandidates(finish) {
  const f = normalizeText(finish);

  if (f.includes("reverse")) {
    return ["reverse-holofoil", "reverseHolofoil", "reverse", "reverseHolo"];
  }

  if (f.includes("holo") || f.includes("foil") || f.includes("especial")) {
    return [
      "holofoil",
      "holo",
      "unlimited-holofoil",
      "unlimitedHolofoil",
      "1st-edition-holofoil",
      "1stEditionHolofoil"
    ];
  }

  return ["normal", "unlimited", "1st-edition", "1stEdition"];
}

function extractTCGPlayerPrice(pricing, finish, allowFallback = true) {
  const provider = pricing?.tcgplayer;
  if (!provider) return null;

  const candidates = tcgPlayerVariantCandidates(finish);

  for (const key of candidates) {
    const variant = provider[key];

    if (variant && typeof variant === "object") {
      const low = firstFinite(variant.lowPrice, variant.low, variant.directLowPrice);
      const avg = firstFinite(
        variant.marketPrice,
        variant.market,
        variant.midPrice,
        variant.mid,
        low
      );
      const high = firstFinite(variant.highPrice, variant.high, avg);

      if (low || avg || high) {
        return {
          provider: "TCGPlayer via TCGdex",
          currency: provider.unit || "USD",
          low: low || avg,
          avg: avg || low,
          high: high || avg || low,
          updated: provider.updated || null,
          variantKey: key
        };
      }
    }
  }

  if (!allowFallback) return null;

  const ignored = new Set(["updated", "unit"]);
  for (const [key, variant] of Object.entries(provider)) {
    if (ignored.has(key) || !variant || typeof variant !== "object") continue;

    const low = firstFinite(variant.lowPrice, variant.low, variant.directLowPrice);
    const avg = firstFinite(
      variant.marketPrice,
      variant.market,
      variant.midPrice,
      variant.mid,
      low
    );
    const high = firstFinite(variant.highPrice, variant.high, avg);

    if (low || avg || high) {
      return {
        provider: "TCGPlayer via TCGdex",
        currency: provider.unit || "USD",
        low: low || avg,
        avg: avg || low,
        high: high || avg || low,
        updated: provider.updated || null,
        variantKey: key
      };
    }
  }

  return null;
}

function extractCardmarketPrice(pricing, finish) {
  const provider = pricing?.cardmarket;
  if (!provider) return null;

  const f = normalizeText(finish);
  const holo = f.includes("holo") || f.includes("foil") || f.includes("especial");

  const low = holo
    ? firstFinite(
        provider["low-holo"],
        provider.lowHolo,
        provider.lowHoloPrice,
        provider.lowPriceHolo
      )
    : firstFinite(provider.low, provider.lowPrice);

  const avg = holo
    ? firstFinite(
        provider["avg-holo"],
        provider.avgHolo,
        provider["trend-holo"],
        provider.trendHolo,
        provider["avg7-holo"],
        provider.avg7Holo,
        low
      )
    : firstFinite(
        provider.avg,
        provider.averageSellPrice,
        provider.trend,
        provider.trendPrice,
        provider.avg7,
        provider.avg30,
        low
      );

  const high = holo
    ? firstFinite(
        provider["avg30-holo"],
        provider.avg30Holo,
        provider["avg7-holo"],
        provider.avg7Holo,
        avg
      )
    : firstFinite(provider.avg30, provider.avg7, provider.trendPrice, avg);

  if (!low && !avg && !high) return null;

  return {
    provider: "Cardmarket via TCGdex",
    currency: provider.unit || "EUR",
    low: low || avg,
    avg: avg || low,
    high: high || avg || low,
    updated: provider.updated || null,
    variantKey: holo ? "holo" : "normal"
  };
}

function inferFinishFromVariant(variantKey) {
  const key = normalizeText(variantKey);

  if (key.includes("reverse")) return "Reverse Holo";
  if (key.includes("holo") || key.includes("foil")) return "Holo";
  return "Normal";
}

async function getFxRate(currency) {
  const unit = String(currency || "BRL").toUpperCase();
  if (unit === "BRL") return 1;

  const cached = fxCache.get(unit);
  const now = Date.now();

  if (cached && now - cached.time < 6 * 60 * 60 * 1000) {
    return cached.rate;
  }

  try {
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(unit)}&to=BRL`
    );

    if (response.ok) {
      const json = await response.json();
      const rate = Number(json?.rates?.BRL);

      if (Number.isFinite(rate) && rate > 0) {
        fxCache.set(unit, { rate, time: now });
        return rate;
      }
    }
  } catch {}

  try {
    const response = await fetch(
      `https://open.er-api.com/v6/latest/${encodeURIComponent(unit)}`
    );

    if (response.ok) {
      const json = await response.json();
      const rate = Number(json?.rates?.BRL);

      if (Number.isFinite(rate) && rate > 0) {
        fxCache.set(unit, { rate, time: now });
        return rate;
      }
    }
  } catch {}

  return null;
}

async function autoFillCurrentPrice(card, mayAdjustFinish = false) {
  if (!card) return;

  setPriceStatus("Buscando preço atual...", "");

  const enriched = await ensurePricing(card);
  const finish = $("cardFinish").value;

  let market = extractTCGPlayerPrice(enriched.pricing, finish, false);

  if (!market) {
    market = extractCardmarketPrice(enriched.pricing, finish);
  }

  if (!market) {
    market = extractTCGPlayerPrice(enriched.pricing, finish, true);

    if (market && mayAdjustFinish) {
      $("cardFinish").value = inferFinishFromVariant(market.variantKey);
    }
  }

  if (!market) {
    selectedPriceMeta = null;
    $("priceSource").value = "Liga Pokémon";
    $("priceMin").value = "";
    $("priceAvg").value = "";
    $("priceMax").value = "";

    setPriceStatus(
      "Não encontrei cotação automática para esta carta/variante. O link da Liga Pokémon já está preenchido para conferência.",
      "warn"
    );
    return;
  }

  const fxRate = await getFxRate(market.currency);

  if (!fxRate) {
    selectedPriceMeta = null;
    $("priceSource").value = market.provider;
    setPriceStatus(
      `Encontrei o preço em ${market.currency}, mas não consegui converter para BRL agora.`,
      "warn"
    );
    return;
  }

  const minBRL = market.low * fxRate;
  const avgBRL = market.avg * fxRate;
  const maxBRL = market.high * fxRate;

  $("priceMin").value = minBRL.toFixed(2);
  $("priceAvg").value = avgBRL.toFixed(2);
  $("priceMax").value = maxBRL.toFixed(2);
  $("priceSource").value = market.provider;

  selectedPriceMeta = {
    provider: market.provider,
    currency: String(market.currency || "").toUpperCase(),
    originalMin: market.low,
    originalAvg: market.avg,
    originalMax: market.high,
    fxRate,
    checkedAt: new Date().toISOString(),
    marketUpdatedAt: isoOrNull(market.updated)
  };

  const updatedText = selectedPriceMeta.marketUpdatedAt
    ? ` Mercado: ${new Date(selectedPriceMeta.marketUpdatedAt).toLocaleString("pt-BR")}.`
    : "";

  setPriceStatus(
    `Preço preenchido automaticamente em BRL • ${market.provider} • ${selectedPriceMeta.currency} → BRL.${updatedText}`,
    "ok"
  );
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
        if (m.progress) {
          $("ocrStatus").textContent =
            `Lendo imagem... ${Math.round(m.progress * 100)}%`;
        }
      }
    });

    const text = result?.data?.text || "";
    $("ocrText").value = text.trim();

    const lines = text
      .split(/\n+/)
      .map(v => v.trim())
      .filter(Boolean);

    const number = text.match(/([A-Za-z]*\d{1,4})\s*\/\s*(\d{1,4})/);

    if (!$("searchName").value && lines[0]) {
      $("searchName").value = lines[0]
        .replace(/[^\p{L}\p{N}\s.'-]/gu, "")
        .trim();
    }

    if (!$("searchNumber").value && number) {
      $("searchNumber").value = `${number[1]}/${number[2]}`;
    }

    $("ocrStatus").textContent = "OCR concluído. Confira os campos.";
  } catch (err) {
    console.error(err);
    $("ocrStatus").textContent =
      "Não consegui ler a imagem. Use a busca manual.";
  }
}

// =============================================================
// AMIGOS
// =============================================================

async function openFriends() {
  await loadCurrentProfile();
  await loadFriendships();
  renderSocialLists();
  $("friendSearchResults").innerHTML = "";
  $("friendSearch").value = "";
  openModal("friendsDialog");
}

async function loadFriendships() {
  const { data, error } = await db
    .from("pokemon_friendships")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    toast("Não consegui carregar os amigos.");
    return;
  }

  friendships = data || [];

  const ids = new Set();

  for (const f of friendships) {
    ids.add(f.requester_id);
    ids.add(f.addressee_id);
  }

  ids.delete(currentUser.id);
  profilesById = new Map();

  if (ids.size) {
    const { data: profiles, error: profileError } = await db
      .from("pokemon_profiles")
      .select("user_id,username,display_name,avatar_url,binder_visibility")
      .in("user_id", [...ids]);

    if (profileError) {
      console.error(profileError);
    } else {
      for (const p of profiles || []) profilesById.set(p.user_id, p);
    }
  }
}

function friendshipWith(userId) {
  return friendships.find(f =>
    (f.requester_id === currentUser.id && f.addressee_id === userId) ||
    (f.addressee_id === currentUser.id && f.requester_id === userId)
  ) || null;
}

function renderSocialLists() {
  const requestsEl = $("friendRequests");
  const friendsEl = $("friendsList");

  requestsEl.innerHTML = "";
  friendsEl.innerHTML = "";

  const incoming = friendships.filter(f =>
    f.status === "pending" && f.addressee_id === currentUser.id
  );

  const accepted = friendships.filter(f => f.status === "accepted");

  if (!incoming.length) {
    requestsEl.innerHTML = `<p class="hint">Nenhum pedido pendente.</p>`;
  } else {
    for (const f of incoming) {
      const profile = profilesById.get(f.requester_id);
      requestsEl.appendChild(
        socialItem(profile, `
          <button class="primary-btn" data-accept-friend="${safeText(f.id)}" type="button">Aceitar</button>
          <button class="ghost-btn" data-remove-friend="${safeText(f.id)}" type="button">Recusar</button>
        `)
      );
    }
  }

  if (!accepted.length) {
    friendsEl.innerHTML = `<p class="hint">Você ainda não adicionou amigos.</p>`;
  } else {
    for (const f of accepted) {
      const friendId = f.requester_id === currentUser.id
        ? f.addressee_id
        : f.requester_id;

      const profile = profilesById.get(friendId);

      friendsEl.appendChild(
        socialItem(profile, `
          <button class="primary-btn" data-view-friend="${safeText(friendId)}" type="button">Ver fichário</button>
          <button class="ghost-btn" data-remove-friend="${safeText(f.id)}" type="button">Remover</button>
        `)
      );
    }
  }
}

function socialItem(profile, actionsHtml) {
  const item = document.createElement("div");
  item.className = "social-item";

  if (!profile) {
    item.innerHTML = `<div><strong>Usuário</strong><small>Perfil indisponível</small></div><div class="social-item-actions">${actionsHtml}</div>`;
    return item;
  }

  item.innerHTML = `
    <div>
      <strong>@${safeText(profile.username)}</strong>
      <small>${safeText(profile.display_name || "")}</small>
    </div>
    <div class="social-item-actions">${actionsHtml}</div>`;

  return item;
}

async function searchFriends() {
  const term = $("friendSearch").value.trim().replace(/^@/, "");
  const list = $("friendSearchResults");
  list.innerHTML = "";

  if (term.length < 2) {
    toast("Digite pelo menos 2 caracteres.");
    return;
  }

  const { data, error } = await db
    .from("pokemon_profiles")
    .select("user_id,username,display_name,avatar_url,binder_visibility")
    .ilike("username", `%${term}%`)
    .neq("user_id", currentUser.id)
    .limit(20);

  if (error) {
    console.error(error);
    toast("Não consegui buscar usuários.");
    return;
  }

  if (!data?.length) {
    list.innerHTML = `<p class="hint">Nenhum usuário encontrado.</p>`;
    return;
  }

  for (const profile of data) {
    const relation = friendshipWith(profile.user_id);
    let actions = "";

    if (!relation) {
      actions = `<button class="primary-btn" data-add-friend="${safeText(profile.user_id)}" type="button">Adicionar</button>`;
    } else if (relation.status === "accepted") {
      actions = `<button class="primary-btn" data-view-friend="${safeText(profile.user_id)}" type="button">Ver fichário</button>`;
    } else if (relation.addressee_id === currentUser.id) {
      actions = `<button class="primary-btn" data-accept-friend="${safeText(relation.id)}" type="button">Aceitar</button>`;
    } else {
      actions = `<button class="ghost-btn" type="button" disabled>Pedido enviado</button>`;
    }

    list.appendChild(socialItem(profile, actions));
  }
}

async function sendFriendRequest(targetUserId) {
  const { error } = await db
    .from("pokemon_friendships")
    .insert({
      requester_id: currentUser.id,
      addressee_id: targetUserId,
      status: "pending"
    });

  if (error) {
    console.error(error);
    toast("Não consegui enviar o pedido.");
    return;
  }

  toast("Pedido de amizade enviado.");
  await loadFriendships();
  renderSocialLists();
  await searchFriends();
}

async function acceptFriendRequest(friendshipId) {
  const { error } = await db
    .from("pokemon_friendships")
    .update({ status: "accepted" })
    .eq("id", friendshipId);

  if (error) {
    console.error(error);
    toast("Não consegui aceitar o pedido.");
    return;
  }

  toast("Amizade aceita.");
  await loadFriendships();
  renderSocialLists();
}

async function removeFriendship(friendshipId) {
  const { error } = await db
    .from("pokemon_friendships")
    .delete()
    .eq("id", friendshipId);

  if (error) {
    console.error(error);
    toast("Não consegui remover.");
    return;
  }

  toast("Amizade atualizada.");
  await loadFriendships();
  renderSocialLists();
}

async function openFriendBinder(friendUserId) {
  const profile = profilesById.get(friendUserId);

  if (!profile) {
    toast("Perfil do amigo não encontrado.");
    return;
  }

  if (profile.binder_visibility === "private") {
    toast("Esse fichário está privado.");
    return;
  }

  currentFriendProfile = profile;
  friendBinderPage = 1;
  $("friendBinderTitle").textContent = `@${profile.username}`;
  $("friendBinderStats").textContent = "Carregando fichário...";

  const { data, error } = await db
    .from("pokemon_cards")
    .select("*")
    .eq("user_id", friendUserId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    toast("Esse fichário não está disponível.");
    return;
  }

  friendBinderCards = data || [];
  renderFriendBinder();
  closeModal("friendsDialog");
  openModal("friendBinderDialog");
}

function renderFriendBinder() {
  const totalPages = Math.max(1, Math.ceil(friendBinderCards.length / PAGE_SIZE));
  friendBinderPage = Math.min(Math.max(friendBinderPage, 1), totalPages);

  renderCardGrid(
    $("friendBinderGrid"),
    friendBinderCards,
    friendBinderPage,
    false
  );

  const totalCopies = friendBinderCards.reduce(
    (sum, card) => sum + Number(card.quantity || 1),
    0
  );

  $("friendBinderStats").textContent =
    `${totalCopies} carta(s) • ${friendBinderCards.length} entrada(s)`;

  $("friendPageInfo").textContent =
    `Página ${friendBinderPage} de ${totalPages}`;
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
  $("btnFriends").addEventListener("click", openFriends);
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

  $("cardFinish").addEventListener("change", () => {
    if (selectedCard) autoFillCurrentPrice(selectedCard, false);
  });

  $("filterText").addEventListener("input", applyFilters);
  $("filterLanguage").addEventListener("change", applyFilters);

  $("prevPage").addEventListener("click", () => {
    currentPage = Math.max(1, currentPage - 1);
    renderBinder();
  });

  $("nextPage").addEventListener("click", () => {
    const max = Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE));
    currentPage = Math.min(max, currentPage + 1);
    renderBinder();
  });

  $("btnSaveProfile").addEventListener("click", saveProfile);
  $("btnSearchFriends").addEventListener("click", searchFriends);

  $("friendPrevPage").addEventListener("click", () => {
    friendBinderPage = Math.max(1, friendBinderPage - 1);
    renderFriendBinder();
  });

  $("friendNextPage").addEventListener("click", () => {
    const max = Math.max(1, Math.ceil(friendBinderCards.length / PAGE_SIZE));
    friendBinderPage = Math.min(max, friendBinderPage + 1);
    renderFriendBinder();
  });

  document.addEventListener("click", event => {
    const close = event.target.closest("[data-close]");
    if (close) {
      closeModal(close.dataset.close);
      return;
    }

    const del = event.target.closest("[data-card-id]");
    if (del) {
      deleteCard(del.dataset.cardId);
      return;
    }

    const addFriend = event.target.closest("[data-add-friend]");
    if (addFriend) {
      sendFriendRequest(addFriend.dataset.addFriend);
      return;
    }

    const acceptFriend = event.target.closest("[data-accept-friend]");
    if (acceptFriend) {
      acceptFriendRequest(acceptFriend.dataset.acceptFriend);
      return;
    }

    const removeFriend = event.target.closest("[data-remove-friend]");
    if (removeFriend) {
      removeFriendship(removeFriend.dataset.removeFriend);
      return;
    }

    const viewFriend = event.target.closest("[data-view-friend]");
    if (viewFriend) {
      openFriendBinder(viewFriend.dataset.viewFriend);
    }
  });

  document.addEventListener("keydown", event => {
    if (
      event.key === "Enter" &&
      event.target.closest("dialog") &&
      event.target.tagName !== "TEXTAREA"
    ) {
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

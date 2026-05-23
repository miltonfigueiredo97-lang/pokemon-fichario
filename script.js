// =============================================================
// POKÉMON FICHÁRIO - SCRIPT.JS
// Busca inteligente PT-BR/EN/JA + filtro por nome/número/coleção
// Apps Script fixo do Milton
// =============================================================

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbys5J81vcGxNQodij2OsOZsx_k_C1gbWaB1y4ieHdpHfFLN0NLlxAErXQxZg6cXVzBW0Q/exec";

const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const POKEMON_TCG_BASE = "https://api.pokemontcg.io/v2/cards";

const PAGE_SIZE = 9;

const LANGUAGE_LABEL = {
  "pt-br": "Português",
  "en": "Inglês",
  "ja": "Japonês"
};

let collection = [];
let filteredCollection = [];
let currentPage = 1;
let selectedCard = null;
let appReady = false;

// =============================================================
// BASE
// =============================================================

function $(id) {
  return document.getElementById(id);
}

function safeText(value) {
  return String(value || "").replace(/[<>&"]/g, function (c) {
    return {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;"
    }[c];
  });
}

function toast(message) {
  const el = $("toast");

  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = message;
  el.classList.add("show");

  setTimeout(function () {
    el.classList.remove("show");
  }, 2200);
}

function money(value, currency) {
  const n = Number(value || 0);

  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL"
    }).format(n);
  } catch (e) {
    return "R$ " + n.toFixed(2).replace(".", ",");
  }
}

function normalizeNumber(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^0+(?=\d)/, "");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstWord(value) {
  return String(value || "").trim().split(/\s+/)[0] || "";
}

function getCardImage(card) {
  const image = card.imageUrl || card.imagemUrl || "";

  if (!image) return "";

  if (image.includes("tcgdex") && !image.endsWith(".webp")) {
    return image + "/high.webp";
  }

  return image;
}

function openModal(id) {
  const modal = $(id);

  if (!modal) {
    toast("Janela não encontrada: " + id);
    return;
  }

  try {
    if (typeof modal.showModal === "function" && !modal.open) {
      modal.showModal();
    } else {
      modal.setAttribute("open", "open");
      modal.classList.add("modal-open");
    }
  } catch (e) {
    modal.setAttribute("open", "open");
    modal.classList.add("modal-open");
  }
}

function closeModal(id) {
  const modal = $(id);

  if (!modal) return;

  try {
    if (typeof modal.close === "function") {
      modal.close();
    } else {
      modal.removeAttribute("open");
      modal.classList.remove("modal-open");
    }
  } catch (e) {
    modal.removeAttribute("open");
    modal.classList.remove("modal-open");
  }
}

function buildLigaSearchUrl(card) {
  const terms = [
    card.name,
    card.number,
    card.setName,
    "pokemon"
  ]
    .filter(Boolean)
    .join(" ");

  return "https://www.ligapokemon.com.br/?view=cards/search&card=" + encodeURIComponent(terms);
}

// =============================================================
// ENTER NÃO FECHA JANELA
// =============================================================

document.addEventListener("keydown", function (event) {
  if (event.key !== "Enter") return;

  const tag = event.target && event.target.tagName
    ? event.target.tagName.toLowerCase()
    : "";

  const type = event.target && event.target.type
    ? String(event.target.type).toLowerCase()
    : "";

  const isTextarea = tag === "textarea";
  const isButton = tag === "button" || type === "button" || type === "submit";

  if (!isTextarea && !isButton) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

document.addEventListener("submit", function (event) {
  const insideDialog = event.target && event.target.closest
    ? event.target.closest("dialog")
    : null;

  if (insideDialog) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
}, true);

// =============================================================
// APPS SCRIPT VIA JSONP
// =============================================================

function jsonpRequest(action, params) {
  return new Promise(function (resolve, reject) {
    const callbackName = "pokemonBinderCallback_" + Date.now() + "_" + Math.floor(Math.random() * 999999);

    const query = new URLSearchParams();
    query.set("action", action);
    query.set("callback", callbackName);
    query.set("cacheBust", Date.now());

    if (params) {
      Object.keys(params).forEach(function (key) {
        query.set(key, params[key]);
      });
    }

    const script = document.createElement("script");

    window[callbackName] = function (data) {
      cleanup();

      if (!data || data.ok === false) {
        reject(new Error(data && data.error ? data.error : "Erro desconhecido no Apps Script."));
        return;
      }

      resolve(data);
    };

    function cleanup() {
      try {
        delete window[callbackName];
      } catch (e) {
        window[callbackName] = undefined;
      }

      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    script.onerror = function () {
      cleanup();
      reject(new Error("Falha ao conectar com o Apps Script."));
    };

    script.src = APPS_SCRIPT_URL + "?" + query.toString();

    document.body.appendChild(script);
  });
}

async function apiGetCards(showMessage) {
  try {
    if (showMessage) {
      toast("Carregando fichário...");
    }

    const data = await jsonpRequest("getCards");

    collection = Array.isArray(data.cards) ? data.cards : [];
    applyFilters();

    if (showMessage) {
      toast("Fichário carregado.");
    }

  } catch (err) {
    console.error("Erro ao carregar planilha:", err);

    collection = [];
    applyFilters();

    toast("Não consegui carregar a planilha. Veja se o Apps Script foi implantado.");
  }
}

async function apiSaveCard(card) {
  const payload = JSON.stringify(card);

  return await jsonpRequest("saveCard", {
    payload: payload
  });
}

async function apiDeleteCard(internalId) {
  return await jsonpRequest("deleteCard", {
    internalId: internalId
  });
}

// =============================================================
// FICHÁRIO
// =============================================================

function applyFilters() {
  const filterTextEl = $("filterText");
  const filterLanguageEl = $("filterLanguage");

  const text = filterTextEl ? filterTextEl.value.toLowerCase().trim() : "";
  const lang = filterLanguageEl ? filterLanguageEl.value : "all";

  filteredCollection = collection.filter(function (card) {
    const haystack = [
      card.name,
      card.nome,
      card.setName,
      card.colecao,
      card.number,
      card.numero,
      card.language,
      card.idioma,
      card.rarity,
      card.raridade
    ]
      .join(" ")
      .toLowerCase();

    const cardLang = card.languageCode || card.codigoIdioma || "";

    const matchText = !text || haystack.includes(text);
    const matchLang = lang === "all" || cardLang === lang || !cardLang;

    return matchText && matchLang;
  });

  const totalPages = Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE));

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  renderBinder();
  renderStats();
}

function renderStats() {
  const totals = collection.reduce(function (acc, card) {
    const qty = Number(card.quantity || card.quantidade || 1);

    acc.qty += qty;
    acc.min += Number(card.priceMin || card.precoMinimo || 0) * qty;
    acc.avg += Number(card.priceAvg || card.precoMedio || 0) * qty;
    acc.max += Number(card.priceMax || card.precoMaximo || 0) * qty;

    return acc;
  }, {
    qty: 0,
    min: 0,
    avg: 0,
    max: 0
  });

  if ($("totalCards")) $("totalCards").textContent = totals.qty;
  if ($("totalMin")) $("totalMin").textContent = money(totals.min, "BRL");
  if ($("totalAvg")) $("totalAvg").textContent = money(totals.avg, "BRL");
  if ($("totalMax")) $("totalMax").textContent = money(totals.max, "BRL");
}

function renderBinder() {
  const grid = $("binderGrid");

  if (!grid) return;

  grid.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE));

  if ($("pageInfo")) {
    $("pageInfo").textContent = "Página " + currentPage + " de " + totalPages;
  }

  const start = (currentPage - 1) * PAGE_SIZE;
  const cards = filteredCollection.slice(start, start + PAGE_SIZE);

  for (let i = 0; i < PAGE_SIZE; i++) {
    const card = cards[i];
    const slot = document.createElement("article");

    slot.className = "card-slot" + (card ? "" : " empty");

    if (!card) {
      slot.textContent = "Espaço vazio";
    } else {
      const name = card.name || card.nome || "Sem nome";
      const setName = card.setName || card.colecao || "Coleção não informada";
      const number = card.number || card.numero || "-";
      const language = card.language || card.idioma || "-";
      const quantity = card.quantity || card.quantidade || 1;
      const priceMin = card.priceMin || card.precoMinimo || 0;
      const priceMax = card.priceMax || card.precoMaximo || 0;
      const priceSource = card.priceSource || card.fontePreco || "Liga Pokémon";
      const image = getCardImage(card);
      const internalId = card.internalId || card.idInterno || "";

      slot.innerHTML =
        '<button type="button" class="delete-card-btn" data-card-id="' + safeText(internalId) + '" title="Apagar carta">×</button>' +
        '<span class="qty-badge">x' + safeText(quantity) + '</span>' +
        '<div class="card-img-wrap">' +
          (image ? '<img src="' + safeText(image) + '" alt="' + safeText(name) + '" loading="lazy">' : "") +
        '</div>' +
        '<div class="card-title">' + safeText(name) + '</div>' +
        '<div class="card-meta">' + safeText(setName) + '<br>' + safeText(number) + ' • ' + safeText(language) + '</div>' +
        '<div class="price-pill">' + money(priceMin, "BRL") + " - " + money(priceMax, "BRL") + '</div>' +
        '<div class="source-line">Fonte: ' + safeText(priceSource) + '</div>';
    }

    grid.appendChild(slot);
  }
}

// =============================================================
// OCR
// =============================================================

async function runOCR() {
  const fileInput = $("cardPhoto");

  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    toast("Escolha ou tire uma foto da carta primeiro.");
    return;
  }

  if (typeof Tesseract === "undefined") {
    toast("OCR não carregou. Digite nome e número manualmente.");
    return;
  }

  const file = fileInput.files[0];

  if ($("ocrStatus")) {
    $("ocrStatus").textContent = "Lendo imagem... isso pode demorar alguns segundos.";
  }

  try {
    const result = await Tesseract.recognize(file, "por+eng+jpn", {
      logger: function (m) {
        if ($("ocrStatus") && m.status) {
          const progress = m.progress ? " " + Math.round(m.progress * 100) + "%" : "";
          $("ocrStatus").textContent = "OCR: " + m.status + progress;
        }
      }
    });

    const text = result && result.data && result.data.text ? result.data.text : "";

    if ($("ocrText")) $("ocrText").value = text.trim();

    suggestFieldsFromOCR(text);

    if ($("ocrStatus")) {
      $("ocrStatus").textContent = "OCR concluído. Confira/corrija os campos antes de buscar.";
    }

  } catch (err) {
    console.error("Erro no OCR:", err);

    if ($("ocrStatus")) {
      $("ocrStatus").textContent = "Não consegui ler a imagem. Digite nome e número manualmente.";
    }

    toast("OCR falhou. Digite nome e número manualmente.");
  }
}

function suggestFieldsFromOCR(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map(function (l) {
      return l.trim();
    })
    .filter(Boolean);

  const numberMatch = String(text || "").match(/([A-Z]{0,4}\s?\d{1,3}\s?\/\s?\d{1,3}|[A-Z]{1,5}\s?\d{1,3})/i);

  if ($("searchName") && !$("searchName").value && lines[0]) {
    const cleaned = lines[0]
      .replace(/[^\p{L}\p{N}\s.'-]/gu, "")
      .trim();

    $("searchName").value = cleaned;
  }

  if ($("searchNumber") && !$("searchNumber").value && numberMatch) {
    $("searchNumber").value = numberMatch[1].replace(/\s+/g, "");
  }
}

// =============================================================
// BUSCA INTELIGENTE
// =============================================================

function parseCardSearch(rawName, rawNumber, rawSet) {
  const combined = [rawName, rawNumber, rawSet]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  let name = String(rawName || "").trim();
  let number = String(rawNumber || "").trim();
  let setHint = String(rawSet || "").trim();
  let printedTotal = "";

  const fullPattern = combined.match(/(\d{1,4})\s*\/\s*(\d{1,4})/);

  if (fullPattern) {
    if (!number) number = fullPattern[1];
    printedTotal = fullPattern[2];
    if (!setHint) setHint = fullPattern[2];
  }

  if (!number) {
    const looseNumber = combined.match(/\b(\d{1,4})\b/);

    if (looseNumber) {
      number = looseNumber[1];
    }
  }

  if (!setHint && printedTotal) {
    setHint = printedTotal;
  }

  // Se o usuário colocou tudo no campo nome, limpa o nome.
  if (name) {
    name = name.replace(/(\d{1,4})\s*\/\s*(\d{1,4})/g, " ");
    name = name.replace(/\b\d{1,4}\b/g, function (match) {
      if (match === number || match === printedTotal || match === setHint) {
        return " ";
      }

      return match;
    });
    name = name.replace(/\s+/g, " ").trim();
  }

  // Se o nome ficou vazio, tenta pegar a primeira palavra textual do combinado.
  if (!name) {
    const textOnly = combined
      .replace(/(\d{1,4})\s*\/\s*(\d{1,4})/g, " ")
      .replace(/\b\d{1,4}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    name = textOnly;
  }

  return {
    raw: combined,
    name: name,
    number: normalizeNumber(number),
    printedTotal: normalizeNumber(printedTotal),
    setHint: String(setHint || "").trim(),
    normalizedName: normalizeText(name)
  };
}

async function searchCards() {
  const rawName = $("searchName") ? $("searchName").value.trim() : "";
  const rawNumber = $("searchNumber") ? $("searchNumber").value.trim() : "";
  const rawSet = $("searchSet") ? $("searchSet").value.trim() : "";
  const lang = $("searchLanguage") ? $("searchLanguage").value : "all";

  const parsed = parseCardSearch(rawName, rawNumber, rawSet);

  if (!parsed.name && !parsed.number) {
    toast("Digite o nome ou o número/código da carta.");
    return;
  }

  if ($("searchStatus")) {
    $("searchStatus").textContent = "Buscando cartas...";
  }

  if ($("resultsList")) {
    $("resultsList").innerHTML = "";
  }

  try {
    const languages = lang === "all" ? ["pt-br", "en", "ja"] : [lang];
    let results = [];

    // 1) Busca principal: nome + número.
    for (const language of languages) {
      const found = await searchTCGdexSmart(language, parsed);
      results = results.concat(found);
    }

    // 2) Se a busca veio em "Todos", reforça português por número.
    if (lang === "all" && parsed.number) {
      const ptByNumber = await searchTCGdexSmart("pt-br", {
        name: "",
        number: parsed.number,
        printedTotal: parsed.printedTotal,
        setHint: parsed.setHint,
        normalizedName: ""
      });

      results = results.concat(ptByNumber);
    }

    // 3) Fallback Pokémon TCG API só se fizer sentido.
    if (results.length < 3 && parsed.name) {
      const fallback = await searchPokemonTCG(parsed);
      results = results.concat(fallback);
    }

    const unique = dedupeResults(results);
    const relevant = filterRelevantResults(unique, parsed);
    const sorted = sortSearchResults(relevant, parsed);
    const finalResults = sorted.slice(0, 30);

    renderSearchResults(finalResults);

    if ($("searchStatus")) {
      $("searchStatus").textContent = finalResults.length
        ? finalResults.length + " resultado(s) encontrados."
        : "Não encontrei essa carta. Tente só o nome + número, exemplo: Omanyte 180/151.";
    }

  } catch (err) {
    console.error("Erro ao buscar cartas:", err);

    if ($("searchStatus")) {
      $("searchStatus").textContent = "Erro ao buscar cartas.";
    }

    toast("Erro ao buscar cartas.");
  }
}

async function searchTCGdexSmart(language, parsed) {
  const attempts = [];

  const name = String(parsed.name || "").trim();
  const number = normalizeNumber(parsed.number || "");

  if (name && number) {
    attempts.push({
      name: name,
      localId: number
    });
  }

  if (number) {
    attempts.push({
      localId: number
    });
  }

  if (name) {
    attempts.push({
      name: name
    });
  }

  if (name && firstWord(name) && firstWord(name) !== name) {
    attempts.push({
      name: firstWord(name),
      localId: number
    });

    attempts.push({
      name: firstWord(name)
    });
  }

  const all = [];

  for (const attempt of attempts) {
    const found = await searchTCGdexAttempt(language, attempt);
    all.push.apply(all, found);
  }

  return all;
}

async function searchTCGdexAttempt(language, attempt) {
  const params = new URLSearchParams();

  if (attempt.name) {
    params.set("name", attempt.name);
  }

  if (attempt.localId) {
    params.set("localId", attempt.localId);
  }

  params.set("pagination:itemsPerPage", "40");

  const url = TCGDEX_BASE + "/" + language + "/cards?" + params.toString();

  let brief = [];

  try {
    brief = await fetch(url).then(function (r) {
      return r.ok ? r.json() : [];
    });
  } catch (err) {
    console.warn("Falha TCGdex", language, attempt, err);
    brief = [];
  }

  const limited = Array.isArray(brief) ? brief.slice(0, 18) : [];

  const detailed = await Promise.all(limited.map(async function (card) {
    try {
      const full = await fetch(TCGDEX_BASE + "/" + language + "/cards/" + card.id).then(function (r) {
        return r.ok ? r.json() : card;
      });

      return mapTCGdexCard(full, language);

    } catch (e) {
      return mapTCGdexCard(card, language);
    }
  }));

  return detailed;
}

function mapTCGdexCard(card, language) {
  const setObj = card.set || {};

  return {
    source: "TCGdex",
    apiId: card.id || "",
    name: card.name || "Sem nome",
    languageCode: language,
    language: LANGUAGE_LABEL[language] || language,
    number: card.localId || "",
    setName: setObj.name || setObj.id || "",
    setId: setObj.id || "",
    setCardCountOfficial: setObj.cardCount && setObj.cardCount.official ? setObj.cardCount.official : "",
    setCardCountTotal: setObj.cardCount && setObj.cardCount.total ? setObj.cardCount.total : "",
    rarity: card.rarity || "",
    type: card.category || "",
    imageUrl: card.image || "",
    raw: card
  };
}

async function searchPokemonTCG(parsed) {
  const clauses = [];

  if (parsed.name) {
    clauses.push("name:*" + parsed.name.replace(/\s+/g, "*") + "*");
  }

  if (parsed.number) {
    clauses.push("number:" + parsed.number);
  }

  if (parsed.setHint && normalizeText(parsed.setHint).includes("151")) {
    clauses.push("set.name:*151*");
  }

  const q = clauses.join(" ");
  const url = POKEMON_TCG_BASE + "?q=" + encodeURIComponent(q) + "&pageSize=20";

  const data = await fetch(url).then(function (r) {
    return r.ok ? r.json() : { data: [] };
  });

  return (data.data || []).map(function (card) {
    return {
      source: "Pokémon TCG API",
      apiId: card.id || "",
      name: card.name || "Sem nome",
      languageCode: "en",
      language: "Inglês",
      number: card.number || "",
      setName: card.set && card.set.name ? card.set.name : "",
      setId: card.set && card.set.id ? card.set.id : "",
      setCardCountOfficial: card.set && card.set.printedTotal ? card.set.printedTotal : "",
      setCardCountTotal: card.set && card.set.total ? card.set.total : "",
      rarity: card.rarity || "",
      type: card.supertype || "",
      imageUrl: card.images && card.images.large ? card.images.large : card.images && card.images.small ? card.images.small : "",
      priceSourceSuggested: "Liga Pokémon",
      suggestedPrices: {
        currency: "BRL",
        min: 0,
        avg: 0,
        max: 0
      },
      raw: card
    };
  });
}

function dedupeResults(results) {
  const seen = new Set();

  return results.filter(function (card) {
    const key = [
      card.source,
      card.apiId,
      card.languageCode,
      card.name,
      card.number,
      card.setName
    ].join("-");

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

function filterRelevantResults(results, parsed) {
  if (!results.length) return [];

  const hasName = !!parsed.normalizedName;
  const hasNumber = !!parsed.number;

  // Se digitou nome e número, primeiro tenta nome + número juntos.
  if (hasName && hasNumber) {
    const strict = results.filter(function (card) {
      return isNameMatch(card, parsed) && isNumberMatch(card, parsed);
    });

    if (strict.length) {
      return filterBySetIfPossible(strict, parsed);
    }
  }

  // Se digitou nome, não deixa aparecer outro Pokémon aleatório.
  if (hasName) {
    const byName = results.filter(function (card) {
      return isNameMatch(card, parsed);
    });

    if (byName.length) {
      return filterBySetIfPossible(byName, parsed);
    }
  }

  // Se digitou só número, permite resultados por número.
  if (!hasName && hasNumber) {
    const byNumber = results.filter(function (card) {
      return isNumberMatch(card, parsed);
    });

    if (byNumber.length) {
      return filterBySetIfPossible(byNumber, parsed);
    }
  }

  // Último recurso: retorna pouco, ordenado depois.
  return results.slice(0, 12);
}

function filterBySetIfPossible(results, parsed) {
  if (!parsed.setHint && !parsed.printedTotal) {
    return results;
  }

  const setFiltered = results.filter(function (card) {
    return isSetMatch(card, parsed);
  });

  return setFiltered.length ? setFiltered : results;
}

function isNameMatch(card, parsed) {
  if (!parsed.normalizedName) return true;

  const cardName = normalizeText(card.name);

  if (!cardName) return false;

  return cardName === parsed.normalizedName ||
    cardName.includes(parsed.normalizedName) ||
    parsed.normalizedName.includes(cardName);
}

function isNumberMatch(card, parsed) {
  if (!parsed.number) return true;

  const cardNumber = normalizeNumber(card.number);

  return cardNumber === parsed.number;
}

function isSetMatch(card, parsed) {
  const hint = normalizeText(parsed.setHint || parsed.printedTotal || "");

  if (!hint) return true;

  const setName = normalizeText(card.setName);
  const setId = normalizeText(card.setId);
  const official = normalizeNumber(card.setCardCountOfficial);
  const total = normalizeNumber(card.setCardCountTotal);
  const printedTotal = normalizeNumber(parsed.printedTotal);

  if (setName.includes(hint)) return true;
  if (setId.includes(hint)) return true;

  if (printedTotal && official && official === printedTotal) return true;
  if (printedTotal && total && total === printedTotal) return true;

  if (hint === "151" && (setName.includes("151") || setId.includes("151"))) return true;

  return false;
}

function sortSearchResults(results, parsed) {
  return results.sort(function (a, b) {
    return scoreCard(b, parsed) - scoreCard(a, parsed);
  });
}

function scoreCard(card, parsed) {
  let score = 0;

  if (card.languageCode === "pt-br") score += 200;
  if (card.languageCode === "en") score += 80;
  if (card.languageCode === "ja") score += 50;

  if (isNameMatch(card, parsed)) score += 120;
  if (isNumberMatch(card, parsed)) score += 150;
  if (isSetMatch(card, parsed)) score += 80;

  if (card.imageUrl) score += 10;
  if (card.setName) score += 5;
  if (card.rarity) score += 5;

  return score;
}

function renderSearchResults(results) {
  const list = $("resultsList");

  if (!list) return;

  list.innerHTML = "";

  if (!results.length) return;

  results.forEach(function (card) {
    const el = document.createElement("article");
    el.className = "result-card";

    let imgSrc = "";

    if (card.imageUrl) {
      imgSrc = card.imageUrl.includes("tcgdex") ? card.imageUrl + "/high.webp" : card.imageUrl;
    }

    el.innerHTML =
      '<img src="' + safeText(imgSrc) + '" alt="' + safeText(card.name) + '" loading="lazy">' +
      '<div class="result-info">' +
        '<h3>' + safeText(card.name) + '</h3>' +
        '<p>' +
          'Coleção: ' + safeText(card.setName || "-") + '<br>' +
          'Número: ' + safeText(card.number || "-") + ' • Idioma: ' + safeText(card.language) + '<br>' +
          'Raridade: ' + safeText(card.rarity || "-") + '<br>' +
          'Identificação: ' + safeText(card.source) +
        '</p>' +
      '</div>' +
      '<button type="button" class="primary-btn choose-card-btn">Escolher</button>';

    const button = el.querySelector("button");

    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openPriceDialog(card);
    });

    list.appendChild(el);
  });
}

// =============================================================
// PREÇO E SALVAR
// =============================================================

function openPriceDialog(card) {
  selectedCard = card;

  if ($("selectedTitle")) {
    $("selectedTitle").textContent = card.name;
  }

  let imgSrc = "";

  if (card.imageUrl) {
    imgSrc = card.imageUrl.includes("tcgdex") ? card.imageUrl + "/high.webp" : card.imageUrl;
  }

  if ($("selectedPreview")) {
    $("selectedPreview").innerHTML =
      '<img src="' + safeText(imgSrc) + '" alt="' + safeText(card.name) + '">' +
      '<div>' +
        '<h3>' + safeText(card.name) + '</h3>' +
        '<p class="card-meta">' +
          safeText(card.setName || "-") + '<br>' +
          safeText(card.number || "-") + ' • ' + safeText(card.language) + '<br>' +
          safeText(card.rarity || "-") +
        '</p>' +
      '</div>';
  }

  if ($("priceSource")) $("priceSource").value = "Liga Pokémon";
  if ($("priceCurrency")) $("priceCurrency").value = "BRL";
  if ($("priceMin")) $("priceMin").value = "";
  if ($("priceAvg")) $("priceAvg").value = "";
  if ($("priceMax")) $("priceMax").value = "";
  if ($("priceLink")) $("priceLink").value = "";

  const ligaUrl = buildLigaSearchUrl(card);

  if ($("ligaSearchLink")) {
    $("ligaSearchLink").href = ligaUrl;
  }

  if ($("priceLink")) {
    $("priceLink").placeholder = ligaUrl;
  }

  openModal("priceDialog");
}

async function saveSelectedCard(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!selectedCard) {
    toast("Nenhuma carta selecionada.");
    return;
  }

  const now = new Date().toISOString();
  const ligaUrl = $("ligaSearchLink") ? $("ligaSearchLink").href : "";

  let imageUrl = selectedCard.imageUrl || "";
  imageUrl = imageUrl.replace(/\/high\.webp$/g, "").replace(/\.webp$/g, "");

  const card = {
    internalId: "card_" + Date.now(),
    apiId: selectedCard.apiId || "",
    name: selectedCard.name || "",
    languageCode: selectedCard.languageCode || "",
    language: selectedCard.language || "",
    setName: selectedCard.setName || "",
    setId: selectedCard.setId || "",
    number: selectedCard.number || "",
    rarity: selectedCard.rarity || "",
    type: selectedCard.type || "",
    imageUrl: imageUrl,
    quantity: Number($("cardQuantity") ? $("cardQuantity").value || 1 : 1),
    condition: $("cardCondition") ? $("cardCondition").value : "",
    finish: $("cardFinish") ? $("cardFinish").value : "",
    priceMin: Number($("priceMin") ? $("priceMin").value || 0 : 0),
    priceAvg: Number($("priceAvg") ? $("priceAvg").value || 0 : 0),
    priceMax: Number($("priceMax") ? $("priceMax").value || 0 : 0),
    currency: "BRL",
    priceSource: $("priceSource") ? $("priceSource").value || "Liga Pokémon" : "Liga Pokémon",
    priceLink: $("priceLink") && $("priceLink").value ? $("priceLink").value : ligaUrl,
    priceDate: now,
    createdAt: now,
    notes: $("cardNotes") ? $("cardNotes").value : "",
    ocrText: $("ocrText") ? $("ocrText").value : "",
    verificationStatus: "Confirmada manualmente"
  };

  try {
    toast("Salvando carta...");

    await apiSaveCard(card);

    closeModal("priceDialog");
    closeModal("addDialog");

    await apiGetCards(false);

    toast("Carta salva no fichário!");

  } catch (err) {
    console.error("Erro ao salvar carta:", err);
    toast("Erro ao salvar. Verifique o Apps Script.");
  }
}

async function deleteCardById(internalId) {
  const card = collection.find(function (item) {
    return String(item.internalId || item.idInterno || "") === String(internalId);
  });

  const name = card ? card.name || card.nome || "essa carta" : "essa carta";

  const confirmDelete = confirm("Tem certeza que deseja apagar " + name + " do fichário?");

  if (!confirmDelete) return;

  const backupCollection = collection.slice();

  collection = collection.filter(function (item) {
    return String(item.internalId || item.idInterno || "") !== String(internalId);
  });

  applyFilters();
  toast("Carta removida da tela.");

  try {
    await apiDeleteCard(internalId);

    toast("Carta apagada.");

    apiGetCards(false);

  } catch (err) {
    console.error("Erro ao apagar carta:", err);

    collection = backupCollection;
    applyFilters();

    toast("Erro ao apagar. A carta foi restaurada.");
  }
}

function clearSearch() {
  const fields = ["searchName", "searchNumber", "searchSet", "ocrText"];

  fields.forEach(function (id) {
    if ($(id)) $(id).value = "";
  });

  if ($("resultsList")) $("resultsList").innerHTML = "";
  if ($("searchStatus")) $("searchStatus").textContent = "";
  if ($("ocrStatus")) $("ocrStatus").textContent = "OCR opcional. Se falhar, digite nome e número manualmente.";
}

// =============================================================
// EVENTOS
// =============================================================

function initEvents() {
  if (appReady) return;
  appReady = true;

  document.addEventListener("click", function (event) {
    const btn = event.target && event.target.closest
      ? event.target.closest("button, a")
      : null;

    if (!btn) return;

    const id = btn.id || "";
    const text = String(btn.textContent || "").trim().toLowerCase();

    if (id === "btnOpenAdd" || text.includes("adicionar carta")) {
      event.preventDefault();
      openModal("addDialog");
      return;
    }

    if (id === "btnRunOCR" || text.includes("ler imagem") || text.includes("ocr")) {
      event.preventDefault();
      runOCR();
      return;
    }

    if (id === "btnSearchCards" || text.includes("buscar carta") || text.includes("buscar cartas")) {
      event.preventDefault();
      searchCards();
      return;
    }

    if (id === "btnClearSearch" || text.includes("limpar")) {
      event.preventDefault();
      clearSearch();
      return;
    }

    if (id === "btnSaveCard" || text.includes("salvar no fichário") || text.includes("salvar no fichario")) {
      event.preventDefault();
      saveSelectedCard(event);
      return;
    }

    if (id === "btnRefresh" || text.includes("atualizar")) {
      event.preventDefault();
      apiGetCards(true);
      return;
    }

    if (id === "prevPage") {
      event.preventDefault();
      currentPage--;
      if (currentPage < 1) currentPage = 1;
      renderBinder();
      return;
    }

    if (id === "nextPage") {
      event.preventDefault();
      const totalPages = Math.max(1, Math.ceil(filteredCollection.length / PAGE_SIZE));
      currentPage++;
      if (currentPage > totalPages) currentPage = totalPages;
      renderBinder();
      return;
    }

    if (btn.classList && btn.classList.contains("delete-card-btn")) {
      event.preventDefault();
      event.stopPropagation();

      const internalId = btn.getAttribute("data-card-id");

      if (!internalId) {
        toast("Não encontrei o ID da carta.");
        return;
      }

      deleteCardById(internalId);
      return;
    }
  }, true);

  if ($("filterText")) {
    $("filterText").addEventListener("input", applyFilters);
  }

  if ($("filterLanguage")) {
    $("filterLanguage").addEventListener("change", applyFilters);
  }

  ["btnOpenAdd", "btnRunOCR", "btnSearchCards", "btnClearSearch", "btnSaveCard", "btnRefresh", "prevPage", "nextPage"].forEach(function (id) {
    const el = $(id);

    if (el && el.tagName && el.tagName.toLowerCase() === "button") {
      el.setAttribute("type", "button");
    }
  });

  if ($("priceCurrency")) {
    $("priceCurrency").value = "BRL";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  initEvents();
  apiGetCards(true);
});
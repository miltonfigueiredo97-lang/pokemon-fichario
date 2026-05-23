// =============================================================
// POKÉMON FICHÁRIO - CODE.GS COMPLETO CORRIGIDO
// Com função de apagar carta
// =============================================================

const SHEET_NAME = "Cartas";

const HEADERS = [
  "ID Interno",
  "ID API",
  "Nome",
  "Idioma",
  "Código Idioma",
  "Coleção",
  "ID Coleção",
  "Número",
  "Raridade",
  "Tipo",
  "Imagem URL",
  "Quantidade",
  "Condição",
  "Acabamento",
  "Preço Mínimo",
  "Preço Médio",
  "Preço Máximo",
  "Moeda",
  "Fonte Preço",
  "Link Fonte",
  "Data Preço",
  "Data Cadastro",
  "Observações",
  "Texto OCR",
  "Status Verificação"
];

function doGet(e) {
  try {
    setupSheets_();

    const action = e.parameter.action || "";
    const callback = e.parameter.callback || "";

    let response;

    if (action === "ping") {
      response = {
        ok: true,
        message: "Apps Script conectado com sucesso.",
        date: new Date().toISOString()
      };

      return output_(response, callback);
    }

    if (action === "saveCard") {
      const payload = JSON.parse(e.parameter.payload || "{}");
      response = saveCard_(payload);

      return output_(response, callback);
    }

    if (action === "deleteCard") {
      const internalId = e.parameter.internalId || "";
      response = deleteCard_(internalId);

      return output_(response, callback);
    }

    if (action === "getCards" || action === "listCards") {
      response = {
        ok: true,
        cards: listCards_()
      };

      return output_(response, callback);
    }

    response = {
      ok: false,
      error: "Ação inválida.",
      action: action
    };

    return output_(response, callback);

  } catch (err) {
    const callback = e && e.parameter ? e.parameter.callback || "" : "";

    return output_({
      ok: false,
      error: String(err),
      stack: err && err.stack ? err.stack : ""
    }, callback);
  }
}

function doPost(e) {
  try {
    setupSheets_();

    const body = e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents)
      : {};

    const action = body.action || "";

    if (action === "saveCard") {
      return output_(saveCard_(body.card || {}), "");
    }

    if (action === "deleteCard") {
      return output_(deleteCard_(body.internalId || ""), "");
    }

    if (action === "getCards" || action === "listCards") {
      return output_({
        ok: true,
        cards: listCards_()
      }, "");
    }

    return output_({
      ok: false,
      error: "Ação POST inválida.",
      action: action
    }, "");

  } catch (err) {
    return output_({
      ok: false,
      error: String(err),
      stack: err && err.stack ? err.stack : ""
    }, "");
  }
}

function setupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
}

function saveCard_(card) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  const idInterno = card.internalId || card.idInterno || "card_" + new Date().getTime();

  const imageUrl = cleanImageUrl_(card.imageUrl || card.imagemUrl || "");

  const row = [
    idInterno,
    card.apiId || card.idApi || "",
    card.name || card.nome || "",
    card.language || card.idioma || "",
    card.languageCode || card.codigoIdioma || "",
    card.setName || card.colecao || "",
    card.setId || card.idColecao || "",
    card.number || card.numero || "",
    card.rarity || card.raridade || "",
    card.type || card.tipo || "",
    imageUrl,
    numberOrBlank_(card.quantity || card.quantidade || 1),
    card.condition || card.condicao || "",
    card.finish || card.acabamento || "",
    numberOrBlank_(card.priceMin || card.precoMinimo || ""),
    numberOrBlank_(card.priceAvg || card.precoMedio || ""),
    numberOrBlank_(card.priceMax || card.precoMaximo || ""),
    "BRL",
    card.priceSource || card.fontePreco || "Liga Pokémon",
    card.priceLink || card.linkFonte || "",
    card.priceDate || card.dataPreco || "",
    card.createdAt || card.dataCadastro || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss"),
    card.notes || card.observacoes || "",
    card.ocrText || card.textoOcr || "",
    card.verificationStatus || card.statusVerificacao || "Confirmada manualmente"
  ];

  sheet.appendRow(row);

  return {
    ok: true,
    message: "Carta salva com sucesso.",
    idInterno: idInterno
  };
}

function deleteCard_(internalId) {
  if (!internalId) {
    return {
      ok: false,
      error: "ID da carta não informado."
    };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      ok: false,
      error: "Não há cartas para apagar."
    };
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = ids.length - 1; i >= 0; i--) {
    const rowId = String(ids[i][0] || "");

    if (rowId === String(internalId)) {
      const sheetRow = i + 2;
      sheet.deleteRow(sheetRow);

      return {
        ok: true,
        message: "Carta apagada com sucesso.",
        idInterno: internalId
      };
    }
  }

  return {
    ok: false,
    error: "Carta não encontrada na planilha.",
    idInterno: internalId
  };
}

function listCards_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return [];
  }

  const rows = data.slice(1);

  return rows
    .filter(function (row) {
      return row.join("").trim() !== "";
    })
    .map(function (row) {
      return rowToCard_(row);
    });
}

function rowToCard_(row) {
  const card = {
    internalId: row[0] || "",
    apiId: row[1] || "",
    name: row[2] || "",
    language: row[3] || "",
    languageCode: row[4] || "",
    setName: row[5] || "",
    setId: row[6] || "",
    number: row[7] || "",
    rarity: row[8] || "",
    type: row[9] || "",
    imageUrl: cleanImageUrl_(row[10] || ""),
    quantity: numberOrDefault_(row[11], 1),
    condition: row[12] || "",
    finish: row[13] || "",
    priceMin: numberOrDefault_(row[14], 0),
    priceAvg: numberOrDefault_(row[15], 0),
    priceMax: numberOrDefault_(row[16], 0),
    currency: row[17] || "BRL",
    priceSource: row[18] || "Liga Pokémon",
    priceLink: row[19] || "",
    priceDate: row[20] || "",
    createdAt: row[21] || "",
    notes: row[22] || "",
    ocrText: row[23] || "",
    verificationStatus: row[24] || ""
  };

  if (card.priceSource === "BRL") {
    card.priceSource = "Liga Pokémon";
  }

  if (!card.currency || card.currency === "Liga Pokémon") {
    card.currency = "BRL";
  }

  if (!card.quantity || isNaN(Number(card.quantity))) {
    card.quantity = 1;
  }

  if (isNaN(Number(card.priceMin))) {
    card.priceMin = 0;
  }

  if (isNaN(Number(card.priceAvg))) {
    card.priceAvg = 0;
  }

  if (isNaN(Number(card.priceMax))) {
    card.priceMax = 0;
  }

  return card;
}

function cleanImageUrl_(url) {
  url = String(url || "").trim();

  if (!url) return "";

  if (url.indexOf("://") === 1) {
    url = "http" + url;
  }

  if (url.startsWith("//")) {
    url = "https:" + url;
  }

  url = url.replace(/\/high\.webp\/high\.webp$/g, "/high.webp");

  return url;
}

function numberOrBlank_(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }

  const text = String(value).replace(",", ".").trim();
  const n = Number(text);

  if (isNaN(n)) {
    return "";
  }

  return n;
}

function numberOrDefault_(value, defaultValue) {
  if (value === "" || value === null || value === undefined) {
    return defaultValue;
  }

  const text = String(value).replace(",", ".").trim();
  const n = Number(text);

  if (isNaN(n)) {
    return defaultValue;
  }

  return n;
}

function output_(obj, callback) {
  const json = JSON.stringify(obj);

  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
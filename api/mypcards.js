function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numberParts(value) {
  const text = String(value || '');
  const match = text.match(/(?:^|[^0-9])(\d{1,4})\s*\/\s*(\d{1,4})(?:[^0-9]|$)/);
  if (match) return { numerator: String(Number(match[1])), denominator: String(Number(match[2])), full: `${Number(match[1])}/${Number(match[2])}` };
  const single = text.match(/(?:^|[^0-9])(\d{1,4})(?:[^0-9]|$)/);
  return single ? { numerator: String(Number(single[1])), denominator: '', full: String(Number(single[1])) } : { numerator: '', denominator: '', full: '' };
}

function productNumber(product) {
  const labels = Array.isArray(product.deck_labels) ? product.deck_labels : [];
  const haystacks = [...labels, product.card_code, product.link].filter(Boolean);
  for (const text of haystacks) {
    const parts = numberParts(text);
    if (parts.numerator && parts.denominator) return parts;
  }
  for (const text of haystacks) {
    const parts = numberParts(text);
    if (parts.numerator) return parts;
  }
  return { numerator: '', denominator: '', full: '' };
}

function scoreProduct(product, wanted) {
  let score = 0;
  const pt = normalize(product.name_pt);
  const en = normalize(product.name_en);
  const wantedName = normalize(wanted.name);
  const editionPt = normalize(product.edition_pt);
  const editionEn = normalize(product.edition_en);
  const editionCode = normalize(product.edition_code);
  const wantedSet = normalize(wanted.set);
  const foundNumber = productNumber(product);

  if (wantedName) {
    if (pt === wantedName || en === wantedName) score += 500;
    else if (pt.includes(wantedName) || en.includes(wantedName) || wantedName.includes(pt) || wantedName.includes(en)) score += 220;
  }

  const wantedParts = numberParts(wanted.number);
  if (wantedParts.numerator) {
    if (foundNumber.numerator === wantedParts.numerator) score += 500;
    else score -= 260;
    if (wantedParts.denominator && foundNumber.denominator === wantedParts.denominator) score += 240;
  }

  if (wantedSet) {
    if (editionPt.includes(wantedSet) || editionEn.includes(wantedSet) || editionCode === wantedSet || editionCode.includes(wantedSet)) score += 260;
  }

  if (product.img_pt) score += 90;
  if (product.min_price) score += 35;
  if (product.avg_price) score += 35;
  if (product.available_quantity > 0) score += 25;
  return score;
}

function normalizeProduct(product) {
  const num = productNumber(product);
  const labels = Array.isArray(product.deck_labels) ? product.deck_labels : [];
  const rawLanguage = product.language || product.lang || product.idioma || product.language_code || '';
  const editionCode = product.edition_code || '';
  const jpHay = [rawLanguage, product.edition_pt, product.edition_en, editionCode, product.card_code, ...labels].filter(Boolean).join(' ');
  const explicitJapanese = /japon(?:e|ê|e?s)|japanese|japao|japan|\bjp\b/i.test(jpHay);
  const japaneseSetCode = /^(?:sv|s|sm|xy|bw)\d+[a-z](?:[-_].*)?$/i.test(String(editionCode).trim()) && !/pt\d/i.test(String(editionCode));
  const isJapanese = !!(explicitJapanese || japaneseSetCode);
  const imageJa = product.img_jp || product.img_ja || product.image_jp || product.image_ja || (isJapanese ? (product.img_en || product.img_pt || '') : '');
  return {
    internalCode: product.internal_code ?? null,
    cardCode: product.card_code || '',
    tcgProductId: product.tcg_productId ?? null,
    namePt: product.name_pt || '',
    nameEn: product.name_en || '',
    editionPt: product.edition_pt || '',
    editionEn: product.edition_en || '',
    editionCode,
    rawLanguage,
    isJapanese,
    imageJa,
    number: num.full,
    numerator: num.numerator,
    denominator: num.denominator,
    minPrice: product.min_price == null ? null : Number(product.min_price),
    avgPrice: product.avg_price == null ? null : Number(product.avg_price),
    maxPrice: product.max_price == null ? null : Number(product.max_price),
    tcgPrice: product.tcg_price == null ? null : Number(product.tcg_price),
    availableQuantity: product.available_quantity ?? null,
    imagePt: product.img_pt || '',
    imageEn: product.img_en || '',
    link: product.link || '',
    deckLabels: Array.isArray(product.deck_labels) ? product.deck_labels : []
  };
}

async function requestMyp(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'PokemonBinderBR/2.0'
  };
  if (process.env.MYPCARDS_API_TOKEN) headers['X-Api-Token'] = process.env.MYPCARDS_API_TOKEN;

  try {
    const response = await fetch(`https://mypcards.com/api/v1${path}`, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { response, data, text };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const name = String(req.query.name || '').trim();
  const number = String(req.query.number || '').trim();
  const set = String(req.query.set || '').trim();

  if (!name) {
    res.status(400).json({ ok: false, error: 'name_required' });
    return;
  }

  try {
    const { response, data } = await requestMyp(`/pokemon/carta/${encodeURIComponent(name)}`);

    if (response.status === 401 || response.status === 403) {
      res.status(200).json({
        ok: false,
        needsToken: true,
        upstreamStatus: response.status,
        message: 'A API do MYP Cards exige X-Api-Token para esta consulta.'
      });
      return;
    }

    if (!response.ok) {
      res.status(200).json({
        ok: false,
        upstreamStatus: response.status,
        message: 'MYP Cards indisponível para esta consulta.'
      });
      return;
    }

    const cards = Array.isArray(data?.cards) ? data.cards : Array.isArray(data) ? data : [];
    const wanted = { name, number, set };
    const wantedParts = numberParts(number);
    const exactCards = wantedParts.numerator
      ? cards.filter(product => {
          const found=productNumber(product);
          if(found.numerator!==wantedParts.numerator)return false;
          if(wantedParts.denominator&&found.denominator!==wantedParts.denominator)return false;
          return true;
        })
      : cards;
    const ranked = exactCards
      .map(product => ({ product, score: scoreProduct(product, wanted) }))
      .sort((a, b) => b.score - a.score)
      .map(({ product, score }) => ({ ...normalizeProduct(product), matchScore: score }));

    res.status(200).json({
      ok: true,
      source: 'MYP Cards',
      query: wanted,
      count: ranked.length,
      cards: ranked.slice(0, 30)
    });
  } catch (error) {
    res.status(200).json({
      ok: false,
      error: error?.name === 'AbortError' ? 'timeout' : 'upstream_error',
      message: 'Não foi possível consultar o mercado brasileiro agora.'
    });
  }
};

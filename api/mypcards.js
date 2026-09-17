const API_ROOT = 'https://mypcards.com/api/v1';
const DOCS_URL = 'https://mypcards.github.io/mypcards-api/';
const CONTACT_URL = 'https://mypcards.com/contato';

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
    if (pt === wantedName || en === wantedName) score += 700;
    else if (pt.includes(wantedName) || en.includes(wantedName) || wantedName.includes(pt) || wantedName.includes(en)) score += 260;
    else score -= 300;
  }

  const wantedParts = numberParts(wanted.number);
  if (wantedParts.numerator) {
    if (foundNumber.numerator === wantedParts.numerator) score += 700;
    else score -= 500;
    if (wantedParts.denominator && foundNumber.denominator === wantedParts.denominator) score += 320;
  }

  if (wantedSet) {
    if (editionPt.includes(wantedSet) || editionEn.includes(wantedSet) || editionCode === wantedSet || editionCode.includes(wantedSet)) score += 320;
  }

  if (product.img_pt) score += 100;
  if (product.min_price != null) score += 40;
  if (product.avg_price != null) score += 40;
  if (Number(product.available_quantity || 0) > 0) score += 30;
  return score;
}

function normalizeProduct(product) {
  const num = productNumber(product);
  return {
    internalCode: product.internal_code ?? null,
    cardCode: product.card_code || '',
    tcgProductId: product.tcg_productId ?? null,
    namePt: product.name_pt || '',
    nameEn: product.name_en || '',
    editionPt: product.edition_pt || '',
    editionEn: product.edition_en || '',
    editionCode: product.edition_code || '',
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

function nameVariants(name) {
  const value = String(name || '').trim();
  const out = new Set([value]);
  if (!value) return [];

  out.add(value.replace(/\s*-\s*/g, '-'));
  out.add(value.replace(/-/g, ' '));
  out.add(value.replace(/\s+(EX|GX)$/i, '-$1'));
  out.add(value.replace(/-(EX|GX)$/i, ' $1'));
  out.add(value.replace(/\s+(VMAX|VSTAR|V-?ASTRO)$/i, ' $1'));

  return [...out].filter(Boolean);
}

async function requestMyp(path, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PokemonBinderBR/3.0',
        'X-Api-Token': token
      },
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

function tokenRequired(res, upstreamStatus = null) {
  res.status(200).json({
    ok: false,
    needsToken: true,
    upstreamStatus,
    envName: 'MYPCARDS_API_TOKEN',
    docsUrl: DOCS_URL,
    contactUrl: CONTACT_URL,
    message: 'A API oficial do MYP Cards exige X-Api-Token. O token é emitido pelo suporte do MYP Cards.'
  });
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
  const token = String(process.env.MYPCARDS_API_TOKEN || '').trim();

  if (!name) {
    res.status(400).json({ ok: false, error: 'name_required' });
    return;
  }

  // According to the official MYP Cards Swagger, tokens are generated
  // internally by their support team. Do not fake/scrape a token.
  if (!token) {
    tokenRequired(res);
    return;
  }

  try {
    let cards = [];
    let lastStatus = null;

    for (const candidate of nameVariants(name)) {
      const { response, data } = await requestMyp(`/pokemon/carta/${encodeURIComponent(candidate)}`, token);
      lastStatus = response.status;

      if (response.status === 401 || response.status === 403) {
        tokenRequired(res, response.status);
        return;
      }
      if (!response.ok) continue;

      const found = Array.isArray(data?.cards) ? data.cards : Array.isArray(data) ? data : [];
      if (found.length) {
        cards = found;
        break;
      }
    }

    if (!cards.length) {
      res.status(200).json({
        ok: true,
        source: 'MYP Cards',
        query: { name, number, set },
        count: 0,
        cards: [],
        upstreamStatus: lastStatus
      });
      return;
    }

    const wanted = { name, number, set };
    const ranked = cards
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
      message: 'Não foi possível consultar a API do MYP Cards agora.',
      docsUrl: DOCS_URL
    });
  }
};

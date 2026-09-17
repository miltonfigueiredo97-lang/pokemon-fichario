const { URL } = require('url');

const ROOT = 'https://mypcards.com';
const CACHE = globalThis.__mypPublicCache || (globalThis.__mypPublicCache = new Map());

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalize(value).replace(/\s+/g, '-');
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(html) {
  return decodeHtml(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMoney(value) {
  const raw = String(value || '').replace(/R\$/gi, '').trim();
  if (!raw) return null;
  let normalized = raw.replace(/\s/g, '');
  if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function xmlLocs(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m => decodeHtml(m[1].trim()));
}

async function fetchText(url, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; PokemonBinderBR/12.0; +https://pokemon-fichario.vercel.app)'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function safeMypProductUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (!/(^|\.)mypcards\.com$/i.test(u.hostname)) return '';
    if (!/^\/pokemon\/produto\/\d+\//i.test(u.pathname)) return '';
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '';
  }
}

async function sitemapCandidates(name) {
  const key = `sitemap:${slugify(name)}`;
  const cached = CACHE.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const wantedSlug = slugify(name);
  const matches = [];
  let root;
  try { root = await fetchText(`${ROOT}/sitemap.xml`, 12000); } catch { return []; }
  const first = xmlLocs(root);

  const acceptProduct = url => {
    if (!/\/pokemon\/produto\/\d+\//i.test(url)) return;
    const slug = url.split('/').filter(Boolean).pop() || '';
    if (!wantedSlug || slug === wantedSlug || slug.includes(wantedSlug) || wantedSlug.includes(slug)) matches.push(url);
  };

  first.forEach(acceptProduct);
  if (!matches.length) {
    const childMaps = first.filter(x => /\.xml(?:\?|$)/i.test(x));
    const preferred = [
      ...childMaps.filter(x => /pokemon|produto|product|card/i.test(x)),
      ...childMaps.filter(x => !/pokemon|produto|product|card/i.test(x))
    ].slice(0, 18);
    for (const mapUrl of preferred) {
      try {
        const xml = await fetchText(mapUrl, 12000);
        xmlLocs(xml).forEach(acceptProduct);
        if (matches.length >= 18) break;
      } catch {}
    }
  }

  const unique = [...new Set(matches)].slice(0, 18);
  CACHE.set(key, { value: unique, expires: Date.now() + 6 * 60 * 60 * 1000 });
  return unique;
}

function pageIdentity(html) {
  const text = stripTags(html);
  const titleMatch = text.match(/(?:^|\n)\s*([^\n]{1,120}?)\s*\((\d{1,4}\s*\/\s*\d{1,4})\)\s*(?:\n|$)/m);
  const codeMatch = text.match(/Código\s+([^\n]+)/i);
  const editionMatch = text.match(/Edição\s+([^\n]+)/i);
  return {
    text,
    name: titleMatch ? titleMatch[1].trim() : '',
    number: titleMatch ? titleMatch[2].replace(/\s/g, '') : '',
    code: codeMatch ? codeMatch[1].trim() : '',
    edition: editionMatch ? editionMatch[1].trim() : ''
  };
}

function matchesWanted(identity, wanted) {
  const wn = normalize(wanted.name);
  const pn = normalize(identity.name);
  if (wn && pn && wn !== pn && !pn.includes(wn) && !wn.includes(pn)) return false;
  const wantedNumber = String(wanted.number || '').replace(/\s/g, '');
  if (wantedNumber && identity.number) {
    const [a] = wantedNumber.split('/');
    const [b] = identity.number.split('/');
    if (String(Number(a)) !== String(Number(b))) return false;
    if (wantedNumber.includes('/') && identity.number.includes('/')) {
      const [, ad] = wantedNumber.split('/');
      const [, bd] = identity.number.split('/');
      if (String(Number(ad)) !== String(Number(bd))) return false;
    }
  }
  const ws = normalize(wanted.set);
  if (ws) {
    const ed = normalize(identity.edition);
    const code = normalize(identity.code);
    if (ed && !ed.includes(ws) && !ws.includes(ed) && !code.includes(ws)) {
      // set is only a tie-breaker; number + name are stronger
    }
  }
  return true;
}

function extractMarket(identity) {
  const text = identity.text;
  let sellerText = text;
  const sellerStart = text.search(/Lojistas e Certificados|Demais vendedores/i);
  if (sellerStart >= 0) sellerText = text.slice(sellerStart);
  const other = sellerText.search(/Outras Edições/i);
  if (other >= 0) sellerText = sellerText.slice(0, other);

  const prices = [...sellerText.matchAll(/R\$\s*([0-9.]+(?:,[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi)]
    .map(m => parseMoney(m[1]))
    .filter(v => Number.isFinite(v) && v > 0 && v < 1000000);

  let usable = prices;
  if (!usable.length) {
    const fallbackBlock = text.split(/Outras Edições/i)[0] || text;
    usable = [...fallbackBlock.matchAll(/R\$\s*([0-9.]+(?:,[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi)]
      .map(m => parseMoney(m[1]))
      .filter(v => Number.isFinite(v) && v > 0 && v < 1000000);
  }

  const quantities = [...sellerText.matchAll(/(\d+)\s*un\./gi)].map(m => Number(m[1])).filter(Number.isFinite);
  const availableQuantity = quantities.reduce((a, b) => a + b, 0) || null;
  if (!usable.length) return { min: 0, avg: 0, max: 0, availableQuantity };

  usable.sort((a, b) => a - b);
  const min = usable[0];
  const max = usable[usable.length - 1];
  const avg = usable.reduce((a, b) => a + b, 0) / usable.length;
  return { min, avg, max, availableQuantity, samples: usable.length };
}

async function resolvePage({ name, number, set, link }) {
  const direct = safeMypProductUrl(link);
  const urls = direct ? [direct] : await sitemapCandidates(name);
  let best = null;

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const identity = pageIdentity(html);
      if (!matchesWanted(identity, { name, number, set })) continue;
      const market = extractMarket(identity);
      const score = (identity.number === String(number || '').replace(/\s/g, '') ? 500 : 0)
        + (normalize(identity.name) === normalize(name) ? 300 : 0)
        + (market.samples || 0);
      const candidate = { url, identity, market, score };
      if (!best || candidate.score > best.score) best = candidate;
      if (score >= 800) break;
    } catch {}
  }
  return best;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=21600');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const name = String(req.query.name || '').trim();
  const number = String(req.query.number || '').trim();
  const set = String(req.query.set || '').trim();
  const link = String(req.query.link || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'name_required' });

  const cacheKey = `market:${normalize(name)}|${number}|${normalize(set)}|${safeMypProductUrl(link)}`;
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expires > Date.now()) return res.status(200).json(cached.value);

  try {
    const found = await resolvePage({ name, number, set, link });
    if (!found) {
      const out = { ok: false, error: 'not_found', message: 'Carta não localizada no catálogo público da MYP.' };
      CACHE.set(cacheKey, { value: out, expires: Date.now() + 10 * 60 * 1000 });
      return res.status(200).json(out);
    }

    const out = {
      ok: true,
      source: 'MYP Cards',
      mode: 'public-page',
      name: found.identity.name || name,
      number: found.identity.number || number,
      edition: found.identity.edition || set,
      link: found.url,
      min: Number(found.market.min || 0),
      avg: Number(found.market.avg || 0),
      max: Number(found.market.max || 0),
      availableQuantity: found.market.availableQuantity,
      samples: found.market.samples || 0,
      checkedAt: new Date().toISOString()
    };
    CACHE.set(cacheKey, { value: out, expires: Date.now() + 30 * 60 * 1000 });
    return res.status(200).json(out);
  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error?.name === 'AbortError' ? 'timeout' : 'upstream_error',
      message: 'Não foi possível consultar a página pública da MYP agora.'
    });
  }
};

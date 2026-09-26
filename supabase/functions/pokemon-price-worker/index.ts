import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Pokémon price worker V17.
//
// Runs every 30 s (pg_cron job "pokemon-price-worker-v14") and whenever the
// frontend kicks it. Each run claims up to CLAIM_SIZE pending cards (the RPC
// keeps at most 8 in flight globally) and processes them in parallel.
//
// Per card:
//   1. Resolve the MYP product link: saved link -> canonical (151 PT-BR,
//      Generations) -> sibling card with the same set + number -> catalog
//      neighbours (see discoverCandidates).
//   2. Ask /api/price-engine to open that ONE product page in Chromium and read
//      the NM offers for the card's finish + language.
//   3. Save the quote, or requeue: a candidate id that is not the card moves on
//      to the next candidate; a blocked/timeout read is retried with backoff.
//      Only definitive answers become "no_quote".

const ENGINE = "https://pokemon-fichario.vercel.app/api/price-engine";
const TCGDEX = "https://api.tcgdex.net/v2";
const CLAIM_SIZE = 5;
const RUN_BUDGET_MS = 85 * 1000;
const ENGINE_TIMEOUT_MS = 58 * 1000;
const MAX_TRIED_IDS = 40;
// Predicted ids that 404 teach nothing; after this many, walk real pages.
const MAX_PREDICTED_TRIES = 6;
// App-only set ids (not on TCGdex) -> MYP set code.
const APP_SET_CODES: Record<string, string> = { cel25cc: "ccc" };
const MAX_ATTEMPTS = 10;
const RETRY_DELAYS_S = [20, 60, 180, 600];
// Shared secret for /api/price-engine, read once per run from the database
// (function pokemon_price_engine_secret, service_role only).
let ENGINE_KEY = "";
const PRODUCT_RE = /mypcards\.com\/pokemon\/produto\/(\d+)\//i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function num(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}
function hasPrice(m: any) {
  return !!(m && (num(m.min) || num(m.avg) || num(m.max)));
}
function productId(link: unknown) {
  const m = String(link || "").match(PRODUCT_RE);
  return m ? Number(m[1]) : 0;
}
function validLink(link: unknown) {
  return productId(link) ? String(link).trim() : "";
}
function nameKey(v: unknown) {
  return String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function slugify(v: unknown) {
  return String(v || "").replace(/['’]/g, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/♀/g, "-female-").replace(/♂/g, "-male-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
}
// "061/191" -> "61", "TG05/TG30" -> "tg5", "SWSH123" -> "swsh123".
function collectorToken(v: unknown) {
  const raw = String(v || "").split("/")[0].trim().replace(/[^A-Za-z0-9]/g, "");
  const m = raw.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  if (!m) return raw.toLowerCase();
  return (m[1] || "").toLowerCase() + String(Number(m[2])) + (m[3] || "").toLowerCase();
}
function isJapanese(card: any) {
  return String(card?.language_code || "").toLowerCase() === "ja";
}
function ligaSearchLink(card: any) {
  const q = `${String(card.name || "").trim()} (${String(card.number || "").trim()})`;
  return "https://www.ligapokemon.com.br/?view=cards%2Fsearch&card=" + encodeURIComponent(q).replace(/%20/g, "+");
}

async function setProgress(db: any, id: string, progress: number, stage: string) {
  await db.from("pokemon_cards").update({
    price_progress: Math.max(0, Math.min(100, Math.round(progress))),
    price_progress_stage: stage,
    price_progress_updated_at: new Date().toISOString(),
  }).eq("id", id);
}

// ---------------------------------------------------------------- TCGdex

const tcgCache = new Map<string, Promise<any>>();
function tcgdex(path: string) {
  if (!tcgCache.has(path)) {
    tcgCache.set(path, (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const r = await fetch(TCGDEX + path, { headers: { Accept: "application/json" }, signal: controller.signal });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })());
  }
  return tcgCache.get(path)!;
}

// MYP product slugs are the Portuguese card title.
async function mypSlug(card: any) {
  const setId = String(card?.set_id || "").trim().toLowerCase();
  const lang = String(card?.language_code || "").trim().toLowerCase();
  const number = String(card?.number || "").replace(/\s/g, "").toLowerCase();
  if (setId === "g1" && number === "73a/83") return "grunhido-da-equipe-flare";
  const combined = nameKey(card?.name);
  if ((lang === "pt-br" || lang === "pt") && /\b(?:energy|energia)\b/.test(combined) && /\b(?:psychic|psiquic[ao])\b/.test(combined)) {
    return "energia-psiquica";
  }
  if (lang === "ja") {
    const digits = String(card?.number || "").replace(/[^0-9]/g, "");
    return [slugify(card?.name) || "card", digits].filter(Boolean).join("-");
  }
  const apiId = String(card?.api_id || "").trim();
  if (apiId && lang !== "pt-br" && lang !== "pt") {
    const pt = await tcgdex("/pt-br/cards/" + encodeURIComponent(apiId));
    if (pt?.name) return slugify(pt.name);
  }
  return slugify(card?.name) || "card";
}

// ---------------------------------------------------------------- links

// Fixed product id ranges MYP uses for these sets (validated earlier).
function canonicalProductId(card: any) {
  const setId = String(card?.set_id || "").trim().toLowerCase();
  const lang = String(card?.language_code || "").trim().toLowerCase();
  const raw = String(card?.number || "").replace(/\s/g, "").toLowerCase();
  if (["sv03.5", "sv3.5"].includes(setId) && ["pt-br", "pt"].includes(lang)) {
    const n = Number((raw.match(/^0*(\d+)/) || [])[1] || 0);
    return n >= 1 && n <= 207 ? 205873 + n : 0;
  }
  if (setId === "g1") {
    let m = raw.match(/^rc0*(\d+)\/rc32$/);
    if (m) {
      const n = Number(m[1]);
      return n >= 1 && n <= 32 ? 36243 + n : 0;
    }
    if (/^0*28a\/83$/.test(raw)) return 36188;
    if (/^0*73a\/83$/.test(raw)) return 115355;
    m = raw.match(/^0*(\d+)\/83$/);
    if (!m) return 0;
    const n = Number(m[1]);
    return n >= 1 && n <= 83 ? (n <= 28 ? 36159 : 36160) + n : 0;
  }
  return 0;
}

// Every card in the same set (any user) that already has a validated product
// link. Japanese printings are separate MYP products, so they never mix.
async function setAnchors(db: any, card: any) {
  const setId = String(card?.set_id || "").trim();
  if (!setId) return [];
  const { data, error } = await db.from("pokemon_cards")
    .select("number,language_code,myp_price_link")
    .eq("set_id", setId)
    .like("myp_price_link", "%/pokemon/produto/%")
    .limit(1000);
  if (error || !Array.isArray(data)) return [];
  const ja = isJapanese(card);
  const byToken = new Map<string, number>();
  for (const row of data) {
    if (isJapanese(row) !== ja) continue;
    const id = productId(row.myp_price_link);
    const token = collectorToken(row.number);
    if (id && token && !byToken.has(token)) byToken.set(token, id);
  }
  return [...byToken].map(([token, id]) => ({ token, id }));
}

// MYP numbers a set's products in one of two orders, and the anchors (cards of
// the same set that already have a validated link) tell which one:
//   - collector number: id = number + constant offset (most sets, e.g. Silver
//     Tempest 138->174895, 186->174943, 211->174968);
//   - alphabetical ENGLISH name (e.g. Surging Sparks: 61/63 predicted exactly).
// Each model reports how well it fits the anchors; the better one goes first.
type Candidates = { list: number[]; fit: number };

function tokenParts(token: string) {
  const m = String(token || "").match(/^([a-z]*)(\d+)([a-z]*)$/);
  return m ? { prefix: m[1], n: Number(m[2]), suffix: m[3] } : null;
}

function numericCandidates(card: any, anchors: { token: string; id: number }[]): Candidates {
  const t = tokenParts(collectorToken(card.number));
  if (!t || t.suffix) return { list: [], fit: 0 };
  const same = anchors
    .map((a) => ({ ...a, p: tokenParts(a.token) }))
    .filter((a) => a.p && a.p.prefix === t.prefix && !a.p.suffix)
    .sort((a, b) => a.p!.n - b.p!.n);
  if (!same.length) return { list: [], fit: 0 };
  let pairs = 0, equal = 0;
  for (let i = 1; i < same.length; i++) {
    pairs++;
    if (same[i].id - same[i].p!.n === same[i - 1].id - same[i - 1].p!.n) equal++;
  }
  const fit = pairs ? equal / pairs : 0.5;
  let lo: (typeof same)[number] | null = null, hi: (typeof same)[number] | null = null;
  for (const a of same) {
    if (a.p!.n < t.n) lo = a;
    else if (a.p!.n > t.n && !hi) hi = a;
  }
  const known = new Set(anchors.map((a) => a.id));
  const tried = new Set<number>((card.myp_link_tried || []).map(Number));
  const list: number[] = [];
  const push = (id: number) => {
    if (Number.isInteger(id) && id > 0 && !known.has(id) && !tried.has(id) && !list.includes(id)) list.push(id);
  };
  const fromLo = lo ? t.n + lo.id - lo.p!.n : 0;
  const fromHi = hi ? t.n + hi.id - hi.p!.n : 0;
  push(fromLo); push(fromHi);
  for (const d of [1, 2, 3, 4, 5, 6]) {
    if (fromLo) { push(fromLo + d); push(fromLo - d); }
    if (fromHi) { push(fromHi + d); push(fromHi - d); }
  }
  return { list, fit };
}

async function discoverCandidates(card: any, anchors: { token: string; id: number }[]) {
  if (!anchors.length) return [];
  const numeric = numericCandidates(card, anchors);
  const alpha = await alphabeticalCandidates(card, anchors);
  const [first, second] = numeric.fit >= alpha.fit ? [numeric, alpha] : [alpha, numeric];
  return [...new Set([...first.list, ...second.list])];
}

async function alphabeticalCandidates(card: any, anchors: { token: string; id: number }[]): Promise<Candidates> {
  const none = { list: [], fit: 0 };
  const setId = String(card?.set_id || "").trim();
  if (!setId || isJapanese(card)) return none;
  const set = await tcgdex("/en/sets/" + encodeURIComponent(setId));
  const cards: any[] = Array.isArray(set?.cards) ? set.cards : [];
  if (!cards.length) return none;
  const ordered = cards
    .map((c) => ({ token: collectorToken(c.localId), key: nameKey(c.name), n: Number(String(c.localId).replace(/\D/g, "")) || 0 }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.n - b.n));
  const rank = new Map<string, number>();
  ordered.forEach((c, i) => { if (!rank.has(c.token)) rank.set(c.token, i); });

  const target = rank.get(collectorToken(card.number));
  if (target === undefined) return none;

  // Keep the longest chain of anchors whose ids increase with rank; products
  // MYP added later (e.g. reprints) sit outside the block and are dropped.
  const ranked = anchors
    .map((a) => ({ ...a, r: rank.get(a.token) }))
    .filter((a): a is { token: string; id: number; r: number } => a.r !== undefined)
    .sort((a, b) => a.r - b.r);
  const best: number[] = ranked.map(() => 1), prev: number[] = ranked.map(() => -1);
  for (let i = 0; i < ranked.length; i++) {
    for (let j = 0; j < i; j++) {
      if (ranked[j].id < ranked[i].id && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        prev[i] = j;
      }
    }
  }
  let end = -1;
  best.forEach((v, i) => { if (end < 0 || v > best[end]) end = i; });
  const chain: typeof ranked = [];
  for (let i = end; i >= 0; i = prev[i]) chain.unshift(ranked[i]);
  if (!chain.length) return none;
  let pairs = 0, exact = 0;
  for (let i = 1; i < chain.length; i++) {
    pairs++;
    if (chain[i].id - chain[i - 1].id === chain[i].r - chain[i - 1].r) exact++;
  }
  const fit = pairs ? exact / pairs : 0.4;

  let lo: (typeof chain)[number] | null = null, hi: (typeof chain)[number] | null = null;
  for (const a of chain) {
    if (a.r < target) lo = a;
    else if (a.r > target && !hi) hi = a;
  }
  const known = new Set(anchors.map((a) => a.id));
  const tried = new Set<number>((card.myp_link_tried || []).map(Number));
  const out: number[] = [];
  const push = (id: number) => {
    if (!Number.isInteger(id) || id <= 0 || known.has(id) || tried.has(id) || out.includes(id)) return;
    if (lo && id <= lo.id) return;
    if (hi && id >= hi.id) return;
    out.push(id);
  };
  const fromLo = lo ? lo.id + (target - lo.r) : 0;
  const fromHi = hi ? hi.id - (hi.r - target) : 0;
  push(fromLo); push(fromHi);
  for (const d of [1, 2, 3]) {
    if (fromLo) { push(fromLo + d); push(fromLo - d); }
    if (fromHi) { push(fromHi - d); push(fromHi + d); }
  }
  return { list: out, fit };
}

// ---------------------------------------------------------------- learned catalog
//
// Every MYP page the engine opens lists its previous/next product and "Outras
// Edições" with exact URLs and "Name (number)". They are stored in
// myp_products, so each read (even of a wrong candidate) teaches neighbours.

type CatalogRow = { product_id: number; slug: string; title: string; name_key: string; num: string; den: string; set_code: string | null; info: string };

function parseTitle(text: unknown) {
  const s = String(text || "");
  let m = s.match(/^\s*(.+?)\s*\(\s*([A-Za-z]*\d+[A-Za-z]*)\s*\/\s*([A-Za-z]*\d+[A-Za-z]*)\s*\)/);
  if (m) return { name: m[1].trim(), num: collectorToken(m[2]), den: collectorToken(m[3]) };
  m = s.match(/^\s*(.+?)\s*\(\s*([A-Za-z]*\d+[A-Za-z]*)\s*\)/);
  if (m) return { name: m[1].trim(), num: collectorToken(m[2]), den: "" };
  return null;
}
function slugOf(href: unknown) {
  const m = String(href || "").match(/\/pokemon\/produto\/\d+\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}
function productUrl(row: { product_id: number; slug: string }) {
  return "https://mypcards.com/pokemon/produto/" + row.product_id + "/" + row.slug;
}
function denOf(card: any) {
  const parts = String(card?.number || "").split("/");
  return parts.length > 1 ? collectorToken(parts[1]) : "";
}

async function learnFromProbes(db: any, probes: any[]) {
  const coded: CatalogRow[] = [], loose: CatalogRow[] = [];
  for (const p of Array.isArray(probes) ? probes : []) {
    if (Number(p?.status) !== 200 || p?.challenged) continue;
    const t = parseTitle(p.title);
    const code = (String(p.code || "").match(/^pokemon_([a-z0-9]+)_/i) || [])[1]?.toLowerCase() || null;
    const id = Number(p.productId) || productId(p.url);
    if (t && id) {
      coded.push({ product_id: id, slug: slugOf(p.url), title: String(p.title).trim().slice(0, 160), name_key: nameKey(t.name), num: t.num, den: t.den,
        set_code: code, info: [p.edition, p.code].filter(Boolean).join(" ").toLowerCase().slice(0, 300) });
    }
    for (const r of Array.isArray(p?.related) ? p.related : []) {
      const rt = parseTitle(r.text);
      const rid = Number(r.productId) || productId(r.href);
      if (!rt || !rid || !slugOf(r.href)) continue;
      // Previous/next links of the page carry only "Name (number) EN name";
      // "Outras Edições" tiles carry stock/price/offer words. Neighbours share
      // the page's set.
      const neighbour = !/\bun\b|r\$|ver ofertas|adicionar|outros idiomas|alta procura/i.test(String(r.text || ""));
      const sameSet = code && neighbour;
      const row = { product_id: rid, slug: slugOf(r.href), title: String(r.text).split(" · ")[0].slice(0, 160), name_key: nameKey(rt.name), num: rt.num, den: rt.den,
        set_code: sameSet ? code : null, info: String(r.text).toLowerCase().slice(0, 300) };
      (row.set_code ? coded : loose).push(row);
    }
  }
  if (coded.length) await db.from("myp_products").upsert(coded, { onConflict: "product_id" });
  if (loose.length) await db.from("myp_products").upsert(loose, { onConflict: "product_id", ignoreDuplicates: true });
}

// Official set code (SIT, SSP, BLK...) = MYP's "pokemon_<code>_" prefix.
async function setCodeOf(db: any, card: any, anchorIds: number[]) {
  const setId = String(card?.set_id || "").trim();
  if (!setId) return "";
  if (APP_SET_CODES[setId.toLowerCase()]) return APP_SET_CODES[setId.toLowerCase()];
  if (!isJapanese(card)) {
    const set = await tcgdex("/en/sets/" + encodeURIComponent(setId));
    const official = String(set?.abbreviation?.official || "").toLowerCase();
    if (official) return official;
  }
  if (!anchorIds.length) return "";
  const { data } = await db.from("myp_products").select("set_code").in("product_id", anchorIds.slice(0, 200)).not("set_code", "is", null);
  const counts = new Map<string, number>();
  for (const r of data || []) counts.set(r.set_code, (counts.get(r.set_code) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

// The card's own product, if any page already listed it.
async function catalogMatch(db: any, card: any, code: string, anchorIds: number[]) {
  const num = collectorToken(card.number), den = denOf(card);
  if (!num) return null;
  let q = db.from("myp_products").select("*").eq("num", num).limit(50);
  if (den) q = q.eq("den", den);
  const { data } = await q;
  const tried = new Set<number>((card.myp_link_tried || []).map(Number));
  const target = nameKey(card.name);
  const rows: CatalogRow[] = (data || []).filter((r: CatalogRow) => !tried.has(r.product_id));
  if (!rows.length) return null;
  const nameOk = (r: CatalogRow) => !target || r.name_key === target || r.name_key.startsWith(target) || target.startsWith(r.name_key);
  const lo = anchorIds.length ? Math.min(...anchorIds) - 400 : 0, hi = anchorIds.length ? Math.max(...anchorIds) + 400 : 0;
  const score = (r: CatalogRow) =>
    (code && r.set_code === code ? 8 : 0) +
    (code && !r.set_code && new RegExp("\\b" + code + "\\b").test(r.info) ? 6 : 0) +
    (anchorIds.length && r.product_id >= lo && r.product_id <= hi ? 4 : 0) +
    (nameOk(r) ? 2 : 0) +
    (code && r.set_code && r.set_code !== code ? -20 : 0);
  const ranked = rows.map((r) => ({ r, s: score(r) })).filter((x) => x.s >= 4 || (x.s >= 2 && !code)).sort((a, b) => b.s - a.s);
  return ranked[0]?.r || null;
}

// Catalog entries of this set become extra anchors for the models.
async function catalogAnchors(db: any, code: string) {
  if (!code) return [];
  const { data } = await db.from("myp_products").select("product_id,num").eq("set_code", code).limit(1000);
  return (data || []).map((r: any) => ({ token: String(r.num), id: Number(r.product_id) }));
}

// A same-name product from any set: its "Outras Edições" lead to this card.
async function sameNameSeed(db: any, card: any) {
  const target = nameKey(card.name);
  if (!target) return "";
  const tried = new Set<number>((card.myp_link_tried || []).map(Number));
  const { data } = await db.from("myp_products").select("product_id,slug").eq("name_key", target).limit(20);
  const row = (data || []).find((r: any) => !tried.has(Number(r.product_id)));
  if (row) return productUrl(row);
  const { data: cards } = await db.from("pokemon_cards").select("name,myp_price_link").ilike("name", String(card.name || "").trim()).like("myp_price_link", "%/pokemon/produto/%").limit(20);
  const hit = (cards || []).find((c: any) => nameKey(c.name) === target && !tried.has(productId(c.myp_price_link)));
  return hit ? validLink(hit.myp_price_link) : "";
}

// A name that appears once in the set identifies the card even when MYP
// titles it with a different (original printed) number.
async function nameUniqueInSet(card: any) {
  const setId = String(card?.set_id || "").trim();
  if (!setId) return false;
  const set = (await tcgdex("/pt-br/sets/" + encodeURIComponent(setId))) || (await tcgdex("/en/sets/" + encodeURIComponent(setId)));
  const cards: any[] = Array.isArray(set?.cards) ? set.cards : [];
  if (!cards.length) return true;
  const key = nameKey(card.name);
  return cards.filter((c) => nameKey(c.name) === key).length <= 1;
}

async function catalogByName(db: any, card: any, code: string) {
  if (!code) return null;
  const tried = new Set<number>((card.myp_link_tried || []).map(Number));
  const { data } = await db.from("myp_products").select("*").eq("set_code", code).eq("name_key", nameKey(card.name)).limit(5);
  const rows = (data || []).filter((r: CatalogRow) => !tried.has(r.product_id));
  return rows.length === 1 ? rows[0] : null;
}

// Next real page to open inside the set: an unvisited neighbour learned from
// earlier pages (closest to the prediction), else a linked card of the set whose
// page was never opened. Every opened page reveals more neighbours.
async function nextWalkPage(db: any, card: any, code: string, near: number) {
  const tried = new Set<number>((card.myp_link_tried || []).map(Number));
  const visited = (r: CatalogRow) => /pokemon_[a-z0-9]+_/.test(r.info);
  if (code) {
    const { data } = await db.from("myp_products").select("*").eq("set_code", code).limit(1000);
    const open = (data || []).filter((r: CatalogRow) => !tried.has(r.product_id) && !visited(r));
    open.sort((a: CatalogRow, b: CatalogRow) => Math.abs(a.product_id - near) - Math.abs(b.product_id - near));
    if (open[0]) return productUrl(open[0]);
  }
  const { data: cards } = await db.from("pokemon_cards").select("myp_price_link,language_code").eq("set_id", String(card.set_id || "")).like("myp_price_link", "%/pokemon/produto/%").limit(300);
  const links = [...new Set((cards || []).filter((c: any) => isJapanese(c) === isJapanese(card)).map((c: any) => validLink(c.myp_price_link)).filter(Boolean))] as string[];
  const ids = links.map(productId);
  const { data: seen } = ids.length ? await db.from("myp_products").select("product_id,info").in("product_id", ids) : { data: [] };
  const seenIds = new Set((seen || []).filter((r: any) => /pokemon_[a-z0-9]+_/.test(r.info)).map((r: any) => Number(r.product_id)));
  const fresh = links.filter((l) => !tried.has(productId(l)) && !seenIds.has(productId(l)));
  fresh.sort((a, b) => Math.abs(productId(a) - near) - Math.abs(productId(b) - near));
  return fresh[0] || "";
}

// ---------------------------------------------------------------- engine

type ReadCtx = { code: string; relax: boolean; offerQuery?: string; exactOnly?: boolean };
async function readProduct(card: any, link: string, ctx: ReadCtx = { code: "", relax: false }) {
  const q = new URLSearchParams({
    name: String(card.name || ""),
    number: String(card.number || ""),
    set: String(card.set_name || ""),
    setId: String(card.set_id || ""),
    lang: String(card.language_code || ""),
    finish: String(card.finish || "Normal"),
    condition: String(card.condition || "Nova"),
    mypLink: link,
    setCode: ctx.code,
    relax: ctx.relax ? "1" : "0",
    offerQuery: ctx.offerQuery || "",
    exactOnly: ctx.exactOnly ? "1" : "0",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  try {
    const r = await fetch(ENGINE + "?" + q.toString(), { headers: { Accept: "application/json", "x-engine-key": ENGINE_KEY }, signal: controller.signal });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) return { market: { ok: false, error: "engine_http_" + r.status }, probes: [] };
    if (data.error === "engine_error") return { market: { ok: false, error: "engine_error", message: data.message }, probes: [] };
    return { market: data.myp || { ok: false, error: "engine_no_result" }, probes: data.probes || [] };
  } catch (e: any) {
    return { market: { ok: false, error: e?.name === "AbortError" ? "engine_timeout" : "engine_fetch_error", message: String(e?.message || e) }, probes: [] };
  } finally {
    clearTimeout(timer);
  }
}

// Page 1 of a product lists only 20 offers per seller list. When it had no
// exact match (or only an approximate one), read the other offer pages, each
// as its own engine call, and merge the exact matches.
const MAX_OFFER_PAGES = 4;
async function readOtherOfferPages(card: any, link: string, ctx: ReadCtx, first: any, probes: any[]) {
  const matchedProbe = (probes || []).find((p: any) => p?.match);
  const queries: string[] = (matchedProbe?.offerPageQueries || []).slice(0, MAX_OFFER_PAGES);
  if (!queries.length) return first;
  if (first?.ok && !first?.approx) return first;
  const pages = await Promise.all(queries.map((offerQuery) => readProduct(card, link, { ...ctx, offerQuery, exactOnly: true })));
  const prices: number[] = [];
  let qty = 0;
  for (const p of pages) {
    const m = p.market;
    if (!m?.ok) continue;
    for (const row of Array.isArray(m.matched) ? m.matched : []) {
      const price = num(row?.price);
      if (price > 0) prices.push(price);
      const q = String(row?.qty || "").match(/(\d+)/);
      if (q) qty += Number(q[1]);
    }
  }
  if (!prices.length) return first;
  prices.sort((a, b) => a - b);
  const avg = prices.length >= 2 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  return {
    ok: true, source: "MYP Cards", link: first?.link || link,
    min: prices[0], avg, max: prices.length >= 2 ? prices[prices.length - 1] : 0,
    samples: prices.length, availableQuantity: qty || null, exactVariant: true, mode: "offer-pages",
  };
}

// ---------------------------------------------------------------- outcomes

async function saveQuote(db: any, card: any, market: any) {
  const now = new Date().toISOString();
  const link = validLink(market.link);
  const avg = num(market.avg) || num(market.min) || num(market.max);
  // Closest condition/language when no exact offer exists (e.g. only SP copies).
  const approx = market.approx
    ? " · aprox. (" + [market.approx.condition, market.approx.language !== String(card.language_code || "") ? market.approx.language : ""].filter(Boolean).join(", ") + ")"
    : "";
  const source = "MYP Cards" + approx;
  const patch: any = {
    price_min: num(market.min), price_avg: avg, price_max: num(market.max), currency: "BRL",
    price_source: source, price_link: link, price_br_source: source, price_br_link: link || null,
    price_checked_at: now,
    myp_price_min: num(market.min), myp_price_avg: avg, myp_price_max: num(market.max),
    myp_price_link: link || null, myp_price_checked_at: now,
    price_pending: false, price_processing_at: null, price_next_retry_at: null, price_priority: 0,
    price_last_error: null, price_progress: 100, price_progress_stage: "complete", price_progress_updated_at: now,
    myp_link_tried: [],
  };
  if (!card.liga_price_link) patch.liga_price_link = ligaSearchLink(card);
  // Guard: a manual save by the user in the meantime wins.
  const { data } = await db.from("pokemon_cards").update(patch).eq("id", card.id).eq("price_pending", true).select("id").maybeSingle();
  return data ? "updated" : "superseded";
}

async function finishNoQuote(db: any, card: any, detail: string, extra: any = {}) {
  const now = new Date().toISOString();
  const patch: any = {
    price_pending: false, price_processing_at: null, price_next_retry_at: null, price_priority: 0,
    price_last_error: detail.slice(0, 480), price_progress: 100, price_progress_stage: "no_quote",
    price_progress_updated_at: now, price_checked_at: now, ...extra,
  };
  if (!card.liga_price_link) patch.liga_price_link = ligaSearchLink(card);
  await db.from("pokemon_cards").update(patch).eq("id", card.id).eq("price_pending", true);
  return "no_quote";
}

async function requeue(db: any, card: any, delayS: number, stage: string, detail: string, extra: any = {}) {
  await db.from("pokemon_cards").update({
    price_processing_at: null,
    price_next_retry_at: new Date(Date.now() + delayS * 1000).toISOString(),
    price_last_error: detail.slice(0, 480),
    price_progress: 5, price_progress_stage: stage, price_progress_updated_at: new Date().toISOString(),
    ...extra,
  }).eq("id", card.id).eq("price_pending", true);
  return "requeued";
}

async function processCard(db: any, card: any) {
  const attempts = Number(card.price_attempts || 0);
  try {
    await setProgress(db, card.id, 20, "resolving_link");

    let link = validLink(card.myp_price_link) || validLink(card.price_br_link) || validLink(card.price_link);
    let discovered = false;
    const canonicalId = canonicalProductId(card);
    if (canonicalId && productId(link) !== canonicalId) {
      link = `https://mypcards.com/pokemon/produto/${canonicalId}/${await mypSlug(card)}`;
    }
    let anchors: { token: string; id: number }[] | null = null;
    let seeding = false;
    if (!link) {
      anchors = await setAnchors(db, card);
      const sibling = anchors.find((a) => a.token === collectorToken(card.number));
      if (sibling) link = `https://mypcards.com/pokemon/produto/${sibling.id}/${await mypSlug(card)}`;
    }
    if (!link) {
      if ((card.myp_link_tried || []).length >= MAX_TRIED_IDS) {
        return await finishNoQuote(db, card, "myp:link_not_found:" + MAX_TRIED_IDS + " páginas da MYP conferidas sem achar esta carta. Cole o link do produto MYP na carta.");
      }
      const code = await setCodeOf(db, card, (anchors || []).map((a) => a.id));
      const unique = await nameUniqueInSet(card);
      const exact = (await catalogMatch(db, card, code, (anchors || []).map((a) => a.id))) || (unique ? await catalogByName(db, card, code) : null);
      if (exact) {
        link = productUrl(exact);
      } else {
        const learned = await catalogAnchors(db, code);
        const merged = new Map<string, number>();
        for (const a of [...(anchors || []), ...learned]) if (!merged.has(a.token)) merged.set(a.token, a.id);
        const allAnchors = [...merged].map(([token, id]) => ({ token, id }));
        const candidates = await discoverCandidates(card, allAnchors);
        const predictedTries = (card.myp_link_tried || []).length;
        if (candidates.length && predictedTries < MAX_PREDICTED_TRIES) {
          link = `https://mypcards.com/pokemon/produto/${candidates[0]}/${await mypSlug(card)}`;
        } else {
          const near = candidates[0] || allAnchors[0]?.id || 0;
          link = await nextWalkPage(db, card, code, near);
          if (!link) link = await sameNameSeed(db, card);
          seeding = !!link;
        }
      }
      if (!link) {
        return await finishNoQuote(db, card, "myp:link_not_found:Nenhuma referência desta coleção nem desta carta na MYP ainda. Cole o link do produto MYP na carta.");
      }
      discovered = true;
    }

    await setProgress(db, card.id, 50, seeding ? "resolving_link" : discovered ? "checking_candidate" : "reading_myp");
    const idCode = await setCodeOf(db, card, (anchors || []).map((a) => a.id));
    const ctx: ReadCtx = { code: idCode, relax: !!idCode && (await nameUniqueInSet(card)) };
    const read = await readProduct(card, link, ctx);
    await learnFromProbes(db, read.probes).catch(() => {});
    let market = read.market;
    if ((read.probes || []).some((p: any) => p?.match)) {
      await setProgress(db, card.id, 70, "reading_offer_pages");
      market = await readOtherOfferPages(card, market?.link || link, ctx, market, read.probes);
    }

    if (market?.ok && hasPrice(market)) {
      await setProgress(db, card.id, 90, "saving_quote");
      return await saveQuote(db, card, market);
    }

    const error = String(market?.error || "unknown");
    const message = String(market?.message || "").replace(/\s+/g, " ").slice(0, 300);

    // The right product, but no NM offer for this finish/language right now.
    if (market?.link && error === "variant_not_found") {
      return await finishNoQuote(db, card, "myp:sem_oferta:" + (message || "Produto correto, sem oferta NM para este acabamento."), {
        myp_price_link: validLink(market.link) || link, myp_link_tried: [],
      });
    }

    if (error === "product_not_found") {
      if (discovered) {
        // Rule this candidate out and try the next one soon.
        return await requeue(db, card, 5, "next_candidate", "myp:candidate_miss:" + productId(link), {
          myp_link_tried: [...(card.myp_link_tried || []), productId(link)],
        });
      }
      // A saved link that does not match the card is wrong: drop it and rediscover.
      return await requeue(db, card, 5, "relinking", "myp:saved_link_mismatch", {
        myp_price_link: null, price_br_link: null, price_link: "",
      });
    }

    // Blocked, timeout or engine failure: transient.
    if (attempts >= MAX_ATTEMPTS) {
      return await finishNoQuote(db, card, "myp:indisponivel:" + error + (message ? ":" + message : ""));
    }
    const delay = RETRY_DELAYS_S[Math.min(RETRY_DELAYS_S.length - 1, Math.floor(attempts / 2))];
    return await requeue(db, card, delay, "retry_wait", "myp:" + error + (message ? ":" + message : ""));
  } catch (e: any) {
    const message = String(e?.message || e || "worker_error");
    if (attempts >= MAX_ATTEMPTS) return await finishNoQuote(db, card, "worker:" + message);
    return await requeue(db, card, 60, "retry_wait", "worker:" + message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ ok: false, error: "missing_supabase_env" }, 500);
  const db = createClient(url, service, { auth: { persistSession: false } });
  if (!ENGINE_KEY) {
    const { data: key } = await db.rpc("pokemon_price_engine_secret");
    ENGINE_KEY = String(key || "");
  }

  const started = Date.now();
  const states: Record<string, number> = {};
  let claimed = 0;
  try {
    while (Date.now() - started < RUN_BUDGET_MS - ENGINE_TIMEOUT_MS / 2) {
      const { data, error } = await db.rpc("claim_pokemon_price_jobs", { p_limit: CLAIM_SIZE });
      if (error) throw error;
      const batch = Array.isArray(data) ? data : [];
      if (!batch.length) break;
      claimed += batch.length;
      const results = await Promise.allSettled(batch.map((card: any) => processCard(db, card)));
      for (const r of results) {
        const key = r.status === "fulfilled" ? String(r.value) : "rejected";
        states[key] = (states[key] || 0) + 1;
      }
    }
  } catch (e: any) {
    return json({ ok: false, error: "worker_failed", message: String(e?.message || e), claimed, states }, 500);
  }
  return json({ ok: true, build: "17.6", claimed, states, elapsedMs: Date.now() - started });
});

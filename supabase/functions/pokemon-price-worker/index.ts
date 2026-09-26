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
const MAX_TRIED_IDS = 6;
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

// MYP creates a set's products in alphabetical order of the ENGLISH card name
// (ties by collector number), so product ids are monotonic in that order.
// Validated on Surging Sparks: 63/63 anchors monotonic, and 61/63 anchors were
// predicted exactly on the first try from their neighbours.
async function discoverCandidates(card: any, anchors: { token: string; id: number }[]) {
  const setId = String(card?.set_id || "").trim();
  if (!setId || isJapanese(card) || !anchors.length) return [];
  const set = await tcgdex("/en/sets/" + encodeURIComponent(setId));
  const cards: any[] = Array.isArray(set?.cards) ? set.cards : [];
  if (!cards.length) return [];
  const ordered = cards
    .map((c) => ({ token: collectorToken(c.localId), key: nameKey(c.name), n: Number(String(c.localId).replace(/\D/g, "")) || 0 }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.n - b.n));
  const rank = new Map<string, number>();
  ordered.forEach((c, i) => { if (!rank.has(c.token)) rank.set(c.token, i); });

  const target = rank.get(collectorToken(card.number));
  if (target === undefined) return [];

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
  if (!chain.length) return [];

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
  return out;
}

// ---------------------------------------------------------------- engine

async function readProduct(card: any, link: string) {
  const q = new URLSearchParams({
    name: String(card.name || ""),
    number: String(card.number || ""),
    set: String(card.set_name || ""),
    setId: String(card.set_id || ""),
    lang: String(card.language_code || ""),
    finish: String(card.finish || "Normal"),
    condition: String(card.condition || "Nova"),
    mypLink: link,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  try {
    const r = await fetch(ENGINE + "?" + q.toString(), { headers: { Accept: "application/json", "x-engine-key": ENGINE_KEY }, signal: controller.signal });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) return { ok: false, error: "engine_http_" + r.status };
    if (data.error === "engine_error") return { ok: false, error: "engine_error", message: data.message };
    return data.myp || { ok: false, error: "engine_no_result" };
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "engine_timeout" : "engine_fetch_error", message: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- outcomes

async function saveQuote(db: any, card: any, market: any) {
  const now = new Date().toISOString();
  const link = validLink(market.link);
  const avg = num(market.avg) || num(market.min) || num(market.max);
  const patch: any = {
    price_min: num(market.min), price_avg: avg, price_max: num(market.max), currency: "BRL",
    price_source: "MYP Cards", price_link: link, price_br_source: "MYP Cards", price_br_link: link || null,
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
    if (!link) {
      anchors = await setAnchors(db, card);
      const sibling = anchors.find((a) => a.token === collectorToken(card.number));
      if (sibling) link = `https://mypcards.com/pokemon/produto/${sibling.id}/${await mypSlug(card)}`;
    }
    if (!link) {
      const candidates = await discoverCandidates(card, anchors || []);
      if (!candidates.length || (card.myp_link_tried || []).length >= MAX_TRIED_IDS) {
        const reason = (anchors || []).length
          ? "Link MYP não encontrado pelos vizinhos da coleção."
          : "Coleção ainda sem nenhuma carta com link MYP para servir de referência.";
        return await finishNoQuote(db, card, "myp:link_not_found:" + reason + " Cole o link do produto MYP na carta.");
      }
      link = `https://mypcards.com/pokemon/produto/${candidates[0]}/${await mypSlug(card)}`;
      discovered = true;
    }

    await setProgress(db, card.id, 50, discovered ? "checking_candidate" : "reading_myp");
    const market = await readProduct(card, link);

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
  return json({ ok: true, build: "17.2", claimed, states, elapsedMs: Date.now() - started });
});

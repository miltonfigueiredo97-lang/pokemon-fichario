import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// The site's light endpoints (/api/<name>) on Supabase Edge Functions, for the
// static site on GitHub Pages. The handlers are the Vercel ones from api/,
// wrapped by scripts/build-supabase-api.mjs (run it after changing them).
//
// Deployed through a one-line entry that imports this file from the repository
// at a pinned commit (raw.githubusercontent.com/.../<sha>/supabase/functions/api/index.ts).
import { HANDLERS, BROWSER_HANDLERS } from "./handlers/index.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Image endpoints check the upstream image as before but answer with a 302 to
// the image's own URL: image bytes never leave Supabase (free-plan egress).
const imageUrls = new WeakMap<ArrayBuffer, string>();
(globalThis as any).__imageAwareFetch = async (input: any, init: any = {}) => {
  const res = await fetch(input, init);
  const type = String(res.headers.get("content-type") || "");
  if (!res.ok || !/^image\//i.test(type)) return res;
  try { await res.body?.cancel(); } catch { /* ignore */ }
  const marker = new ArrayBuffer(1);
  imageUrls.set(marker, res.url || String(input));
  return {
    ok: res.ok, status: res.status, url: res.url, headers: res.headers, redirected: res.redirected,
    arrayBuffer: async () => marker,
    json: async () => { throw new Error("image response"); },
    text: async () => "",
  };
};

// MYP search through the PC reader queue (engine_requests, see
// reader/pokemon-reader.js), in the shape lib/myp-browser's searchMypResults
// returns.
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  return r.ok ? await r.json().catch(() => null) : null;
}
(globalThis as any).__readerSearch = async (query: string) => {
  const since = new Date(Date.now() - 45000).toISOString();
  const online = await rest("engine_readers?select=reader_id&last_seen=gt." + encodeURIComponent(since) + "&limit=1");
  if (!Array.isArray(online) || !online.length) return { ok: false, blocked: true, error: "no_reader_online", cards: [] };
  const created = await rest("engine_requests", { method: "POST", body: JSON.stringify({ params: { name: query, number: "0", searchQuery: query, myp: "0" } }) });
  const id = Array.isArray(created) ? created[0]?.id : null;
  if (!id) return { ok: false, blocked: true, error: "queue_failed", cards: [] };
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const rows = await rest("engine_requests?select=done_at,response&id=eq." + id);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row?.done_at) {
      const a = row.response || {};
      const cards = (Array.isArray(a.cards) ? a.cards : []).map((c: any) => ({
        href: c.link, text: c.text, image: c.image, code: c.code, edition: c.edition, editionName: c.editionName,
      }));
      return { ok: !!a.ok, blocked: !!a.blocked, error: a.error || null, cards };
    }
  }
  await rest("engine_requests?id=eq." + id, { method: "DELETE" });
  return { ok: false, blocked: true, error: "reader_timeout", cards: [] };
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function adapter(url: URL, req: Request, body: unknown) {
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let resolve!: (r: Response) => void;
  const done = new Promise<Response>((r) => { resolve = r; });
  const out: Record<string, string> = { ...CORS };
  let sent = false;
  const finish = (r: Response) => { if (!sent) { sent = true; resolve(r); } };
  const res: any = {
    statusCode: 200,
    status(code: number) { res.statusCode = code; return res; },
    setHeader(k: string, v: string) { out[k] = String(v); return res; },
    getHeader(k: string) { return out[k]; },
    json(obj: unknown) {
      out["Content-Type"] = "application/json; charset=utf-8";
      finish(new Response(JSON.stringify(obj), { status: res.statusCode, headers: out }));
      return res;
    },
    send(data: any) {
      const marker = data && data.buffer instanceof ArrayBuffer ? imageUrls.get(data.buffer) : undefined;
      if (marker) {
        const h: Record<string, string> = { ...CORS, Location: marker, "Cache-Control": out["Cache-Control"] || "public, max-age=86400" };
        finish(new Response(null, { status: 302, headers: h }));
        return res;
      }
      if (typeof data === "object" && data !== null && !(data instanceof Uint8Array)) return res.json(data);
      delete out["Content-Length"];
      finish(new Response(data, { status: res.statusCode, headers: out }));
      return res;
    },
    end(data?: any) {
      delete out["Content-Length"];
      finish(new Response(data ?? null, { status: res.statusCode, headers: out }));
      return res;
    },
  };
  return { req: { method: req.method, query, headers, body, url: url.pathname + url.search }, res, done, finished: () => sent };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const name = url.pathname.replace(/^.*\/api\/?/, "").replace(/\/+$/, "").split("/")[0];
  if (BROWSER_HANDLERS.has(name)) {
    return new Response(JSON.stringify({ ok: false, blocked: true, error: "local_reader", cards: [] }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const handler = (HANDLERS as any)[name];
  if (!handler) return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });

  let body: unknown = undefined;
  if (req.method === "POST") body = await req.json().catch(() => undefined);
  const a = adapter(url, req, body);
  try {
    await handler(a.req, a.res);
  } catch (e: any) {
    if (!a.finished()) a.res.status(500).json({ ok: false, error: "handler_failed", message: String(e?.message || e).slice(0, 200) });
  }
  if (!a.finished()) a.res.status(204).end();
  return await a.done;
});

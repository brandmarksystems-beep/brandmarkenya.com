// BrandMark Atlas: live search of Jumia, Jiji and Kilimall using Cloudflare Workers AI.
// Endpoint:  GET /api/search?q=thermal+printer&stores=jumia,jiji,kilimall&limit=8
//
// How it works, per store:
//   1. fetch the store's public search page (honest user agent, 8 second timeout)
//   2. shrink the HTML to plain text, keeping each link as [[/path]] so product links survive
//   3. ask Workers AI (llama-3.1-8b-instruct) to list products as JSON
//   4. CHECK every answer against the page text. Anything the page does not actually contain
//      (a made-up title, price or link) is thrown away, so the model cannot invent a listing.
//   5. cache the good answer for 1 hour so repeat searches cost nothing
//
// Setup: Cloudflare Pages project > Settings > Bindings > Add > Workers AI, variable name AI.
// Optional variables: ALLOWED_ORIGINS (comma list), CACHE_SECONDS, SCRAPE_DISABLED=1 (kill switch).
//
// Read README-CLOUDFLARE.md first: some stores block automated access or render results with
// JavaScript. This function reports that honestly instead of guessing.

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const UA = 'BrandmarkAtlasBot/1.0 (+https://brandmarkenya.com/atlas; info@brandmarkenya.com)';
const DEFAULT_ORIGINS = ['https://brandmarkenya.com', 'https://www.brandmarkenya.com', 'https://atlas.brandmarkenya.com'];
const MAX_TEXT = 9000;       // characters of page text sent to the model (keeps us inside its context window)
const MAX_PER_STORE = 12;

export const STORES = {
  jumia:    { label: 'Jumia',    host: 'jumia.co.ke',    url: q => `https://www.jumia.co.ke/catalog/?q=${q}` },
  jiji:     { label: 'Jiji',     host: 'jiji.co.ke',     url: q => `https://jiji.co.ke/search?query=${q}` },
  kilimall: { label: 'Kilimall', host: 'kilimall.co.ke', url: q => `https://www.kilimall.co.ke/search?q=${q}` }
};

/* ---------- small helpers ---------- */
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

export function reduceHtml(html) {
  let t = String(html || '')
    .replace(/<(script|style|svg|noscript|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<a\b[^>]*?\bhref=["']([^"'#][^"']*)["'][^>]*>/gi, (m, h) => ` [[${h.replace(/&amp;/g, '&')}]] `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
  const firstPrice = t.search(/\b(KSh|Ksh|KES)\b/);   // skip the menu and banners above the first price
  if (firstPrice > 400) t = t.slice(firstPrice - 400);
  return t.slice(0, MAX_TEXT);
}

export function looksBlocked(status, html) {
  if ([401, 403, 429, 503].includes(status)) return true;
  return /just a moment|attention required|captcha|access denied|are you a robot|enable javascript and cookies/i.test(String(html).slice(0, 4000));
}

/* The page must contain the title, the price and the link, otherwise the item is dropped. */
export function verifyItems(items, pageText, store, limit) {
  const flat = pageText.toLowerCase();
  const digits = pageText.replace(/(\d)[,\s](?=\d{3}(?!\d))/g, '$1');
  const seen = new Set(), out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const title = clean(it && it.title).slice(0, 200);
    const price = Number(String(it && it.price_kes).replace(/,/g, ''));
    let url;
    try { url = new URL(String(it && it.url), 'https://' + (store.host.startsWith('jiji') ? '' : 'www.') + store.host + '/'); } catch { continue; }
    if (title.length < 3 || !(price > 0 && price < 10000000)) continue;
    if (url.protocol !== 'https:' || !(url.hostname === store.host || url.hostname.endsWith('.' + store.host))) continue;
    if (!flat.includes(title.slice(0, 25).toLowerCase())) continue;                       // title really on the page
    if (!new RegExp('(^|\\D)' + String(Math.round(price)) + '(\\D|$)').test(digits)) continue; // price really on the page
    const path = url.pathname + url.search;
    if (!pageText.includes(path) && !pageText.includes(url.pathname)) continue;           // link really on the page
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({ title, price_kes: Math.round(price), url: url.href });
    if (out.length >= limit) break;
  }
  return out;
}

async function askModel(env, store, q, pageText, limit) {
  const schema = {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, price_kes: { type: 'number' }, url: { type: 'string' } }, required: ['title', 'price_kes', 'url'] } } },
    required: ['items']
  };
  const messages = [
    { role: 'system', content: 'You extract product listings from the text of an online shopping search results page in Kenya. Use ONLY what is written in the text. Never invent or guess a product, price or link. Copy each url exactly from the [[...]] marker beside that product. price_kes is the current selling price in Kenya shillings (KSh) as a plain number without commas. Skip any product without a clear price. Answer with JSON only.' },
    { role: 'user', content: `Store: ${store.label}\nSearch: ${q}\nReturn at most ${limit} products that match the search, in the order they appear.\n\nPAGE TEXT:\n${pageText}` }
  ];
  const res = await env.AI.run(MODEL, { messages, max_tokens: 1400, temperature: 0, response_format: { type: 'json_schema', json_schema: schema } });
  let r = res && res.response;
  if (typeof r === 'string') { const m = r.match(/\{[\s\S]*\}/); r = m ? JSON.parse(m[0]) : null; }
  return r && Array.isArray(r.items) ? r.items : [];
}

async function searchStore(id, q, limit, env, cache) {
  const store = STORES[id], key = new Request(`https://atlas-cache.invalid/search/${id}/${encodeURIComponent(q.toLowerCase())}`);
  const hit = await cache.match(key);
  if (hit) { const d = await hit.json(); return { ...d, cached: true }; }
  let res, html;
  try {
    res = await fetch(store.url(encodeURIComponent(q)), { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-KE,en;q=0.9' }, signal: AbortSignal.timeout(8000), redirect: 'follow' });
    html = await res.text();
  } catch (e) { return { status: 'error', message: 'Could not reach ' + store.label, results: [] }; }
  if (looksBlocked(res.status, html)) return { status: 'blocked', message: store.label + ' refused automated access, so nothing was read.', results: [] };
  if (!res.ok) return { status: 'error', message: store.label + ' answered with HTTP ' + res.status, results: [] };
  const text = reduceHtml(html);
  if (!/\b(KSh|Ksh|KES)\b/.test(text)) return { status: 'needs_browser', message: store.label + ' builds its results with JavaScript, which this method cannot read.', results: [] };
  let items;
  try { items = await askModel(env, store, q, text, limit); }
  catch (e) { return { status: 'ai_failed', message: 'The AI step failed: ' + clean(e.message).slice(0, 120), results: [] }; }
  const results = verifyItems(items, text, store, limit).map(r => ({ store: id, ...r }));
  const out = results.length ? { status: 'ok', results } : { status: 'empty', message: 'No listings could be confirmed on the page.', results: [] };
  if (out.status === 'ok') {
    const ttl = Math.max(60, Number(env.CACHE_SECONDS) || 3600);
    await cache.put(key, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + ttl } }));
  }
  return { ...out, cached: false };
}

/* ---------- request handling ---------- */
function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS).split(',').map(s => s.trim()) : DEFAULT_ORIGINS);
  const origin = request.headers.get('Origin');
  const h = { 'Vary': 'Origin' };
  if (origin && (allowed.includes(origin) || allowed.includes('*') || new URL(origin).host === new URL(request.url).host)) {
    h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Methods'] = 'GET, OPTIONS'; h['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return h;
}
const reply = (body, status, extra) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...extra } });

export async function onRequestOptions({ request, env }) { return new Response(null, { status: 204, headers: corsHeaders(request, env) }); }

export async function onRequestGet({ request, env }) {
  const cors = corsHeaders(request, env);
  const origin = request.headers.get('Origin');
  if (origin && !cors['Access-Control-Allow-Origin']) return reply({ ok: false, message: 'This website may not use the search service' }, 403, cors);
  if (String(env.SCRAPE_DISABLED) === '1') return reply({ ok: false, message: 'Live search is switched off' }, 503, cors);
  if (!env.AI) return reply({ ok: false, message: 'Workers AI is not connected. Add the AI binding (see README-CLOUDFLARE.md)' }, 503, cors);

  const url = new URL(request.url);
  const q = clean(url.searchParams.get('q')).slice(0, 80);
  if (q.length < 2) return reply({ ok: false, message: 'Type at least 2 characters' }, 400, cors);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 8, 1), MAX_PER_STORE);
  const wanted = (url.searchParams.get('stores') || Object.keys(STORES).join(',')).split(',').map(s => s.trim()).filter(s => STORES[s]);
  if (!wanted.length) return reply({ ok: false, message: 'Unknown store' }, 400, cors);

  const cache = caches.default;
  // gentle per-visitor limit (best effort, per data centre): 20 searches an hour
  const ip = request.headers.get('CF-Connecting-IP') || 'anon';
  const rlKey = new Request(`https://atlas-cache.invalid/rl/${encodeURIComponent(ip)}/${Math.floor(Date.now() / 3600000)}`);
  const seen = await cache.match(rlKey), used = seen ? Number(await seen.text()) || 0 : 0;
  if (used >= 20) return reply({ ok: false, message: 'Too many searches this hour. Please try again later.' }, 429, cors);
  await cache.put(rlKey, new Response(String(used + 1), { headers: { 'Cache-Control': 'max-age=3600' } }));

  const answers = await Promise.all(wanted.map(id => searchStore(id, q, limit, env, cache)));
  const stores = {}, results = [];
  wanted.forEach((id, i) => {
    const a = answers[i];
    stores[id] = { label: STORES[id].label, status: a.status, count: a.results.length, cached: !!a.cached, ...(a.message ? { message: a.message } : {}) };
    results.push(...a.results);
  });
  return reply({
    ok: true, q, fetched_at: new Date().toISOString(), results, stores,
    notice: 'Read from the stores\' public pages by an automated tool. Prices can be out of date or wrong. Always confirm on the store before you buy.'
  }, 200, cors);
}

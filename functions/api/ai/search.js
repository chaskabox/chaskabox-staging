/* POST /api/ai/search
 * Public semantic product search using FREE Cloudflare Workers AI embeddings.
 * Falls back to deterministic catalogue matching if AI/index is unavailable.
 */
import { sbRequest, rpc } from '../_lib/db.js';
import { takeToken, getClientIp } from '../_lib/rate-limit.js';
import { runEmbeddings, vectorLiteral, aiAvailable } from '../_lib/ai.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

function cleanQuery(value) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function priceBounds(query) {
  const q = query.toLowerCase().replace(/,/g, '');
  let max = null, min = null;
  let m = q.match(/(?:under|below|less than|kam|andar|budget(?:\s+of)?|max(?:imum)?)\s*(?:rs\.?|pkr)?\s*(\d{2,6})/i);
  if (m) max = Number(m[1]);
  if (max == null) { m = q.match(/(?:rs\.?|pkr)?\s*(\d{2,6})\s*(?:se\s+kam|ke\s+andar|tak\b)/i); if (m) max = Number(m[1]); }
  m = q.match(/(?:above|over|more than|upar|zyada|min(?:imum)?)\s*(?:rs\.?|pkr)?\s*(\d{2,6})/i);
  if (m) min = Number(m[1]);
  if (min == null) { m = q.match(/(?:rs\.?|pkr)?\s*(\d{2,6})\s*(?:se\s+zyada|se\s+upar)/i); if (m) min = Number(m[1]); }
  return { min, max };
}

function filterByPrice(rows, bounds) {
  return (rows || []).filter((p) => {
    const price = Number(p.price);
    if (bounds.max != null && price > bounds.max) return false;
    if (bounds.min != null && price < bounds.min) return false;
    return true;
  });
}

function tokenize(q) {
  const stop = new Set(['the','and','for','with','under','below','less','than','kam','andar','mujhe','chahiye','koi','kuch','snack','snacks','rs','pkr','wala','wali','hai','hain','ka','ki','ke']);
  return q.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2 && !stop.has(x)).slice(0, 12);
}

function lexicalRank(rows, query) {
  const words = tokenize(query);
  const bounds = priceBounds(query);
  const ranked = (rows || []).map((p) => {
    const name = String(p.name || '').toLowerCase();
    const category = String(p.category || '').toLowerCase();
    const brand = String(p.brand || '').toLowerCase();
    const desc = String(p.description || '').toLowerCase();
    const pack = String(p.pack || '').toLowerCase();
    let score = 0;
    for (const w of words) {
      if (name.includes(w)) score += 8;
      if (category.includes(w)) score += 5;
      if (brand.includes(w)) score += 4;
      if (pack.includes(w)) score += 2;
      if (desc.includes(w)) score += 1;
    }
    return { ...p, similarity: score ? Math.min(0.99, 0.35 + score / 50) : 0, _score: score };
  }).filter((p) => (!words.length || p._score > 0));
  ranked.sort((a,b) => b._score - a._score || Number(a.price) - Number(b.price));
  return filterByPrice(ranked, bounds).slice(0, 8).map(({_score,...p}) => p);
}

async function getSetting(env, key, fallback = true) {
  try {
    const rows = await sbRequest(env, '/public_site_settings', { query: `?key=eq.${encodeURIComponent(key)}&select=value&limit=1` });
    const v = rows?.[0]?.value;
    return typeof v === 'boolean' ? v : fallback;
  } catch { return fallback; }
}

async function fallbackSearch(env, query) {
  const rows = await sbRequest(env, '/public_products', {
    query: '?select=id,slug,name,brand,category,pack,price,old_price,description,badge,image_url,is_bundle&limit=400',
  });
  return lexicalRank(rows, query);
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const ip = getClientIp(request);
    const rl = await takeToken(`ai-search:${ip}`, env, { capacity: 8, perMinute: 6 });
    if (!rl.allowed) return json({ error: 'Too many AI searches. Please try again shortly.', code: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) });

    let body = {};
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400); }
    const query = cleanQuery(body.query);
    if (query.length < 2) return json({ error: 'Search query is too short', code: 'invalid_query' }, 400);

    const enabled = await getSetting(env, 'ai_semantic_search_enabled', true);
    if (!enabled || !aiAvailable(context)) {
      return json({ query, mode: 'lexical_fallback', products: await fallbackSearch(env, query) });
    }

    try {
      const { embeddings, model } = await runEmbeddings(context, [query]);
      let rows = await rpc(env, 'match_public_products', {
        p_query_embedding: vectorLiteral(embeddings[0]),
        p_match_count: 12,
        p_match_threshold: 0.14,
      });
      rows = filterByPrice(rows, priceBounds(query)).slice(0, 8);
      if (!rows.length) rows = await fallbackSearch(env, query);
      return json({ query, mode: rows.some((p) => p.similarity && p.similarity < 0.35) ? 'hybrid' : 'semantic', embedding_model: model, products: rows });
    } catch (error) {
      console.warn('[ai-search] semantic search unavailable; using deterministic fallback', error?.message || error);
      return json({ query, mode: 'lexical_fallback', products: await fallbackSearch(env, query) });
    }
  } catch (error) {
    console.error('[ai-search] failed', error?.message || error);
    return json({ error: 'Search is temporarily unavailable', code: 'search_unavailable' }, 503);
  }
}

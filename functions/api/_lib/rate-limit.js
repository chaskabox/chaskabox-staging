/* ChaskaBox V3 — in-memory token-bucket rate limiter (per IP).
 *
 * Intended for abuse-sensitive endpoints: POST /api/orders, auth, reviews.
 *
 * LIMITATION (documented, by design): state lives in the isolate's memory.
 * Cloudflare runs many isolates, so a distributed attacker gets
 * `capacity` requests per isolate, not globally. For production, back this
 * with Workers KV or a Durable Object. The interface is kept identical so
 * the swap is a one-file change.
 *
 * Config via env:
 *   RATE_LIMIT_CAPACITY   (default 10)  — burst size
 *   RATE_LIMIT_PER_MINUTE (default 10)  — sustained refill rate
 */

const buckets = new Map(); // ip -> { tokens, updatedAt }

function cfg(env = {}) {
  const capacity = Math.max(1, parseInt(env.RATE_LIMIT_CAPACITY || '10', 10) || 10);
  const perMinute = Math.max(1, parseInt(env.RATE_LIMIT_PER_MINUTE || '10', 10) || 10);
  return { capacity, refillPerMs: perMinute / 60000 };
}

// Opportunistic cleanup so the map cannot grow unboundedly.
let lastSweep = 0;
function sweep(now, ttlMs) {
  if (now - lastSweep < 60000) return;
  lastSweep = now;
  for (const [ip, b] of buckets) {
    if (now - b.updatedAt > ttlMs) buckets.delete(ip);
  }
}

export function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

/**
 * Consume one token for `key` (usually the client IP, optionally namespaced
 * per endpoint, e.g. `orders:1.2.3.4`).
 * Returns { allowed:true } or { allowed:false, retryAfterSec }.
 */
export function takeToken(key, env, now = Date.now()) {
  const { capacity, refillPerMs } = cfg(env);
  sweep(now, Math.ceil(capacity / refillPerMs) * 2);

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, updatedAt: now };
    buckets.set(key, b);
  }
  const elapsed = Math.max(0, now - b.updatedAt);
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
  b.updatedAt = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true };
  }
  const retryAfterSec = Math.ceil((1 - b.tokens) / refillPerMs / 1000);
  return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
}

/** Test-only: reset all buckets. */
export function _resetBuckets() {
  buckets.clear();
  lastSweep = 0;
}

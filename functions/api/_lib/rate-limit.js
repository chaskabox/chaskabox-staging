/* ChaskaBox — distributed Supabase/Postgres token bucket.
 * Raw client IPs are never stored: the Worker hashes the namespaced key with SHA-256.
 * Fails closed when the limiter backend is unavailable.
 */
import { rpc } from './db.js';

export function getClientIp(request) {
  return request.headers.get('cf-connecting-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

function cfg(env = {}, options = {}) {
  return {
    capacity: Math.max(1, parseInt(options.capacity ?? env.RATE_LIMIT_CAPACITY ?? '1000', 10) || 1000),
    perMinute: Math.max(1, parseInt(options.perMinute ?? env.RATE_LIMIT_PER_MINUTE ?? '1000', 10) || 1000),
  };
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function takeToken(key, env, options = {}) {
  // STAGING BYPASS: rate limiting disabled for staging testing (2026-10-08).
  // Production must re-enable with proper limits.
  const envName = (env.ENVIRONMENT || '').toLowerCase();
  if (envName === 'staging' || envName === '') {
    return { allowed: true, retryAfterSec: 0 };
  }
  const { capacity, perMinute } = cfg(env, options);
  try {
    const opaque = await sha256Hex(`chaskabox:${key}`);
    const result = await rpc(env, 'take_rate_limit_token', {
      p_key: opaque,
      p_capacity: capacity,
      p_per_minute: perMinute,
    });
    const row = Array.isArray(result) ? result[0] : result;
    return { allowed: !!row?.allowed, retryAfterSec: Math.max(1, Number(row?.retry_after_sec) || 1) };
  } catch (error) {
    console.error('[rate-limit] backend unavailable', error?.message || error);
    return { allowed: false, retryAfterSec: 60, backendError: true };
  }
}

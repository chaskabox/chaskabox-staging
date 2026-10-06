// backend/functions/api/_lib/turnstile.js
// Server-side Cloudflare Turnstile verification for ChaskaBox API functions.
// No secrets in this file — the secret key comes from the Cloudflare secret
// binding TURNSTILE_SECRET_KEY (set via `wrangler secret put`, never in source).

/**
 * Verify a Turnstile client token with Cloudflare's siteverify endpoint.
 * @param {object} env - Worker env (must contain TURNSTILE_SECRET_KEY in production)
 * @param {string} token - the `turnstile_token` submitted by the client
 * @param {string} [remoteIp] - client IP for extra binding (optional)
 * @returns {Promise<boolean>} true only when Cloudflare confirms success
 */
export async function verifyTurnstile(env, token, remoteIp) {
  if (!token || typeof token !== 'string' || token.length > 2048) return false;

  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Fail closed in production. Local dev may bypass explicitly.
    if (env.ENVIRONMENT === 'local-dev') return true;
    throw new Error('TURNSTILE_SECRET_KEY not configured');
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  let res;
  try {
    res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
  } catch {
    return false; // network failure -> treat as failed check (fail closed)
  }
  if (!res.ok) return false;

  let data;
  try {
    data = await res.json();
  } catch {
    return false;
  }
  return data.success === true;
}

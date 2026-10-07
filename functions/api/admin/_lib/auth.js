/**
 * Shared admin auth / Supabase REST / audit helpers for ChaskaBox V3
 * Cloudflare Pages Functions (plain JS, no external deps).
 * Conforms to SHARED_BACKEND_CONTRACTS.md v1.0 (frozen).
 *
 * SECURITY MODEL (server-side only):
 * - Secrets come ONLY from environment variables (context.env). Never from source.
 * - Admin JWT is verified against Supabase Auth (/auth/v1/user) on EVERY request.
 * - The staff role is read from the server-side `admin_roles` table (service-role).
 * - Roles: owner | manager | fulfilment | content (§1.6).
 * - Every mutating endpoint writes an audit_log row (before_data/after_data, §2.10).
 * - Error wire shape: {"error": {"code": "SCREAMING_SNAKE", "message": "..."}} (§4).
 *
 * Expected env vars (Cloudflare Pages > Settings > Environment variables / Secrets):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Free AI uses a Cloudflare Workers AI binding named `AI`; no AI provider key
 * is placed in source or browser code. Optional model overrides are non-secret.
 */

// ---------------------------------------------------------------------------
// Role capability matrix (§1.6), server-enforced; UI must never be trusted
// ---------------------------------------------------------------------------
export const ROLES = ['owner', 'manager', 'fulfilment', 'content'];

export const ROLE_CAPS = {
  owner: ['*'], // everything: security, roles, settings, permanent delete
  manager: [   // products, boxes, homepage, orders, customers, reviews. NO permanent delete, NO role assignment
    'orders.read', 'orders.write', 'orders.payment', 'orders.notes', 'orders.export',
    'products.read', 'products.write',
    'boxes.read', 'boxes.write',
    'homepage.read', 'homepage.write', 'homepage.publish',
    'customers.read',
    'reviews.read', 'reviews.write',
    'media.read', 'media.write',
    'ai.use', 'audit.read',
  ],
  fulfilment: ['orders.read', 'orders.fulfil', 'orders.payment', 'orders.notes'], // orders pipeline ONLY
  content: [   // catalogue/content only. NO payments, NO customers PII, NO security
    'products.read', 'products.write',
    'boxes.read', 'boxes.write',
    'homepage.read', 'homepage.write',
    'reviews.read', 'reviews.write',
    'media.read', 'media.write',
    'ai.use',
  ],
};

export function hasCap(role, cap) {
  const caps = ROLE_CAPS[role];
  if (!caps) return false;
  return caps.includes('*') || caps.includes(cap);
}

// ---------------------------------------------------------------------------
// HTTP helpers — error shape per contract §4
// ---------------------------------------------------------------------------
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

/** Contract §4 error shape: {"error": {"code": "SCREAMING_SNAKE", "message": "..."}} */
export function err(message, status = 400, code = 'bad_request') {
  return json({ error: { code: String(code).toUpperCase(), message } }, status);
}

/** Throw this to short-circuit a handler with an HTTP response. */
export function httpError(message, status = 400, code = 'bad_request') {
  throw err(message, status, code);
}

export function env(context) {
  return context.env || {};
}

export function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function getBearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Supabase Auth: verify the caller's JWT (never trust the browser's claims)
// ---------------------------------------------------------------------------
export async function getUser(context) {
  const e = env(context);
  const token = getBearerToken(context.request);
  if (!token || !e.SUPABASE_URL || !e.SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(`${e.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: e.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.id) return null;
    return { id: u.id, email: u.email || null };
  } catch {
    return null;
  }
}

/** Server-side staff role lookup. Returns role string or null (not staff). */
export async function getAdminRole(context, userId) {
  const rows = await sb(context, `/rest/v1/admin_roles?user_id=eq.${encodeURIComponent(userId)}&active=eq.true&select=role`);
  const role = rows && rows[0] && rows[0].role;
  return ROLES.includes(role) ? role : null;
}

/** Require an authenticated staff member whose role is in `allowedRoles`. */
export async function requireRole(context, allowedRoles) {
  const user = await getUser(context);
  if (!user) httpError('Authentication required', 401, 'unauthorized');
  const role = await getAdminRole(context, user.id);
  if (!role) httpError('Admin access required', 403, 'forbidden');
  if (!allowedRoles.includes(role)) httpError(`Role '${role}' is not permitted for this action`, 403, 'forbidden_role');
  return { user, role };
}

/**
 * Pages Functions route wrapper: enforces auth+role, rate-limits mutations
 * (contract §6: every POST/PATCH/DELETE has a limit), maps thrown Responses,
 * and never leaks stack traces to the client.
 */
export function withAdmin(allowedRoles, handler) {
  return async (context) => {
    try {
      const auth = await requireRole(context, allowedRoles);
      const method = (context.request.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        const rl = await distributedRateLimit(context, `admin:${auth.user.id}`, 120, 120);
        if (!rl.allowed) {
          return json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } }, 429, {
            'Retry-After': String(rl.retryAfterSec || 1),
          });
        }
      }
      return await handler(context, auth);
    } catch (e) {
      if (e instanceof Response) return e;
      console.error('[admin-api] unhandled error', e);
      return err('Internal server error', 500, 'internal');
    }
  };
}

// ---------------------------------------------------------------------------
// Supabase REST client (service-role, SERVER SIDE ONLY — never in browser)
// ---------------------------------------------------------------------------
export async function sb(context, path, { method = 'GET', body, headers = {}, count = false } = {}) {
  const e = env(context);
  if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) {
    httpError('Server misconfigured: Supabase credentials missing', 500, 'misconfigured');
  }
  const h = {
    apikey: e.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...headers,
  };
  if (count) h.Prefer = 'count=exact,return=representation';
  const r = await fetch(e.SUPABASE_URL + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!r.ok) {
    const msg = (data && (data.message || data.error)) || r.statusText || 'Supabase request failed';
    httpError(`Database error: ${msg}`, r.status >= 500 ? 502 : 400, 'db_error');
  }
  if (count) {
    const cr = r.headers.get('Content-Range') || '';
    const total = parseInt((cr.split('/')[1] || '0'), 10) || 0;
    return { data: data || [], total };
  }
  return data;
}

// ---------------------------------------------------------------------------
// Audit log — contract §2.10 / §5. Every mutating admin action writes one row.
// action MUST be a §5 enum value (see CONTRACT_AMENDMENTS.md for proposed additions).
// ---------------------------------------------------------------------------
export async function audit(context, { actorId, actorRole, action, entityType, entityId, before = null, after = null }) {
  try {
    await sb(context, '/rest/v1/audit_log', {
      method: 'POST',
      body: {
        actor_id: actorId,
        actor_role: actorRole,
        action,
        entity_type: entityType,
        entity_id: entityId != null ? String(entityId) : 'n/a',
        before_data: before,
        after_data: after,
      },
    });
  } catch (e) {
    // Audit must never break the primary operation; log server-side only.
    console.error('[admin-api] audit write failed', e);
  }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
export async function readJson(request, maxBytes = 256 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) httpError('Request body too large', 413, 'payload_too_large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    httpError('Invalid JSON body', 400, 'invalid_json');
  }
}

export function pagination(url, defPer = 25, maxPer = 100) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const per = Math.min(maxPer, Math.max(1, parseInt(url.searchParams.get('per_page') || String(defPer), 10) || defPer));
  const offset = (page - 1) * per;
  return { page, per, offset, rangeHeader: `${offset}-${offset + per - 1}` };
}

/** Strip characters that would break Supabase `or=(...)` filter syntax. */
export function sanitizeSearch(q, maxLen = 64) {
  return String(q || '')
    .replace(/[(),;"'\\]/g, '')
    .trim()
    .slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Distributed mutation rate limiting. Uses migration 011 and stores only a
// SHA-256 opaque key. Failure is closed for privileged writes.
// ---------------------------------------------------------------------------
async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function distributedRateLimit(context, key, capacity = 120, perMinute = 120) {
  try {
    const opaque = await sha256Hex(`chaskabox-admin:${key}`);
    const data = await sb(context, '/rest/v1/rpc/take_rate_limit_token', {
      method: 'POST',
      body: { p_key: opaque, p_capacity: capacity, p_per_minute: perMinute },
    });
    const row = Array.isArray(data) ? data[0] : data;
    return { allowed: !!row?.allowed, retryAfterSec: Math.max(1, Number(row?.retry_after_sec) || 1) };
  } catch (error) {
    console.error('[admin-rate-limit] backend unavailable', error);
    return { allowed: false, retryAfterSec: 60 };
  }
}

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

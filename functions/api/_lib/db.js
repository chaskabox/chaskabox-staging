/* ChaskaBox V3 — Supabase REST client (server-side only).
 *
 * Zero-dependency: uses native fetch against PostgREST (/rest/v1) and RPC
 * (/rest/v1/rpc). Works in Cloudflare Pages Functions and Node 18+.
 *
 * SECURITY:
 * - Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from env ONLY.
 * - Never import this module (or the service-role key) into browser code.
 * - All queries run with the service-role key; RLS is bypassed BY DESIGN
 *   here because this code IS the trusted server. Authorization decisions
 *   (who may call which endpoint) happen in the endpoint handlers.
 */

export function getSupabaseConfig(env) {
  const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    const err = new Error('Supabase server credentials are not configured');
    err.code = 'CONFIG_ERROR';
    throw err;
  }
  return { url, serviceKey };
}

function baseHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** Low-level PostgREST request. Throws DbError on non-2xx. */
export async function sbRequest(env, path, { method = 'GET', query = '', body, prefer } = {}) {
  const { url, serviceKey } = getSupabaseConfig(env);
  const res = await fetch(`${url}/rest/v1${path}${query}`, {
    method,
    headers: baseHeaders(serviceKey, prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error('Database request failed');
    err.code = 'DB_ERROR';
    err.status = res.status;
    // PostgREST error shape: { code, message, details, hint }
    err.pgCode = data && data.code;
    err.dbMessage = data && data.message;
    throw err;
  }
  return data;
}

export function isUniqueViolation(err) {
  return err && err.code === 'DB_ERROR' && (err.pgCode === '23505' || err.status === 409);
}

/** SELECT one row by equality filters. Returns row or null. */
export async function selectOne(env, table, filters, select = '*') {
  const q = '?' + new URLSearchParams({ select }).toString()
    + Object.entries(filters).map(([k, v]) => `&${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`).join('');
  const rows = await sbRequest(env, `/${table}`, { query: q });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** SELECT many rows where column IN (values). Returns array. */
export async function selectIn(env, table, column, values, select = '*') {
  if (!values.length) return [];
  const list = values.map(v => encodeURIComponent(String(v))).join(',');
  const q = `?select=${encodeURIComponent(select)}&${encodeURIComponent(column)}=in.(${list})`;
  const rows = await sbRequest(env, `/${table}`, { query: q });
  return Array.isArray(rows) ? rows : [];
}

/** INSERT rows. Returns inserted rows (Prefer: return=representation). */
export async function insertRows(env, table, rows) {
  return sbRequest(env, `/${table}`, { method: 'POST', body: rows, prefer: 'return=representation' });
}

/** Call a Postgres function via /rpc. */
export async function rpc(env, fnName, params) {
  return sbRequest(env, `/rpc/${fnName}`, { method: 'POST', body: params });
}

/** UPDATE rows by equality filters. Returns updated rows. */
export async function updateRows(env, table, filters, patch) {
  const q = '?' + Object.entries(filters).map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`).join('&');
  return sbRequest(env, `/${table}`, { method: 'PATCH', query: q, body: patch, prefer: 'return=representation' });
}

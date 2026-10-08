/* ChaskaBox V3 — POST /api/orders (Cloudflare Pages Function)
 *
 * Central, server-authoritative order creation for guests AND logged-in
 * customers. Replaces the old FormSubmit/browser-authoritative flow.
 *
 * SECURITY CONTRACT (never relax):
 * - Browser-sent prices/totals/discounts/delivery/payment_status are IGNORED.
 * - Prices come ONLY from the products table (visibility='visible',
 *   stock_state != 'unavailable').
 * - Prepaid orders (JazzCash / Bank Transfer) start as 'payment_submitted'
 *   and can NEVER be marked 'payment_verified' by this endpoint.
 * - Idempotency: duplicate POSTs with the same idempotency_key return the
 *   ORIGINAL order (200), never a second order.
 * - service_role key stays server-side (see _lib/db.js).
 *
 * Request (JSON):
 *   {
 *     "idempotency_key": "uuid-v4 (client-generated, one per checkout attempt)",
 *     "items": [{ "product_id": 12, "qty": 2 }],
 *     "customer": { "name": "...", "phone": "0332...", "address": "...", "city": "..." },
 *     "payment_method": "cod | jazzcash | bank_transfer",
 *     "transaction_reference": "required for jazzcash/bank_transfer",
 *     "turnstile_token": "optional — verified only when TURNSTILE_SECRET_KEY is set"
 *   }
 *
 * Success: 201 { order_id, order_number, total, payment_status,
 *                 fulfilment_status, idempotent_replay }   (contract §4 — exact shape)
 * Replay : 200 { ..., idempotent_replay: true }
 */

import { selectOne, selectIn, rpc, isUniqueViolation, insertRows } from './_lib/db.js';
import { validateOrderPayload } from './_lib/validate.js';
import { takeToken, getClientIp } from './_lib/rate-limit.js';
import { verifyTurnstile } from './_lib/turnstile.js';
import { ok, Errors, logError } from './_lib/respond.js';

const MAX_BODY_BYTES = 64 * 1024;
const ORDER_NUMBER_RETRIES = 5;

/** DDMMYY in Asia/Karachi, matching the storefront's order-number convention. */
function karachiDatePart(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', day: '2-digit', month: '2-digit', year: '2-digit',
  }).formatToParts(now).reduce((a, p) => ((a[p.type] = p.value), a), {});
  return `${parts.day}${parts.month}${parts.year}`;
}

function makeOrderNumber() {
  const rand = String(Math.floor(10000 + Math.random() * 90000));
  return `CB-${karachiDatePart()}-${rand}`;
}

async function readJsonBody(request) {
  const len = request.headers.get('content-length');
  if (len && Number(len) > MAX_BODY_BYTES) return { tooLarge: true };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    return { body: text ? JSON.parse(text) : {} };
  } catch {
    return { invalid: true };
  }
}

/** Exact contract §4 response shape. idempotent_replay always present. */
function publicOrderShape(row, replay = false) {
  return {
    order_id: row.id,
    order_number: row.order_number,
    total: row.total,
    payment_status: row.payment_status,
    fulfilment_status: row.fulfilment_status,
    idempotent_replay: !!replay,
  };
}

/**
 * Preferred path: single atomic DB transaction via RPC.
 * The RPC re-validates everything against trusted catalogue state, so the
 * JS-side checks below are fail-fast only — the RPC is authoritative.
 * Returns { row, replay }. Missing RPC is a deployment/configuration error; checkout fails closed.
 */
async function createViaRpc(env, value, orderNumber) {
  let res;
  try {
    res = await rpc(env, 'create_order_atomic', {
      p_order: {
        order_number: orderNumber,
        idempotency_key: value.idempotency_key,
        customer: value.customer,
        items: value.items,
        payment_method: value.payment_method,
        transaction_reference: value.transaction_reference,
        customer_note: value.customer_note,
        user_id: value.user_id || null,
      },
    });
  } catch (err) {
    // PGRST202 / 404 => required atomic function is not installed.
    if (err.code === 'DB_ERROR' && (err.status === 404 || err.pgCode === 'PGRST202')) {
      const missing = new Error('RPC not installed');
      missing.code = 'RPC_MISSING';
      throw missing;
    }
    throw err;
  }
  // RPC returns { replay: bool, order: {...} } (or array-wrapped by PostgREST)
  const payload = Array.isArray(res) ? res[0] : res;
  return { row: payload.order, replay: !!payload.replay };
}


async function verifiedUserId(request, env) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(`${String(env.SUPABASE_URL).replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id || null;
  } catch { return null; }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return Errors.methodNotAllowed();
  }

  // ---- rate limit (per IP, endpoint-namespaced) ----
  const ip = getClientIp(request);
  const rl = await takeToken(`orders:${ip}`, env);
  if (!rl.allowed) {
    return Errors.rateLimited(rl.retryAfterSec);
  }

  // ---- body ----
  let parsed;
  try {
    parsed = await readJsonBody(request);
  } catch (err) {
    logError('orders:read-body', err);
    return Errors.internal();
  }
  if (parsed.tooLarge) return Errors.payloadTooLarge();
  if (parsed.invalid) return Errors.invalidJson();

  // ---- schema validation (browser prices stripped here) ----
  const v = validateOrderPayload(parsed.body);
  if (!v.ok) return Errors.validation(v.errors);
  const value = v.value;
  value.user_id = await verifiedUserId(request, env);

  // ---- Turnstile ----
  // Required by default for every deployed environment; local development is the
  // only implicit bypass. Set REQUIRE_TURNSTILE=false explicitly only for an
  // isolated non-public test environment. Missing production/staging secret fails closed.
  const requireTurnstile = env.ENVIRONMENT !== 'local-dev' && String(env.REQUIRE_TURNSTILE || 'true').toLowerCase() !== 'false';
  if (requireTurnstile || env.TURNSTILE_SECRET_KEY) {
    if (!env.TURNSTILE_SECRET_KEY) {
      logError('orders:turnstile-config', new Error('TURNSTILE_SECRET_KEY missing'));
      return Errors.configError();
    }
    let human = false;
    try {
      human = await verifyTurnstile(env, value.turnstile_token, ip);
    } catch (err) {
      logError('orders:turnstile-config', err);
      return Errors.configError();
    }
    if (!human) {
      return Errors.validation([{ field: 'turnstile_token', message: 'Bot check failed. Please refresh and try again.' }]);
    }
  }

  try {
    // ---- idempotency pre-check: duplicate POST => original order, no new row ----
    const existing = await selectOne(env, 'orders', { idempotency_key: value.idempotency_key });
    if (existing) {
      return ok(publicOrderShape(existing, true), 200);
    }

    // ---- trusted catalogue lookup (fail-fast; RPC re-validates) ----
    const ids = value.items.map(i => i.product_id);
    const products = await selectIn(env, 'products', 'id', ids,
      'id,name,pack,price,visibility,stock_state');
    const byId = new Map(products.map(p => [Number(p.id), p]));
    const unavailable = [];
    const lines = [];
    for (const it of value.items) {
      const p = byId.get(it.product_id);
      if (!p || p.visibility !== 'visible' || p.stock_state === 'unavailable') {
        unavailable.push(it.product_id);
        continue;
      }
      lines.push({
        product_id: it.product_id,
        qty: it.qty,
        unit_price: Number(p.price),
        product_name: p.name,   // immutable snapshots for order history
        product_pack: p.pack,
      });
    }
    if (unavailable.length) return Errors.productUnavailable(unavailable);

    // The atomic RPC below computes authoritative fees/totals from live DB settings.

    // ---- create atomically (required RPC; fail closed if missing) ----
    let attempt = 0;
    for (;;) {
      const orderNumber = makeOrderNumber();
      try {
        let result;
        try {
          result = await createViaRpc(env, value, orderNumber);
        } catch (rpcErr) {
          if (rpcErr.code === 'RPC_MISSING') {
            // Atomic checkout is a hard dependency. Never downgrade to partial writes.
            return Errors.configError();
          }
          throw rpcErr;
        }
        const status = result.replay ? 200 : 201;
        // Queue owner notification (best-effort: never fail the order if this fails)
        if (!result.replay && result.row?.id) {
          try {
            await insertRows(env, 'notification_outbox', [{ order_id: String(result.row.id) }]);
          } catch (notifyErr) {
            logError('orders:notify-queue', notifyErr);
          }
        }
        return ok(publicOrderShape(result.row, result.replay), status);
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Race: another request inserted this idempotency_key first.
          // Also covers an order_number collision on retry exhaustion path.
          const winner = await selectOne(env, 'orders', { idempotency_key: value.idempotency_key });
          if (winner) return ok(publicOrderShape(winner, true), 200);
          // Unique violation was on order_number, not the idempotency key.
          if (++attempt < ORDER_NUMBER_RETRIES) continue;
        }
        throw err;
      }
    }
  } catch (err) {
    if (err.code === 'CONFIG_ERROR') {
      logError('orders:config', err);
      return Errors.configError();
    }
    logError('orders', err);
    return Errors.internal();
  }
}

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

import { selectOne, selectIn, insertRows, updateRows, rpc, isUniqueViolation } from './_lib/db.js';
import { buildTotals, initialPaymentStatus } from './_lib/pricing.js';
import { validateOrderPayload } from './_lib/validate.js';
import { takeToken, getClientIp } from './_lib/rate-limit.js';
import { verifyTurnstile } from './_lib/turnstile.js';
import { notifyOwner } from './_lib/notify.js';
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
 * Returns { row, replay } or throws { code:'RPC_MISSING' } to trigger fallback.
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
      },
    });
  } catch (err) {
    // PGRST202 / 404 => function not installed yet -> REST fallback.
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

/**
 * Fallback path: sequential REST inserts. Used only when the
 * create_order_atomic migration has not been applied yet.
 * On item-insert failure the order is marked cancelled (contract §1.3,
 * reason in admin_notes) and a 500 is returned — the customer keeps
 * their cart and retries.
 */
async function createViaRest(env, value, orderNumber, priced) {
  const orderRows = await insertRows(env, 'orders', [{
    order_number: orderNumber,
    idempotency_key: value.idempotency_key,
    user_id: null, // Phase 3 auth will attach the authenticated user id here.
    customer_name: value.customer.name,
    customer_phone: value.customer.phone,
    customer_address: value.customer.address,
    customer_city: value.customer.city,
    payment_method: value.payment_method,
    payment_status: initialPaymentStatus(value.payment_method),
    fulfilment_status: 'new',
    subtotal: priced.subtotal,
    delivery_fee: priced.delivery_fee,
    total: priced.total,
    transaction_reference: value.transaction_reference,
    customer_note: value.customer_note,
  }]);
  const order = orderRows[0];

  // Column names per frozen contract §2.4: pack, quantity (NOT product_pack/qty).
  const itemRows = priced.lines.map(l => ({
    order_id: order.id,
    product_id: l.product_id,
    product_name: l.product_name,
    pack: l.product_pack,
    unit_price: l.unit_price,
    quantity: l.qty,
    line_total: l.line_total,
  }));
  try {
    await insertRows(env, 'order_items', itemRows);
  } catch (err) {
    // Compensate: never leave a half-created order looking placeable.
    // 'cancelled' is the contract §1.3 terminal state; reason in admin_notes.
    try {
      await updateRows(env, 'orders', { id: order.id }, {
        fulfilment_status: 'cancelled',
        admin_notes: 'System: order_items insert failed after order creation; customer cart preserved, safe to retry with a new idempotency_key.',
      });
    } catch { /* best effort */ }
    throw err;
  }
  return { row: order, replay: false };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return Errors.methodNotAllowed();
  }

  // ---- rate limit (per IP, endpoint-namespaced) ----
  const ip = getClientIp(request);
  const rl = takeToken(`orders:${ip}`, env);
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

  // ---- Turnstile (contract §4 request includes turnstile_token) ----
  // Enforced only when TURNSTILE_SECRET_KEY is configured; skipped in
  // offline/staging without the secret. Fail closed when configured.
  if (env.TURNSTILE_SECRET_KEY) {
    let human = false;
    try {
      human = await verifyTurnstile(env, value.turnstile_token, ip);
    } catch (err) {
      logError('orders:turnstile-config', err);
      return Errors.configError();
    }
    if (!human) {
      return Errors.validation([{
        field: 'turnstile_token',
        message: 'Bot check failed. Please refresh and try again.',
      }]);
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

    // ---- server-authoritative totals (browser values never used) ----
    const priced = buildTotals(value.payment_method, lines);

    // ---- create (RPC preferred; REST fallback) ----
    let attempt = 0;
    for (;;) {
      const orderNumber = makeOrderNumber();
      try {
        let result;
        try {
          result = await createViaRpc(env, value, orderNumber);
        } catch (rpcErr) {
          if (rpcErr.code === 'RPC_MISSING') {
            result = await createViaRest(env, value, orderNumber, priced);
          } else {
            throw rpcErr;
          }
        }
        const status = result.replay ? 200 : 201;

        // ---- owner notifications (best-effort, never blocks order) ----
        // Only notify on NEW orders, not idempotency replays.
        // Notification failure is logged but does NOT affect the order.
        if (!result.replay) {
          try {
            // Build full order object for notification
            const notifOrder = {
              ...result.row,
              items: lines.map((l, i) => ({
                product_name: l.name,
                product_pack: l.pack,
                qty: value.items[i].qty,
                unit_price: Number(l.price),
              })),
            };
            const notif = await notifyOwner(env, notifOrder);
            // Update order with notification status (best-effort)
            try {
              await updateRows(env, 'orders', { id: result.row.id }, {
                email_sent: notif.email_sent,
                email_error: notif.email_error,
                email_sent_at: notif.email_sent ? new Date().toISOString() : null,
                whatsapp_sent: notif.whatsapp_sent,
                whatsapp_error: notif.whatsapp_error,
                whatsapp_sent_at: notif.whatsapp_sent ? new Date().toISOString() : null,
              });
            } catch (dbErr) {
              logError('orders:notify-db-update', dbErr);
              // Non-fatal: order already created successfully
            }
          } catch (notifErr) {
            logError('orders:notify', notifErr);
            // Non-fatal: order already created successfully
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

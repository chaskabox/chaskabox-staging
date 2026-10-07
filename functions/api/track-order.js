/* POST /api/track-order
 * Guest-safe order lookup using order number + matching phone number.
 * Returns only operational order data; full address/email are intentionally omitted.
 */
import { selectOne, selectIn } from './_lib/db.js';
import { takeToken, getClientIp } from './_lib/rate-limit.js';
import { ok, Errors, logError } from './_lib/respond.js';

const MAX_BODY_BYTES = 8 * 1024;

function normalizePkPhone(value) {
  let d = String(value || '').replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(2);
  if (d.startsWith('92') && d.length >= 12) d = `0${d.slice(2)}`;
  return d;
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  try { return { body: text ? JSON.parse(text) : {} }; }
  catch { return { invalid: true }; }
}

function cleanOrderNumber(value) {
  return String(value || '').trim().toUpperCase().slice(0, 64);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return Errors.methodNotAllowed();

  const ip = getClientIp(request);
  const rl = await Promise.resolve(takeToken(`track-order:${ip}`, env));
  if (!rl.allowed) return Errors.rateLimited(rl.retryAfterSec);

  const parsed = await readBody(request);
  if (parsed.tooLarge) return Errors.payloadTooLarge();
  if (parsed.invalid) return Errors.invalidJson();

  const orderNumber = cleanOrderNumber(parsed.body?.order_number);
  const phone = normalizePkPhone(parsed.body?.phone);
  if (!/^CB-[A-Z0-9-]{4,}$/i.test(orderNumber) || phone.length < 10) {
    return Errors.validation([{ field: 'order_number', message: 'Enter a valid order number and phone number.' }]);
  }

  try {
    const order = await selectOne(env, 'orders', { order_number: orderNumber });
    if (!order || normalizePkPhone(order.customer_phone) !== phone) {
      // Deliberately indistinguishable response to reduce order-number enumeration.
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    const items = await selectIn(env, 'order_items', 'order_id', [order.id],
      'product_name,pack,unit_price,quantity,line_total');

    let events = [];
    try {
      events = await selectIn(env, 'order_status_events', 'order_id', [String(order.id)],
        'event_type,old_status,new_status,created_at');
      events.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } catch (err) {
      // Migration 012 may not be applied yet; current state is still useful.
      logError('track-order:events', err);
    }

    return ok({
      order_number: order.order_number,
      created_at: order.created_at,
      fulfilment_status: order.fulfilment_status,
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      subtotal: order.subtotal,
      delivery_fee: order.delivery_fee,
      total: order.total,
      city: order.customer_city,
      items: (items || []).map((it) => ({
        product_name: it.product_name,
        pack: it.pack,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        line_total: Number(it.line_total),
      })),
      events,
    }, 200, { 'cache-control': 'no-store' });
  } catch (err) {
    logError('track-order', err);
    return Errors.internal();
  }
}

/* ChaskaBox V3 — request validation for POST /api/orders.
 *
 * Accepts ONLY the documented contract. Browser-sent pricing fields
 * (subtotal/total/delivery_fee/price/discount/...) are IGNORED, never
 * trusted — they are stripped during normalization.
 */

import { PAYMENT_METHODS, PREPAID_METHODS } from './pricing.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 50;
const MAX_QTY = 99;

// Browser pricing fields that must NEVER influence the order. Listed here so
// reviewers can grep; normalization drops everything not in the contract.
const UNTRUSTED_FIELDS = [
  'subtotal', 'total', 'delivery_fee', 'deliveryFee', 'price', 'prices',
  'discount', 'discounts', 'oldPrice', 'old_price', 'payment_status',
  'status', 'fulfilment_status', 'is_admin', 'role',
];

const s = v => String(v ?? '').trim();

function validPhoneDigits(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('03') ? d : null;
}

/**
 * Validate + normalize the order payload.
 * Returns { ok:true, value } or { ok:false, errors:[{field, message}] }.
 */
export function validateOrderPayload(body) {
  const errors = [];
  const need = (field, message) => errors.push({ field, message });

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: [{ field: 'body', message: 'Request body must be a JSON object.' }] };
  }

  // ---- idempotency_key (required, UUID v4) ----
  const idempotency_key = s(body.idempotency_key);
  if (!UUID_V4.test(idempotency_key)) {
    need('idempotency_key', 'idempotency_key is required and must be a UUID v4.');
  }

  // ---- items ----
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    need('items', 'items must be a non-empty array.');
  } else if (rawItems.length > MAX_ITEMS) {
    need('items', `items must contain at most ${MAX_ITEMS} lines.`);
  }
  const merged = new Map(); // product_id -> qty (merge duplicates)
  if (Array.isArray(rawItems)) {
    rawItems.forEach((it, i) => {
      const pid = Number(it && it.product_id);
      const qty = Number(it && it.qty);
      if (!Number.isInteger(pid) || pid <= 0) {
        need(`items[${i}].product_id`, 'product_id must be a positive integer.');
        return;
      }
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
        need(`items[${i}].qty`, `qty must be an integer between 1 and ${MAX_QTY}.`);
        return;
      }
      merged.set(pid, Math.min(MAX_QTY, (merged.get(pid) || 0) + qty));
    });
  }
  const items = [...merged.entries()]
    .map(([product_id, qty]) => ({ product_id, qty }))
    .sort((a, b) => a.product_id - b.product_id);
  if (items.length === 0 && errors.length === 0) {
    need('items', 'items must contain at least one valid line.');
  }

  // ---- customer ----
  const c = body.customer || {};
  const name = s(c.name);
  const phone = validPhoneDigits(c.phone);
  const address = s(c.address);
  const city = s(c.city);
  if (name.length < 3 || name.length > 100) need('customer.name', 'Name must be 3–100 characters.');
  if (!phone) need('customer.phone', 'Phone must be an 11-digit Pakistani mobile number starting with 03.');
  if (address.length < 8 || address.length > 500) need('customer.address', 'Address must be 8–500 characters.');
  if (city.length < 2 || city.length > 100) need('customer.city', 'City must be 2–100 characters.');

  // ---- payment ----
  const payment_method = s(body.payment_method).toLowerCase();
  if (!PAYMENT_METHODS.includes(payment_method)) {
    need('payment_method', `payment_method must be one of: ${PAYMENT_METHODS.join(', ')}.`);
  }
  const transaction_reference = s(body.transaction_reference);
  if (PREPAID_METHODS.includes(payment_method)) {
    if (transaction_reference.length < 4 || transaction_reference.length > 64) {
      need('transaction_reference', 'A payment reference (min 4 characters) is required for JazzCash / Bank Transfer.');
    }
  }

  // customer_note (contract amendment P1, ACCEPTED): optional, untrusted plain text.
  // Trim; empty → NULL; max 500 chars; reject oversized server-side. Never influences
  // pricing, shipping, payment/fulfilment status, or authorization. Never rendered as HTML.
  let customer_note = null;
  if (body.customer_note !== undefined && body.customer_note !== null) {
    if (typeof body.customer_note !== 'string') {
      need('customer_note', 'customer_note must be a string or null.');
    } else {
      const trimmed = body.customer_note.trim();
      if (trimmed.length > 500) {
        need('customer_note', 'customer_note must be 500 characters or fewer.');
      } else {
        customer_note = trimmed.length ? trimmed : null;
      }
    }
  }

  // Optional Cloudflare Turnstile token (contract §4). Verified in the
  // handler only when TURNSTILE_SECRET_KEY is configured.
  const turnstile_token = s(body.turnstile_token).slice(0, 2048) || null;

  if (errors.length) return { ok: false, errors };

  // NOTE: any UNTRUSTED_FIELDS present in body are deliberately dropped here.
  return {
    ok: true,
    value: {
      idempotency_key,
      items,
      customer: { name, phone, address, city },
      payment_method,
      transaction_reference: PREPAID_METHODS.includes(payment_method) ? transaction_reference : null,
      customer_note,
      turnstile_token,
    },
  };
}

export { UNTRUSTED_FIELDS };

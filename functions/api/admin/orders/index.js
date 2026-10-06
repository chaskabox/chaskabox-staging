/**
 * GET /api/admin/orders
 * List orders with search + filters + pagination. Roles: owner, manager, fulfilment.
 *
 * Query params:
 *   q                 — search order_number / customer_name / customer_phone
 *   payment_status    — cod_due | awaiting_payment | payment_submitted | payment_verified | payment_rejected | refunded
 *   fulfilment_status — new | sourcing | packed | dispatched | delivered | cancelled
 *   method            — cod | jazzcash | bank_transfer
 *   date_from, date_to — YYYY-MM-DD (created_at range)
 *   page, per_page
 */
import { withAdmin, sb, json, pagination, sanitizeSearch } from '../_lib/auth.js';

const LIST_COLS = [
  'id', 'order_number', 'idempotency_key', 'user_id', 'customer_name', 'customer_phone',
  'customer_address', 'customer_city', 'payment_method', 'payment_status', 'fulfilment_status',
  'subtotal', 'delivery_fee', 'total', 'transaction_reference',
  'created_at', 'updated_at',
].join(',');

export const onRequestGet = withAdmin(['owner', 'manager', 'fulfilment'], async (context) => {
  const url = new URL(context.request.url);
  const sp = url.searchParams;
  const { page, per, rangeHeader } = pagination(url, 25, 100);

  const filters = [];
  const q = sanitizeSearch(sp.get('q'));
  if (q) {
    const esc = q.replace(/[%_]/g, '');
    filters.push(`or=(order_number.ilike.*${esc}*,customer_name.ilike.*${esc}*,customer_phone.ilike.*${esc}*)`);
  }
  const paymentStatus = sp.get('payment_status');
  if (paymentStatus) filters.push(`payment_status=eq.${encodeURIComponent(paymentStatus)}`);
  const fulfilStatus = sp.get('fulfilment_status');
  if (fulfilStatus) filters.push(`fulfilment_status=eq.${encodeURIComponent(fulfilStatus)}`);
  const method = sp.get('method');
  if (method) filters.push(`payment_method=eq.${encodeURIComponent(method)}`);
  const dateFrom = sp.get('date_from');
  if (dateFrom) filters.push(`created_at=gte.${encodeURIComponent(dateFrom)}T00:00:00`);
  const dateTo = sp.get('date_to');
  if (dateTo) filters.push(`created_at=lte.${encodeURIComponent(dateTo)}T23:59:59`);

  const query = [`select=${LIST_COLS}`, 'order=created_at.desc', ...filters].join('&');
  const { data, total } = await sb(context, `/rest/v1/orders?${query}`, {
    headers: { Range: rangeHeader },
    count: true,
  });

  return json({
    orders: data,
    page,
    per_page: per,
    total,
    total_pages: Math.ceil(total / per),
  });
});

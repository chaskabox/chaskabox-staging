/**
 * GET /api/admin/orders/export.csv
 * Download orders as CSV. Min role: manager (contract §3 — CSV contains customer PII).
 * Accepts the same filters as GET /api/admin/orders. Hard cap: 5,000 rows.
 * Audit action 'order.exported_csv' is a PROPOSED §5 addition (see CONTRACT_AMENDMENTS.md).
 */
import { withAdmin, sb, httpError, sanitizeSearch, audit } from '../_lib/auth.js';

const COLS = [
  'order_number', 'created_at', 'customer_name', 'customer_phone',
  'customer_address', 'customer_city', 'payment_method', 'payment_status', 'fulfilment_status',
  'subtotal', 'delivery_fee', 'total', 'transaction_reference',
];

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const onRequestGet = withAdmin(['owner', 'manager'], async (context, { user, role }) => {
  const url = new URL(context.request.url);
  const sp = url.searchParams;
  const filters = [];
  const q = sanitizeSearch(sp.get('q'));
  if (q) filters.push(`or=(order_number.ilike.*${q}*,customer_name.ilike.*${q}*,customer_phone.ilike.*${q}*)`);
  for (const [param, col] of [['payment_status', 'payment_status'], ['fulfilment_status', 'fulfilment_status'], ['method', 'payment_method']]) {
    const v = sp.get(param);
    if (v) filters.push(`${col}=eq.${encodeURIComponent(v)}`);
  }
  const dateFrom = sp.get('date_from');
  if (dateFrom) filters.push(`created_at=gte.${encodeURIComponent(dateFrom)}T00:00:00`);
  const dateTo = sp.get('date_to');
  if (dateTo) filters.push(`created_at=lte.${encodeURIComponent(dateTo)}T23:59:59`);

  const query = [`select=${COLS.join(',')}`, 'order=created_at.desc', ...filters].join('&');
  const data = await sb(context, `/rest/v1/orders?${query}`, {
    headers: { Range: '0-4999' },
  });
  if (!Array.isArray(data)) httpError('Export failed', 502, 'export_failed');

  const lines = [COLS.join(',')];
  for (const row of data) lines.push(COLS.map((c) => csvCell(row[c])).join(','));

  await audit(context, {
    actorId: user.id,
    actorRole: role,
    action: 'order.exported_csv', // PROPOSED §5 addition — see CONTRACT_AMENDMENTS.md
    entityType: 'order',
    entityId: 'bulk',
    before: null,
    after: { rows: data.length, filters: Object.fromEntries(sp.entries()) },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chaskabox-orders-${stamp}.csv"`,
    },
  });
});

/* GET /api/admin/attention
 * Small exception dashboard for owner/manager/fulfilment staff.
 * Computes actionable items from the most recent orders and notification outbox.
 */
import { withAdmin, sb, json } from './_lib/auth.js';

function ageMinutes(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 60000)) : 0;
}

function compactOrder(o, reason) {
  return {
    id: o.id,
    order_number: o.order_number,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    total: Number(o.total),
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    fulfilment_status: o.fulfilment_status,
    created_at: o.created_at,
    age_minutes: ageMinutes(o.created_at),
    reason,
  };
}

export const onRequestGet = withAdmin(['owner', 'manager', 'fulfilment'], async (context) => {
  const orders = await sb(context,
    '/rest/v1/orders?select=id,order_number,customer_name,customer_phone,total,payment_method,payment_status,fulfilment_status,created_at,email_sent,email_error,whatsapp_sent,whatsapp_error&order=created_at.desc&limit=150');

  const needs = [];
  let newOrders = 0;
  let paymentReview = 0;
  let notificationIssues = 0;
  let staleNew = 0;

  for (const o of orders || []) {
    if (o.fulfilment_status === 'new') newOrders++;
    if (['payment_submitted', 'pending_verification'].includes(o.payment_status)) {
      paymentReview++;
      needs.push(compactOrder(o, 'payment_review'));
    }
    const notificationFailed = (!o.email_sent && o.email_error) || (!o.whatsapp_sent && o.whatsapp_error);
    if (notificationFailed) {
      notificationIssues++;
      needs.push(compactOrder(o, 'notification_failed'));
    }
    if (o.fulfilment_status === 'new' && ageMinutes(o.created_at) >= 30) {
      staleNew++;
      needs.push(compactOrder(o, 'stale_new_order'));
    }
  }

  let outbox = { pending: 0, retry: 0, dead: 0 };
  let customerOutbox = { pending: 0, retry: 0, dead: 0 };
  try {
    const rows = await sb(context,
      '/rest/v1/notification_outbox?select=status&status=in.(pending,retry,dead)&limit=500');
    for (const row of rows || []) if (Object.hasOwn(outbox, row.status)) outbox[row.status]++;
  } catch {
    // Migration 013 may not yet be applied. Core dashboard still works.
  }
  try {
    const rows = await sb(context, '/rest/v1/customer_notification_outbox?select=status&status=in.(pending,retry,dead)&limit=500');
    for (const row of rows || []) if (Object.hasOwn(customerOutbox, row.status)) customerOutbox[row.status]++;
  } catch {
    // Migration 017 may not yet be applied.
  }

  // Deduplicate same order/reason combination and keep the list bounded.
  const seen = new Set();
  const deduped = needs.filter((x) => {
    const k = `${x.id}:${x.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 60);

  return json({
    generated_at: new Date().toISOString(),
    counts: {
      new_orders: newOrders,
      payment_review: paymentReview,
      notification_issues: notificationIssues,
      stale_new_orders: staleNew,
      outbox,
      customer_outbox: customerOutbox,
    },
    needs_attention: deduped,
  });
});

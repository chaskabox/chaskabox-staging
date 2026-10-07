import { withAdmin, sb, json } from './_lib/auth.js';

export const onRequestGet = withAdmin(['owner','manager','fulfilment'], async (context) => {
  const url = new URL(context.request.url);
  const days = Math.min(365, Math.max(1, Number.parseInt(url.searchParams.get('days') || '30', 10) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const orders = await sb(context, `/rest/v1/orders?created_at=gte.${encodeURIComponent(since)}&select=id,total,payment_method,payment_status,fulfilment_status,created_at&limit=5000`);
  let grossOrderValue = 0, recognizedSales = 0, paidPrepaid = 0, deliveredCod = 0, pendingPayment = 0;
  let cancelled = 0, newOrders = 0, delivered = 0;
  for (const o of orders || []) {
    const total = Number(o.total || 0);
    if (o.fulfilment_status === 'cancelled') { cancelled++; continue; }
    grossOrderValue += total;
    if (o.fulfilment_status === 'new') newOrders++;
    if (o.fulfilment_status === 'delivered') delivered++;
    const isRefunded = o.payment_status === 'refunded';
    if (o.payment_method === 'cod' && o.fulfilment_status === 'delivered' && !isRefunded) {
      deliveredCod += total; recognizedSales += total;
    } else if (o.payment_method !== 'cod' && o.payment_status === 'payment_verified' && !isRefunded) {
      paidPrepaid += total; recognizedSales += total;
    } else if (o.payment_method !== 'cod' && ['awaiting_payment','payment_submitted'].includes(o.payment_status)) {
      pendingPayment += total;
    }
  }
  return json({
    period_days: days,
    orders: (orders || []).length,
    new_orders: newOrders,
    delivered_orders: delivered,
    cancelled_orders: cancelled,
    gross_order_value_pkr: grossOrderValue,
    recognized_sales_pkr: recognizedSales,
    verified_prepaid_sales_pkr: paidPrepaid,
    delivered_cod_sales_pkr: deliveredCod,
    pending_prepaid_value_pkr: pendingPayment,
  });
});

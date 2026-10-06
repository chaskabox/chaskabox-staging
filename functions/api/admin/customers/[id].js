/**
 * GET /api/admin/customers/:id
 * Full customer profile (PII) + order history. Min role: manager (contract §3).
 * :id is the customers.id UUID (contract §2.5).
 */
import { withAdmin, sb, json, httpError } from '../_lib/auth.js';

export const onRequestGet = withAdmin(['owner', 'manager'], async (context) => {
  const id = String(context.params.id || '');
  if (!/^[0-9a-f-]{8,36}$/i.test(id)) httpError('Invalid customer id', 400, 'invalid_id');

  const rows = await sb(context, `/rest/v1/customers?id=eq.${encodeURIComponent(id)}&select=id,user_id,name,phone,created_at`);
  const customer = rows && rows[0];
  if (!customer) httpError('Customer not found', 404, 'not_found');

  const cond = customer.user_id
    ? `user_id=eq.${encodeURIComponent(customer.user_id)}`
    : `customer_phone=eq.${encodeURIComponent(customer.phone || '')}`;
  const orders = (await sb(
    context,
    `/rest/v1/orders?${cond}&select=id,order_number,customer_name,customer_city,payment_method,payment_status,fulfilment_status,total,created_at&order=created_at.desc&limit=200`
  )) || [];

  const lifetime_spend = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

  return json({
    customer: {
      ...customer,
      order_count: orders.length,
      lifetime_spend,
      first_order_at: orders.length ? orders[orders.length - 1].created_at : null,
      last_order_at: orders.length ? orders[0].created_at : null,
    },
    orders: orders.map((o) => ({
      id: o.id, order_number: o.order_number, payment_method: o.payment_method,
      payment_status: o.payment_status, fulfilment_status: o.fulfilment_status,
      total: o.total, created_at: o.created_at,
    })),
  });
});

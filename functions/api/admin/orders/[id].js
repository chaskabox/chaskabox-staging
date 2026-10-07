/**
 * GET /api/admin/orders/:id
 * Full order detail: order row + immutable line-item snapshots + audit trail.
 * Roles: owner, manager, fulfilment.
 */
import { withAdmin, sb, json, httpError } from '../_lib/auth.js';

export const onRequestGet = withAdmin(['owner', 'manager', 'fulfilment'], async (context) => {
  const id = context.params.id;
  if (!id) httpError('Order id required', 400);

  const orders = await sb(context, `/rest/v1/orders?id=eq.${encodeURIComponent(id)}&select=*`);
  const order = orders && orders[0];
  if (!order) httpError('Order not found', 404, 'not_found');

  const items = await sb(context, `/rest/v1/order_items?order_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.asc`);

  const history = await sb(
    context,
    `/rest/v1/audit_log?entity_type=eq.order&entity_id=eq.${encodeURIComponent(String(order.id))}&select=actor_id,actor_role,action,before_data,after_data,created_at&order=created_at.asc&limit=200`
  );

  return json({ order, items: items || [], history: history || [] });
});

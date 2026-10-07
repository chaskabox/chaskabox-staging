/**
 * POST /api/admin/orders/:id/notify
 * Retry owner notifications (email + WhatsApp) for an order.
 * Does NOT create a duplicate order — only re-sends notifications.
 * Roles: owner, manager.
 */
import { withAdmin, sb, json, httpError } from '../../_lib/auth.js';
import { notifyOwner } from '../../../_lib/notify.js';

export const onRequestPost = withAdmin(['owner', 'manager'], async (context) => {
  const id = context.params.id;
  if (!id) httpError('Order id required', 400);

  const { env } = context;

  // Fetch order
  const orders = await sb(context, `/rest/v1/orders?id=eq.${encodeURIComponent(id)}&select=*`);
  const order = orders && orders[0];
  if (!order) httpError('Order not found', 404, 'not_found');

  // Fetch items for notification
  const items = await sb(context, `/rest/v1/order_items?order_id=eq.${encodeURIComponent(id)}&select=*`);

  const notifOrder = {
    ...order,
    items: (items || []).map(it => ({
      product_name: it.product_name,
      product_pack: it.product_pack,
      qty: it.qty,
      unit_price: Number(it.unit_price),
    })),
  };

  // Send notifications (notifyOwner never throws)
  const notif = await notifyOwner(env, notifOrder);

  // Update order notification status
  try {
    await sb(context, `/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        email_sent: notif.email_sent,
        email_error: notif.email_error,
        email_sent_at: notif.email_sent ? new Date().toISOString() : null,
        whatsapp_sent: notif.whatsapp_sent,
        whatsapp_error: notif.whatsapp_error,
        whatsapp_sent_at: notif.whatsapp_sent ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (dbErr) {
    console.error('[admin:notify] DB update failed:', dbErr.message);
  }

  return json({
    order_id: id,
    order_number: order.order_number,
    email_sent: notif.email_sent,
    email_error: notif.email_error,
    whatsapp_sent: notif.whatsapp_sent,
    whatsapp_error: notif.whatsapp_error,
  });
});

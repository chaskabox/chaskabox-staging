import { sb } from './auth.js';

export async function enqueueCustomerNotification(context, order, eventType, eventValue, message) {
  if (!order?.id || !message) return { queued: false };
  const eventKey = `${order.id}:${eventType}:${eventValue}`.slice(0, 240);
  try {
    await sb(context, `/rest/v1/customer_notification_outbox?on_conflict=event_key`, {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: { order_id: order.id, event_type: eventType, event_key: eventKey, message: String(message).slice(0, 2000) },
    });
    return { queued: true, eventKey };
  } catch (err) {
    // Transactional notification reliability must never roll back an order/admin action.
    console.error('[customer-notify] enqueue failed', err?.status || err?.message || err);
    return { queued: false, eventKey };
  }
}

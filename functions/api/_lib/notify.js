/* ChaskaBox V3 — Owner notification library (email + WhatsApp via WAHA)
 *
 * Called AFTER order is committed to database. Notification failure
 * must NEVER cause the order to disappear or create duplicates.
 *
 * All functions catch their own errors and return { sent, error }.
 * They NEVER throw.
 *
 * Env vars (all optional — graceful degradation if unset):
 *   OWNER_ORDER_EMAIL   — owner email for order notifications
 *   RESEND_API_KEY      — Resend API key for sending email
 *   WAHA_API_URL        — WAHA server URL (e.g. http://130.61.106.54:3000)
 *   WAHA_API_KEY        — WAHA API key (server-side only, never frontend)
 *   OWNER_WHATSAPP      — owner WhatsApp number (e.g. 923320005381)
 *   ADMIN_BASE_URL      — base URL for admin order links
 */

export async function sendOwnerEmail(env, order) {
  const to = env.OWNER_ORDER_EMAIL;
  const apiKey = env.RESEND_API_KEY;

  if (!to) {
    return { sent: false, error: 'OWNER_ORDER_EMAIL not configured' };
  }
  if (!apiKey) {
    // Log for now; owner can configure Resend later
    console.log(`[notify] Email not sent (no RESEND_API_KEY). Order ${order.order_number} -> ${to}`);
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const items = (order.items || []).map(it =>
      `• ${it.product_name} (${it.product_pack || ''}) x${it.qty} — Rs.${it.unit_price * it.qty}`
    ).join('\n');

    const subject = `🛒 New ChaskaBox Order ${order.order_number} — Rs.${order.total}`;
    const adminUrl = `${env.ADMIN_BASE_URL || 'https://chaskabox-staging.pages.dev'}/admin.html#order-${order.order_id}`;

    const body = `New order received!

Order: ${order.order_number}
Date: ${new Date(order.created_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}

Customer: ${order.customer_name}
Phone: ${order.customer_phone}
${order.customer_email ? `Email: ${order.customer_email}\n` : ''}Address: ${order.customer_address}, ${order.customer_city}
${order.customer_note ? `Note: ${order.customer_note}\n` : ''}Items:
${items}

Subtotal: Rs.${order.subtotal}
Delivery: Rs.${order.delivery_fee}
Total: Rs.${order.total}

Payment: ${order.payment_method}
Payment status: ${order.payment_status}
${order.transaction_reference ? `Reference: ${order.transaction_reference}\n` : ''}Fulfilment: ${order.fulfilment_status}

Admin: ${adminUrl}`;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ChaskaBox <orders@chaskabox.online>',
        to: [to],
        subject,
        text: body,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[notify] Resend failed: ${resp.status} ${err}`);
      return { sent: false, error: `Resend ${resp.status}` };
    }

    console.log(`[notify] Email sent for order ${order.order_number} to ${to}`);
    return { sent: true, error: null };
  } catch (err) {
    console.error(`[notify] Email error: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

export async function sendOwnerWhatsApp(env, order) {
  const apiUrl = env.WAHA_API_URL;
  const apiKey = env.WAHA_API_KEY;
  const to = env.OWNER_WHATSAPP;

  if (!apiUrl || !apiKey || !to) {
    return { sent: false, error: 'WhatsApp (WAHA) not configured' };
  }

  try {
    const msg = `🛒 *New ChaskaBox Order*
Order: #${order.order_number}
Customer: ${order.customer_name}
Phone: ${order.customer_phone}
Total: Rs.${order.total}
Payment: ${order.payment_method}
Status: ${order.payment_status}
Open Admin: ${env.ADMIN_BASE_URL || 'https://chaskabox-staging.pages.dev'}/admin.html`;

    const resp = await fetch(`${apiUrl}/api/sendText`, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId: to.replace(/[^0-9]/g, ''),
        text: msg,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[notify] WAHA failed: ${resp.status} ${err}`);
      return { sent: false, error: `WAHA ${resp.status}` };
    }

    const data = await resp.json();
    if (!data.sent) {
      console.error(`[notify] WAHA send failed: ${data.error || 'unknown'}`);
      return { sent: false, error: data.error || 'WAHA send failed' };
    }

    console.log(`[notify] WhatsApp (WAHA) sent for order ${order.order_number}`);
    return { sent: true, error: null };
  } catch (err) {
    console.error(`[notify] WhatsApp (WAHA) error: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

/* Send both notifications. Never throws. Returns status for DB logging. */
export async function notifyOwner(env, order) {
  const [email, whatsapp] = await Promise.all([
    sendOwnerEmail(env, order),
    sendOwnerWhatsApp(env, order),
  ]);
  return {
    email_sent: email.sent,
    email_error: email.error,
    whatsapp_sent: whatsapp.sent,
    whatsapp_error: whatsapp.error,
  };
}

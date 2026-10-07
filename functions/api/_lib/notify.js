/* ChaskaBox — owner notifications (Resend + self-hosted WAHA)
 *
 * Safe contract:
 * - Call only after an order is committed.
 * - Never throws; every channel returns { sent, error, skipped }.
 * - Private credentials stay server-side.
 *
 * Env vars:
 *   OWNER_ORDER_EMAIL   optional owner email
 *   RESEND_API_KEY      optional Resend key
 *   RESEND_FROM_EMAIL   optional verified sender
 *   WAHA_API_URL        optional WAHA base URL, e.g. https://waha.example.com
 *   WAHA_API_KEY        optional WAHA X-Api-Key
 *   WAHA_SESSION        optional WAHA session, defaults to "default"
 *   OWNER_WHATSAPP      optional owner number, international digits; + accepted
 *   ADMIN_BASE_URL      optional admin base URL
 */

function cleanBaseUrl(value, fallback) {
  return String(value || fallback || '').replace(/\/+$/, '');
}

function orderIdentity(order) {
  return String(order?.id ?? order?.order_id ?? order?.order_number ?? 'unknown');
}

function adminOrderUrl(env, order) {
  const base = cleanBaseUrl(env.ADMIN_BASE_URL, 'https://chaskabox-staging.pages.dev');
  const id = order?.id ?? order?.order_id;
  return id ? `${base}/admin.html#order-${encodeURIComponent(id)}` : `${base}/admin.html`;
}

function orderDate(order) {
  const dt = order?.created_at ? new Date(order.created_at) : new Date();
  const safe = Number.isNaN(dt.getTime()) ? new Date() : dt;
  return safe.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
}

function itemLines(order) {
  return (order?.items || []).map((it) => {
    const qty = Number(it.qty ?? it.quantity ?? 0);
    const price = Number(it.unit_price ?? 0);
    const pack = it.product_pack ?? it.pack ?? '';
    return `• ${it.product_name || 'Item'}${pack ? ` (${pack})` : ''} x${qty} — Rs.${price * qty}`;
  }).join('\n');
}

function normalizeWhatsAppChatId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.endsWith('@c.us') || raw.endsWith('@g.us')) return raw;
  let digits = raw.replace(/\D/g, '');
  // ChaskaBox is Pakistan-based: accept common local 03xxxxxxxxx format too.
  if (digits.startsWith('0') && digits.length === 11) digits = `92${digits.slice(1)}`;
  return digits ? `${digits}@c.us` : '';
}

function ownerText(env, order) {
  return `🛒 *New ChaskaBox Order*\n` +
    `Order: #${order.order_number}\n` +
    `Customer: ${order.customer_name}\n` +
    `Phone: ${order.customer_phone}\n` +
    `Total: Rs.${order.total}\n` +
    `Payment: ${order.payment_method}\n` +
    `Status: ${order.payment_status}\n` +
    `Open Admin: ${adminOrderUrl(env, order)}`;
}

export async function sendOwnerEmail(env, order) {
  const to = env.OWNER_ORDER_EMAIL;
  const apiKey = env.RESEND_API_KEY;

  if (!to || !apiKey) {
    return { sent: false, skipped: true, error: !to ? 'OWNER_ORDER_EMAIL not configured' : 'RESEND_API_KEY not configured' };
  }

  try {
    const items = itemLines(order);
    const subject = `🛒 New ChaskaBox Order ${order.order_number} — Rs.${order.total}`;
    const body = `New order received!\n\n` +
      `Order: ${order.order_number}\n` +
      `Date: ${orderDate(order)}\n\n` +
      `Customer: ${order.customer_name}\n` +
      `Phone: ${order.customer_phone}\n` +
      `${order.customer_email ? `Email: ${order.customer_email}\n` : ''}` +
      `Address: ${order.customer_address || ''}${order.customer_city ? `, ${order.customer_city}` : ''}\n` +
      `${order.customer_note ? `Note: ${order.customer_note}\n` : ''}\n` +
      `Items:\n${items}\n\n` +
      `Subtotal: Rs.${order.subtotal}\n` +
      `Delivery: Rs.${order.delivery_fee}\n` +
      `Total: Rs.${order.total}\n\n` +
      `Payment: ${order.payment_method}\n` +
      `Payment status: ${order.payment_status}\n` +
      `${order.transaction_reference ? `Reference: ${order.transaction_reference}\n` : ''}` +
      `Fulfilment: ${order.fulfilment_status}\n\n` +
      `Admin: ${adminOrderUrl(env, order)}`;

    const idempotencyKey = `chaskabox-owner-order-${orderIdentity(order)}`.slice(0, 240);
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'ChaskaBox <orders@chaskabox.online>',
        to: [to],
        subject,
        text: body,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[notify] Resend failed: ${resp.status} ${errText.slice(0, 500)}`);
      return { sent: false, skipped: false, error: `Resend ${resp.status}` };
    }
    return { sent: true, skipped: false, error: null };
  } catch (err) {
    console.error(`[notify] Email error: ${err?.message || err}`);
    return { sent: false, skipped: false, error: String(err?.message || err) };
  }
}

export async function sendOwnerWhatsApp(env, order) {
  const baseUrl = cleanBaseUrl(env.WAHA_API_URL);
  const apiKey = env.WAHA_API_KEY;
  const session = env.WAHA_SESSION || 'default';
  const chatId = normalizeWhatsAppChatId(env.OWNER_WHATSAPP);

  if (!baseUrl || !apiKey || !chatId) {
    return { sent: false, skipped: true, error: 'WAHA not fully configured' };
  }

  try {
    const endpoint = baseUrl.endsWith('/api') ? `${baseUrl}/sendText` : `${baseUrl}/api/sendText`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        session,
        chatId,
        text: ownerText(env, order),
        linkPreview: false,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[notify] WAHA failed: ${resp.status} ${errText.slice(0, 500)}`);
      return { sent: false, skipped: false, error: `WAHA ${resp.status}` };
    }
    return { sent: true, skipped: false, error: null };
  } catch (err) {
    console.error(`[notify] WAHA error: ${err?.message || err}`);
    return { sent: false, skipped: false, error: String(err?.message || err) };
  }
}

/* Send configured channels in parallel. Optional skip flags allow retry workers
 * to avoid resending channels that are already recorded as successful.
 */
export async function notifyOwner(env, order, options = {}) {
  const emailPromise = options.skipEmail
    ? Promise.resolve({ sent: false, skipped: true, error: null })
    : sendOwnerEmail(env, order);
  const whatsappPromise = options.skipWhatsApp
    ? Promise.resolve({ sent: false, skipped: true, error: null })
    : sendOwnerWhatsApp(env, order);

  const [email, whatsapp] = await Promise.all([emailPromise, whatsappPromise]);
  return {
    email_sent: email.sent,
    email_skipped: email.skipped,
    email_error: email.error,
    whatsapp_sent: whatsapp.sent,
    whatsapp_skipped: whatsapp.skipped,
    whatsapp_error: whatsapp.error,
  };
}

export async function sendCustomerWhatsApp(env, order, message) {
  const baseUrl = cleanBaseUrl(env.WAHA_API_URL);
  const apiKey = env.WAHA_API_KEY;
  const session = env.WAHA_SESSION || 'default';
  const chatId = normalizeWhatsAppChatId(order?.customer_phone);
  if (!baseUrl || !apiKey || !chatId) return { sent:false, skipped:true, error:'WAHA/customer phone not configured' };
  const trackingBase = cleanBaseUrl(env.PUBLIC_BASE_URL || env.ADMIN_BASE_URL || 'https://chaskabox.online');
  const tracking = order?.order_number ? `${trackingBase}/track-order.html?order=${encodeURIComponent(order.order_number)}` : trackingBase;
  const text = message || `ChaskaBox update\nOrder: ${order.order_number}\nStatus: ${String(order.fulfilment_status || '').replaceAll('_',' ')}\nTrack: ${tracking}`;
  try {
    const endpoint = baseUrl.endsWith('/api') ? `${baseUrl}/sendText` : `${baseUrl}/api/sendText`;
    const resp = await fetch(endpoint,{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json','X-Api-Key':apiKey},body:JSON.stringify({session,chatId,text,linkPreview:false})});
    if(!resp.ok) return {sent:false,skipped:false,error:`WAHA ${resp.status}`};
    return {sent:true,skipped:false,error:null};
  } catch(err){ return {sent:false,skipped:false,error:String(err?.message||err)}; }
}

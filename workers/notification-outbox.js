/* ChaskaBox notification-outbox scheduled Worker.
 *
 * Bind secrets/vars server-side:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY, OWNER_ORDER_EMAIL, RESEND_FROM_EMAIL (optional email)
 *   WAHA_API_URL, WAHA_API_KEY, WAHA_SESSION, OWNER_WHATSAPP (optional WAHA)
 *   ADMIN_BASE_URL
 *
 * Schedule: every minute is adequate for a small store.
 */
import { notifyOwner, sendCustomerWhatsApp } from '../functions/api/_lib/notify.js';

function sbBase(env) {
  return String(env.SUPABASE_URL || '').replace(/\/+$/, '');
}

function sbHeaders(env, extra = {}) {
  return {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sb(env, path, init = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service configuration missing');
  const resp = await fetch(`${sbBase(env)}${path}`, {
    ...init,
    headers: sbHeaders(env, init.headers || {}),
  });
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

function emailConfigured(env) {
  return !!(env.OWNER_ORDER_EMAIL && env.RESEND_API_KEY);
}
function whatsappConfigured(env) {
  return !!(env.WAHA_API_URL && env.WAHA_API_KEY && env.OWNER_WHATSAPP);
}

async function unlockStale(env) {
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const q = `/rest/v1/notification_outbox?status=eq.processing&locked_at=lt.${encodeURIComponent(stale)}`;
  try {
    await sb(env, q, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'retry', locked_at: null, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error('[outbox] stale unlock failed', err.message);
  }
}

async function claim(env, row) {
  const q = `/rest/v1/notification_outbox?id=eq.${encodeURIComponent(row.id)}&status=in.(pending,retry)&select=*`;
  const result = await sb(env, q, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'processing',
      attempts: Number(row.attempts || 0) + 1,
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  return result?.[0] || null;
}

async function loadOrder(env, orderId) {
  const orders = await sb(env, `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`);
  const order = orders?.[0];
  if (!order) return null;
  const items = await sb(env, `/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}&select=product_name,pack,unit_price,quantity,line_total`);
  return {
    ...order,
    items: (items || []).map((it) => ({
      product_name: it.product_name,
      product_pack: it.pack,
      qty: Number(it.quantity),
      unit_price: Number(it.unit_price),
    })),
  };
}

async function patchOrderNotification(env, order, notif) {
  const emailSent = !!order.email_sent || !!notif.email_sent;
  const waSent = !!order.whatsapp_sent || !!notif.whatsapp_sent;
  const patch = {
    email_sent: emailSent,
    email_error: emailSent ? null : notif.email_error,
    email_sent_at: order.email_sent_at || (notif.email_sent ? new Date().toISOString() : null),
    whatsapp_sent: waSent,
    whatsapp_error: waSent ? null : notif.whatsapp_error,
    whatsapp_sent_at: order.whatsapp_sent_at || (notif.whatsapp_sent ? new Date().toISOString() : null),
    updated_at: new Date().toISOString(),
  };
  await sb(env, `/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  return patch;
}

async function finishOutbox(env, id, patch) {
  await sb(env, `/rest/v1/notification_outbox?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, locked_at: null, updated_at: new Date().toISOString() }),
  });
}

async function processRow(env, row) {
  const claimed = await claim(env, row);
  if (!claimed) return;

  try {
    const order = await loadOrder(env, claimed.order_id);
    if (!order) {
      await finishOutbox(env, claimed.id, { status: 'dead', last_error: 'Order not found' });
      return;
    }

    const needEmail = emailConfigured(env) && !order.email_sent;
    const needWhatsApp = whatsappConfigured(env) && !order.whatsapp_sent;

    // If direct checkout/admin notification already completed all configured channels,
    // the outbox is simply acknowledged without sending duplicates.
    if (!needEmail && !needWhatsApp) {
      await finishOutbox(env, claimed.id, { status: 'done', last_error: null });
      return;
    }

    const notif = await notifyOwner(env, order, {
      skipEmail: !needEmail,
      skipWhatsApp: !needWhatsApp,
    });
    const state = await patchOrderNotification(env, order, notif);

    const emailOk = !emailConfigured(env) || state.email_sent;
    const waOk = !whatsappConfigured(env) || state.whatsapp_sent;
    if (emailOk && waOk) {
      await finishOutbox(env, claimed.id, { status: 'done', last_error: null });
      return;
    }

    const attempts = Number(claimed.attempts || 1);
    if (attempts >= 10) {
      await finishOutbox(env, claimed.id, {
        status: 'dead',
        last_error: [notif.email_error, notif.whatsapp_error].filter(Boolean).join(' | ').slice(0, 1000),
      });
      return;
    }

    const delayMin = Math.min(60, 2 ** Math.min(attempts, 6));
    await finishOutbox(env, claimed.id, {
      status: 'retry',
      last_error: [notif.email_error, notif.whatsapp_error].filter(Boolean).join(' | ').slice(0, 1000),
      next_attempt_at: new Date(Date.now() + delayMin * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[outbox] row failed', claimed.id, err.message);
    const attempts = Number(claimed.attempts || 1);
    const status = attempts >= 10 ? 'dead' : 'retry';
    const delayMin = Math.min(60, 2 ** Math.min(attempts, 6));
    await finishOutbox(env, claimed.id, {
      status,
      last_error: String(err.message || err).slice(0, 1000),
      next_attempt_at: new Date(Date.now() + delayMin * 60 * 1000).toISOString(),
    }).catch((finishErr) => console.error('[outbox] finish failed', finishErr.message));
  }
}


async function unlockStaleCustomer(env) {
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const q = `/rest/v1/customer_notification_outbox?status=eq.processing&locked_at=lt.${encodeURIComponent(stale)}`;
  try {
    await sb(env, q, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'retry', locked_at: null, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  } catch (err) { console.error('[outbox] customer stale unlock failed', err.message); }
}

async function claimCustomer(env, row) {
  const q = `/rest/v1/customer_notification_outbox?id=eq.${encodeURIComponent(row.id)}&status=in.(pending,retry)&select=*`;
  const result = await sb(env, q, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'processing', attempts: Number(row.attempts || 0) + 1, locked_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  return result?.[0] || null;
}

async function finishCustomerOutbox(env, id, patch) {
  await sb(env, `/rest/v1/customer_notification_outbox?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, locked_at: null, updated_at: new Date().toISOString() }),
  });
}

async function processCustomerRow(env, row) {
  const claimed = await claimCustomer(env, row);
  if (!claimed) return;
  try {
    const order = await loadOrder(env, claimed.order_id);
    if (!order) { await finishCustomerOutbox(env, claimed.id, { status: 'dead', last_error: 'Order not found' }); return; }
    const result = await sendCustomerWhatsApp(env, order, claimed.message);
    if (result.sent) { await finishCustomerOutbox(env, claimed.id, { status: 'done', last_error: null }); return; }
    const attempts = Number(claimed.attempts || 1);
    const configured = !!(env.WAHA_API_URL && env.WAHA_API_KEY);
    if (attempts >= 10) { await finishCustomerOutbox(env, claimed.id, { status: 'dead', last_error: String(result.error || (configured ? 'Send failed' : 'WAHA not configured')).slice(0,1000) }); return; }
    const delayMin = Math.min(60, 2 ** Math.min(attempts, 6));
    await finishCustomerOutbox(env, claimed.id, { status: 'retry', last_error: String(result.error || 'Send failed').slice(0,1000), next_attempt_at: new Date(Date.now()+delayMin*60000).toISOString() });
  } catch (err) {
    const attempts = Number(claimed.attempts || 1);
    const status = attempts >= 10 ? 'dead' : 'retry';
    const delayMin = Math.min(60, 2 ** Math.min(attempts, 6));
    await finishCustomerOutbox(env, claimed.id, { status, last_error: String(err.message || err).slice(0,1000), next_attempt_at: new Date(Date.now()+delayMin*60000).toISOString() }).catch(()=>{});
  }
}

async function runCustomer(env) {
  await unlockStaleCustomer(env);
  const now = new Date().toISOString();
  const rows = await sb(env, `/rest/v1/customer_notification_outbox?status=in.(pending,retry)&next_attempt_at=lte.${encodeURIComponent(now)}&order=created_at.asc&limit=25&select=*`);
  for (const row of rows || []) await processCustomerRow(env, row);
}

async function run(env) {
  await unlockStale(env);
  const now = new Date().toISOString();
  const rows = await sb(env,
    `/rest/v1/notification_outbox?status=in.(pending,retry)&next_attempt_at=lte.${encodeURIComponent(now)}&order=created_at.asc&limit=25&select=*`);
  for (const row of rows || []) await processRow(env, row);
  await runCustomer(env);
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(run(env));
  },
  async fetch(request, env) {
    // Optional authenticated health/run endpoint for staging checks.
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname === '/run' && env.OUTBOX_RUN_SECRET) {
      if (request.headers.get('Authorization') !== `Bearer ${env.OUTBOX_RUN_SECRET}`) return new Response('Unauthorized', { status: 401 });
      await run(env);
      return new Response('processed');
    }
    return new Response('Not found', { status: 404 });
  },
};

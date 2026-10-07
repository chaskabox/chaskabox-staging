/**
 * POST /api/admin/ai — ChaskaBox Admin Copilot, DRAFT/INSIGHT ONLY.
 * Uses Cloudflare Workers AI binding (context.env.AI), so no provider API key
 * is exposed or required. AI has no write capability.
 */
import {
  withAdmin, json, httpError, readJson, audit, distributedRateLimit, sb,
} from './_lib/auth.js';
import { runTextAI, aiAvailable, selectedTextModel } from '../_lib/ai.js';

const ALLOWED_TASKS = new Set([
  'general_draft',
  'product_description',
  'seo_meta',
  'category_tags',
  'box_ideas',
  'faq_reply',
  'support_reply',
  'merchandising',
  'sales_summary',
  'attention_summary',
  'catalogue_summary',
]);

const SENSITIVE_INSIGHT_TASKS = new Set(['sales_summary', 'attention_summary']);

const BLOCKLIST = [
  /\bpublish\b/i, /go\s*live/i, /\bdeploy\b/i,
  /change\s+(?:the\s+)?price|set\s+(?:the\s+)?price|update\s+(?:the\s+)?price/i,
  /verify.*payment|payment.*verif|mark.*paid/i,
  /\brefund\b/i, /\bcancel\b.*order|order.*\bcancel/i,
  /\bdelete\b/i, /\bremove\b.*product/i,
  /\brole\b/i, /permission/i, /make.*admin/i, /promote/i,
  /service.?role|secret|api.?key|password|otp/i,
];

const TASK_PROMPTS = {
  general_draft: 'Help with a safe ChaskaBox admin drafting task. Produce text/advice only; never claim that you changed the store.',
  product_description: 'Draft a concise, appetizing product description (40-70 words, Roman Urdu-friendly tone) for a Pakistani snack-store product.',
  seo_meta: 'Draft an SEO title (<=60 chars) and meta description (<=155 chars) for the product page.',
  category_tags: 'Suggest up to 8 useful category/flavour/search tags for merchandising this product.',
  box_ideas: 'Suggest 3 Chaska Box themes (name + 1-line concept each) using only the supplied products.',
  faq_reply: 'Draft a helpful FAQ answer in friendly Roman Urdu + simple English.',
  support_reply: 'Draft a polite customer-support reply in Roman Urdu + simple English using only confirmed facts.',
  merchandising: 'Suggest homepage merchandising using only the supplied catalogue context. Do not call anything a bestseller without sales data.',
  sales_summary: 'Explain the supplied seven-day commerce metrics. Clearly distinguish gross order value from recognized sales and pending prepaid value. Highlight practical observations without inventing causes.',
  attention_summary: 'Summarize the supplied operational exceptions into a short prioritized action list.',
  catalogue_summary: 'Summarize the supplied catalogue state: visible/draft/hidden/archived and stock-state counts; suggest safe content actions only.',
};

const SYSTEM_GUARDRAILS = [
  'You are ChaskaBox Admin Copilot. You output DRAFT TEXT, SUMMARIES, OR RECOMMENDATIONS ONLY.',
  'You cannot publish, change prices, verify payments, refund/cancel orders, delete products, deploy, or change roles/security.',
  'Never claim an action happened. Say what the admin can review/do instead.',
  'Never invent ingredients, allergens, stock quantities, bestseller/sales claims, discounts, customer data, or delivery promises.',
  'Use only the factual context supplied by the server/admin. If a fact is missing, say it is not confirmed.',
  'Do not output or request passwords, OTPs, service-role keys, API keys, bank/card credentials, or private customer information.',
  'Prefer concise Roman Urdu + simple English that an owner can act on quickly.',
].join('\n');

function redactAdminPII(input) {
  return String(input || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(/\b(?:\+?92|0)?3\d{9}\b/g, '[phone redacted]')
    .replace(/\b\d{5}-\d{7}-\d\b/g, '[cnic redacted]')
    .replace(/\bPK\d{2}[A-Z0-9]{4,30}\b/gi, '[iban redacted]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[long number redacted]')
    .replace(/(?:address|delivery address)\s*[:=-]\s*[^\n]{8,180}/gi, 'address: [redacted]');
}

function safeContext(value) {
  let raw;
  if (typeof value === 'string') raw = value;
  else { try { raw = JSON.stringify(value || {}); } catch { raw = '{}'; } }
  return redactAdminPII(raw).slice(0, 5000);
}

function counts(rows, key) {
  const out = {};
  for (const row of rows || []) {
    const k = String(row?.[key] ?? 'unknown');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

async function salesSnapshot(context) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const orders = await sb(context, `/rest/v1/orders?created_at=gte.${encodeURIComponent(since)}&select=id,total,payment_method,payment_status,fulfilment_status,created_at&order=created_at.desc&limit=1000`);
  const items = await sb(context, `/rest/v1/order_items?created_at=gte.${encodeURIComponent(since)}&select=order_id,product_id,product_name,quantity,line_total,created_at&limit=3000`);
  const liveOrders = (orders || []).filter((o) => o.fulfilment_status !== 'cancelled');
  const grossOrderValue = liveOrders.reduce((a, o) => a + Number(o.total || 0), 0);
  const recognizedOrders = liveOrders.filter((o) =>
    (o.payment_method === 'cod' && o.fulfilment_status === 'delivered' && o.payment_status !== 'refunded') ||
    (o.payment_method !== 'cod' && o.payment_status === 'payment_verified')
  );
  const recognizedSales = recognizedOrders.reduce((a, o) => a + Number(o.total || 0), 0);
  const pendingPrepaid = liveOrders.filter((o) => o.payment_method !== 'cod' && ['awaiting_payment','payment_submitted'].includes(o.payment_status)).reduce((a,o)=>a+Number(o.total||0),0);
  const recognizedIds = new Set(recognizedOrders.map(o=>String(o.id)));
  const top = new Map();
  for (const i of items || []) {
    if (!recognizedIds.has(String(i.order_id))) continue;
    const k = String(i.product_name || `Product ${i.product_id || ''}`).slice(0, 120);
    const x = top.get(k) || { quantity: 0, line_total: 0 };
    x.quantity += Number(i.quantity || 0); x.line_total += Number(i.line_total || 0); top.set(k, x);
  }
  return {
    period: 'last_7_days',
    orders: (orders || []).length,
    non_cancelled_orders: liveOrders.length,
    gross_order_value_pkr: grossOrderValue,
    recognized_sales_pkr: recognizedSales,
    pending_prepaid_value_pkr: pendingPrepaid,
    average_recognized_order_pkr: recognizedOrders.length ? Math.round(recognizedSales / recognizedOrders.length) : 0,
    payment_methods: counts(orders, 'payment_method'),
    payment_statuses: counts(orders, 'payment_status'),
    fulfilment_statuses: counts(orders, 'fulfilment_status'),
    top_items_by_quantity: [...top.entries()].map(([name, v]) => ({ name, ...v })).sort((a,b) => b.quantity-a.quantity).slice(0, 8),
  };
}

async function attentionSnapshot(context) {
  const orders = await sb(context, '/rest/v1/orders?select=id,payment_status,fulfilment_status,created_at,email_sent,email_error,whatsapp_sent,whatsapp_error&order=created_at.desc&limit=200');
  let paymentReview=0, notificationIssues=0, staleNew=0, newOrders=0;
  const now=Date.now();
  for(const o of orders||[]){
    if(o.fulfilment_status==='new')newOrders++;
    if(['payment_submitted','pending_verification'].includes(o.payment_status))paymentReview++;
    if((!o.email_sent&&o.email_error)||(!o.whatsapp_sent&&o.whatsapp_error))notificationIssues++;
    if(o.fulfilment_status==='new' && Number.isFinite(new Date(o.created_at).getTime()) && now-new Date(o.created_at).getTime()>=30*60000)staleNew++;
  }
  let outbox={pending:0,retry:0,dead:0}, customer_outbox={pending:0,retry:0,dead:0};
  try{const rows=await sb(context,'/rest/v1/notification_outbox?select=status&status=in.(pending,retry,dead)&limit=500');for(const r of rows||[])if(Object.hasOwn(outbox,r.status))outbox[r.status]++;}catch{}
  try{const rows=await sb(context,'/rest/v1/customer_notification_outbox?select=status&status=in.(pending,retry,dead)&limit=500');for(const r of rows||[])if(Object.hasOwn(customer_outbox,r.status))customer_outbox[r.status]++;}catch{}
  return {new_orders:newOrders,payment_review:paymentReview,notification_issues:notificationIssues,stale_new_orders:staleNew,outbox,customer_outbox};
}

async function catalogueSnapshot(context) {
  const rows = await sb(context, '/rest/v1/products?select=visibility,stock_state,is_bundle,category&limit=1000');
  return {
    total_products:(rows||[]).length,
    visibility:counts(rows,'visibility'),
    stock_state:counts(rows,'stock_state'),
    bundles:(rows||[]).filter(x=>x.is_bundle).length,
    top_categories:Object.entries(counts(rows,'category')).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([category,count])=>({category,count})),
  };
}

async function serverContextForTask(context, task) {
  if (task === 'sales_summary') return salesSnapshot(context);
  if (task === 'attention_summary') return attentionSnapshot(context);
  if (task === 'catalogue_summary') return catalogueSnapshot(context);
  return null;
}

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  if (!aiAvailable(context)) httpError('Free Workers AI binding is not configured', 503, 'ai_not_configured');
  const rl = await distributedRateLimit(context, `ai:${user.id}`, 20, 2);
  if (!rl.allowed) return json({ error: { code: 'RATE_LIMITED', message: 'AI draft limit reached. Try again shortly.' } }, 429, { 'Retry-After': String(rl.retryAfterSec || 30) });

  const body = await readJson(context.request, 10 * 1024);
  const task = String(body.task || 'general_draft').trim();
  if (!ALLOWED_TASKS.has(task)) httpError(`Unknown or disallowed task '${task}'`, 422, 'blocked_task');
  if (SENSITIVE_INSIGHT_TASKS.has(task) && !['owner','manager'].includes(role)) httpError('This insight is limited to owner/manager', 403, 'forbidden_role');

  const clientContext = safeContext(body.context);
  const combined = `${task}\n${clientContext}`.slice(0, 5200);
  if (BLOCKLIST.some((re) => re.test(combined))) {
    await audit(context,{actorId:user.id,actorRole:role,action:'ai.blocked',entityType:'ai',entityId:'n/a',after:{task,reason:'sensitive_action_request'}});
    httpError('Blocked: Copilot cannot execute or instruct sensitive store actions. It only drafts and summarizes.',422,'blocked_sensitive');
  }

  const serverContext = await serverContextForTask(context, task);
  const userText = [
    clientContext ? `Admin request/context: ${clientContext}` : '',
    serverContext ? `Trusted server metrics: ${JSON.stringify(serverContext)}` : '',
  ].filter(Boolean).join('\n');

  try {
    const result = await runTextAI(context, {
      system: `${SYSTEM_GUARDRAILS}\n\nTask: ${TASK_PROMPTS[task]}`,
      user: userText || `Perform task: ${task}`,
      maxTokens: task.endsWith('_summary') ? 420 : 600,
      temperature: task.endsWith('_summary') ? 0.15 : 0.45,
    });
    await audit(context,{actorId:user.id,actorRole:role,action:'ai.draft_generated',entityType:'ai',entityId:'n/a',after:{task,draft_chars:result.text.length,model:result.model}});
    return json({task,draft:result.text,model:result.model,source:serverContext?'trusted_server_metrics':'admin_supplied_context',warnings:['DRAFT/INSIGHT ONLY — nothing was changed or published.','Verify factual product claims before using generated copy.']});
  } catch (error) {
    console.error('[admin-ai] Workers AI error',error?.message||error);
    httpError('Free AI is temporarily unavailable or daily quota is exhausted. Store operations are unaffected.',503,'ai_unavailable');
  }
});

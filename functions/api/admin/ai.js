/**
 * POST /api/admin/ai  — Admin Copilot (DRAFT ONLY).
 * Roles: owner, manager, content.
 * Body: { "task": "<allowed task key>", "context": { ...task inputs, max ~4KB } }
 *
 * Allowed tasks (draft text only — the endpoint has NO write capability):
 *   product_description | seo_meta | category_tags | box_ideas |
 *   faq_reply | support_reply | merchandising
 *
 * HARD BLOCKLIST (enforced in code, before any AI call): the copilot must NEVER
 * publish, change prices, verify/reject payments, refund/cancel orders,
 * delete products, or manage roles/security. Requests matching the blocklist
 * are rejected with 422 and audit-logged as blocked attempts.
 *
 * The AI provider key lives ONLY in env (AI_PROVIDER_API_KEY); it never
 * reaches the browser. Rate-limited: 20 calls / 10 min / admin user.
 */
import { withAdmin, json, httpError, readJson, rateLimit, audit, env } from './_lib/auth.js';

const ALLOWED_TASKS = new Set([
  'product_description',
  'seo_meta',
  'category_tags',
  'box_ideas',
  'faq_reply',
  'support_reply',
  'merchandising',
]);

// Anything matching these can never be a copilot task — hard reject.
const BLOCKLIST = [
  /publish/i, /go\s*live/i, /deploy/i,
  /price|pricing|discount|pkr\s*\d/i,
  /verify.*payment|payment.*verif|mark.*paid/i,
  /refund/i, /\bcancel\b.*order|order.*\bcancel/i,
  /\bdelete\b/i, /\bremove\b.*product/i,
  /\brole\b/i, /permission/i, /make.*admin/i, /promote/i,
  /service.?role|secret|api.?key|password/i,
];

const TASK_PROMPTS = {
  product_description: 'Draft a concise, appetizing product description (40-70 words, Roman Urdu-friendly tone) for a Pakistani snack-store product.',
  seo_meta: 'Draft an SEO title (<=60 chars) and meta description (<=155 chars) for the product page.',
  category_tags: 'Suggest up to 8 category/tag labels for merchandising this product.',
  box_ideas: 'Suggest 3 Chaska Box themes (name + 1-line concept each) from the given products.',
  faq_reply: 'Draft a helpful FAQ answer in friendly Roman Urdu + English.',
  support_reply: 'Draft a polite customer-support reply in Roman Urdu + English.',
  merchandising: 'Suggest homepage merchandising (which shelf/section and why) based on the given catalogue context.',
};

const SYSTEM_GUARDRAILS = [
  'You are ChaskaBox Admin Copilot. You output DRAFT TEXT ONLY.',
  'You cannot publish, change prices, verify payments, refund or cancel orders, delete products, or change roles/security.',
  'If asked to do any of those, refuse briefly.',
  'Never invent: ingredients, allergen claims, stock availability, bestseller/sales claims, discounts, or delivery promises — unless the provided context states them.',
  'Keep drafts short, specific, and snack-relevant. No fluff.',
].join('\n');

async function callProvider(context, system, userText) {
  const e = env(context);
  if (!e.AI_PROVIDER_API_KEY) httpError('AI provider is not configured', 503, 'ai_not_configured');
  const url = e.AI_PROVIDER_URL || 'https://api.openai.com/v1/chat/completions';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${e.AI_PROVIDER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    httpError(`AI provider error (${r.status})`, 502, 'ai_provider_error');
  }
  const data = await r.json();
  const draft = data?.choices?.[0]?.message?.content?.trim();
  if (!draft) httpError('AI provider returned no draft', 502, 'ai_empty');
  return draft;
}

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const rl = rateLimit(`ai:${user.id}`, 20, 10 * 60 * 1000);
  if (!rl.allowed) {
    return json({ error: 'AI rate limit reached. Try again shortly.', code: 'rate_limited' }, 429);
  }

  const body = await readJson(context.request, 8 * 1024);
  const task = String(body.task || '').trim();
  const ctxText = typeof body.context === 'string' ? body.context : JSON.stringify(body.context || {});
  const combined = `${task}\n${ctxText}`.slice(0, 4000);

  // 1) Task must be on the allowlist.
  if (!ALLOWED_TASKS.has(task)) {
    await audit(context, {
      actorId: user.id, actorRole: role, action: 'ai.blocked', // PROPOSED §5 addition — see CONTRACT_AMENDMENTS.md
      entityType: 'ai', entityId: 'n/a', before: null, after: { task, reason: 'unknown_task' },
    });
    httpError(`Unknown or disallowed task '${task}'. Allowed: ${[...ALLOWED_TASKS].join(', ')}`, 422, 'blocked_task');
  }

  // 2) Hard blocklist: never let the model near sensitive operations.
  if (BLOCKLIST.some((re) => re.test(combined))) {
    await audit(context, {
      actorId: user.id, actorRole: role, action: 'ai.blocked', // PROPOSED §5 addition — see CONTRACT_AMENDMENTS.md
      entityType: 'ai', entityId: 'n/a', before: null,
      after: { task, reason: 'blocklist match — publish/price/payment/refund/delete/roles' },
    });
    httpError(
      'Blocked: the copilot cannot publish, change prices, verify payments, refund/cancel orders, delete products, or manage roles. It only drafts text.',
      422,
      'blocked_sensitive'
    );
  }

  const draft = await callProvider(context, `${SYSTEM_GUARDRAILS}\n\nTask: ${TASK_PROMPTS[task]}`, combined);

  await audit(context, {
    actorId: user.id, actorRole: role, action: 'ai.draft_generated', // contract §5
    entityType: 'ai', entityId: 'n/a', before: null,
    after: { task, draft_chars: draft.length },
  });

  return json({
    task,
    draft,
    warnings: [
      'DRAFT ONLY — review before use. The copilot cannot publish or change anything.',
      'Verify any factual claims (price, stock, delivery) against trusted data.',
    ],
  });
});

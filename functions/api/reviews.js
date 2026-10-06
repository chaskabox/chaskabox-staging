/**
 * POST /api/reviews  (PUBLIC)
 * Submit a product review. No auth required, strictly rate-limited (contract §3: 5/min/IP).
 * Body: { product_id, rating (1..5 int), text (3..1000 chars) }
 *
 * Contract §2.6 / §1.7 (server-enforced):
 * - product must exist and be visibility='visible' (no reviews on hidden/draft/archived)
 * - moderation_status='pending' always (public sees ONLY approved); never auto-approved
 * - verified_purchase=false (a back-office job flips it when a delivered order exists)
 * - review_text is stored as-is; basic spam-shape checks applied
 */
import { sb, json, httpError, readJson, rateLimit, getClientIp } from './admin/_lib/auth.js';

export const onRequestPost = async (context) => {
  try {
    const ip = getClientIp(context.request);
    const rl = rateLimit(`review:${ip}`, 5, 60 * 1000); // contract §3: 5/min/IP
    if (!rl.allowed) {
      return json({ error: { code: 'RATE_LIMITED', message: 'Too many reviews. Please try again in a minute.' } }, 429, {
        'Retry-After': String(Math.ceil(rl.resetMs / 1000)),
      });
    }

    const body = await readJson(context.request, 16 * 1024);
    const productId = String(body.product_id || '');
    const rating = Number(body.rating);
    const text = String(body.text || '').trim();

    if (!productId) httpError('product_id is required', 400, 'missing_field');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) httpError('rating must be an integer 1..5', 400, 'invalid_rating');
    if (text.length < 3 || text.length > 1000) httpError('text must be 3..1000 characters', 400, 'invalid_text');
    if (text === text.toUpperCase() && text.length > 40) httpError('Review looks like spam', 400, 'spam_shape');
    if ((text.match(/https?:\/\//g) || []).length > 2) httpError('Too many links', 400, 'spam_shape');

    const products = await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=id,visibility`);
    const p = products && products[0];
    if (!p) httpError('Product not found', 404, 'not_found');
    if (p.visibility !== 'visible') httpError('Reviews are closed for this product', 403, 'not_reviewable');

    const created = await sb(context, '/rest/v1/reviews', {
      method: 'POST',
      body: {
        product_id: p.id,
        rating,
        review_text: text,
        moderation_status: 'pending',
        verified_purchase: false,
      },
    });

    const r = created && created[0];
    return json(
      {
        ok: true,
        review: r ? { id: r.id, rating: r.rating, moderation_status: r.moderation_status } : null,
        note: 'Thanks! Your review is pending moderation.',
      },
      201
    );
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[api/reviews] error', e);
    return json({ error: { code: 'INTERNAL', message: 'Could not submit review' } }, 500);
  }
};

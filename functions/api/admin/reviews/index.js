/**
 * GET /api/admin/reviews
 * Moderate reviews. Min role: content (contract §3).
 * Contract §2.6 columns: id, product_id, user_id, order_id, rating, review_text,
 * moderation_status (pending|approved|rejected), verified_purchase, admin_reply, created_at.
 * Query: moderation_status, product_id, rating, verified_purchase, page, per_page
 */
import { withAdmin, sb, json, httpError, pagination } from '../_lib/auth.js';

const MODS = new Set(['pending', 'approved', 'rejected']);

export const onRequestGet = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const url = new URL(context.request.url);
  const sp = url.searchParams;
  const { page, per, rangeHeader } = pagination(url, 25, 100);

  const filters = [];
  const mod = sp.get('moderation_status');
  if (mod) {
    if (!MODS.has(mod)) httpError('invalid moderation_status filter', 400, 'bad_request');
    filters.push(`moderation_status=eq.${mod}`);
  }
  const pid = sp.get('product_id');
  if (pid) filters.push(`product_id=eq.${encodeURIComponent(pid)}`);
  const rating = sp.get('rating');
  if (rating) filters.push(`rating=eq.${encodeURIComponent(rating)}`);
  if (sp.get('verified_purchase') === 'true') filters.push('verified_purchase=eq.true');
  if (sp.get('verified_purchase') === 'false') filters.push('verified_purchase=eq.false');

  const query = ['select=*', 'order=created_at.desc', ...filters].join('&');
  const { data, total } = await sb(context, `/rest/v1/reviews?${query}`, {
    headers: { Range: rangeHeader },
    count: true,
  });

  return json({ reviews: data, page, per_page: per, total, total_pages: Math.ceil(total / per) });
});

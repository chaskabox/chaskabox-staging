/**
 * PATCH /api/admin/reviews/:id
 * Moderate a review. Min role: content (contract §3).
 * Body: { "action": "approve" | "reject", "reply"?: "admin reply text (max 1000)" }
 * - approve → moderation_status='approved' (public)
 * - reject  → moderation_status='rejected' (hidden)
 * - reply   → sets admin_reply alongside the decision
 * Ratings are never fabricated: only real customer submissions exist; there is
 * no endpoint to create a review as admin.
 * Audit actions 'review.approved' / 'review.rejected' are PROPOSED §5 additions
 * (see CONTRACT_AMENDMENTS.md).
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../_lib/auth.js';

export const onRequestPatch = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const id = context.params.id;
  if (!id) httpError('Review id required', 400);

  const body = await readJson(context.request);
  const action = String(body.action || '').toLowerCase();
  if (!['approve', 'reject'].includes(action)) httpError("action must be 'approve' or 'reject'", 400, 'invalid_action');

  const rows = await sb(context, `/rest/v1/reviews?id=eq.${encodeURIComponent(id)}&select=*`);
  const review = rows && rows[0];
  if (!review) httpError('Review not found', 404, 'not_found');

  const patch = { moderation_status: action === 'approve' ? 'approved' : 'rejected' };
  if (body.reply !== undefined) {
    const reply = String(body.reply).trim();
    if (reply.length > 1000) httpError('reply too long (max 1000)', 400, 'invalid_reply');
    patch.admin_reply = reply || null;
  }

  const before = { moderation_status: review.moderation_status, admin_reply: review.admin_reply };
  const updated = await sb(context, `/rest/v1/reviews?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });

  await audit(context, {
    actorId: user.id, actorRole: role,
    action: action === 'approve' ? 'review.approved' : 'review.rejected', // PROPOSED §5 addition
    entityType: 'review', entityId: review.id,
    before, after: patch,
  });

  return json({ review: updated && updated[0] });
});

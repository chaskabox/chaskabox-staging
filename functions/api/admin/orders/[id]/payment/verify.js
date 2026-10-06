/**
 * POST /api/admin/orders/:id/payment/verify
 * Verify or reject a PREPAID (JazzCash / Bank Transfer) payment.
 * Roles: owner, manager, fulfilment.
 * Body: { "decision": "verified" | "rejected", "note": "optional internal note" }
 *
 * Rules (server-enforced):
 * - COD orders have nothing to verify → 422.
 * - Only orders in payment_submitted / awaiting_payment can be decided.
 * - 'verified' requires a transaction_reference on the order (customer-supplied).
 * - The browser can NEVER set payment_verified — only this endpoint (authorized roles).
 * - Every decision is audit-logged with before/after.
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../../../_lib/auth.js';

const DECIDABLE = new Set(['payment_submitted', 'awaiting_payment']);

export const onRequestPost = withAdmin(['owner', 'manager', 'fulfilment'], async (context, { user, role }) => {
  const id = context.params.id;
  if (!id) httpError('Order id required', 400);

  const body = await readJson(context.request);
  const decision = String(body.decision || '').trim().toLowerCase();
  if (!['verified', 'rejected'].includes(decision)) {
    httpError("decision must be 'verified' or 'rejected'", 400, 'invalid_decision');
  }
  const note = String(body.note || '').slice(0, 500);

  const rows = await sb(context, `/rest/v1/orders?id=eq.${encodeURIComponent(id)}&select=*`);
  const order = rows && rows[0];
  if (!order) httpError('Order not found', 404, 'not_found');

  if (order.payment_method === 'cod') {
    httpError('COD orders have no prepaid payment to verify', 422, 'not_prepaid');
  }
  if (!DECIDABLE.has(order.payment_status)) {
    httpError(`Payment already decided (status: ${order.payment_status})`, 409, 'already_decided');
  }
  if (decision === 'verified' && !order.transaction_reference) {
    httpError('Cannot verify: order has no transaction/reference number', 422, 'missing_reference');
  }

  const nextStatus = decision === 'verified' ? 'payment_verified' : 'payment_rejected';
  const before = { payment_status: order.payment_status };
  const patch = { payment_status: nextStatus };
  if (note) {
    const existing = order.admin_notes ? order.admin_notes + '\n' : '';
    patch.admin_notes = `${existing}[${new Date().toISOString()}] payment ${decision} by ${role}: ${note}`.slice(0, 4000);
  }

  const updated = await sb(context, `/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  });

  await audit(context, {
    actorId: user.id,
    actorRole: role,
    action: decision === 'verified' ? 'payment.verified' : 'payment.rejected', // contract §5
    entityType: 'order',
    entityId: order.id,
    before,
    after: { payment_status: nextStatus, note: note || null },
  });

  return json({ order: updated && updated[0], decision });
});

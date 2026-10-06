/**
 * PATCH /api/admin/orders/:id/status
 * Change fulfilment_status. Min role: fulfilment (contract §3).
 * Body: { "fulfilment_status": "sourcing"|"packed"|"dispatched"|"delivered"|"cancelled",
 *         "cancel_reason"?: "required when cancelling" }
 *
 * Rules — contract §1.3 (server-enforced):
 * - new → sourcing → packed → dispatched → delivered; ANY → cancelled (with reason + audit).
 * - Terminal states (delivered, cancelled) cannot be left.
 * - Prepaid orders (jazzcash/bank_transfer) must be payment_verified (COD: cod_due)
 *   before moving to packed / dispatched / delivered.
 * - Audit events: order.status_changed | order.cancelled (§5).
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../../_lib/auth.js';

const TRANSITIONS = {
  new: ['sourcing', 'cancelled'],
  sourcing: ['packed', 'cancelled'],
  packed: ['dispatched', 'cancelled'],
  dispatched: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const PAYMENT_OK = new Set(['cod_due', 'payment_verified']);

export const onRequestPatch = withAdmin(['owner', 'manager', 'fulfilment'], async (context, { user, role }) => {
  const id = context.params.id;
  if (!id) httpError('Order id required', 400);

  const body = await readJson(context.request);
  const next = String(body.fulfilment_status || '').trim();
  if (!TRANSITIONS[next]) httpError('Invalid fulfilment_status', 400, 'invalid_status');

  const rows = await sb(context, `/rest/v1/orders?id=eq.${encodeURIComponent(id)}&select=*`);
  const order = rows && rows[0];
  if (!order) httpError('Order not found', 404, 'not_found');

  const current = order.fulfilment_status;
  if (current === next) httpError('Order is already in this status', 409, 'no_change');
  if (!TRANSITIONS[current] || !TRANSITIONS[current].includes(next)) {
    httpError(`Transition not allowed: ${current} → ${next}`, 422, 'invalid_transition');
  }

  // Contract §1.3: cancellation requires a reason.
  let cancelReason = null;
  if (next === 'cancelled') {
    cancelReason = String(body.cancel_reason || '').trim();
    if (cancelReason.length < 3 || cancelReason.length > 500) {
      httpError('cancel_reason (3..500 chars) is required to cancel an order', 400, 'cancel_reason_required');
    }
  }

  // Payment gate: never pack/ship an unverified prepaid order.
  if (['packed', 'dispatched', 'delivered'].includes(next) && !PAYMENT_OK.has(order.payment_status)) {
    httpError(
      `Cannot move to '${next}' while payment_status is '${order.payment_status}'. Verify the prepaid payment first (or confirm COD).`,
      422,
      'payment_not_cleared'
    );
  }

  const before = { fulfilment_status: current };
  const patchBody = { fulfilment_status: next };
  if (cancelReason) {
    const existing = order.admin_notes ? order.admin_notes + '\n' : '';
    patchBody.admin_notes = `${existing}[${new Date().toISOString()}] cancelled by ${role}: ${cancelReason}`.slice(0, 4000);
  }
  const updated = await sb(context, `/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patchBody,
  });
  const after = { fulfilment_status: next, ...(cancelReason ? { cancel_reason: cancelReason } : {}) };

  await audit(context, {
    actorId: user.id,
    actorRole: role,
    action: next === 'cancelled' ? 'order.cancelled' : 'order.status_changed',
    entityType: 'order',
    entityId: order.id,
    before,
    after,
  });

  return json({ order: updated && updated[0], transition: { from: current, to: next } });
});

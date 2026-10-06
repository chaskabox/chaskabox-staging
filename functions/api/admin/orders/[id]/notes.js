/**
 * POST /api/admin/orders/:id/notes
 * Append an internal admin note to an order. Roles: owner, manager, fulfilment.
 * Body: { "note": "text (1..2000 chars)" }
 * Notes are timestamped + attributed; never overwrite history.
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../../_lib/auth.js';

export const onRequestPost = withAdmin(['owner', 'manager', 'fulfilment'], async (context, { user, role }) => {
  const id = context.params.id;
  if (!id) httpError('Order id required', 400);

  const body = await readJson(context.request);
  const note = String(body.note || '').trim();
  if (note.length < 1 || note.length > 2000) {
    httpError('note must be 1..2000 characters', 400, 'invalid_note');
  }

  const rows = await sb(context, `/rest/v1/orders?id=eq.${encodeURIComponent(id)}&select=id,admin_notes`);
  const order = rows && rows[0];
  if (!order) httpError('Order not found', 404, 'not_found');

  const stamped = `[${new Date().toISOString()}] ${role}: ${note}`;
  const admin_notes = ((order.admin_notes ? order.admin_notes + '\n' : '') + stamped).slice(0, 8000);

  const updated = await sb(context, `/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { admin_notes },
  });

  await audit(context, {
    actorId: user.id,
    actorRole: role,
    action: 'order.note_added', // contract §5
    entityType: 'order',
    entityId: order.id,
    before: null,
    after: { note: stamped },
  });

  return json({ order: updated && updated[0] });
});

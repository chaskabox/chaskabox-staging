/**
 * POST /api/admin/products/:id/restore
 * Restore an archived product → visibility='hidden' (NOT directly visible;
 * an explicit publish step keeps restores deliberate). Roles: owner, manager, content.
 */
import { withAdmin, sb, json, httpError, audit } from '../../_lib/auth.js';

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const id = context.params.id;
  if (!id) httpError('Product id required', 400);

  const rows = await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=id,visibility`);
  const p = rows && rows[0];
  if (!p) httpError('Product not found', 404, 'not_found');
  if (p.visibility !== 'archived') httpError('Only archived products can be restored', 409, 'not_archived');

  const updated = await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { visibility: 'hidden', updated_by: user.id },
  });

  await audit(context, {
    actorId: user.id, actorRole: role, action: 'product.restored', // contract §5
    entityType: 'product', entityId: p.id,
    before: { visibility: 'archived' }, after: { visibility: 'hidden' },
  });

  return json({ product: updated && updated[0], note: 'Restored as hidden — publish explicitly to make it visible.' });
});

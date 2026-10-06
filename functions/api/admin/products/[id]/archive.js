/**
 * POST /api/admin/products/:id/archive
 * Default "delete" behaviour: sets visibility='archived'. Reversible via /restore.
 * Roles: owner, manager, content. Archived products disappear from the storefront
 * but historical order snapshots stay intact.
 */
import { withAdmin, sb, json, httpError, audit } from '../../_lib/auth.js';

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const id = context.params.id;
  if (!id) httpError('Product id required', 400);

  const rows = await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=id,visibility,name`);
  const p = rows && rows[0];
  if (!p) httpError('Product not found', 404, 'not_found');
  if (p.visibility === 'archived') httpError('Product is already archived', 409, 'no_change');

  const updated = await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { visibility: 'archived', updated_by: user.id },
  });

  await audit(context, {
    actorId: user.id, actorRole: role, action: 'product.archived', // contract §5
    entityType: 'product', entityId: p.id,
    before: { visibility: p.visibility }, after: { visibility: 'archived' },
  });

  return json({ product: updated && updated[0] });
});

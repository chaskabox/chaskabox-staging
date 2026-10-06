/**
 * /api/admin/products/:id
 * PATCH  — update product fields (price, visibility, category, ...). Roles: owner, manager, content.
 * DELETE — PERMANENT delete. OWNER ONLY. Blocked when the product is referenced by
 *          order_items (historical integrity) or bundle_items (as a component).
 *          The normal "delete" UX should call POST /:id/archive instead.
 * Body (DELETE): { "confirm": "<exact product name>" } typed confirmation.
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../_lib/auth.js';

const VISIBILITIES = new Set(['draft', 'visible', 'hidden', 'archived']);
const STOCK_STATES = new Set(['available', 'limited', 'unavailable', 'sourced_after_order']);

const EDITABLE = new Set([
  'name', 'slug', 'price', 'old_price', 'category', 'brand', 'pack',
  'description', 'badge', 'image_url', 'visibility', 'stock_state', 'tags',
]);

async function loadProduct(context, id) {
  const rows = await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=*`);
  const p = rows && rows[0];
  if (!p) httpError('Product not found', 404, 'not_found');
  return p;
}

export const onRequestPatch = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const id = context.params.id;
  if (!id) httpError('Product id required', 400);
  const product = await loadProduct(context, id);

  const body = await readJson(context.request);
  const patch = {};
  for (const k of EDITABLE) {
    if (body[k] === undefined) continue;
    patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) httpError('No editable fields provided', 400, 'empty_patch');

  if (patch.price !== undefined) {
    const n = Number(patch.price);
    if (!Number.isInteger(n) || n < 0) httpError('price must be a non-negative integer', 400, 'invalid_field');
    patch.price = n;
  }
  if (patch.old_price !== undefined && patch.old_price !== null) {
    const n = Number(patch.old_price);
    if (!Number.isInteger(n) || n < 0) httpError('old_price must be a non-negative integer', 400, 'invalid_field');
    patch.old_price = n;
  }
  if (patch.visibility !== undefined && !VISIBILITIES.has(patch.visibility)) httpError('invalid visibility', 400, 'invalid_field');
  if (patch.stock_state !== undefined && !STOCK_STATES.has(patch.stock_state)) httpError('invalid stock_state', 400, 'invalid_field');
  if (patch.tags !== undefined && !Array.isArray(patch.tags)) httpError('tags must be an array', 400, 'invalid_field');
  if (patch.slug && patch.slug !== product.slug) {
    const dup = await sb(context, `/rest/v1/products?slug=eq.${encodeURIComponent(patch.slug)}&select=id`);
    if (dup && dup.length) httpError('slug already exists', 409, 'duplicate_slug');
  }
  patch.updated_by = user.id;

  const before = {};
  for (const k of Object.keys(patch)) before[k] = product[k];
  const updated = await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  });

  const priceChanged = patch.price !== undefined && patch.price !== product.price;
  const visibilityChanged = patch.visibility !== undefined && patch.visibility !== product.visibility;
  // Contract §5 audit events; generic edits use the proposed 'product.updated' addition.
  const action = priceChanged ? 'product.price_changed' : visibilityChanged ? 'product.visibility_changed' : 'product.updated';
  await audit(context, {
    actorId: user.id, actorRole: role,
    action,
    entityType: 'product', entityId: product.id,
    before, after: patch,
  });

  return json({ product: updated && updated[0] });
});

export const onRequestDelete = withAdmin(['owner'], async (context, { user, role }) => {
  const id = context.params.id;
  if (!id) httpError('Product id required', 400);
  const product = await loadProduct(context, id);

  // Typed confirmation: body.confirm must equal the exact product name.
  const body = await readJson(context.request);
  if (body.confirm !== product.name) {
    httpError('Permanent delete requires typed confirmation: send { "confirm": "<exact product name>" }', 400, 'confirm_required');
  }

  // Historical integrity: never delete a product referenced by an order line item.
  const refs = await sb(context, `/rest/v1/order_items?product_id=eq.${encodeURIComponent(id)}&select=id&limit=1`);
  if (refs && refs.length) {
    httpError('Cannot permanently delete: product is referenced by historical order items. Archive it instead.', 409, 'referenced_by_orders');
  }
  const bundleRefs = await sb(context, `/rest/v1/bundle_items?component_product_id=eq.${encodeURIComponent(id)}&select=bundle_product_id&limit=1`);
  if (bundleRefs && bundleRefs.length) {
    httpError('Cannot permanently delete: product is a component of a Chaska Box. Remove it from the box first.', 409, 'referenced_by_bundle');
  }

  await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });

  await audit(context, {
    actorId: user.id, actorRole: role, action: 'product.deleted_permanent', // contract §5
    entityType: 'product', entityId: product.id,
    before: { id: product.id, name: product.name, slug: product.slug },
    after: null,
  });

  return json({ deleted: true, id: product.id });
});

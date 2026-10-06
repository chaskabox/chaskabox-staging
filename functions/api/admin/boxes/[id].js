/**
 * /api/admin/boxes/:id
 * GET   — box detail with components (incl. unit-price snapshots). Roles: owner, manager, content.
 * PATCH — update box: title/description/selling_price/image_url/visibility and/or
 *         full component replacement { items: [...] }. Recomputes retail + savings
 *         server-side. Roles: owner, manager, content.
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../_lib/auth.js';
import { computeRetail, savingsSummary } from '../_lib/boxes.js';

async function loadBox(context, id) {
  const rows = await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(id)}&is_bundle=eq.true&select=*`);
  const box = rows && rows[0];
  if (!box) httpError('Box not found', 404, 'not_found');
  return box;
}

async function loadItems(context, boxId) {
  const items = (await sb(
    context,
    `/rest/v1/bundle_items?bundle_product_id=eq.${encodeURIComponent(boxId)}&select=bundle_product_id,component_product_id,quantity`
  )) || [];
  if (items.length === 0) return items;
  const ids = [...new Set(items.map((i) => String(i.component_product_id)))];
  const prods = (await sb(
    context,
    `/rest/v1/products?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,name,price`
  )) || [];
  const byId = new Map(prods.map((p) => [String(p.id), p]));
  return items.map((i) => ({ ...i, product: byId.get(String(i.component_product_id)) || null }));
}

export const onRequestGet = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const box = await loadBox(context, context.params.id);
  const items = await loadItems(context, box.id);
  return json({ box, items });
});

export const onRequestPatch = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const id = context.params.id;
  const box = await loadBox(context, id);
  const body = await readJson(context.request);

  const patch = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (t.length < 3 || t.length > 160) httpError('title must be 3..160 chars', 400, 'invalid_title');
    patch.name = t;
  }
  if (body.description !== undefined) patch.description = String(body.description).slice(0, 2000);
  if (body.image_url !== undefined) patch.image_url = String(body.image_url).slice(0, 500);
  if (body.visibility !== undefined) {
    if (!['draft', 'visible', 'hidden'].includes(body.visibility)) httpError('invalid visibility', 400, 'invalid_field');
    patch.visibility = body.visibility;
  }
  let selling = box.price;
  if (body.selling_price !== undefined) {
    const n = Number(body.selling_price);
    if (!Number.isInteger(n) || n < 0) httpError('selling_price must be a non-negative integer', 400, 'invalid_price');
    selling = n;
    patch.price = n;
  }

  let itemsSummary = null;
  if (body.items !== undefined) {
    const { retail, lines } = await computeRetail(context, body.items);
    // Replace components atomically-ish: delete then re-insert with fresh snapshots.
    await sb(context, `/rest/v1/bundle_items?bundle_product_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    for (const l of lines) {
      await sb(context, '/rest/v1/bundle_items', {
        method: 'POST',
        body: {
          bundle_product_id: box.id,
          component_product_id: l.product_id,
          quantity: l.quantity,
        },
      });
    }
    patch.old_price = retail; // compare price follows current retail value
    itemsSummary = { ...savingsSummary(retail, selling), lines };
  }
  patch.updated_by = user.id;

  const before = { name: box.name, price: box.price, old_price: box.old_price, visibility: box.visibility };
  const updated = await sb(context, `/rest/v1/products?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });

  // Contract §5: visibility transitions map to bundle.published / bundle.unpublished;
  // other edits use the proposed 'bundle.updated' addition.
  const becameVisible = patch.visibility === 'visible' && box.visibility !== 'visible';
  const becameHidden = patch.visibility && patch.visibility !== 'visible' && box.visibility === 'visible';
  const bundleAction = becameVisible ? 'bundle.published' : becameHidden ? 'bundle.unpublished' : 'bundle.updated';
  await audit(context, {
    actorId: user.id, actorRole: role, action: bundleAction,
    entityType: 'product', entityId: box.id,
    before, after: { ...patch, components_replaced: !!itemsSummary },
  });

  const items = await loadItems(context, box.id);
  return json({ box: updated && updated[0], items, ...(itemsSummary ? { pricing: itemsSummary } : {}) });
});

/**
 * /api/admin/boxes
 * GET  — list Chaska Boxes (products with is_bundle=true) + item counts. Roles: owner, manager, content.
 * POST — create a box: creates the bundle product (is_bundle=true, visibility='draft')
 *        and its bundle_items with a unit-price snapshot. Roles: owner, manager, content.
 * Body: { title, description?, selling_price (int PKR), image_url?, visibility?: draft|hidden,
 *         items: [{ product_id, quantity (1..99) }] (1..50 components) }
 * Retail value + savings are computed SERVER-SIDE from trusted product prices.
 */
import { withAdmin, sb, json, httpError, readJson, pagination, audit, uuid } from '../_lib/auth.js';
import { computeRetail, savingsSummary } from '../_lib/boxes.js';

function slugify(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `box-${uuid().slice(0, 8)}`;
}

export const onRequestGet = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const url = new URL(context.request.url);
  const { page, per, rangeHeader } = pagination(url, 25, 100);
  const { data, total } = await sb(
    context,
    '/rest/v1/products?is_bundle=eq.true&select=id,slug,name,price,old_price,visibility,stock_state,image_url,updated_at&order=updated_at.desc',
    { headers: { Range: rangeHeader }, count: true }
  );
  return json({ boxes: data, page, per_page: per, total, total_pages: Math.ceil(total / per) });
});

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const body = await readJson(context.request);
  const title = String(body.title || '').trim();
  const selling = Number(body.selling_price);
  const items = body.items;
  if (title.length < 3 || title.length > 160) httpError('title must be 3..160 chars', 400, 'invalid_title');
  if (!Number.isInteger(selling) || selling < 0) httpError('selling_price must be a non-negative integer (PKR)', 400, 'invalid_price');
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) httpError('items must be 1..50 components', 400, 'invalid_items');

  const { retail, lines } = await computeRetail(context, items);
  const summary = savingsSummary(retail, selling);

  const slug = body.slug ? String(body.slug) : slugify(title);
  const dup = await sb(context, `/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&select=id`);
  if (dup && dup.length) httpError('slug already exists', 409, 'duplicate_slug');

  const created = await sb(context, '/rest/v1/products', {
    method: 'POST',
    body: {
      slug,
      name: title,
      description: String(body.description || '').slice(0, 2000),
      price: selling,
      old_price: retail, // guidance: normal retail value shown as compare price
      category: 'Chaska Boxes',
      pack: `Box of ${items.length} items`,
      image_url: String(body.image_url || '').slice(0, 500),
      is_bundle: true,
      visibility: body.visibility === 'hidden' ? 'hidden' : 'draft',
      stock_state: 'available',
      created_by: user.id,
      updated_by: user.id,
    },
  });
  const box = created && created[0];
  if (!box) httpError('Box creation failed', 502, 'create_failed');

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

  await audit(context, {
    actorId: user.id, actorRole: role, action: 'bundle.created', // PROPOSED §5 addition — see CONTRACT_AMENDMENTS.md
    entityType: 'product', entityId: box.id,
    before: null,
    after: { title, selling_price: selling, retail_value: retail, savings: summary.savings, components: lines.length },
  });

  return json({ box, ...summary, items: lines }, 201);
});

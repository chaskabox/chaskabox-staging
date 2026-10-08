/**
 * /api/admin/categories/:id
 * GET    — single category with products. Roles: owner, manager, content.
 * PATCH  — update category. Roles: owner, manager, content.
 * DELETE — delete category (safe: only if empty or force). Roles: owner, manager.
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../_lib/auth.js';

export const onRequestGet = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const id = context.params.id;
  const rows = await sb(context, `/rest/v1/categories?id=eq.${encodeURIComponent(id)}&select=*`);
  const cat = rows?.[0];
  if (!cat) httpError('Category not found', 404, 'not_found');

  const assignments = await sb(context,
    `/rest/v1/category_products?category_id=eq.${encodeURIComponent(id)}&select=product_id,position&order=position.asc`);
  return json({ category: cat, products: assignments || [] });
});

export const onRequestPatch = withAdmin(['owner', 'manager', 'content'], async (context, { user }) => {
  const id = context.params.id;
  const body = await readJson(context.request);

  const patch = { updated_at: new Date().toISOString() };
  const fields = ['name', 'slug', 'description', 'image_url', 'mobile_image_url', 'icon',
    'seo_title', 'seo_description', 'box_style', 'link_destination', 'position',
    'is_visible', 'show_on_homepage', 'hide_if_empty', 'product_assignment', 'assignment_rule'];
  fields.forEach(f => { if (body[f] !== undefined) patch[f] = body[f]; });

  // Handle product assignments
  if (Array.isArray(body.product_ids)) {
    await sb(context, `/rest/v1/category_products?category_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (body.product_ids.length) {
      const rows = body.product_ids.map((pid, i) => ({
        category_id: id, product_id: Number(pid), position: i,
      }));
      await sb(context, '/rest/v1/category_products', { method: 'POST', body: rows });
    }
  }

  const updated = await sb(context, `/rest/v1/categories?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: patch,
  });
  await audit(context, user.id, 'category.updated', { id });
  return json({ category: Array.isArray(updated) ? updated[0] : updated });
});

export const onRequestDelete = withAdmin(['owner', 'manager'], async (context, { user }) => {
  const id = context.params.id;
  const force = context.request.url.includes('force=true');

  if (!force) {
    const assignments = await sb(context,
      `/rest/v1/category_products?category_id=eq.${encodeURIComponent(id)}&select=product_id&limit=1`);
    if (assignments?.length) httpError('Category has products. Use force=true to delete anyway.', 400, 'not_empty');
  }

  await sb(context, `/rest/v1/category_products?category_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  await sb(context, `/rest/v1/categories?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  await audit(context, user.id, 'category.deleted', { id });
  return json({ deleted: true });
});

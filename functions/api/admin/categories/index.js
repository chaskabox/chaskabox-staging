/**
 * /api/admin/categories
 * GET  — list all categories with product counts. Roles: owner, manager, content.
 * POST — create category. Roles: owner, manager, content.
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../_lib/auth.js';

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
}

export const onRequestGet = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const cats = await sb(context, '/rest/v1/categories?select=*&order=position.asc');
  // Get product counts
  const counts = await sb(context, '/rest/v1/category_products?select=category_id');
  const byCat = {};
  (counts || []).forEach(r => { byCat[r.category_id] = (byCat[r.category_id] || 0) + 1; });
  const enriched = (cats || []).map(c => ({ ...c, product_count: byCat[c.id] || 0 }));
  return json({ categories: enriched });
});

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context, { user }) => {
  const body = await readJson(context.request);
  const name = String(body.name || '').trim();
  if (!name) httpError('name is required', 400, 'invalid_name');

  const slug = body.slug ? slugify(body.slug) : slugify(name);
  const row = {
    name,
    slug,
    description: String(body.description || ''),
    image_url: String(body.image_url || '') || null,
    mobile_image_url: String(body.mobile_image_url || '') || null,
    icon: String(body.icon || ''),
    seo_title: String(body.seo_title || ''),
    seo_description: String(body.seo_description || ''),
    box_style: body.box_style || 'default',
    link_destination: String(body.link_destination || ''),
    position: Number(body.position || 0),
    is_visible: body.is_visible !== false,
    show_on_homepage: body.show_on_homepage !== false,
    hide_if_empty: body.hide_if_empty !== false,
    product_assignment: body.product_assignment || 'manual',
    assignment_rule: body.assignment_rule || {},
  };

  const created = await sb(context, '/rest/v1/categories', {
    method: 'POST',
    body: row,
  });
  await audit(context, user.id, 'category.created', { name, slug });
  return json({ category: Array.isArray(created) ? created[0] : created }, 201);
});

/**
 * /api/admin/products
 * GET  — list products (search, visibility, category, is_bundle, pagination). Roles: owner, manager, content.
 * POST — create product (visibility defaults to 'draft'). Roles: owner, manager, content.
 */
import { withAdmin, sb, json, httpError, readJson, pagination, sanitizeSearch, audit, uuid } from '../_lib/auth.js';

const VISIBILITIES = new Set(['draft', 'visible', 'hidden', 'archived']);
const STOCK_STATES = new Set(['available', 'limited', 'unavailable', 'sourced_after_order']);

const LIST_COLS = [
  'id', 'slug', 'name', 'price', 'old_price', 'category', 'brand', 'pack',
  'description', 'badge', 'image_url', 'is_bundle', 'visibility', 'stock_state',
  'created_at', 'updated_at',
].join(',');

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `product-${uuid().slice(0, 8)}`;
}

function validateProductInput(body, isCreate) {
  const out = {};
  const str = (k, max) => {
    if (body[k] === undefined) return;
    const v = String(body[k]).trim();
    if (v.length > max) httpError(`${k} too long (max ${max})`, 400, 'invalid_field');
    out[k] = v;
  };
  const num = (k) => {
    if (body[k] === undefined || body[k] === null) return;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < 0 || n > 10000000) httpError(`${k} must be a non-negative integer`, 400, 'invalid_field');
    out[k] = n;
  };
  if (isCreate) {
    if (!body.name || !String(body.name).trim()) httpError('name is required', 400, 'missing_field');
    if (body.price === undefined) httpError('price is required', 400, 'missing_field');
    if (!body.category || !String(body.category).trim()) httpError('category is required', 400, 'missing_field');
    if (!body.pack || !String(body.pack).trim()) httpError('pack is required', 400, 'missing_field');
  }
  str('name', 160); str('slug', 90); str('category', 80); str('brand', 80);
  str('pack', 80); str('description', 2000); str('badge', 40); str('image_url', 500);
  num('price'); num('old_price');
  if (body.visibility !== undefined) {
    if (!VISIBILITIES.has(body.visibility)) httpError('invalid visibility', 400, 'invalid_field');
    out.visibility = body.visibility;
  }
  if (body.stock_state !== undefined) {
    if (!STOCK_STATES.has(body.stock_state)) httpError('invalid stock_state', 400, 'invalid_field');
    out.stock_state = body.stock_state;
  }
  if (body.is_bundle !== undefined) out.is_bundle = !!body.is_bundle;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) httpError('tags must be an array', 400, 'invalid_field');
    out.tags = body.tags.map((t) => String(t).slice(0, 40)).slice(0, 20);
  }
  return out;
}

export const onRequestGet = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const url = new URL(context.request.url);
  const sp = url.searchParams;
  const { page, per, rangeHeader } = pagination(url, 25, 100);

  const filters = [];
  const q = sanitizeSearch(sp.get('q'));
  if (q) filters.push(`or=(name.ilike.*${q}*,slug.ilike.*${q}*,brand.ilike.*${q}*)`);
  const vis = sp.get('visibility');
  if (vis) {
    if (!VISIBILITIES.has(vis)) httpError('invalid visibility filter', 400);
    filters.push(`visibility=eq.${vis}`);
  }
  const cat = sp.get('category');
  if (cat) filters.push(`category=eq.${encodeURIComponent(cat)}`);
  if (sp.get('is_bundle') === 'true') filters.push('is_bundle=eq.true');
  if (sp.get('is_bundle') === 'false') filters.push('is_bundle=eq.false');

  const query = [`select=${LIST_COLS}`, 'order=updated_at.desc', ...filters].join('&');
  const { data, total } = await sb(context, `/rest/v1/products?${query}`, {
    headers: { Range: rangeHeader },
    count: true,
  });

  return json({ products: data, page, per_page: per, total, total_pages: Math.ceil(total / per) });
});

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const body = await readJson(context.request);
  const input = validateProductInput(body, true);
  if (!input.slug) input.slug = slugify(input.name);

  // Slug uniqueness (server-side; DB unique constraint is the final guard).
  const existing = await sb(context, `/rest/v1/products?slug=eq.${encodeURIComponent(input.slug)}&select=id`);
  if (existing && existing.length) httpError('slug already exists', 409, 'duplicate_slug');

  const row = {
    ...input,
    visibility: input.visibility || 'draft',
    stock_state: input.stock_state || 'sourced_after_order',
    is_bundle: false,
    created_by: user.id,
    updated_by: user.id,
  };
  const created = await sb(context, '/rest/v1/products', { method: 'POST', body: row });

  await audit(context, {
    actorId: user.id, actorRole: role, action: 'product.created', // PROPOSED §5 addition — see CONTRACT_AMENDMENTS.md
    entityType: 'product', entityId: created && created[0] && created[0].id,
    before: null, after: created && created[0],
  });

  return json({ product: created && created[0] }, 201);
});

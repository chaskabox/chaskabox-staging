/**
 * /api/admin/navigation
 * GET  — all navigation items grouped by location. Roles: owner, manager, content.
 * POST — create nav item. Roles: owner, manager, content.
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../_lib/auth.js';

export const onRequestGet = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const items = await sb(context, '/rest/v1/navigation_menus?select=*&order=location.asc,position.asc');
  const grouped = { header: [], footer: [], mobile: [] };
  (items || []).forEach(i => { if (grouped[i.location]) grouped[i.location].push(i); });
  return json({ navigation: grouped, all: items || [] });
});

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context, { user }) => {
  const body = await readJson(context.request);
  if (!body.label || !body.location) httpError('label and location required', 400, 'invalid');

  const row = {
    location: body.location,
    label: String(body.label),
    url: String(body.url || '#'),
    parent_id: body.parent_id || null,
    position: Number(body.position || 0),
    is_external: !!body.is_external,
    is_enabled: body.is_enabled !== false,
  };
  const created = await sb(context, '/rest/v1/navigation_menus', { method: 'POST', body: row });
  await audit(context, user.id, 'navigation.created', { label: row.label });
  return json({ item: Array.isArray(created) ? created[0] : created }, 201);
});

/**
 * POST /api/admin/homepage/publish
 * Explicit publish: copies draft_config → config for the given section keys
 * (or all sections when keys omitted). Min role: manager (contract §3).
 * Body: { "keys": ["hero", "faq"] }  (optional)
 * Audit event: homepage.published (§5).
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../_lib/auth.js';

export const onRequestPost = withAdmin(['owner', 'manager'], async (context, { user, role }) => {
  const body = await readJson(context.request);
  let filter = '';
  if (body.keys !== undefined) {
    if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 20) {
      httpError('keys must be a non-empty array (max 20)', 400, 'invalid_keys');
    }
    const keys = body.keys.map((k) => String(k));
    filter = `&section_key=in.(${keys.map(encodeURIComponent).join(',')})`;
  }

  const sections = await sb(context, `/rest/v1/homepage_sections?select=section_key,draft_config,config${filter}`);
  if (!sections || sections.length === 0) httpError('No matching sections', 404, 'not_found');

  const published = [];
  for (const s of sections) {
    if (s.draft_config === null || s.draft_config === undefined) {
      httpError(`Section '${s.section_key}' has no draft to publish`, 422, 'no_draft');
    }
    const updated = await sb(context, `/rest/v1/homepage_sections?section_key=eq.${encodeURIComponent(s.section_key)}`, {
      method: 'PATCH',
      body: { config: s.draft_config, updated_at: new Date().toISOString() },
    });
    await audit(context, {
      actorId: user.id, actorRole: role, action: 'homepage.published', // contract §5
      entityType: 'homepage', entityId: s.section_key,
      before: { config: s.config }, after: { config: s.draft_config },
    });
    published.push(s.section_key);
  }

  return json({ published, count: published.length });
});

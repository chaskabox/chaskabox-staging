/**
 * /api/admin/homepage
 * GET   — all homepage sections (draft + published). Min role: content (contract §3).
 * PATCH — save DRAFT changes only (draft_config); never publishes. Min role: content.
 *         Body: { sections: [{ section_key, draft_config?: {...}, enabled?: bool,
 *                             position?: int, heading?: string, subheading?: string }] }
 * Publish via POST /api/admin/homepage/publish (draft_config → config).
 *
 * Contract §2.7 columns: section_key PK, enabled, position, heading, subheading,
 * config (published), draft_config (unpublished edits), updated_at.
 * Known keys: hero, categories, chaska_picks, boxes, chatpata_picks,
 *             new_items, how_it_works, faq, announcement_bar
 */
import { withAdmin, sb, json, httpError, readJson, audit } from '../_lib/auth.js';

const KNOWN_KEYS = new Set([
  'hero', 'categories', 'chaska_picks', 'boxes', 'chatpata_picks',
  'new_items', 'how_it_works', 'faq', 'announcement_bar',
]);

const SELECT = 'section_key,enabled,position,heading,subheading,config,draft_config,updated_at';

export const onRequestGet = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const sections = await sb(context, `/rest/v1/homepage_sections?select=${SELECT}&order=position.asc`);
  return json({ sections: sections || [] });
});

export const onRequestPatch = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const body = await readJson(context.request);
  const sections = body.sections;
  if (!Array.isArray(sections) || sections.length === 0 || sections.length > 20) {
    httpError('sections must be a non-empty array (max 20)', 400, 'invalid_sections');
  }

  const results = [];
  for (const s of sections) {
    const key = String(s.section_key || '');
    if (!KNOWN_KEYS.has(key)) httpError(`unknown section_key: ${key}`, 400, 'unknown_section');

    const patch = { updated_at: new Date().toISOString() };
    if (s.draft_config !== undefined) {
      if (typeof s.draft_config !== 'object' || s.draft_config === null || Array.isArray(s.draft_config)) {
        httpError(`draft_config for '${key}' must be an object`, 400, 'invalid_draft');
      }
      patch.draft_config = s.draft_config;
    }
    if (s.enabled !== undefined) patch.enabled = !!s.enabled;
    if (s.position !== undefined) {
      const pos = Number(s.position);
      if (!Number.isInteger(pos) || pos < 0 || pos > 100) httpError('position must be 0..100', 400, 'invalid_position');
      patch.position = pos;
    }
    if (s.heading !== undefined) patch.heading = String(s.heading).slice(0, 160) || null;
    if (s.subheading !== undefined) patch.subheading = String(s.subheading).slice(0, 300) || null;

    const before = await sb(context, `/rest/v1/homepage_sections?section_key=eq.${encodeURIComponent(key)}&select=${SELECT}`);
    if (!before || !before.length) httpError(`section not found: ${key}`, 404, 'not_found');
    const updated = await sb(context, `/rest/v1/homepage_sections?section_key=eq.${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: patch,
    });

    await audit(context, {
      actorId: user.id, actorRole: role, action: 'homepage.draft_saved', // PROPOSED §5 addition — see CONTRACT_AMENDMENTS.md
      entityType: 'homepage', entityId: key,
      before: before[0], after: patch,
    });
    results.push(updated && updated[0]);
  }

  return json({ sections: results, note: 'Drafts saved. Nothing is live until POST /api/admin/homepage/publish.' });
});

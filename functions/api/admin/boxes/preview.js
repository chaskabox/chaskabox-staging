/**
 * POST /api/admin/boxes/preview
 * Savings preview for the Box Builder: computes retail value + savings from
 * TRUSTED current product prices WITHOUT writing anything to the database.
 * Roles: owner, manager, content.
 * Body: { items: [{ product_id, quantity }], selling_price: <int PKR, optional> }
 */
import { withAdmin, json, readJson } from '../_lib/auth.js';
import { computeRetail, savingsSummary } from '../_lib/boxes.js';

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const body = await readJson(context.request);
  const { retail, lines } = await computeRetail(context, body.items || []);
  const selling = body.selling_price === undefined ? null : Number(body.selling_price);
  const summary = selling === null || Number.isNaN(selling)
    ? { retail_value: retail, selling_price: null, savings: null, savings_pct: null }
    : savingsSummary(retail, selling);
  return json({ ...summary, items: lines });
});

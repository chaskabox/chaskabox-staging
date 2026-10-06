/**
 * Chaska Box helpers: server-side retail-value computation from trusted prices.
 */
import { sb, httpError } from './auth.js';

/**
 * Compute the retail value of a proposed component list using CURRENT
 * trusted product prices. Rejects missing/archived components.
 * Returns { retail, lines: [{product_id, name, unit_price, quantity, line_value}] }.
 */
export async function computeRetail(context, items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    httpError('items must be 1..50 components', 400, 'invalid_items');
  }
  const ids = [...new Set(items.map((i) => String(i.product_id)))];
  const rows = await sb(context, `/rest/v1/products?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,name,price,visibility`);
  const byId = new Map((rows || []).map((r) => [String(r.id), r]));
  let retail = 0;
  const lines = [];
  for (const it of items) {
    const p = byId.get(String(it.product_id));
    if (!p) httpError(`Component product not found: ${it.product_id}`, 400, 'bad_component');
    if (p.visibility === 'archived') httpError(`Component is archived and cannot be boxed: ${p.name}`, 422, 'archived_component');
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) httpError('quantity must be 1..99', 400, 'invalid_quantity');
    retail += p.price * qty;
    lines.push({ product_id: p.id, name: p.name, unit_price: p.price, quantity: qty, line_value: p.price * qty });
  }
  return { retail, lines };
}

export function savingsSummary(retail, selling) {
  const savings = Math.max(0, retail - selling);
  return { retail_value: retail, selling_price: selling, savings, savings_pct: retail ? Math.round((savings / retail) * 100) : 0 };
}

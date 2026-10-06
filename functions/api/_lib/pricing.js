/* ChaskaBox V3 — server-authoritative pricing.
 *
 * THE BROWSER IS NEVER TRUSTED for prices, discounts, delivery fees,
 * subtotals or totals. These pure functions run ONLY on the server
 * (Cloudflare Function / RPC) using catalogue prices read from the DB.
 *
 * Rules (approved, must match checkout UI hints):
 * - COD: delivery always Rs. 300
 * - JazzCash / Bank Transfer (prepaid): Rs. 300 when subtotal < Rs. 5,000,
 *   FREE when subtotal >= Rs. 5,000
 */

export const DELIVERY_FEE = 300;
export const FREE_PREPAID_THRESHOLD = 5000;

export const PAYMENT_METHODS = ['cod', 'jazzcash', 'bank_transfer'];
export const PREPAID_METHODS = ['jazzcash', 'bank_transfer'];

/** Delivery fee in PKR given server-computed subtotal + trusted method. */
export function deliveryFee(paymentMethod, subtotal) {
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error('Unknown payment method');
  }
  if (paymentMethod === 'cod') return DELIVERY_FEE;
  return subtotal >= FREE_PREPAID_THRESHOLD ? 0 : DELIVERY_FEE;
}

/** Initial payment_status for a new order. Prepaid can NEVER start verified. */
export function initialPaymentStatus(paymentMethod) {
  if (paymentMethod === 'cod') return 'cod_due';
  if (PREPAID_METHODS.includes(paymentMethod)) return 'payment_submitted';
  throw new Error('Unknown payment method');
}

/**
 * Build authoritative totals from DB-trusted line data.
 * lines: [{ product_id, qty, unit_price, ...snapshotFields }] where
 * unit_price came from the DB. Extra snapshot fields (product_name,
 * product_pack, ...) are carried through untouched.
 * Returns { subtotal, delivery_fee, total, lines } with immutable snapshots.
 */
export function buildTotals(paymentMethod, lines) {
  const priced = lines.map(l => ({
    ...l,
    line_total: l.unit_price * l.qty,
  }));
  const subtotal = priced.reduce((s, l) => s + l.line_total, 0);
  const delivery_fee = deliveryFee(paymentMethod, subtotal);
  return { subtotal, delivery_fee, total: subtotal + delivery_fee, lines: priced };
}

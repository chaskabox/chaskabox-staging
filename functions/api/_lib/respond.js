/* ChaskaBox V3 — JSON response helpers for API Functions.
 *
 * Every response is JSON. Errors use { error: { code, message, details? } }.
 * - `message` is always a safe, customer-facing string.
 * - `details` (validation only) contains field-level messages, never PII
 *   beyond what the client itself sent, never stack traces.
 * - Server internals are logged via console.error (Cloudflare logs), never
 *   returned to the client.
 */

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

export function ok(payload, status = 200, extraHeaders = {}) {
  return json(status, payload, extraHeaders);
}

/** Customer-safe error envelope. */
export function apiError(code, message, status = 400, details) {
  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return json(status, body);
}

export const Errors = {
  methodNotAllowed: () => apiError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405),
  invalidJson: () => apiError('INVALID_JSON', 'Request body must be valid JSON.', 400),
  payloadTooLarge: () => apiError('PAYLOAD_TOO_LARGE', 'Request body is too large.', 413),
  validation: (details) => apiError('VALIDATION_ERROR', 'Some fields are invalid. Please review and try again.', 400, details),
  rateLimited: (retryAfterSec) =>
    apiError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', 429,
      [{ field: 'request', message: `Retry after ${retryAfterSec}s.` }]),
  productUnavailable: (productIds) =>
    apiError('PRODUCT_UNAVAILABLE', 'One or more items in your bag are no longer available. Please review your bag.', 422,
      productIds.map(id => ({ field: 'items', message: `Product ${id} is unavailable.` }))),
  configError: () => apiError('SERVICE_UNAVAILABLE', 'Order service is temporarily unavailable. Please try again shortly.', 503),
  internal: () => apiError('INTERNAL_ERROR', 'Something went wrong while placing your order. Your bag has NOT been cleared — please retry.', 500),
};

/** Log server-side detail without leaking it to the client. */
export function logError(tag, err) {
  try {
    console.error(`[chaskabox:${tag}]`, {
      code: err && err.code,
      status: err && err.status,
      pgCode: err && err.pgCode,
      dbMessage: err && err.dbMessage,
      message: err && err.message,
    });
  } catch { /* logging must never break the handler */ }
}

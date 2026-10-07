import { withAdmin, sb, json, readJson, httpError, audit } from '../_lib/auth.js';

const BOOL_KEYS = new Set(['cod_enabled','jazzcash_enabled','bank_transfer_enabled','ai_customer_assistant_enabled','ai_semantic_search_enabled']);
const MONEY_KEYS = new Set(['cod_delivery_fee_pkr','prepaid_delivery_fee_pkr']);
const THRESHOLD_KEYS = new Set(['prepaid_free_delivery_threshold_pkr']);
const TEXT_LIMITS = {
  delivery_estimate: 80,
  support_whatsapp: 25,
  support_email: 254,
  promo_text: 180,
  store_address: 300,
  jazzcash_till_id: 40,
  jazzcash_qr_url: 500,
};
const ALLOWED = new Set([...BOOL_KEYS, ...MONEY_KEYS, ...THRESHOLD_KEYS, ...Object.keys(TEXT_LIMITS), 'bank_transfer_details']);

function validate(key, value) {
  if (!ALLOWED.has(key)) httpError(`unsupported setting: ${key}`, 400, 'invalid_setting');
  if (BOOL_KEYS.has(key)) {
    if (typeof value !== 'boolean') httpError(`${key} must be boolean`, 400, 'invalid_setting');
    return value;
  }
  if (MONEY_KEYS.has(key) || THRESHOLD_KEYS.has(key)) {
    const n = Number(value);
    const max = THRESHOLD_KEYS.has(key) ? 1_000_000 : 100_000;
    if (!Number.isInteger(n) || n < 0 || n > max) httpError(`${key} must be an integer from 0 to ${max}`, 400, 'invalid_setting');
    return n;
  }
  if (Object.hasOwn(TEXT_LIMITS, key)) {
    const s = String(value ?? '').trim();
    if (!s || s.length > TEXT_LIMITS[key]) httpError(`${key} is invalid`, 400, 'invalid_setting');
    if (key === 'support_email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) httpError('support_email is invalid', 400, 'invalid_setting');
    if (key === 'jazzcash_till_id' && !/^[A-Za-z0-9 -]{3,40}$/.test(s)) httpError('jazzcash_till_id is invalid',400,'invalid_setting');
    if (key === 'jazzcash_qr_url' && !/^(https:\/\/|\/)[^\s]+$/.test(s)) httpError('jazzcash_qr_url is invalid',400,'invalid_setting');
    if (key === 'support_whatsapp' && !/^[+0-9 ()-]{7,25}$/.test(s)) httpError('support_whatsapp is invalid', 400, 'invalid_setting');
    return s;
  }
  if (key === 'bank_transfer_details') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) httpError('bank_transfer_details must be an object',400,'invalid_setting');
    const clean = {
      bank: String(value.bank || '').trim(),
      account_title: String(value.account_title || '').trim(),
      account_number: String(value.account_number || '').trim(),
    };
    if (!clean.bank || clean.bank.length > 100 || !clean.account_title || clean.account_title.length > 120 || !clean.account_number || clean.account_number.length > 80) httpError('bank_transfer_details contains invalid fields',400,'invalid_setting');
    if (!/^[A-Za-z0-9 .&'()\/-]{2,100}$/.test(clean.bank) || !/^[A-Za-z0-9 .&'()\/-]{2,120}$/.test(clean.account_title) || !/^[A-Za-z0-9 -]{4,80}$/.test(clean.account_number)) httpError('bank_transfer_details contains invalid characters',400,'invalid_setting');
    return clean;
  }
  return value;
}

export const onRequestGet = withAdmin(['owner'], async (context) => {
  const rows = await sb(context, '/rest/v1/site_settings?select=key,value,updated_at&order=key.asc');
  return json({ settings: rows || [] });
});

export const onRequestPatch = withAdmin(['owner'], async (context, { user, role }) => {
  const body = await readJson(context.request);
  const updates = body.settings;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) httpError('settings object required', 400, 'invalid_settings');
  const keys = Object.keys(updates);
  if (!keys.length || keys.length > 30) httpError('settings must contain 1..30 values', 400, 'invalid_settings');
  const out = [];
  for (const [key, raw] of Object.entries(updates)) {
    const value = validate(key, raw);
    const before = await sb(context, `/rest/v1/site_settings?key=eq.${encodeURIComponent(key)}&select=key,value`);
    const rows = await sb(context, `/rest/v1/site_settings?key=eq.${encodeURIComponent(key)}`, { method: 'PATCH', body: { value, updated_by: user.id } });
    if (!rows?.length) {
      await sb(context, '/rest/v1/site_settings', { method: 'POST', body: { key, value, updated_by: user.id } });
    }
    await audit(context, { actorId: user.id, actorRole: role, action: 'settings.updated', entityType: 'settings', entityId: key, before: before?.[0] || null, after: { value } });
    out.push({ key, value });
  }
  return json({ settings: out });
});

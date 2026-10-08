/**
 * /api/admin/health
 * GET — system health dashboard (read-only, no secrets).
 * Roles: owner, manager.
 */
import { withAdmin, sb, json, env } from '../_lib/auth.js';

export const onRequestGet = withAdmin(['owner', 'manager'], async (context) => {
  const e = env(context);
  const health = {
    timestamp: new Date().toISOString(),
    supabase: { status: 'unknown' },
    turnstile: { status: 'unknown' },
    resend: { status: 'unknown' },
    ai: { status: 'unknown' },
    functions: { status: 'ok', version: 'v4' },
  };

  // Supabase: try a simple query
  try {
    await sb(context, '/rest/v1/products?select=id&limit=1');
    health.supabase.status = 'connected';
  } catch { health.supabase.status = 'error'; }

  // Turnstile: check secret configured
  health.turnstile.status = e.TURNSTILE_SECRET_KEY ? 'configured' : 'missing';

  // Resend
  health.resend.status = (e.RESEND_API_KEY && e.OWNER_ORDER_EMAIL) ? 'configured' : 'missing';

  // AI: check binding
  try {
    health.ai.status = context.env.AI ? 'connected' : 'not_configured';
  } catch { health.ai.status = 'not_configured'; }

  // Last deployment info (from env if available)
  health.deployment = {
    commit: e.CF_PAGES_COMMIT_SHA || e.GITHUB_SHA || 'unknown',
    branch: e.CF_PAGES_BRANCH || 'unknown',
  };

  return json(health);
});

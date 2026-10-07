/* TEMPORARY: Create disposable staging test users
 * DELETE AFTER TESTING - Exposed without auth for staging setup only.
 *
 * POST /api/admin/test-setup
 * Body: { setup_token, users: [{ email, password, role }] }
 * The setup_token must match TEST_SETUP_TOKEN env var.
 */
export async function onRequestPost(context) {
  const { env, request } = context;

  const body = await request.json();
  const setupToken = body.setup_token;
  const expected = env.TEST_SETUP_TOKEN;

  if (!expected || setupToken !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!Array.isArray(users) || users.length === 0 || users.length > 10) {
    return Response.json({ error: 'Provide 1-10 users' }, { status: 400 });
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = env.SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const results = [];
  for (const u of users) {
    if (!u.email || !u.password) {
      results.push({ email: u.email, error: 'email+password required' });
      continue;
    }
    try {
      // Create auth user
      const createResp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { test: true, disposable: true, created: new Date().toISOString() },
        }),
      });
      const created = await createResp.json();
      if (!createResp.ok || !created.id) {
        results.push({ email: u.email, error: created.msg || 'create failed' });
        continue;
      }

      // Assign role if staff
      if (u.role) {
        await fetch(`${supabaseUrl}/rest/v1/admin_roles`, {
          method: 'POST',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            user_id: created.id,
            role: u.role,
            active: true,
          }),
        });
      }

      results.push({ email: u.email, id: created.id, role: u.role || 'customer' });
    } catch (err) {
      results.push({ email: u.email, error: err.message });
    }
  }

  return Response.json({ results });
});

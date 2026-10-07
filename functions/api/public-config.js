export async function onRequestGet({ env }) {
  const body = {
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    clarityProjectId: env.CLARITY_PROJECT_ID || '',
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

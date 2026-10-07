/* Browser-safe public configuration. Private service-role/WAHA/Resend/Turnstile
 * credentials are never exposed here. */
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
let SB = null;
let PUBLIC_CONFIG_PROMISE = null;

async function loadPublicConfig(){
  if (PUBLIC_CONFIG_PROMISE) return PUBLIC_CONFIG_PROMISE;
  PUBLIC_CONFIG_PROMISE = fetch('/api/public-config', {cache:'no-cache'})
    .then(r => { if(!r.ok) throw new Error('Public config unavailable'); return r.json(); })
    .then(cfg => {
      SUPABASE_URL = String(cfg.supabaseUrl || '');
      SUPABASE_ANON_KEY = String(cfg.supabaseAnonKey || '');
      if (cfg.clarityProjectId) window.CHASKABOX_CLARITY_ID = String(cfg.clarityProjectId);
      return cfg;
    })
    .catch(err => { console.warn('Public config unavailable', err); return {}; });
  return PUBLIC_CONFIG_PROMISE;
}
function sbConfigured(){ return /^https:\/\//.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20; }
async function initSupabase(){
  if (SB) return true;
  await loadPublicConfig();
  if (sbConfigured() && window.supabase?.createClient){
    try { SB = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); return true; }
    catch(e){ console.warn('Supabase init failed', e); SB=null; }
  }
  return false;
}

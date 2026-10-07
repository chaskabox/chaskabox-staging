import { sbRequest } from './_lib/db.js';
// Legacy generated product pages/sitemap cover IDs <= 272. Admin-created products use IDs above this cutoff.
const LEGACY_STATIC_ID_MAX = 272;
const x = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export async function onRequestGet({ env }) {
  try {
    const rows = await sbRequest(env, '/public_products', { query: `?select=id,updated_at&id=gt.${LEGACY_STATIC_ID_MAX}&order=id.asc&limit=5000` }).catch(async()=>
      sbRequest(env, '/public_products', { query: `?select=id&id=gt.${LEGACY_STATIC_ID_MAX}&order=id.asc&limit=5000` })
    );
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${(rows||[]).map(p=>`  <url><loc>https://chaskabox.online/product/?id=${x(p.id)}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`).join('\n')}\n</urlset>`;
    return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public,max-age=1800'}});
  } catch (e) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',{status:503,headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}});
  }
}

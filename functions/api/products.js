/* GET /api/products
 * Public, DB-backed storefront catalogue. Returns ONLY the public_products view
 * mapped to the legacy browser shape so Admin product edits appear without a
 * source-code/products.json regeneration step.
 *
 * The static products.json remains a browser fallback for temporary backend
 * outages; checkout/order pricing stays authoritative on the server.
 */
import { sbRequest } from './_lib/db.js';

function localShape(p) {
  return {
    id: Number(p.id),
    slug: p.slug || '',
    name: p.name || '',
    brand: p.brand || '',
    price: Number(p.price || 0),
    oldPrice: p.old_price == null ? null : Number(p.old_price),
    category: p.category || '',
    pack: p.pack || '',
    desc: p.description || '',
    badge: p.badge || '',
    img: p.image_url || null,
    bundle: !!p.is_bundle,
  };
}

export async function onRequestGet(context) {
  try {
    const fresh = new URL(context.request.url).searchParams.get('fresh') === '1';
    const rows = await sbRequest(context.env, '/public_products', {
      query: '?select=id,slug,name,brand,category,pack,price,old_price,description,badge,image_url,is_bundle&order=id.asc&limit=1000',
    });
    return new Response(JSON.stringify((rows || []).map(localShape)), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': fresh ? 'no-store' : 'public, max-age=30, stale-while-revalidate=120',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[public-products] failed', error?.message || error);
    return new Response(JSON.stringify({ error: 'Catalogue temporarily unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

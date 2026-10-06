/**
 * /api/admin/media
 * POST — upload a product/banner image. Min role: content (contract §3).
 *        multipart/form-data, field "file".
 *        Contract §2.8: allowlist image/jpeg, image/png, image/webp, image/avif;
 *        max 5MB; randomized object_path; no executables.
 * GET  — list media assets (paginated). Min role: content.
 *
 * Storage: Supabase Storage bucket MEDIA_BUCKET (env, default 'product-media')
 * via the service-role REST API. Audit: media.uploaded (§5).
 */
import { withAdmin, sb, json, httpError, pagination, audit, uuid, env, getBearerToken } from '../_lib/auth.js';

const ALLOWLIST = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]);
const MAX_BYTES = 5 * 1024 * 1024;

// Magic-byte sniffing: never trust the client-supplied Content-Type alone.
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  // AVIF: ....ftypavif / ftypavis
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70 &&
      buf[8] === 0x61 && buf[9] === 0x76 && buf[10] === 0x69) return 'image/avif';
  return null;
}

async function storageUpload(context, bucket, objectPath, bytes, mime) {
  const e = env(context);
  const r = await fetch(`${e.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: e.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    httpError(`Storage upload failed (${r.status}): ${t.slice(0, 200)}`, 502, 'storage_error');
  }
}

export const onRequestGet = withAdmin(['owner', 'manager', 'content'], async (context) => {
  const url = new URL(context.request.url);
  const { page, per, rangeHeader } = pagination(url, 25, 100);
  const { data, total } = await sb(context, '/rest/v1/media?select=*&order=created_at.desc', {
    headers: { Range: rangeHeader },
    count: true,
  });
  return json({ media: data, page, per_page: per, total, total_pages: Math.ceil(total / per) });
});

export const onRequestPost = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const e = env(context);
  const contentType = context.request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) httpError('Use multipart/form-data with a "file" field', 400, 'bad_content_type');

  const form = await context.request.formData().catch(() => null);
  const file = form && form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') httpError('No file uploaded (field "file")', 400, 'missing_file');

  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length === 0) httpError('Empty file', 400, 'empty_file');
  if (buf.length > MAX_BYTES) httpError('File too large (max 5MB)', 413, 'file_too_large');

  const sniffed = sniff(buf);
  const declared = String(file.type || '').toLowerCase();
  const mime = sniffed || (ALLOWLIST.has(declared) ? declared : null);
  if (!mime || !ALLOWLIST.has(mime)) {
    httpError('Only JPEG, PNG, WebP and AVIF images are allowed', 415, 'bad_mime');
  }

  const ext = ALLOWLIST.get(mime);
  const d = new Date();
  const objectPath = `products/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${uuid()}.${ext}`;
  const bucket = e.MEDIA_BUCKET || 'product-media';

  await storageUpload(context, bucket, objectPath, buf, mime);
  const publicUrl = `${e.SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;

  const created = await sb(context, '/rest/v1/media', {
    method: 'POST',
    body: {
      object_path: objectPath,
      mime_type: mime,
      size_bytes: buf.length,
      uploaded_by: user.id,
    },
  });
  const asset = created && created[0];

  await audit(context, {
    actorId: user.id, actorRole: role, action: 'media.uploaded', // contract §5
    entityType: 'media', entityId: asset ? asset.id : objectPath,
    before: null, after: { object_path: objectPath, mime_type: mime, size_bytes: buf.length },
  });

  return json({ media: asset, url: publicUrl }, 201);
});

/**
 * DELETE /api/admin/media/:id
 * Delete a media asset (storage object + DB row). Min role: content (contract §3).
 * Blocked when a product's image_url references the object (catalogue integrity).
 * Audit: media.deleted (§5).
 */
import { withAdmin, sb, json, httpError, audit, env } from '../_lib/auth.js';

export const onRequestDelete = withAdmin(['owner', 'manager', 'content'], async (context, { user, role }) => {
  const id = String(context.params.id || '');
  if (!/^[0-9a-f-]{8,36}$/i.test(id)) httpError('Invalid media id', 400, 'invalid_id');

  const rows = await sb(context, `/rest/v1/media?id=eq.${encodeURIComponent(id)}&select=*`);
  const asset = rows && rows[0];
  if (!asset) httpError('Media not found', 404, 'not_found');

  // Catalogue integrity: refuse while any product references this object.
  const refs = await sb(
    context,
    `/rest/v1/products?image_url=like.*${encodeURIComponent(asset.object_path)}*&select=id,name&limit=1`
  );
  if (refs && refs.length) {
    httpError(`Cannot delete: referenced by product "${refs[0].name}". Change the product image first.`, 409, 'referenced_by_product');
  }

  const e = env(context);
  const bucket = e.MEDIA_BUCKET || 'product-media';
  const del = await fetch(`${e.SUPABASE_URL}/storage/v1/object/${bucket}/${asset.object_path}`, {
    method: 'DELETE',
    headers: {
      apikey: e.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!del.ok && del.status !== 404) httpError('Storage delete failed', 502, 'storage_error');

  await sb(context, `/rest/v1/media?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });

  await audit(context, {
    actorId: user.id, actorRole: role, action: 'media.deleted', // contract §5
    entityType: 'media', entityId: asset.id,
    before: { object_path: asset.object_path, mime_type: asset.mime_type, size_bytes: asset.size_bytes },
    after: null,
  });

  return json({ deleted: true, id: asset.id });
});

-- ============================================================================
-- ChaskaBox V3 — Migration 006: Row-Level Security (PHASE 3)
-- OFFLINE / STAGING ONLY.
-- Conforms to SHARED_BACKEND_CONTRACTS.md v1.0 §1.6, §2.
--
-- Threat model (from SECURITY_BEFORE_DEPLOY_CHECKLIST.md):
--  * anon must never reach admin tables or non-visible products
--  * customer A must never read customer B's orders/profile/reviews
--  * roles must not exceed their permissions; no self-promotion
--  * the browser never writes orders/order_items directly — only the
--    server API (service_role, bypasses RLS) creates orders
--  * audit_log is append-only: INSERT for staff, SELECT for owner,
--    NO update/delete for anyone
--
-- NOTE: the very first owner row in admin_roles must be inserted once via
-- the Supabase dashboard (service_role / SQL editor) — see README.md.
-- After that, only owner can manage roles (no self-promotion possible).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: current staff role (SECURITY DEFINER so it can read admin_roles
-- past that table's own restrictive policies). Roles are TEXT per contract.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_role()
RETURNS TEXT AS $$
  SELECT ar.role
  FROM public.admin_roles ar
  WHERE ar.user_id = auth.uid() AND ar.active = TRUE
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN AS $$
  SELECT public.staff_role() IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN AS $$
  SELECT public.staff_role() = 'owner';
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- ----------------------------------------------------------------------------
-- Enable RLS everywhere
-- ----------------------------------------------------------------------------
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE homepage_sections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE media              ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_roles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings      ENABLE ROW LEVEL SECURITY;

-- Table-level grants for authenticated customers (RLS policies filter rows).
-- Orders are created ONLY via API (service_role); customers get read-only table access.
GRANT SELECT ON orders, order_items TO authenticated;
GRANT SELECT, UPDATE ON customers TO authenticated;
GRANT SELECT ON reviews TO authenticated;
GRANT INSERT ON reviews TO authenticated;

-- Views used by the public storefront (security_invoker -> caller RLS applies)
-- NOTE: security_invoker views require base-table GRANTS too; RLS policies still
-- filter rows (products_public_read limits anon to visibility='visible').
GRANT SELECT ON products               TO anon, authenticated;
GRANT SELECT ON public_products          TO anon, authenticated;
GRANT SELECT ON public_reviews           TO anon, authenticated;
GRANT SELECT ON public_homepage_sections TO anon, authenticated;
GRANT SELECT ON public_site_settings     TO anon, authenticated;

-- ============================================================================
-- PRODUCTS
-- ============================================================================
-- Public: visible products only (feeds public_products view).
CREATE POLICY products_public_read ON products
  FOR SELECT TO anon, authenticated
  USING (visibility = 'visible');

-- Staff: all roles can read (fulfilment needs names for packing slips).
CREATE POLICY products_staff_read ON products
  FOR SELECT TO authenticated
  USING (public.is_staff());

-- Write: owner / manager / content. fulfilment is explicitly excluded.
CREATE POLICY products_write ON products
  FOR ALL TO authenticated
  USING (public.staff_role() IN ('owner', 'manager', 'content'))
  WITH CHECK (public.staff_role() IN ('owner', 'manager', 'content'));

-- ============================================================================
-- CUSTOMERS (minimal PII — contract §2.5)
-- A logged-in customer reads ONLY their own row. Guests (anon) read nothing.
-- content role gets NO customer PII.
-- ============================================================================
CREATE POLICY customers_own_read ON customers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY customers_staff_read ON customers
  FOR SELECT TO authenticated
  USING (public.staff_role() IN ('owner', 'manager', 'fulfilment'));

CREATE POLICY customers_staff_update ON customers
  FOR UPDATE TO authenticated
  USING (public.staff_role() IN ('owner', 'manager'))
  WITH CHECK (public.staff_role() IN ('owner', 'manager'));

-- No anon access, no direct INSERT/DELETE via RLS (API uses service_role).

-- ============================================================================
-- ORDERS — server-created only (service_role bypasses RLS).
-- No anon policies at all: the browser can NEVER insert orders directly.
-- Customer rows are addressed via orders.user_id = auth.uid() (contract §2.3).
-- ============================================================================
CREATE POLICY orders_customer_read ON orders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY orders_staff_read ON orders
  FOR SELECT TO authenticated
  USING (public.staff_role() IN ('owner', 'manager', 'fulfilment'));

-- Order updates: owner/manager full; fulfilment per contract §1.6 may touch
-- ONLY fulfilment_status + payment verify/reject + notes. Money fields,
-- payment method, customer snapshots and user linkage are locked for
-- fulfilment (column guard trigger below enforces it).
CREATE POLICY orders_staff_update ON orders
  FOR UPDATE TO authenticated
  USING (public.staff_role() IN ('owner', 'manager', 'fulfilment'))
  WITH CHECK (public.staff_role() IN ('owner', 'manager', 'fulfilment'));

CREATE OR REPLACE FUNCTION guard_order_update()
RETURNS TRIGGER AS $$
DECLARE
  r TEXT := public.staff_role();
BEGIN
  IF r = 'fulfilment' THEN
    -- Contract §1.6: fulfilment = fulfilment_status + payment verify/reject + notes.
    IF NEW.subtotal            IS DISTINCT FROM OLD.subtotal
    OR NEW.delivery_fee        IS DISTINCT FROM OLD.delivery_fee
    OR NEW.total               IS DISTINCT FROM OLD.total
    OR NEW.payment_method      IS DISTINCT FROM OLD.payment_method
    OR NEW.user_id             IS DISTINCT FROM OLD.user_id
    OR NEW.customer_name       IS DISTINCT FROM OLD.customer_name
    OR NEW.customer_phone      IS DISTINCT FROM OLD.customer_phone
    OR NEW.customer_address    IS DISTINCT FROM OLD.customer_address
    OR NEW.customer_city       IS DISTINCT FROM OLD.customer_city
    OR NEW.transaction_reference IS DISTINCT FROM OLD.transaction_reference
    OR NEW.order_number        IS DISTINCT FROM OLD.order_number
    OR NEW.idempotency_key     IS DISTINCT FROM OLD.idempotency_key THEN
      RAISE EXCEPTION 'fulfilment role may only update fulfilment_status, payment_status and admin_notes';
    END IF;
  ELSIF r NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'not authorized to update orders';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_order_update ON orders;
CREATE TRIGGER trg_guard_order_update
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_order_update();

-- ============================================================================
-- ORDER ITEMS — immutable snapshots, same access shape as orders.
-- ============================================================================
CREATE POLICY order_items_customer_read ON order_items
  FOR SELECT TO authenticated
  USING (
    order_id IN (SELECT o.id FROM orders o WHERE o.user_id = auth.uid())
  );

CREATE POLICY order_items_staff_read ON order_items
  FOR SELECT TO authenticated
  USING (public.staff_role() IN ('owner', 'manager', 'fulfilment'));

-- No INSERT/UPDATE/DELETE via RLS: snapshots are written once by the server
-- and never edited (contract §2.4: price edits NEVER alter order_items).

-- ============================================================================
-- BUNDLE ITEMS — catalogue structure; same writers as products.
-- ============================================================================
CREATE POLICY bundle_items_staff_read ON bundle_items
  FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY bundle_items_write ON bundle_items
  FOR ALL TO authenticated
  USING (public.staff_role() IN ('owner', 'manager', 'content'))
  WITH CHECK (public.staff_role() IN ('owner', 'manager', 'content'));

-- ============================================================================
-- REVIEWS (contract §1.7, §2.6 — moderation_status)
-- ============================================================================
-- Public: approved only (feeds public_reviews view).
CREATE POLICY reviews_public_read ON reviews
  FOR SELECT TO anon, authenticated
  USING (moderation_status = 'approved');

-- A logged-in user may read their own pending/rejected reviews.
CREATE POLICY reviews_own_read ON reviews
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Anyone logged in may submit; server forces pending + unverified.
CREATE POLICY reviews_insert ON reviews
  FOR INSERT TO authenticated
  WITH CHECK (moderation_status = 'pending' AND verified_purchase = FALSE);

-- Moderation: owner/manager/content. verified_purchase is server-derived;
-- content may NOT set it (trigger guard below).
CREATE POLICY reviews_moderate ON reviews
  FOR UPDATE TO authenticated
  USING (public.staff_role() IN ('owner', 'manager', 'content'))
  WITH CHECK (public.staff_role() IN ('owner', 'manager', 'content'));

CREATE OR REPLACE FUNCTION guard_review_verified()
RETURNS TRIGGER AS $$
DECLARE
  r TEXT := public.staff_role();
BEGIN
  IF NEW.verified_purchase IS DISTINCT FROM OLD.verified_purchase
     AND r NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'verified_purchase is server-derived; not settable by this role';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_review_verified ON reviews;
CREATE TRIGGER trg_guard_review_verified
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION guard_review_verified();

CREATE POLICY reviews_owner_delete ON reviews
  FOR DELETE TO authenticated
  USING (public.is_owner());

-- ============================================================================
-- HOMEPAGE SECTIONS (CMS — contract §2.7; `enabled` gates public visibility)
-- ============================================================================
CREATE POLICY homepage_public_read ON homepage_sections
  FOR SELECT TO anon, authenticated
  USING (enabled = TRUE);

CREATE POLICY homepage_staff_read ON homepage_sections
  FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY homepage_write ON homepage_sections
  FOR ALL TO authenticated
  USING (public.staff_role() IN ('owner', 'manager', 'content'))
  WITH CHECK (public.staff_role() IN ('owner', 'manager', 'content'));

-- ============================================================================
-- MEDIA
-- Rows describe public product assets; storage bytes are guarded by
-- storage.objects policies (see bottom of file).
-- ============================================================================
CREATE POLICY media_public_read ON media
  FOR SELECT TO anon, authenticated
  USING (TRUE);

CREATE POLICY media_write ON media
  FOR ALL TO authenticated
  USING (public.staff_role() IN ('owner', 'manager', 'content'))
  WITH CHECK (
    public.staff_role() IN ('owner', 'manager', 'content')
    AND (uploaded_by = auth.uid() OR uploaded_by IS NULL)
  );

-- ============================================================================
-- ADMIN ROLES — no self-promotion by construction (contract §1.6).
-- Users may read ONLY their own row (so the UI can render). Every write
-- requires owner. The first owner is seeded via dashboard/SQL editor.
-- ============================================================================
CREATE POLICY admin_roles_own_read ON admin_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY admin_roles_owner_read ON admin_roles
  FOR SELECT TO authenticated
  USING (public.is_owner());

CREATE POLICY admin_roles_owner_write ON admin_roles
  FOR ALL TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

-- ============================================================================
-- AUDIT LOG — append-only (contract §2.10: insert-only for staff,
-- select owner-only).
-- INSERT: staff (the API writes via service_role in practice).
-- SELECT: owner only. NO update/delete policies for ANYONE.
-- ============================================================================
CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

CREATE POLICY audit_log_read ON audit_log
  FOR SELECT TO authenticated
  USING (public.is_owner());

-- ============================================================================
-- SITE SETTINGS — all keys in this table are public-safe by design
-- (private credentials live in Cloudflare/Supabase secrets, never here).
-- Read: public. Write: owner only (contract §3: GET/PATCH settings = owner).
-- ============================================================================
CREATE POLICY settings_public_read ON site_settings
  FOR SELECT TO anon, authenticated
  USING (TRUE);

CREATE POLICY settings_owner_write ON site_settings
  FOR ALL TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

-- ============================================================================
-- STORAGE (Supabase Storage bucket: product-media)
-- Create the bucket FIRST in the dashboard (public read ON), then apply:
-- ============================================================================
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('product-media', 'product-media', TRUE)
-- ON CONFLICT (id) DO NOTHING;
--
-- CREATE POLICY "public read product-media" ON storage.objects
--   FOR SELECT TO anon, authenticated USING (bucket_id = 'product-media');
--
-- CREATE POLICY "staff upload product-media" ON storage.objects
--   FOR INSERT TO authenticated
--   WITH CHECK (
--     bucket_id = 'product-media'
--     AND public.staff_role() IN ('owner','manager','content')
--     AND (storage.extension(name) IN ('jpg','jpeg','png','webp','avif'))
--   );
--
-- CREATE POLICY "staff delete product-media" ON storage.objects
--   FOR DELETE TO authenticated
--   USING (
--     bucket_id = 'product-media'
--     AND public.staff_role() IN ('owner','manager','content')
--   );
-- NOTE: storage.extension() allowlist blocks executables/non-images at the
-- storage layer; the media table's mime/size CHECKs are the second layer.

-- ============================================================================
-- ChaskaBox V3 — Migration 005: admin roles, audit log, site settings
-- OFFLINE / STAGING ONLY.
-- Conforms to SHARED_BACKEND_CONTRACTS.md v1.0 §1.6, §2.9, §2.10, §3, §5.
--
-- Roles: owner > manager > fulfilment > content.
--  * owner:      everything incl. security/settings/permanent delete
--  * manager:    products, boxes, homepage, orders, customers, reviews
--  * fulfilment: orders fulfilment_status + payment verify/reject + notes ONLY
--  * content:    products, boxes, homepage, media, reviews (NO payments/security)
-- Role checks happen server-side / in RLS — never in UI alone.
-- site_settings backs GET/PATCH /api/admin/settings (owner, §3). All keys in
-- this table are public-safe by design; private credentials live in
-- Cloudflare/Supabase secrets, never here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_roles (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'fulfilment', 'content')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by  UUID,                       -- which owner granted it (audit trail)
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- audit_log — IMMUTABLE (contract §2.10: insert-only for staff, select
-- owner-only). No UPDATE / DELETE policies are defined for anyone (not even
-- owner): history must survive mistakes and disputes.
-- action values: contract §5 event enum.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    UUID NOT NULL,              -- admin user (service_role writes use the
                                         -- impersonated admin's id, never null)
  actor_role  TEXT NOT NULL
              CHECK (actor_role IN ('owner', 'manager', 'fulfilment', 'content', 'system')),
  action      TEXT NOT NULL,              -- contract §5, e.g. 'payment.verified'
  entity_type TEXT NOT NULL,              -- product | order | payment | customer |
                                         -- homepage | media | review | role | settings
  entity_id   TEXT NOT NULL,
  before_data JSONB,                      -- relevant before-state (no secrets/PII dumps)
  after_data  JSONB,                      -- relevant after-state
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log (action);

-- ----------------------------------------------------------------------------
-- Permanent product deletion is intentionally NOT exposed as a database RPC.
-- Historical versions used a SECURITY DEFINER helper that trusted caller-supplied
-- role metadata. That design is removed. Products should be archived for normal
-- operations; any exceptional destructive maintenance must use a tightly scoped
-- server/service-role path with server-verified owner authorization and auditing.
-- Migration 016 also drops the legacy function on databases where 005 had already
-- been applied before this hardening change.

-- ----------------------------------------------------------------------------
-- site_settings — public commerce settings (owner-managed).
-- PUBLIC receiving details only — no secrets.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_settings_updated_at ON site_settings;
CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO site_settings (key, value) VALUES
  ('cod_enabled',            'true'),
  ('cod_delivery_fee_pkr',    '300'),
  ('jazzcash_enabled',        'true'),
  ('bank_transfer_enabled',   'true'),
  ('bank_transfer_details',   '{"bank":"Punjab Bank","account_title":"RAMEEZ ASLAM","account_number":"6050435151500017"}'),
  ('prepaid_free_delivery_threshold_pkr', '5000'),
  ('prepaid_delivery_fee_pkr','300'),
  ('delivery_estimate',       '"4-7 days"')
ON CONFLICT (key) DO NOTHING;

-- Public view: only keys safe for the storefront (no secrets by construction).
CREATE OR REPLACE VIEW public_site_settings
WITH (security_invoker = true) AS
SELECT key, value FROM site_settings;

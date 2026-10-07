-- ============================================================================
-- ChaskaBox V3 — Migration 004: reviews, homepage CMS, media library
-- OFFLINE / STAGING ONLY.
-- Conforms to SHARED_BACKEND_CONTRACTS.md v1.0 §1.7, §2.6, §2.7, §2.8.
--
-- Reviews: public sees ONLY approved (moderation_status). verified_purchase
-- is derived server-side from real delivered orders — never set by the browser.
-- (No seed/fake ratings, per standing product-photo/review policy.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS reviews (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id          UUID REFERENCES orders(id) ON DELETE SET NULL, -- proving purchase
  rating            SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text       TEXT NOT NULL CHECK (char_length(review_text) BETWEEN 2 AND 2000),
  moderation_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  verified_purchase BOOLEAN NOT NULL DEFAULT FALSE,  -- server-side only
  admin_reply       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_product   ON reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_moderation ON reviews (moderation_status);
CREATE INDEX IF NOT EXISTS idx_reviews_created   ON reviews (created_at DESC);

-- Public view: approved reviews only.
CREATE OR REPLACE VIEW public_reviews
WITH (security_invoker = true) AS
SELECT id, product_id, rating, review_text, verified_purchase, admin_reply, created_at
FROM reviews
WHERE moderation_status = 'approved';

-- ----------------------------------------------------------------------------
-- homepage_sections — draft/preview/publish CMS (contract §2.7).
-- Publish flow: edit -> draft_config -> preview -> publish (draft_config -> config).
-- `enabled` gates public visibility; there is no separate is_published flag.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS homepage_sections (
  section_key   TEXT PRIMARY KEY,   -- 'hero','categories','chaska_picks','boxes',
                                   -- 'chatpata_picks','new_items','how_it_works',
                                   -- 'faq','announcement_bar'
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  position      INTEGER NOT NULL DEFAULT 0,
  heading       TEXT,
  subheading    TEXT,
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- curated product ids / rules
  draft_config  JSONB,             -- unpublished edits; publish copies -> config
  updated_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_homepage_updated_at ON homepage_sections;
CREATE TRIGGER trg_homepage_updated_at
  BEFORE UPDATE ON homepage_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE VIEW public_homepage_sections
WITH (security_invoker = true) AS
SELECT section_key, enabled, position, heading, subheading, config
FROM homepage_sections
WHERE enabled = TRUE
ORDER BY position;

-- Seed the known section keys (disabled nothing; content curated later).
INSERT INTO homepage_sections (section_key, position) VALUES
  ('announcement_bar', 0),
  ('hero',             1),
  ('categories',       2),
  ('chaska_picks',     3),
  ('boxes',            4),
  ('chatpata_picks',   5),
  ('new_items',        6),
  ('how_it_works',     7),
  ('faq',              8)
ON CONFLICT (section_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- media — product/banner image registry (contract §2.8).
-- Actual bytes live in Supabase Storage bucket `product-media`
-- (created separately; see 006_rls.sql notes). MIME allowlist + 5MB cap
-- are enforced here AND at the storage layer.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_path   TEXT NOT NULL UNIQUE,   -- randomized, e.g. 'products/2026/10/<uuid>.webp'
  mime_type     TEXT NOT NULL
                CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  uploaded_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

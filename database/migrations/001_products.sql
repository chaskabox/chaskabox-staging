-- ============================================================================
-- ChaskaBox V3 — Migration 001: catalogue (products)
-- OFFLINE / STAGING ONLY. Apply in order with a Supabase SQL editor or
-- `supabase db push`. Never commit real credentials; this file has none.
--
-- Conforms to SHARED_BACKEND_CONTRACTS.md v1.0 §1.4, §1.5, §2.1.
-- Enum values are enforced with TEXT + CHECK (per contract column types).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- products — source of truth for the catalogue.
-- Legacy numeric IDs (1..272) are PRESERVED as the primary key so that
-- existing public URLs (/product/<id>/) keep working after migration.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id            BIGINT PRIMARY KEY,              -- legacy products.json id, preserved
  slug          TEXT NOT NULL UNIQUE,            -- url-safe slug, e.g. 'jojo-mini-beans-38'
  name          TEXT NOT NULL,                   -- full display name, kept verbatim
  brand         TEXT,                            -- parsed from "Brand | Product" prefix, nullable
  category      TEXT,
  pack          TEXT,                            -- e.g. 'Pack of 4 (Rs. 75)'
  price         INTEGER NOT NULL CHECK (price >= 0),        -- PKR, integer only (no floats)
  old_price     INTEGER CHECK (old_price IS NULL OR old_price >= 0),
  description   TEXT,
  badge         TEXT,                            -- e.g. 'Sale' (only when earned)
  image_url     TEXT,                            -- relative path e.g. 'images/p38.webp' or storage URL
  is_bundle     BOOLEAN NOT NULL DEFAULT FALSE,  -- Chaska Box / curated box
  visibility    TEXT NOT NULL DEFAULT 'visible'
                CHECK (visibility IN ('draft', 'visible', 'hidden', 'archived')),
  stock_state   TEXT NOT NULL DEFAULT 'sourced_after_order'
                CHECK (stock_state IN ('available', 'limited', 'unavailable', 'sourced_after_order')),
                                                -- ChaskaBox is market-pickup (no stock held);
                                                -- most items are sourced after the order arrives.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,                            -- admin user id (auth.users), nullable for seed
  updated_by    UUID
);

CREATE INDEX IF NOT EXISTS idx_products_visibility ON products (visibility);
CREATE INDEX IF NOT EXISTS idx_products_category  ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_slug      ON products (slug);
CREATE INDEX IF NOT EXISTS idx_products_bundle   ON products (is_bundle) WHERE is_bundle = TRUE;

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- Public storefront view: only visible products, only public-safe columns.
-- security_invoker = true  ->  the caller's RLS policies on `products` apply.
-- The anon SELECT policy (006_rls.sql) allows visibility='visible' only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public_products
WITH (security_invoker = true) AS
SELECT
  id, slug, name, brand, category, pack,
  price, old_price, description, badge, image_url, is_bundle
FROM products
WHERE visibility = 'visible';

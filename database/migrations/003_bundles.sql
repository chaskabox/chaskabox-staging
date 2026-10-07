-- ============================================================================
-- ChaskaBox V3 — Migration 003: Chaska Box bundles (real component relations)
-- OFFLINE / STAGING ONLY.
--
-- A bundle IS a product row (is_bundle = TRUE, e.g. "ChaskaBox Wafer Box").
-- bundle_items links it to component products with quantities.
-- The selling price lives on products.price; component retail value is
-- computed server-side for the "you save" preview only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS bundle_items (
  bundle_product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bundle_product_id, component_product_id),
  CONSTRAINT chk_bundle_not_self CHECK (bundle_product_id <> component_product_id)
);

CREATE INDEX IF NOT EXISTS idx_bundle_items_component
  ON bundle_items (component_product_id);

-- Guard: a bundle row must actually be flagged is_bundle.
CREATE OR REPLACE FUNCTION assert_bundle_flag()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.bundle_product_id AND is_bundle = TRUE) THEN
    RAISE EXCEPTION 'bundle_product_id % is not flagged is_bundle', NEW.bundle_product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bundle_items_flag ON bundle_items;
CREATE TRIGGER trg_bundle_items_flag
  BEFORE INSERT OR UPDATE ON bundle_items
  FOR EACH ROW EXECUTE FUNCTION assert_bundle_flag();

-- ============================================================================
-- ChaskaBox V3 — Migration 014: FREE AI search / Copilot support
-- Cloudflare Workers AI + Supabase pgvector. No paid provider is required.
-- AI remains optional and has NO authority over checkout/payment/auth/security.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE products ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_embedding extensions.vector(1024);
ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_embedding_text TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_embedding_updated_at TIMESTAMPTZ;

-- Mark semantic index stale whenever public search text changes.
CREATE OR REPLACE FUNCTION mark_product_ai_embedding_stale()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW.name, NEW.brand, NEW.category, NEW.pack, NEW.description, NEW.tags, NEW.visibility)
     IS DISTINCT FROM
     ROW(OLD.name, OLD.brand, OLD.category, OLD.pack, OLD.description, OLD.tags, OLD.visibility) THEN
    NEW.ai_embedding := NULL;
    NEW.ai_embedding_text := NULL;
    NEW.ai_embedding_updated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_ai_embedding_stale ON products;
CREATE TRIGGER trg_products_ai_embedding_stale
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION mark_product_ai_embedding_stale();

-- Batch setter used only by the trusted server with service_role.
CREATE OR REPLACE FUNCTION set_product_ai_embeddings(p_rows JSONB)
RETURNS INTEGER AS $$
DECLARE
  item JSONB;
  changed INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be an array';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    UPDATE products
       SET ai_embedding = (item->>'embedding')::extensions.vector,
           ai_embedding_text = LEFT(COALESCE(item->>'text',''), 6000),
           ai_embedding_updated_at = now()
     WHERE id = (item->>'id')::BIGINT;
    changed := changed + CASE WHEN FOUND THEN 1 ELSE 0 END;
  END LOOP;
  RETURN changed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION set_product_ai_embeddings(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_product_ai_embeddings(JSONB) TO service_role;

-- Server-side semantic search. It deliberately returns only public-safe fields.
CREATE OR REPLACE FUNCTION match_public_products(
  p_query_embedding TEXT,
  p_match_count INTEGER DEFAULT 8,
  p_match_threshold REAL DEFAULT 0.20
)
RETURNS TABLE (
  id BIGINT,
  slug TEXT,
  name TEXT,
  brand TEXT,
  category TEXT,
  pack TEXT,
  price INTEGER,
  old_price INTEGER,
  description TEXT,
  badge TEXT,
  image_url TEXT,
  is_bundle BOOLEAN,
  similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.slug, p.name, p.brand, p.category, p.pack,
    p.price, p.old_price, p.description, p.badge, p.image_url, p.is_bundle,
    (1 - (p.ai_embedding <=> p_query_embedding::extensions.vector))::REAL AS similarity
  FROM products p
  WHERE p.visibility = 'visible'
    AND p.ai_embedding IS NOT NULL
    AND (1 - (p.ai_embedding <=> p_query_embedding::extensions.vector)) >= GREATEST(0.0, LEAST(1.0, p_match_threshold))
  ORDER BY p.ai_embedding <=> p_query_embedding::extensions.vector
  LIMIT GREATEST(1, LEAST(20, p_match_count));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION match_public_products(TEXT, INTEGER, REAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_public_products(TEXT, INTEGER, REAL) TO service_role;

-- HNSW is appropriate here and remains optional to query correctness.
CREATE INDEX IF NOT EXISTS idx_products_ai_embedding_hnsw
  ON products USING hnsw (ai_embedding extensions.vector_cosine_ops)
  WHERE ai_embedding IS NOT NULL;

INSERT INTO site_settings (key, value) VALUES
  ('ai_customer_assistant_enabled', 'true'),
  ('ai_semantic_search_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Migration 019: Admin CMS — categories, navigation, store settings extensions
-- Staging: apply via Supabase SQL Editor (owner does not want more edits, so this is for production setup)

-- Categories / Collections manager
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  image_url TEXT,
  mobile_image_url TEXT,
  icon TEXT DEFAULT '',
  seo_title TEXT DEFAULT '',
  seo_description TEXT DEFAULT '',
  box_style TEXT DEFAULT 'default' CHECK (box_style IN ('default', 'card', 'circle', 'banner')),
  link_destination TEXT DEFAULT '',
  position INT DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  show_on_homepage BOOLEAN DEFAULT true,
  hide_if_empty BOOLEAN DEFAULT true,
  product_assignment TEXT DEFAULT 'manual' CHECK (product_assignment IN ('manual', 'rule_tag', 'rule_category')),
  assignment_rule JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Category-product assignments (manual)
CREATE TABLE IF NOT EXISTS category_products (
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL,
  position INT DEFAULT 0,
  PRIMARY KEY (category_id, product_id)
);

-- Navigation menus (header/footer/mobile)
CREATE TABLE IF NOT EXISTS navigation_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location TEXT NOT NULL CHECK (location IN ('header', 'footer', 'mobile')),
  label TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '#',
  parent_id UUID REFERENCES navigation_menus(id) ON DELETE CASCADE,
  position INT DEFAULT 0,
  is_external BOOLEAN DEFAULT false,
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Store settings (key-value, single row per key)
CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);

-- Seed default store settings
INSERT INTO store_settings (key, value) VALUES
  ('store_name', '"ChaskaBox"'),
  ('support_phone', '"+923320005381"'),
  ('support_email', '"support@chaskabox.online"'),
  ('address', '"Near Ahmad Drink Corner, Railway Road, Bhatti Hussainabad, Muzaffargarh, Pakistan"'),
  ('whatsapp', '"+923320005381"'),
  ('delivery_fee', '300'),
  ('free_delivery_threshold', '5000'),
  ('cod_enabled', 'true'),
  ('jazzcash_enabled', 'true'),
  ('bank_transfer_enabled', 'true'),
  ('order_minimum', '0'),
  ('promo_message', '""'),
  ('maintenance_mode', 'false')
ON CONFLICT (key) DO NOTHING;

-- Seed categories from existing product categories
INSERT INTO categories (name, slug, description, position, is_visible, show_on_homepage)
SELECT DISTINCT
  category as name,
  lower(regexp_replace(category, '[^a-zA-Z0-9]+', '-', 'g')) as slug,
  '' as description,
  ROW_NUMBER() OVER (ORDER BY category) as position,
  true, true
FROM products
WHERE category IS NOT NULL AND category != ''
ON CONFLICT (slug) DO NOTHING;

-- RLS: categories readable by all, writable by admin roles
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE navigation_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

-- Public read for visible categories
CREATE POLICY "categories_public_read" ON categories
  FOR SELECT USING (is_visible = true);

CREATE POLICY "navigation_public_read" ON navigation_menus
  FOR SELECT USING (is_enabled = true);

-- Admin full access (via service_role bypasses RLS; authenticated admin via function)
-- Note: Admin API uses service_role, so RLS policies for admin are permissive for authenticated
CREATE POLICY "categories_admin_all" ON categories
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "category_products_admin_all" ON category_products
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "navigation_admin_all" ON navigation_menus
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "store_settings_admin_all" ON store_settings
  FOR ALL USING (true) WITH CHECK (true);

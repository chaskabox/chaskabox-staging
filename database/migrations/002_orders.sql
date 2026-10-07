-- ============================================================================
-- ChaskaBox V3 — Migration 002: customers + central orders
-- OFFLINE / STAGING ONLY.
-- Conforms to SHARED_BACKEND_CONTRACTS.md v1.0 §1.1, §1.2, §1.3, §2.3, §2.4, §2.5.
--
-- Design rules:
--  * Orders are created ONLY by the server (POST /api/orders, service_role).
--    The browser never writes to these tables directly and never decides
--    prices, totals, discounts, delivery fees or payment status.
--  * order_items are IMMUTABLE snapshots: product_name/pack/unit_price are
--    copied at purchase time so later price edits or archivals never rewrite
--    history (contract §2.4: "product price edits NEVER alter existing
--    order_items").
--  * idempotency_key (client-generated UUID v4 per checkout attempt) makes
--    retries safe: duplicate submissions return the existing order.
--  * Delivery fees are server-computed per contract: cod -> 300;
--    prepaid (jazzcash/bank_transfer): subtotal >= 5000 -> 0, else 300.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- customers — minimal PII (contract §2.5).
-- user_id links to Supabase Auth; NULL = guest (guest snapshots live on orders).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name          TEXT,
  phone         TEXT,                          -- primary contact / lookup key
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers (user_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone   ON customers (phone);

-- ----------------------------------------------------------------------------
-- orders — one row per authoritative order (contract §2.3).
-- customer_* columns are snapshots taken at order time.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        TEXT NOT NULL UNIQUE,      -- human-readable, e.g. CB-061026-00001
                                                -- NOT an auth credential (see /track design)
  idempotency_key     TEXT NOT NULL UNIQUE,      -- client UUID v4 per checkout attempt
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
                                                -- NULL = guest order

  customer_name       TEXT NOT NULL,             -- snapshot at order time
  customer_phone      TEXT NOT NULL,             -- snapshot at order time
  customer_address    TEXT NOT NULL,             -- snapshot at order time
  customer_city       TEXT NOT NULL,             -- snapshot at order time

  payment_method      TEXT NOT NULL
                      CHECK (payment_method IN ('cod', 'jazzcash', 'bank_transfer')),
  payment_status      TEXT NOT NULL
                      CHECK (payment_status IN ('cod_due', 'awaiting_payment',
                             'payment_submitted', 'payment_verified',
                             'payment_rejected', 'refunded')),
  fulfilment_status   TEXT NOT NULL DEFAULT 'new'
                      CHECK (fulfilment_status IN ('new', 'sourcing', 'packed',
                             'dispatched', 'delivered', 'cancelled')),

  -- Trusted, server-calculated money fields (integer PKR):
  subtotal            INTEGER NOT NULL CHECK (subtotal >= 0),
  delivery_fee        INTEGER NOT NULL CHECK (delivery_fee >= 0),
  total               INTEGER NOT NULL CHECK (total >= 0),

  transaction_reference TEXT,                   -- REQUIRED for prepaid (CHECK below)
  admin_notes         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_payment_initial CHECK (
    -- COD orders may never start as prepaid-verified; prepaid may never
    -- start as verified/rejected — only the verify endpoint (fulfilment+
    -- role, server-side) transitions to those states.
    (payment_method = 'cod'         AND payment_status IN ('cod_due', 'refunded')) OR
    (payment_method <> 'cod'        AND payment_status IN
       ('awaiting_payment', 'payment_submitted', 'payment_verified',
        'payment_rejected', 'refunded'))
  ),
  CONSTRAINT chk_prepaid_reference CHECK (
    -- Contract §2.3: transaction_reference REQUIRED for prepaid.
    payment_method = 'cod'
    OR (transaction_reference IS NOT NULL AND transaction_reference <> '')
  )
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id     ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_number      ON orders (order_number);
CREATE INDEX IF NOT EXISTS idx_orders_idem        ON orders (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_pay_status  ON orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_ful_status  ON orders (fulfilment_status);
CREATE INDEX IF NOT EXISTS idx_orders_phone       ON orders (customer_phone);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- order_items — immutable line-item snapshots (contract §2.4).
-- product_id is nullable + RESTRICT delete: a product referenced by an order
-- can be archived but never hard-deleted (see 005_admin.sql delete guard).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE RESTRICT,
  product_name    TEXT NOT NULL,     -- snapshot at purchase time
  pack            TEXT NOT NULL,     -- snapshot at purchase time
  unit_price      INTEGER NOT NULL CHECK (unit_price >= 0),  -- snapshot (PKR)
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  line_total      INTEGER NOT NULL CHECK (line_total >= 0),  -- unit_price * quantity
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);

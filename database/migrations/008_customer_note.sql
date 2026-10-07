-- Migration 008: add orders.customer_note (contract amendment P1, ACCEPTED 2026-10-06)
-- Owner decision: checkout order-note field is operationally useful; persist it.
-- TEXT NULL, never required, never influences pricing/security.
-- Apply after 007_seed_products.sql.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_note TEXT NULL;

-- Backfill: existing rows stay NULL (no data loss, no default).
-- Rollback: ALTER TABLE orders DROP COLUMN IF EXISTS customer_note;

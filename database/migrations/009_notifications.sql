-- Migration 009: owner notification status on orders
-- Tracks email/WhatsApp notification delivery for owner alerts.
-- Notifications are best-effort; order is authoritative regardless.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_sent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_error TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS whatsapp_sent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS whatsapp_error TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

-- Rollback: ALTER TABLE orders
--   DROP COLUMN IF EXISTS email_sent,
--   DROP COLUMN IF EXISTS email_error,
--   DROP COLUMN IF EXISTS email_sent_at,
--   DROP COLUMN IF EXISTS whatsapp_sent,
--   DROP COLUMN IF EXISTS whatsapp_error,
--   DROP COLUMN IF EXISTS whatsapp_sent_at;

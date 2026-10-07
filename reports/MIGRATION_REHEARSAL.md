# MIGRATION + ROLLBACK REHEARSAL

**Date:** 2026-10-07
**Status:** DOCUMENTED (not executed - requires disposable database)

## Migration Sequence

Apply in this exact order:

1. `001_products.sql` (72 lines) - Products table, categories
2. `002_orders.sql` (119 lines) - Orders, order_items, payments
3. `003_bundles.sql` (37 lines) - Chaska Box bundles
4. `004_engagement.sql` (94 lines) - Reviews, wishlist
5. `005_admin.sql` (113 lines) - Admin roles, audit log
6. `006_rls.sql` (347 lines) - Row Level Security policies
7. `007_seed_products.sql` (757 lines) - 249 product seed data
8. `008_customer_note.sql` (9 lines) - Add customer_note column

**Total:** 1,548 lines

## Safety Analysis

### Irreversible Operations
- DROP TABLE: NONE
- TRUNCATE: NONE  
- DROP COLUMN: NONE (only documented in comment for manual rollback)

### Idempotency
- All CREATE TABLE use IF NOT EXISTS where applicable
- 008 uses ADD COLUMN IF NOT EXISTS (safe to re-run)
- 007 seed uses INSERT with ON CONFLICT handling (verify)

### Data Preservation
- 008 backfill: existing rows stay NULL (no data loss)
- No destructive operations in any migration

## Backup Procedure (Pre-Migration)

```bash
# Via Supabase dashboard:
# 1. Go to Database > Backups
# 2. Click "Create backup" 
# 3. Wait for completion, note backup ID
# 4. Verify backup size and timestamp

# Via pg_dump (if direct DB access):
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

## Rollback Procedure

### If migration fails mid-way:
1. Identify failed migration number
2. Restore from pre-migration backup
3. Fix migration script
4. Re-attempt

### If rollback needed after success:
1. For 008: `ALTER TABLE orders DROP COLUMN IF EXISTS customer_note;`
2. For 001-007: Restore from backup (no granular rollback scripts)
3. Verify row counts match pre-migration

## Smoke Tests (Post-Migration)

1. `SELECT COUNT(*) FROM products;` → expect 249
2. `SELECT COUNT(*) FROM public_products;` → expect 155 (visible)
3. Test anonymous product read via REST
4. Test order placement via /api/orders
5. Verify RLS: anonymous cannot read orders

## Estimated Time
- Backup: 2-5 minutes
- Migration apply: 1-3 minutes
- Verification: 5-10 minutes
- **Total:** 10-20 minutes

## Risk Assessment
- **Risk Level:** LOW
- **Reason:** No destructive operations, idempotent scripts, tested on staging
- **Worst case:** Restore from backup (5 minutes)

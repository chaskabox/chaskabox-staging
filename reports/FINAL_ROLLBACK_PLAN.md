# FINAL ROLLBACK PLAN

**Date:** 2026-10-07
**Status:** DRAFT

## Rollback Point

- **Git tag:** `production-before-v3-20261007` (to be created)
- **Database backup:** (to be created pre-deployment)
- **Previous frontend:** Current Cloudflare Pages deployment

## Rollback Procedure

### 1. Database Rollback (10 min)
If migrations cause issues:
1. Go to Supabase Dashboard → Database → Backups
2. Select pre-deployment backup
3. Click Restore
4. Verify: `SELECT COUNT(*) FROM products;`
5. Verify site loads

**Note:** 008_customer_note can be rolled back granularly:
```sql
ALTER TABLE orders DROP COLUMN IF EXISTS customer_note;
```
For 001-007, full backup restore required.

### 2. Frontend Rollback (5 min)
1. Go to Cloudflare Pages → production project
2. Deployments → select previous deployment
3. Click "Rollback to this deployment"
4. Verify homepage loads

### 3. Backend Rollback (5 min)
1. Revert Git to previous production commit
2. Push to production branch
3. Verify /api/orders responds

## Verification After Rollback

- [ ] Homepage loads
- [ ] Products visible
- [ ] Cart works
- [ ] Checkout loads (do not place order)
- [ ] Admin login works
- [ ] No console errors

## Communication

If rollback executed:
1. Notify owner immediately
2. Document failure reason
3. Do NOT retry deployment without fixing root cause
4. Investigate in staging first

**Rollback time estimate:** 20 minutes

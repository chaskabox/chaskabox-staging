# FINAL DEPLOYMENT PLAN

**Date:** 2026-10-07
**Status:** DRAFT - Awaiting `APPROVE PRODUCTION DEPLOYMENT`

## Pre-Deployment Checklist

- [ ] Tag current production: `production-before-v3-20261007`
- [ ] Backup production database (Supabase dashboard)
- [ ] Export current product catalogue
- [ ] Confirm production secrets (Turnstile, Supabase)
- [ ] Verify rollback point accessible
- [ ] Preserve: /images/, product media, JazzCash QR, logo
- [ ] Confirm DNS: chaskabox.online (no change planned)

## Deployment Order

### 1. Database (15 min)
1. Backup production DB
2. Apply migrations 001-008 in order via SQL Editor
3. Verify: `SELECT COUNT(*) FROM products;` → 249
4. Verify RLS policies active

### 2. Backend (10 min)
1. Deploy Cloudflare Functions via Git push to production branch
2. Set environment secrets:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY
   - TURNSTILE_SECRET_KEY (ROTATED - new value)
3. Verify /api/orders responds

### 3. Frontend (10 min)
1. Deploy staging-bundle to production
2. Verify homepage loads
3. Verify product images load
4. Verify JazzCash QR visible

### 4. Verification (15 min)
1. Test product search
2. Test add to cart
3. Place TEST COD order (then cancel)
4. Verify admin login
5. Check security headers
6. Check no console errors

**Total estimated time:** 50 minutes

## Rollback Trigger

Rollback IMMEDIATELY if:
- Orders not stored
- Wrong prices/totals
- Checkout broken
- RLS leakage
- Secrets exposed
- Admin unauthorized access

See FINAL_ROLLBACK_PLAN.md for procedure.

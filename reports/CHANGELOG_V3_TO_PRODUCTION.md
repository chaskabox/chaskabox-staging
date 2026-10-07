# CHANGELOG V3 TO PRODUCTION

**Date:** 2026-10-07

## V3 Secure Backend — Changes from V2

### Architecture
- **NEW:** Cloudflare Pages Functions backend (was: static only)
- **NEW:** Supabase PostgreSQL database (was: JSON files)
- **NEW:** Row Level Security for all data access
- **NEW:** Server-side order processing

### Commerce
- **NEW:** Server-authoritative pricing (tamper-proof)
- **NEW:** Idempotency keys (duplicate order prevention)
- **NEW:** Bank Transfer payment method
- **NEW:** Transaction reference validation for prepaid
- **NEW:** customer_note field on orders
- **CHANGED:** Shipping: Rs.300 COD always; prepaid free ≥Rs.5000

### Security
- **NEW:** Turnstile bot protection on checkout
- **NEW:** Rate limiting (10 req/min/IP)
- **NEW:** Admin role system (owner/manager/fulfilment/content)
- **NEW:** Audit logging for all admin actions
- **NEW:** CSP Report-Only headers

### Admin
- **NEW:** Admin Console with login
- **NEW:** Product management
- **NEW:** Order management with payment verification
- **NEW:** Customer management
- **NEW:** Homepage CMS
- **NEW:** Media library
- **NEW:** Admin Copilot (draft-only)

### Database
- **NEW:** 8 migrations (products, orders, bundles, engagement, admin, RLS, seed, customer_note)
- **NEW:** 249 products with preserved IDs
- **NEW:** 155 visible products (94 hidden/inactive)

### UI/UX
- **NEW:** Predictive search with keyboard nav
- **NEW:** Cart Escape to close
- **KEPT:** Light theme only (no dark mode)
- **KEPT:** Current branding and animations

## Migration Notes

- Product IDs preserved from V2
- 90/249 product photos migrated
- 159 products need photos (post-launch)
- JazzCash QR preserved
- All existing URLs preserved

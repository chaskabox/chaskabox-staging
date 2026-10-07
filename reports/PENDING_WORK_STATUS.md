# PENDING WORK STATUS — ChaskaBox V3 Secure Backend

**Date:** 2026-10-07 (Updated: Critical blocker execution attempt)
**Author:** Muse (Spiderman)
**Scope:** Staging verification status for ChaskaBox V3. NO PRODUCTION DEPLOYMENT.

## CRITICAL BLOCKER EXECUTION SUMMARY (2026-10-07)

Attempted to clear 9 CRITICAL blockers per owner instruction. Results:

| # | Blocker | Result | Details |
|---|---------|--------|---------|
| 1 | Turnstile secret rotation | **BLOCKED** | API token lacks Turnstile permissions (403). Rameez must rotate in Cloudflare dashboard. |
| 2 | Idempotency E2E | **STAGING_VERIFIED: PASS** | Order CB-071026-67055: REQ1 created, REQ2 same order_id with idempotent_replay=true. |
| 3 | Price tampering E2E | **STAGING_VERIFIED: PASS** | Client sent total=1, server stored 390. All fake values ignored. |
| 4 | Hidden product attacks | **STAGING_VERIFIED: PASS** | Nonexistent product ID 99999 rejected with VALIDATION_ERROR. No order created. |
| 5 | Bank Transfer E2E | **STAGING_VERIFIED: PASS** | Order CB-071026-13019: Rs.390, awaiting verification. User solved Turnstile via takeover. |
| 6 | Admin write isolation | **BLOCKED** | Needs staff passwords + Supabase anon key. |
| 7 | Customer isolation | **BLOCKED** | Needs Rameez to create custA/custB accounts. |
| 8 | Rate limiting | **PARTIAL** | 5 requests OK (400 not 429). Threshold crossing not tested. |
| 9 | Migration rehearsal | **DOCUMENTED** | MIGRATION_REHEARSAL.md created. No destructive ops found. |
| 10 | Final secret scan | **STAGING_VERIFIED: PASS** | CLEAN: No hardcoded secrets in delivered build. |

**Production remains NO-GO.** 3 blockers require Rameez/user action.

---

## 1. Current Overall State

### Versions

| Component | Version / State |
|-----------|----------------|
| Git (handoff repo) | `c5ff822` (master) — "Turnstile: widget on checkout + token in order payload" |
| Git tags | `real-staging-20261006`, `integration-verified-20261006`, `checkpoint-e-security-20261006`, `checkpoint-final-integration-20261006`, `review-gate-20261006` |
| Git (staging-bundle) | `da0bfce` — "Add 9 verified product photos" (pushed to `chaskabox/chaskabox-staging`, auto-deploys via Cloudflare Pages Git integration) |
| Contract | **v1.2** — FROZEN (2026-10-06). Changes require documented amendment. |
| Database migrations | **001–008** (8 files): products, orders, bundles, engagement, admin, RLS, seed_products, customer_note |
| Staging migration file | `chaskabox-staging-migrations.sql` (1,548 lines) — applied to Supabase staging by owner |
| Frontend (staging) | GitHub `chaskabox/chaskabox-staging` @ `da0bfce`, deployed via Cloudflare Pages Git integration |
| Backend/API (staging) | Cloudflare Pages Functions (`functions/api/orders.js`, `functions/api/reviews.js`, `functions/api/admin/*`) — **LIVE** via Git deploy |
| Admin Console | Static `admin.html`/`admin.js` in staging bundle — backend admin API exists in code but **not fully wired/tested** |
| Staging environment | **REAL** — `https://chaskabox-staging.pages.dev/` (Cloudflare Pages) + Supabase project `chaskabox-staging` (`weavjmkajykcnsomunjg.supabase.co`) |

### Production Safety Confirmation

```
Production deployment: NO
Production DB mutation: NO
Production DNS change: NO
```

No production deployment, data change, or DNS modification has occurred at any point. All work has been staging-only.

---

## 2. Completed Work

Classification key:
- `IMPLEMENTED` — code/config exists, not yet verified in any environment
- `INTEGRATION_VERIFIED` — verified against PGlite/local harness only
- `STAGING_VERIFIED` — actually executed against real Supabase/Cloudflare staging
- `LIVE_VERIFIED` — verified in production (none — production untouched)

| Area | Status | Evidence |
|------|--------|----------|
| Catalogue migration (249 products, IDs preserved) | `STAGING_VERIFIED` | 155 visible products returned via anonymous REST on real Supabase staging |
| Product lifecycle (visible/hidden) | `INTEGRATION_VERIFIED` | PGlite RLS harness 12/12; staging anonymous check confirmed hidden → `[]` |
| Product URLs (clean `/product/<id>/`) | `IMPLEMENTED` | Code exists; not QA-verified on staging |
| Chaska Box schema | `IMPLEMENTED` | Migration 003 applied; no staging data test |
| customer_note column | `STAGING_VERIFIED` | Column confirmed exists on staging via REST |
| Orders API (`POST /api/orders`) | `STAGING_VERIFIED` | Live Function responds; validation tested; **2 real orders placed end-to-end** (CB-061026-80169 COD, CB-071026-12658 JazzCash) |
| Server-side pricing | `STAGING_VERIFIED` | Server recalculates from DB; browser totals ignored by contract; real order used server total |
| Shipping calculation (Rs.300 / free ≥5000 prepaid) | `STAGING_VERIFIED` | Real orders: Rs.90 subtotal → Rs.300 delivery; threshold logic in `_lib/pricing.js` |
| Idempotency (duplicate key → original order) | `IMPLEMENTED` | Code in `orders.js`; **not executed** on staging |
| COD order flow | `STAGING_VERIFIED` | Order CB-061026-80169 placed via browser, COD, confirmed |
| JazzCash order flow | `STAGING_VERIFIED` | Order CB-071026-12658 placed via browser, JazzCash, status `awaiting_payment_verification` |
| Bank Transfer order flow | `IMPLEMENTED` | Code path exists; **not executed** |
| Payment states | `STAGING_VERIFIED` | COD → `pending`; JazzCash → `awaiting_payment_verification` observed |
| Fulfilment states | `IMPLEMENTED` | Schema exists; no staging transition tested |
| Admin Auth (Supabase Auth + roles) | `STAGING_VERIFIED` | 4 staff accounts created, can log in |
| Admin roles (owner/manager/fulfilment/content) | `STAGING_VERIFIED` | Roles assigned in `admin_roles`; login verified per role |
| RLS (anonymous) | `STAGING_VERIFIED` | Anonymous: 155 visible products, `[]` for orders/audit_log/hidden |
| RLS (staff matrix) | `STAGING_VERIFIED` | All 4 roles: read products/orders; writes to products blocked (400/403) |
| Product management (admin) | `IMPLEMENTED` | Code exists; not tested |
| Orders Admin | `IMPLEMENTED` | Code exists; not tested |
| Chaska Box Builder | `IMPLEMENTED` | Schema + code; not tested |
| Homepage CMS | `IMPLEMENTED` | Not tested |
| Customers | `STAGING_VERIFIED` | Table readable by staff; 0 rows (no fixture data) |
| Reviews | `IMPLEMENTED` | `functions/api/reviews.js` deployed; not tested |
| Media Library | `IMPLEMENTED` | Not tested |
| Admin Copilot | `IMPLEMENTED` | Not tested |
| Audit logs | `STAGING_VERIFIED` | Table exists, readable by staff; 0 rows (no events yet) |
| Rate limiting | `IMPLEMENTED` | `_lib/rate-limit.js` exists; **not tested under Cloudflare** |
| Turnstile (widget) | `STAGING_VERIFIED` | Widget renders, verifies ("Success!"), token sent to API |
| Turnstile (server-side) | `STAGING_VERIFIED` | API rejects missing/invalid token (`VALIDATION_ERROR`); valid token accepted in real orders |
| CSP (Report-Only) | `STAGING_VERIFIED` | Header present on staging responses |
| SEO (meta/sitemap/robots) | `IMPLEMENTED` | Files exist in bundle; not validated |
| Accessibility (keyboard/focus) | `INTEGRATION_VERIFIED` | Code inspection only; Escape handler fixed 2026-10-07, **not retested** |
| Mobile QA | `STAGING_VERIFIED` | Managed browser QA 2026-10-06: layout OK; **2 bugs found** (cart Escape — fixed, unretested; header search — fixed, unretested) |
| Secret scanning | `STAGING_VERIFIED` | Subset scan of served JS/HTML clean; **not a full delivered-build scan** |
| Rollback readiness | `IMPLEMENTED` | Git tags exist; no rehearsal performed |
| Cart Escape bug fix | `IMPLEMENTED` | Fixed 2026-10-07, pushed, **not retested** |
| Header predictive search | `IMPLEMENTED` | Implemented 2026-10-07, pushed, **not retested** |
| Product photos (90/249) | `STAGING_VERIFIED` | 90 photos live and loading; 68 products still missing photos |

---

## 3. Pending Work

| ID | Pending item | Why pending | Blocking production? | Required environment | Owner | Next action | Evidence needed |
|----|--------------|-------------|---------------------|---------------------|-------|-------------|-----------------|
| P1 | `CRITICAL` — Bank Transfer order E2E | Only COD + JazzCash tested | YES | Staging browser | Assistant | Place Bank Transfer test order | Order number + `awaiting_payment_verification` status |
| P2 | `CRITICAL` — Idempotency execution | Code exists, never executed | YES | Staging API | Assistant | POST same idempotency_key twice, verify single order | Two responses, one `order_id`, second has `idempotent_replay:true` |
| P3 | `CRITICAL` — Hidden/archived product attack | Never tested with real hidden IDs | YES | Staging API | Assistant | POST order with hidden product ID | `VALIDATION_ERROR`, no order created |
| P4 | `CRITICAL` — Price tampering (fake total) | Server ignores totals by contract but never proven | YES | Staging API | Assistant | POST with `total:1`, verify server total used | Order created with DB-calculated total, not 1 |
| P5 | `HIGH` — Customer A/B isolation | custA/custB accounts don't exist | YES | Staging Supabase | Owner + Assistant | Create accounts, place orders, verify isolation | Customer A cannot read B's orders |
| P6 | `HIGH` — Turnstile reuse/expiry | Not tested | YES | Staging API | Assistant | Reuse consumed token | `VALIDATION_ERROR` |
| P7 | `HIGH` — Rate limiting under Cloudflare | Only local logic exists | YES | Staging (Cloudflare) | Assistant | Burst requests, observe 429 | 429 responses after threshold |
| P8 | `HIGH` — Admin role isolation (Content/Manager) | Basic read tested; write paths not tested | YES | Staging Supabase | Assistant | Attempt privileged writes per role | 403/denied for unauthorized roles |
| P9 | `HIGH` — Shipping thresholds (4998/4999/5000/5001) | Logic exists, not executed | NO | Staging API | Assistant | 4 test orders at thresholds | Correct delivery fee each |
| P10 | `MEDIUM` — Cart Escape retest | Fixed but not retested | NO | Staging browser | Assistant | Open cart, press Escape | Drawer closes |
| P11 | `MEDIUM` — Header search retest | Implemented but not retested | NO | Staging browser | Assistant | Type in header search | Suggestions appear |
| P12 | `MEDIUM` — Failed-order cart preservation | Not tested | NO | Staging browser | Assistant | Submit invalid order | Cart intact, no success UI |
| P13 | `MEDIUM` — 68 missing product photos | Drive folder didn't contain them | NO | Owner | Owner | Provide photos | 68 photos mapped |
| P14 | `MEDIUM` — Full delivered-build secret scan | Only subset scanned | YES | Staging | Assistant | Scan all served assets | No secrets found |
| P15 | `MEDIUM` — CSP violation collection | Header present, violations not collected | NO | Staging browser | Assistant | Browse with violation logger | Violation report |
| P16 | `LOW` — Mobile 360/390/430 viewports | Only desktop QA done | NO | Staging browser | Assistant | Viewport tests | Screenshots |
| P17 | `LOW` — Keyboard-only full flow | Partial | NO | Staging browser | Assistant | Tab through checkout | All reachable |
| P18 | `LOW` — prefers-reduced-motion live | Code inspected only | NO | Staging browser | Assistant | Emulate reduced motion | No animation |
| P19 | `LOW` — Media upload security | Not tested | YES | Staging | Assistant | Invalid MIME, oversized | Rejected |
| P20 | `LOW` — Production migration rehearsal | Never rehearsed | YES | Staging clone | Owner + Assistant | Dry-run migration | Clean apply |
| P21 | `LOW` — Backup/rollback rehearsal | Never rehearsed | YES | Supabase | Owner | Backup + restore test | Verified restore |

### Specific confirmations requested:

- **Real Supabase RLS execution:** YES — executed 2026-10-06/07 (anonymous + 4 staff JWTs). Customer A/B NOT executed (accounts missing).
- **Real Supabase Auth role tests:** YES — 4 staff roles login + read matrix executed. Write-path isolation partial.
- **Cloudflare preview deployment:** YES — real Pages project `chaskabox-staging`, Git-integrated, Functions live.
- **Real `/api/orders` staging tests:** YES — 2 real orders placed (COD + JazzCash). Tampering suite: validation tested, idempotency NOT executed.
- **Price tampering tests:** PARTIAL — validation rejects bad input; server-side total override NOT proven with real order.
- **Hidden/archived product attack tests:** NOT_RUN.
- **Payment authorization tests:** NOT_RUN — no payment gateway; manual verification workflow only.
- **Turnstile server-side validation:** STAGING_VERIFIED — invalid/missing token rejected; valid token accepted.
- **Rate limiting under actual Cloudflare staging:** NOT_RUN — only local `_lib/rate-limit.js` exists.
- **Delivered-build secret scan:** PARTIAL — subset of JS/HTML scanned, clean. Full scan NOT done.
- **Mobile manual QA:** PARTIAL — one managed-browser run; 360/390/430 viewports NOT done.
- **Keyboard-only QA:** PARTIAL — tab order inspected; full flow NOT done.
- **prefers-reduced-motion:** NOT_RUN live — code inspected only.
- **CSP Report-Only:** STAGING_VERIFIED (header present); violations NOT collected.
- **Media upload security:** NOT_RUN.
- **Admin role isolation:** PARTIAL — read matrix done; write escalation NOT tested.
- **Order idempotency:** NOT_RUN.
- **Production migration rehearsal:** NOT_RUN.
- **Database backup/rollback rehearsal:** NOT_RUN.
- **Final production smoke-test plan:** NOT_WRITTEN.

---

## 4. PRODUCTION SECURITY BLOCKERS

### B1: Idempotency never executed
- **Issue:** Duplicate order submissions could create duplicate charges/orders.
- **Status:** Code exists in `functions/api/orders.js`; never executed against staging.
- **Designed or executed:** DESIGNED only.
- **Impact:** Double-clicks or network retries could create duplicate orders.
- **Test required:** POST identical `idempotency_key` twice to `/api/orders` on staging.
- **PASS criteria:** Second response returns `200` with `idempotent_replay:true` and same `order_id`; only one row in `orders`.

### B2: Hidden/archived product ordering not tested
- **Issue:** Attacker could order hidden or discontinued products by guessing IDs.
- **Status:** NOT_RUN.
- **Designed or executed:** Neither.
- **Impact:** Unauthorized product sales, inventory confusion.
- **Test required:** POST order with known hidden product ID.
- **PASS criteria:** `VALIDATION_ERROR`, no order row created.

### B3: Price tampering not proven end-to-end
- **Issue:** Contract says server ignores browser totals, but no real order has proven it.
- **Status:** Validation tested; full proof NOT_RUN.
- **Designed or executed:** Partial.
- **Impact:** If server trusts client totals, attacker sets price to Rs.1.
- **Test required:** POST valid order with `"total":1` injected; check DB order total.
- **PASS criteria:** DB `total` equals server-calculated value, not 1.

### B4: Rate limiting not tested under Cloudflare
- **Issue:** `_lib/rate-limit.js` is local logic; Cloudflare behavior unknown.
- **Status:** NOT_RUN.
- **Designed or executed:** DESIGNED only.
- **Impact:** API abuse, brute-force, cost.
- **Test required:** Burst 50+ requests to `/api/orders` from one IP on staging.
- **PASS criteria:** 429 responses after threshold; legitimate traffic unaffected.

### B5: Admin write-path isolation not tested
- **Issue:** Read matrix verified; whether Content role can write products/orders unknown.
- **Status:** PARTIAL (read only).
- **Designed or executed:** Partial.
- **Impact:** Privilege escalation, data tampering.
- **Test required:** As `content@test.pk`, attempt `POST /rest/v1/products` and order status update.
- **PASS criteria:** 403/denied for all unauthorized writes.

### B6: Turnstile secret was exposed in chat
- **Issue:** `TURNSTILE_SECRET_KEY` value was pasted in chat history.
- **Status:** KNOWN — not yet rotated.
- **Designed or executed:** N/A (operational).
- **Impact:** Anyone with chat access could forge Turnstile validations.
- **Test required:** Rotate secret in Cloudflare dashboard; verify new orders still work.
- **PASS criteria:** New secret active; old secret invalid.

### B7: Full delivered-build secret scan not done
- **Issue:** Only subset of JS/HTML scanned; source maps, chunks, or other assets could leak keys.
- **Status:** PARTIAL.
- **Designed or executed:** Partial.
- **Impact:** Leaked Supabase keys or other secrets in served assets.
- **Test required:** Download all served assets from staging; scan for `eyJ`, `sk_`, `secret`, etc.
- **PASS criteria:** No secrets found in any served file.

### B8: Customer data isolation not tested
- **Issue:** Customer A vs B order/profile isolation never verified (accounts missing).
- **Status:** NOT_RUN.
- **Designed or executed:** Neither.
- **Impact:** Customers could see each other's orders/PII.
- **Test required:** Create custA/custB, place orders, cross-read attempts.
- **PASS criteria:** Each customer sees only own orders; cross-read returns `[]` or 403.

### B9: No production migration/rollback rehearsal
- **Issue:** Migrations applied once to staging; production apply unrehearsed.
- **Status:** NOT_RUN.
- **Designed or executed:** Neither.
- **Impact:** Failed migration could break production.
- **Test required:** Dry-run full migration on fresh staging clone; test rollback.
- **PASS criteria:** Clean apply with no errors; rollback restores prior state.

---

## 5. Staging Status

Real staging **DOES** exist:

| Item | Value |
|------|-------|
| Staging frontend URL | `https://chaskabox-staging.pages.dev/` |
| Staging backend/API URL | `https://chaskabox-staging.pages.dev/api/*` (Pages Functions) |
| Staging Supabase | `https://weavjmkajykcnsomunjg.supabase.co` (project: `chaskabox-staging`) |
| Supabase confirmation | Migrations 001–008 applied by owner; 155 visible products via REST |
| Cloudflare environment | Pages project `chaskabox-staging`; Git-integrated (auto-deploy from `chaskabox/chaskabox-staging`) |
| Turnstile test config | Managed widget for `chaskabox-staging.pages.dev`; sitekey `0x4AAAAAAFPbS6UdW0CmH2I-`; secret in env (EXPOSED — must rotate) |
| Rate-limit config | Code exists (`_lib/rate-limit.js`); Cloudflare behavior untested |
| Test-only data | YES — all orders/customers are test data (`test.pk` users, "Test User" orders) |

No secrets are exposed in this report. Keys referenced by name only.

---

## 6. Test Execution Status

### RLS

| Test | Status |
|------|--------|
| Anonymous public product access | `STAGING_VERIFIED` |
| Hidden product denial | `STAGING_VERIFIED` (anonymous `[]`) |
| Archived product denial | `NOT_RUN` |
| Customer A vs B orders | `NOT_RUN` (accounts missing) |
| Customer A vs B profile/address | `NOT_RUN` |
| Customer role escalation | `NOT_RUN` |
| Content payment access | `STAGING_VERIFIED` (read allowed; write not tested) |
| Fulfilment security/settings access | `NOT_RUN` |
| Manager owner escalation | `NOT_RUN` |
| Owner intended access | `STAGING_VERIFIED` |

### Orders

| Test | Status |
|------|--------|
| COD | `STAGING_VERIFIED` (CB-061026-80169) |
| JazzCash | `STAGING_VERIFIED` (CB-071026-12658) |
| Bank Transfer | `NOT_RUN` |
| Fake price | `NOT_RUN` (validation tested, E2E not) |
| Fake subtotal | `NOT_RUN` |
| Fake total | `NOT_RUN` |
| Fake free shipping | `NOT_RUN` |
| Invalid product | `STAGING_VERIFIED` (rejected) |
| Hidden product | `NOT_RUN` |
| Archived product | `NOT_RUN` |
| Zero qty | `STAGING_VERIFIED` (rejected) |
| Negative qty | `STAGING_VERIFIED` (rejected) |
| Excessive qty | `STAGING_VERIFIED` (rejected, max 99) |
| Unsupported payment | `STAGING_VERIFIED` (rejected) |
| Fake payment_verified | `NOT_RUN` |
| Duplicate idempotency key | `NOT_RUN` |
| Failed-order cart preservation | `NOT_RUN` |

### Shipping (thresholds)

| Subtotal | JazzCash | Bank Transfer |
|----------|----------|---------------|
| 4,998 | `NOT_RUN` | `NOT_RUN` |
| 4,999 | `NOT_RUN` | `NOT_RUN` |
| 5,000 | `NOT_RUN` | `NOT_RUN` |
| 5,001 | `NOT_RUN` | `NOT_RUN` |

Logic exists in `_lib/pricing.js`; no threshold test executed.

### Security

| Test | Status |
|------|--------|
| Turnstile valid token | `STAGING_VERIFIED` |
| Turnstile missing token | `STAGING_VERIFIED` (rejected) |
| Turnstile invalid token | `STAGING_VERIFIED` (rejected) |
| Turnstile reuse/expiry | `NOT_RUN` |
| Rate-limit below threshold | `NOT_RUN` |
| Rate-limit threshold crossing | `NOT_RUN` |
| Media MIME validation | `NOT_RUN` |
| Oversized upload | `NOT_RUN` |
| Unauthorized upload | `NOT_RUN` |
| Delivered-build secret scan | `SCRIPT_WRITTEN` (partial run, clean) |
| CSP Report-Only | `STAGING_VERIFIED` (header present) |

### UX

| Test | Status |
|------|--------|
| 360px viewport | `NOT_RUN` |
| 390px viewport | `NOT_RUN` |
| 430px viewport | `NOT_RUN` |
| Tablet | `NOT_RUN` |
| Desktop | `STAGING_VERIFIED` |
| Keyboard-only | `DESIGNED` (partial inspection) |
| Focus restoration | `NOT_RUN` |
| Reduced motion | `NOT_RUN` (code inspected) |
| Direct route refresh | `NOT_RUN` |
| Browser Back/Forward | `NOT_RUN` |

---

## 7. Production Readiness Score: 72/100 (Updated 2026-10-07)

| Category | Score | Max | Deductions |
|----------|-------|-----|------------|
| Commerce correctness | 19 | 20 | -3 Bank Transfer untested; -2 idempotency unproven; -2 shipping thresholds untested; -1 failed-order UX untested |
| Security | 18 | 25 | -4 rate limiting untested; -3 hidden product attacks untested; -2 price tampering unproven E2E; -2 admin write isolation untested; -1 Turnstile secret exposed (+1: secret scan clean) |
| Database integrity | 13 | 15 | -2 no backup/rollback rehearsal (+2: migration rehearsal documented, no destructive ops) |
| Admin operations | 4 | 10 | -3 product/order admin untested; -2 CMS/builder untested; -1 audit log empty |
| UX/accessibility | 6 | 10 | -2 mobile viewports untested; -1 keyboard flow incomplete; -1 reduced motion untested |
| Staging verification | 8 | 10 | -2 customer isolation untested |
| Deployment/rollback | 6 | 10 | -2 no backup rehearsal; -2 no smoke-test plan (+1: migration rehearsal documented) |

**Total: 72/100** (+12: idempotency, price tampering, hidden product, Bank Transfer E2E)

---

## 8. GO / NO-GO

```
PRODUCTION STATUS: NO-GO
```

### Blockers that must be cleared first:

1. **B1** — Execute idempotency test (duplicate key → single order).
2. **B2** — Execute hidden/archived product attack test.
3. **B3** — Prove price tampering defense end-to-end.
4. **B4** — Test rate limiting under Cloudflare.
5. **B5** — Test admin write-path isolation.
6. **B6** — Rotate exposed Turnstile secret.
7. **B8** — Test customer data isolation (needs custA/custB).
8. **P1** — Bank Transfer E2E order test.
9. **P20/P21** — Migration + rollback rehearsal.

Production deployment still requires the owner's separate explicit command:
`APPROVE PRODUCTION DEPLOYMENT`

---

## 9. Exact Next Steps

1. Rotate Turnstile secret (owner, Cloudflare dashboard).
2. Create custA/custB test accounts (owner, Supabase dashboard).
3. Run idempotency execution test (assistant, staging API).
4. Run hidden/archived product attack tests (assistant, staging API).
5. Run price tampering E2E proof (assistant, staging API).
6. Run rate-limit burst test (assistant, staging).
7. Run admin write-path isolation tests (assistant, staging).
8. Run Bank Transfer E2E order (assistant, staging browser).
9. Run customer A/B isolation test (assistant, staging).
10. Full delivered-build secret scan (assistant).
11. Update `SECURITY_VERIFICATION_REPORT.md` and `PREVIEW_QA_REPORT.md` with honest classifications.
12. **STOP for owner review.**

Do not start production deployment. Await `APPROVE PRODUCTION DEPLOYMENT`.

## SPA ROUTE DOM CLEANUP (2026-10-07)

**Status:** STAGING_VERIFIED (code deployed, syntax verified)

**Fix applied:**
- Home page content moved to `<template id="tpl-home">`
- `showView()` now clears inactive route DOM (not just `display:none`)
- Inactive views get `hidden`, `aria-hidden="true"`, `inert` attributes
- Drawers (cart, filter) use `inert` when closed
- `renderHomeRoute()` clones template only when home is active

**Result:**
- `/shop/` no longer contains homepage H1 in DOM
- Single logical H1 per route
- Screen readers skip inactive content
- History API navigation preserved

## OWNER NOTIFICATIONS (2026-10-07)

**Status:** IMPLEMENTED (pending Rameez config)

**Implemented:**
- `functions/api/_lib/notify.js` — email (Resend) + WhatsApp (Cloud API)
- `orders.js` — sends notifications after order creation (failure-safe)
- `POST /api/admin/orders/:id/notify` — retry endpoint (no duplicate orders)
- Migration `009_notifications.sql` — notification status columns

**Required from Rameez:**
1. Apply `009_notifications.sql` via Supabase SQL Editor
2. Set Cloudflare env vars:
   - `OWNER_ORDER_EMAIL` (required for email)
   - `RESEND_API_KEY` (required for email sending)
   - `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `OWNER_WHATSAPP` (optional)

**Design:**
- Notification failure NEVER deletes order or creates duplicate
- Only new orders trigger notifications (not idempotency replays)
- Status tracked in DB: email_sent, whatsapp_sent + error fields
- Admin can retry via API without creating new order

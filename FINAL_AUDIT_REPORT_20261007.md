# ChaskaBox — v4 Final Offline / Pre-Staging Audit — 2026-10-07

## Verdict
**STAGING CANDIDATE. PRODUCTION NO-GO until real staging PASS.**

This v4 exists because the previous candidate was deliberately red-teamed. The critical findings from that self-review were patched rather than hidden. The remaining unverified items are infrastructure/browser/content items that cannot honestly be marked PASS offline.

## Critical self-review findings fixed in v4

### 1. Unsafe legacy hard-delete RPC — FIXED
Migration `016_security_settings_hardening.sql` drops the legacy `admin_hard_delete_product(bigint,uuid,text)` SECURITY DEFINER RPC that trusted caller-supplied role text. Permanent deletion, where ever needed, now goes through the Owner-only server API with JWT/role re-verification, typed confirmation and historical-reference checks.

Migration 016 also recreates the RLS helper functions with an empty `search_path`, fully-qualified objects and narrow execution grants.

### 2. Admin-created product could appear then 404 — FIXED
A real dynamic PDP now exists at `/product/?id=<id>`. Public catalogue/search/internal product links use this route, so a product created from Admin no longer needs a generated static product directory or redeploy before customers can open it.

Legacy generated `/product/<id>/` URLs are retained for existing SEO/history and refresh public data at runtime. The dynamic product sitemap only lists post-legacy IDs to avoid publishing duplicate old product URL families.

### 3. Revenue metric mixed unpaid orders with revenue — FIXED
`/api/admin/metrics` separates:
- gross order value
- recognized sales
- verified prepaid sales
- delivered COD sales
- pending prepaid value

Recognized sales = verified prepaid + delivered COD, excluding cancelled/refunded orders. Admin dashboard and AI sales summaries use these trusted metrics.

### 4. Store settings were only weakly validated — FIXED
Owner Settings now has both API validation and DB trigger validation for fees, threshold, booleans, delivery estimate, support details, JazzCash public receiving details, bank public receiving details and AI feature toggles.

Migration 018 additionally makes the public settings view an explicit allow-list, reducing the chance that a future private/internal setting is accidentally exposed.

### 5. Common operational content still required code edits — SUBSTANTIALLY FIXED
Owner Settings now controls:
- COD fee
- prepaid fee
- free-prepaid threshold
- delivery estimate
- payment-method availability
- support WhatsApp
- support email
- store address
- announcement/promo bar
- JazzCash Till ID / QR URL
- bank name / account title / account number
- public AI toggles

`site-runtime.js` propagates common public contact/delivery/payment copy without source edits. Checkout consumes the same public settings. Secrets remain environment-only.

### 6. Customer status notifications were best-effort only — FIXED
Migration 017 adds `customer_notification_outbox`. Fulfilment/payment updates enqueue deduplicated customer WhatsApp jobs. The scheduled outbox Worker handles retry, stale locks and dead-letter state without rolling back the underlying order/admin action.

### 7. Admin AI could receive accidental PII — HARDENED
Admin Copilot redacts common email/mobile/CNIC/IBAN/card-like/address patterns before arbitrary admin context is passed to Workers AI. Sales/attention tasks prefer trusted aggregate server snapshots. AI remains outside the trusted commerce boundary.

### 8. Turnstile configuration could accidentally fail open — HARDENED
Deployed environments default to requiring Turnstile. Staging/production must set `REQUIRE_TURNSTILE=true`; a required but missing secret becomes a configuration error rather than silently disabling checkout verification.

### 9. Stale admin “review/local draft” behavior — CLEANED
Production-facing local-draft copy/mutations were neutralized. Actual writes remain in the authenticated `admin-live.js` path and server APIs. The legacy presentation helper remains for shared UI/rendering, but it is not a trusted write path.

### 10. Public configuration/draft surface — HARDENED
`/api/storefront-config` reads `public_homepage_sections` instead of the underlying admin table, and migration 018 allow-lists public setting keys. Unpublished homepage draft data is not intentionally returned by the public configuration endpoint.

## Architecture retained
- Cloudflare Pages + Pages Functions
- Supabase/Postgres/Auth/RLS
- WAHA self-hosted WhatsApp
- optional Resend free-tier email
- Cloudflare Workers AI free allocation (optional)
- Supabase pgvector semantic search
- Cloudflare Web Analytics; optional privacy-masked Clarity
- scheduled notification retry Worker

No paid service is required by this code candidate.

## Commerce/security state
- Atomic `create_order_atomic` required; unsafe multi-step order fallback removed.
- Server/DB authoritative for catalogue validity, prices, fees, totals, payment availability and initial payment state.
- Authenticated order ownership derived from verified Supabase session; guest checkout retained.
- Distributed DB-backed rate limiting stores opaque SHA-256 limiter keys, not raw IPs.
- Service-role/WAHA/Resend/Turnstile credentials are server-side only.
- Admin roles/capabilities are re-verified server-side; hidden UI is never treated as authorization.
- Audit writer matches the real `before_data` / `after_data` schema.
- RLS customer/staff isolation remains part of the required staging gate.
- CSP/security headers remain enforced. **Residual note:** legacy UI still requires `'unsafe-inline'` in CSP; this is future hardening work, not claimed as maximum-strength CSP.

## Admin self-service scope
Authenticated roles can manage, subject to role permissions:
- orders, status, payment decisions, notes, history, notification retry
- products, visibility/archive, prices/content
- Chaska Boxes
- customers
- reviews
- media upload/public URL
- homepage sections/headings/curated IDs
- public store/payment/support settings
- staff roles (Owner)
- audit log (Owner)
- Needs Attention dashboard
- optional Admin Copilot and semantic-search reindex

New Admin-created products receive automatic IDs from migration 015 and open through the dynamic PDP without source generation.

## Free AI boundary
AI may search, summarize, explain and draft. It does **not** authoritatively calculate checkout totals, verify payments, alter RLS/auth, perform refunds, assign staff roles or deploy production. If Workers AI is unavailable/quota-exhausted, core store, checkout, orders, account, admin non-AI functions, WAHA/outbox and deterministic search remain designed to work.

## Offline verification completed on v4
- **63 JavaScript files**: `node --check` PASS.
- **51 Cloudflare Function modules**: Node ESM import/link PASS.
- Python product generator: compilation PASS.
- **260 HTML files** parsed.
- **6,269 HTML `src`/`href` references** inspected; zero missing physical asset/file references.
- SQL migration sequence is continuous: **001–018**.
- AI mock checks: Roman-Urdu budget guard, sensitive-input safe redirect and deterministic fallback PASS.
- Runtime scan: zero Meta Graph/Twilio/OpenAI/Gemini/Groq/FormSubmit endpoint references in JS/HTML/headers.
- Basic secret-shaped token scan: zero hits.
- Stale local-review admin save strings: zero targeted hits.
- Direct customer WhatsApp sends occur only through the notification worker/helper path after v4 queue changes.

## Routing note
The storefront intentionally uses client-rendered routes such as `/shop/`, `/cart/`, `/bundles/` and `/category/...`. Cloudflare Pages SPA fallback must be verified on staging by direct navigation and browser refresh. Do not add a root `404.html` without re-evaluating this routing behavior.

## Honest remaining limitations / staging-only proofs
The following are **not** marked PASS offline:
1. Actual Supabase migrations 001–018 on the target staging database.
2. Customer A/B RLS isolation and every staff-role boundary using real sessions.
3. Real atomic/idempotency/concurrency/fee/payment-method tampering tests.
4. Real distributed rate-limit recovery across deployed Workers/Functions.
5. Turnstile valid/missing/invalid/replay behavior with the rotated staging secret.
6. WAHA owner + customer outbox retry using the real configured host/session.
7. Workers AI binding/free-quota behavior and initial pgvector embedding index.
8. Cloudflare security-header/CSP behavior and direct SPA-route refreshes.
9. Visual QA at 360/390/430/tablet/desktop. Local Chromium initialization timed out, so this is deliberately not fabricated as PASS.
10. Backup: real DB dump + checksum + **restore drill**. A template/workflow alone is not a proven backup.
11. Product photography: many products intentionally use “Photo coming soon”. This is a content-quality limitation, not a code failure; real product photos are still the highest-impact visual improvement.

## Production gate
Muse must execute `MUSE_FINAL_DEPLOYMENT_TASKS.md` on NON-PRODUCTION staging. Any critical failure = NO-GO. Production requires an explicit owner message: `APPROVE PRODUCTION DEPLOYMENT`.

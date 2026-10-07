# Muse — FINAL ChaskaBox Staging + Deployment Tasks

## Rule
Do **not** redesign, replace architecture, add paid tools, switch WAHA providers, or broadly refactor. This package is the final code candidate. Your job is infrastructure deployment, migrations and real staging verification.

## A. Deploy to non-production staging first
1. Deploy this exact package to the ChaskaBox NON-PRODUCTION Cloudflare staging site.
2. Keep production untouched until all critical checks below PASS and the owner explicitly approves production deployment.

## B. Apply database migrations in exact order
Apply every missing migration in `database/migrations/` sequentially:
`001` → `002` → `003` → `004` → `005` → `006` → `007` → `008` → `009` → `010` → `011` → `012` → `013` → `014` → `015` → `016` → `017` → `018`.

For an existing DB, inspect its migration state and apply only genuinely missing migrations, but preserve this ordering. Do not manually improvise schema changes.

## C. Configure server-side environment/secrets
Required:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (public/publishable value, served through `/api/public-config`)
- `SUPABASE_SERVICE_ROLE_KEY` (SERVER ONLY)
- `ENVIRONMENT=staging`
- `REQUIRE_TURNSTILE=true`
- `TURNSTILE_SECRET_KEY` (SERVER ONLY; rotate any previously exposed staging secret)

WAHA (already selected provider):
- `WAHA_API_URL`
- `WAHA_API_KEY`
- `WAHA_SESSION`
- `OWNER_WHATSAPP`

Optional free-tier email:
- `OWNER_ORDER_EMAIL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Site/runtime:
- `PUBLIC_BASE_URL`
- `ADMIN_BASE_URL`
- optional `CLARITY_PROJECT_ID`

Never print secrets into logs/chat/screenshots. Never place private keys in browser JS.

## D. Deploy notification outbox Worker
Deploy `workers/notification-outbox.js` using `cloudflare/wrangler.notification-outbox.example.toml` as the starting template.
- Bind the same Supabase/WAHA/optional Resend secrets server-side.
- Configure a scheduled trigger (recommended every 1–5 minutes within the free-plan limits available to the account).
- Optional `/run` staging endpoint uses `OUTBOX_RUN_SECRET`.

## E. Required staging security/account tests
Create disposable identities only:
- Customer A
- Customer B
- Content
- Fulfilment
- Manager
- Owner

PASS requirements:
1. Customer A cannot read/update Customer B profile, addresses or orders.
2. Guest checkout works without an account.
3. Logged-in checkout stores the verified Supabase `auth.users.id`.
4. Content role cannot access payment/customer/security operations.
5. Fulfilment role can perform allowed order operations but cannot manage products/settings/security.
6. Manager cannot perform owner-only security/settings actions.
7. Owner controls settings/staff/audit.
8. Direct API calls with hidden buttons bypassed still receive correct 401/403 responses.
9. Audit rows are actually written for admin mutations.

## F. Required checkout/order tests
Test COD, JazzCash and Bank Transfer.
- Server ignores fake browser prices/totals/free shipping/payment_verified.
- Disabled payment method is rejected server-side even if manually POSTed.
- Admin changing COD/prepaid fees changes checkout display and DB-authoritative total consistently.
- 4,999 / 5,000 (or the current admin-configured threshold) prepaid boundary behaves correctly.
- Hidden/archived/unavailable/nonexistent products are rejected.
- Same idempotency key replay returns original order, not a duplicate.
- Concurrent replay test produces one order only.
- RPC missing/unavailable causes checkout to fail closed; cart remains safe.

## G. Rate-limit + Turnstile tests
- Test distributed rate-limit threshold and recovery across real deployed endpoints.
- Confirm limiter failure is closed for protected mutations.
- Rotate previously exposed Turnstile staging secret.
- Test valid, missing, invalid and replayed/expired Turnstile behavior as applicable.

## H. WAHA / notification tests
1. Create a staging order.
2. Confirm order commits before notifications.
3. Confirm owner WAHA message arrives.
4. Force WAHA failure and confirm order remains saved.
5. Confirm notification outbox enters retry and later succeeds after WAHA recovery.
6. Confirm retry does not duplicate already-successful channels.
7. Change fulfilment/payment status and confirm a `customer_notification_outbox` job is created, the admin action is never rolled back by notification failure, failed sends retry, and eventual success becomes `done`.
8. If Resend is configured, confirm email and idempotent retry behavior.

## I. Admin self-service acceptance test
From `/admin.html`, without DB console/source edits:
- view/search orders and open detail/history
- progress/cancel fulfilment
- verify/reject prepaid payment
- retry notification
- create/edit/archive product
- create a new product, set it visible, and confirm it appears on the public shop AND opens successfully through the dynamic `/product/?id=...` PDP without generating a static product directory or redeploying
- change a visible product price/name/image and confirm storefront + existing pre-rendered PDP refresh from the live public catalogue
- hide/archive a product and confirm its pre-rendered PDP shows unavailable instead of allowing purchase
- view customer directory
- moderate reviews
- upload media and copy the returned public image URL from Admin without database/source access
- enable/disable homepage sections
- edit homepage heading/subheading
- curate product IDs and publish featured shelf list
- change COD/prepaid fees + free-delivery threshold
- change support WhatsApp/email/address + promo bar and confirm public pages refresh from Store Settings
- change JazzCash Till ID/QR URL and bank receiving details and confirm checkout updates
- enable/disable COD/JazzCash/Bank Transfer
- invite/inspect staff roles as Owner
- view audit log

Any item that requires source-code editing is a FAIL for admin self-service.

## J. UX / visual QA
Test real staging at minimum:
- 360px, 390px, 430px mobile
- tablet (~768px)
- desktop (1366px+)

Check:
- direct navigation/refresh on `/shop/`, `/cart/`, `/bundles/` and `/category/<slug>/` resolves through Cloudflare Pages SPA fallback (do not add a top-level `404.html`, which would change Pages SPA fallback behavior)
- homepage hero/categories/shelves/sourced-after-order/FAQ
- search, filters, mobile filter sheet
- product page image/fallback, sticky Add to Bag, related rail
- cart and checkout totals/payment states/errors
- account sign-in/sign-up/My Orders
- tracking page
- admin login/dashboard/orders/products/homepage/settings/security
- keyboard-only navigation and visible focus
- `prefers-reduced-motion`
- no horizontal overflow / clipped controls / unreadable text

## K. Analytics/privacy
- Enable Cloudflare Web Analytics (free) at zone/site level.
- If using Clarity, set/verify masking and use only the public project ID.
- Confirm Clarity does NOT load on `/admin`, `/checkout(.html)`, `/account/`, or `/track-order(.html)`.
- Do not add PII/order phone/reference/auth-token custom analytics events.

## L. CSP / security headers
In staging browser console/network:
- confirm site functionality under enforced CSP
- Turnstile loads
- Supabase auth/API works
- optional Clarity works only on allowed public pages
- no unexpected CSP violations needed for core functionality
Do not loosen CSP globally just to silence an unrelated console warning.

## M. Final build checks
- secret scan deployed build
- no `.env`, service-role key, WAHA key, Resend key or Turnstile secret in public artifacts
- zero broken local asset references
- run JS syntax/build checks
- confirm migrations 001–018 are applied
- confirm migration 016 removed the legacy `admin_hard_delete_product(bigint,uuid,text)` function and direct anon/authenticated execution is impossible
- confirm migration 017 customer notification outbox exists with no browser RLS policy
- confirm migration 018 public settings view exposes only the explicit storefront allow-list and trigger guard functions are not directly executable by anon/authenticated
- perform a real staging DB dump, checksum it, and execute at least one restore drill into a disposable database/project before declaring backups PASS


## N. FREE AI staging setup + acceptance test
This candidate includes optional free AI. Core commerce MUST work even if AI is disabled or quota-exhausted.

### Cloudflare binding
1. In the NON-PRODUCTION Pages project add a **Workers AI** binding named exactly `AI`.
2. Redeploy staging after adding the binding.
3. Do **not** configure OpenAI/Gemini/Groq/Twilio/paid-AI provider credentials.
4. Optional non-secret model overrides may be set to the defaults documented in `.env.example`; otherwise use code defaults.

### Database
Apply migration `014_free_ai_features.sql` after 013, then `015_admin_product_id_sequence.sql`, `016_security_settings_hardening.sql`, `017_customer_notification_outbox.sql`, and `018_public_surface_hardening.sql`. Confirm:
- `extensions.vector` is available
- product embedding fields exist
- `products.tags` exists
- `match_public_products` and `set_product_ai_embeddings` are not executable by anon/authenticated clients
- service-role server can execute them
- new Admin-created products/boxes receive automatic IDs without source edits, while legacy IDs remain unchanged

### Initial AI search index
Sign in as authorized admin and use **Admin Copilot → Refresh AI product search** until it reports current/no remaining stale items. Do not embed customer/order data.

### AI acceptance tests
PASS requirements:
1. Admin Copilot product-description draft works and never auto-saves/publishes.
2. Sales summary uses trusted server metrics and contains no customer PII.
3. Needs Attention summary works for Owner/Manager and is denied to Content.
4. “Improve with Copilot” can insert a description draft into the product editor; product still requires explicit Save.
5. Semantic search finds meaning-based queries such as `500 se kam spicy snack` / `gift ke liye meetha aur namkeen` when relevant catalogue items exist.
6. Exact/keyword search remains fast without an AI call.
7. Chaska Help answers only from public store rules + product candidates; no invented price/stock/delivery claims.
8. Typing an email/phone/order-number/long transaction-like number into Chaska Help does NOT send it to the model and returns the Track Order safety response.
9. Disable `ai_customer_assistant_enabled` in Admin Settings and confirm public AI helper stops while store remains usable.
10. Disable `ai_semantic_search_enabled` and confirm keyword/deterministic search still works.
11. Simulate missing AI binding/quota error: checkout, orders, auth, admin non-AI tools, WAHA/outbox and keyword search must all remain functional.
12. Confirm browser/source/network contains no AI provider secret.

### Free-only guard
Do not upgrade to Workers Paid or add a paid provider solely for AI. If the free allocation is exhausted, report `AI FREE QUOTA/CAPACITY UNAVAILABLE` and keep the fallback behavior.

## O. Output back to owner
Return ONE concise staging report with PASS/FAIL for sections E–M and evidence for any failure.
If every critical test passes, create ONE final deployment ZIP + SHA256 + Git tag/commit reference.
STOP before production until owner explicitly says: `APPROVE PRODUCTION DEPLOYMENT`.

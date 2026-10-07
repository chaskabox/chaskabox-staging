# ChaskaBox — Free AI Implementation (2026-10-07)

## Goal
Reduce owner/developer workload using **free-tier AI only**, without making checkout, payment, authentication, stock integrity, order creation, or security depend on AI.

## Provider
Primary/only runtime provider in this candidate: **Cloudflare Workers AI binding `AI`**.

No OpenAI/Gemini/Groq/paid-provider API key is required by this build.
The code allow-lists Cloudflare-hosted models and defaults to:
- Text: `@cf/qwen/qwen3-30b-a3b-fp8`
- Embeddings: `@cf/qwen/qwen3-embedding-0.6b`

Model overrides (optional, non-secret):
- `AI_TEXT_MODEL`
- `AI_EMBEDDING_MODEL`

## Implemented features

### 1. Admin Copilot
Protected endpoint: `POST /api/admin/ai`

Supported safe tasks:
- product description drafts
- SEO title/meta drafts
- category/flavour/search tag suggestions
- Chaska Box ideas
- FAQ/support reply drafts
- homepage merchandising suggestions
- last-7-days sales summary using trusted non-PII server metrics
- Needs Attention summary using trusted operational counts
- catalogue health summary

Hard rule: Copilot has **no write capability**. It cannot publish, deploy, change prices, verify payments, refund/cancel orders, delete products, or change roles/security.

### 2. Product writer in Admin editor
“Improve with Copilot” calls the protected AI endpoint and inserts the generated description into the editor for human review. The owner/staff must still press Save.

### 3. Semantic product search
Public endpoint: `POST /api/ai/search`

- Exact/keyword storefront search remains instant and local.
- When exact results are empty, the storefront debounces and tries meaning-based semantic search.
- Semantic search uses Workers AI embeddings + Supabase `pgvector` migration 014.
- Basic price language such as “under 500 / 500 se kam” is enforced deterministically after semantic retrieval.
- If AI/index is unavailable, search falls back to deterministic catalogue matching.

### 4. Chaska Help AI
Public endpoint: `POST /api/ai/assistant`

The assistant receives only:
- public store settings
- public product candidates
- the customer’s short question

Privacy guard:
- If input looks like a phone number, email, order number, long transaction/reference number, it is NOT sent to the model.
- The customer is directed to the secure Track Order flow instead.
- The assistant never asks for passwords, OTPs, bank/card credentials, address, phone, transaction reference, etc.
- It cannot access private order/customer tables.

If Workers AI is unavailable/quota-exhausted, the existing deterministic Chaska Help fallback remains available.

### 5. AI search indexing
Protected endpoint: `POST /api/admin/ai-reindex`

- Uses product name/brand/category/pack/description/tags only.
- No customer/order data is embedded.
- Admin button “Refresh AI product search” processes stale products in safe batches.
- Product edits automatically mark their embedding stale.
- Product save makes a best-effort one-product refresh without blocking the product save.

## Migration 014
`database/migrations/014_free_ai_features.sql`

Adds:
- `vector` extension in `extensions` schema
- missing `products.tags` column (already referenced by admin API)
- 1024-dimensional product embedding fields
- stale-index trigger
- server-only batch embedding setter RPC
- server-only public-safe semantic match RPC
- HNSW cosine index
- owner-managed public flags:
  - `ai_customer_assistant_enabled`
  - `ai_semantic_search_enabled`

## Cloudflare setup
In the **staging Pages project**:
1. Workers & Pages → project → Settings → Bindings.
2. Add → **Workers AI**.
3. Binding variable name: **`AI`**.
4. Redeploy staging.

No AI secret/API key should be added to browser code.

## Free-only behavior
AI is optional. If free quota/capacity is unavailable:
- checkout still works
- orders still work
- Admin non-AI functions still work
- WAHA/email/outbox still work
- auth/RLS still work
- keyword search still works
- Chaska Help falls back to deterministic help

## Security boundary
AI may: understand, search public catalogue, summarize trusted metrics, suggest, draft.

AI may NOT: authenticate users, calculate authoritative prices, change payment state, create/refund/cancel orders, alter roles/RLS/security, publish content, or deploy production.


## Admin product creation compatibility
Migration `015_admin_product_id_sequence.sql` preserves all legacy product IDs and gives newly created Admin products/Chaska Boxes an automatic next ID. This closes a pre-existing self-service blocker where `products.id` had no default.


## Migration 015
`database/migrations/015_admin_product_id_sequence.sql`

Preserves every legacy product ID, adds an owned sequence/default for future Admin-created products and Chaska Boxes, and grants sequence use only to authenticated/server roles. This repairs a pre-existing Admin self-service blocker without renumbering existing catalogue URLs.

## v4 privacy / operations hardening
- Admin free-form AI context is server-redacted for common PII patterns before model submission.
- Trusted sales summaries distinguish gross order value, recognized sales and pending prepaid value instead of calling every placed order “revenue”.
- Public AI/store rules are sourced only from the explicit public settings/catalogue surface.
- Migration 018 allow-lists storefront settings; future internal/private keys are not automatically exposed through the public settings view.
- AI failures remain non-blocking for core commerce.

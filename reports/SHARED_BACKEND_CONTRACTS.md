# SHARED BACKEND CONTRACTS — Source of Truth
Version: 1.2 | Date: 2026-10-06 | Status: FROZEN (changes require documented amendment)

All 4 implementation teams MUST conform to this document. If a team needs a change,
document it in `CONTRACT_AMENDMENTS.md` and update dependent tests BEFORE merging.

## Amendment history
- v1.1 (2026-10-06): P1 ACCEPTED — `orders.customer_note TEXT NULL` (owner decision).
  See backend/functions/CONTRACT_AMENDMENTS.md. Optional, max 500 chars, plain-text only,
  PII-handled, never influences pricing/security.

---

## 1. Fixed internal enums

### 1.1 Payment methods (`payment_method`)
| Value | Meaning |
|---|---|
| `cod` | Cash on Delivery |
| `jazzcash` | JazzCash prepaid |
| `bank_transfer` | Bank Transfer prepaid (Punjab Bank, RAMEEZ ASLAM, 6050435151500017) |

### 1.2 Payment statuses (`payment_status`)
| Value | Meaning |
|---|---|
| `cod_due` | COD order — payment due on delivery |
| `awaiting_payment` | Prepaid order created, reference not yet submitted |
| `payment_submitted` | Customer submitted transaction reference, awaiting admin verification |
| `payment_verified` | Admin verified the payment (server/admin workflow ONLY) |
| `payment_rejected` | Admin rejected the payment reference |
| `refunded` | Payment refunded (post-verification) |

Rules:
- Browser/JS must NEVER set `payment_verified` or `payment_rejected`.
- `jazzcash` / `bank_transfer` orders start as `awaiting_payment` or `payment_submitted`, never verified.
- `cod` orders use `cod_due`.

### 1.3 Fulfilment statuses (`fulfilment_status`) — SEPARATE field, never merged with payment_status
| Value | Meaning |
|---|---|
| `new` | Order received, not yet processed |
| `sourcing` | Picking items from market (no-stock model) |
| `packed` | Packed and ready |
| `dispatched` | Handed to courier |
| `delivered` | Delivered to customer |
| `cancelled` | Cancelled (with reason) |

Valid transitions: `new` → `sourcing` → `packed` → `dispatched` → `delivered`; any → `cancelled` (with reason + audit).

### 1.4 Product visibility (`visibility`)
| Value | Meaning |
|---|---|
| `draft` | Not public, admin preview only |
| `visible` | Public storefront |
| `hidden` | Not on storefront, orderable = NO |
| `archived` | Soft-deleted; restorable; orderable = NO |

Rules:
- Public API exposes ONLY `visibility='visible'`.
- `hidden`/`archived`/`draft` products MUST be rejected by `/api/orders` even if product_id is manipulated.
- Default admin "Delete" = set `archived`. Permanent delete = owner-only, blocked if referenced by order_items.

### 1.5 Stock state (`stock_state`)
| Value | Meaning |
|---|---|
| `available` | Ready |
| `limited` | Low stock warning |
| `unavailable` | Cannot be ordered |
| `sourced_after_order` | Default for no-stock model — sourced from market after order |

### 1.6 Admin roles (`admin_roles.role`)
| Role | Capabilities |
|---|---|
| `owner` | Everything: security, roles, settings, permanent delete |
| `manager` | Products, boxes, homepage, orders, customers, reviews. NO permanent delete, NO role assignment |
| `fulfilment` | Orders fulfilment_status + payment verify/reject + notes ONLY. NO product price/content changes |
| `content` | Products, boxes, homepage, media, reviews. NO payments, NO security, NO roles |

Rules:
- Only `owner` can INSERT/UPDATE `admin_roles`.
- No self-promotion: non-owners cannot change any role.

### 1.7 Review moderation (`reviews.moderation_status`)
`pending` | `approved` | `rejected`
- Public sees ONLY `approved`.
- `verified_purchase` is boolean, computed SERVER-SIDE from delivered orders. Never trust browser.

---

## 2. Schemas

### 2.1 products
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | Preserve legacy IDs 1–272 |
| slug | text UNIQUE | URL-safe; `/product/<id>/` URLs preserved via id |
| name | text NOT NULL | |
| brand | text | |
| category | text | |
| pack | text | e.g. "Pack of 4 (Rs. 75)" |
| price | integer NOT NULL | PKR, server-authoritative |
| old_price | integer NULL | Compare-at price |
| description | text | |
| badge | text NULL | |
| image_url | text NULL | |
| is_bundle | boolean DEFAULT false | |
| visibility | text DEFAULT 'visible' | Enum §1.4 |
| stock_state | text DEFAULT 'sourced_after_order' | Enum §1.5 |
| created_at / updated_at | timestamptz | |
| created_by / updated_by | uuid NULL | admin user refs |

### 2.2 bundle_items (Chaska Box components)
| Column | Type | Notes |
|---|---|---|
| bundle_product_id | bigint FK products.id | The box product |
| component_product_id | bigint FK products.id | Component |
| quantity | integer NOT NULL | |
| PK | (bundle_product_id, component_product_id) | |

### 2.3 orders
| Column | Type | Notes |
|---|---|---|
| id | uuid PK DEFAULT gen_random_uuid() | Internal |
| order_number | text UNIQUE NOT NULL | Human-readable: `CB-DDMMYY-XXXXX`. NOT an auth credential |
| idempotency_key | text UNIQUE NOT NULL | Client UUID; duplicates return original order |
| user_id | uuid NULL | NULL = guest |
| customer_name | text NOT NULL | Snapshot |
| customer_phone | text NOT NULL | Snapshot |
| customer_address | text NOT NULL | Snapshot |
| customer_city | text NOT NULL | Snapshot |
| payment_method | text NOT NULL | Enum §1.1 |
| payment_status | text NOT NULL | Enum §1.2 |
| fulfilment_status | text NOT NULL DEFAULT 'new' | Enum §1.3 |
| subtotal | integer NOT NULL | Server-computed PKR |
| delivery_fee | integer NOT NULL | Server-computed PKR |
| total | integer NOT NULL | Server-computed PKR |
| transaction_reference | text NULL | REQUIRED for prepaid |
| customer_note | text NULL | Optional order note (P1, v1.1). Max 500 chars, plain-text, PII. Never influences pricing/security. |
| admin_notes | text NULL | Internal |
| created_at / updated_at | timestamptz | |

Delivery rules (server-side ONLY):
- `cod`: delivery_fee = 300
- prepaid (`jazzcash`/`bank_transfer`): subtotal ≥ 5000 → 0; else 300

### 2.4 order_items — IMMUTABLE snapshots
| Column | Type | Notes |
|---|---|---|
| id | bigint GENERATED PK | |
| order_id | uuid FK orders.id | |
| product_id | bigint NULL | NULL-safe for historical integrity |
| product_name | text NOT NULL | Snapshot at purchase |
| pack | text NOT NULL | Snapshot at purchase |
| unit_price | integer NOT NULL | Snapshot at purchase — never updated by later price changes |
| quantity | integer NOT NULL | |
| line_total | integer NOT NULL | unit_price × quantity |

Rule: product price edits NEVER alter existing order_items.

### 2.5 customers (minimal PII)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid UNIQUE NULL | Supabase Auth link |
| name | text | |
| phone | text | |
| created_at | timestamptz | |

PII access: owner/manager full; fulfilment order-context only; content NONE.

### 2.6 reviews
| Column | Type | Notes |
|---|---|---|
| id | bigint GENERATED PK | |
| product_id | bigint FK | |
| user_id | uuid NULL | |
| order_id | uuid NULL | For verified_purchase derivation |
| rating | smallint CHECK 1–5 | |
| review_text | text | Sanitized server-side |
| moderation_status | text DEFAULT 'pending' | Enum §1.7 |
| verified_purchase | boolean DEFAULT false | Server-computed |
| admin_reply | text NULL | |
| created_at | timestamptz | |

### 2.7 homepage_sections (CMS)
| Column | Type | Notes |
|---|---|---|
| section_key | text PK | hero, categories, chaska_picks, boxes, chatpata_picks, new_items, how_it_works, faq, announcement_bar |
| enabled | boolean DEFAULT true | |
| position | integer | Order |
| heading / subheading | text NULL | |
| config | jsonb | Curated product IDs / merchandising rules |
| draft_config | jsonb NULL | Unpublished edits |
| updated_at | timestamptz | |

Publish flow: edit → draft_config → preview → publish (draft_config → config).

### 2.8 media
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| object_path | text UNIQUE | Randomized, e.g. `products/2026/10/<uuid>.webp` |
| mime_type | text | Allowlist: image/jpeg, image/png, image/webp, image/avif |
| size_bytes | integer | Max 5MB catalogue |
| uploaded_by | uuid | |
| created_at | timestamptz | |

### 2.9 admin_roles
| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK | Supabase Auth user |
| role | text NOT NULL | Enum §1.6 |
| active | boolean DEFAULT true | |
| granted_by | uuid | |
| granted_at | timestamptz | |

### 2.10 audit_log (insert-only for staff; select owner-only)
| Column | Type | Notes |
|---|---|---|
| id | bigint GENERATED PK | |
| actor_id | uuid NOT NULL | |
| actor_role | text NOT NULL | |
| action | text NOT NULL | Enum §5 |
| entity_type | text NOT NULL | product, order, payment, customer, homepage, media, review, role, settings |
| entity_id | text NOT NULL | |
| before_data / after_data | jsonb NULL | Relevant diff, no secrets/PII beyond need |
| created_at | timestamptz DEFAULT now() | |

---

## 3. API routes (Cloudflare Pages Functions)

### Public
| Method | Route | Auth | Rate limit |
|---|---|---|---|
| POST | /api/orders | none (Turnstile) | 10/min/IP |
| GET | /api/products | none | 60/min/IP |
| GET | /api/products/:slug | none | 60/min/IP |
| POST | /api/reviews | none (Turnstile) | 5/min/IP |
| GET | /api/track | none (OTP-gated) | 10/min/IP |

### Admin (all require Supabase JWT + role check)
| Method | Route | Min role |
|---|---|---|
| GET | /api/admin/dashboard | fulfilment |
| GET/POST | /api/admin/products | content |
| PATCH | /api/admin/products/:id | content |
| POST | /api/admin/products/:id/archive | content |
| POST | /api/admin/products/:id/restore | content |
| POST | /api/admin/products/bulk-visibility | manager |
| DELETE | /api/admin/products/:id | owner ONLY |
| GET | /api/admin/boxes | content |
| POST | /api/admin/boxes | content |
| GET | /api/admin/orders | fulfilment |
| GET | /api/admin/orders/:id | fulfilment |
| PATCH | /api/admin/orders/:id/status | fulfilment |
| POST | /api/admin/orders/:id/payment/verify | fulfilment |
| POST | /api/admin/orders/:id/notes | fulfilment |
| GET | /api/admin/orders/export.csv | manager |
| GET | /api/admin/customers | manager |
| GET | /api/admin/customers/:id | manager |
| GET/PATCH | /api/admin/reviews | content |
| GET/PATCH | /api/admin/homepage | content |
| POST | /api/admin/homepage/publish | manager |
| POST/DELETE | /api/admin/media | content |
| GET/PATCH | /api/admin/settings | owner |
| POST | /api/admin/ai | content (draft-only) |
| GET | /api/admin/audit-log | owner |

---

## 4. API request/response shapes

### POST /api/orders — request
```json
{
  "idempotency_key": "uuid-v4",
  "items": [{"product_id": 38, "qty": 2}],
  "customer": {"name": "...", "phone": "03XXXXXXXXX", "address": "...", "city": "..."},
  "payment_method": "cod",
  "transaction_reference": "optional — REQUIRED for jazzcash/bank_transfer",
  "customer_note": "optional — max 500 chars plain text (v1.1)",
  "turnstile_token": "..."
}
```
Browser MUST NOT send: prices, subtotal, delivery, total, payment_status.

### POST /api/orders — response (201 created / 200 idempotent-replay)
```json
{
  "order_id": "uuid",
  "order_number": "CB-061026-00001",
  "total": 600,
  "payment_status": "cod_due",
  "fulfilment_status": "new",
  "idempotent_replay": false
}
```

### Error shape (all endpoints)
```json {"error": {"code": "INVALID_ITEMS", "message": "Human-readable, no internals"}}
```
Never leak stack traces, SQL, or PII.

---

## 5. Audit-log events (`audit_log.action`) — v1.2 (P2)
Product: `product.created` | `product.updated` | `product.hidden` | `product.shown` |
`product.archived` | `product.restored` | `product.deleted` | `product.price_changed`
Boxes: `box.created` | `box.updated` | `box.hidden` | `box.shown` |
`box.archived` | `box.restored` | `box.published` | `box.unpublished`
Orders: `order.created` | `order.status_changed` | `order.cancelled` | `order.note_added`
Payments: `payment.submitted` | `payment.verified` | `payment.rejected` | `payment.refunded`
Reviews: `review.approved` | `review.rejected` | `review.hidden` | `review.replied`
CMS: `cms.updated` | `cms.published`
Admin/Security: `role.changed` | `settings.updated` | `admin.login` | `admin.login_failed` |
`security.permission_denied`
Media: `media.uploaded` | `media.deleted`
AI: `ai.draft_created` | `ai.action_requested` | `ai.action_blocked`

Record fields (where appropriate): actor_id, actor_role, event_type, entity_type, entity_id,
before, after, timestamp, request/correlation ID, optional safe IP/request metadata.
Append-only from staff perspective — normal roles cannot rewrite/delete history via Admin APIs.
AI must NEVER emit an audit event implying a protected action succeeded unless the authorized
backend actually performed it.

---

## 6. Compatibility checklist (before merging team work)
- [ ] Schema: team SQL matches §2 column names/types/enums exactly
- [ ] API: routes + shapes match §3/§4; no extra browser-trusted fields
- [ ] Admin UI: uses exact enum strings from §1 (no "COD" vs "cod" drift)
- [ ] RLS: policies reference final table/column names from §2
- [ ] Rate limiting: every POST/PATCH/DELETE in §3 has a limit
- [ ] Payment: no endpoint sets payment_verified except verify endpoint; fulfilment+ only

---

## 7. Amendment log
| Date | Change | Author |
|---|---|---|
| 2026-10-06 | v1.0 frozen | Muse (offline) |
| 2026-10-06 | v1.1 — P1 ACCEPTED: `orders.customer_note TEXT NULL` + validation/privacy/audit rules; 9 new tests | Muse (offline, owner-approved) |
| 2026-10-06 | v1.2 — P2 ACCEPTED: expanded audit event catalog (§5 replaced); record fields; AI audit-fabrication ban | Muse (offline, owner-approved) |

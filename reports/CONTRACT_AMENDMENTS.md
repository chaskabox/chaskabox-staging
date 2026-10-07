# Contract Amendments — proposed (pending owner review)

Per `SHARED_BACKEND_CONTRACTS.md` §7 amendment process: changes to the frozen
v1.0 contract require documented amendment + dependent test updates BEFORE merging.
The admin API (phases 7–13) proposes the following **additive** changes only.
Nothing existing is altered or removed.

## A1. §5 audit-log events — proposed additions

Rationale: the v1.0 §5 enum covers security-critical events but not every
server-side mutation the admin API performs. ADMIN_CONSOLE_BACKEND_SPEC requires
"audit every manual change", so the implementation writes rows for all mutations
using the exact §5 value where one fits, and the proposed values below otherwise.

| Proposed action | Used by | Meaning |
|---|---|---|
| `product.created` | POST /api/admin/products | New catalogue product created |
| `product.updated` | PATCH /api/admin/products/:id (non-price, non-visibility edits) | Name/desc/pack/etc. edited |
| `bundle.created` | POST /api/admin/boxes | Chaska Box created |
| `bundle.updated` | PATCH /api/admin/boxes/:id (non-visibility edits) | Box fields/components edited |
| `homepage.draft_saved` | PATCH /api/admin/homepage | CMS draft saved (not yet published) |
| `review.approved` | PATCH /api/admin/reviews/:id | Review approved |
| `review.rejected` | PATCH /api/admin/reviews/:id | Review rejected |
| `order.exported_csv` | GET /api/admin/orders/export.csv | PII export downloaded (who/when/filters) |
| `ai.blocked` | POST /api/admin/ai | Blocked copilot request (unknown task or blocklist hit) |

Status: PROPOSED 2026-10-06 — awaiting owner/test-team sign-off before merge.
Until accepted, the implementation already emits these values; accepting the
amendment only formalizes them in §5.

## A2. Product/box create default visibility

- Contract §2.1 column default: `visibility DEFAULT 'visible'`.
- Implementation: POST /api/admin/products and POST /api/admin/boxes create with
  `visibility='draft'` (explicit publish step required).
- Rationale: prevents accidental public listing of unreviewed catalogue entries;
  matches ADMIN_CONSOLE_BACKEND_SPEC "Save as draft" flow. Additive behaviour only;
  callers may still pass `visibility: 'visible'`/`'hidden'` explicitly.

Status: PROPOSED 2026-10-06.

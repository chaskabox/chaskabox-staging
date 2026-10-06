# POST /api/orders — Manual Test Cases (offline)

Conforms to frozen `SHARED_BACKEND_CONTRACTS.md` v1.0 (§4).
Run against a staging deploy with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
set and the `create_order_atomic` migration applied. `BASE` = staging origin.

Expected response shape (201/200), contract §4 exact:
```json
{"order_id":"uuid","order_number":"CB-061026-00001","total":600,
 "payment_status":"cod_due","fulfilment_status":"new","idempotent_replay":false}
```

Helper — fresh key per attempt:
```sh
KEY=$(node -e "console.log(crypto.randomUUID())")
```

## 1. Happy path — COD
```sh
curl -s -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{
  \"idempotency_key\": \"$KEY\",
  \"items\": [{\"product_id\": 5, \"qty\": 2}],
  \"customer\": {\"name\": \"Test User\", \"phone\": \"03320005381\", \"address\": \"Near Ahmad Drink Corner, Railway Road\", \"city\": \"Muzaffargarh\"},
  \"payment_method\": \"cod\"
}"
```
Expect `201`, `payment_status: "cod_due"`, `fulfilment_status: "new"`,
`idempotent_replay: false`, `total == 900` (600 + 300 delivery),
`order_number` matches `CB-DDMMYY-XXXXX`. Response contains ONLY the six
contract fields — no `subtotal`, `delivery_fee`, or `payment_method`.

## 2. Price tampering is IGNORED
Same as (1) but add `"subtotal": 1, "total": 1, "delivery_fee": 0,
"discount": 99999, "payment_status": "payment_verified"` at top level and
`"price": 1` inside items.
Expect `201` with `total` computed from DB prices — identical to (1).
**PASS = server total unaffected by browser-sent pricing.**

## 3. Archived / hidden / draft product REJECTED
Use a product with `visibility='archived'` (or `'hidden'`/`'draft'`) or
`stock_state='unavailable'`.
Expect `422 PRODUCT_UNAVAILABLE`, no order row created.

## 4. Unknown product id REJECTED
`"items": [{"product_id": 999999, "qty": 1}]`
Expect `422 PRODUCT_UNAVAILABLE`.

## 5. Duplicate idempotency_key → SINGLE order
```sh
KEY=$(node -e "console.log(crypto.randomUUID())")
PAYLOAD='{"idempotency_key":"'$KEY'","items":[{"product_id":5,"qty":1}],
 "customer":{"name":"Test User","phone":"03320005381","address":"123 Test Street Lahore","city":"Lahore"},
 "payment_method":"cod"}'
curl -s -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "$PAYLOAD" > r1.json
curl -s -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "$PAYLOAD" > r2.json
```
Expect: r1 `201` (`idempotent_replay: false`), r2 `200` with
`idempotent_replay: true` and the SAME `order_id`/`order_number`.
**PASS = exactly one row** for the key:
```sql
select count(*) from orders where idempotency_key = '<KEY>';  -- must be 1
```

## 6. Prepaid WITHOUT reference REJECTED
`"payment_method": "jazzcash"` with no `transaction_reference`.
Expect `400 VALIDATION_ERROR` on `transaction_reference`, no order created.

## 7. Prepaid WITH reference → payment_submitted, never verified
Expect `201`, `payment_status: "payment_submitted"`, `delivery_fee`
implied by total: `total - subtotal` = 0 when DB-priced subtotal ≥ 5000
else 300. **PASS = never `payment_verified` from this endpoint**
(grep response).

## 8. COD ignores transaction_reference
`"payment_method": "cod", "transaction_reference": "ABC123"` →
`201`, stored `transaction_reference` is null, status `cod_due`.

## 9. Invalid idempotency_key REJECTED
`"idempotency_key": "not-a-uuid"` → `400 VALIDATION_ERROR`.

## 10. Bad phone REJECTED
`"phone": "12345"` → `400 VALIDATION_ERROR` on `customer.phone`.

## 11. Empty items REJECTED
`"items": []` → `400 VALIDATION_ERROR`.

## 12. Wrong method
`GET /api/orders` → `405 METHOD_NOT_ALLOWED` (JSON, not HTML).

## 13. Oversized body
Body > 64KB → `413 PAYLOAD_TOO_LARGE`.

## 14. Rate limiting
Send 30 rapid POSTs (valid, unique keys) from one IP.
Expect `429 RATE_LIMITED` after ~10, with retry guidance. Counts reset
within a minute. (Contract §3: 10/min/IP.)

## 15. No stack traces / no secret leaks
For every error case above: response body must be the
`{ error: { code, message, details? } }` envelope only — no `stack`,
no SQL text, no env values. `curl -s ... | grep -i "stack\|supabase.*key\|service_role"`
must return nothing.

## 16. Order-number uniqueness under concurrency
Fire 20 concurrent valid POSTs (unique keys). All `201`s must have
distinct `order_number`s:
```sql
select order_number, count(*) from orders
 where created_at > now() - interval '5 minutes'
 group by 1 having count(*) > 1;  -- must return 0 rows
```

## 17. RPC-missing fallback (optional)
Temporarily drop the function, repeat case (1). Expect `201` via the
REST fallback path. Re-apply migration afterwards.

## 18. Historical snapshot stability
Place order, then change the product's price in DB. Re-read the order:
`order_items.unit_price` / `product_name` / `pack` must still show
purchase-time values; `orders.total` unchanged. (Contract §2.4.)

## 19. Draft product rejected (contract §1.4)
Product with `visibility='draft'` → `422 PRODUCT_UNAVAILABLE`.

## 20. Turnstile (when TURNSTILE_SECRET_KEY configured)
POST without `turnstile_token` → `400 VALIDATION_ERROR` on
`turnstile_token`. With invalid token → same. (Skipped entirely when
the secret is not configured — offline default.)

## 21. customer_note: null → stored NULL
POST with no `customer_note` → `201`; `orders.customer_note IS NULL`.

## 22. customer_note: empty/whitespace → NULL
POST `customer_note: "   "` → `201`; stored as NULL.

## 23. customer_note: normal text persisted
POST `customer_note: "Call on arrival, gate 2"` → `201`; stored verbatim (trimmed).

## 24. customer_note: exactly 500 chars accepted
500-char string → `201`.

## 25. customer_note: 501+ chars rejected
501-char string → `400 VALIDATION_ERROR` on `customer_note`.

## 26. customer_note: XSS stored/displayed as plain text
POST `customer_note: "<script>alert(1)</script>"` → `201`; DB stores literal string;
admin order detail must escape it (never innerHTML).

## 27. customer_note: not in public endpoints
`GET /api/products`, order confirmation response, and `/api/track` must never
include `customer_note`.

## 28. customer_note: unauthorized roles blocked
`content` role GET on order detail must not receive `customer_note`;
`fulfilment`/`manager`/`owner` may.

## 29. customer_note: never changes totals
POST with `customer_note` set vs unset, same items → identical `subtotal`,
`delivery_fee`, `total`.

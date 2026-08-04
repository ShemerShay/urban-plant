# Urban Plant × Cardcom — Chat / Work Summary

Exported from the integration conversation.  
**Date context:** August 2026  
**Scope:** Payment flow from audit through controlled Cardcom test prep.  
**Live CheckoutForm:** still **not** connected.

---

## Goal

Move Urban Plant from “checkout creates a completed sale immediately” toward:

```
Checkout → pending order + POS hold → Cardcom payment page
  → webhook + GetLpResult → finalize same order
```

Approved progression was incremental. Customer-facing redirect (Phase D / live CheckoutForm) remains deferred until the server can safely verify and finalize payments.

---

## What was already done before this chat

Documented in the prior summary and confirmed in-repo:

| Phase | Status |
|-------|--------|
| Phase 0 — Codebase audit | Done |
| Cardcom auth helpers (`lib/cardcom.ts`) | Done |
| Phase 1 — LowProfile/Create client (no live calls) | Done |
| POS `held_for_payment` (migration 016) | Done |
| Orders `pending_payment` (migration 017) | Done |
| Phase B — Pending order + POS hold (prep endpoint) | Done |
| Phase C — Wire Create + store LowProfileId (mocked tests) | Done in prior turn; continued here |

---

## Work completed in this chat

### 1. Phase C re-confirmation

Phase C was already approved and implemented:

- Extend Phase B with real `createCardcomLowProfile` (injectable for mocks)
- Store `LowProfileId` in `orders.checkout_session_id`
- Compensate (cancel order + release hold) on Create failure
- Return `{ orderId, lowProfileId, paymentUrl }` from `POST /api/payments/cardcom/create`
- **CheckoutForm not wired**

### 2. Phase D deferred — webhook + GetLpResult first

Decision: do **not** redirect real customers until verification/finalization exists.

Initial stop reported two blockers:

1. Official webhook JSON schema was unclear  
2. Pickup finalization semantics were ambiguous

### 3. Blockers resolved

**Webhook (official support + Swagger v11):**

- Method: `POST`
- Content-Type: `application/json`
- Body schema: `LowProfileResult`
- Still **not** authoritative — only triggers GetLpResult

**Pickup (Option A):**

- Verified pickup payment → `pending_payment` → `picked_up` (+ `pickedUpAt`)
- POS → `held_for_payment` → `sold`
- Delivery → `pending_payment` → `sold`; POS → `sold`

### 4. GetLpResult client + webhook finalization

**GetLpResult (Swagger overrides article “GET” wording):**

- `POST https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult`
- Body: `TerminalNumber`, `ApiName`, `LowProfileId`
- **No ApiPassword** (not in Swagger schema)

**Webhook flow:**

1. Parse JSON `LowProfileResult` (extract `LowProfileId` only for business use)
2. Look up order by `checkout_session_id`
3. Call GetLpResult with matching Cardcom environment
4. Verify: ResponseCode, nested charge ResponseCode, LowProfileId, ReturnValue, Amount (cent-safe), CoinId = 1, pending + held POS
5. Finalize same order row + POS atomically (single SQL CTE)
6. Idempotent on duplicate webhook
7. Orphan / mismatch / cancelled → HTTP 200, no finalize, sanitized logs
8. No emails, no `order_created` events in this phase

**Failed payments:** not auto-cancelled yet (Cardcom may not report declines unless “Always report transaction” is enabled).

### 5. Webhook parser updated to official LowProfileResult

Types/parser reflect Swagger fields (`ResponseCode`, `TerminalNumber`, `LowProfileId`, `ReturnValue`, `TranzactionInfo`, etc.).  
Webhook Amount/ResponseCode/etc. are never used to finalize.

### 6. Controlled Cardcom test environment (no live CheckoutForm)

Separated configs:

| Mode | Terminal | ApiName env |
|------|----------|-------------|
| Production | `194476` | `CARDCOM_API_NAME` |
| Test | `1000` | `CARDCOM_TEST_API_NAME` |

**DB field:** `orders.cardcom_env` (`test` | `production`) — migration `018` — so webhook GetLpResult uses the same terminal/credentials as Create. Not inferred from `NODE_ENV`.

**Admin-only test UI:** `/admin/cardcom-test`  
**Admin-only API:** `POST /api/admin/cardcom-test` (requires admin cookie)

Flow for a future manual test:

1. Preview POS / plant / amount / hold warning (no Cardcom call)
2. Confirm → Create on **terminal 1000**
3. Open `paymentUrl` manually; enter test card on Cardcom’s page
4. Webhook → GetLpResult (test config) → finalize

**No real Cardcom Create was executed automatically** during implementation.

---

## Safety principles (locked in)

1. Server-authoritative amount (`orders.price` / offer price at prep time)
2. Credentials never in client / logs / API responses
3. `/payment/success` is UX only — never marks paid
4. One `orders` row per attempt; webhook updates, never inserts a second sale
5. POS hold only on payment start (`available` → `held_for_payment`)
6. Live checkout not switched until Create + redirect are approved for production
7. Test vs production terminals never chosen by the browser

---

## Environment variables

| Variable | Purpose | Client? |
|----------|---------|---------|
| `CARDCOM_API_NAME` | Production ApiName | No |
| `CARDCOM_API_PASSWORD` | Refunds/cancels later; not used on Create/GetLpResult | No |
| `CARDCOM_TEST_API_NAME` | Test ApiName (terminal 1000) | No |
| `APP_ORIGIN` | Public HTTPS origin for Success/Failed/WebHook URLs | No |
| Terminal `194476` | Production constant | No |
| Terminal `1000` | Official test constant | No |

---

## Migrations

| File | Purpose |
|------|---------|
| `016_pos_spots_held_for_payment.sql` | POS `held_for_payment` |
| `017_orders_pending_payment.sql` | Order `pending_payment` + unique `checkout_session_id` |
| `018_orders_cardcom_env.sql` | `cardcom_env` test/production marker |

Confirm Netlify uses the same Neon DB/branch and apply migrations there if needed.

---

## Key files

```
lib/cardcom.ts
lib/cardcomWebhookParse.ts
lib/processCardcomWebhook.ts
lib/startCardcomPaymentPrep.ts
lib/posSpotHold.ts
lib/posSpotStorage.ts
lib/ordersStorage.ts
lib/orderTypes.ts
lib/status.ts
lib/routes.ts
lib/adminAuth.ts
app/api/payments/cardcom/create/route.ts
app/api/payments/cardcom/webhook/route.ts
app/api/admin/cardcom-test/route.ts
app/admin/cardcom-test/page.tsx
db/migrations/016_pos_spots_held_for_payment.sql
db/migrations/017_orders_pending_payment.sql
db/migrations/018_orders_cardcom_env.sql
scripts/verify-cardcom-low-profile.ts
scripts/verify-cardcom-create.ts
scripts/verify-payment-prep.ts
scripts/verify-cardcom-webhook.ts
```

---

## Verification scripts (mocked / offline)

| Script | Role |
|--------|------|
| `verify-cardcom-low-profile.ts` | Offline Create payload checks |
| `verify-payment-prep.ts` | Pending order + hold (Create mocked) |
| `verify-cardcom-create.ts` | Phase C Create mapping (mocked) |
| `verify-cardcom-webhook.ts` | Webhook + GetLpResult + finalize (mocked) |

None of these should hit Terminal 194476 or Terminal 1000 unless explicitly run as a live test later.

---

## What is still missing / next steps

| Step | Work |
|------|------|
| **Manual Cardcom test** | Set `CARDCOM_TEST_API_NAME` + `APP_ORIGIN`; use `/admin/cardcom-test`; pay on Cardcom hosted page; confirm webhook logs + order/POS finalize |
| **Phase D** | Wire CheckoutForm to create endpoint + redirect to `paymentUrl` (only after test verification succeeds) |
| **Emails / events** | After idempotent finalization only (`order_created`, purchase email) |
| **Fail / expiry** | Abandoned hold timeout; declined payment handling (optional Cardcom “Always report transaction”) |
| **Orphan reconciliation** | Manual process if Create succeeds but local attach fails |

---

## How to run the first live test (when approved)

1. Configure `CARDCOM_TEST_API_NAME` and public HTTPS `APP_ORIGIN`
2. Ensure migration 018 is applied on the DB the deploy uses
3. Deploy so Cardcom can reach the webhook URL
4. Admin login → **Cardcom test** → Preview → confirm hold → Start Create
5. Open `paymentUrl`; complete payment with Cardcom’s test card (do not store card data in the app)
6. Check logs: `[cardcom-webhook] webhook_received` → `get_lp_result_ok` → `finalized`
7. Confirm order status and POS `sold` in admin
8. Clean up test order / reset POS if needed

**Do not connect live CheckoutForm until this test path is confirmed.**

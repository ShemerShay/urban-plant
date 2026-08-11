# Orders / Cardcom Architecture — Chat Summary (Option B)

**Dates:** 2026-08-08 → 2026-08-10  
**Repo:** `urban-plant`  
**Branch:** `locate-day` (uncommitted cutover work at last check)  
**Scope of this thread:** Option B investigation → Phase 0–2 → single cutover implementation → pre-deploy safety check.

---

## 1. Problem

Cardcom checkout created an `orders` row with `order_status = pending_payment` **before** payment.

That row was used as a technical correlation record for:

- Order id / Cardcom `ReturnValue`
- `LowProfileId` / `checkout_session_id`
- resume / retry
- POS payment hold
- webhook finalization
- payment recovery

**Side effect:** abandoned payment attempts accumulated in `orders` and polluted Admin Orders / the business Order domain.

---

## 2. Target model (Option B)

**Before payment**

- Create a dedicated `payment_attempts` record
- Do **not** create a real Order

**After verified Cardcom success (GetLpResult)**

- Create exactly one real Order
- Link attempt → Order (`finalized_order_id`)
- Finalize POS (`sold`) + email/document as today

**If payment fails / expires / is abandoned**

- Update only the payment attempt
- Release only the POS hold owned by that attempt
- Do **not** create a cancelled Order

---

## 3. Phase plan (approved sequence)

| Phase | What | Status |
|-------|------|--------|
| 0 | `/success` → `getOrderById` | **Done** |
| 1 | Hold timestamp invariant + cron heal | **Done** |
| 2 | Unused `payment_attempts` schema + nullable `payment_hold_attempt_id` | **Done** |
| Cutover | Attempt create + correlate + Order-on-success (single deploy) | **Code done; not deployed** |
| Later | Stabilization, legacy cleanup, Admin Attempts UI, owner CHECK | **Deferred** |

Key plan rules preserved:

1. No long-lived dual-write of attempt + pending Order
2. Hold ownership with cutover (not Phase 1)
3. POS always becomes `sold` on success; Order may be `sold` or `picked_up`
4. Late Cardcom success after local expiry → `needs_reconciliation`, never auto-create a normal Order
5. GetLpResult remains payment source of truth

---

## 4. Phase 0 — `/success` direct lookup

- **File:** `app/success/page.tsx`
- Replaced `readOrders().find(...)` with `getOrderById` (+ UUID guard)
- Verify: `scripts/verify-cardcom-return-flow.ts`

---

## 5. Phase 1 — Hold timestamp + cron

**Invariant:** `held_for_payment` ⇒ `payment_hold_started_at IS NOT NULL`

- `lib/posSpotStorage.ts` — set/clear timestamp on enter/leave held
- Migration `025_pos_spots_held_for_payment_timestamp_check.sql`
- TTL **17 minutes**; cron `*/5 * * * *`
- Production expiry confirmed operational after Netlify `CRON_SECRET` / env fix

---

## 6. Phase 2 — Schema only (zero behavior change)

Migration `026_payment_attempts.sql`:

- Table `payment_attempts` with statuses:  
  `created` | `awaiting_payment` | `finalized` | `expired` | `failed` | `cancelled` | `needs_reconciliation`
- Unique: `checkout_session_id` (non-null), `payment_resume_token`, `finalized_order_id` (non-null)
- Indexes: `(status, expires_at)`, `(pos_spot_id, status)`
- Nullable `pos_spots.payment_hold_attempt_id` → FK attempts

Also: `lib/paymentAttemptTypes.ts`, `lib/paymentAttemptStorage.ts` (initially unwired), verify script.

**Intentionally omitted:** partner denormalized columns (in snapshot), currency, `orders.payment_attempt_id`.

---

## 7. Cutover implementation (current code)

### New checkout flow

```
checkout
→ payment_attempt (ReturnValue = attempt.id)
→ owned POS hold (timestamp + payment_hold_attempt_id)
→ Cardcom Create (LowProfile → attempt.checkout_session_id)
→ GetLpResult verify
→ atomic CTE: insert Order + POS sold + attempt finalized
→ existing Order email/document pipeline
```

No Order before verified payment. No dual-write for new sessions.

### Hold ownership

- Acquire: `available` → `held_for_payment` + `now()` + owner = attempt id
- Release: only if still held **and** owner matches
- Finalize / expiry: clear timestamp + owner; never touch `sold` or another owner’s hold

### Webhook

1. Lookup attempt by LowProfileId  
2. Else legacy pending Order fallback  
3. `awaiting_payment` + verified → finalize  
4. `finalized` → email/document recovery only  
5. `expired` / `cancelled` / `failed` + verified success → `needs_reconciliation` (no Order)

### Retry / resume / status

- New sessions keyed by attempt id (URL query still named `orderId` for compatibility)
- Same resume-token + 3-minute retry lock + LowProfile rotation
- Status: awaiting → pending; finalized → completed + **real** Order id; terminal/recon → cancelled (never success)
- Final redirect: `/success?orderId=<real-order-id>`

### Expiry

- Same 17-minute TTL + existing cron/lazy paths
- Owned hold: attempt → `expired`, release owned hold only, **no Order**
- Legacy null-owner hold: cancel `pending_payment` Orders as before

### Main files touched

- `lib/startCardcomPaymentPrep.ts`
- `lib/processCardcomWebhook.ts`
- `lib/retryCardcomPayment.ts`
- `lib/cardcomPaymentStatusServer.ts`
- `lib/paymentHoldExpiry.ts`
- `lib/paymentAttemptStorage.ts` / `paymentAttemptTypes.ts`
- `lib/posSpotStorage.ts` / `posSpotTypes.ts`
- `app/checkout/pos/[spotSlug]/page.tsx`
- `app/api/payments/cardcom/create/route.ts`
- Admin cardcom-test copy (operator text only)
- Verify scripts: prep, hold, webhook, integrity, create, document-email, return-flow

---

## 8. Pre-deploy safety check (2026-08-10)

**Do not deploy yet.**

### Production state at check time

| Item | Count / note |
|------|----------------|
| Active `pending_payment` Orders | **1** (`1cfc8dea-…`, LowProfile present, production) |
| Stale `held_for_payment` POS | **1** (~2h, owner `NULL`, slug `alon_shabo_chlenov_47`) |
| Active `awaiting_payment` attempts | **0** |
| Active legacy Cardcom session | **1** (linked Order + hold; past TTL but still open in DB) |

### Regression tests (re-run)

All **pass**: payment-prep, POS hold, webhook, payment-integrity, return-flow.

### Legacy fallback (code)

**Safe:** attempt-first + Order fallback; new prep creates no pending Order; uniqueness prevents duplicate Orders.  
**Ops note:** clear/expire the open legacy session before cutover deploy.

### Admin hold safety — **DEPLOY BLOCKER**

Admin `PATCH` → `updatePosSpot` / `setPosSpotStatus` can leave `held_for_payment` and set available/sold/inactive, **clearing `payment_hold_attempt_id` with no ownership check**. That can release or corrupt an attempt-owned hold.

Also deferred (not a hard blocker by itself): DB CHECK `held_for_payment ⇒ payment_hold_attempt_id IS NOT NULL` (Admin can still set held without owner).

---

## 9. Critical invariants (keep forever)

- Cardcom **GetLpResult** is payment source of truth
- Webhook idempotency
- Email / Cardcom document exactly-once on the **Order**
- Admin cannot fake paid state
- Expired attempt must not release another attempt’s POS hold
- Do not keep Option A and Option B permanently in parallel

---

## 10. Next steps before commit/deploy

1. **Clear production legacy session** — expire/cancel the open `pending_payment` + release stale hold on `alon_shabo_chlenov_47` (or wait for cron if safe).
2. **Fix Admin hold path** — refuse or guard status changes that would clear/overwrite an owned `payment_hold_attempt_id`.
3. Optionally enable `held ⇒ owner NOT NULL` CHECK once Admin + payment writers are safe.
4. Then commit + deploy cutover as one unit.
5. Later: legacy code removal, historical pending/system-cancelled cleanup, Admin Attempts UI.

---

## 11. Final verdict (at last check)

| Question | Answer |
|----------|--------|
| Phase 0–2 complete? | **Yes** |
| Cutover code complete + tests green? | **Yes** |
| Safe to commit and deploy right now? | **No** |
| Blockers | (1) open legacy pending Order + stale hold in production; (2) Admin can overwrite/release owned attempt holds |

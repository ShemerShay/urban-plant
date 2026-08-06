# Urban Plant Cardcom — Session Summary

Date: 2026-08-05  
Scope: Cardcom post-payment document + email, hydration fix, end-to-end audit, and payment-integrity hardening.

---

## 1. Cardcom document + Urban Plant confirmation email

Implemented the smallest safe post-payment flow after verified payment:

```
verified GetLpResult
  → store cardcom_transaction_id
  → finalize order/POS (sold or picked_up)
  → atomically claim document/email processing
  → Documents/CreateDocument (Auto, IsSendByEmail: false)
  → fetch PDF (DocumentUrl or CreateDocumentUrl with resolved type)
  → send existing Urban Plant email + PDF attachment
```

### Rules
- Document/email failure never undoes payment or POS finalization.
- Webhook still returns success after payment finalization even if document/email fails.
- Checkout UI, payment redirects, verification, and email copy were not rewritten.
- Duplicate/concurrent webhooks cannot create two documents or send two emails (atomic claim + `purchase_email_sent_at`).

### Migration `020`
- `cardcom_transaction_id`
- `cardcom_document_type`
- `cardcom_document_number`
- `purchase_email_status` (`pending` | `processing` | `sent` | `failed`)
- `purchase_email_sent_at`
- `purchase_email_last_error`

### Key files
- `lib/cardcomDocuments.ts`
- `lib/purchaseEmail.ts`
- `lib/processOrderDocumentAndEmail.ts`
- `lib/processCardcomWebhook.ts`
- `lib/ordersStorage.ts`
- `scripts/verify-cardcom-document-email.ts`

---

## 2. Hydration fix (`CustomerRecoveryActions`)

### Cause
Render-time branch on `typeof window` / `sessionStorage` made SSR omit the return link while the client could show it.

### Fix
- Resolve `preferredReturnHref` during render (same on server and client).
- Resolve sessionStorage/referrer path only inside `useEffect`.
- Initial render: no `window` / `sessionStorage` access.

File: `components/customer/CustomerRecoveryActions.tsx`

---

## 3. End-to-end audit (findings)

### Confirmed working
- First purchase: Buy → checkout → `POST /api/payments/cardcom/create` → pending order + hold → Cardcom hosted page via **same-tab** `window.location.assign`.
- No live path `CheckoutForm` → `POST /api/orders` → `/success`.
- Success: `/payment/success` polls only; webhook + GetLpResult finalize; then `/success?orderId=…`.
- Failed return: back to same checkout with English `Payment failed. Please try again.`
- Held-for-payment: resume holder can retry; other customers blocked with English copy.
- Client components do not import DB / Cardcom secrets / document-email server modules.

### Bugs / risks found
1. **No hold expiry** (later fixed) — abandoned holds blocked plants forever.
2. **Admin Cancel** could cancel sold orders and set POS back to available (later fixed).
3. **Retry concurrency** could create two LowProfile sessions (later fixed).
4. Sold CTA still reads `Buy for ₪…` when disabled (UX gap, not fixed in this session).
5. Document/email failures only visible in server logs, not admin UI.
6. Possible duplicate Cardcom document if Create succeeds but DB persist fails.

---

## 4. Payment-integrity fixes

### 4.1 Admin cancellation safety
- Only `pending_payment` is cancellable (`canAdminCancelOrder`).
- Atomic `adminCancelPendingPaymentOrder`: cancel pending only; release POS only if still `held_for_payment`.
- Sold / picked_up / delivered → rejected (409); Cancel button hidden.

### 4.2 Hold expiry (final: **15 minutes**)
- Column: `pos_spots.payment_hold_started_at`
- Constant: `PAYMENT_HOLD_TTL_MS = 15 * 60 * 1000`
- **Lazy cleanup** on product/checkout/create/retry/webhook (not a browser timer, no cron).
- Expires: cancel pending order (`Payment hold expired`) + POS → `available`.
- Never expires/releases sold / picked_up / delivered.

### 4.3 Retry concurrency lock
- Column: `orders.payment_retry_lock_at`
- Claim lock **before** Cardcom Create; concurrent retry → `busy`.
- Create/rotate failure releases lock.
- Stale lock reclaim after **3 minutes** (`PAYMENT_RETRY_LOCK_TTL_MS`).

### Migration `021`
- `pos_spots.payment_hold_started_at`
- `orders.payment_retry_lock_at`

### Key files
- `lib/paymentHoldExpiry.ts`
- `lib/status.ts`
- `lib/retryCardcomPayment.ts`
- `app/api/orders/[orderId]/route.ts`
- `components/admin/AdminOrderCard.tsx`
- `scripts/verify-payment-integrity.ts`

---

## 5. Remaining known risk: charged after expiry

Exact sequence that can still hurt a customer:

1. Payment starts; customer stays on Cardcom.
2. After **15 minutes**, lazy cleanup cancels the pending order and releases the POS.
3. Customer completes the **original** Cardcom payment (real charge).
4. Webhook arrives → order already `cancelled` → `ignored_cancelled`.
5. Urban Plant does **not** finalize, does **not** auto-refund, does **not** reconcile — only server logs.

**This is a real charged-but-cancelled integrity risk.** Ops must watch Cardcom + `[cardcom-webhook]` logs; prefer a dedicated orphan-charge / refund path before high traffic.

---

## 6. Exact customer flows (current)

### First purchase
Product → Buy → checkout → create → pending + held → Cardcom hosted page (same tab).

### Success
Cardcom → `/payment/success?orderId&resume` (wait/poll) → webhook finalizes → `/success?orderId` → return to plant via recovery.

### Failed / retry
Cardcom → same checkout `?paymentFailed=1&orderId&resume` → retry same order (locked Create) → success path.

### Held (other customer)
CTA: **Purchase in progress**  
Message: *Another customer is currently purchasing this plant. Please check back shortly.*  
Checkout: *This plant is currently being purchased by another customer.*

---

## 7. Verification run (last known)

All passed:

- `npx tsc --noEmit`
- `npm run build`
- `npx tsx scripts/verify-payment-integrity.ts`
- `verify-cardcom-low-profile`
- `verify-cardcom-create`
- `verify-cardcom-return-flow`
- `verify-cardcom-webhook`
- `verify-cardcom-document-email`
- `git diff --check`

---

## 8. Deploy / commit notes

- Migrations **020** and **021** were applied to the Neon `urban-plant` project during this session.
- Confirm Netlify `DATABASE_URL` points at the same Neon branch before production deploy.
- Do **not** commit `.env.local` or `.next/`.
- Session instruction at end: work was **not** staged, committed, or pushed unless done later by the user.

### Suggested staging groups (when committing)
1. Document/email + hydration + migration 020  
2. Payment integrity (cancel / 15m hold / retry lock) + migration 021 + verify scripts  

---

## 9. Follow-ups (not done)

- Orphan-charge detection / alert / auto-refund after expiry.
- Admin UI for `purchase_email_status` / document fields.
- Sold product CTA copy (`Sold` instead of greyed `Buy for ₪…`).
- Harden CreateDocument persist so retries cannot create a second accounting document.
- Optional: scheduled hold cleanup in addition to lazy expiry.

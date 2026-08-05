/**
 * Payment integrity: admin cancel safety, 17-minute hold expiry, retry lock.
 * Run: npx tsx scripts/verify-payment-integrity.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

async function main(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const { canAdminCancelOrder, canTransitionOrderStatus, isVerifiedPaidOrderStatus } =
    await import("../lib/status");
  const {
    isPaymentHoldExpired,
    PAYMENT_HOLD_TTL_MS,
    expireStalePaymentHold,
  } = await import("../lib/paymentHoldExpiry");
  const {
    appendOrder,
    adminCancelPendingPaymentOrder,
    claimPaymentRetryLock,
    getOrderById,
    releasePaymentRetryLock,
    PAYMENT_RETRY_LOCK_TTL_MS,
  } = await import("../lib/ordersStorage");
  const { getOfferById } = await import("../lib/offerStorage");
  const {
    acquirePosSpotHoldForPayment,
    getPosSpotById,
    readPosSpots,
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
  } = await import("../lib/posSpotStorage");
  const { processCardcomWebhook } = await import("../lib/processCardcomWebhook");
  const { retryCardcomPayment } = await import("../lib/retryCardcomPayment");
  const { parseCardcomLowProfileResult } = await import("../lib/cardcom");
  const { sql } = await import("../lib/db");

  // --- Unit: admin cancel rules ---
  assert.equal(canAdminCancelOrder("pending_payment"), true);
  assert.equal(canAdminCancelOrder("sold"), false);
  assert.equal(canAdminCancelOrder("picked_up"), false);
  assert.equal(canAdminCancelOrder("delivered"), false);
  assert.equal(canAdminCancelOrder("cancelled"), false);
  assert.equal(canTransitionOrderStatus("sold", "cancelled"), false);
  assert.equal(canTransitionOrderStatus("picked_up", "cancelled"), false);
  assert.equal(canTransitionOrderStatus("delivered", "cancelled"), false);
  assert.equal(canTransitionOrderStatus("pending_payment", "cancelled"), true);
  assert.equal(isVerifiedPaidOrderStatus("sold"), true);

  // --- Unit: hold TTL helper ---
  assert.equal(PAYMENT_HOLD_TTL_MS, 17 * 60 * 1000);
  assert.equal(PAYMENT_RETRY_LOCK_TTL_MS, 3 * 60 * 1000);
  const now = Date.now();
  assert.equal(isPaymentHoldExpired(new Date(now - 16 * 60_000).toISOString(), now), false);
  assert.equal(isPaymentHoldExpired(new Date(now - 17 * 60_000).toISOString(), now), true);
  assert.equal(isPaymentHoldExpired(null, now), false);

  const spots = await readPosSpots();
  const available = spots.find((s) => s.status === "available");
  if (!available) {
    console.log("verify-payment-integrity: skip DB (no available POS)");
    console.log("verify-payment-integrity: unit checks ok");
    return;
  }
  const offer = await getOfferById(available.currentOfferId);
  if (!offer || offer.status !== "active") {
    console.log("verify-payment-integrity: skip DB (no offer)");
    return;
  }

  const beforeStatus = available.status;
  const street = TEL_AVIV_STREETS[0] ?? "רוטשילד";
  const createdIds: string[] = [];

  async function seedPending(lowProfileId: string): Promise<{ orderId: string; price: number }> {
    await setPosSpotStatus(available!.id, "available");
    const orderId = randomUUID();
    const price = offer!.consumerPrice;
    const resume = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    await appendOrder({
      orderId,
      checkoutSessionId: lowProfileId,
      paymentResumeToken: resume.slice(0, 64),
      cardcomEnv: "test",
      posSpotId: available!.id,
      offerId: offer!.id,
      plantId: offer!.productId,
      plantName: "Integrity Verify Plant",
      locationId: available!.partnerLocationId,
      locationName: "Verify",
      locationAddress: null,
      price,
      fullName: "Integrity Verify",
      customerEmail: "integrity@example.com",
      phone: "0546605603",
      address: `${street} 1`,
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      createdAt: new Date().toISOString(),
      orderStatus: "pending_payment",
      source: "online",
      snapshot: {
        productId: offer!.productId,
        productName: "Integrity Verify Plant",
        productDescription: "verify",
        offerId: offer!.id,
        consumerPrice: price,
        posSpotId: available!.id,
        spotSlug: available!.spotSlug,
        fulfillmentType: "delivery",
      },
    });
    createdIds.push(orderId);
    const hold = await acquirePosSpotHoldForPayment(available!.id);
    assert.equal(hold.ok, true);
    return { orderId, price };
  }

  try {
    // Admin cancel sold rejected
    {
      const lp = `lp-adm-sold-${randomUUID()}`;
      const { orderId, price } = await seedPending(lp);
      await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: async () =>
            parseCardcomLowProfileResult({
              ResponseCode: 0,
              LowProfileId: lp,
              ReturnValue: orderId,
              TranzactionInfo: {
                ResponseCode: 0,
                Amount: price,
                CoinId: 1,
                TranzactionId: 800001,
              },
            }),
          processDocumentAndEmail: async () => ({ outcome: "skipped" }),
        },
      );
      const paid = await getOrderById(orderId);
      assert.equal(paid?.orderStatus, "sold");
      const cancel = await adminCancelPendingPaymentOrder({
        orderId,
        cancellationReason: "should fail",
      });
      assert.equal(cancel.ok, false);
      if (!cancel.ok) assert.equal(cancel.reason, "not_cancellable");
      assert.equal((await getOrderById(orderId))?.orderStatus, "sold");
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // Admin cancel pending + race with finalize: cancel loses if already sold
    {
      const lp = `lp-adm-race-${randomUUID()}`;
      const { orderId, price } = await seedPending(lp);
      const finalized = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: async () =>
            parseCardcomLowProfileResult({
              ResponseCode: 0,
              LowProfileId: lp,
              ReturnValue: orderId,
              TranzactionInfo: {
                ResponseCode: 0,
                Amount: price,
                CoinId: 1,
                TranzactionId: 800002,
              },
            }),
          processDocumentAndEmail: async () => ({ outcome: "skipped" }),
        },
      );
      assert.equal(finalized.outcome, "finalized");
      const cancel = await adminCancelPendingPaymentOrder({
        orderId,
        cancellationReason: "late cancel",
      });
      assert.equal(cancel.ok, false);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // Admin cancel pending succeeds and releases hold
    {
      const lp = `lp-adm-ok-${randomUUID()}`;
      const { orderId } = await seedPending(lp);
      const cancel = await adminCancelPendingPaymentOrder({
        orderId,
        cancellationReason: "admin test cancel",
      });
      assert.equal(cancel.ok, true);
      assert.equal((await getOrderById(orderId))?.orderStatus, "cancelled");
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // Hold active before 17 minutes
    {
      const lp = `lp-hold-fresh-${randomUUID()}`;
      const { orderId } = await seedPending(lp);
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, false);
      assert.equal((await getOrderById(orderId))?.orderStatus, "pending_payment");
      assert.equal((await getPosSpotById(available.id))?.status, "held_for_payment");
      await releasePosSpotHoldForPayment(available.id);
      await sql`UPDATE orders SET order_status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancellation_reason = 'cleanup' WHERE order_id = ${orderId}::uuid`;
      await setPosSpotStatus(available.id, "available");
    }

    // Hold expires after 17 minutes; POS available; resume dead; late webhook fails
    {
      const lp = `lp-hold-exp-${randomUUID()}`;
      const { orderId, price } = await seedPending(lp);
      const order = await getOrderById(orderId);
      assert.ok(order?.paymentResumeToken);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, true);
      assert.equal((await getOrderById(orderId))?.orderStatus, "cancelled");
      assert.equal((await getPosSpotById(available.id))?.status, "available");

      const retry = await retryCardcomPayment(
        { orderId, resumeToken: order!.paymentResumeToken! },
        {
          publicOrigin: "https://example.com",
          createLowProfile: async () => {
            throw new Error("must not create after expiry");
          },
        },
      );
      assert.equal(retry.ok, false);

      const late = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: async () =>
            parseCardcomLowProfileResult({
              ResponseCode: 0,
              LowProfileId: lp,
              ReturnValue: orderId,
              TranzactionInfo: {
                ResponseCode: 0,
                Amount: price,
                CoinId: 1,
                TranzactionId: 800003,
              },
            }),
        },
      );
      assert.equal(late.outcome, "ignored_cancelled");
      assert.equal((await getOrderById(orderId))?.orderStatus, "cancelled");
      assert.notEqual((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // Paid order never expired
    {
      const lp = `lp-hold-paid-${randomUUID()}`;
      const { orderId, price } = await seedPending(lp);
      await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: async () =>
            parseCardcomLowProfileResult({
              ResponseCode: 0,
              LowProfileId: lp,
              ReturnValue: orderId,
              TranzactionInfo: {
                ResponseCode: 0,
                Amount: price,
                CoinId: 1,
                TranzactionId: 800004,
              },
            }),
          processDocumentAndEmail: async () => ({ outcome: "skipped" }),
        },
      );
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, false);
      assert.equal((await getOrderById(orderId))?.orderStatus, "sold");
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // Another customer can purchase after expiry (hold acquire succeeds)
    {
      const lp = `lp-hold-next-${randomUUID()}`;
      const { orderId } = await seedPending(lp);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      await expireStalePaymentHold(available.id);
      assert.equal((await getOrderById(orderId))?.orderStatus, "cancelled");
      const next = await acquirePosSpotHoldForPayment(available.id);
      assert.equal(next.ok, true);
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");
    }

    // Concurrent retries → one Create
    {
      const lp = `lp-retry-lock-${randomUUID()}`;
      const { orderId } = await seedPending(lp);
      const order = await getOrderById(orderId);
      assert.ok(order?.paymentResumeToken);
      let createCalls = 0;
      const deps = {
        publicOrigin: "https://example.com",
        createLowProfile: async () => {
          createCalls += 1;
          await new Promise((r) => setTimeout(r, 80));
          return {
            LowProfileId: `lp-new-${randomUUID()}`,
            Url: "https://secure.cardcom.solutions/Interfaces/PayCard/Pay.aspx?test=1",
          };
        },
        cardcomEnvironment: "test" as const,
      };
      const [a, b] = await Promise.all([
        retryCardcomPayment(
          { orderId, resumeToken: order!.paymentResumeToken! },
          deps,
        ),
        retryCardcomPayment(
          { orderId, resumeToken: order!.paymentResumeToken! },
          deps,
        ),
      ]);
      const oks = [a, b].filter((r) => r.ok);
      const busys = [a, b].filter((r) => !r.ok && r.code === "busy");
      assert.equal(oks.length, 1);
      assert.equal(busys.length, 1);
      assert.equal(createCalls, 1);
      await releasePosSpotHoldForPayment(available.id);
      await sql`UPDATE orders SET order_status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancellation_reason = 'cleanup' WHERE order_id = ${orderId}::uuid`;
      await setPosSpotStatus(available.id, "available");
    }

    // Create failure restores retry availability
    {
      const lp = `lp-retry-fail-${randomUUID()}`;
      const { orderId } = await seedPending(lp);
      const order = await getOrderById(orderId);
      const fail = await retryCardcomPayment(
        { orderId, resumeToken: order!.paymentResumeToken! },
        {
          publicOrigin: "https://example.com",
          createLowProfile: async () => {
            throw new Error("cardcom down");
          },
          cardcomEnvironment: "test",
        },
      );
      assert.equal(fail.ok, false);
      const claim = await claimPaymentRetryLock({
        orderId,
        resumeToken: order!.paymentResumeToken!,
      });
      assert.equal(claim.ok, true);
      await releasePaymentRetryLock(orderId);
      await releasePosSpotHoldForPayment(available.id);
      await sql`UPDATE orders SET order_status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancellation_reason = 'cleanup' WHERE order_id = ${orderId}::uuid`;
      await setPosSpotStatus(available.id, "available");
    }

    // Stale retry lock (>3 minutes) can be reclaimed
    {
      const lp = `lp-retry-stale-${randomUUID()}`;
      const { orderId } = await seedPending(lp);
      const order = await getOrderById(orderId);
      const first = await claimPaymentRetryLock({
        orderId,
        resumeToken: order!.paymentResumeToken!,
      });
      assert.equal(first.ok, true);
      const busy = await claimPaymentRetryLock({
        orderId,
        resumeToken: order!.paymentResumeToken!,
      });
      assert.equal(busy.ok, false);
      if (!busy.ok) assert.equal(busy.reason, "busy");
      await sql`
        UPDATE orders
        SET payment_retry_lock_at = now() - interval '4 minutes'
        WHERE order_id = ${orderId}::uuid
      `;
      const reclaimed = await claimPaymentRetryLock({
        orderId,
        resumeToken: order!.paymentResumeToken!,
      });
      assert.equal(reclaimed.ok, true);
      await releasePaymentRetryLock(orderId);
      await releasePosSpotHoldForPayment(available.id);
      await sql`UPDATE orders SET order_status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancellation_reason = 'cleanup' WHERE order_id = ${orderId}::uuid`;
      await setPosSpotStatus(available.id, "available");
    }

    // Retry after completed payment rejected
    {
      const lp = `lp-retry-done-${randomUUID()}`;
      const { orderId, price } = await seedPending(lp);
      const order = await getOrderById(orderId);
      await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: async () =>
            parseCardcomLowProfileResult({
              ResponseCode: 0,
              LowProfileId: lp,
              ReturnValue: orderId,
              TranzactionInfo: {
                ResponseCode: 0,
                Amount: price,
                CoinId: 1,
                TranzactionId: 800005,
              },
            }),
          processDocumentAndEmail: async () => ({ outcome: "skipped" }),
        },
      );
      const retry = await retryCardcomPayment(
        { orderId, resumeToken: order!.paymentResumeToken! },
        {
          publicOrigin: "https://example.com",
          createLowProfile: async () => {
            throw new Error("must not");
          },
        },
      );
      assert.equal(retry.ok, false);
      await setPosSpotStatus(available.id, "available");
    }

    console.log("verify-payment-integrity: ok");
  } finally {
    for (const id of [...new Set(createdIds)]) {
      await sql`DELETE FROM orders WHERE order_id = ${id}::uuid`;
    }
    const spot = await getPosSpotById(available.id);
    if (spot?.status === "held_for_payment") {
      await releasePosSpotHoldForPayment(available.id);
    }
    await setPosSpotStatus(available.id, beforeStatus);
  }
}

void main().catch((error) => {
  console.error("verify-payment-integrity: FAILED", error);
  process.exitCode = 1;
});

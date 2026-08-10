/**
 * Payment integrity: admin cancel safety, 17-minute hold expiry, retry lock.
 * Option B: attempt-owned holds; Order only after verified payment.
 * Run: npx tsx scripts/verify-payment-integrity.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const TEST_PUBLIC_ORIGIN = "https://urban-plant-integrity-verify.example.com";

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
    expireAllStalePaymentHolds,
  } = await import("../lib/paymentHoldExpiry");
  const {
    appendOrder,
    adminCancelPendingPaymentOrder,
    getOrderById,
    PAYMENT_RETRY_LOCK_TTL_MS,
  } = await import("../lib/ordersStorage");
  const {
    claimPaymentAttemptRetryLock,
    deletePaymentAttemptById,
    getPaymentAttemptById,
    insertPaymentAttempt,
    releasePaymentAttemptRetryLock,
  } = await import("../lib/paymentAttemptStorage");
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
  const { startCardcomPaymentPrep } = await import("../lib/startCardcomPaymentPrep");
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
  const createdAttemptIds: string[] = [];
  const createdOrderIds: string[] = [];

  async function seedAttempt(email: string): Promise<{
    attemptId: string;
    price: number;
    lowProfileId: string;
    resumeToken: string;
  }> {
    await setPosSpotStatus(available!.id, "available");
    const lp = `lp-int-${randomUUID()}`;
    const prep = await startCardcomPaymentPrep(
      {
        plantId: offer!.productId,
        spotSlug: available!.spotSlug,
        fullName: "Integrity Verify",
        customerEmail: email,
        phone: "0546605603",
        fulfillmentMethod: "delivery",
        deliveryStreet: street,
        deliveryHouseNumber: "1",
        apartmentOrNotes: "",
      },
      {
        publicOrigin: TEST_PUBLIC_ORIGIN,
        createLowProfile: async () => ({
          ResponseCode: 0,
          Description: "OK",
          LowProfileId: lp,
          Url: `https://secure.cardcom.solutions/Interface/LowProfile.aspx?LowProfileId=${lp}`,
        }),
      },
    );
    assert.equal(prep.ok, true, `prep should succeed for ${email}`);
    if (!prep.ok) throw new Error("prep failed");
    createdAttemptIds.push(prep.attemptId);
    const attempt = await getPaymentAttemptById(prep.attemptId);
    assert.ok(attempt);
    assert.equal(await getOrderById(prep.attemptId), null);
    return {
      attemptId: prep.attemptId,
      price: attempt!.amount,
      lowProfileId: prep.lowProfileId,
      resumeToken: attempt!.paymentResumeToken,
    };
  }

  async function finalizeAttempt(
    attemptId: string,
    lowProfileId: string,
    price: number,
    txId: number,
  ): Promise<string> {
    const result = await processCardcomWebhook(
      { LowProfileId: lowProfileId },
      {
        getLpResult: async () =>
          parseCardcomLowProfileResult({
            ResponseCode: 0,
            LowProfileId: lowProfileId,
            ReturnValue: attemptId,
            TranzactionInfo: {
              ResponseCode: 0,
              Amount: price,
              CoinId: 1,
              TranzactionId: txId,
            },
          }),
        processDocumentAndEmail: async () => ({ outcome: "skipped" }),
      },
    );
    assert.equal(result.outcome, "finalized");
    const attempt = await getPaymentAttemptById(attemptId);
    assert.ok(attempt?.finalizedOrderId);
    createdOrderIds.push(attempt!.finalizedOrderId!);
    return attempt!.finalizedOrderId!;
  }

  async function releaseOwnedHold(): Promise<void> {
    const spot = await getPosSpotById(available!.id);
    if (spot?.status === "held_for_payment" && spot.paymentHoldAttemptId) {
      await releasePosSpotHoldForPayment(available!.id, spot.paymentHoldAttemptId);
    }
  }

  /** Legacy pending Order + null-owner hold (admin-cancel path still Order-based). */
  async function seedLegacyPending(lp: string): Promise<{ orderId: string; price: number }> {
    await setPosSpotStatus(available!.id, "available");
    const orderId = randomUUID();
    const price = offer!.consumerPrice;
    const resume = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    await appendOrder({
      orderId,
      checkoutSessionId: lp,
      paymentResumeToken: resume.slice(0, 64),
      cardcomEnv: "test",
      posSpotId: available!.id,
      offerId: offer!.id,
      plantId: offer!.productId,
      plantName: "Integrity Legacy Verify Plant",
      locationId: available!.partnerLocationId,
      locationName: "Verify",
      locationAddress: null,
      price,
      fullName: "Integrity Legacy Verify",
      customerEmail: "integrity-legacy@example.com",
      phone: "0546605603",
      address: `${street} 1`,
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      createdAt: new Date().toISOString(),
      orderStatus: "pending_payment",
      source: "online",
      snapshot: {
        productId: offer!.productId,
        productName: "Integrity Legacy Verify Plant",
        productDescription: "verify",
        offerId: offer!.id,
        consumerPrice: price,
        posSpotId: available!.id,
        spotSlug: available!.spotSlug,
        fulfillmentType: "delivery",
      },
    });
    createdOrderIds.push(orderId);
    await sql`
      UPDATE pos_spots
      SET
        status = 'held_for_payment',
        payment_hold_started_at = now(),
        payment_hold_attempt_id = NULL
      WHERE id = ${available!.id}::uuid
    `;
    return { orderId, price };
  }

  try {
    // Admin cancel sold rejected
    {
      const { attemptId, price, lowProfileId } = await seedAttempt(
        "integrity-adm-sold@example.com",
      );
      const orderId = await finalizeAttempt(attemptId, lowProfileId, price, 800001);
      assert.equal((await getOrderById(orderId))?.orderStatus, "sold");
      const cancel = await adminCancelPendingPaymentOrder({
        orderId,
        cancellationReason: "should fail",
      });
      assert.equal(cancel.ok, false);
      if (!cancel.ok) assert.equal(cancel.reason, "not_cancellable");
      assert.equal((await getOrderById(orderId))?.orderStatus, "sold");
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      const releaseSold = await releasePosSpotHoldForPayment(available.id, attemptId);
      assert.equal(releaseSold.ok, false, "sold POS cannot be released");
      await setPosSpotStatus(available.id, "available");
    }

    // Admin cancel pending + race with finalize: cancel loses if already sold
    {
      const { attemptId, price, lowProfileId } = await seedAttempt(
        "integrity-adm-race@example.com",
      );
      const orderId = await finalizeAttempt(attemptId, lowProfileId, price, 800002);
      const cancel = await adminCancelPendingPaymentOrder({
        orderId,
        cancellationReason: "late cancel",
      });
      assert.equal(cancel.ok, false);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // Admin cancel pending succeeds and releases hold (legacy pending Order path)
    {
      const lp = `lp-adm-ok-${randomUUID()}`;
      const { orderId } = await seedLegacyPending(lp);
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
      const { attemptId } = await seedAttempt("integrity-hold-fresh@example.com");
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, false);
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "awaiting_payment");
      assert.equal(await getOrderById(attemptId), null);
      assert.equal((await getPosSpotById(available.id))?.status, "held_for_payment");
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // Hold expires after 17 minutes; POS available; attempt expired (no cancelled Order);
    // resume dead; late webhook → needs_reconciliation
    {
      const { attemptId, price, lowProfileId, resumeToken } = await seedAttempt(
        "integrity-hold-exp@example.com",
      );
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, true);
      if (exp.expired) {
        assert.equal(exp.cancelledOrderId, null, "owned hold expiry must not cancel an Order");
        assert.equal(exp.expiredAttemptId, attemptId);
      }
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "expired");
      assert.equal(await getOrderById(attemptId), null);
      assert.equal((await getPosSpotById(available.id))?.status, "available");

      const retry = await retryCardcomPayment(
        { orderId: attemptId, resumeToken },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: async () => {
            throw new Error("must not create after expiry");
          },
        },
      );
      assert.equal(retry.ok, false);

      const late = await processCardcomWebhook(
        { LowProfileId: lowProfileId },
        {
          getLpResult: async () =>
            parseCardcomLowProfileResult({
              ResponseCode: 0,
              LowProfileId: lowProfileId,
              ReturnValue: attemptId,
              TranzactionInfo: {
                ResponseCode: 0,
                Amount: price,
                CoinId: 1,
                TranzactionId: 800003,
              },
            }),
        },
      );
      assert.equal(late.outcome, "needs_reconciliation");
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "needs_reconciliation");
      assert.equal(await getOrderById(attemptId), null);
      assert.notEqual((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // Paid order never expired
    {
      const { attemptId, price, lowProfileId } = await seedAttempt(
        "integrity-hold-paid@example.com",
      );
      const orderId = await finalizeAttempt(attemptId, lowProfileId, price, 800004);
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
      const { attemptId } = await seedAttempt("integrity-hold-next@example.com");
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      await expireStalePaymentHold(available.id);
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "expired");
      const nextAttemptId = randomUUID();
      const nowIso = new Date().toISOString();
      await insertPaymentAttempt({
        id: nextAttemptId,
        status: "created",
        posSpotId: available.id,
        productId: offer.productId,
        productName: "Integrity Next Hold",
        fullName: "Integrity Next",
        customerEmail: "integrity-next@example.com",
        phone: "0500000000",
        address: "",
        apartmentOrNotes: "",
        fulfillmentMethod: "delivery",
        amount: 1,
        paymentResumeToken: `resume-${randomUUID()}`,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      createdAttemptIds.push(nextAttemptId);
      const next = await acquirePosSpotHoldForPayment(available.id, nextAttemptId);
      assert.equal(next.ok, true);
      await releasePosSpotHoldForPayment(available.id, nextAttemptId);
      await setPosSpotStatus(available.id, "available");
    }

    // Scheduled bulk cleanup: stale hold released
    {
      const { attemptId } = await seedAttempt("integrity-bulk-stale@example.com");
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const bulk = await expireAllStalePaymentHolds();
      assert.ok(bulk.expiredPosSpotIds.includes(available.id));
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "expired");
      assert.equal(await getOrderById(attemptId), null);
      assert.equal((await getPosSpotById(available.id))?.status, "available");
      await setPosSpotStatus(available.id, "available");
    }

    // Scheduled bulk cleanup: fresh hold untouched
    {
      const { attemptId } = await seedAttempt("integrity-bulk-fresh@example.com");
      const bulk = await expireAllStalePaymentHolds();
      assert.equal(bulk.expiredPosSpotIds.includes(available.id), false);
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "awaiting_payment");
      assert.equal((await getPosSpotById(available.id))?.status, "held_for_payment");
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // Scheduled bulk cleanup: completed payment untouched
    {
      const { attemptId, price, lowProfileId } = await seedAttempt(
        "integrity-bulk-paid@example.com",
      );
      const orderId = await finalizeAttempt(attemptId, lowProfileId, price, 800014);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const bulk = await expireAllStalePaymentHolds();
      assert.equal(bulk.expiredPosSpotIds.includes(available.id), false);
      assert.equal((await getOrderById(orderId))?.orderStatus, "sold");
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // Scheduled bulk cleanup: repeated run is idempotent
    {
      const { attemptId } = await seedAttempt("integrity-bulk-idem@example.com");
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const first = await expireAllStalePaymentHolds();
      assert.ok(first.expiredPosSpotIds.includes(available.id));
      const second = await expireAllStalePaymentHolds();
      assert.equal(second.expiredPosSpotIds.includes(available.id), false);
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "expired");
      assert.equal((await getPosSpotById(available.id))?.status, "available");
      await setPosSpotStatus(available.id, "available");
    }

    // Scheduled bulk cleanup then late webhook → needs_reconciliation
    {
      const { attemptId, price, lowProfileId } = await seedAttempt(
        "integrity-bulk-late@example.com",
      );
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      await expireAllStalePaymentHolds();
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "expired");
      const late = await processCardcomWebhook(
        { LowProfileId: lowProfileId },
        {
          getLpResult: async () =>
            parseCardcomLowProfileResult({
              ResponseCode: 0,
              LowProfileId: lowProfileId,
              ReturnValue: attemptId,
              TranzactionInfo: {
                ResponseCode: 0,
                Amount: price,
                CoinId: 1,
                TranzactionId: 800015,
              },
            }),
        },
      );
      assert.equal(late.outcome, "needs_reconciliation");
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "needs_reconciliation");
      assert.equal(await getOrderById(attemptId), null);
      assert.notEqual((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // Concurrent retries → one Create
    {
      const { attemptId, resumeToken } = await seedAttempt("integrity-retry-lock@example.com");
      let createCalls = 0;
      const deps = {
        publicOrigin: TEST_PUBLIC_ORIGIN,
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
        retryCardcomPayment({ orderId: attemptId, resumeToken }, deps),
        retryCardcomPayment({ orderId: attemptId, resumeToken }, deps),
      ]);
      const oks = [a, b].filter((r) => r.ok);
      const busys = [a, b].filter((r) => !r.ok && r.code === "busy");
      assert.equal(oks.length, 1);
      assert.equal(busys.length, 1);
      assert.equal(createCalls, 1);
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // Create failure restores retry availability
    {
      const { attemptId, resumeToken } = await seedAttempt("integrity-retry-fail@example.com");
      const fail = await retryCardcomPayment(
        { orderId: attemptId, resumeToken },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: async () => {
            throw new Error("cardcom down");
          },
          cardcomEnvironment: "test",
        },
      );
      assert.equal(fail.ok, false);
      const claim = await claimPaymentAttemptRetryLock({
        attemptId,
        resumeToken,
      });
      assert.equal(claim.ok, true);
      await releasePaymentAttemptRetryLock(attemptId);
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // Stale retry lock (>3 minutes) can be reclaimed
    {
      const { attemptId, resumeToken } = await seedAttempt("integrity-retry-stale@example.com");
      const first = await claimPaymentAttemptRetryLock({
        attemptId,
        resumeToken,
      });
      assert.equal(first.ok, true);
      const busy = await claimPaymentAttemptRetryLock({
        attemptId,
        resumeToken,
      });
      assert.equal(busy.ok, false);
      if (!busy.ok) assert.equal(busy.reason, "busy");
      await sql`
        UPDATE payment_attempts
        SET payment_retry_lock_at = now() - interval '4 minutes'
        WHERE id = ${attemptId}::uuid
      `;
      const reclaimed = await claimPaymentAttemptRetryLock({
        attemptId,
        resumeToken,
      });
      assert.equal(reclaimed.ok, true);
      await releasePaymentAttemptRetryLock(attemptId);
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // Retry after completed payment rejected
    {
      const { attemptId, price, lowProfileId, resumeToken } = await seedAttempt(
        "integrity-retry-done@example.com",
      );
      await finalizeAttempt(attemptId, lowProfileId, price, 800005);
      const retry = await retryCardcomPayment(
        { orderId: attemptId, resumeToken },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
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
    await releaseOwnedHold();
    for (const id of [...new Set(createdAttemptIds)]) {
      await deletePaymentAttemptById(id);
    }
    for (const id of [...new Set(createdOrderIds)]) {
      await sql`DELETE FROM orders WHERE order_id = ${id}::uuid`;
    }
    await setPosSpotStatus(available.id, beforeStatus);
  }
}

void main().catch((error) => {
  console.error("verify-payment-integrity: FAILED", error);
  process.exitCode = 1;
});

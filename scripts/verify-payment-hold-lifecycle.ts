/**
 * Payment hold lifecycle: TTL, lazy expiry, Admin recovery, concurrency guards.
 *
 * Covers:
 * 1. 16-minute hold remains active
 * 2. >17-minute hold expires
 * 3. very old hold expires
 * 4. invalid/missing hold timestamp is safely recovered
 * 5. available/sold spots are untouched
 * 6. expired spot can be held again
 * 7. active hold cannot be stolen
 * 8. Admin can recover an expired hold
 * 9. Admin can manually override an active hold
 * 10. leaving held_for_payment clears timestamp
 * 11. entering held_for_payment sets timestamp
 * 12. cron only releases expired holds
 * 13. stale cleanup cannot release a newer hold
 * 14. payment-success/expiry race is safe (sold not released)
 *
 * Run: npx tsx scripts/verify-payment-hold-lifecycle.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function main(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const {
    isPaymentHoldExpired,
    PAYMENT_HOLD_TTL_MS,
    expireStalePaymentHold,
    expireAllStalePaymentHolds,
  } = await import("../lib/paymentHoldExpiry");
  const {
    deletePaymentAttemptById,
    getPaymentAttemptById,
    insertPaymentAttempt,
  } = await import("../lib/paymentAttemptStorage");
  const {
    acquirePosSpotHoldForPayment,
    completePosSpotSaleFromHold,
    getPosSpotById,
    readPosSpots,
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
    updatePosSpot,
  } = await import("../lib/posSpotStorage");
  const { sql } = await import("../lib/db");

  // --- Pure TTL helper ---
  assert.equal(PAYMENT_HOLD_TTL_MS, 17 * 60 * 1000);
  const now = Date.now();
  // 1. 16-minute hold remains active
  assert.equal(isPaymentHoldExpired(new Date(now - 16 * 60_000).toISOString(), now), false);
  // 2. >17-minute hold expires
  assert.equal(isPaymentHoldExpired(new Date(now - 17 * 60_000 - 1).toISOString(), now), true);
  // 3. very old hold expires
  assert.equal(isPaymentHoldExpired(new Date(now - 7 * 24 * 60_000).toISOString(), now), true);
  // 4. invalid/missing hold timestamp
  assert.equal(isPaymentHoldExpired(null, now), true);
  assert.equal(isPaymentHoldExpired(undefined, now), true);
  assert.equal(isPaymentHoldExpired("", now), true);
  assert.equal(isPaymentHoldExpired("bogus", now), true);

  const spots = await readPosSpots();
  const available = spots.find((s) => s.status === "available");
  if (!available) {
    console.log("verify-payment-hold-lifecycle: unit TTL checks ok (no available POS for DB)");
    return;
  }

  const before = available.status;
  const attemptIds: string[] = [];
  const createdAt = new Date().toISOString();

  async function insertAwaitingAttempt(): Promise<string> {
    const id = randomUUID();
    attemptIds.push(id);
    await insertPaymentAttempt({
      id,
      status: "awaiting_payment",
      posSpotId: available!.id,
      productId: "hold-lifecycle-product",
      productName: "Hold Lifecycle Test",
      fullName: "Hold Lifecycle",
      customerEmail: `hold-lifecycle-${id.slice(0, 8)}@example.com`,
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "pickup",
      amount: 1,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  }

  async function restore(): Promise<void> {
    const current = await getPosSpotById(available!.id);
    if (current?.status === "held_for_payment" && current.paymentHoldAttemptId) {
      await releasePosSpotHoldForPayment(available!.id, current.paymentHoldAttemptId);
    }
    if (current?.status === "held_for_payment") {
      await setPosSpotStatus(available!.id, "available");
    }
    for (const id of [...new Set(attemptIds)]) {
      await deletePaymentAttemptById(id);
    }
    await setPosSpotStatus(available!.id, before);
  }

  try {
    // Fresh hold not expired (16-min equivalent: just acquired)
    {
      const attemptId = await insertAwaitingAttempt();
      const acquired = await acquirePosSpotHoldForPayment(available.id, attemptId);
      assert.equal(acquired.ok, true);
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, false);
      assert.equal(exp.reason, "not_stale");
      assert.equal((await getPosSpotById(available.id))?.status, "held_for_payment");
      await releasePosSpotHoldForPayment(available.id, attemptId);
    }

    // 2. >17-minute hold expires
    {
      const attemptId = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, attemptId)).ok, true);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, true);
      assert.equal((await getPosSpotById(available.id))?.status, "available");
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "expired");
      assert.equal((await getPosSpotById(available.id))?.paymentHoldStartedAt, undefined);
    }

    // 3. very old hold expires
    {
      const attemptId = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, attemptId)).ok, true);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '30 days'
        WHERE id = ${available.id}::uuid
      `;
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, true);
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // 4. invalid/missing hold timestamp is safely recovered (pure helper above;
    //    DB: age clock + expire; also ensure available has no leftover timestamp)
    {
      const attemptId = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, attemptId)).ok, true);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '20 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, true);
      const after = await getPosSpotById(available.id);
      assert.equal(after?.status, "available");
      assert.equal(after?.paymentHoldStartedAt, undefined);
      assert.equal(after?.paymentHoldAttemptId, undefined);
    }

    // 5. available/sold spots untouched
    {
      await setPosSpotStatus(available.id, "available");
      const expAvail = await expireStalePaymentHold(available.id);
      assert.equal(expAvail.expired, false);
      assert.ok(expAvail.reason === "not_held" || expAvail.reason === "not_found");

      const attemptId = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, attemptId)).ok, true);
      assert.equal((await completePosSpotSaleFromHold(available.id, attemptId)).ok, true);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const expSold = await expireStalePaymentHold(available.id);
      assert.equal(expSold.expired, false);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // 6. expired spot can be held again
    // 7. active hold cannot be stolen
    {
      const attemptA = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, attemptA)).ok, true);
      const attemptB = await insertAwaitingAttempt();
      const steal = await acquirePosSpotHoldForPayment(available.id, attemptB);
      assert.equal(steal.ok, false);
      assert.equal(steal.outcome, "unavailable");

      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      assert.equal((await expireStalePaymentHold(available.id)).expired, true);
      const rehold = await acquirePosSpotHoldForPayment(available.id, attemptB);
      assert.equal(rehold.ok, true);
      await releasePosSpotHoldForPayment(available.id, attemptB);
    }

    // 8. Admin can recover an expired hold (lazy repair + status change)
    {
      const attemptId = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, attemptId)).ok, true);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      // Lazy repair as Admin GET/PATCH does:
      await expireStalePaymentHold(available.id);
      assert.equal((await getPosSpotById(available.id))?.status, "available");
      const adminSet = await updatePosSpot(available.id, {
        partnerLocationId: available.partnerLocationId,
        posNumber: available.posNumber ?? "",
        posName: available.posName,
        currentOfferId: available.currentOfferId,
        updateStatus: true,
        status: "available",
      });
      assert.equal(adminSet?.status, "available");
    }

    // 9. Admin can manually override an active hold
    // 10. leaving held clears timestamp
    {
      const attemptId = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, attemptId)).ok, true);
      assert.ok((await getPosSpotById(available.id))?.paymentHoldStartedAt);
      const overridden = await updatePosSpot(available.id, {
        partnerLocationId: available.partnerLocationId,
        posNumber: available.posNumber ?? "",
        posName: available.posName,
        currentOfferId: available.currentOfferId,
        updateStatus: true,
        status: "available",
      });
      assert.equal(overridden?.status, "available");
      assert.equal(overridden?.paymentHoldStartedAt, undefined);
      assert.equal(overridden?.paymentHoldAttemptId, undefined);
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "expired");
    }

    // 11. entering held_for_payment sets timestamp
    {
      const entered = await setPosSpotStatus(available.id, "held_for_payment");
      assert.equal(entered?.status, "held_for_payment");
      assert.ok(entered?.paymentHoldStartedAt);
      assert.equal(entered?.paymentHoldAttemptId, undefined);
      const left = await setPosSpotStatus(available.id, "sold");
      assert.equal(left?.status, "sold");
      assert.equal(left?.paymentHoldStartedAt, undefined);
      await setPosSpotStatus(available.id, "available");
    }

    // 12. cron only releases expired holds
    {
      const freshAttempt = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, freshAttempt)).ok, true);
      const bulkFresh = await expireAllStalePaymentHolds();
      assert.equal(bulkFresh.expiredPosSpotIds.includes(available.id), false);
      assert.equal((await getPosSpotById(available.id))?.status, "held_for_payment");

      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const bulkStale = await expireAllStalePaymentHolds();
      assert.ok(bulkStale.expiredPosSpotIds.includes(available.id));
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // 13. stale cleanup cannot release a newer hold
    {
      const oldAttempt = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, oldAttempt)).ok, true);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      // Expire old → available, then new customer acquires.
      assert.equal((await expireStalePaymentHold(available.id)).expired, true);
      const newAttempt = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, newAttempt)).ok, true);

      // Simulate delayed cleanup for the old attempt id targeting the same spot:
      // expireStalePaymentHold re-reads; fresh hold must survive.
      const delayed = await expireStalePaymentHold(available.id);
      assert.equal(delayed.expired, false);
      assert.equal(delayed.reason, "not_stale");
      const stillNew = await getPosSpotById(available.id);
      assert.equal(stillNew?.status, "held_for_payment");
      assert.equal(stillNew?.paymentHoldAttemptId, newAttempt);

      // Also: ownership-conditional release for old attempt must not clear new hold.
      const stolen = await releasePosSpotHoldForPayment(available.id, oldAttempt);
      assert.equal(stolen.ok, false);
      assert.equal((await getPosSpotById(available.id))?.paymentHoldAttemptId, newAttempt);

      await releasePosSpotHoldForPayment(available.id, newAttempt);
    }

    // 14. payment-success/expiry race is safe (sold not released by expiry)
    {
      const attemptId = await insertAwaitingAttempt();
      assert.equal((await acquirePosSpotHoldForPayment(available.id, attemptId)).ok, true);
      assert.equal((await completePosSpotSaleFromHold(available.id, attemptId)).ok, true);
      await sql`
        UPDATE pos_spots
        SET payment_hold_started_at = now() - interval '18 minutes'
        WHERE id = ${available.id}::uuid
      `;
      const exp = await expireStalePaymentHold(available.id);
      assert.equal(exp.expired, false);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    console.log("verify-payment-hold-lifecycle: all checks ok");
  } finally {
    await restore();
  }
}

void main().catch((error) => {
  console.error("verify-payment-hold-lifecycle: FAILED", error);
  process.exitCode = 1;
});

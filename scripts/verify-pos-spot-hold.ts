/**
 * Offline (+ optional DB) checks for POS held_for_payment.
 *
 * Always runs pure gate/UI checks (no network, no Cardcom).
 * If DATABASE_URL is set, also exercises atomic hold/release against Neon
 * on one spot and restores its prior status (Option B: owned by payment_attempt).
 *
 * Run: npx tsx scripts/verify-pos-spot-hold.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  POS_HELD_FOR_PAYMENT_CHECKOUT_MESSAGE,
  POS_HELD_FOR_PAYMENT_CTA,
  POS_HELD_FOR_PAYMENT_PRODUCT_MESSAGE,
  POS_SOLD_CTA,
  isPosSpotPurchasable,
  productPageCtaText,
  shouldShowHeldForPaymentCheckoutMessage,
  shouldShowHeldForPaymentProductMessage,
} from "../lib/posSpotHold";
import type { PosSpotStatus } from "../lib/posSpotTypes";

function assertGates(): void {
  const statuses: PosSpotStatus[] = [
    "available",
    "held_for_payment",
    "sold",
    "inactive",
  ];

  assert.equal(isPosSpotPurchasable("available"), true);
  for (const status of statuses.filter((s) => s !== "available")) {
    assert.equal(isPosSpotPurchasable(status), false, `${status} must not be purchasable`);
  }

  assert.equal(shouldShowHeldForPaymentProductMessage("held_for_payment"), true);
  assert.equal(shouldShowHeldForPaymentCheckoutMessage("held_for_payment"), true);
  // Resume holder may purchase while held, and must not see the "another customer" checkout block.
  assert.equal(isPosSpotPurchasable("held_for_payment", { resumeHolder: true }), true);
  assert.equal(
    shouldShowHeldForPaymentCheckoutMessage("held_for_payment", { resumeHolder: true }),
    false,
  );
  for (const status of statuses.filter((s) => s !== "held_for_payment")) {
    assert.equal(
      shouldShowHeldForPaymentProductMessage(status),
      false,
      `product held message must not show for ${status}`,
    );
    assert.equal(
      shouldShowHeldForPaymentCheckoutMessage(status),
      false,
      `checkout held message must not show for ${status}`,
    );
  }

  const buyCta = "Buy for ₪89";
  assert.equal(productPageCtaText("held_for_payment", buyCta), POS_HELD_FOR_PAYMENT_CTA);
  assert.equal(productPageCtaText("available", buyCta), buyCta);
  assert.equal(productPageCtaText("sold", buyCta), POS_SOLD_CTA);
  assert.equal(productPageCtaText("inactive", buyCta), buyCta);

  // Sold disables purchase without held copy.
  assert.equal(isPosSpotPurchasable("sold"), false);
  assert.equal(shouldShowHeldForPaymentProductMessage("sold"), false);
  assert.equal(shouldShowHeldForPaymentCheckoutMessage("sold"), false);

  assert.equal(
    POS_HELD_FOR_PAYMENT_PRODUCT_MESSAGE,
    "Another customer is currently purchasing this plant. Please check back shortly.",
  );
  assert.equal(
    POS_HELD_FOR_PAYMENT_CHECKOUT_MESSAGE,
    "This plant is currently being purchased by another customer.",
  );
  assert.equal(POS_HELD_FOR_PAYMENT_CTA, "Purchase in progress");
  assert.equal(POS_SOLD_CTA, "Already found a home");

  // Product page must derive CTA + gate + message from one post-cleanup status.
  // Documents the fixed race: never mix pre-expiry held copy with post-expiry enabled.
  function productPageHoldUi(status: PosSpotStatus, buyCtaText: string) {
    return {
      ctaText: productPageCtaText(status, buyCtaText),
      purchaseEnabled: isPosSpotPurchasable(status),
      showHeldMessage: shouldShowHeldForPaymentProductMessage(status),
    };
  }

  const preCleanup: PosSpotStatus = "held_for_payment";
  const postCleanup: PosSpotStatus = "available";
  // Old bug shape (must not be how the page renders):
  assert.equal(productPageCtaText(preCleanup, buyCta), POS_HELD_FOR_PAYMENT_CTA);
  assert.equal(isPosSpotPurchasable(postCleanup), true);

  const afterExpiry = productPageHoldUi(postCleanup, buyCta);
  assert.equal(afterExpiry.purchaseEnabled, true);
  assert.equal(afterExpiry.ctaText, buyCta);
  assert.equal(afterExpiry.showHeldMessage, false);
  assert.notEqual(afterExpiry.ctaText, POS_HELD_FOR_PAYMENT_CTA);

  const activeHold = productPageHoldUi("held_for_payment", buyCta);
  assert.equal(activeHold.purchaseEnabled, false);
  assert.equal(activeHold.ctaText, POS_HELD_FOR_PAYMENT_CTA);
  assert.equal(activeHold.showHeldMessage, true);

  const availableUi = productPageHoldUi("available", buyCta);
  assert.equal(availableUi.purchaseEnabled, true);
  assert.equal(availableUi.ctaText, buyCta);
  assert.equal(availableUi.showHeldMessage, false);

  for (const status of statuses) {
    const ui = productPageHoldUi(status, buyCta);
    const holdCopy =
      ui.ctaText === POS_HELD_FOR_PAYMENT_CTA || ui.showHeldMessage;
    if (holdCopy) {
      assert.equal(
        ui.purchaseEnabled,
        false,
        `${status}: hold copy must never pair with purchaseEnabled`,
      );
    }
  }

  console.log("verify-pos-spot-hold: pure gates ok");
}

async function assertDbMutations(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  try {
    await loadEnvLocal();
  } catch {
    console.log("verify-pos-spot-hold: skip DB checks (no .env.local / DATABASE_URL)");
    return;
  }

  const {
    acquirePosSpotHoldForPayment,
    completePosSpotSaleFromHold,
    PosSpotPaymentHoldLockedError,
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
    updatePosSpot,
    readPosSpots,
    getPosSpotById,
  } = await import("../lib/posSpotStorage");
  const {
    deletePaymentAttemptById,
    insertPaymentAttempt,
  } = await import("../lib/paymentAttemptStorage");

  const spots = await readPosSpots();
  const spot = spots[0];
  if (!spot) {
    console.log("verify-pos-spot-hold: skip DB checks (no POS spots)");
    return;
  }

  const before = spot.status;
  const attemptIds: string[] = [];

  async function insertAttempt(): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await insertPaymentAttempt({
      id,
      status: "created",
      posSpotId: spot!.id,
      productId: "verify-hold-product",
      productName: "Verify Hold Product",
      fullName: "Hold Verify",
      customerEmail: "hold-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      amount: 1,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    attemptIds.push(id);
    return id;
  }

  try {
    await setPosSpotStatus(spot.id, "available");

    const attemptA = await insertAttempt();
    const acquired = await acquirePosSpotHoldForPayment(spot.id, attemptA);
    assert.equal(acquired.ok, true);
    if (acquired.ok) {
      assert.equal(acquired.outcome, "acquired");
      assert.equal(acquired.posSpot.status, "held_for_payment");
      assert.ok(
        acquired.posSpot.paymentHoldStartedAt,
        "acquire must set payment_hold_started_at",
      );
      assert.equal(
        acquired.posSpot.paymentHoldAttemptId,
        attemptA,
        "acquire must set payment_hold_attempt_id",
      );
    }

    const attemptB = await insertAttempt();
    const second = await acquirePosSpotHoldForPayment(spot.id, attemptB);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.outcome, "unavailable");

    const releaseOk = await releasePosSpotHoldForPayment(spot.id, attemptA);
    assert.equal(releaseOk.ok, true);
    if (releaseOk.ok) {
      assert.equal(releaseOk.outcome, "released");
      assert.equal(releaseOk.posSpot.status, "available");
      assert.equal(
        releaseOk.posSpot.paymentHoldStartedAt,
        undefined,
        "release must clear payment_hold_started_at",
      );
      assert.equal(
        releaseOk.posSpot.paymentHoldAttemptId,
        undefined,
        "release must clear payment_hold_attempt_id",
      );
    }

    const releaseOnAvailable = await releasePosSpotHoldForPayment(spot.id, attemptA);
    assert.equal(releaseOnAvailable.ok, false);
    if (!releaseOnAvailable.ok) assert.equal(releaseOnAvailable.outcome, "unavailable");

    // Ownership: newer attempt owns the hold; older attempt cannot release it.
    const owned = await acquirePosSpotHoldForPayment(spot.id, attemptB);
    assert.equal(owned.ok, true);
    if (owned.ok) {
      assert.equal(owned.posSpot.paymentHoldAttemptId, attemptB);
      assert.ok(owned.posSpot.paymentHoldStartedAt);
    }
    const staleRelease = await releasePosSpotHoldForPayment(spot.id, attemptA);
    assert.equal(staleRelease.ok, false);
    if (!staleRelease.ok) assert.equal(staleRelease.outcome, "unavailable");
    const stillHeld = await getPosSpotById(spot.id);
    assert.equal(stillHeld?.status, "held_for_payment");
    assert.equal(stillHeld?.paymentHoldAttemptId, attemptB);
    const ownerRelease = await releasePosSpotHoldForPayment(spot.id, attemptB);
    assert.equal(ownerRelease.ok, true);
    assert.equal((await getPosSpotById(spot.id))?.status, "available");
    assert.equal((await getPosSpotById(spot.id))?.paymentHoldAttemptId, undefined);

    await setPosSpotStatus(spot.id, "sold");
    const holdSold = await acquirePosSpotHoldForPayment(spot.id, attemptA);
    assert.equal(holdSold.ok, false);

    await setPosSpotStatus(spot.id, "inactive");
    const holdInactive = await acquirePosSpotHoldForPayment(spot.id, attemptA);
    assert.equal(holdInactive.ok, false);

    await setPosSpotStatus(spot.id, "available");
    const attemptC = await insertAttempt();
    await acquirePosSpotHoldForPayment(spot.id, attemptC);
    const soldFromHold = await completePosSpotSaleFromHold(spot.id, attemptC);
    assert.equal(soldFromHold.ok, true);
    if (soldFromHold.ok) {
      assert.equal(soldFromHold.outcome, "sold");
      assert.equal(soldFromHold.posSpot.status, "sold");
      assert.equal(
        soldFromHold.posSpot.paymentHoldStartedAt,
        undefined,
        "complete sale must clear payment_hold_started_at",
      );
      assert.equal(
        soldFromHold.posSpot.paymentHoldAttemptId,
        undefined,
        "complete sale must clear payment_hold_attempt_id",
      );
    }

    const completeAgain = await completePosSpotSaleFromHold(spot.id, attemptC);
    assert.equal(completeAgain.ok, false);

    // Sold POS cannot be released via release API.
    const releaseSold = await releasePosSpotHoldForPayment(spot.id, attemptC);
    assert.equal(releaseSold.ok, false);

    // Admin/updatePosSpot path must not create held_for_payment without timestamp.
    await setPosSpotStatus(spot.id, "available");
    const viaUpdate = await updatePosSpot(spot.id, {
      partnerLocationId: spot.partnerLocationId,
      posNumber: spot.posNumber ?? "",
      posName: spot.posName,
      currentOfferId: spot.currentOfferId,
      updateStatus: true,
      status: "held_for_payment",
    });
    assert.ok(viaUpdate);
    assert.equal(viaUpdate!.status, "held_for_payment");
    assert.ok(
      viaUpdate!.paymentHoldStartedAt,
      "updatePosSpot(held_for_payment) must set payment_hold_started_at",
    );
    const holdStarted = viaUpdate!.paymentHoldStartedAt;

    // Saving again as held must preserve the original hold start (not reset TTL).
    await new Promise((r) => setTimeout(r, 20));
    const again = await updatePosSpot(spot.id, {
      partnerLocationId: spot.partnerLocationId,
      posNumber: spot.posNumber ?? "",
      posName: spot.posName,
      currentOfferId: spot.currentOfferId,
      updateStatus: true,
      status: "held_for_payment",
    });
    assert.equal(again?.paymentHoldStartedAt, holdStarted);

    // Legacy null-owner held_for_payment may still be cleared by Admin.
    const cleared = await updatePosSpot(spot.id, {
      partnerLocationId: spot.partnerLocationId,
      posNumber: spot.posNumber ?? "",
      posName: spot.posName,
      currentOfferId: spot.currentOfferId,
      updateStatus: true,
      status: "available",
    });
    assert.equal(cleared?.status, "available");
    assert.equal(cleared?.paymentHoldStartedAt, undefined);

    const reloaded = await getPosSpotById(spot.id);
    assert.equal(reloaded?.status, "available");
    assert.equal(reloaded?.paymentHoldStartedAt, undefined);

    // Attempt-owned hold: generic Admin status writers must be blocked.
    const attemptAdmin = await insertAttempt();
    const ownedForAdmin = await acquirePosSpotHoldForPayment(spot.id, attemptAdmin);
    assert.equal(ownedForAdmin.ok, true);
    assert.equal(
      (await getPosSpotById(spot.id))?.paymentHoldAttemptId,
      attemptAdmin,
    );

    await assert.rejects(
      () => setPosSpotStatus(spot.id, "available"),
      (err: unknown) => err instanceof PosSpotPaymentHoldLockedError,
    );
    await assert.rejects(
      () => setPosSpotStatus(spot.id, "sold"),
      (err: unknown) => err instanceof PosSpotPaymentHoldLockedError,
    );
    await assert.rejects(
      () => setPosSpotStatus(spot.id, "inactive"),
      (err: unknown) => err instanceof PosSpotPaymentHoldLockedError,
    );
    await assert.rejects(
      () =>
        updatePosSpot(spot.id, {
          partnerLocationId: spot.partnerLocationId,
          posNumber: spot.posNumber ?? "",
          posName: spot.posName,
          currentOfferId: spot.currentOfferId,
          updateStatus: true,
          status: "available",
        }),
      (err: unknown) => err instanceof PosSpotPaymentHoldLockedError,
    );
    await assert.rejects(
      () =>
        updatePosSpot(spot.id, {
          partnerLocationId: spot.partnerLocationId,
          posNumber: spot.posNumber ?? "",
          posName: spot.posName,
          currentOfferId: spot.currentOfferId,
          updateStatus: true,
          status: "sold",
        }),
      (err: unknown) => err instanceof PosSpotPaymentHoldLockedError,
    );

    const stillOwned = await getPosSpotById(spot.id);
    assert.equal(stillOwned?.status, "held_for_payment");
    assert.equal(stillOwned?.paymentHoldAttemptId, attemptAdmin);
    assert.ok(stillOwned?.paymentHoldStartedAt);

    // Non-status Admin edits remain allowed while owned.
    const nonStatusEdit = await updatePosSpot(spot.id, {
      partnerLocationId: spot.partnerLocationId,
      posNumber: spot.posNumber ?? "",
      posName: spot.posName,
      currentOfferId: spot.currentOfferId,
      updateStatus: false,
    });
    assert.ok(nonStatusEdit);
    assert.equal(nonStatusEdit!.status, "held_for_payment");
    assert.equal(nonStatusEdit!.paymentHoldAttemptId, attemptAdmin);

    // Ownership-aware release clears the lock; Admin may edit status again.
    const unlocked = await releasePosSpotHoldForPayment(spot.id, attemptAdmin);
    assert.equal(unlocked.ok, true);
    const afterRelease = await getPosSpotById(spot.id);
    assert.equal(afterRelease?.status, "available");
    assert.equal(afterRelease?.paymentHoldAttemptId, undefined);
    assert.equal(afterRelease?.paymentHoldStartedAt, undefined);

    const adminAfterUnlock = await setPosSpotStatus(spot.id, "available");
    assert.equal(adminAfterUnlock?.status, "available");

    console.log("verify-pos-spot-hold: DB atomic mutations ok");
  } finally {
    const current = await getPosSpotById(spot.id);
    if (current?.status === "held_for_payment" && current.paymentHoldAttemptId) {
      await releasePosSpotHoldForPayment(spot.id, current.paymentHoldAttemptId);
    }
    for (const id of [...new Set(attemptIds)]) {
      await deletePaymentAttemptById(id);
    }
    await setPosSpotStatus(spot.id, before);
  }
}

assertGates();

void assertDbMutations()
  .then(() => {
    console.log("verify-pos-spot-hold: done (no Cardcom calls)");
  })
  .catch((error) => {
    console.error("verify-pos-spot-hold: FAILED", error);
    process.exitCode = 1;
  });

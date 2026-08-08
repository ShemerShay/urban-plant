/**
 * Offline (+ optional DB) checks for POS held_for_payment.
 *
 * Always runs pure gate/UI checks (no network, no Cardcom).
 * If DATABASE_URL is set, also exercises atomic hold/release against Neon
 * on one spot and restores its prior status.
 *
 * Run: npx tsx scripts/verify-pos-spot-hold.ts
 */

import assert from "node:assert/strict";

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
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
    readPosSpots,
  } = await import("../lib/posSpotStorage");

  const spots = await readPosSpots();
  const spot = spots[0];
  if (!spot) {
    console.log("verify-pos-spot-hold: skip DB checks (no POS spots)");
    return;
  }

  const before = spot.status;
  try {
    await setPosSpotStatus(spot.id, "available");

    const acquired = await acquirePosSpotHoldForPayment(spot.id);
    assert.equal(acquired.ok, true);
    if (acquired.ok) {
      assert.equal(acquired.outcome, "acquired");
      assert.equal(acquired.posSpot.status, "held_for_payment");
    }

    const second = await acquirePosSpotHoldForPayment(spot.id);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.outcome, "unavailable");

    const releaseOk = await releasePosSpotHoldForPayment(spot.id);
    assert.equal(releaseOk.ok, true);
    if (releaseOk.ok) {
      assert.equal(releaseOk.outcome, "released");
      assert.equal(releaseOk.posSpot.status, "available");
    }

    const releaseOnAvailable = await releasePosSpotHoldForPayment(spot.id);
    assert.equal(releaseOnAvailable.ok, false);
    if (!releaseOnAvailable.ok) assert.equal(releaseOnAvailable.outcome, "unavailable");

    await setPosSpotStatus(spot.id, "sold");
    const holdSold = await acquirePosSpotHoldForPayment(spot.id);
    assert.equal(holdSold.ok, false);

    await setPosSpotStatus(spot.id, "inactive");
    const holdInactive = await acquirePosSpotHoldForPayment(spot.id);
    assert.equal(holdInactive.ok, false);

    await setPosSpotStatus(spot.id, "available");
    await acquirePosSpotHoldForPayment(spot.id);
    const soldFromHold = await completePosSpotSaleFromHold(spot.id);
    assert.equal(soldFromHold.ok, true);
    if (soldFromHold.ok) {
      assert.equal(soldFromHold.outcome, "sold");
      assert.equal(soldFromHold.posSpot.status, "sold");
    }

    const completeAgain = await completePosSpotSaleFromHold(spot.id);
    assert.equal(completeAgain.ok, false);

    console.log("verify-pos-spot-hold: DB atomic mutations ok");
  } finally {
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

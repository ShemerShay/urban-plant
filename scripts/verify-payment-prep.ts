/**
 * Option B cutover verification: payment_attempt + owned hold (Cardcom Create mocked).
 *
 * Run: npx tsx scripts/verify-payment-prep.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const TEST_PUBLIC_ORIGIN = "https://urban-plant-phase-b-verify.example.com";

async function main(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const { getOfferById } = await import("../lib/offerStorage");
  const { readEvents } = await import("../lib/eventStorage");
  const { getOrderById, readOrders } = await import("../lib/ordersStorage");
  const {
    deletePaymentAttemptById,
    getPaymentAttemptById,
  } = await import("../lib/paymentAttemptStorage");
  const {
    getPosSpotById,
    readPosSpots,
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
  } = await import("../lib/posSpotStorage");
  const {
    CANCEL_REASON_PAYMENT_PREP_FAILED,
    CANCEL_REASON_POS_UNAVAILABLE_BEFORE_PAYMENT,
    compensatePaymentPrepFailure,
    startCardcomPaymentPrep,
  } = await import("../lib/startCardcomPaymentPrep");

  const spots = await readPosSpots();
  const available = spots.find((s) => s.status === "available");
  if (!available) {
    console.log("verify-payment-prep: skip (no available POS spot)");
    return;
  }

  const offer = await getOfferById(available.currentOfferId);
  if (!offer || offer.status !== "active" || offer.consumerPrice <= 0) {
    console.log("verify-payment-prep: skip (no valid active offer)");
    return;
  }

  const beforeStatus = available.status;
  const street = TEL_AVIV_STREETS[0] ?? "Rothschild";
  const baseInput = {
    plantId: offer.productId,
    spotSlug: available.spotSlug,
    fullName: "Phase B Verify",
    customerEmail: "phase-b-verify@example.com",
    phone: "0546605603",
    fulfillmentMethod: "delivery" as const,
    deliveryStreet: street,
    deliveryHouseNumber: "12",
    apartmentOrNotes: "verify",
  };

  const mockCreate = () => {
    const lowProfileId = `lp-prep-${randomUUID()}`;
    return {
      createLowProfile: async () => ({
        ResponseCode: 0,
        Description: "OK",
        LowProfileId: lowProfileId,
        Url: `https://secure.cardcom.solutions/Interface/LowProfile.aspx?LowProfileId=${lowProfileId}`,
      }),
      publicOrigin: TEST_PUBLIC_ORIGIN,
    };
  };

  const createdAttemptIds: string[] = [];
  const eventCountBefore = (await readEvents()).length;

  try {
    const { getPlantById } = await import("../lib/plantCatalog");
    const { inventoryTypeOrDefault } = await import("../lib/inventoryType");
    const availablePlant = await getPlantById(offer.productId);
    if (inventoryTypeOrDefault(availablePlant?.inventoryType) !== "flowers") {
      const emptyPlant = await startCardcomPaymentPrep(
        { ...baseInput, fullName: "", customerEmail: "", phone: "" },
        mockCreate(),
      );
      assert.equal(emptyPlant.ok, false);
      if (!emptyPlant.ok) {
        assert.equal(emptyPlant.code, "validation");
        assert.equal(emptyPlant.error, "fullName is required");
      }
    }

    const first = await startCardcomPaymentPrep(baseInput, mockCreate());
    assert.equal(first.ok, true, "first prep should succeed");
    if (!first.ok) return;
    createdAttemptIds.push(first.attemptId);
    assert.ok(first.lowProfileId);
    assert.ok(first.paymentUrl);
    assert.equal(first.orderId, first.attemptId);

    // No Order before verified payment
    assert.equal(await getOrderById(first.attemptId), null);
    const pendingOrders = (await readOrders()).filter(
      (o) =>
        o.posSpotId === available.id && o.orderStatus === "pending_payment",
    );
    assert.equal(pendingOrders.length, 0, "new checkout must not create pending_payment Order");

    const attempt = await getPaymentAttemptById(first.attemptId);
    assert.ok(attempt);
    assert.equal(attempt!.status, "awaiting_payment");
    assert.equal(attempt!.amount, offer.consumerPrice);
    assert.equal(attempt!.fullName, "Phase B Verify");
    assert.equal(attempt!.customerEmail, "phase-b-verify@example.com");
    assert.equal(attempt!.checkoutSessionId, first.lowProfileId);
    assert.ok(attempt!.snapshot);
    assert.equal(attempt!.snapshot!.posSpotId, available.id);

    const held = await getPosSpotById(available.id);
    assert.equal(held?.status, "held_for_payment");
    assert.equal(held?.paymentHoldAttemptId, first.attemptId);
    assert.ok(held?.paymentHoldStartedAt);

    const second = await startCardcomPaymentPrep(
      {
        ...baseInput,
        customerEmail: "phase-b-verify-2@example.com",
      },
      mockCreate(),
    );
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "unavailable");
      assert.equal(second.httpStatus, 409);
    }

    await compensatePaymentPrepFailure(
      attempt!,
      available.id,
      CANCEL_REASON_PAYMENT_PREP_FAILED,
      { releaseHold: true },
    );
    assert.equal((await getPaymentAttemptById(first.attemptId))?.status, "cancelled");
    assert.equal(
      (await getPaymentAttemptById(first.attemptId))?.failureReason,
      CANCEL_REASON_PAYMENT_PREP_FAILED,
    );
    assert.equal((await getPosSpotById(available.id))?.status, "available");
    assert.equal((await getPosSpotById(available.id))?.paymentHoldAttemptId, undefined);

    await setPosSpotStatus(available.id, "sold");
    const blocked = await startCardcomPaymentPrep(baseInput, mockCreate());
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "unavailable");
    assert.equal((await getPosSpotById(available.id))?.status, "sold");

    await setPosSpotStatus(available.id, "available");
    const again = await startCardcomPaymentPrep(
      {
        ...baseInput,
        customerEmail: "phase-b-verify-3@example.com",
      },
      mockCreate(),
    );
    assert.equal(again.ok, true);
    if (again.ok) createdAttemptIds.push(again.attemptId);
    const againAttempt = await getPaymentAttemptById(again.ok ? again.attemptId : "");
    assert.ok(againAttempt);
    await compensatePaymentPrepFailure(
      againAttempt!,
      available.id,
      CANCEL_REASON_POS_UNAVAILABLE_BEFORE_PAYMENT,
      { releaseHold: true },
    );
    assert.equal(
      (await getPaymentAttemptById(againAttempt!.id))?.failureReason,
      CANCEL_REASON_POS_UNAVAILABLE_BEFORE_PAYMENT,
    );

    assert.equal((await readEvents()).length, eventCountBefore);
    assert.notEqual((await getPosSpotById(available.id))?.status, "sold");

    const latestSpots = await readPosSpots();
    let flowerSpot: (typeof latestSpots)[number] | undefined;
    let flowerOffer: NonNullable<Awaited<ReturnType<typeof getOfferById>>> | undefined;
    for (const spot of latestSpots) {
      if (spot.status !== "available") continue;
      const candidateOffer = await getOfferById(spot.currentOfferId);
      if (
        !candidateOffer ||
        candidateOffer.status !== "active" ||
        candidateOffer.consumerPrice <= 0
      ) {
        continue;
      }
      const candidatePlant = await getPlantById(candidateOffer.productId);
      if (inventoryTypeOrDefault(candidatePlant?.inventoryType) === "flowers") {
        flowerSpot = spot;
        flowerOffer = candidateOffer;
        break;
      }
    }
    if (!flowerSpot || !flowerOffer) {
      console.log("verify-payment-prep: skip flower empty-fields (no available flower POS)");
    } else {
      const flowerPrep = await startCardcomPaymentPrep(
        {
          plantId: flowerOffer.productId,
          spotSlug: flowerSpot.spotSlug,
          fullName: "",
          customerEmail: "",
          phone: "",
          fulfillmentMethod: "pickup",
        },
        mockCreate(),
      );
      assert.equal(
        flowerPrep.ok,
        true,
        "flower prep with empty customer fields should succeed",
      );
      if (flowerPrep.ok) createdAttemptIds.push(flowerPrep.attemptId);
      const flowerAttempt = await getPaymentAttemptById(
        flowerPrep.ok ? flowerPrep.attemptId : "",
      );
      assert.ok(flowerAttempt);
      assert.equal(flowerAttempt!.fullName, "");
      assert.equal(flowerAttempt!.customerEmail, "");
      assert.equal(flowerAttempt!.phone, "");
      assert.equal(flowerAttempt!.fulfillmentMethod, "pickup");
      assert.equal((await getPosSpotById(flowerSpot.id))?.status, "available");
      await compensatePaymentPrepFailure(
        flowerAttempt!,
        flowerSpot.id,
        CANCEL_REASON_PAYMENT_PREP_FAILED,
      );
    }

    console.log("verify-payment-prep: ok (Cardcom mocked)");
  } finally {
    for (const id of [...new Set(createdAttemptIds)]) {
      await deletePaymentAttemptById(id);
    }
    const spot = await getPosSpotById(available.id);
    if (spot?.status === "held_for_payment" && spot.paymentHoldAttemptId) {
      await releasePosSpotHoldForPayment(available.id, spot.paymentHoldAttemptId);
    }
    await setPosSpotStatus(available.id, beforeStatus);
  }
}

void main().catch((error) => {
  console.error("verify-payment-prep: FAILED", error);
  process.exitCode = 1;
});

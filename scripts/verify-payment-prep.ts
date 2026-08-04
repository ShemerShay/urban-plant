/**
 * Phase B-oriented verification (still valid under Phase C):
 * pending order + POS hold, with Cardcom Create mocked (no real network).
 *
 * Run: npx tsx scripts/verify-payment-prep.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const TEST_PUBLIC_ORIGIN = "https://urban-plant-phase-b-verify.example.com";

async function main(): Promise<void> {
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const { getOfferById } = await import("../lib/offerStorage");
  const { readEvents } = await import("../lib/eventStorage");
  const { getOrderById, readOrders } = await import("../lib/ordersStorage");
  const {
    getPosSpotById,
    readPosSpots,
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
  } = await import("../lib/posSpotStorage");
  const { sql } = await import("../lib/db");
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
  const street = TEL_AVIV_STREETS[0] ?? "רוטשילד";
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

  const createdIds: string[] = [];
  const eventCountBefore = (await readEvents()).length;

  try {
    // 1–6: create pending + hold (+ mocked Cardcom)
    const first = await startCardcomPaymentPrep(baseInput, mockCreate());
    assert.equal(first.ok, true, "first prep should succeed");
    if (!first.ok) return;
    createdIds.push(first.orderId);
    assert.ok(first.lowProfileId);
    assert.ok(first.paymentUrl);

    const order = await getOrderById(first.orderId);
    assert.ok(order, "pending order row exists");
    assert.equal(order!.orderStatus, "pending_payment");
    assert.equal(order!.price, offer.consumerPrice);
    assert.equal(order!.fullName, "Phase B Verify");
    assert.equal(order!.customerEmail, "phase-b-verify@example.com");
    assert.equal(order!.phone, "0546605603");
    assert.equal(order!.fulfillmentMethod, "delivery");
    assert.ok(order!.address.includes(street));
    assert.equal(order!.apartmentOrNotes, "verify");
    assert.ok(order!.snapshot);
    assert.equal(order!.snapshot!.consumerPrice, offer.consumerPrice);
    assert.equal(order!.snapshot!.offerId, offer.id);
    assert.equal(order!.snapshot!.posSpotId, available.id);
    assert.equal(order!.checkoutSessionId, first.lowProfileId);
    assert.notEqual(order!.orderStatus, "sold");
    assert.notEqual(order!.orderStatus, "picked_up");

    const held = await getPosSpotById(available.id);
    assert.equal(held?.status, "held_for_payment");
    assert.notEqual(held?.status, "sold");

    // 7–8: second attempt fails; no extra active pending
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
    const extraPending = (await readOrders()).filter(
      (o) =>
        o.posSpotId === available.id &&
        o.orderStatus === "pending_payment" &&
        o.orderId !== first.orderId,
    );
    assert.equal(extraPending.length, 0);

    // 11: post-hold failure compensation releases hold + cancels
    await compensatePaymentPrepFailure(
      order!,
      available.id,
      CANCEL_REASON_PAYMENT_PREP_FAILED,
      { releaseHold: true },
    );
    assert.equal((await getOrderById(first.orderId))?.orderStatus, "cancelled");
    assert.equal(
      (await getOrderById(first.orderId))?.cancellationReason,
      CANCEL_REASON_PAYMENT_PREP_FAILED,
    );
    assert.equal((await getPosSpotById(available.id))?.status, "available");

    // 9: hold-failure cancel reason helper (POS unavailable path)
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
    if (again.ok) createdIds.push(again.orderId);
    const againOrder = await getOrderById(again.ok ? again.orderId : "");
    assert.ok(againOrder);
    await compensatePaymentPrepFailure(
      againOrder!,
      available.id,
      CANCEL_REASON_POS_UNAVAILABLE_BEFORE_PAYMENT,
      { releaseHold: true },
    );
    assert.equal(
      (await getOrderById(againOrder!.orderId))?.cancellationReason,
      CANCEL_REASON_POS_UNAVAILABLE_BEFORE_PAYMENT,
    );

    // 12–16: no events / no sold from prep
    assert.equal((await readEvents()).length, eventCountBefore);
    assert.notEqual((await getPosSpotById(available.id))?.status, "sold");

    console.log("verify-payment-prep: ok (Cardcom mocked)");
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
  console.error("verify-payment-prep: FAILED", error);
  process.exitCode = 1;
});

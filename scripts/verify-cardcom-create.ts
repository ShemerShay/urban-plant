/**
 * Phase C verification: pending order + POS hold + mocked Cardcom LowProfile/Create.
 * Never calls the real Cardcom API / Terminal 194476.
 *
 * Run: npx tsx scripts/verify-cardcom-create.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const TEST_PUBLIC_ORIGIN = "https://urban-plant-phase-c-verify.example.com";

async function main(): Promise<void> {
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const { CardcomError } = await import("../lib/cardcom");
  type CreateInput = import("../lib/cardcom").CreateCardcomLowProfileInput;

  const { getOfferById } = await import("../lib/offerStorage");
  const { readEvents } = await import("../lib/eventStorage");
  const {
    attachCheckoutSessionIdToPendingOrder,
    getOrderById,
    readOrders,
  } = await import("../lib/ordersStorage");
  const {
    getPosSpotById,
    readPosSpots,
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
  } = await import("../lib/posSpotStorage");
  const { sql } = await import("../lib/db");
  const { routes, buildCardcomCallbackUrls } = await import("../lib/routes");
  const {
    CANCEL_REASON_CARDCOM_CREATE_FAILED,
    CANCEL_REASON_CARDCOM_RESPONSE_INVALID,
    CANCEL_REASON_CARDCOM_SESSION_ATTACH_FAILED,
    startCardcomPaymentPrep,
  } = await import("../lib/startCardcomPaymentPrep");

  const spots = await readPosSpots();
  const available = spots.find((s) => s.status === "available");
  if (!available) {
    console.log("verify-cardcom-create: skip (no available POS spot)");
    return;
  }

  const offer = await getOfferById(available.currentOfferId);
  if (!offer || offer.status !== "active" || offer.consumerPrice <= 0) {
    console.log("verify-cardcom-create: skip (no valid active offer)");
    return;
  }

  const beforeStatus = available.status;
  const street = TEL_AVIV_STREETS[0] ?? "רוטשילד";
  const baseInput = {
    plantId: offer.productId,
    spotSlug: available.spotSlug,
    fullName: "Phase C Verify",
    customerEmail: "phase-c-verify@example.com",
    phone: "0546605603",
    fulfillmentMethod: "delivery" as const,
    deliveryStreet: street,
    deliveryHouseNumber: "12",
    apartmentOrNotes: "verify-c",
  };

  const createdIds: string[] = [];
  const eventCountBefore = (await readEvents()).length;
  let networkCalls = 0;

  const mockSuccess = (lowProfileId: string) => {
    return async (input: CreateInput) => {
      networkCalls += 1;
      return {
        ResponseCode: 0,
        Description: "OK",
        LowProfileId: lowProfileId,
        Url: `https://secure.cardcom.solutions/Interface/LowProfile.aspx?LowProfileId=${lowProfileId}`,
      };
    };
  };

  const captured: { last?: CreateInput } = {};
  const capturingSuccess = (lowProfileId: string) => {
    return async (input: CreateInput) => {
      networkCalls += 1;
      captured.last = input;
      return {
        ResponseCode: 0,
        Description: "OK",
        LowProfileId: lowProfileId,
        Url: `https://secure.cardcom.solutions/Interface/LowProfile.aspx?LowProfileId=${lowProfileId}`,
      };
    };
  };

  try {
    // Callback URL shape is asserted after Create (includes orderId + resume → checkout).
    assert.equal(
      buildCardcomCallbackUrls(TEST_PUBLIC_ORIGIN, {
        orderId: "11111111-1111-1111-1111-111111111111",
        spotSlug: "verify-spot",
        resumeToken: "a".repeat(64),
      }).webHookUrl,
      `${TEST_PUBLIC_ORIGIN}${routes.api.cardcomWebhook()}`,
    );

    // 1–9: valid request → pending order, hold, mapped Cardcom fields, store LowProfileId
    const lp1 = `lp-verify-${randomUUID()}`;
    const first = await startCardcomPaymentPrep(baseInput, {
      publicOrigin: TEST_PUBLIC_ORIGIN,
      createLowProfile: capturingSuccess(lp1),
    });
    assert.equal(first.ok, true, "first create should succeed");
    if (!first.ok) return;
    createdIds.push(first.orderId);

    assert.deepEqual(Object.keys(first).sort(), [
      "lowProfileId",
      "ok",
      "orderId",
      "paymentUrl",
    ]);
    assert.equal(first.lowProfileId, lp1);
    assert.match(first.paymentUrl, /^https:\/\//);
    assert.ok(!("amount" in first));
    assert.ok(!("ApiName" in first));
    assert.ok(!("ApiPassword" in first));
    assert.ok(!("TerminalNumber" in first));

    const order = await getOrderById(first.orderId);
    assert.ok(order, "pending order row exists");
    assert.equal(order!.orderStatus, "pending_payment");
    assert.equal(order!.price, offer.consumerPrice);
    assert.equal(order!.checkoutSessionId, lp1);
    assert.notEqual(order!.orderStatus, "sold");
    assert.notEqual(order!.orderStatus, "picked_up");

    const held = await getPosSpotById(available.id);
    assert.equal(held?.status, "held_for_payment");
    assert.notEqual(held?.status, "sold");

    assert.ok(captured.last, "Cardcom mock received a request");
    assert.equal(captured.last!.amount, order!.price);
    assert.equal(captured.last!.returnValue, first.orderId);
    const expectedProductName = (
      order!.snapshot?.productName ?? order!.plantName
    ).slice(0, 50);
    assert.equal(captured.last!.productName, expectedProductName);
    assert.equal(captured.last!.cardOwnerName, "Phase C Verify");
    assert.equal(captured.last!.cardOwnerEmail, "phase-c-verify@example.com");
    assert.equal(captured.last!.cardOwnerPhone, "0546605603");

    const expectedCallbacks = buildCardcomCallbackUrls(TEST_PUBLIC_ORIGIN, {
      orderId: first.orderId,
      spotSlug: available.spotSlug,
      resumeToken: order!.paymentResumeToken!,
    });
    assert.ok(order!.paymentResumeToken, "resume token stored on pending order");
    assert.equal(
      captured.last!.successRedirectUrl,
      expectedCallbacks.successRedirectUrl,
    );
    assert.equal(
      captured.last!.failedRedirectUrl,
      expectedCallbacks.failedRedirectUrl,
    );
    assert.equal(captured.last!.webHookUrl, expectedCallbacks.webHookUrl);
    assert.match(
      captured.last!.successRedirectUrl,
      new RegExp(`[?&]orderId=${first.orderId}`),
    );
    assert.match(captured.last!.successRedirectUrl, /[?&]resume=/);
    assert.match(
      captured.last!.failedRedirectUrl,
      new RegExp(`/checkout/pos/${available.spotSlug}\\?`),
    );
    assert.match(captured.last!.failedRedirectUrl, /paymentFailed=1/);
    assert.match(
      captured.last!.failedRedirectUrl,
      new RegExp(`[?&]orderId=${first.orderId}`),
    );
    assert.ok(!captured.last!.failedRedirectUrl.includes("/payment/failed"));

    // Release + cancel so we can run failure scenarios on the same spot
    await releasePosSpotHoldForPayment(available.id);
    await sql`
      UPDATE orders
      SET order_status = 'cancelled',
          cancellation_reason = 'verify_cleanup',
          cancelled_at = now(),
          cancelled_by = 'system'
      WHERE order_id = ${first.orderId}::uuid
        AND order_status = 'pending_payment'
    `;
    await setPosSpotStatus(available.id, "available");

    // 10: Cardcom validation failure → cancel + release
    {
      const result = await startCardcomPaymentPrep(
        { ...baseInput, customerEmail: "phase-c-val@example.com" },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: async () => {
            networkCalls += 1;
            throw new CardcomError("Cardcom amount must be a positive finite number.", "validation");
          },
        },
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "cardcom_error");
        assert.equal(result.httpStatus, 502);
      }
      const cancelled = (await readOrders()).find(
        (o) =>
          o.customerEmail === "phase-c-val@example.com" &&
          o.posSpotId === available.id,
      );
      assert.ok(cancelled);
      createdIds.push(cancelled!.orderId);
      assert.equal(cancelled!.orderStatus, "cancelled");
      assert.equal(
        cancelled!.cancellationReason,
        CANCEL_REASON_CARDCOM_CREATE_FAILED,
      );
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // 11: Cardcom network failure → cancel + release
    {
      const result = await startCardcomPaymentPrep(
        { ...baseInput, customerEmail: "phase-c-net@example.com" },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: async () => {
            networkCalls += 1;
            throw new CardcomError("Cardcom LowProfile/Create network error.", "network");
          },
        },
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "cardcom_error");
        assert.equal(result.httpStatus, 502);
      }
      const cancelled = (await readOrders()).find(
        (o) =>
          o.customerEmail === "phase-c-net@example.com" &&
          o.posSpotId === available.id,
      );
      assert.ok(cancelled);
      createdIds.push(cancelled!.orderId);
      assert.equal(cancelled!.orderStatus, "cancelled");
      assert.equal(
        cancelled!.cancellationReason,
        CANCEL_REASON_CARDCOM_CREATE_FAILED,
      );
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // 12: malformed Cardcom response → cancel + release
    {
      const result = await startCardcomPaymentPrep(
        { ...baseInput, customerEmail: "phase-c-malformed@example.com" },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: async () => {
            networkCalls += 1;
            throw new CardcomError("Cardcom returned a malformed response.", "parse");
          },
        },
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "cardcom_error");
        assert.equal(result.httpStatus, 502);
      }
      const cancelled = (await readOrders()).find(
        (o) =>
          o.customerEmail === "phase-c-malformed@example.com" &&
          o.posSpotId === available.id,
      );
      assert.ok(cancelled);
      createdIds.push(cancelled!.orderId);
      assert.equal(cancelled!.orderStatus, "cancelled");
      assert.equal(
        cancelled!.cancellationReason,
        CANCEL_REASON_CARDCOM_RESPONSE_INVALID,
      );
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // 13: failure attaching LowProfileId → cancel + release
    {
      const clashId = `lp-clash-${randomUUID()}`;
      // Pre-create another order that already owns this LowProfileId
      const blocker = await startCardcomPaymentPrep(
        { ...baseInput, customerEmail: "phase-c-blocker@example.com" },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: mockSuccess(clashId),
        },
      );
      assert.equal(blocker.ok, true);
      if (blocker.ok) createdIds.push(blocker.orderId);
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");

      const result = await startCardcomPaymentPrep(
        { ...baseInput, customerEmail: "phase-c-attach-fail@example.com" },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: mockSuccess(clashId),
        },
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "server_error");
        assert.equal(result.httpStatus, 500);
      }
      const cancelled = (await readOrders()).find(
        (o) =>
          o.customerEmail === "phase-c-attach-fail@example.com" &&
          o.posSpotId === available.id,
      );
      assert.ok(cancelled);
      createdIds.push(cancelled!.orderId);
      assert.equal(cancelled!.orderStatus, "cancelled");
      assert.equal(
        cancelled!.cancellationReason,
        CANCEL_REASON_CARDCOM_SESSION_ATTACH_FAILED,
      );
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // 14–15: duplicate LowProfileId / no overwrite of different id
    {
      const lpA = `lp-a-${randomUUID()}`;
      const lpB = `lp-b-${randomUUID()}`;
      const owned = await startCardcomPaymentPrep(
        { ...baseInput, customerEmail: "phase-c-owned@example.com" },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: mockSuccess(lpA),
        },
      );
      assert.equal(owned.ok, true);
      if (owned.ok) createdIds.push(owned.orderId);

      const idempotent = await attachCheckoutSessionIdToPendingOrder(
        owned.ok ? owned.orderId : "",
        lpA,
      );
      assert.equal(idempotent.ok, true);
      if (idempotent.ok) assert.equal(idempotent.alreadyAttached, true);

      const overwrite = await attachCheckoutSessionIdToPendingOrder(
        owned.ok ? owned.orderId : "",
        lpB,
      );
      assert.equal(overwrite.ok, false);
      if (!overwrite.ok) assert.equal(overwrite.reason, "already_set");

      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");

      const other = await startCardcomPaymentPrep(
        { ...baseInput, customerEmail: "phase-c-other@example.com" },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: mockSuccess(lpA),
        },
      );
      assert.equal(other.ok, false);
      if (!other.ok) {
        assert.equal(other.code, "server_error");
      }
      const otherOrder = (await readOrders()).find(
        (o) => o.customerEmail === "phase-c-other@example.com",
      );
      assert.ok(otherOrder);
      createdIds.push(otherOrder!.orderId);
      assert.equal(otherOrder!.orderStatus, "cancelled");
      assert.equal(
        otherOrder!.cancellationReason,
        CANCEL_REASON_CARDCOM_SESSION_ATTACH_FAILED,
      );
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // 16–20: no completed sale, no events, no email side-effect, no sold POS, no real network
    assert.equal((await readEvents()).length, eventCountBefore);
    const soldFromPrep = (await readOrders()).filter(
      (o) =>
        createdIds.includes(o.orderId) &&
        (o.orderStatus === "sold" || o.orderStatus === "picked_up"),
    );
    assert.equal(soldFromPrep.length, 0);
    assert.notEqual((await getPosSpotById(available.id))?.status, "sold");
    assert.ok(networkCalls > 0, "mock was invoked");
    // Real createCardcomLowProfile was never used — only injected mocks.

    // 21: admin/manual completed-order path untouched — confirmed by not importing
    // or calling POST /api/orders here; spot restored below.

    console.log(
      `verify-cardcom-create: ok (mocked Cardcom calls=${networkCalls}, no real network)`,
    );
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
  console.error("verify-cardcom-create: FAILED", error);
  process.exitCode = 1;
});

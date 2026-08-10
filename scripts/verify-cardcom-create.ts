/**
 * Phase C verification: payment_attempt + POS hold + mocked Cardcom LowProfile/Create.
 * Option B: no pending Order before verified payment.
 * Never calls the real Cardcom API / Terminal 194476.
 *
 * Run: npx tsx scripts/verify-cardcom-create.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const TEST_PUBLIC_ORIGIN = "https://urban-plant-phase-c-verify.example.com";

async function main(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const { CardcomError } = await import("../lib/cardcom");
  type CreateInput = import("../lib/cardcom").CreateCardcomLowProfileInput;

  const { getOfferById } = await import("../lib/offerStorage");
  const { readEvents } = await import("../lib/eventStorage");
  const { getOrderById, readOrders } = await import("../lib/ordersStorage");
  const {
    attachCheckoutSessionIdToAttempt,
    deletePaymentAttemptById,
    getPaymentAttemptById,
  } = await import("../lib/paymentAttemptStorage");
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

  const createdAttemptIds: string[] = [];
  const eventCountBefore = (await readEvents()).length;
  let networkCalls = 0;

  const mockSuccess = (lowProfileId: string) => {
    return async (input: CreateInput) => {
      networkCalls += 1;
      void input;
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

  async function releaseOwnedHold(): Promise<void> {
    const spot = await getPosSpotById(available!.id);
    if (spot?.status === "held_for_payment" && spot.paymentHoldAttemptId) {
      await releasePosSpotHoldForPayment(available!.id, spot.paymentHoldAttemptId);
    }
  }

  async function collectAttemptsByEmail(email: string): Promise<string[]> {
    const rows = await sql`
      SELECT id FROM payment_attempts
      WHERE customer_email = ${email}
    `;
    const ids = (rows as { id: string }[]).map((r) => String(r.id));
    for (const id of ids) createdAttemptIds.push(id);
    return ids;
  }

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

    // 1–9: valid request → payment_attempt, hold, mapped Cardcom fields, store LowProfileId
    const lp1 = `lp-verify-${randomUUID()}`;
    const first = await startCardcomPaymentPrep(baseInput, {
      publicOrigin: TEST_PUBLIC_ORIGIN,
      createLowProfile: capturingSuccess(lp1),
    });
    assert.equal(first.ok, true, "first create should succeed");
    if (!first.ok) return;
    createdAttemptIds.push(first.attemptId);

    assert.deepEqual(Object.keys(first).sort(), [
      "attemptId",
      "lowProfileId",
      "ok",
      "orderId",
      "paymentUrl",
    ]);
    assert.equal(first.orderId, first.attemptId);
    assert.equal(first.lowProfileId, lp1);
    assert.match(first.paymentUrl, /^https:\/\//);
    assert.ok(!("amount" in first));
    assert.ok(!("ApiName" in first));
    assert.ok(!("ApiPassword" in first));
    assert.ok(!("TerminalNumber" in first));

    assert.equal(await getOrderById(first.attemptId), null, "prep must not create Order");
    const pendingOrders = (await readOrders()).filter(
      (o) =>
        o.posSpotId === available.id && o.orderStatus === "pending_payment",
    );
    assert.equal(pendingOrders.length, 0);

    const attempt = await getPaymentAttemptById(first.attemptId);
    assert.ok(attempt, "payment_attempt row exists");
    assert.equal(attempt!.status, "awaiting_payment");
    assert.equal(attempt!.amount, offer.consumerPrice);
    assert.equal(attempt!.checkoutSessionId, lp1);

    const held = await getPosSpotById(available.id);
    assert.equal(held?.status, "held_for_payment");
    assert.equal(held?.paymentHoldAttemptId, first.attemptId);
    assert.notEqual(held?.status, "sold");

    assert.ok(captured.last, "Cardcom mock received a request");
    assert.equal(captured.last!.amount, attempt!.amount);
    assert.equal(captured.last!.returnValue, first.attemptId);
    const expectedProductName = (
      attempt!.snapshot?.productName ?? attempt!.productName
    ).slice(0, 50);
    assert.equal(captured.last!.productName, expectedProductName);
    assert.equal(captured.last!.cardOwnerName, "Phase C Verify");
    assert.equal(captured.last!.cardOwnerEmail, "phase-c-verify@example.com");
    assert.equal(captured.last!.cardOwnerPhone, "0546605603");

    const expectedCallbacks = buildCardcomCallbackUrls(TEST_PUBLIC_ORIGIN, {
      orderId: first.attemptId,
      spotSlug: available.spotSlug,
      resumeToken: attempt!.paymentResumeToken,
    });
    assert.ok(attempt!.paymentResumeToken, "resume token stored on attempt");
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
      new RegExp(`[?&]orderId=${first.attemptId}`),
    );
    assert.match(captured.last!.successRedirectUrl, /[?&]resume=/);
    assert.match(
      captured.last!.failedRedirectUrl,
      new RegExp(`/checkout/pos/${available.spotSlug}\\?`),
    );
    assert.match(captured.last!.failedRedirectUrl, /paymentFailed=1/);
    assert.match(
      captured.last!.failedRedirectUrl,
      new RegExp(`[?&]orderId=${first.attemptId}`),
    );
    assert.ok(!captured.last!.failedRedirectUrl.includes("/payment/failed"));

    // Release + cancel attempt so we can run failure scenarios on the same spot
    await releasePosSpotHoldForPayment(available.id, first.attemptId);
    await deletePaymentAttemptById(first.attemptId);
    createdAttemptIds.splice(createdAttemptIds.indexOf(first.attemptId), 1);
    await setPosSpotStatus(available.id, "available");

    // 10: Cardcom validation failure → cancel attempt + release
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
      // Failed prep may have created then cancelled an attempt — track via spot history.
      // compensatePaymentPrepFailure marks attempt cancelled; attempt id is not returned on error.
      // Scan by inserting a successful prep cleanup isn't needed — assert no hold + no pending Order.
      assert.equal((await getPosSpotById(available.id))?.status, "available");
      assert.equal(
        (await readOrders()).filter(
          (o) =>
            o.customerEmail === "phase-c-val@example.com" &&
            o.orderStatus === "pending_payment",
        ).length,
        0,
      );
      const ids = await collectAttemptsByEmail("phase-c-val@example.com");
      assert.ok(ids.length >= 1);
      const cancelled = await getPaymentAttemptById(ids[0]!);
      assert.equal(cancelled?.status, "cancelled");
      assert.equal(
        cancelled?.failureReason,
        CANCEL_REASON_CARDCOM_CREATE_FAILED,
      );
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
      const ids = await collectAttemptsByEmail("phase-c-net@example.com");
      assert.ok(ids.length >= 1);
      const cancelled = await getPaymentAttemptById(ids[0]!);
      assert.equal(cancelled?.status, "cancelled");
      assert.equal(
        cancelled?.failureReason,
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
      const ids = await collectAttemptsByEmail("phase-c-malformed@example.com");
      assert.ok(ids.length >= 1);
      const cancelled = await getPaymentAttemptById(ids[0]!);
      assert.equal(cancelled?.status, "cancelled");
      assert.equal(
        cancelled?.failureReason,
        CANCEL_REASON_CARDCOM_RESPONSE_INVALID,
      );
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // 13: failure attaching LowProfileId → cancel + release
    {
      const clashId = `lp-clash-${randomUUID()}`;
      const blocker = await startCardcomPaymentPrep(
        { ...baseInput, customerEmail: "phase-c-blocker@example.com" },
        {
          publicOrigin: TEST_PUBLIC_ORIGIN,
          createLowProfile: mockSuccess(clashId),
        },
      );
      assert.equal(blocker.ok, true);
      if (blocker.ok) createdAttemptIds.push(blocker.attemptId);
      await releasePosSpotHoldForPayment(available.id, blocker.ok ? blocker.attemptId : "");
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
      const ids = await collectAttemptsByEmail("phase-c-attach-fail@example.com");
      assert.ok(ids.length >= 1);
      const cancelled = await getPaymentAttemptById(ids[0]!);
      assert.equal(cancelled?.status, "cancelled");
      assert.equal(
        cancelled?.failureReason,
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
      if (owned.ok) createdAttemptIds.push(owned.attemptId);

      const idempotent = await attachCheckoutSessionIdToAttempt(
        owned.ok ? owned.attemptId : "",
        lpA,
      );
      assert.equal(idempotent.ok, true);
      if (idempotent.ok) assert.equal(idempotent.alreadyAttached, true);

      const overwrite = await attachCheckoutSessionIdToAttempt(
        owned.ok ? owned.attemptId : "",
        lpB,
      );
      assert.equal(overwrite.ok, false);
      if (!overwrite.ok) assert.equal(overwrite.reason, "already_set");

      await releasePosSpotHoldForPayment(
        available.id,
        owned.ok ? owned.attemptId : "",
      );
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
      const ids = await collectAttemptsByEmail("phase-c-other@example.com");
      assert.ok(ids.length >= 1);
      const otherAttempt = await getPaymentAttemptById(ids[0]!);
      assert.equal(otherAttempt?.status, "cancelled");
      assert.equal(
        otherAttempt?.failureReason,
        CANCEL_REASON_CARDCOM_SESSION_ATTACH_FAILED,
      );
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // 16–20: no completed sale, no events, no email side-effect, no sold POS, no real network
    assert.equal((await readEvents()).length, eventCountBefore);
    const soldFromPrep = (await readOrders()).filter(
      (o) =>
        createdAttemptIds.includes(o.orderId) &&
        (o.orderStatus === "sold" || o.orderStatus === "picked_up"),
    );
    assert.equal(soldFromPrep.length, 0);
    assert.notEqual((await getPosSpotById(available.id))?.status, "sold");
    assert.ok(networkCalls > 0, "mock was invoked");

    console.log(
      `verify-cardcom-create: ok (mocked Cardcom calls=${networkCalls}, no real network)`,
    );
  } finally {
    await releaseOwnedHold();
    for (const id of [...new Set(createdAttemptIds)]) {
      await deletePaymentAttemptById(id);
    }
    await setPosSpotStatus(available.id, beforeStatus);
  }
}

void main().catch((error) => {
  console.error("verify-cardcom-create: FAILED", error);
  process.exitCode = 1;
});

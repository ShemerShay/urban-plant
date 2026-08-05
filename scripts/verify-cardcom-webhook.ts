/**
 * Phase E verification: Cardcom webhook + mocked GetLpResult + DB finalization.
 * Never calls the real Cardcom API / Terminal 194476.
 *
 * Run: npx tsx scripts/verify-cardcom-webhook.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

async function main(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const {
    CardcomError,
    cardcomAmountsEqual,
    parseCardcomLowProfileResult,
  } = await import("../lib/cardcom");
  const { parseCardcomWebhookLowProfileResult } = await import(
    "../lib/cardcomWebhookParse"
  );
  const { readEvents } = await import("../lib/eventStorage");
  const { getOfferById } = await import("../lib/offerStorage");
  const {
    appendOrder,
    getOrderById,
    readOrders,
  } = await import("../lib/ordersStorage");
  const {
    acquirePosSpotHoldForPayment,
    getPosSpotById,
    readPosSpots,
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
  } = await import("../lib/posSpotStorage");
  const { processCardcomWebhook } = await import("../lib/processCardcomWebhook");
  const { sql } = await import("../lib/db");

  // --- Unit: webhook JSON parser (official LowProfileResult schema) ---
  assert.deepEqual(
    parseCardcomWebhookLowProfileResult({ LowProfileId: " abc " }),
    { lowProfileId: "abc", reported: {} },
  );
  assert.equal(parseCardcomWebhookLowProfileResult({ lowProfileId: "x" }), null);
  assert.equal(parseCardcomWebhookLowProfileResult({ Amount: 10 }), null);
  assert.equal(parseCardcomWebhookLowProfileResult("not-json-object"), null);
  assert.equal(parseCardcomWebhookLowProfileResult(null), null);

  const realisticWebhookBody = {
    ResponseCode: 0,
    Description: "The transaction was successful",
    TerminalNumber: 194476,
    LowProfileId: "f47b241e-1861-4cf8-a9a2-bf0c05f9f36d",
    TranzactionId: 209413394,
    ReturnValue: "11111111-1111-1111-1111-111111111111",
    Operation: "ChargeOnly",
    TranzactionInfo: {
      ResponseCode: 0,
      Description: "The transaction was successful",
      Amount: 89.5,
      CoinId: 1,
      TranzactionId: 209413394,
    },
  };
  const parsedWebhook = parseCardcomWebhookLowProfileResult(realisticWebhookBody);
  assert.ok(parsedWebhook);
  assert.equal(parsedWebhook!.lowProfileId, realisticWebhookBody.LowProfileId);
  assert.equal(parsedWebhook!.reported.responseCode, 0);
  assert.equal(parsedWebhook!.reported.terminalNumber, 194476);
  assert.equal(parsedWebhook!.reported.returnValue, realisticWebhookBody.ReturnValue);
  assert.equal(parsedWebhook!.reported.tranzactionId, 209413394);
  assert.equal(parsedWebhook!.reported.operation, "ChargeOnly");
  assert.equal(parsedWebhook!.reported.transactionResponseCode, 0);
  assert.equal(parsedWebhook!.reported.transactionAmount, 89.5);
  assert.equal(parsedWebhook!.reported.transactionCoinId, 1);

  // --- Unit: GetLpResult parser + amount compare ---
  assert.equal(cardcomAmountsEqual(10.5, 10.5), true);
  assert.equal(cardcomAmountsEqual(10.5, 10.51), false);
  assert.equal(cardcomAmountsEqual(10.5, 10.4), false);

  const sampleLp = randomUUID();
  const sampleOrderId = randomUUID();
  const parsedOk = parseCardcomLowProfileResult({
    ResponseCode: 0,
    Description: "OK",
    LowProfileId: sampleLp,
    ReturnValue: sampleOrderId,
    TranzactionInfo: {
      ResponseCode: 0,
      Amount: 89.5,
      CoinId: 1,
      TranzactionId: 123,
    },
  });
  assert.equal(parsedOk.lowProfileId, sampleLp);
  assert.equal(parsedOk.returnValue, sampleOrderId);
  assert.equal(parsedOk.transaction.amount, 89.5);
  assert.equal(parsedOk.transaction.coinId, 1);

  try {
    parseCardcomLowProfileResult({ ResponseCode: 0, LowProfileId: sampleLp });
    assert.fail("expected missing TranzactionInfo to throw");
  } catch (error) {
    assert.ok(error instanceof CardcomError);
  }

  // --- DB integration (mocked GetLpResult) ---
  const spots = await readPosSpots();
  const available = spots.find((s) => s.status === "available");
  if (!available) {
    console.log("verify-cardcom-webhook: skip DB (no available POS spot)");
    console.log("verify-cardcom-webhook: parser unit checks ok");
    return;
  }

  const offer = await getOfferById(available.currentOfferId);
  if (!offer || offer.status !== "active" || offer.consumerPrice <= 0) {
    console.log("verify-cardcom-webhook: skip DB (no valid offer)");
    return;
  }

  const beforeStatus = available.status;
  const street = TEL_AVIV_STREETS[0] ?? "רוטשילד";
  const createdIds: string[] = [];
  const eventCountBefore = (await readEvents()).length;
  let getLpCalls = 0;

  async function seedPending(input: {
    email: string;
    fulfillment: "delivery" | "pickup";
    lowProfileId: string;
    price?: number;
  }): Promise<{ orderId: string; price: number }> {
    await setPosSpotStatus(available!.id, "available");
    const orderId = randomUUID();
    const price = input.price ?? offer!.consumerPrice;
    const createdAt = new Date().toISOString();
    await appendOrder({
      orderId,
      checkoutSessionId: input.lowProfileId,
      posSpotId: available!.id,
      offerId: offer!.id,
      plantId: offer!.productId,
      plantName: "Webhook Verify Plant",
      locationId: available!.partnerLocationId,
      locationName: "Verify Partner",
      locationAddress: null,
      price,
      fullName: "Webhook Verify",
      customerEmail: input.email,
      phone: "0546605603",
      address: input.fulfillment === "delivery" ? `${street} 1` : "",
      apartmentOrNotes: "",
      fulfillmentMethod: input.fulfillment,
      createdAt,
      orderStatus: "pending_payment",
      source: "online",
      snapshot: {
        productId: offer!.productId,
        productName: "Webhook Verify Plant",
        productDescription: "verify",
        offerId: offer!.id,
        consumerPrice: price,
        posSpotId: available!.id,
        spotSlug: available!.spotSlug,
        fulfillmentType: input.fulfillment,
      },
    });
    createdIds.push(orderId);
    const hold = await acquirePosSpotHoldForPayment(available!.id);
    assert.equal(hold.ok, true);
    return { orderId, price };
  }

  function mockLp(result: {
    lowProfileId: string;
    returnValue: string;
    amount: number;
    coinId?: number;
    topCode?: number;
    txCode?: number;
    transactionId?: number;
    /** When set, ignore the requested id and return this LowProfileId instead. */
    respondAsLowProfileId?: string;
  }) {
    return async (id: string, _environment: string) => {
      getLpCalls += 1;
      void _environment;
      const responseId = result.respondAsLowProfileId ?? result.lowProfileId;
      if (!result.respondAsLowProfileId) {
        assert.equal(id, result.lowProfileId);
      }
      if (result.topCode !== undefined && result.topCode !== 0) {
        throw new CardcomError(
          `Cardcom GetLpResult failed (ResponseCode ${result.topCode}).`,
          "cardcom",
          { responseCode: result.topCode },
        );
      }
      const txId = result.transactionId ?? 209413394;
      return parseCardcomLowProfileResult({
        ResponseCode: 0,
        Description: "OK",
        LowProfileId: responseId,
        ReturnValue: result.returnValue,
        TranzactionId: txId,
        TranzactionInfo: {
          ResponseCode: result.txCode ?? 0,
          Amount: result.amount,
          CoinId: result.coinId ?? 1,
          TranzactionId: txId,
        },
      });
    };
  }

  /** Existing webhook tests do not exercise Documents/email — stub post-payment. */
  const skipDocumentEmail = {
    processDocumentAndEmail: async () => ({ outcome: "skipped" as const }),
  };

  try {
    // 2–3: webhook payload alone cannot finalize; GetLpResult always called
    {
      const lp = `lp-wh-${randomUUID()}`;
      const { orderId, price } = await seedPending({
        email: "wh-payload-only@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const callsBefore = getLpCalls;
      // Full LowProfileResult webhook with spoofed Amount/ReturnValue — ignored for finalize.
      const result = await processCardcomWebhook(
        {
          ResponseCode: 0,
          Description: "The transaction was successful",
          TerminalNumber: 194476,
          LowProfileId: lp,
          TranzactionId: 999001,
          ReturnValue: orderId,
          Operation: "ChargeOnly",
          TranzactionInfo: {
            ResponseCode: 0,
            Amount: 0.01,
            CoinId: 1,
          },
        },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
          }),
        },
      );
      assert.equal(getLpCalls, callsBefore + 1);
      assert.equal(result.outcome, "finalized");
      assert.equal((await getOrderById(orderId))?.orderStatus, "sold");
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // 4: LowProfileId mismatch (GetLpResult returns different id than requested)
    {
      const lpStored = `lp-mismatch-store-${randomUUID()}`;
      const lpVerified = `lp-mismatch-verified-${randomUUID()}`;
      const { orderId, price } = await seedPending({
        email: "wh-lp-mismatch@example.com",
        fulfillment: "delivery",
        lowProfileId: lpStored,
      });
      const result = await processCardcomWebhook(
        { LowProfileId: lpStored },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lpStored,
            respondAsLowProfileId: lpVerified,
            returnValue: orderId,
            amount: price,
          }),
        },
      );
      assert.equal(result.outcome, "ignored_verification");
      assert.equal(result.httpStatus, 200);
      assert.equal((await getOrderById(orderId))?.orderStatus, "pending_payment");
      assert.equal((await getPosSpotById(available.id))?.status, "held_for_payment");
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");
    }

    // 5: ReturnValue mismatch
    {
      const lp = `lp-rv-${randomUUID()}`;
      const { orderId, price } = await seedPending({
        email: "wh-rv@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: randomUUID(),
            amount: price,
          }),
        },
      );
      assert.equal(result.outcome, "ignored_verification");
      assert.equal((await getOrderById(orderId))?.orderStatus, "pending_payment");
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");
    }

    // 6: amount mismatch
    {
      const lp = `lp-amt-${randomUUID()}`;
      const { orderId, price } = await seedPending({
        email: "wh-amt@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price + 1,
          }),
        },
      );
      assert.equal(result.outcome, "ignored_verification");
      assert.equal((await getOrderById(orderId))?.orderStatus, "pending_payment");
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");
    }

    // 7: CoinId mismatch
    {
      const lp = `lp-coin-${randomUUID()}`;
      const { orderId, price } = await seedPending({
        email: "wh-coin@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
            coinId: 2,
          }),
        },
      );
      assert.equal(result.outcome, "ignored_verification");
      assert.equal((await getOrderById(orderId))?.orderStatus, "pending_payment");
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");
    }

    // 8–11: delivery + pickup finalization
    {
      const lp = `lp-del-${randomUUID()}`;
      const { orderId, price } = await seedPending({
        email: "wh-delivery@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
          }),
        },
      );
      assert.equal(result.outcome, "finalized");
      const order = await getOrderById(orderId);
      assert.equal(order?.orderStatus, "sold");
      assert.equal(order?.pickedUpAt, undefined);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    {
      const lp = `lp-pick-${randomUUID()}`;
      const { orderId, price } = await seedPending({
        email: "wh-pickup@example.com",
        fulfillment: "pickup",
        lowProfileId: lp,
      });
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
          }),
        },
      );
      assert.equal(result.outcome, "finalized");
      const order = await getOrderById(orderId);
      assert.equal(order?.orderStatus, "picked_up");
      assert.ok(order?.pickedUpAt);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // 12: duplicate webhook idempotent
    {
      const lp = `lp-dup-${randomUUID()}`;
      const { orderId, price } = await seedPending({
        email: "wh-dup@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const deps = {
        ...skipDocumentEmail,
        getLpResult: mockLp({
          lowProfileId: lp,
          returnValue: orderId,
          amount: price,
        }),
      };
      const first = await processCardcomWebhook({ LowProfileId: lp }, deps);
      const second = await processCardcomWebhook({ LowProfileId: lp }, deps);
      assert.equal(first.outcome, "finalized");
      assert.equal(second.outcome, "already_finalized");
      assert.equal(second.httpStatus, 200);
      const matches = (await readOrders()).filter(
        (o) => o.checkoutSessionId === lp,
      );
      assert.equal(matches.length, 1);
      await setPosSpotStatus(available.id, "available");
    }

    // 13: unknown LowProfileId
    {
      const result = await processCardcomWebhook(
        { LowProfileId: `lp-unknown-${randomUUID()}` },
        {
          ...skipDocumentEmail,
          getLpResult: async (id, _env) => {
            void _env;
            getLpCalls += 1;
            return parseCardcomLowProfileResult({
              ResponseCode: 0,
              LowProfileId: id,
              ReturnValue: randomUUID(),
              TranzactionInfo: { ResponseCode: 0, Amount: 10, CoinId: 1 },
            });
          },
        },
      );
      assert.equal(result.outcome, "ignored_unknown");
      assert.equal(result.httpStatus, 200);
    }

    // 14: cancelled order
    {
      const lp = `lp-cancel-${randomUUID()}`;
      const { orderId, price } = await seedPending({
        email: "wh-cancel@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      await sql`
        UPDATE orders
        SET order_status = 'cancelled',
            cancelled_at = now(),
            cancelled_by = 'system',
            cancellation_reason = 'verify_cancel'
        WHERE order_id = ${orderId}::uuid
      `;
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
          }),
        },
      );
      assert.equal(result.outcome, "ignored_cancelled");
      assert.equal((await getOrderById(orderId))?.orderStatus, "cancelled");
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");
    }

    // 15: malformed GetLpResult
    {
      const lp = `lp-malformed-${randomUUID()}`;
      const { orderId } = await seedPending({
        email: "wh-malformed@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: async () => {
            getLpCalls += 1;
            throw new CardcomError(
              "Cardcom GetLpResult returned a malformed response.",
              "parse",
            );
          },
        },
      );
      assert.equal(result.outcome, "ignored_verification");
      assert.equal(result.httpStatus, 200);
      assert.equal((await getOrderById(orderId))?.orderStatus, "pending_payment");
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");
    }

    // 16: network failure
    {
      const lp = `lp-net-${randomUUID()}`;
      const { orderId } = await seedPending({
        email: "wh-net@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: async () => {
            getLpCalls += 1;
            throw new CardcomError("Cardcom GetLpResult network error.", "network");
          },
        },
      );
      assert.equal(result.outcome, "upstream_error");
      assert.equal(result.httpStatus, 502);
      assert.equal((await getOrderById(orderId))?.orderStatus, "pending_payment");
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");
    }

    // 17–20: no events, no second order, no real network
    assert.equal((await readEvents()).length, eventCountBefore);
    assert.ok(getLpCalls > 0);

    console.log(
      `verify-cardcom-webhook: ok (mocked GetLpResult calls≈${getLpCalls}, no real network)`,
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
  console.error("verify-cardcom-webhook: FAILED", error);
  process.exitCode = 1;
});

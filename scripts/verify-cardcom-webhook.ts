/**
 * Phase E verification: Cardcom webhook + mocked GetLpResult + DB finalization.
 * Option B: payment_attempt correlation; Order created only on verified success.
 * Never calls the real Cardcom API / Terminal 194476.
 *
 * Run: npx tsx scripts/verify-cardcom-webhook.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const TEST_PUBLIC_ORIGIN = "https://urban-plant-webhook-verify.example.com";

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
    deletePaymentAttemptById,
    getPaymentAttemptById,
  } = await import("../lib/paymentAttemptStorage");
  const {
    getPosSpotById,
    readPosSpots,
    setPosSpotStatus,
  } = await import("../lib/posSpotStorage");
  const { processCardcomWebhook } = await import("../lib/processCardcomWebhook");
  const { startCardcomPaymentPrep } = await import("../lib/startCardcomPaymentPrep");
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
  const sampleAttemptId = randomUUID();
  const parsedOk = parseCardcomLowProfileResult({
    ResponseCode: 0,
    Description: "OK",
    LowProfileId: sampleLp,
    ReturnValue: sampleAttemptId,
    TranzactionInfo: {
      ResponseCode: 0,
      Amount: 89.5,
      CoinId: 1,
      TranzactionId: 123,
    },
  });
  assert.equal(parsedOk.lowProfileId, sampleLp);
  assert.equal(parsedOk.returnValue, sampleAttemptId);
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

  const offer = await getOfferById(available.currentOfferId ?? "");
  if (!offer || offer.status !== "active" || offer.consumerPrice <= 0) {
    console.log("verify-cardcom-webhook: skip DB (no valid offer)");
    return;
  }

  const beforeStatus = available.status;
  const street = TEL_AVIV_STREETS[0] ?? "רוטשילד";
  const createdAttemptIds: string[] = [];
  const createdOrderIds: string[] = [];
  const eventCountBefore = (await readEvents()).length;
  let getLpCalls = 0;

  async function seedAttempt(input: {
    email: string;
    fulfillment: "delivery" | "pickup";
    lowProfileId?: string;
  }): Promise<{ attemptId: string; price: number; lowProfileId: string }> {
    await setPosSpotStatus(available!.id, "available");
    const lp = input.lowProfileId ?? `lp-wh-${randomUUID()}`;
    const prep = await startCardcomPaymentPrep(
      {
        plantId: offer!.productId,
        spotSlug: available!.spotSlug,
        fullName: "Webhook Verify",
        customerEmail: input.email,
        phone: "0546605603",
        fulfillmentMethod: input.fulfillment,
        ...(input.fulfillment === "delivery"
          ? { deliveryStreet: street, deliveryHouseNumber: "1", apartmentOrNotes: "" }
          : { apartmentOrNotes: "" }),
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
    assert.equal(prep.ok, true, `prep should succeed for ${input.email}`);
    if (!prep.ok) throw new Error("prep failed");
    createdAttemptIds.push(prep.attemptId);
    assert.equal(prep.orderId, prep.attemptId);
    assert.equal(await getOrderById(prep.attemptId), null, "prep must not create Order");
    const attempt = await getPaymentAttemptById(prep.attemptId);
    assert.ok(attempt);
    assert.equal(attempt!.status, "awaiting_payment");
    assert.equal((await getPosSpotById(available!.id))?.status, "available");
    assert.equal(
      (await getPosSpotById(available!.id))?.paymentHoldAttemptId,
      undefined,
    );
    return {
      attemptId: prep.attemptId,
      price: attempt!.amount,
      lowProfileId: prep.lowProfileId,
    };
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

  async function releaseOwnedHold(): Promise<void> {
    const spot = await getPosSpotById(available!.id);
    if (spot?.status === "held_for_payment") {
      await setPosSpotStatus(available!.id, "available");
    }
  }

  try {
    // 2–3: webhook payload alone cannot finalize; GetLpResult always called
    {
      const lp = `lp-wh-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
        email: "wh-payload-only@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const callsBefore = getLpCalls;
      const result = await processCardcomWebhook(
        {
          ResponseCode: 0,
          Description: "The transaction was successful",
          TerminalNumber: 194476,
          LowProfileId: lp,
          TranzactionId: 999001,
          ReturnValue: attemptId,
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
            returnValue: attemptId,
            amount: price,
          }),
        },
      );
      assert.equal(getLpCalls, callsBefore + 1);
      assert.equal(result.outcome, "finalized");
      const attempt = await getPaymentAttemptById(attemptId);
      assert.equal(attempt?.status, "finalized");
      assert.ok(attempt?.finalizedOrderId);
      createdOrderIds.push(attempt!.finalizedOrderId!);
      const order = await getOrderById(attempt!.finalizedOrderId!);
      assert.equal(order?.orderStatus, "sold");
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      const ordersForSession = (await readOrders()).filter(
        (o) => o.checkoutSessionId === lp,
      );
      assert.equal(ordersForSession.length, 1);
      await setPosSpotStatus(available.id, "available");
    }

    // 4: LowProfileId mismatch (GetLpResult returns different id than requested)
    {
      const lpStored = `lp-mismatch-store-${randomUUID()}`;
      const lpVerified = `lp-mismatch-verified-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
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
            returnValue: attemptId,
            amount: price,
          }),
        },
      );
      assert.equal(result.outcome, "ignored_verification");
      assert.equal(result.httpStatus, 200);
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "awaiting_payment");
      assert.equal(await getOrderById(attemptId), null);
      assert.equal((await getPosSpotById(available.id))?.status, "available");
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // 5: ReturnValue mismatch
    {
      const lp = `lp-rv-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
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
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "awaiting_payment");
      assert.equal(await getOrderById(attemptId), null);
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // 6: amount mismatch
    {
      const lp = `lp-amt-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
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
            returnValue: attemptId,
            amount: price + 1,
          }),
        },
      );
      assert.equal(result.outcome, "ignored_verification");
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "awaiting_payment");
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // 7: CoinId mismatch
    {
      const lp = `lp-coin-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
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
            returnValue: attemptId,
            amount: price,
            coinId: 2,
          }),
        },
      );
      assert.equal(result.outcome, "ignored_verification");
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "awaiting_payment");
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // 8–11: delivery + pickup finalization
    {
      const lp = `lp-del-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
        email: "wh-delivery@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      assert.equal(await getOrderById(attemptId), null);
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: attemptId,
            amount: price,
          }),
        },
      );
      assert.equal(result.outcome, "finalized");
      const attempt = await getPaymentAttemptById(attemptId);
      assert.equal(attempt?.status, "finalized");
      assert.ok(attempt?.finalizedOrderId);
      createdOrderIds.push(attempt!.finalizedOrderId!);
      const order = await getOrderById(attempt!.finalizedOrderId!);
      assert.equal(order?.orderStatus, "sold");
      assert.equal(order?.pickedUpAt, undefined);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      const matches = (await readOrders()).filter((o) => o.checkoutSessionId === lp);
      assert.equal(matches.length, 1);
      await setPosSpotStatus(available.id, "available");
    }

    {
      const lp = `lp-pick-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
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
            returnValue: attemptId,
            amount: price,
          }),
        },
      );
      assert.equal(result.outcome, "finalized");
      const attempt = await getPaymentAttemptById(attemptId);
      assert.equal(attempt?.status, "finalized");
      assert.ok(attempt?.finalizedOrderId);
      createdOrderIds.push(attempt!.finalizedOrderId!);
      const order = await getOrderById(attempt!.finalizedOrderId!);
      assert.equal(order?.orderStatus, "picked_up");
      assert.ok(order?.pickedUpAt);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // 12: duplicate webhook idempotent
    {
      const lp = `lp-dup-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
        email: "wh-dup@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const deps = {
        ...skipDocumentEmail,
        getLpResult: mockLp({
          lowProfileId: lp,
          returnValue: attemptId,
          amount: price,
        }),
      };
      const first = await processCardcomWebhook({ LowProfileId: lp }, deps);
      const second = await processCardcomWebhook({ LowProfileId: lp }, deps);
      assert.equal(first.outcome, "finalized");
      assert.equal(second.outcome, "already_finalized");
      assert.equal(second.httpStatus, 200);
      const attempt = await getPaymentAttemptById(attemptId);
      assert.equal(attempt?.status, "finalized");
      assert.ok(attempt?.finalizedOrderId);
      createdOrderIds.push(attempt!.finalizedOrderId!);
      const matches = (await readOrders()).filter((o) => o.checkoutSessionId === lp);
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

    // 14: late success after expired attempt → needs_reconciliation, no Order
    {
      const lp = `lp-late-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
        email: "wh-late@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      await sql`
        UPDATE payment_attempts
        SET status = 'expired',
            failure_reason = 'verify_expired',
            updated_at = now()
        WHERE id = ${attemptId}::uuid
      `;
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");

      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: attemptId,
            amount: price,
          }),
        },
      );
      assert.equal(result.outcome, "needs_reconciliation");
      const attempt = await getPaymentAttemptById(attemptId);
      assert.equal(attempt?.status, "needs_reconciliation");
      assert.equal(attempt?.finalizedOrderId, undefined);
      assert.equal(await getOrderById(attemptId), null);
      const ordersForSession = (await readOrders()).filter(
        (o) => o.checkoutSessionId === lp,
      );
      assert.equal(ordersForSession.length, 0);
      assert.notEqual((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // 15: malformed GetLpResult
    {
      const lp = `lp-malformed-${randomUUID()}`;
      const { attemptId } = await seedAttempt({
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
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "awaiting_payment");
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // 16: network failure
    {
      const lp = `lp-net-${randomUUID()}`;
      const { attemptId } = await seedAttempt({
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
      assert.equal((await getPaymentAttemptById(attemptId))?.status, "awaiting_payment");
      await releaseOwnedHold();
      await setPosSpotStatus(available.id, "available");
    }

    // Legacy pending_order fallback: null hold owner + ReturnValue=orderId still finalizes
    {
      const lp = `lp-legacy-${randomUUID()}`;
      await setPosSpotStatus(available.id, "available");
      const orderId = randomUUID();
      const price = offer.consumerPrice;
      await appendOrder({
        orderId,
        checkoutSessionId: lp,
        posSpotId: available.id,
        offerId: offer.id,
        plantId: offer.productId,
        plantName: "Webhook Legacy Verify Plant",
        locationId: available.partnerLocationId,
        locationName: "Verify Partner",
        locationAddress: null,
        price,
        fullName: "Webhook Legacy Verify",
        customerEmail: "wh-legacy@example.com",
        phone: "0546605603",
        address: `${street} 1`,
        apartmentOrNotes: "",
        fulfillmentMethod: "delivery",
        createdAt: new Date().toISOString(),
        orderStatus: "pending_payment",
        source: "online",
        snapshot: {
          productId: offer.productId,
          productName: "Webhook Legacy Verify Plant",
          productDescription: "verify",
          offerId: offer.id,
          consumerPrice: price,
          posSpotId: available.id,
          spotSlug: available.spotSlug,
          fulfillmentType: "delivery",
        },
      });
      createdOrderIds.push(orderId);
      await sql`
        UPDATE pos_spots
        SET
          status = 'available',
          payment_hold_started_at = NULL,
          payment_hold_attempt_id = NULL
        WHERE id = ${available.id}::uuid
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
      assert.equal(result.outcome, "finalized");
      assert.equal((await getOrderById(orderId))?.orderStatus, "sold");
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // Finalization failure while the spot is still available stays retryable.
    {
      const lp = `lp-retryable-${randomUUID()}`;
      const { attemptId, price } = await seedAttempt({
        email: "wh-retryable@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const missingPartner = randomUUID();
      await sql`
        UPDATE payment_attempts
        SET snapshot = jsonb_set(
          COALESCE(snapshot, '{}'::jsonb),
          '{partnerLocationId}',
          to_jsonb(${missingPartner}::text),
          true
        )
        WHERE id = ${attemptId}::uuid
      `;
      const failed = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: attemptId,
            amount: price,
            transactionId: 910099,
          }),
        },
      );
      assert.equal(failed.httpStatus, 500);
      assert.equal(failed.outcome, "server_error");
      const stillAwaiting = await getPaymentAttemptById(attemptId);
      assert.equal(stillAwaiting?.status, "awaiting_payment");
      assert.equal(stillAwaiting?.cardcomTransactionId, undefined);
      assert.equal(
        (await readOrders()).filter((order) => order.checkoutSessionId === lp).length,
        0,
      );
      assert.equal((await getPosSpotById(available.id))?.status, "available");
    }

    // Two verified payments: one order, loser reconciled, spot sold once.
    {
      const lpWin = `lp-race-win-${randomUUID()}`;
      const lpLose = `lp-race-lose-${randomUUID()}`;
      const winner = await seedAttempt({
        email: "wh-race-win@example.com",
        fulfillment: "delivery",
        lowProfileId: lpWin,
      });
      const loser = await seedAttempt({
        email: "wh-race-lose@example.com",
        fulfillment: "delivery",
        lowProfileId: lpLose,
      });
      assert.equal((await getPosSpotById(available.id))?.status, "available");
      const win = await processCardcomWebhook(
        { LowProfileId: lpWin },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lpWin,
            returnValue: winner.attemptId,
            amount: winner.price,
            transactionId: 910001,
          }),
        },
      );
      assert.equal(win.outcome, "finalized");
      const winAttempt = await getPaymentAttemptById(winner.attemptId);
      assert.equal(winAttempt?.status, "finalized");
      assert.ok(winAttempt?.finalizedOrderId);
      createdOrderIds.push(winAttempt!.finalizedOrderId!);
      const lose = await processCardcomWebhook(
        { LowProfileId: lpLose },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lpLose,
            returnValue: loser.attemptId,
            amount: loser.price,
            transactionId: 910002,
          }),
        },
      );
      assert.equal(lose.outcome, "needs_reconciliation");
      const loseAttempt = await getPaymentAttemptById(loser.attemptId);
      assert.equal(loseAttempt?.status, "needs_reconciliation");
      assert.equal(loseAttempt?.cardcomTransactionId, 910002);
      assert.equal(loseAttempt?.finalizedOrderId, undefined);
      assert.equal(await getOrderById(loser.attemptId), null);
      const sessionOrders = (await readOrders()).filter(
        (order) =>
          order.checkoutSessionId === lpWin || order.checkoutSessionId === lpLose,
      );
      assert.equal(sessionOrders.length, 1);
      assert.equal(sessionOrders[0]?.checkoutSessionId, lpWin);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      const repeat = await processCardcomWebhook(
        { LowProfileId: lpWin },
        {
          ...skipDocumentEmail,
          getLpResult: mockLp({
            lowProfileId: lpWin,
            returnValue: winner.attemptId,
            amount: winner.price,
            transactionId: 910001,
          }),
        },
      );
      assert.equal(repeat.outcome, "already_finalized");
      await setPosSpotStatus(available.id, "available");
    }

    // 17–20: no events, no second order, no real network
    assert.equal((await readEvents()).length, eventCountBefore);
    assert.ok(getLpCalls > 0);

    console.log(
      `verify-cardcom-webhook: ok (mocked GetLpResult calls≈${getLpCalls}, no real network)`,
    );
  } finally {
    await releaseOwnedHold();
    // Attempts reference orders via finalized_order_id — delete attempts first.
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
  console.error("verify-cardcom-webhook: FAILED", error);
  process.exitCode = 1;
});

/**
 * Focused verification: Cardcom document + Urban Plant email post-payment flow.
 * Never calls real Cardcom Documents or Gmail — injects mocks.
 *
 * Run: npx tsx scripts/verify-cardcom-document-email.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const {
    buildCreateDocumentRequest,
    buildCreateDocumentUrlRequest,
    isPdfBuffer,
    parseCreateDocumentResponse,
  } = await import("../lib/cardcomDocuments");
  const { parseCardcomLowProfileResult } = await import("../lib/cardcom");
  const {
    buildPurchaseEmailHtml,
    PURCHASE_EMAIL_SUBJECT,
  } = await import("../lib/purchaseEmail");
  const {
    claimPurchaseEmailProcessing,
    getOrderById,
    appendOrder,
    markPurchaseEmailFailed,
  } = await import("../lib/ordersStorage");
  const { getOfferById } = await import("../lib/offerStorage");
  const {
    acquirePosSpotHoldForPayment,
    getPosSpotById,
    readPosSpots,
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
  } = await import("../lib/posSpotStorage");
  const { processCardcomWebhook } = await import("../lib/processCardcomWebhook");
  const { processOrderDocumentAndEmail } = await import(
    "../lib/processOrderDocumentAndEmail"
  );
  const { sql } = await import("../lib/db");

  // --- Unit: IsSendByEmail always false ---
  {
    const body = buildCreateDocumentRequest(
      {
        dealNumber: 209413394,
        name: "Test",
        email: "a@b.com",
        phone: "050",
        productDescription: "Plant",
        unitCost: 89.5,
        externalId: randomUUID(),
      },
      { ApiName: "n", ApiPassword: "p" },
    );
    const doc = body.Document as Record<string, unknown>;
    assert.equal(doc.IsSendByEmail, false);
    assert.equal(doc.DocumentTypeToCreate, "Auto");
  }

  // --- Unit: CreateDocumentUrl never accepts Auto ---
  {
    assert.throws(
      () =>
        buildCreateDocumentUrlRequest(
          { documentType: "Auto", documentNumber: 1 },
          { ApiName: "n", ApiPassword: "p" },
        ),
      /Auto/,
    );
    assert.throws(
      () =>
        buildCreateDocumentUrlRequest(
          { documentType: "auto", documentNumber: 1 },
          { ApiName: "n", ApiPassword: "p" },
        ),
      /Auto/,
    );
    const ok = buildCreateDocumentUrlRequest(
      { documentType: "TaxInvoiceAndReceipt", documentNumber: 593032 },
      { ApiName: "n", ApiPassword: "p" },
    );
    assert.equal(ok.DocumentType, "TaxInvoiceAndReceipt");
    assert.notEqual(ok.DocumentType, "Auto");
  }

  // --- Unit: parse CreateDocument rejects Auto resolved type ---
  {
    assert.throws(
      () =>
        parseCreateDocumentResponse({
          ResponseCode: 0,
          DocumentType: "Auto",
          DocumentNumber: 1,
        }),
      /Auto/,
    );
    const parsed = parseCreateDocumentResponse({
      ResponseCode: 0,
      DocumentType: "TaxInvoiceAndReceipt",
      DocumentNumber: 593032,
      DocumentUrl: "https://example.com/doc.pdf",
    });
    assert.equal(parsed.documentType, "TaxInvoiceAndReceipt");
    assert.equal(parsed.documentNumber, 593032);
  }

  // --- Unit: invalid PDF not accepted ---
  {
    assert.equal(isPdfBuffer(Buffer.from("not-a-pdf")), false);
    assert.equal(isPdfBuffer(Buffer.from("%PDF-1.4")), true);
  }

  // --- Unit: existing Urban Plant email copy unchanged ---
  {
    const routeSrc = readFileSync(
      path.join(root, "app/api/send-purchase-email/route.ts"),
      "utf8",
    );
    assert.ok(routeSrc.includes("sendPurchaseEmail"));
    assert.ok(!routeSrc.includes("buildEmailHtml"));

    const htmlPickup = buildPurchaseEmailHtml({
      fullName: "Ada",
      plantName: "Monstera",
      priceDisplay: "₪89",
      fulfillmentMethod: "pickup",
    });
    assert.ok(htmlPickup.includes("Thank you for your purchase from Urban Plant"));
    assert.ok(htmlPickup.includes("You may take the plant with you."));
    assert.ok(htmlPickup.includes("Order total:"));
    assert.ok(!htmlPickup.includes("direction:rtl"));

    const htmlPickupCare = buildPurchaseEmailHtml({
      fullName: "Ada",
      plantName: "Monstera",
      priceDisplay: "₪89",
      fulfillmentMethod: "pickup",
      careInstructions: [
        "Water when the top soil feels dry.",
        "",
        "  ",
      ],
    });
    assert.ok(htmlPickupCare.includes("השקו כשהאדמה העליונה מורגשת יבשה."));
    assert.ok(!htmlPickupCare.includes("Water when the top soil feels dry."));
    assert.ok(htmlPickupCare.includes("You may take the plant with you."));

    const htmlDelivery = buildPurchaseEmailHtml({
      fullName: "Ada",
      plantName: "Monstera",
      priceDisplay: "₪89",
      fulfillmentMethod: "delivery",
    });
    assert.ok(
      htmlDelivery.includes(
        "we’ll contact you within the next 1–3 business days to coordinate delivery",
      ),
    );
    assert.equal(PURCHASE_EMAIL_SUBJECT, "Your Urban Plant order is confirmed");

    const helperSrc = readFileSync(
      path.join(root, "lib/purchaseEmail.ts"),
      "utf8",
    );
    assert.ok(
      helperSrc.includes(
        "Thank you for your purchase from Urban Plant. Your order was received.",
      ),
    );
  }

  // --- DB integration ---
  const spots = await readPosSpots();
  const available = spots.find((s) => s.status === "available");
  if (!available) {
    console.log("verify-cardcom-document-email: skip DB (no available POS spot)");
    console.log("verify-cardcom-document-email: unit checks ok");
    return;
  }

  const offer = await getOfferById(available.currentOfferId);
  if (!offer || offer.status !== "active" || offer.consumerPrice <= 0) {
    console.log("verify-cardcom-document-email: skip DB (no valid offer)");
    return;
  }

  const beforeStatus = available.status;
  const street = TEL_AVIV_STREETS[0] ?? "רוטשילד";
  const createdIds: string[] = [];
  const pdfBytes = Buffer.from("%PDF-1.4 mock urban plant document");

  async function seedPending(input: {
    email: string;
    fulfillment: "delivery" | "pickup";
    lowProfileId: string;
    price?: number;
  }): Promise<{ orderId: string; price: number }> {
    await setPosSpotStatus(available!.id, "available");
    const orderId = randomUUID();
    const price = input.price ?? offer!.consumerPrice;
    await appendOrder({
      orderId,
      checkoutSessionId: input.lowProfileId,
      cardcomEnv: "test",
      posSpotId: available!.id,
      offerId: offer!.id,
      plantId: offer!.productId,
      plantName: "Document Email Verify Plant",
      locationId: available!.partnerLocationId,
      locationName: "Verify Partner",
      locationAddress: null,
      price,
      fullName: "Document Email Verify",
      customerEmail: input.email,
      phone: "0546605603",
      address: input.fulfillment === "delivery" ? `${street} 1` : "",
      apartmentOrNotes: "",
      fulfillmentMethod: input.fulfillment,
      createdAt: new Date().toISOString(),
      orderStatus: "pending_payment",
      source: "online",
      snapshot: {
        productId: offer!.productId,
        productName: "Document Email Verify Plant",
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
    transactionId: number;
  }) {
    return async (id: string) => {
      assert.equal(id, result.lowProfileId);
      return parseCardcomLowProfileResult({
        ResponseCode: 0,
        Description: "OK",
        LowProfileId: result.lowProfileId,
        ReturnValue: result.returnValue,
        TranzactionId: result.transactionId,
        TranzactionInfo: {
          ResponseCode: 0,
          Amount: result.amount,
          CoinId: 1,
          TranzactionId: result.transactionId,
        },
      });
    };
  }

  try {
    // 1: transaction ID stored only after verified payment
    {
      const lp = `lp-doc-tx-${randomUUID()}`;
      const txId = 700000001;
      const { orderId, price } = await seedPending({
        email: "doc-tx@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      assert.equal((await getOrderById(orderId))?.cardcomTransactionId, undefined);

      let createCalls = 0;
      let emailCalls = 0;
      const result = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
            transactionId: txId,
          }),
          documentEmailDeps: {
            createDocument: async (input) => {
              createCalls += 1;
              assert.equal(input.dealNumber, txId);
              assert.equal(input.externalId, orderId);
              return {
                documentType: "TaxInvoiceAndReceipt",
                documentNumber: 800001,
              };
            },
            fetchPdf: async () => ({
              bytes: pdfBytes,
              filename: "urban-plant-800001.pdf",
            }),
            sendEmail: async () => {
              emailCalls += 1;
              return { messageId: "mock-1" };
            },
          },
        },
      );
      assert.equal(result.outcome, "finalized");
      assert.equal(result.httpStatus, 200);
      const order = await getOrderById(orderId);
      assert.equal(order?.orderStatus, "sold");
      assert.equal(order?.cardcomTransactionId, txId);
      assert.equal(order?.purchaseEmailStatus, "sent");
      assert.ok(order?.purchaseEmailSentAt);
      assert.equal(order?.cardcomDocumentType, "TaxInvoiceAndReceipt");
      assert.equal(order?.cardcomDocumentNumber, 800001);
      assert.equal(createCalls, 1);
      assert.equal(emailCalls, 1);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // 2–3: duplicate webhook does not create two documents or send two emails
    {
      const lp = `lp-doc-dup-${randomUUID()}`;
      const txId = 700000002;
      const { orderId, price } = await seedPending({
        email: "doc-dup@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      let createCalls = 0;
      let emailCalls = 0;
      const deps = {
        getLpResult: mockLp({
          lowProfileId: lp,
          returnValue: orderId,
          amount: price,
          transactionId: txId,
        }),
        documentEmailDeps: {
          createDocument: async () => {
            createCalls += 1;
            return {
              documentType: "TaxInvoiceAndReceipt",
              documentNumber: 800002,
            };
          },
          fetchPdf: async () => ({
            bytes: pdfBytes,
            filename: "urban-plant-800002.pdf",
          }),
          sendEmail: async () => {
            emailCalls += 1;
            return { messageId: "mock-dup" };
          },
        },
      };
      const first = await processCardcomWebhook({ LowProfileId: lp }, deps);
      const second = await processCardcomWebhook({ LowProfileId: lp }, deps);
      assert.equal(first.outcome, "finalized");
      assert.equal(second.outcome, "already_finalized");
      assert.equal(createCalls, 1);
      assert.equal(emailCalls, 1);
      const order = await getOrderById(orderId);
      assert.equal(order?.purchaseEmailStatus, "sent");
      await setPosSpotStatus(available.id, "available");
    }

    // 4: concurrent processing uses atomic claim
    {
      const lp = `lp-doc-claim-${randomUUID()}`;
      const txId = 700000003;
      const { orderId, price } = await seedPending({
        email: "doc-claim@example.com",
        fulfillment: "pickup",
        lowProfileId: lp,
      });
      await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
            transactionId: txId,
          }),
          processDocumentAndEmail: async () => ({ outcome: "skipped" }),
        },
      );
      const order = await getOrderById(orderId);
      assert.equal(order?.orderStatus, "picked_up");
      assert.equal(order?.purchaseEmailStatus, "pending");
      assert.equal(order?.cardcomTransactionId, txId);

      const [a, b] = await Promise.all([
        claimPurchaseEmailProcessing(orderId),
        claimPurchaseEmailProcessing(orderId),
      ]);
      const winners = [a, b].filter((r) => r.ok);
      const losers = [a, b].filter((r) => !r.ok);
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 1);
      assert.equal(losers[0]?.reason, "busy");
      assert.equal((await getOrderById(orderId))?.purchaseEmailStatus, "processing");
      await markPurchaseEmailFailed(orderId, "test cleanup");
      await setPosSpotStatus(available.id, "available");
    }

    // 5: existing document is reused (no second CreateDocument)
    {
      const lp = `lp-doc-reuse-${randomUUID()}`;
      const txId = 700000004;
      const { orderId, price } = await seedPending({
        email: "doc-reuse@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      let createCalls = 0;
      let emailCalls = 0;
      await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
            transactionId: txId,
          }),
          processDocumentAndEmail: async () => ({ outcome: "skipped" }),
        },
      );
      await sql`
        UPDATE orders
        SET
          cardcom_document_type = 'TaxInvoiceAndReceipt',
          cardcom_document_number = 900001,
          purchase_email_status = 'failed',
          purchase_email_last_error = 'previous failure'
        WHERE order_id = ${orderId}::uuid
      `;

      const result = await processOrderDocumentAndEmail(orderId, {
        createDocument: async () => {
          createCalls += 1;
          throw new Error("CreateDocument must not be called when document exists");
        },
        fetchPdf: async (info) => {
          assert.equal(info.documentType, "TaxInvoiceAndReceipt");
          assert.equal(info.documentNumber, 900001);
          return { bytes: pdfBytes, filename: "reuse.pdf" };
        },
        sendEmail: async () => {
          emailCalls += 1;
          return { messageId: "reuse" };
        },
      });
      assert.equal(result.outcome, "sent");
      assert.equal(createCalls, 0);
      assert.equal(emailCalls, 1);
      assert.equal((await getOrderById(orderId))?.purchaseEmailStatus, "sent");
      await setPosSpotStatus(available.id, "available");
    }

    // 6: invalid PDF is not attached / sendEmail not called
    {
      const lp = `lp-doc-badpdf-${randomUUID()}`;
      const txId = 700000005;
      const { orderId, price } = await seedPending({
        email: "doc-badpdf@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      let emailCalls = 0;
      await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
            transactionId: txId,
          }),
          documentEmailDeps: {
            createDocument: async () => ({
              documentType: "TaxInvoiceAndReceipt",
              documentNumber: 800005,
            }),
            fetchPdf: async () => {
              throw new Error("Downloaded document is not a valid PDF.");
            },
            sendEmail: async () => {
              emailCalls += 1;
              return { messageId: "should-not" };
            },
          },
        },
      );
      const order = await getOrderById(orderId);
      assert.equal(order?.orderStatus, "sold");
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      assert.equal(order?.purchaseEmailStatus, "failed");
      assert.ok(order?.purchaseEmailLastError?.includes("PDF"));
      assert.equal(emailCalls, 0);
      assert.equal(order?.purchaseEmailSentAt, undefined);
      await setPosSpotStatus(available.id, "available");
    }

    // 7: document/email failure does not undo payment; failed can retry
    {
      const lp = `lp-doc-retry-${randomUUID()}`;
      const txId = 700000006;
      const { orderId, price } = await seedPending({
        email: "doc-retry@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      let createCalls = 0;
      let emailCalls = 0;
      let failOnce = true;

      await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: mockLp({
            lowProfileId: lp,
            returnValue: orderId,
            amount: price,
            transactionId: txId,
          }),
          documentEmailDeps: {
            createDocument: async () => {
              createCalls += 1;
              if (failOnce) {
                failOnce = false;
                throw new Error("CreateDocument temporary failure");
              }
              return {
                documentType: "TaxInvoiceAndReceipt",
                documentNumber: 800006,
              };
            },
            fetchPdf: async () => ({
              bytes: pdfBytes,
              filename: "retry.pdf",
            }),
            sendEmail: async (params) => {
              emailCalls += 1;
              assert.ok(params.attachments?.[0]?.contentType === "application/pdf");
              assert.ok(isPdfBuffer(params.attachments![0]!.content));
              return { messageId: "retry-ok" };
            },
          },
        },
      );

      let order = await getOrderById(orderId);
      assert.equal(order?.orderStatus, "sold");
      assert.equal(order?.purchaseEmailStatus, "failed");
      assert.equal(createCalls, 1);
      assert.equal(emailCalls, 0);

      const retry = await processOrderDocumentAndEmail(orderId, {
        createDocument: async () => {
          createCalls += 1;
          return {
            documentType: "TaxInvoiceAndReceipt",
            documentNumber: 800006,
          };
        },
        fetchPdf: async () => ({
          bytes: pdfBytes,
          filename: "retry.pdf",
        }),
        sendEmail: async () => {
          emailCalls += 1;
          return { messageId: "retry-ok" };
        },
      });
      assert.equal(retry.outcome, "sent");
      order = await getOrderById(orderId);
      assert.equal(order?.orderStatus, "sold");
      assert.equal(order?.purchaseEmailStatus, "sent");
      assert.ok(order?.purchaseEmailSentAt);
      assert.equal(order?.purchaseEmailLastError, undefined);
      assert.equal(createCalls, 2);
      assert.equal(emailCalls, 1);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");
      await setPosSpotStatus(available.id, "available");
    }

    // 8: email only after verified payment (pending order cannot claim)
    {
      const lp = `lp-doc-pending-${randomUUID()}`;
      const { orderId } = await seedPending({
        email: "doc-pending@example.com",
        fulfillment: "delivery",
        lowProfileId: lp,
      });
      const result = await processOrderDocumentAndEmail(orderId, {
        createDocument: async () => {
          throw new Error("must not create before paid");
        },
        sendEmail: async () => {
          throw new Error("must not email before paid");
        },
      });
      assert.equal(result.outcome, "skipped");
      assert.equal((await getOrderById(orderId))?.orderStatus, "pending_payment");
      await releasePosSpotHoldForPayment(available.id);
      await setPosSpotStatus(available.id, "available");
    }

    // 9: CreateDocument request uses IsSendByEmail false in live builder path
    {
      const auth = { ApiName: "n", ApiPassword: "p" };
      const req = buildCreateDocumentRequest(
        {
          dealNumber: 1,
          name: "N",
          email: "e@e.com",
          phone: "1",
          addressLine1: `${street} 2`,
          productDescription: "P",
          unitCost: 10,
          externalId: "ext",
        },
        auth,
      );
      assert.equal((req.Document as { IsSendByEmail: boolean }).IsSendByEmail, false);
    }

    console.log("verify-cardcom-document-email: ok");
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
  console.error("verify-cardcom-document-email: FAILED", error);
  process.exitCode = 1;
});

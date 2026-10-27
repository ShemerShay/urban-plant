/**
 * Catalog post-payment Cardcom document + customer email.
 * Mocked Cardcom and mail only. Does not call the live terminal or Gmail.
 *
 * Run against an isolated Neon child (not dev-partner-page or production):
 * npx tsx scripts/verify-catalog-post-payment.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const root = process.cwd();
const TEST_PUBLIC_ORIGIN = "https://urban-plant-catalog-post-payment-verify.example.com";

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertSources(): void {
  const finalize = read("lib/finalizeCatalogPayment.ts");
  assert.doesNotMatch(finalize, /processOrderDocumentAndEmail|createCardcomDocument|sendPurchaseEmail/);
  assert.doesNotMatch(finalize, /supplier_price/);

  const webhook = read("lib/processCardcomWebhook.ts");
  assert.match(webhook, /runPostPaymentDocumentEmail\(finalized\.orderId, deps\)/);
  assert.doesNotMatch(webhook, /channel !== "catalog"/);

  const processor = read("lib/processOrderDocumentAndEmail.ts");
  assert.match(processor, /flower_no_customer_email/);
  assert.match(processor, /getOrderItemsByOrderId/);
  assert.match(processor, /buildCatalogDocumentProducts/);
  assert.doesNotMatch(processor, /supplier_price|catalog_price/);

  const documents = read("lib/cardcomDocuments.ts");
  assert.match(documents, /IsSendByEmail: false/);
  assert.doesNotMatch(documents, /IsSendByEmail: true/);

  console.log("verify-catalog-post-payment: source boundaries ok");
}

async function main(): Promise<void> {
  assertSources();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const dbHost = new URL(process.env.DATABASE_URL ?? "http://invalid").hostname;
  if (dbHost.includes("snowy-credit") || dbHost.includes("twilight-truth")) {
    throw new Error(
      "Refusing to run catalog post-payment verification against dev-partner-page or production",
    );
  }
  console.log(`verify-catalog-post-payment: database host ${dbHost}`);

  const { parseCardcomLowProfileResult } = await import("../lib/cardcom");
  const { buildCreateDocumentRequest } = await import("../lib/cardcomDocuments");
  type CreateCardcomDocumentInput = Parameters<typeof buildCreateDocumentRequest>[0];
  const {
    buildCatalogDocumentProducts,
    catalogCustomerProductLabel,
  } = await import("../lib/catalogDocumentLines");
  const { sql } = await import("../lib/db");
  const { formatPrice } = await import("../lib/mockPlants");
  const { getOrderById } = await import("../lib/ordersStorage");
  const { getOrderItemsByOrderId } = await import("../lib/orderItemStorage");
  const { buildPurchaseEmailHtml } = await import("../lib/purchaseEmail");
  const { getPaymentAttemptById } = await import("../lib/paymentAttemptStorage");
  const { startCatalogCardcomPayment } = await import("../lib/catalogPaymentPrep");
  const { createPotSize, createPotColor } = await import("../lib/potSizeStorage");
  const { applyPotInventoryDelta } = await import("../lib/potInventoryStorage");
  const { createSellableVariant } = await import("../lib/sellableVariantStorage");
  const { createOrReusePlantOffer } = await import("../lib/offerStorage");
  const { processCardcomWebhook } = await import("../lib/processCardcomWebhook");

  const holdTable = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'order_items'
  `;
  assert.equal((holdTable as unknown[]).length, 1, "order_items migration is required on this branch");

  {
    const products = buildCatalogDocumentProducts(
      [
        {
          plantName: "Monstera",
          potName: null,
          quantity: 1,
          unitPrice: 40,
          lineTotal: 40,
        },
        {
          plantName: "Pothos",
          potName: "Clay",
          quantity: 2,
          unitPrice: 55,
          lineTotal: 110,
        },
      ],
      150,
    );
    assert.deepEqual(products, [
      { description: "Monstera", quantity: 1, unitCost: 40 },
      { description: "Pothos (Clay)", quantity: 2, unitCost: 55 },
    ]);
    const auth = { ApiName: "n", ApiPassword: "p" };
    const noEmail = buildCreateDocumentRequest(
      {
        dealNumber: 1,
        name: "Ada",
        phone: "0546605603",
        productDescription: "Urban Plant (2 items)",
        unitCost: 150,
        products,
        externalId: "order-1",
      },
      auth,
    );
    const noEmailDoc = noEmail.Document as Record<string, unknown>;
    assert.equal(noEmailDoc.IsSendByEmail, false);
    assert.equal("Email" in noEmailDoc, false);
    assert.deepEqual(noEmailDoc.Products, [
      { Description: "Monstera", Quantity: 1, UnitCost: 40 },
      { Description: "Pothos (Clay)", Quantity: 2, UnitCost: 55 },
    ]);
    const withEmail = buildCreateDocumentRequest(
      {
        dealNumber: 1,
        name: "Ada",
        email: "buyer@example.com",
        phone: "0546605603",
        productDescription: "ignored",
        unitCost: 1,
        products,
        externalId: "order-1",
      },
      auth,
    );
    const withEmailDoc = withEmail.Document as Record<string, unknown>;
    assert.equal(withEmailDoc.IsSendByEmail, false);
    assert.equal(withEmailDoc.Email, "buyer@example.com");
    const single = buildCreateDocumentRequest(
      {
        dealNumber: 1,
        name: "Ada",
        phone: "",
        productDescription: "Plant",
        unitCost: 10,
        externalId: "pos-1",
      },
      auth,
    );
    assert.deepEqual((single.Document as { Products: unknown }).Products, [
      { Description: "Plant", Quantity: 1, UnitCost: 10 },
    ]);
    assert.throws(
      () =>
        buildCatalogDocumentProducts(
          [
            {
              plantName: "Monstera",
              potName: null,
              quantity: 1,
              unitPrice: 40,
              lineTotal: 40,
            },
          ],
          41,
        ),
      /finalized order total/,
    );
    const storedName = buildPurchaseEmailHtml({
      fullName: "דנה",
      plantName: catalogCustomerProductLabel([
        { plantName: "מונסטרה", potName: null, quantity: 1 },
      ]),
      priceDisplay: "₪40",
      fulfillmentMethod: "delivery",
    });
    assert.ok(storedName.includes("דנה"));
    assert.ok(storedName.includes("מונסטרה"));
    assert.ok(storedName.includes('dir="ltr"'));
    assert.ok(storedName.includes("Thank you for your purchase from Urban Plant"));
    assert.ok(storedName.includes("we’ll contact you within the next 1–3 business days"));
    assert.ok(!storedName.includes("direction:rtl"));

    const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
    const catalogHtml = buildPurchaseEmailHtml({
      fullName: "Dana",
      plantName: "Monstera Deliciosa, Golden Pothos + White Pot x 2",
      priceDisplay: "₪95",
      fulfillmentMethod: "delivery",
      orderLines: [
        { plantName: "Monstera Deliciosa", potName: null, quantity: 1 },
        { plantName: "Golden Pothos", potName: "White Pot", quantity: 2 },
      ],
      careSections: [
        {
          plantName: "Monstera Deliciosa",
          careInstructions: ["Water when the top soil feels dry."],
        },
        {
          plantName: "Golden Pothos",
          careInstructions: ["Rotate weekly for even growth."],
        },
      ],
    });
    assert.equal(count(catalogHtml, "Hi Dana,"), 1);
    assert.equal(count(catalogHtml, "Thank you for your purchase from Urban Plant"), 1);
    assert.equal(count(catalogHtml, "Order summary:"), 1);
    assert.ok(catalogHtml.includes("Monstera Deliciosa × 1"));
    assert.ok(catalogHtml.includes("Golden Pothos + White Pot × 2"));
    assert.ok(!catalogHtml.includes("Monstera Deliciosa, Golden Pothos"));
    assert.equal(
      count(
        catalogHtml,
        "We’ll contact you within the next 1–3 business days to coordinate delivery.",
      ),
      1,
    );
    assert.equal(count(catalogHtml, "Care instructions"), 1);
    assert.equal(count(catalogHtml, "<strong>Monstera Deliciosa</strong>"), 1);
    assert.equal(count(catalogHtml, "<strong>Golden Pothos</strong>"), 1);
    assert.equal(count(catalogHtml, "Water when the top soil feels dry."), 1);
    assert.equal(count(catalogHtml, "Rotate weekly for even growth."), 1);
    assert.equal(count(catalogHtml, "Order total:"), 1);
    assert.equal(count(catalogHtml, "— Urban Plant"), 1);
    assert.ok(catalogHtml.indexOf("Order summary:") < catalogHtml.indexOf("Monstera Deliciosa × 1"));
    assert.ok(
      catalogHtml.indexOf("Monstera Deliciosa × 1") <
        catalogHtml.indexOf("Golden Pothos + White Pot × 2"),
    );
    assert.ok(
      catalogHtml.indexOf("Golden Pothos + White Pot × 2") <
        catalogHtml.indexOf("We’ll contact you"),
    );
    assert.ok(catalogHtml.indexOf("We’ll contact you") < catalogHtml.indexOf("Care instructions"));
    assert.ok(
      catalogHtml.indexOf("Care instructions") <
        catalogHtml.indexOf("<strong>Monstera Deliciosa</strong>"),
    );
    assert.ok(
      catalogHtml.indexOf("<strong>Monstera Deliciosa</strong>") <
        catalogHtml.indexOf("<strong>Golden Pothos</strong>"),
    );
    assert.ok(catalogHtml.indexOf("<strong>Golden Pothos</strong>") < catalogHtml.indexOf("Order total:"));
    assert.ok(catalogHtml.includes('dir="ltr"'));
    assert.ok(!catalogHtml.includes("direction:rtl"));

    const oneLineHtml = buildPurchaseEmailHtml({
      fullName: "Dana",
      plantName: "Monstera Deliciosa",
      priceDisplay: "₪40",
      fulfillmentMethod: "pickup",
      orderLines: [{ plantName: "Monstera Deliciosa", potName: null, quantity: 1 }],
      careSections: [
        {
          plantName: "Monstera Deliciosa",
          careInstructions: ["Water when the top soil feels dry."],
        },
      ],
    });
    assert.equal(count(oneLineHtml, "Order summary:"), 1);
    assert.ok(oneLineHtml.includes("Monstera Deliciosa × 1"));
    assert.equal(count(oneLineHtml, "You may take the plant with you."), 1);
    assert.equal(count(oneLineHtml, "Care instructions"), 1);
    assert.equal(count(oneLineHtml, "— Urban Plant"), 1);

    const repeatedPlantHtml = buildPurchaseEmailHtml({
      fullName: "Dana",
      plantName: "Monstera Deliciosa, Monstera Deliciosa (Clay) x 2",
      priceDisplay: "₪150",
      fulfillmentMethod: "delivery",
      orderLines: [
        { plantName: "Monstera Deliciosa", potName: null, quantity: 1 },
        { plantName: "Monstera Deliciosa", potName: "Clay", quantity: 2 },
      ],
      careSections: [
        {
          plantName: "Monstera Deliciosa",
          careInstructions: ["Water when the top soil feels dry."],
        },
      ],
    });
    assert.ok(repeatedPlantHtml.includes("Monstera Deliciosa × 1"));
    assert.ok(repeatedPlantHtml.includes("Monstera Deliciosa + Clay × 2"));
    assert.ok(!repeatedPlantHtml.includes("Monstera Deliciosa, Monstera Deliciosa"));
    assert.ok(!repeatedPlantHtml.includes("(Clay)"));
    assert.equal(count(repeatedPlantHtml, "<strong>Monstera Deliciosa</strong>"), 1);
    assert.equal(count(repeatedPlantHtml, "Water when the top soil feels dry."), 1);
  }

  const tag = randomUUID().slice(0, 8);
  const plantId = `cat-doc-${tag}`;
  const plantId2 = `cat-doc-b-${tag}`;
  const originalName = `Catalog Post ${tag}`;
  const secondName = `Catalog Fern ${tag}`;
  const careA = "Water when the top soil feels dry.";
  const careB = "Rotate weekly for even growth.";
  const variantA = randomUUID();
  const variantB = randomUUID();
  const variantC = randomUUID();
  const potId = randomUUID();
  const street = TEL_AVIV_STREETS[0] ?? "Rothschild Blvd";
  const phone = "0546605603";
  const attemptIds: string[] = [];
  const orderIds: string[] = [];
  let documentSeq = 930000;

  const posBefore = await sql`
    SELECT id, status, payment_hold_attempt_id
    FROM pos_spots
    ORDER BY id
  `;

  async function inventoryQty(variantId: string): Promise<number> {
    const rows = await sql`
      SELECT quantity FROM inventory WHERE variant_id = ${variantId}::uuid
    `;
    return Number((rows as { quantity: string | number }[])[0]?.quantity ?? 0);
  }

  async function holdStatus(attemptId: string): Promise<string | null> {
    const rows = await sql`
      SELECT status FROM catalog_stock_holds WHERE attempt_id = ${attemptId}::uuid
    `;
    return (rows as { status: string }[])[0]?.status ?? null;
  }

  function customer(email: string, emailOptIn: boolean) {
    return {
      fullName: "Catalog Buyer",
      phone,
      emailOptIn,
      ...(emailOptIn ? { customerEmail: email } : {}),
      deliveryStreet: street,
      deliveryHouseNumber: "12",
      apartmentOrNotes: "2",
    };
  }

  function verifiedLp(input: {
    lowProfileId: string;
    attemptId: string;
    amount: number;
    transactionId: number;
  }) {
    return parseCardcomLowProfileResult({
      ResponseCode: 0,
      Description: "OK",
      LowProfileId: input.lowProfileId,
      ReturnValue: input.attemptId,
      TranzactionId: input.transactionId,
      TranzactionInfo: {
        ResponseCode: 0,
        Amount: input.amount,
        CoinId: 1,
        TranzactionId: input.transactionId,
      },
    });
  }

  type MailCapture = {
    customerEmail: string;
    fullName: string;
    plantName: string;
    priceDisplay: string;
    fulfillmentMethod: string;
    careInstructions?: string[];
    careSections?: { plantName: string; careInstructions: string[] }[];
    orderLines?: { plantName: string; potName?: string | null; quantity: number }[];
    attachments?: { filename: string; content: Buffer; contentType: string }[];
  };

  function renderCustomerHtml(mail: MailCapture): string {
    return buildPurchaseEmailHtml({
      fullName: mail.fullName,
      plantName: mail.plantName,
      priceDisplay: mail.priceDisplay,
      fulfillmentMethod: mail.fulfillmentMethod === "pickup" ? "pickup" : "delivery",
      careInstructions: mail.careInstructions,
      careSections: mail.careSections,
      orderLines: mail.orderLines,
    });
  }

  function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  async function startLines(
    lines: {
      plantId: string;
      plantSizeId: string;
      sellableVariantId: string;
      offerId: string;
      potColorId: string | null;
      quantity: number;
      unitPrice: number;
    }[],
    email: string,
    emailOptIn: boolean,
  ): Promise<{ attemptId: string; lowProfileId: string }> {
    const lowProfileId = `lp-cat-doc-${randomUUID()}`;
    const started = await startCatalogCardcomPayment(
      { lines, ...customer(email, emailOptIn) },
      {
        publicOrigin: TEST_PUBLIC_ORIGIN,
        cardcomEnvironment: "test",
        createLowProfile: async () => ({
          ResponseCode: 0,
          Description: "OK",
          LowProfileId: lowProfileId,
          Url: `https://secure.cardcom.solutions/Interface/LowProfile.aspx?LowProfileId=${lowProfileId}`,
        }),
      },
    );
    assert.equal(started.ok, true);
    if (!started.ok) throw new Error("catalog checkout should start");
    attemptIds.push(started.attemptId);
    return { attemptId: started.attemptId, lowProfileId };
  }

  try {
    await sql`
      INSERT INTO plants (
        id, name, name_he, subtitle, description, supplier_price, currency,
        images, labels, light, water, location, pet_friendly,
        care_instructions, inventory_type, catalog_published, created_at
      )
      VALUES (
        ${plantId}, ${originalName}, 'צמח', 'Verify subtitle', 'Verify description',
        18.50, 'ILS', '["https://example.com/catalog-doc.jpg"]'::jsonb, '["verify"]'::jsonb,
        'Low light', 'Moderate', 'Indoor', false,
        ${JSON.stringify(["Water when the top soil feels dry."])}::jsonb,
        'plants', true, now()
      )
    `;
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label)
      VALUES
        (${variantA}::uuid, ${plantId}, 'M'),
        (${variantB}::uuid, ${plantId}, 'S')
    `;
    await sql`
      INSERT INTO pots (id, name, name_he, image)
      VALUES (${potId}::uuid, ${`Pot ${tag}`}, 'עציץ', '/plant-library/catalog-pay-pot.jpg')
    `;
    await sql`
      INSERT INTO plants (
        id, name, name_he, subtitle, description, supplier_price, currency,
        images, labels, light, water, location, pet_friendly,
        care_instructions, inventory_type, catalog_published, created_at
      )
      VALUES (
        ${plantId2}, ${secondName}, 'שרך', 'Second plant', 'Second description',
        12, 'ILS', '["https://example.com/catalog-doc-b.jpg"]'::jsonb, '["verify"]'::jsonb,
        'Low light', 'Moderate', 'Indoor', true,
        ${JSON.stringify([careB])}::jsonb,
        'plants', true, now()
      )
    `;
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label)
      VALUES (${variantC}::uuid, ${plantId2}, 'S')
    `;
    await sql`
      INSERT INTO inventory (variant_id, quantity, updated_at)
      VALUES
        (${variantA}::uuid, 20, now()),
        (${variantB}::uuid, 10, now()),
        (${variantC}::uuid, 6, now())
    `;
    const potSize = await createPotSize({ potId, sizeLabel: "M", supplierPrice: 12 });
    const colorM = await createPotColor({
      potId,
      sizeId: potSize.id,
      color: `clay-${tag}`,
      colorHe: "חרס",
    });
    await applyPotInventoryDelta({
      potId,
      sizeId: potSize.id,
      potColorId: colorM.id,
      delta: 8,
      note: `${tag} color`,
    });
    const noPotA = await createSellableVariant({ plantId, plantSizeId: variantA, potSizeId: null });
    const withPotA = await createSellableVariant({
      plantId,
      plantSizeId: variantA,
      potSizeId: potSize.id,
    });
    const noPotB = await createSellableVariant({ plantId, plantSizeId: variantB, potSizeId: null });
    const noPotC = await createSellableVariant({ plantId: plantId2, plantSizeId: variantC, potSizeId: null });
    const offerA = await createOrReusePlantOffer({
      sellableVariantId: noPotA.sellableVariantId,
      consumerPrice: 40,
      availabilities: [{ scope: "catalog" }],
    });
    const offerPot = await createOrReusePlantOffer({
      sellableVariantId: withPotA.sellableVariantId,
      consumerPrice: 55,
      availabilities: [{ scope: "catalog" }],
    });
    const offerB = await createOrReusePlantOffer({
      sellableVariantId: noPotB.sellableVariantId,
      consumerPrice: 55,
      availabilities: [{ scope: "catalog" }],
    });
    const offerC = await createOrReusePlantOffer({
      sellableVariantId: noPotC.sellableVariantId,
      consumerPrice: 55,
      availabilities: [{ scope: "catalog" }],
    });

    const lineA = {
      plantId,
      plantSizeId: variantA,
      sellableVariantId: noPotA.sellableVariantId,
      offerId: offerA.offer.id,
      potColorId: null as string | null,
      quantity: 1,
      unitPrice: 40,
    };
    const linePot = {
      plantId,
      plantSizeId: variantA,
      sellableVariantId: withPotA.sellableVariantId,
      offerId: offerPot.offer.id,
      potColorId: colorM.id,
      quantity: 2,
      unitPrice: 55,
    };
    const lineB = {
      plantId,
      plantSizeId: variantB,
      sellableVariantId: noPotB.sellableVariantId,
      offerId: offerB.offer.id,
      potColorId: null as string | null,
      quantity: 1,
      unitPrice: 55,
    };

    // 1. No customer email: one document, no PDF email, skipped.
    {
      const started = await startLines([lineA], "", false);
      await sql`
        UPDATE plants
        SET name = 'LIVE RENAME', supplier_price = 99
        WHERE id = ${plantId}
      `;
      const created: CreateCardcomDocumentInput[] = [];
      let pdfCalls = 0;
      let emailCalls = 0;
      const internalNames: string[] = [];
      let lpCalls = 0;
      const txId = 89001;
      const deps = {
        createDocument: async (input: CreateCardcomDocumentInput) => {
          created.push(input);
          documentSeq += 1;
          return { documentType: "TaxInvoiceAndReceipt", documentNumber: documentSeq };
        },
        fetchPdf: async () => {
          pdfCalls += 1;
          return { bytes: Buffer.from("%PDF-1.4\n"), filename: "should-not.pdf" };
        },
        sendEmail: async () => {
          emailCalls += 1;
          return { messageId: "should-not" };
        },
        sendInternalNotification: async (input: { plantName: string }) => {
          internalNames.push(input.plantName);
          return { messageId: "internal" };
        },
        loadPlant: async () => {
          throw new Error("no-email catalog must not load care instructions");
        },
      };
      const webhook = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () => {
            lpCalls += 1;
            return verifiedLp({
              lowProfileId: started.lowProfileId,
              attemptId: started.attemptId,
              amount: 40,
              transactionId: txId,
            });
          },
          documentEmailDeps: deps,
        },
      );
      assert.equal(webhook.outcome, "finalized");
      assert.equal(created.length, 1);
      assert.equal(pdfCalls, 0);
      assert.equal(emailCalls, 0);
      assert.deepEqual(internalNames, [originalName]);
      const request = buildCreateDocumentRequest(created[0]!, {
        ApiName: "n",
        ApiPassword: "p",
      });
      const document = request.Document as Record<string, unknown>;
      assert.equal(document.IsSendByEmail, false);
      assert.equal("Email" in document, false);
      assert.deepEqual(document.Products, [
        { Description: originalName, Quantity: 1, UnitCost: 40 },
      ]);
      const attempt = await getPaymentAttemptById(started.attemptId);
      assert.equal(attempt?.status, "finalized");
      assert.ok(attempt?.finalizedOrderId);
      orderIds.push(attempt.finalizedOrderId);
      const order = await getOrderById(attempt.finalizedOrderId);
      assert.equal(order?.orderStatus, "sold");
      assert.equal(order?.channel, "catalog");
      assert.equal(order?.price, 40);
      assert.equal(order?.customerEmail, undefined);
      assert.equal(order?.purchaseEmailStatus, "skipped");
      assert.equal(order?.purchaseEmailSentAt, undefined);
      assert.equal(order?.cardcomDocumentType, "TaxInvoiceAndReceipt");
      assert.equal(order?.cardcomDocumentNumber, documentSeq);
      assert.equal(await inventoryQty(variantA), 19);
      assert.equal(await holdStatus(started.attemptId), "consumed");
      const items = await getOrderItemsByOrderId(attempt.finalizedOrderId);
      assert.equal(items.length, 1);
      assert.equal(items[0]?.plantName, originalName);
      assert.equal(items[0]?.plantUnitCost, 18.5);

      const duplicate = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () => {
            lpCalls += 1;
            throw new Error("duplicate webhook must not verify again");
          },
          documentEmailDeps: deps,
        },
      );
      assert.equal(duplicate.outcome, "already_finalized");
      assert.equal(lpCalls, 1);
      assert.equal(created.length, 1);
      assert.equal(emailCalls, 0);
      assert.equal(pdfCalls, 0);
      assert.equal((await getOrderById(attempt.finalizedOrderId))?.purchaseEmailStatus, "skipped");
      assert.equal(await inventoryQty(variantA), 19);

      await sql`UPDATE plants SET name = ${originalName}, supplier_price = 18.50 WHERE id = ${plantId}`;
    }

    // 2. Opt-in multi-line: one document, one PDF email, total equals the order.
    {
      const email = `buy-${tag}@example.com`;
      const started = await startLines([lineA, linePot], email, true);
      await sql`UPDATE plants SET supplier_price = 99, name = 'LIVE RENAME' WHERE id = ${plantId}`;
      const created: CreateCardcomDocumentInput[] = [];
      const mails: MailCapture[] = [];
      let pdfCalls = 0;
      const txId = 89002;
      const deps = {
        createDocument: async (input: CreateCardcomDocumentInput) => {
          created.push(input);
          documentSeq += 1;
          return {
            documentType: "TaxInvoiceAndReceipt",
            documentNumber: documentSeq,
            documentUrl: "https://example.com/catalog.pdf",
          };
        },
        fetchPdf: async () => {
          pdfCalls += 1;
          return { bytes: Buffer.from("%PDF-1.4\ncatalog\n"), filename: "catalog.pdf" };
        },
        sendEmail: async (input: MailCapture) => {
          mails.push(input);
          return { messageId: "customer-1" };
        },
        sendInternalNotification: async () => ({ messageId: "internal" }),
      };
      const webhook = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () =>
            verifiedLp({
              lowProfileId: started.lowProfileId,
              attemptId: started.attemptId,
              amount: 150,
              transactionId: txId,
            }),
          documentEmailDeps: deps,
        },
      );
      assert.equal(webhook.outcome, "finalized");
      assert.equal(created.length, 1);
      assert.equal(pdfCalls, 1);
      assert.equal(mails.length, 1);
      const request = buildCreateDocumentRequest(created[0]!, {
        ApiName: "n",
        ApiPassword: "p",
      });
      const document = request.Document as {
        IsSendByEmail: boolean;
        Email?: string;
        Products: { Description: string; Quantity: number; UnitCost: number }[];
      };
      assert.equal(document.IsSendByEmail, false);
      assert.equal(document.Email, email);
      assert.deepEqual(document.Products, [
        { Description: originalName, Quantity: 1, UnitCost: 40 },
        { Description: `${originalName} (Pot ${tag})`, Quantity: 2, UnitCost: 55 },
      ]);
      const documentTotal = document.Products.reduce(
        (sum, line) => sum + line.Quantity * line.UnitCost,
        0,
      );
      assert.equal(documentTotal, 150);
      assert.ok(!document.Products.some((line) => line.Description.includes("Urban Plant (2 items)")));
      assert.ok(!document.Products.some((line) => line.UnitCost === 99 || line.UnitCost === 999));

      const attempt = await getPaymentAttemptById(started.attemptId);
      assert.ok(attempt?.finalizedOrderId);
      orderIds.push(attempt.finalizedOrderId);
      const order = await getOrderById(attempt.finalizedOrderId);
      assert.equal(order?.plantName, "Urban Plant (2 items)");
      assert.equal(order?.price, 150);
      assert.equal(order?.purchaseEmailStatus, "sent");
      assert.ok(order?.purchaseEmailSentAt);
      assert.equal(order?.cardcomDocumentNumber, documentSeq);
      assert.equal(order?.orderStatus, "sold");
      const items = await getOrderItemsByOrderId(attempt.finalizedOrderId);
      assert.equal(items.length, 2);
    assert.equal(items[0]?.unitPrice, 40);
    assert.equal(items[0]?.potColorId, null);
    assert.equal(items[1]?.unitPrice, 55);
    assert.equal(items[1]?.potColorId, colorM.id);
      assert.equal(items[1]?.lineTotal, 110);
      assert.equal(items[0]?.plantUnitCost, 18.5);
      const expectedLabel = catalogCustomerProductLabel(items);
      assert.equal(mails[0]?.plantName, expectedLabel);
      assert.equal(mails[0]?.customerEmail, email);
      assert.equal(mails[0]?.priceDisplay, formatPrice(150, "ILS"));
      assert.equal(mails[0]?.careInstructions, undefined);
      assert.deepEqual(mails[0]?.orderLines, [
        { plantName: originalName, potName: null, quantity: 1 },
        { plantName: originalName, potName: `Pot ${tag}`, quantity: 2 },
      ]);
      assert.deepEqual(mails[0]?.careSections, [
        { plantName: originalName, careInstructions: [careA] },
      ]);
      assert.equal(mails[0]?.attachments?.length, 1);
      assert.equal(mails[0]?.attachments?.[0]?.contentType, "application/pdf");
      const html = renderCustomerHtml(mails[0]!);
      assert.ok(html.includes('lang="en"'));
      assert.ok(html.includes('dir="ltr"'));
      assert.equal(occurrences(html, "Thank you for your purchase from Urban Plant"), 1);
      assert.equal(occurrences(html, "Order summary:"), 1);
      assert.ok(html.includes(`${originalName} × 1`));
      assert.ok(html.includes(`${originalName} + Pot ${tag} × 2`));
      assert.ok(!html.includes(`${originalName}, ${originalName}`));
      assert.ok(!html.includes(`(Pot ${tag})`));
      assert.equal(
        occurrences(
          html,
          "We’ll contact you within the next 1–3 business days to coordinate delivery.",
        ),
        1,
      );
      assert.equal(occurrences(html, "Care instructions"), 1);
      assert.equal(occurrences(html, `<strong>${originalName}</strong>`), 1);
      assert.equal(occurrences(html, careA), 1);
      assert.equal(occurrences(html, "Order total:"), 1);
      assert.equal(occurrences(html, "— Urban Plant"), 1);
      assert.ok(html.indexOf("Order summary:") < html.indexOf(`${originalName} × 1`));
      assert.ok(html.indexOf(`${originalName} × 1`) < html.indexOf(`${originalName} + Pot ${tag} × 2`));
      assert.ok(html.indexOf(`${originalName} + Pot ${tag} × 2`) < html.indexOf("We’ll contact you"));
      assert.ok(html.indexOf("We’ll contact you") < html.indexOf("Care instructions"));
      assert.ok(html.indexOf("Care instructions") < html.indexOf(careA));
      assert.ok(html.indexOf(careA) < html.indexOf("Order total:"));
      assert.ok(!html.includes("direction:rtl"));
      assert.ok(!html.includes("LIVE RENAME"));
      assert.ok(!JSON.stringify(document.Products).includes(careA));
      assert.equal(await inventoryQty(variantA), 16);
      assert.equal(await holdStatus(started.attemptId), "consumed");

      const duplicate = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () => {
            throw new Error("duplicate webhook must not verify again");
          },
          documentEmailDeps: deps,
        },
      );
      assert.equal(duplicate.outcome, "already_finalized");
      assert.equal(created.length, 1);
      assert.equal(mails.length, 1);
      assert.equal(pdfCalls, 1);
      assert.equal((await getOrderById(attempt.finalizedOrderId))?.purchaseEmailStatus, "sent");
      assert.equal(await inventoryQty(variantA), 16);

      await sql`UPDATE plants SET name = ${originalName}, supplier_price = 18.50 WHERE id = ${plantId}`;
    }

    // 2b. One opted-in plant: the customer email includes that plant's care text.
    {
      const email = `one-${tag}@example.com`;
      const started = await startLines([lineB], email, true);
      const created: CreateCardcomDocumentInput[] = [];
      const mails: MailCapture[] = [];
      const deps = {
        createDocument: async (input: CreateCardcomDocumentInput) => {
          created.push(input);
          documentSeq += 1;
          return { documentType: "TaxInvoiceAndReceipt", documentNumber: documentSeq };
        },
        fetchPdf: async () => ({
          bytes: Buffer.from("%PDF-1.4\none\n"),
          filename: "one.pdf",
        }),
        sendEmail: async (input: MailCapture) => {
          mails.push(input);
          return { messageId: "one" };
        },
        sendInternalNotification: async () => ({ messageId: "internal" }),
      };
      const webhook = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () =>
            verifiedLp({
              lowProfileId: started.lowProfileId,
              attemptId: started.attemptId,
              amount: 55,
              transactionId: 89011,
            }),
          documentEmailDeps: deps,
        },
      );
      assert.equal(webhook.outcome, "finalized");
      const request = buildCreateDocumentRequest(created[0]!, { ApiName: "n", ApiPassword: "p" });
      const products = (request.Document as { Products: { Description: string; Quantity: number; UnitCost: number }[]; IsSendByEmail: boolean }).Products;
      assert.equal((request.Document as { IsSendByEmail: boolean }).IsSendByEmail, false);
      assert.deepEqual(products, [{ Description: originalName, Quantity: 1, UnitCost: 55 }]);
      assert.equal(mails.length, 1);
      assert.equal(mails[0]?.attachments?.length, 1);
      assert.equal(mails[0]?.careInstructions, undefined);
      assert.deepEqual(mails[0]?.orderLines, [
        { plantName: originalName, potName: null, quantity: 1 },
      ]);
      assert.deepEqual(mails[0]?.careSections, [
        { plantName: originalName, careInstructions: [careA] },
      ]);
      const html = renderCustomerHtml(mails[0]!);
      assert.equal(occurrences(html, "Order summary:"), 1);
      assert.ok(html.includes(`${originalName} × 1`));
      assert.ok(!html.includes(`${originalName},`));
      assert.equal(occurrences(html, "Care instructions"), 1);
      assert.equal(occurrences(html, careA), 1);
      assert.equal(
        occurrences(
          html,
          "We’ll contact you within the next 1–3 business days to coordinate delivery.",
        ),
        1,
      );
      assert.equal(occurrences(html, "Order total:"), 1);
      assert.equal(occurrences(html, "— Urban Plant"), 1);
      assert.ok(html.includes('dir="ltr"'));
      const attempt = await getPaymentAttemptById(started.attemptId);
      assert.ok(attempt?.finalizedOrderId);
      orderIds.push(attempt.finalizedOrderId);
      assert.equal((await getOrderById(attempt.finalizedOrderId))?.purchaseEmailStatus, "sent");
      assert.equal((await getOrderById(attempt.finalizedOrderId))?.orderStatus, "sold");
    }

    // 2c. Two different plants: each plant's care appears once, under that plant.
    {
      const email = `two-${tag}@example.com`;
      const secondLine = {
        plantId: plantId2,
        plantSizeId: variantC,
        sellableVariantId: noPotC.sellableVariantId,
        offerId: offerC.offer.id,
        potColorId: null as string | null,
        quantity: 1,
        unitPrice: 55,
      };
      const started = await startLines([lineA, secondLine], email, true);
      const created: CreateCardcomDocumentInput[] = [];
      const mails: MailCapture[] = [];
      const deps = {
        createDocument: async (input: CreateCardcomDocumentInput) => {
          created.push(input);
          documentSeq += 1;
          return { documentType: "TaxInvoiceAndReceipt", documentNumber: documentSeq };
        },
        fetchPdf: async () => ({
          bytes: Buffer.from("%PDF-1.4\ntwo\n"),
          filename: "two.pdf",
        }),
        sendEmail: async (input: MailCapture) => {
          mails.push(input);
          return { messageId: "two" };
        },
        sendInternalNotification: async () => ({ messageId: "internal" }),
      };
      const webhook = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () =>
            verifiedLp({
              lowProfileId: started.lowProfileId,
              attemptId: started.attemptId,
              amount: 95,
              transactionId: 89012,
            }),
          documentEmailDeps: deps,
        },
      );
      assert.equal(webhook.outcome, "finalized");
      const request = buildCreateDocumentRequest(created[0]!, { ApiName: "n", ApiPassword: "p" });
      const document = request.Document as {
        IsSendByEmail: boolean;
        Products: { Description: string; Quantity: number; UnitCost: number }[];
      };
      assert.equal(document.IsSendByEmail, false);
      assert.deepEqual(document.Products, [
        { Description: originalName, Quantity: 1, UnitCost: 40 },
        { Description: secondName, Quantity: 1, UnitCost: 55 },
      ]);
      assert.equal(
        document.Products.reduce((sum, line) => sum + line.Quantity * line.UnitCost, 0),
        95,
      );
      assert.equal(mails.length, 1);
      assert.equal(mails[0]?.attachments?.length, 1);
      assert.equal(mails[0]?.careInstructions, undefined);
      assert.deepEqual(mails[0]?.orderLines, [
        { plantName: originalName, potName: null, quantity: 1 },
        { plantName: secondName, potName: null, quantity: 1 },
      ]);
      assert.deepEqual(
        mails[0]?.careSections?.map((section) => section.plantName),
        [originalName, secondName],
      );
      const html = renderCustomerHtml(mails[0]!);
      assert.equal(occurrences(html, "Thank you for your purchase from Urban Plant"), 1);
      assert.equal(occurrences(html, "Order summary:"), 1);
      assert.ok(html.includes(`${originalName} × 1`));
      assert.ok(html.includes(`${secondName} × 1`));
      assert.ok(!html.includes(`${originalName}, ${secondName}`));
      assert.equal(occurrences(html, careA), 1);
      assert.equal(occurrences(html, careB), 1);
      assert.equal(occurrences(html, "Care instructions"), 1);
      assert.equal(
        occurrences(
          html,
          "We’ll contact you within the next 1–3 business days to coordinate delivery.",
        ),
        1,
      );
      assert.equal(occurrences(html, "Order total:"), 1);
      assert.equal(occurrences(html, "— Urban Plant"), 1);
      const summary = html.indexOf("Order summary:");
      const lineAText = html.indexOf(`${originalName} × 1`);
      const lineBText = html.indexOf(`${secondName} × 1`);
      const headingA = html.indexOf(`<strong>${originalName}</strong>`);
      const headingB = html.indexOf(`<strong>${secondName}</strong>`);
      assert.ok(summary >= 0);
      assert.ok(lineAText > summary);
      assert.ok(lineBText > lineAText);
      assert.ok(headingA > html.indexOf("Care instructions"));
      assert.ok(headingB > headingA);
      assert.ok(html.indexOf(careA) > headingA);
      assert.ok(html.indexOf(careA) < headingB);
      assert.ok(html.indexOf(careB) > headingB);
      assert.ok(html.indexOf(careB) < html.indexOf("Order total:"));
      assert.ok(html.includes('dir="ltr"'));
      const attempt = await getPaymentAttemptById(started.attemptId);
      assert.ok(attempt?.finalizedOrderId);
      orderIds.push(attempt.finalizedOrderId);
      assert.equal((await getOrderById(attempt.finalizedOrderId))?.orderStatus, "sold");
      assert.equal((await getOrderById(attempt.finalizedOrderId))?.price, 95);
    }

    // 2d. Missing care text still sends the customer email.
    {
      await sql`UPDATE plants SET care_instructions = '["   "]'::jsonb WHERE id = ${plantId2}`;
      const email = `empty-${tag}@example.com`;
      const started = await startLines(
        [{
          plantId: plantId2,
          plantSizeId: variantC,
          sellableVariantId: noPotC.sellableVariantId,
          offerId: offerC.offer.id,
          potColorId: null,
          quantity: 1,
          unitPrice: 55,
        }],
        email,
        true,
      );
      const mails: MailCapture[] = [];
      let emailCalls = 0;
      const webhook = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () =>
            verifiedLp({
              lowProfileId: started.lowProfileId,
              attemptId: started.attemptId,
              amount: 55,
              transactionId: 89013,
            }),
          documentEmailDeps: {
            createDocument: async () => {
              documentSeq += 1;
              return { documentType: "TaxInvoiceAndReceipt", documentNumber: documentSeq };
            },
            fetchPdf: async () => ({
              bytes: Buffer.from("%PDF-1.4\nempty\n"),
              filename: "empty.pdf",
            }),
            sendEmail: async (input: MailCapture) => {
              emailCalls += 1;
              mails.push(input);
              return { messageId: "empty" };
            },
            sendInternalNotification: async () => ({ messageId: "internal" }),
          },
        },
      );
      assert.equal(webhook.outcome, "finalized");
      assert.equal(emailCalls, 1);
      assert.equal(mails[0]?.careInstructions, undefined);
      assert.equal(mails[0]?.careSections, undefined);
      assert.deepEqual(mails[0]?.orderLines, [
        { plantName: secondName, potName: null, quantity: 1 },
      ]);
      const html = renderCustomerHtml(mails[0]!);
      assert.equal(occurrences(html, careB), 0);
      assert.equal(occurrences(html, "Care instructions"), 0);
      assert.equal(occurrences(html, "Order summary:"), 1);
      assert.ok(html.includes(`${secondName} × 1`));
      assert.equal(occurrences(html, "Thank you for your purchase from Urban Plant"), 1);
      assert.equal(occurrences(html, "Order total:"), 1);
      assert.equal(occurrences(html, "— Urban Plant"), 1);
      const attempt = await getPaymentAttemptById(started.attemptId);
      assert.ok(attempt?.finalizedOrderId);
      orderIds.push(attempt.finalizedOrderId);
      const order = await getOrderById(attempt.finalizedOrderId);
      assert.equal(order?.orderStatus, "sold");
      assert.equal(order?.purchaseEmailStatus, "sent");
      assert.equal(await holdStatus(started.attemptId), "consumed");
    }

    // 3. Document failure leaves the paid order untouched and can be retried.
    {
      const started = await startLines([lineB], "", false);
      const qtyBefore = await inventoryQty(variantB);
      let createCalls = 0;
      let emailCalls = 0;
      let failCreate = true;
      const txId = 89003;
      const deps = {
        createDocument: async (input: CreateCardcomDocumentInput) => {
          createCalls += 1;
          if (failCreate) throw new Error("Cardcom CreateDocument failed");
          documentSeq += 1;
          assert.equal(input.products?.length, 1);
          assert.equal(input.products?.[0]?.unitCost, 55);
          return { documentType: "TaxInvoiceAndReceipt", documentNumber: documentSeq };
        },
        fetchPdf: async () => {
          throw new Error("PDF must not be fetched when document creation fails");
        },
        sendEmail: async () => {
          emailCalls += 1;
          return { messageId: "should-not" };
        },
        sendInternalNotification: async () => ({ messageId: "internal" }),
      };
      const webhook = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () =>
            verifiedLp({
              lowProfileId: started.lowProfileId,
              attemptId: started.attemptId,
              amount: 55,
              transactionId: txId,
            }),
          documentEmailDeps: deps,
        },
      );
      assert.equal(webhook.outcome, "finalized");
      const attempt = await getPaymentAttemptById(started.attemptId);
      assert.equal(attempt?.status, "finalized");
      assert.equal(attempt?.failureReason, undefined);
      assert.ok(attempt?.finalizedOrderId);
      orderIds.push(attempt.finalizedOrderId);
      const failed = await getOrderById(attempt.finalizedOrderId);
      assert.equal(failed?.orderStatus, "sold");
      assert.equal(failed?.purchaseEmailStatus, "failed");
      assert.match(failed?.purchaseEmailLastError ?? "", /CreateDocument failed/);
      assert.equal(failed?.cardcomDocumentNumber, undefined);
      assert.equal(failed?.purchaseEmailSentAt, undefined);
      assert.equal(createCalls, 1);
      assert.equal(emailCalls, 0);
      assert.equal(await inventoryQty(variantB), qtyBefore - 1);
      assert.equal(await holdStatus(started.attemptId), "consumed");

      failCreate = false;
      const retry = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () => {
            throw new Error("retry must not verify the payment again");
          },
          documentEmailDeps: deps,
        },
      );
      assert.equal(retry.outcome, "already_finalized");
      const retried = await getOrderById(attempt.finalizedOrderId);
      assert.equal(retried?.orderStatus, "sold");
      assert.equal(retried?.purchaseEmailStatus, "skipped");
      assert.equal(retried?.cardcomDocumentNumber, documentSeq);
      assert.equal(createCalls, 2);
      assert.equal(emailCalls, 0);
      assert.equal(await inventoryQty(variantB), qtyBefore - 1);
      assert.equal(await holdStatus(started.attemptId), "consumed");
      assert.equal((await getPaymentAttemptById(started.attemptId))?.status, "finalized");
    }

    // 4. Customer email failure leaves the paid order untouched and retries without a second document.
    {
      const email = `retry-${tag}@example.com`;
      const started = await startLines([lineB], email, true);
      const qtyBefore = await inventoryQty(variantB);
      let createCalls = 0;
      let emailCalls = 0;
      let failEmail = true;
      const txId = 89004;
      const deps = {
        createDocument: async () => {
          createCalls += 1;
          documentSeq += 1;
          return { documentType: "TaxInvoiceAndReceipt", documentNumber: documentSeq };
        },
        fetchPdf: async () => ({
          bytes: Buffer.from("%PDF-1.4\nretry\n"),
          filename: "retry.pdf",
        }),
        sendEmail: async () => {
          emailCalls += 1;
          if (failEmail) throw new Error("customer SMTP failed");
          return { messageId: "customer-retry" };
        },
        sendInternalNotification: async () => ({ messageId: "internal" }),
      };
      const webhook = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () =>
            verifiedLp({
              lowProfileId: started.lowProfileId,
              attemptId: started.attemptId,
              amount: 55,
              transactionId: txId,
            }),
          documentEmailDeps: deps,
        },
      );
      assert.equal(webhook.outcome, "finalized");
      const attempt = await getPaymentAttemptById(started.attemptId);
      assert.equal(attempt?.status, "finalized");
      assert.ok(attempt?.finalizedOrderId);
      orderIds.push(attempt.finalizedOrderId);
      const failed = await getOrderById(attempt.finalizedOrderId);
      assert.equal(failed?.orderStatus, "sold");
      assert.equal(failed?.purchaseEmailStatus, "failed");
      assert.match(failed?.purchaseEmailLastError ?? "", /customer SMTP failed/);
      assert.equal(failed?.cardcomDocumentNumber, documentSeq);
      assert.equal(failed?.purchaseEmailSentAt, undefined);
      assert.equal(createCalls, 1);
      assert.equal(emailCalls, 1);
      assert.equal(await inventoryQty(variantB), qtyBefore - 1);
      assert.equal(await holdStatus(started.attemptId), "consumed");
      const documentNumber = failed?.cardcomDocumentNumber;

      failEmail = false;
      const retry = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () => {
            throw new Error("email retry must not verify the payment again");
          },
          documentEmailDeps: deps,
        },
      );
      assert.equal(retry.outcome, "already_finalized");
      const retried = await getOrderById(attempt.finalizedOrderId);
      assert.equal(retried?.orderStatus, "sold");
      assert.equal(retried?.purchaseEmailStatus, "sent");
      assert.ok(retried?.purchaseEmailSentAt);
      assert.equal(retried?.purchaseEmailLastError, undefined);
      assert.equal(retried?.cardcomDocumentNumber, documentNumber);
      assert.equal(createCalls, 1);
      assert.equal(emailCalls, 2);
      assert.equal(await inventoryQty(variantB), qtyBefore - 1);
      assert.equal(await holdStatus(started.attemptId), "consumed");
      assert.equal((await getPaymentAttemptById(started.attemptId))?.status, "finalized");

      const third = await processCardcomWebhook(
        { LowProfileId: started.lowProfileId },
        {
          getLpResult: async () => {
            throw new Error("settled webhook must not verify or email again");
          },
          documentEmailDeps: deps,
        },
      );
      assert.equal(third.outcome, "already_finalized");
      assert.equal(createCalls, 1);
      assert.equal(emailCalls, 2);
    }

    const posAfter = await sql`
      SELECT id, status, payment_hold_attempt_id
      FROM pos_spots
      ORDER BY id
    `;
    assert.deepEqual(posAfter, posBefore);

    console.log("verify-catalog-post-payment: ok");
  } finally {
    if (orderIds.length > 0) {
      await sql`DELETE FROM order_items WHERE order_id = ANY(${orderIds}::uuid[])`;
    }
    await sql`DELETE FROM order_items WHERE plant_id IN (${plantId}, ${plantId2})`;
    if (attemptIds.length > 0) {
      await sql`DELETE FROM payment_attempts WHERE id = ANY(${attemptIds}::uuid[])`;
    }
    await sql`DELETE FROM payment_attempts WHERE product_id IN (${plantId}, ${plantId2})`;
    await sql`DELETE FROM orders WHERE product_id IN (${plantId}, ${plantId2})`;
    await sql`DELETE FROM inventory_history WHERE variant_id IN (${variantA}::uuid, ${variantB}::uuid, ${variantC}::uuid)`;
    await sql`DELETE FROM inventory WHERE variant_id IN (${variantA}::uuid, ${variantB}::uuid, ${variantC}::uuid)`;
    await sql`DELETE FROM pot_inventory_history WHERE pot_color_id IN (
      SELECT c.id FROM pot_colors c JOIN pot_sizes s ON s.id = c.pot_size_id WHERE s.pot_id = ${potId}::uuid
    )`;
    await sql`DELETE FROM pot_inventory WHERE pot_color_id IN (
      SELECT c.id FROM pot_colors c JOIN pot_sizes s ON s.id = c.pot_size_id WHERE s.pot_id = ${potId}::uuid
    )`;
    await sql`DELETE FROM offer_availabilities WHERE offer_id IN (
      SELECT o.id FROM offers o
      JOIN sellable_variants sv ON sv.id = o.sellable_variant_id
      WHERE sv.plant_variant_id IN (${variantA}::uuid, ${variantB}::uuid, ${variantC}::uuid)
    )`;
    await sql`DELETE FROM offers WHERE sellable_variant_id IN (
      SELECT id FROM sellable_variants
      WHERE plant_variant_id IN (${variantA}::uuid, ${variantB}::uuid, ${variantC}::uuid)
    )`;
    await sql`DELETE FROM sellable_variants WHERE plant_variant_id IN (${variantA}::uuid, ${variantB}::uuid, ${variantC}::uuid)`;
    await sql`DELETE FROM pot_colors WHERE pot_size_id IN (SELECT id FROM pot_sizes WHERE pot_id = ${potId}::uuid)`;
    await sql`DELETE FROM pot_sizes WHERE pot_id = ${potId}::uuid`;
    await sql`DELETE FROM pots WHERE id = ${potId}::uuid`;
    await sql`DELETE FROM plant_variants WHERE plant_id IN (${plantId}, ${plantId2})`;
    await sql`DELETE FROM plants WHERE id IN (${plantId}, ${plantId2})`;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

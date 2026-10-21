/**
 * Catalog payment backend: prepare, retry, verified finalization, late payment.
 * Mocked Cardcom only. Does not call the live terminal.
 *
 * Run against an isolated Neon child (not dev-partner-page or production):
 * npx tsx scripts/verify-catalog-payment-backend.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const root = process.cwd();
const TEST_PUBLIC_ORIGIN = "https://urban-plant-catalog-payment-verify.example.com";

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertSources(): void {
  const prep = read("lib/startCardcomPaymentPrep.ts");
  assert.match(prep, /channel:\s*"partner"/);
  assert.doesNotMatch(prep, /catalog_stock_holds|startCatalogCardcomPayment|finalizeCatalog/);

  const expiry = read("lib/paymentHoldExpiry.ts");
  assert.doesNotMatch(expiry, /catalog_stock_holds/);

  const pos = read("lib/posSpotStorage.ts");
  assert.doesNotMatch(pos, /catalog_stock_holds|order_items/);

  const finalize = read("lib/finalizeCatalogPayment.ts");
  assert.match(finalize, /needs_reconciliation/);
  assert.match(finalize, /catalog_snapshot->'lines'/);
  assert.doesNotMatch(finalize, /supplier_price/);
  assert.doesNotMatch(finalize, /FROM plants/);
  assert.doesNotMatch(finalize, /JOIN plants/);
  assert.match(finalize, /sql\.transaction/);

  const catalogPrep = read("lib/catalogPaymentPrep.ts");
  assert.match(catalogPrep, /sql\.transaction/);
  assert.match(catalogPrep, /cart_changed/);
  assert.match(catalogPrep, /'catalog'/);

  const webhook = read("lib/processCardcomWebhook.ts");
  assert.match(webhook, /attempt\.channel === "catalog"/);
  assert.match(webhook, /finalizeVerifiedPaymentAttemptAtomic/);

  const retry = read("lib/retryCardcomPayment.ts");
  assert.match(retry, /attemptBefore\.channel === "catalog"/);
  assert.match(retry, /expireStalePaymentHold/);

  assert.equal(existsSync(join(root, "db", "migrations", "044_catalog_payment_reconciliation.sql")), false);
  console.log("verify-catalog-payment-backend: source boundaries ok");
}

async function main(): Promise<void> {
  assertSources();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const dbHost = new URL(process.env.DATABASE_URL ?? "http://invalid").hostname;
  if (dbHost.includes("snowy-credit")) {
    throw new Error(
      "Refusing to run catalog payment verification against the dev-partner-page database",
    );
  }
  console.log(`verify-catalog-payment-backend: database host ${dbHost}`);

  const { parseCardcomLowProfileResult } = await import("../lib/cardcom");
  const { sql } = await import("../lib/db");
  const { getOrderItemsByOrderId } = await import("../lib/orderItemStorage");
  const { getPaymentAttemptById } = await import("../lib/paymentAttemptStorage");
  const { PLANT_UNIT_COST_SOURCE } = await import("../lib/catalogCheckoutSnapshot");
  const { startCatalogCardcomPayment } = await import("../lib/catalogPaymentPrep");
  const { processCardcomWebhook } = await import("../lib/processCardcomWebhook");
  const { retryCardcomPayment } = await import("../lib/retryCardcomPayment");

  const holdTable = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'catalog_stock_holds'
  `;
  assert.equal((holdTable as unknown[]).length, 1, "migration 043 is required on this branch");

  const tag = randomUUID().slice(0, 8);
  const plantId = `cat-pay-${tag}`;
  const variantA = randomUUID();
  const variantB = randomUUID();
  const potId = randomUUID();
  const potM = randomUUID();
  const potS = randomUUID();
  const street = TEL_AVIV_STREETS[0] ?? "Rothschild Blvd";
  const phone = "0546605603";
  const attemptIds: string[] = [];
  const orderIds: string[] = [];

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

  async function historyRows(variantId: string): Promise<{ delta: number; note: string | null }[]> {
    const rows = await sql`
      SELECT delta, note
      FROM inventory_history
      WHERE variant_id = ${variantId}::uuid
      ORDER BY created_at ASC, id ASC
    `;
    return (rows as { delta: string | number; note: string | null }[]).map((row) => ({
      delta: Number(row.delta),
      note: row.note,
    }));
  }

  async function attemptCount(): Promise<number> {
    const rows = await sql`
      SELECT COUNT(*)::int AS n
      FROM payment_attempts
      WHERE product_id = ${plantId}
    `;
    return (rows as { n: number }[])[0]?.n ?? 0;
  }

  async function holdRows(attemptId: string): Promise<
    { id: string; plant_variant_id: string; quantity: number; status: string }[]
  > {
    const rows = await sql`
      SELECT id, plant_variant_id, quantity, status
      FROM catalog_stock_holds
      WHERE attempt_id = ${attemptId}::uuid
      ORDER BY plant_variant_id
    `;
    return (rows as { id: string; plant_variant_id: string; quantity: number | string; status: string }[]).map(
      (row) => ({
        id: String(row.id),
        plant_variant_id: String(row.plant_variant_id),
        quantity: Number(row.quantity),
        status: row.status,
      }),
    );
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

  function mockCreate(lowProfileId: string, calls: { n: number; amount?: number }) {
    return async (input: { amount: number; returnValue: string }) => {
      calls.n += 1;
      calls.amount = input.amount;
      return {
        ResponseCode: 0,
        Description: "OK",
        LowProfileId: lowProfileId,
        Url: `https://secure.cardcom.solutions/Interface/LowProfile.aspx?LowProfileId=${lowProfileId}`,
      };
    };
  }

  try {
    await sql`
      INSERT INTO plants (
        id, name, name_he, subtitle, description, supplier_price, currency,
        images, labels, light, water, location, pet_friendly,
        care_instructions, inventory_type, catalog_published, created_at
      )
      VALUES (
        ${plantId}, ${`Catalog Pay ${tag}`}, 'צמח', 'Verify subtitle', 'Verify description',
        18.50, 'ILS', '["https://example.com/catalog-pay.jpg"]'::jsonb, '["verify"]'::jsonb,
        'Low light', 'Moderate', 'Indoor', false, '["water"]'::jsonb,
        'plants', true, now()
      )
    `;
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label, catalog_price)
      VALUES
        (${variantA}::uuid, ${plantId}, 'M', 40),
        (${variantB}::uuid, ${plantId}, 'M', 55)
    `;
    await sql`
      INSERT INTO pots (id, name, name_he)
      VALUES (${potId}::uuid, ${`Pot ${tag}`}, 'עציץ')
    `;
    await sql`
      INSERT INTO pot_variants (id, pot_id, size_label, color, color_he, catalog_price)
      VALUES
        (${potM}::uuid, ${potId}::uuid, 'M', ${`clay-${tag}`}, 'חרס', 15),
        (${potS}::uuid, ${potId}::uuid, 'S', ${`sand-${tag}`}, 'חול', 9)
    `;
    await sql`
      INSERT INTO inventory (variant_id, quantity, updated_at)
      VALUES
        (${variantA}::uuid, 8, now()),
        (${variantB}::uuid, 4, now())
    `;

    const lineA = {
      plantId,
      plantVariantId: variantA,
      potVariantId: null,
      quantity: 1,
      plantUnitPrice: 40,
      potUnitPrice: null,
    };
    const linePot = {
      plantId,
      plantVariantId: variantA,
      potVariantId: potM,
      quantity: 2,
      plantUnitPrice: 40,
      potUnitPrice: 15,
    };

    const stale = await startCatalogCardcomPayment(
      {
        lines: [{ ...lineA, plantUnitPrice: 1 }],
        ...customer(`stale-${tag}@example.com`, true),
      },
      { publicOrigin: TEST_PUBLIC_ORIGIN, cardcomEnvironment: "test", createLowProfile: async () => {
        throw new Error("stale cart must not create a Cardcom payment");
      } },
    );
    assert.equal(stale.ok, false);
    if (!stale.ok) {
      assert.equal(stale.code, "cart_changed");
      assert.equal(stale.httpStatus, 409);
    }
    assert.equal(await attemptCount(), 0);
    assert.equal(await inventoryQty(variantA), 8);

    const incompatible = await startCatalogCardcomPayment(
      {
        lines: [{ ...lineA, potVariantId: potS, potUnitPrice: 9 }],
        ...customer(`pot-${tag}@example.com`, true),
      },
      { publicOrigin: TEST_PUBLIC_ORIGIN, cardcomEnvironment: "test" },
    );
    assert.equal(incompatible.ok, false);
    if (!incompatible.ok) assert.equal(incompatible.code, "cart_changed");
    assert.equal(await attemptCount(), 0);

    const missing = await startCatalogCardcomPayment(
      {
        lines: [{ ...lineA, plantVariantId: randomUUID() }],
        ...customer(`missing-${tag}@example.com`, true),
      },
      { publicOrigin: TEST_PUBLIC_ORIGIN, cardcomEnvironment: "test" },
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "cart_changed");
    assert.equal(await attemptCount(), 0);

    const short = await startCatalogCardcomPayment(
      {
        lines: [{ ...lineA, quantity: 100 }],
        ...customer(`short-${tag}@example.com`, true),
      },
      { publicOrigin: TEST_PUBLIC_ORIGIN, cardcomEnvironment: "test", createLowProfile: async () => {
        throw new Error("insufficient stock must not create a Cardcom payment");
      } },
    );
    assert.equal(short.ok, false);
    if (!short.ok) {
      assert.equal(short.code, "insufficient_stock");
      assert.equal(short.httpStatus, 409);
    }
    assert.equal(await attemptCount(), 0);
    const holdsAfterShort = await sql`
      SELECT COUNT(*)::int AS n
      FROM catalog_stock_holds h
      INNER JOIN plant_variants pv ON pv.id = h.plant_variant_id
      WHERE pv.plant_id = ${plantId}
    `;
    assert.equal((holdsAfterShort as { n: number }[])[0]?.n, 0);
    assert.equal(await inventoryQty(variantA), 8);
    assert.equal((await historyRows(variantA)).length, 0);

    const noEmail = await startCatalogCardcomPayment(
      {
        lines: [lineA],
        ...customer("", true),
      },
      { publicOrigin: TEST_PUBLIC_ORIGIN, cardcomEnvironment: "test" },
    );
    assert.equal(noEmail.ok, false);
    if (!noEmail.ok) assert.equal(noEmail.code, "validation");

    const createCalls = { n: 0, amount: undefined as number | undefined };
    const lowProfileId = `lp-cat-${randomUUID()}`;
    const started = await startCatalogCardcomPayment(
      {
        lines: [lineA, linePot],
        ...customer(`buy-${tag}@example.com`, true),
      },
      {
        publicOrigin: TEST_PUBLIC_ORIGIN,
        cardcomEnvironment: "test",
        createLowProfile: mockCreate(lowProfileId, createCalls),
      },
    );
    assert.equal(started.ok, true);
    if (!started.ok) throw new Error("catalog checkout should start");
    attemptIds.push(started.attemptId);
    assert.equal(createCalls.n, 1);
    assert.equal(createCalls.amount, 150);
    assert.equal(await attemptCount(), 1);
    assert.equal(await inventoryQty(variantA), 8);

    const attempt = await getPaymentAttemptById(started.attemptId);
    assert.ok(attempt);
    assert.equal(attempt.channel, "catalog");
    assert.equal(attempt.posSpotId, null);
    assert.equal(attempt.status, "awaiting_payment");
    assert.equal(attempt.amount, 150);
    assert.equal(attempt.fulfillmentMethod, "delivery");
    assert.equal(attempt.customerEmail, `buy-${tag}@example.com`);
    assert.ok(attempt.catalogSnapshot);
    assert.equal(attempt.catalogSnapshot.lines.length, 2);
    assert.equal(attempt.catalogSnapshot.lines[0]?.plantUnitPrice, 40);
    assert.equal(attempt.catalogSnapshot.lines[0]?.plantUnitCost, 18.5);
    assert.equal(attempt.catalogSnapshot.lines[0]?.plantUnitCostSource, PLANT_UNIT_COST_SOURCE);
    assert.equal(attempt.catalogSnapshot.lines[1]?.potUnitPrice, 15);
    assert.equal(attempt.catalogSnapshot.lines[1]?.plantUnitCost, 18.5);
    assert.equal(attempt.catalogSnapshot.sourcePartnerId, null);

    const holds = await holdRows(started.attemptId);
    assert.equal(holds.length, 1);
    assert.equal(holds[0]?.plant_variant_id, variantA);
    assert.equal(holds[0]?.quantity, 3);
    assert.equal(holds[0]?.status, "active");

    const stillShort = await startCatalogCardcomPayment(
      {
        lines: [{ ...lineA, quantity: 6 }],
        ...customer(`held-${tag}@example.com`, true),
      },
      { publicOrigin: TEST_PUBLIC_ORIGIN, cardcomEnvironment: "test" },
    );
    assert.equal(stillShort.ok, false);
    if (!stillShort.ok) assert.equal(stillShort.code, "insufficient_stock");
    assert.equal(await attemptCount(), 1);
    assert.equal((await holdRows(started.attemptId)).length, 1);

    const retryCalls = { n: 0, amount: undefined as number | undefined };
    const retryLowProfileId = `lp-cat-retry-${randomUUID()}`;
    const retried = await retryCardcomPayment(
      { orderId: started.attemptId, resumeToken: attempt.paymentResumeToken },
      {
        publicOrigin: TEST_PUBLIC_ORIGIN,
        cardcomEnvironment: "test",
        createLowProfile: mockCreate(retryLowProfileId, retryCalls),
      },
    );
    assert.equal(retried.ok, true);
    if (!retried.ok) throw new Error("catalog retry should reuse the attempt");
    assert.equal(retried.orderId, started.attemptId);
    assert.equal(retryCalls.n, 1);
    assert.equal(retryCalls.amount, 150);
    assert.equal(await attemptCount(), 1);
    const holdsAfterRetry = await holdRows(started.attemptId);
    assert.equal(holdsAfterRetry.length, 1);
    assert.equal(holdsAfterRetry[0]?.id, holds[0]?.id);
    assert.equal(holdsAfterRetry[0]?.quantity, 3);
    assert.equal(holdsAfterRetry[0]?.status, "active");
    assert.equal(await inventoryQty(variantA), 8);
    const afterRetry = await getPaymentAttemptById(started.attemptId);
    assert.equal(afterRetry?.checkoutSessionId, retryLowProfileId);
    assert.equal(afterRetry?.status, "awaiting_payment");

    await sql`
      UPDATE plants SET supplier_price = 99 WHERE id = ${plantId}
    `;
    await sql`
      UPDATE plant_variants SET catalog_price = 70 WHERE id = ${variantA}::uuid
    `;

    let documentCalls = 0;
    const webhook = await processCardcomWebhook(
      { LowProfileId: retryLowProfileId },
      {
        getLpResult: async () =>
          parseCardcomLowProfileResult({
            ResponseCode: 0,
            Description: "OK",
            LowProfileId: retryLowProfileId,
            ReturnValue: started.attemptId,
            TranzactionId: 88001,
            TranzactionInfo: {
              ResponseCode: 0,
              Amount: 150,
              CoinId: 1,
              TranzactionId: 88001,
            },
          }),
        processDocumentAndEmail: async () => {
          documentCalls += 1;
          return { outcome: "sent" };
        },
        notifyCatalogReconciliation: async () => {},
      },
    );
    assert.equal(webhook.outcome, "finalized");
    assert.equal(webhook.httpStatus, 200);
    assert.equal(documentCalls, 1);

    const finalized = await getPaymentAttemptById(started.attemptId);
    assert.equal(finalized?.status, "finalized");
    assert.ok(finalized?.finalizedOrderId);
    orderIds.push(finalized.finalizedOrderId);
    assert.equal(finalized.cardcomTransactionId, 88001);
    assert.equal(finalized.catalogSnapshot?.lines[0]?.plantUnitCost, 18.5);

    const orderRows = await sql`
      SELECT channel, partner_id, source, fulfillment_method, order_status, price, pos_spot_id
      FROM orders
      WHERE order_id = ${finalized.finalizedOrderId}::uuid
    `;
    const order = (orderRows as {
      channel: string;
      partner_id: string | null;
      source: string;
      fulfillment_method: string;
      order_status: string;
      price: string | number;
      pos_spot_id: string | null;
    }[])[0];
    assert.ok(order);
    assert.equal(order.channel, "catalog");
    assert.equal(order.partner_id, null);
    assert.equal(order.source, "online");
    assert.equal(order.fulfillment_method, "delivery");
    assert.equal(order.order_status, "sold");
    assert.equal(Number(order.price), 150);
    assert.equal(order.pos_spot_id, null);

    const items = await getOrderItemsByOrderId(finalized.finalizedOrderId);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.plantUnitPrice, 40);
    assert.equal(items[0]?.potUnitPrice, null);
    assert.equal(items[0]?.quantity, 1);
    assert.equal(items[0]?.plantUnitCost, 18.5);
    assert.equal(items[0]?.plantUnitCostSource, PLANT_UNIT_COST_SOURCE);
    assert.equal(items[1]?.plantUnitPrice, 40);
    assert.equal(items[1]?.potUnitPrice, 15);
    assert.equal(items[1]?.quantity, 2);
    assert.equal(items[1]?.lineTotal, 110);
    assert.equal(items[1]?.plantUnitCost, 18.5);
    assert.equal(await inventoryQty(variantA), 5);
    const history = await historyRows(variantA);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.delta, -3);
    assert.match(history[0]?.note ?? "", /catalog sale/);
    assert.equal((await holdRows(started.attemptId))[0]?.status, "consumed");

    const duplicate = await processCardcomWebhook(
      { LowProfileId: retryLowProfileId },
      {
        getLpResult: async () => {
          throw new Error("duplicate webhook must not verify or sell again");
        },
        processDocumentAndEmail: async () => {
          documentCalls += 1;
          return { outcome: "sent" };
        },
        notifyCatalogReconciliation: async () => {},
      },
    );
    assert.equal(duplicate.outcome, "already_finalized");
    assert.equal(documentCalls, 2);
    assert.equal(await inventoryQty(variantA), 5);
    assert.equal((await historyRows(variantA)).length, 1);
    const orderCount = await sql`
      SELECT COUNT(*)::int AS n FROM orders WHERE product_id = ${plantId}
    `;
    assert.equal((orderCount as { n: number }[])[0]?.n, 1);
    assert.equal((await holdRows(started.attemptId))[0]?.status, "consumed");

    const lateCalls = { n: 0, amount: undefined as number | undefined };
    const lateLowProfileId = `lp-cat-late-${randomUUID()}`;
    const late = await startCatalogCardcomPayment(
      {
        lines: [{
          plantId,
          plantVariantId: variantB,
          potVariantId: null,
          quantity: 1,
          plantUnitPrice: 55,
          potUnitPrice: null,
        }],
        ...customer(`late-${tag}@example.com`, false),
      },
      {
        publicOrigin: TEST_PUBLIC_ORIGIN,
        cardcomEnvironment: "test",
        createLowProfile: mockCreate(lateLowProfileId, lateCalls),
      },
    );
    assert.equal(late.ok, true);
    if (!late.ok) throw new Error("late catalog checkout should start");
    attemptIds.push(late.attemptId);
    const lateAttempt = await getPaymentAttemptById(late.attemptId);
    assert.equal(lateAttempt?.customerEmail, "");
    assert.equal(await inventoryQty(variantB), 4);

    await sql`
      UPDATE catalog_stock_holds
      SET expires_at = now() - interval '1 minute', updated_at = now()
      WHERE attempt_id = ${late.attemptId}::uuid
    `;
    const expiredRetryCalls = { n: 0, amount: undefined as number | undefined };
    const expiredRetry = await retryCardcomPayment(
      { orderId: late.attemptId, resumeToken: lateAttempt!.paymentResumeToken },
      {
        publicOrigin: TEST_PUBLIC_ORIGIN,
        cardcomEnvironment: "test",
        createLowProfile: mockCreate(`lp-should-not-${randomUUID()}`, expiredRetryCalls),
      },
    );
    assert.equal(expiredRetry.ok, false);
    if (!expiredRetry.ok) {
      assert.equal(expiredRetry.code, "conflict");
      assert.equal(expiredRetry.httpStatus, 409);
    }
    assert.equal(expiredRetryCalls.n, 0);
    assert.equal(await attemptCount(), 2);
    assert.equal((await holdRows(late.attemptId))[0]?.status, "expired");
    assert.equal(await inventoryQty(variantB), 4);

    const lateWebhook = await processCardcomWebhook(
      { LowProfileId: lateLowProfileId },
      {
        getLpResult: async () =>
          parseCardcomLowProfileResult({
            ResponseCode: 0,
            Description: "OK",
            LowProfileId: lateLowProfileId,
            ReturnValue: late.attemptId,
            TranzactionId: 88002,
            TranzactionInfo: {
              ResponseCode: 0,
              Amount: 55,
              CoinId: 1,
              TranzactionId: 88002,
            },
          }),
        processDocumentAndEmail: async () => {
          documentCalls += 1;
          return { outcome: "sent" };
        },
        notifyCatalogReconciliation: async () => {},
      },
    );
    assert.equal(lateWebhook.outcome, "needs_reconciliation");
    const reconciled = await getPaymentAttemptById(late.attemptId);
    assert.equal(reconciled?.status, "needs_reconciliation");
    assert.equal(reconciled?.finalizedOrderId, undefined);
    assert.equal(reconciled?.cardcomTransactionId, 88002);
    assert.equal(reconciled?.checkoutSessionId, lateLowProfileId);
    assert.equal(reconciled?.failureReason, "catalog_holds_unsafe");
    assert.equal(await inventoryQty(variantB), 4);
    assert.equal((await historyRows(variantB)).length, 0);
    assert.notEqual((await holdRows(late.attemptId))[0]?.status, "consumed");
    const ordersAfterLate = await sql`
      SELECT COUNT(*)::int AS n FROM orders WHERE product_id = ${plantId}
    `;
    assert.equal((ordersAfterLate as { n: number }[])[0]?.n, 1);

    const lateAgain = await processCardcomWebhook(
      { LowProfileId: lateLowProfileId },
      {
        getLpResult: async () => {
          throw new Error("reconciled webhook must not sell");
        },
        notifyCatalogReconciliation: async () => {},
      },
    );
    assert.equal(lateAgain.outcome, "needs_reconciliation");
    assert.equal(await inventoryQty(variantB), 4);
    assert.equal(documentCalls, 2);

    const posAfter = await sql`
      SELECT id, status, payment_hold_attempt_id
      FROM pos_spots
      ORDER BY id
    `;
    assert.deepEqual(posAfter, posBefore);

    console.log("verify-catalog-payment-backend: ok");
  } finally {
    if (orderIds.length > 0) {
      await sql`DELETE FROM order_items WHERE order_id = ANY(${orderIds}::uuid[])`;
    }
    await sql`DELETE FROM order_items WHERE plant_id = ${plantId}`;
    if (attemptIds.length > 0) {
      await sql`DELETE FROM payment_attempts WHERE id = ANY(${attemptIds}::uuid[])`;
    }
    await sql`DELETE FROM payment_attempts WHERE product_id = ${plantId}`;
    await sql`DELETE FROM orders WHERE product_id = ${plantId}`;
    await sql`DELETE FROM inventory_history WHERE variant_id IN (${variantA}::uuid, ${variantB}::uuid)`;
    await sql`DELETE FROM inventory WHERE variant_id IN (${variantA}::uuid, ${variantB}::uuid)`;
    await sql`DELETE FROM pot_variants WHERE pot_id = ${potId}::uuid`;
    await sql`DELETE FROM pots WHERE id = ${potId}::uuid`;
    await sql`DELETE FROM plant_variants WHERE plant_id = ${plantId}`;
    await sql`DELETE FROM plants WHERE id = ${plantId}`;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

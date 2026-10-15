/**
 * Catalog checkout schema + data layer.
 * Holds do not change inventory. No checkout UI or Cardcom.
 *
 * Run against a Neon child branch that has migration 043 applied:
 * npx tsx scripts/verify-catalog-checkout-data.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertSources(): void {
  const migration = read("db/migrations/043_catalog_checkout.sql");
  assert.match(migration, /payment_attempts_channel_pos_spot_check/);
  assert.match(migration, /catalog_stock_holds/);
  assert.match(migration, /order_items/);
  assert.match(migration, /plants\.supplier_price@sale/);
  assert.doesNotMatch(migration, /pot_unit_cost/);
  assert.doesNotMatch(migration, /REFERENCES plants/);
  assert.doesNotMatch(migration, /REFERENCES pot_variants/);
  assert.doesNotMatch(migration, /REFERENCES pots/);

  const holds = read("lib/catalogStockHolds.ts");
  assert.match(holds, /PAYMENT_HOLD_TTL_MS/);
  assert.doesNotMatch(holds, /UPDATE inventory/i);
  assert.doesNotMatch(holds, /applyInventoryDelta/);
  assert.doesNotMatch(holds, /INSERT INTO inventory/i);

  const prep = read("lib/startCardcomPaymentPrep.ts");
  assert.match(prep, /channel:\s*"partner"/);
  assert.doesNotMatch(prep, /catalogStockHolds/);
  assert.doesNotMatch(prep, /orderItemStorage/);
  assert.doesNotMatch(prep, /catalog_stock_holds/);

  const expiry = read("lib/paymentHoldExpiry.ts");
  assert.doesNotMatch(expiry, /catalog_stock_holds/);

  const pos = read("lib/posSpotStorage.ts");
  assert.doesNotMatch(pos, /catalog_stock_holds/);
  assert.doesNotMatch(pos, /order_items/);

  console.log("verify-catalog-checkout-data: source boundaries ok");
}

type Sql = typeof import("../lib/db").sql;

async function main(): Promise<void> {
  assertSources();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const dbHost = new URL(process.env.DATABASE_URL ?? "http://invalid").hostname;
  if (dbHost.includes("snowy-credit")) {
    throw new Error("Refusing to run catalog checkout verification against the dev-partner-page database");
  }

  const { plantUnitCostFromSupplierPrice, PLANT_UNIT_COST_SOURCE } = await import(
    "../lib/catalogCheckoutSnapshot"
  );
  assert.deepEqual(plantUnitCostFromSupplierPrice(18.5), {
    plantUnitCost: 18.5,
    plantUnitCostSource: PLANT_UNIT_COST_SOURCE,
  });
  assert.deepEqual(plantUnitCostFromSupplierPrice("18.50"), {
    plantUnitCost: 18.5,
    plantUnitCostSource: PLANT_UNIT_COST_SOURCE,
  });
  for (const value of [0, "0", "0.00", -1, null, undefined, ""]) {
    assert.deepEqual(plantUnitCostFromSupplierPrice(value), {
      plantUnitCost: null,
      plantUnitCostSource: null,
    });
  }

  const { sql } = await import("../lib/db");
  const { PAYMENT_HOLD_TTL_MS } = await import("../lib/paymentHoldExpiry");
  const {
    deletePaymentAttemptById,
    getPaymentAttemptById,
    insertPaymentAttempt,
  } = await import("../lib/paymentAttemptStorage");
  const {
    CatalogStockHoldError,
    acquireCatalogStockHolds,
    consumeCatalogStockHolds,
    expireStaleCatalogStockHolds,
    getCatalogAvailableQuantity,
    listCatalogStockHoldsForAttempt,
    releaseCatalogStockHolds,
  } = await import("../lib/catalogStockHolds");
  const { getOrderItemsByOrderId, getOrderItemsByOrderIds, insertOrderItems, orderItemsFromCatalogSnapshot } =
    await import("../lib/orderItemStorage");

  assert.equal(PAYMENT_HOLD_TTL_MS, 17 * 60 * 1000);

  const emailCheck = await sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'orders_purchase_email_status_check'
  `;
  assert.match(String((emailCheck as { def: string }[])[0]?.def ?? ""), /skipped/);

  const attemptCols = await sql`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_attempts'
  `;
  const attemptByName = Object.fromEntries(
    (attemptCols as { column_name: string; is_nullable: string; column_default: string | null }[]).map(
      (row) => [row.column_name, row],
    ),
  );
  assert.equal(attemptByName.pos_spot_id.is_nullable, "YES");
  assert.equal(attemptByName.channel.is_nullable, "NO");
  assert.match(String(attemptByName.channel.column_default), /partner/);
  assert.equal(attemptByName.catalog_snapshot.is_nullable, "YES");

  const channelCheck = await sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'payment_attempts_channel_pos_spot_check'
  `;
  const channelDef = String((channelCheck as { def: string }[])[0]?.def ?? "");
  assert.match(channelDef, /partner/);
  assert.match(channelDef, /catalog/);
  assert.match(channelDef, /pos_spot_id IS NOT NULL/);
  assert.match(channelDef, /pos_spot_id IS NULL/);

  const holdTable = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'catalog_stock_holds'
  `;
  assert.equal((holdTable as unknown[]).length, 1);
  const holdIndexes = await sql`
    SELECT indexname FROM pg_indexes WHERE tablename = 'catalog_stock_holds'
  `;
  const holdIndexNames = new Set(
    (holdIndexes as { indexname: string }[]).map((row) => row.indexname),
  );
  assert.equal(holdIndexNames.has("catalog_stock_holds_attempt_variant_key"), true);
  assert.equal(holdIndexNames.has("catalog_stock_holds_active_variant_idx"), true);

  const itemCols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items'
  `;
  const itemColNames = (itemCols as { column_name: string }[]).map((row) => row.column_name);
  for (const name of [
    "line_no",
    "plant_variant_id",
    "pot_variant_id",
    "plant_unit_price",
    "pot_unit_price",
    "line_total",
    "plant_unit_cost",
    "plant_unit_cost_source",
  ]) {
    assert.equal(itemColNames.includes(name), true, name);
  }
  assert.equal(itemColNames.includes("pot_unit_cost"), false);
  assert.equal(itemColNames.includes("pot_cost"), false);

  const itemFks = await sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'order_items'::regclass AND contype = 'f'
  `;
  const itemFkDefs = (itemFks as { def: string }[]).map((row) => row.def);
  assert.equal(itemFkDefs.length, 1);
  assert.match(itemFkDefs[0] ?? "", /orders/);
  assert.doesNotMatch(itemFkDefs.join(" "), /plant_variants|pot_variants|plants/);

  const orphanPartner = await sql`
    SELECT COUNT(*)::int AS n
    FROM payment_attempts
    WHERE channel = 'partner' AND pos_spot_id IS NULL
  `;
  assert.equal((orphanPartner as { n: number }[])[0]?.n, 0);

  const posBefore = await posStatusHistogram(sql);
  const posCountBefore = await countRows(sql, "pos_spots");
  const orderCountBefore = await countRows(sql, "orders");
  const inventoryCountBefore = await countRows(sql, "inventory");

  const spotRows = await sql`
    SELECT id, status, payment_hold_attempt_id, plant_variant_id, current_offer_id
    FROM pos_spots
    ORDER BY created_at ASC NULLS LAST, id ASC
    LIMIT 1
  `;
  const spot = (spotRows as {
    id: string;
    status: string;
    payment_hold_attempt_id: string | null;
    plant_variant_id: string | null;
    current_offer_id: string | null;
  }[])[0];
  assert.ok(spot, "need one POS spot to prove partner attempts still reference a spot");
  const spotBefore = { ...spot };

  const tag = randomUUID().slice(0, 8);
  const pricedPlantId = `chk-priced-${tag}`;
  const zeroPlantId = `chk-zero-${tag}`;
  const variantA = randomUUID();
  const variantB = randomUUID();
  const potId = randomUUID();
  const potVariantId = randomUUID();
  const attemptIds: string[] = [];
  const orderIds: string[] = [];

  async function inventoryQty(variantId: string): Promise<number> {
    const rows = await sql`
      SELECT quantity FROM inventory WHERE variant_id = ${variantId}::uuid
    `;
    return Number((rows as { quantity: number }[])[0]?.quantity ?? 0);
  }

  async function historyCount(variantId: string): Promise<number> {
    const rows = await sql`
      SELECT COUNT(*)::int AS n FROM inventory_history WHERE variant_id = ${variantId}::uuid
    `;
    return (rows as { n: number }[])[0]?.n ?? 0;
  }

  function attemptBase(id: string, channel: "partner" | "catalog", posSpotId: string | null) {
    const now = new Date().toISOString();
    return {
      id,
      status: "created" as const,
      channel,
      posSpotId,
      productId: pricedPlantId,
      productName: "Checkout data verify",
      fullName: "Checkout Verify",
      customerEmail: `checkout-data-${tag}@example.com`,
      phone: "0500000000",
      address: "Verify 1",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery" as const,
      amount: 40,
      paymentResumeToken: `resume-${id}`,
      createdAt: now,
      updatedAt: now,
    };
  }

  try {
    await sql`
      INSERT INTO plants (
        id, name, name_he, subtitle, description, supplier_price, currency,
        images, labels, light, water, difficulty, location, pet_friendly,
        care_instructions, inventory_type, catalog_published, created_at
      )
      VALUES
        (
          ${pricedPlantId}, 'Checkout Priced', 'צמח', 'Verify subtitle', 'Verify description',
          18.50, 'ILS', '["https://example.com/priced.jpg"]'::jsonb, '["verify"]'::jsonb,
          'Low light', 'Moderate', 'Easy', 'Indoor', false, '["water"]'::jsonb,
          'plants', false, now()
        ),
        (
          ${zeroPlantId}, 'Checkout Zero', NULL, 'Verify subtitle', 'Verify description',
          0, 'ILS', '["https://example.com/zero.jpg"]'::jsonb, '["verify"]'::jsonb,
          'Low light', 'Moderate', 'Easy', 'Indoor', false, '["water"]'::jsonb,
          'plants', false, now()
        )
    `;
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label, catalog_price)
      VALUES
        (${variantA}::uuid, ${pricedPlantId}, ${`A-${tag}`}, 40),
        (${variantB}::uuid, ${pricedPlantId}, ${`B-${tag}`}, 55)
    `;
    await sql`
      INSERT INTO pots (id, name, name_he)
      VALUES (${potId}::uuid, ${`Pot ${tag}`}, 'עציץ')
    `;
    await sql`
      INSERT INTO pot_variants (id, pot_id, size_label, color, color_he, catalog_price)
      VALUES (${potVariantId}::uuid, ${potId}::uuid, 'M', ${`clay-${tag}`}, 'חרס', 15)
    `;
    await sql`
      INSERT INTO inventory (variant_id, quantity, updated_at)
      VALUES
        (${variantA}::uuid, 8, now()),
        (${variantB}::uuid, 4, now())
    `;
    assert.equal(await historyCount(variantA), 0);
    assert.equal(await historyCount(variantB), 0);

    const partnerAttemptId = randomUUID();
    attemptIds.push(partnerAttemptId);
    await insertPaymentAttempt(attemptBase(partnerAttemptId, "partner", spot.id));
    const partnerLoaded = await getPaymentAttemptById(partnerAttemptId);
    assert.equal(partnerLoaded?.channel, "partner");
    assert.equal(partnerLoaded?.posSpotId, spot.id);
    assert.equal(partnerLoaded?.catalogSnapshot, undefined);

    const omittedChannelId = randomUUID();
    attemptIds.push(omittedChannelId);
    const omitted = attemptBase(omittedChannelId, "partner", spot.id);
    delete (omitted as { channel?: string }).channel;
    await insertPaymentAttempt(omitted);
    assert.equal((await getPaymentAttemptById(omittedChannelId))?.channel, "partner");

    let partnerNullRejected = false;
    try {
      await insertPaymentAttempt(attemptBase(randomUUID(), "partner", null));
    } catch {
      partnerNullRejected = true;
    }
    assert.equal(partnerNullRejected, true);

    let catalogSpotRejected = false;
    try {
      await insertPaymentAttempt(attemptBase(randomUUID(), "catalog", spot.id));
    } catch {
      catalogSpotRejected = true;
    }
    assert.equal(catalogSpotRejected, true);

    let badChannelRejected = false;
    try {
      const now = new Date().toISOString();
      const badId = randomUUID();
      await sql`
        INSERT INTO payment_attempts (
          id, status, pos_spot_id, channel, product_id, product_name, full_name,
          customer_email, phone, address, apartment_or_notes, fulfillment_method,
          amount, payment_resume_token, created_at, updated_at
        )
        VALUES (
          ${badId}::uuid, 'created', NULL, 'shop', ${pricedPlantId}, 'Bad', 'Bad',
          'bad@example.com', '', '', '', 'delivery', 1, ${`resume-${badId}`},
          ${now}::timestamptz, ${now}::timestamptz
        )
      `;
    } catch {
      badChannelRejected = true;
    }
    assert.equal(badChannelRejected, true);

    const catalogSnapshot = {
      sourcePartnerId: null,
      lines: [
        {
          lineNo: 1,
          plantId: pricedPlantId,
          plantVariantId: variantA,
          potVariantId: null,
          quantity: 2,
          plantUnitPrice: 40,
          potUnitPrice: null,
          lineTotal: 80,
          currency: "ILS" as const,
          plantName: "Checkout Priced",
          plantNameHe: "צמח",
          sizeLabel: `A-${tag}`,
          potName: null,
          potColor: null,
          plantUnitCost: 1,
          plantUnitCostSource: PLANT_UNIT_COST_SOURCE,
        },
        {
          lineNo: 2,
          plantId: pricedPlantId,
          plantVariantId: variantA,
          potVariantId,
          quantity: 1,
          plantUnitPrice: 40,
          potUnitPrice: 15,
          lineTotal: 55,
          currency: "ILS" as const,
          plantName: "Checkout Priced",
          plantNameHe: "צמח",
          sizeLabel: `A-${tag}`,
          potName: `Pot ${tag}`,
          potColor: `clay-${tag}`,
          plantUnitCost: null,
          plantUnitCostSource: null,
        },
      ],
    };
    const catalogAttemptId = randomUUID();
    attemptIds.push(catalogAttemptId);
    await insertPaymentAttempt({
      ...attemptBase(catalogAttemptId, "catalog", null),
      amount: 135,
      catalogSnapshot,
    });
    const catalogLoaded = await getPaymentAttemptById(catalogAttemptId);
    assert.equal(catalogLoaded?.posSpotId, null);
    assert.equal(catalogLoaded?.channel, "catalog");
    assert.equal(catalogLoaded?.catalogSnapshot?.lines.length, 2);
    for (const line of catalogLoaded?.catalogSnapshot?.lines ?? []) {
      assert.equal(line.plantUnitCost, 18.5);
      assert.equal(line.plantUnitCostSource, PLANT_UNIT_COST_SOURCE);
      assert.equal("potUnitCost" in line, false);
    }
    const storedSnapshot = await sql`
      SELECT catalog_snapshot
      FROM payment_attempts
      WHERE id = ${catalogAttemptId}::uuid
    `;
    const rawSnapshot = JSON.stringify((storedSnapshot as { catalog_snapshot: unknown }[])[0]?.catalog_snapshot);
    assert.doesNotMatch(rawSnapshot, /potUnitCost|pot_unit_cost|potCost/);

    await sql`
      UPDATE plants SET supplier_price = 99 WHERE id = ${pricedPlantId}
    `;
    const afterPriceChange = await getPaymentAttemptById(catalogAttemptId);
    assert.equal(afterPriceChange?.catalogSnapshot?.lines[0]?.plantUnitCost, 18.5);

    const zeroAttemptId = randomUUID();
    attemptIds.push(zeroAttemptId);
    await insertPaymentAttempt({
      ...attemptBase(zeroAttemptId, "catalog", null),
      productId: zeroPlantId,
      amount: 10,
      catalogSnapshot: {
        sourcePartnerId: null,
        lines: [
          {
            lineNo: 1,
            plantId: zeroPlantId,
            plantVariantId: variantB,
            potVariantId: null,
            quantity: 1,
            plantUnitPrice: 10,
            potUnitPrice: null,
            lineTotal: 10,
            currency: "ILS",
            plantName: "Checkout Zero",
            plantNameHe: null,
            sizeLabel: `B-${tag}`,
            potName: null,
            potColor: null,
            plantUnitCost: 4,
            plantUnitCostSource: PLANT_UNIT_COST_SOURCE,
          },
        ],
      },
    });
    const zeroLoaded = await getPaymentAttemptById(zeroAttemptId);
    assert.equal(zeroLoaded?.catalogSnapshot?.lines[0]?.plantUnitCost, null);
    assert.equal(zeroLoaded?.catalogSnapshot?.lines[0]?.plantUnitCostSource, null);

    const missingCosts = await (
      await import("../lib/catalogCheckoutSnapshot")
    ).snapshotPlantUnitCosts([`missing-${tag}`]);
    assert.deepEqual(missingCosts.get(`missing-${tag}`), {
      plantUnitCost: null,
      plantUnitCostSource: null,
    });

    assert.equal(await getCatalogAvailableQuantity(variantA), 8);
    const aggregateAttemptId = randomUUID();
    attemptIds.push(aggregateAttemptId);
    await insertPaymentAttempt({
      ...attemptBase(aggregateAttemptId, "catalog", null),
      catalogSnapshot: undefined,
    });
    const aggregated = await acquireCatalogStockHolds({
      attemptId: aggregateAttemptId,
      lines: [
        { plantVariantId: variantA, quantity: 2 },
        { plantVariantId: variantA, quantity: 3 },
      ],
    });
    assert.equal(aggregated.length, 1);
    assert.equal(aggregated[0]?.quantity, 5);
    assert.equal(aggregated[0]?.plantVariantId, variantA);
    assert.equal(await getCatalogAvailableQuantity(variantA), 3);
    assert.equal(await inventoryQty(variantA), 8);
    const ttlRows = await sql`
      SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) AS seconds
      FROM catalog_stock_holds
      WHERE attempt_id = ${aggregateAttemptId}::uuid
    `;
    assert.equal(Number((ttlRows as { seconds: string | number }[])[0]?.seconds), 17 * 60);

    let alreadyHeld = false;
    try {
      await acquireCatalogStockHolds({
        attemptId: aggregateAttemptId,
        lines: [{ plantVariantId: variantA, quantity: 1 }],
      });
    } catch (error) {
      alreadyHeld = error instanceof CatalogStockHoldError && error.code === "already_held";
    }
    assert.equal(alreadyHeld, true);
    assert.equal((await listCatalogStockHoldsForAttempt(aggregateAttemptId)).length, 1);

    assert.equal(await releaseCatalogStockHolds(aggregateAttemptId), 1);
    assert.equal((await listCatalogStockHoldsForAttempt(aggregateAttemptId))[0]?.status, "released");
    assert.equal(await getCatalogAvailableQuantity(variantA), 8);
    assert.equal(await inventoryQty(variantA), 8);

    const tooMuchId = randomUUID();
    attemptIds.push(tooMuchId);
    await insertPaymentAttempt(attemptBase(tooMuchId, "catalog", null));
    let insufficient = false;
    try {
      await acquireCatalogStockHolds({
        attemptId: tooMuchId,
        lines: [
          { plantVariantId: variantA, quantity: 5 },
          { plantVariantId: variantA, quantity: 4 },
        ],
      });
    } catch (error) {
      insufficient = error instanceof CatalogStockHoldError && error.code === "insufficient_quantity";
    }
    assert.equal(insufficient, true);
    assert.equal((await listCatalogStockHoldsForAttempt(tooMuchId)).length, 0);
    assert.equal(await inventoryQty(variantA), 8);

    const partialId = randomUUID();
    attemptIds.push(partialId);
    await insertPaymentAttempt(attemptBase(partialId, "catalog", null));
    let partialRejected = false;
    try {
      await acquireCatalogStockHolds({
        attemptId: partialId,
        lines: [
          { plantVariantId: variantA, quantity: 1 },
          { plantVariantId: variantB, quantity: 5 },
        ],
      });
    } catch (error) {
      partialRejected = error instanceof CatalogStockHoldError && error.code === "insufficient_quantity";
    }
    assert.equal(partialRejected, true);
    assert.equal((await listCatalogStockHoldsForAttempt(partialId)).length, 0);
    assert.equal(await inventoryQty(variantB), 4);

    const concurrentA = randomUUID();
    const concurrentB = randomUUID();
    attemptIds.push(concurrentA, concurrentB);
    await insertPaymentAttempt(attemptBase(concurrentA, "catalog", null));
    await insertPaymentAttempt(attemptBase(concurrentB, "catalog", null));
    const raced = await Promise.allSettled([
      acquireCatalogStockHolds({
        attemptId: concurrentA,
        lines: [{ plantVariantId: variantA, quantity: 6 }],
      }),
      acquireCatalogStockHolds({
        attemptId: concurrentB,
        lines: [{ plantVariantId: variantA, quantity: 4 }],
      }),
    ]);
    const won = raced.filter((result) => result.status === "fulfilled");
    const lost = raced.filter((result) => result.status === "rejected");
    assert.equal(won.length, 1, `concurrent wins ${won.length}`);
    assert.equal(lost.length, 1);
    const lostError = lost[0]?.status === "rejected" ? lost[0].reason : null;
    assert.equal(lostError instanceof CatalogStockHoldError, true);
    assert.equal((lostError as InstanceType<typeof CatalogStockHoldError>).code, "insufficient_quantity");
    const heldRows = await sql`
      SELECT COALESCE(SUM(quantity), 0)::int AS qty
      FROM catalog_stock_holds
      WHERE plant_variant_id = ${variantA}::uuid
        AND status = 'active'
        AND expires_at > now()
    `;
    const heldQty = (heldRows as { qty: number }[])[0]?.qty ?? 0;
    assert.equal(heldQty === 6 || heldQty === 4, true);
    assert.equal(await inventoryQty(variantA), 8);
    assert.equal(await getCatalogAvailableQuantity(variantA), 8 - heldQty);
    await releaseCatalogStockHolds(concurrentA);
    await releaseCatalogStockHolds(concurrentB);
    assert.equal(await getCatalogAvailableQuantity(variantA), 8);

    const multiId = randomUUID();
    attemptIds.push(multiId);
    await insertPaymentAttempt(attemptBase(multiId, "catalog", null));
    const multi = await acquireCatalogStockHolds({
      attemptId: multiId,
      lines: [
        { plantVariantId: variantA, quantity: 1 },
        { plantVariantId: variantA, quantity: 1 },
        { plantVariantId: variantB, quantity: 1 },
      ],
    });
    assert.equal(multi.length, 2);
    const multiA = multi.find((hold) => hold.plantVariantId === variantA);
    const multiB = multi.find((hold) => hold.plantVariantId === variantB);
    assert.equal(multiA?.quantity, 2);
    assert.equal(multiB?.quantity, 1);
    assert.equal(await getCatalogAvailableQuantity(variantA), 6);
    assert.equal(await getCatalogAvailableQuantity(variantB), 3);

    await sql`
      UPDATE catalog_stock_holds
      SET expires_at = now() - interval '1 second'
      WHERE attempt_id = ${multiId}::uuid
        AND plant_variant_id = ${variantA}::uuid
    `;
    assert.equal(await getCatalogAvailableQuantity(variantA), 8);
    assert.equal(await inventoryQty(variantA), 8);
    const expiredCount = await expireStaleCatalogStockHolds({ attemptId: multiId });
    assert.equal(expiredCount, 1);
    const expiredHold = (await listCatalogStockHoldsForAttempt(multiId)).find(
      (hold) => hold.plantVariantId === variantA,
    );
    assert.equal(expiredHold?.status, "expired");
    assert.equal(await getCatalogAvailableQuantity(variantA), 8);
    assert.equal((await listCatalogStockHoldsForAttempt(multiId)).find((hold) => hold.plantVariantId === variantB)?.status, "active");
    assert.equal(await releaseCatalogStockHolds(multiId), 1);
    assert.equal(await getCatalogAvailableQuantity(variantB), 4);

    const consumeId = randomUUID();
    attemptIds.push(consumeId);
    await insertPaymentAttempt(attemptBase(consumeId, "catalog", null));
    await acquireCatalogStockHolds({
      attemptId: consumeId,
      lines: [{ plantVariantId: variantA, quantity: 1 }],
    });
    assert.equal(await consumeCatalogStockHolds(consumeId), 1);
    assert.equal((await listCatalogStockHoldsForAttempt(consumeId))[0]?.status, "consumed");
    assert.equal(await consumeCatalogStockHolds(consumeId), 0);
    assert.equal(await getCatalogAvailableQuantity(variantA), 8);
    assert.equal(await inventoryQty(variantA), 8);
    assert.equal(await historyCount(variantA), 0);
    assert.equal(await historyCount(variantB), 0);

    let potRejected = false;
    try {
      await acquireCatalogStockHolds({
        attemptId: consumeId,
        lines: [{ plantVariantId: potVariantId, quantity: 1 }],
      });
    } catch (error) {
      potRejected = error instanceof CatalogStockHoldError && error.code === "variant_not_found";
    }
    assert.equal(potRejected, true);

    let partnerHoldRejected = false;
    try {
      await acquireCatalogStockHolds({
        attemptId: partnerAttemptId,
        lines: [{ plantVariantId: variantA, quantity: 1 }],
      });
    } catch (error) {
      partnerHoldRejected =
        error instanceof CatalogStockHoldError && error.code === "not_catalog_attempt";
    }
    assert.equal(partnerHoldRejected, true);

    const orderId = randomUUID();
    const otherOrderId = randomUUID();
    orderIds.push(orderId, otherOrderId);
    const now = new Date().toISOString();
    await sql`
      INSERT INTO orders (
        order_id, product_id, product_name, price, full_name, phone,
        address, apartment_or_notes, fulfillment_method, order_status, created_at,
        channel, partner_id, source
      )
      VALUES
        (
          ${orderId}::uuid, ${pricedPlantId}, 'Checkout Priced', 135, 'Checkout Verify',
          '0500000000', 'Verify 1', '', 'delivery', 'sold', ${now}::timestamptz,
          'catalog', NULL, 'online'
        ),
        (
          ${otherOrderId}::uuid, ${zeroPlantId}, 'Checkout Zero', 10, 'Checkout Verify',
          '0500000000', 'Verify 1', '', 'delivery', 'sold', ${now}::timestamptz,
          'catalog', NULL, 'online'
        )
    `;
    const snapshot = afterPriceChange?.catalogSnapshot;
    assert.ok(snapshot);
    const inserted = await insertOrderItems(orderId, orderItemsFromCatalogSnapshot(snapshot));
    assert.equal(inserted.length, 2);
    assert.equal(inserted[0]?.plantUnitCost, 18.5);
    assert.equal(inserted[1]?.potUnitPrice, 15);
    assert.equal(inserted[1]?.plantUnitCost, 18.5);
    const zeroItems = await insertOrderItems(
      otherOrderId,
      orderItemsFromCatalogSnapshot(zeroLoaded!.catalogSnapshot!),
    );
    assert.equal(zeroItems[0]?.plantUnitCost, null);
    assert.equal(zeroItems[0]?.plantUnitCostSource, null);

    await sql`UPDATE plants SET supplier_price = 0 WHERE id = ${pricedPlantId}`;
    const readBack = await getOrderItemsByOrderId(orderId);
    assert.equal(readBack.length, 2);
    assert.equal(readBack[0]?.plantUnitCost, 18.5);
    assert.equal(readBack[0]?.plantUnitCostSource, PLANT_UNIT_COST_SOURCE);
    assert.equal(readBack[1]?.potName, `Pot ${tag}`);
    const byIds = await getOrderItemsByOrderIds([orderId, otherOrderId]);
    assert.equal(byIds.get(orderId)?.length, 2);
    assert.equal(byIds.get(otherOrderId)?.length, 1);
    assert.equal(byIds.get(otherOrderId)?.[0]?.plantUnitCost, null);

    let badTotalRejected = false;
    try {
      await sql`
        INSERT INTO order_items (
          order_id, line_no, plant_id, plant_variant_id, quantity,
          plant_unit_price, line_total, currency, plant_name
        )
        VALUES (
          ${orderId}::uuid, 9, ${pricedPlantId}, ${variantA}::uuid, 1,
          10, 11, 'ILS', 'Checkout Priced'
        )
      `;
    } catch {
      badTotalRejected = true;
    }
    assert.equal(badTotalRejected, true);

    let zeroCostRejected = false;
    try {
      await sql`
        INSERT INTO order_items (
          order_id, line_no, plant_id, plant_variant_id, quantity,
          plant_unit_price, line_total, currency, plant_name, plant_unit_cost
        )
        VALUES (
          ${orderId}::uuid, 8, ${pricedPlantId}, ${variantA}::uuid, 1,
          10, 10, 'ILS', 'Checkout Priced', 0
        )
      `;
    } catch {
      zeroCostRejected = true;
    }
    assert.equal(zeroCostRejected, true);

    await sql`DELETE FROM pots WHERE id = ${potId}::uuid`;
    for (const attemptId of attemptIds) {
      await deletePaymentAttemptById(attemptId);
    }
    attemptIds.length = 0;
    await sql`DELETE FROM inventory WHERE variant_id IN (${variantA}::uuid, ${variantB}::uuid)`;
    await sql`DELETE FROM plant_variants WHERE id IN (${variantA}::uuid, ${variantB}::uuid)`;
    await sql`DELETE FROM plants WHERE id IN (${pricedPlantId}, ${zeroPlantId})`;
    const afterDelete = await getOrderItemsByOrderId(orderId);
    assert.equal(afterDelete.length, 2);
    assert.equal(afterDelete[1]?.potVariantId, potVariantId);
    assert.equal(afterDelete[1]?.potColor, `clay-${tag}`);
    assert.equal(afterDelete[0]?.plantName, "Checkout Priced");
    assert.equal(afterDelete[0]?.plantUnitCost, 18.5);
    assert.equal("potUnitCost" in afterDelete[0]!, false);

    let orderDeleteBlocked = false;
    try {
      await sql`DELETE FROM orders WHERE order_id = ${orderId}::uuid`;
    } catch {
      orderDeleteBlocked = true;
    }
    assert.equal(orderDeleteBlocked, true);
    assert.equal((await getOrderItemsByOrderId(orderId)).length, 2);

    const spotAfterRows = await sql`
      SELECT id, status, payment_hold_attempt_id, plant_variant_id, current_offer_id
      FROM pos_spots
      WHERE id = ${spot.id}::uuid
    `;
    assert.deepEqual(spotAfterRows[0], spotBefore);
    assert.deepEqual(await posStatusHistogram(sql), posBefore);
    assert.equal(await countRows(sql, "pos_spots"), posCountBefore);
    assert.equal(await countRows(sql, "inventory"), inventoryCountBefore);
    assert.equal(await historyCount(variantA), 0);

    console.log("verify-catalog-checkout-data: schema, holds, snapshots, and POS isolation ok");
  } finally {
    for (const orderId of orderIds) {
      await sql`DELETE FROM order_items WHERE order_id = ${orderId}::uuid`.catch(() => undefined);
      await sql`DELETE FROM orders WHERE order_id = ${orderId}::uuid`.catch(() => undefined);
    }
    for (const attemptId of attemptIds) {
      await deletePaymentAttemptById(attemptId).catch(() => undefined);
    }
    await sql`DELETE FROM inventory WHERE variant_id IN (${variantA}::uuid, ${variantB}::uuid)`.catch(
      () => undefined,
    );
    await sql`DELETE FROM inventory_history WHERE variant_id IN (${variantA}::uuid, ${variantB}::uuid)`.catch(
      () => undefined,
    );
    await sql`DELETE FROM pots WHERE id = ${potId}::uuid`.catch(() => undefined);
    await sql`DELETE FROM plant_variants WHERE id IN (${variantA}::uuid, ${variantB}::uuid)`.catch(
      () => undefined,
    );
    await sql`DELETE FROM plants WHERE id IN (${pricedPlantId}, ${zeroPlantId})`.catch(() => undefined);
    assert.equal(await countRows(sql, "orders"), orderCountBefore);
    assert.equal(await countRows(sql, "pos_spots"), posCountBefore);
  }
}

async function countRows(sql: Sql, table: "orders" | "pos_spots" | "inventory"): Promise<number> {
  const rows =
    table === "orders"
      ? await sql`SELECT COUNT(*)::int AS n FROM orders`
      : table === "pos_spots"
        ? await sql`SELECT COUNT(*)::int AS n FROM pos_spots`
        : await sql`SELECT COUNT(*)::int AS n FROM inventory`;
  return (rows as { n: number }[])[0]?.n ?? 0;
}

async function posStatusHistogram(sql: Sql): Promise<{ status: string; n: number }[]> {
  const rows = await sql`
    SELECT status, COUNT(*)::int AS n
    FROM pos_spots
    GROUP BY status
    ORDER BY status ASC
  `;
  return rows as { status: string; n: number }[];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

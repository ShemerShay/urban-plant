/**
 * Phase 1.4: central inventory schema + atomic quantity/history helper.
 * Does not change checkout, POS, payments, or admin UI.
 *
 * Run: npx tsx scripts/verify-central-inventory-schema.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertPartnerPosPaymentUnchanged(): void {
  const paymentPrep = read("lib/startCardcomPaymentPrep.ts");
  assert.doesNotMatch(paymentPrep, /inventoryStorage/);
  assert.doesNotMatch(paymentPrep, /applyInventoryDelta/);
  assert.doesNotMatch(paymentPrep, /inventory_history/);
  assert.match(paymentPrep, /posSpot\.currentOfferId/);

  const finalize = read("lib/paymentAttemptStorage.ts");
  assert.doesNotMatch(finalize, /applyInventoryDelta/);
  assert.doesNotMatch(finalize, /FROM inventory/);

  const pos = read("lib/posSpotStorage.ts");
  assert.doesNotMatch(pos, /applyInventoryDelta/);
  assert.match(pos, /held_for_payment/);

  const storage = read("lib/inventoryStorage.ts");
  assert.doesNotMatch(storage, /UPDATE inventory_history/i);
  assert.doesNotMatch(storage, /DELETE FROM inventory_history/i);
  assert.match(storage, /INSERT INTO inventory_history/);
  assert.match(storage, /INSERT INTO inventory /);

  console.log("verify-central-inventory-schema: Partner/POS/payment writers do not touch inventory");
}

async function main(): Promise<void> {
  assertPartnerPosPaymentUnchanged();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const { sql } = await import("../lib/db");
  const {
    InventoryChangeError,
    applyInventoryDelta,
    getInventoryBalance,
    getInventoryQuantity,
    readInventoryHistory,
  } = await import("../lib/inventoryStorage");

  const inventoryCols = await sql`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory'
    ORDER BY ordinal_position
  `;
  assert.deepEqual(
    (inventoryCols as { column_name: string }[]).map((row) => row.column_name),
    ["variant_id", "quantity", "updated_at"],
  );
  const inventoryByName = Object.fromEntries(
    (
      inventoryCols as {
        column_name: string;
        is_nullable: string;
        data_type: string;
      }[]
    ).map((row) => [row.column_name, row]),
  );
  assert.equal(inventoryByName.variant_id.data_type, "uuid");
  assert.equal(inventoryByName.quantity.data_type, "integer");
  assert.equal(inventoryByName.quantity.is_nullable, "NO");
  assert.equal(inventoryByName.updated_at.is_nullable, "NO");

  const historyCols = await sql`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_history'
    ORDER BY ordinal_position
  `;
  assert.deepEqual(
    (historyCols as { column_name: string }[]).map((row) => row.column_name),
    ["id", "variant_id", "delta", "note", "created_at"],
  );
  const historyByName = Object.fromEntries(
    (
      historyCols as {
        column_name: string;
        is_nullable: string;
        data_type: string;
      }[]
    ).map((row) => [row.column_name, row]),
  );
  assert.equal(historyByName.delta.data_type, "integer");
  assert.equal(historyByName.delta.is_nullable, "NO");
  assert.equal(historyByName.note.is_nullable, "YES");
  assert.equal(historyByName.created_at.is_nullable, "NO");

  const extraInventoryCols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('inventory', 'inventory_history')
      AND column_name IN (
        'movement_type', 'reference_kind', 'reference_id', 'created_by',
        'location_id', 'partner_id', 'partner_location_id', 'from_inventory_location_id'
      )
  `;
  assert.equal((extraInventoryCols as unknown[]).length, 0, "no unapproved inventory columns");

  const inventoryLocations = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'inventory_locations'
  `;
  assert.equal((inventoryLocations as unknown[]).length, 0);

  const constraints = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid IN ('inventory'::regclass, 'inventory_history'::regclass)
  `;
  const defs = (constraints as { def: string }[]).map((row) => row.def);
  assert.ok(defs.some((def) => /quantity >= 0/.test(def)), "quantity >= 0");
  assert.ok(defs.some((def) => /delta <> 0/.test(def) || /delta != 0/.test(def)), "delta <> 0");
  assert.ok(
    defs.some((def) => /FOREIGN KEY \(variant_id\)/.test(def) && /plant_variants/.test(def)),
    "variant_id -> plant_variants.id",
  );

  const orderCountBefore = await sql`SELECT COUNT(*)::int AS n FROM orders`;
  const posCountBefore = await sql`SELECT COUNT(*)::int AS n FROM pos_spots`;
  const orderNBefore = (orderCountBefore as { n: number }[])[0].n;
  const posNBefore = (posCountBefore as { n: number }[])[0].n;

  const plantRows = await sql`
    SELECT id FROM plants
    WHERE COALESCE(inventory_type, 'plants') = 'plants'
    ORDER BY created_at ASC NULLS LAST, id ASC
    LIMIT 1
  `;
  const flowerRows = await sql`
    SELECT id FROM plants
    WHERE inventory_type = 'flowers'
    ORDER BY created_at ASC NULLS LAST, id ASC
    LIMIT 1
  `;
  const plantId = (plantRows as { id: string }[])[0]?.id;
  const flowerId = (flowerRows as { id: string }[])[0]?.id;
  assert.ok(plantId, "need a plant catalog row");
  assert.ok(flowerId, "need a flower catalog row");

  const plantVariantId = randomUUID();
  const flowerVariantId = randomUUID();
  const missingVariantId = randomUUID();

  const leftoverVerify = await sql`
    SELECT id FROM plant_variants WHERE size_label LIKE 'inventory-verify%'
  `;
  const leftoverIds = (leftoverVerify as { id: string }[]).map((row) => row.id);
  if (leftoverIds.length > 0) {
    await sql`DELETE FROM inventory_history WHERE variant_id = ANY(${leftoverIds}::uuid[])`;
    await sql`DELETE FROM inventory WHERE variant_id = ANY(${leftoverIds}::uuid[])`;
    await sql`DELETE FROM plant_variants WHERE id = ANY(${leftoverIds}::uuid[])`;
  }

  try {
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label)
      VALUES
        (${plantVariantId}::uuid, ${plantId}, 'inventory-verify'),
        (${flowerVariantId}::uuid, ${flowerId}, 'inventory-verify-flower')
    `;

    assert.equal(await getInventoryQuantity(plantVariantId), 0);
    assert.equal(await getInventoryBalance(plantVariantId), null);
    assert.deepEqual(await readInventoryHistory(plantVariantId), []);

    let zeroRejected = false;
    try {
      await applyInventoryDelta({ variantId: plantVariantId, delta: 0 });
    } catch (error) {
      zeroRejected = true;
      assert.ok(error instanceof InventoryChangeError);
      assert.equal(error.code, "delta_zero");
    }
    assert.equal(zeroRejected, true);
    assert.equal(await getInventoryQuantity(plantVariantId), 0);
    assert.equal((await readInventoryHistory(plantVariantId)).length, 0);

    let invalidRejected = false;
    try {
      await applyInventoryDelta({ variantId: plantVariantId, delta: 1.5 });
    } catch (error) {
      invalidRejected = true;
      assert.ok(error instanceof InventoryChangeError);
      assert.equal(error.code, "invalid_delta");
    }
    assert.equal(invalidRejected, true);

    const first = await applyInventoryDelta({
      variantId: plantVariantId,
      delta: 5,
      note: "supplier delivery",
    });
    assert.equal(first.quantity, 5);
    assert.equal(await getInventoryQuantity(plantVariantId), 5);
    const afterFirst = await readInventoryHistory(plantVariantId);
    assert.equal(afterFirst.length, 1);
    assert.equal(afterFirst[0]?.delta, 5);
    assert.equal(afterFirst[0]?.note, "supplier delivery");

    const second = await applyInventoryDelta({
      variantId: plantVariantId,
      delta: 2,
      note: "correction",
    });
    assert.equal(second.quantity, 7);

    const third = await applyInventoryDelta({
      variantId: plantVariantId,
      delta: -3,
      note: "sent to partner",
    });
    assert.equal(third.quantity, 4);
    const history = await readInventoryHistory(plantVariantId);
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((row) => row.delta),
      [5, 2, -3],
    );
    assert.equal(history[0]?.delta, 5, "earlier history rows are not rewritten");

    const historyCountBeforeFail = history.length;
    let belowZeroRejected = false;
    try {
      await applyInventoryDelta({ variantId: plantVariantId, delta: -10 });
    } catch (error) {
      belowZeroRejected = true;
      assert.ok(error instanceof InventoryChangeError);
      assert.equal(error.code, "insufficient_quantity");
    }
    assert.equal(belowZeroRejected, true);
    assert.equal(await getInventoryQuantity(plantVariantId), 4);
    assert.equal((await readInventoryHistory(plantVariantId)).length, historyCountBeforeFail);

    const emptyVariantId = randomUUID();
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label)
      VALUES (${emptyVariantId}::uuid, ${plantId}, 'inventory-verify-empty')
    `;
    let emptyNegativeRejected = false;
    try {
      await applyInventoryDelta({ variantId: emptyVariantId, delta: -1 });
    } catch (error) {
      emptyNegativeRejected = true;
      assert.ok(error instanceof InventoryChangeError);
      assert.equal(error.code, "insufficient_quantity");
    }
    assert.equal(emptyNegativeRejected, true);
    assert.equal(await getInventoryQuantity(emptyVariantId), 0);
    assert.equal(await getInventoryBalance(emptyVariantId), null);
    assert.equal((await readInventoryHistory(emptyVariantId)).length, 0);
    await sql`DELETE FROM plant_variants WHERE id = ${emptyVariantId}::uuid`;

    let missingRejected = false;
    try {
      await applyInventoryDelta({ variantId: missingVariantId, delta: 1 });
    } catch (error) {
      missingRejected = true;
      assert.ok(error instanceof InventoryChangeError);
      assert.equal(error.code, "variant_not_found");
    }
    assert.equal(missingRejected, true);

    let flowerRejected = false;
    try {
      await applyInventoryDelta({ variantId: flowerVariantId, delta: 4, note: "should fail" });
    } catch (error) {
      flowerRejected = true;
      assert.ok(error instanceof InventoryChangeError);
      assert.equal(error.code, "flower_variant");
    }
    assert.equal(flowerRejected, true);
    assert.equal(await getInventoryQuantity(flowerVariantId), 0);
    const flowerInventory = await sql`
      SELECT COUNT(*)::int AS n FROM inventory WHERE variant_id = ${flowerVariantId}::uuid
    `;
    const flowerHistory = await sql`
      SELECT COUNT(*)::int AS n FROM inventory_history WHERE variant_id = ${flowerVariantId}::uuid
    `;
    assert.equal((flowerInventory as { n: number }[])[0].n, 0);
    assert.equal((flowerHistory as { n: number }[])[0].n, 0);

    let deltaZeroConstraint = false;
    try {
      await sql`
        INSERT INTO inventory_history (variant_id, delta)
        VALUES (${plantVariantId}::uuid, 0)
      `;
    } catch {
      deltaZeroConstraint = true;
    }
    assert.equal(deltaZeroConstraint, true, "DB rejects delta 0");

    console.log("verify-central-inventory-schema: quantity + history behavior ok");
  } finally {
    await sql`DELETE FROM inventory_history WHERE variant_id IN (
      ${plantVariantId}::uuid, ${flowerVariantId}::uuid
    )`;
    await sql`DELETE FROM inventory WHERE variant_id IN (
      ${plantVariantId}::uuid, ${flowerVariantId}::uuid
    )`;
    await sql`DELETE FROM plant_variants WHERE id IN (
      ${plantVariantId}::uuid, ${flowerVariantId}::uuid
    )`;
  }

  const leftover = await sql`
    SELECT COUNT(*)::int AS n
    FROM plant_variants
    WHERE size_label LIKE 'inventory-verify%'
  `;
  assert.equal((leftover as { n: number }[])[0].n, 0);

  const orderCountAfter = await sql`SELECT COUNT(*)::int AS n FROM orders`;
  const posCountAfter = await sql`SELECT COUNT(*)::int AS n FROM pos_spots`;
  assert.equal((orderCountAfter as { n: number }[])[0].n, orderNBefore);
  assert.equal((posCountAfter as { n: number }[])[0].n, posNBefore);

  console.log("verify-central-inventory-schema: existing orders/POS untouched");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

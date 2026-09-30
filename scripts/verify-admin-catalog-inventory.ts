/**
 * Admin Catalog + central inventory: publish flag, catalog_price, variant CRUD, qty adjust.
 * Does not change POS checkout pricing, occupancy, Cycle/Segment, or payments.
 *
 * Run: npx tsx scripts/verify-admin-catalog-inventory.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertPosCheckoutUnchanged(): void {
  const paymentPrep = read("lib/startCardcomPaymentPrep.ts");
  assert.match(paymentPrep, /offer\.consumerPrice/);
  assert.doesNotMatch(paymentPrep, /catalog_price/);
  assert.doesNotMatch(paymentPrep, /catalogPrice/);
  assert.doesNotMatch(paymentPrep, /catalog_published/);

  const offerStorage = read("lib/offerStorage.ts");
  assert.match(offerStorage, /consumer_price/);
  assert.doesNotMatch(offerStorage, /catalog_price/);

  console.log("verify-admin-catalog-inventory: POS checkout still uses offers.consumer_price");
}

function assertAdminApiGuarded(): void {
  const variants = read("app/api/plants/[plantId]/variants/route.ts");
  assert.match(variants, /isAdminRequest/);
  const variantId = read("app/api/plants/[plantId]/variants/[variantId]/route.ts");
  assert.match(variantId, /isAdminRequest/);
  const inventory = read("app/api/plants/[plantId]/variants/[variantId]/inventory/route.ts");
  assert.match(inventory, /isAdminRequest/);
  assert.match(inventory, /note is required/);
  const plantPatch = read("app/api/plants/[plantId]/route.ts");
  assert.match(plantPatch, /isAdminRequest/);
  assert.match(plantPatch, /resolveCatalogPublishedInput/);
  const plantPost = read("app/api/plants/route.ts");
  assert.match(plantPost, /isAdminRequest/);
  console.log("verify-admin-catalog-inventory: catalog mutation APIs require admin session");
}

async function main(): Promise<void> {
  assertPosCheckoutUnchanged();
  assertAdminApiGuarded();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const { sql } = await import("../lib/db");
  const {
    CatalogPublishError,
    createPlant,
    deletePlant,
    getPlantByIdAsync,
    readPlants,
    updatePlant,
  } = await import("../lib/plantStorage");
  const {
    PlantVariantWriteError,
    createPlantVariant,
    deletePlantVariant,
    readPlantVariantsWithQuantity,
    updatePlantVariant,
  } = await import("../lib/plantVariantStorage");
  const {
    InventoryChangeError,
    applyInventoryDelta,
    getInventoryQuantity,
    readInventoryHistory,
  } = await import("../lib/inventoryStorage");
  const { resolveCatalogPublishedInput } = await import("../lib/plantValidation");

  const plantCols = await sql`
    SELECT column_name, is_nullable, column_default, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plants' AND column_name = 'catalog_published'
  `;
  const publishedCols = plantCols as {
    is_nullable: string;
    column_default: string | null;
    data_type: string;
  }[];
  assert.equal(publishedCols.length, 1);
  const publishedCol = publishedCols[0];
  assert.ok(publishedCol);
  assert.equal(publishedCol.data_type, "boolean");
  assert.equal(publishedCol.is_nullable, "NO");
  assert.match(String(publishedCol.column_default), /false/);

  const unpublished = await sql`
    SELECT COUNT(*)::int AS n FROM plants WHERE catalog_published = true
  `;
  assert.equal((unpublished as { n: number }[])[0].n, 0, "existing plants stay unpublished");

  const flowerPublished = await sql`
    SELECT COUNT(*)::int AS n
    FROM plants
    WHERE inventory_type = 'flowers' AND catalog_published = true
  `;
  assert.equal((flowerPublished as { n: number }[])[0].n, 0);

  const checks = await sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'plant_variants'::regclass
      AND conname = 'plant_variants_catalog_price_positive'
  `;
  assert.match(
    (checks as { def: string }[])[0]?.def ?? "",
    /catalog_price > \(0\)::numeric|catalog_price > 0/,
  );

  const noAuth = resolveCatalogPublishedInput({
    body: { catalogPublished: true },
    isAdmin: false,
  });
  assert.equal(noAuth.ok, false);
  if (!noAuth.ok) assert.equal(noAuth.status, 401);
  const omitted = resolveCatalogPublishedInput({
    body: { name: "x" },
    isAdmin: false,
    existing: true,
  });
  assert.equal(omitted.ok, true);
  if (omitted.ok) assert.equal(omitted.value, true);

  const plants = await sql`
    SELECT id, inventory_type
    FROM plants
    ORDER BY created_at ASC NULLS LAST, id ASC
  `;
  const plantRows = plants as { id: string; inventory_type: string }[];
  const plantRow = plantRows.find((row) => (row.inventory_type ?? "plants") === "plants");
  const flowerRow = plantRows.find((row) => row.inventory_type === "flowers");
  assert.ok(plantRow, "need a plant catalog row");
  assert.ok(flowerRow, "need a flower catalog row");

  const sourcePlant = await getPlantByIdAsync(plantRow.id);
  const flower = await getPlantByIdAsync(flowerRow.id);
  assert.ok(sourcePlant);
  assert.ok(flower);

  let flowerPublishRejected = false;
  try {
    await updatePlant(flower.id, { ...flower, catalogPublished: true });
  } catch (error) {
    flowerPublishRejected = true;
    assert.ok(error instanceof CatalogPublishError);
  }
  assert.equal(flowerPublishRejected, true);
  const flowerAfter = await getPlantByIdAsync(flower.id);
  assert.equal(flowerAfter?.catalogPublished === true, false);

  const leftover = await sql`
    SELECT id FROM plant_variants WHERE size_label LIKE 'catalog-admin-verify%'
  `;
  const leftoverIds = (leftover as { id: string }[]).map((row) => row.id);
  if (leftoverIds.length > 0) {
    await sql`DELETE FROM inventory_history WHERE variant_id = ANY(${leftoverIds}::uuid[])`;
    await sql`DELETE FROM inventory WHERE variant_id = ANY(${leftoverIds}::uuid[])`;
    await sql`DELETE FROM offers WHERE variant_id = ANY(${leftoverIds}::uuid[])`;
    await sql`DELETE FROM plant_variants WHERE id = ANY(${leftoverIds}::uuid[])`;
  }

  const tag = `catalog-admin-verify-${randomUUID().slice(0, 8)}`;
  const testPlantId = randomUUID();
  const offerId = `${tag}-offer`;
  let variantA = "";
  let variantB = "";

  const cyclesBefore = await sql`SELECT COUNT(*)::int AS n FROM placement_cycles`;
  const segmentsBefore = await sql`SELECT COUNT(*)::int AS n FROM placement_segments`;
  const cycleN = (cyclesBefore as { n: number }[])[0].n;
  const segmentN = (segmentsBefore as { n: number }[])[0].n;

  try {
    const createdPlant = await createPlant({
      ...sourcePlant,
      id: testPlantId,
      name: tag,
      catalogPublished: false,
      createdAt: new Date().toISOString(),
    });
    assert.equal(createdPlant.catalogPublished === true, false);

    const published = await updatePlant(testPlantId, {
      ...createdPlant,
      catalogPublished: true,
    });
    assert.equal(published?.catalogPublished, true);

    let flowerVariantRejected = false;
    try {
      await createPlantVariant({
        plantId: flower.id,
        sizeLabel: `${tag}-flower`,
      });
    } catch (error) {
      flowerVariantRejected = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "flower_plant");
    }
    assert.equal(flowerVariantRejected, true);

    let identityRejected = false;
    try {
      await createPlantVariant({ plantId: testPlantId });
    } catch (error) {
      identityRejected = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "identity_required");
    }
    assert.equal(identityRejected, true);

    const created = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: `${tag}-m`,
      catalogPrice: 120,
    });
    variantA = created.id;
    assert.equal(created.catalogPrice, 120);
    assert.equal(await getInventoryQuantity(variantA), 0);
    const listed = await readPlantVariantsWithQuantity(testPlantId);
    assert.equal(listed.some((row) => row.id === variantA && row.quantity === 0), true);

    let badPrice = false;
    try {
      await updatePlantVariant({
        plantId: testPlantId,
        variantId: variantA,
        catalogPrice: 0,
      });
    } catch (error) {
      badPrice = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "invalid_catalog_price");
    }
    assert.equal(badPrice, true);

    const priced = await updatePlantVariant({
      plantId: testPlantId,
      variantId: variantA,
      catalogPrice: 99.5,
    });
    assert.equal(priced.catalogPrice, 99.5);

    const cleared = await updatePlantVariant({
      plantId: testPlantId,
      variantId: variantA,
      catalogPrice: null,
    });
    assert.equal(cleared.catalogPrice ?? null, null);

    const second = await createPlantVariant({
      plantId: testPlantId,
      nurseryPotDiameterCm: 14,
      sizeLabel: `${tag}-l`,
    });
    variantB = second.id;

    let duplicate = false;
    try {
      await createPlantVariant({
        plantId: testPlantId,
        sizeLabel: `${tag}-m`,
      });
    } catch (error) {
      duplicate = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "duplicate_size_label");
    }
    assert.equal(duplicate, true);

    let immutable = false;
    try {
      await updatePlantVariant({
        plantId: testPlantId,
        variantId: variantA,
        plantIdFromBody: flower.id,
      });
    } catch (error) {
      immutable = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "plant_id_immutable");
    }
    assert.equal(immutable, true);

    const inventoryBeforePrice = await getInventoryQuantity(variantA);
    await updatePlantVariant({
      plantId: testPlantId,
      variantId: variantA,
      catalogPrice: 80,
    });
    await updatePlant(testPlantId, {
      ...(await getPlantByIdAsync(testPlantId))!,
      catalogPublished: false,
    });
    assert.equal(await getInventoryQuantity(variantA), inventoryBeforePrice);
    const cyclesAfterPrice = await sql`SELECT COUNT(*)::int AS n FROM placement_cycles`;
    const segmentsAfterPrice = await sql`SELECT COUNT(*)::int AS n FROM placement_segments`;
    assert.equal((cyclesAfterPrice as { n: number }[])[0].n, cycleN);
    assert.equal((segmentsAfterPrice as { n: number }[])[0].n, segmentN);

    const plus = await applyInventoryDelta({
      variantId: variantA,
      delta: 3,
      note: `${tag} receive`,
    });
    assert.equal(plus.quantity, 3);
    const minus = await applyInventoryDelta({
      variantId: variantA,
      delta: -1,
      note: `${tag} send`,
    });
    assert.equal(minus.quantity, 2);
    const history = await readInventoryHistory(variantA);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.delta, 3);
    assert.equal(history[0]?.note, `${tag} receive`);
    assert.equal(history[1]?.delta, -1);

    let belowZero = false;
    try {
      await applyInventoryDelta({ variantId: variantA, delta: -10, note: `${tag} too far` });
    } catch (error) {
      belowZero = true;
      assert.ok(error instanceof InventoryChangeError);
      assert.equal(error.code, "insufficient_quantity");
    }
    assert.equal(belowZero, true);
    assert.equal(await getInventoryQuantity(variantA), 2);
    assert.equal((await readInventoryHistory(variantA)).length, 2);

    await sql`
      INSERT INTO offers (id, product_id, variant_id, consumer_price, status, created_at)
      VALUES (${offerId}, ${testPlantId}, ${variantA}::uuid, 50, 'active', now())
    `;
    let inUse = false;
    try {
      await deletePlantVariant({ plantId: testPlantId, variantId: variantA });
    } catch (error) {
      inUse = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "in_use");
    }
    assert.equal(inUse, true);

    await deletePlantVariant({ plantId: testPlantId, variantId: variantB });
    const remaining = await readPlantVariantsWithQuantity(testPlantId);
    assert.equal(remaining.some((row) => row.id === variantB), false);

    const plantsList = await readPlants({ inventoryType: "plants" });
    assert.equal(
      plantsList.find((row) => row.id === testPlantId)?.catalogPublished === true,
      false,
    );
  } finally {
    await sql`DELETE FROM offers WHERE id = ${offerId}`;
    if (variantA) {
      await sql`DELETE FROM inventory_history WHERE variant_id = ${variantA}::uuid`;
      await sql`DELETE FROM inventory WHERE variant_id = ${variantA}::uuid`;
      await sql`DELETE FROM plant_variants WHERE id = ${variantA}::uuid`;
    }
    if (variantB) {
      await sql`DELETE FROM inventory_history WHERE variant_id = ${variantB}::uuid`;
      await sql`DELETE FROM inventory WHERE variant_id = ${variantB}::uuid`;
      await sql`DELETE FROM plant_variants WHERE id = ${variantB}::uuid`;
    }
    await deletePlant(testPlantId);
  }

  console.log("verify-admin-catalog-inventory: ok");
}

main().catch((error) => {
  console.error("verify-admin-catalog-inventory FAILED", error);
  process.exit(1);
});

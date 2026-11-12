/**
 * Plant sizes, and the Slice 7 removal of offers.variant_id,
 * plant_variants.catalog_price, and plants.average_size.
 *
 * Run: npx tsx scripts/verify-plant-variants-schema.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertCheckoutUnchanged(): void {
  const paymentPrep = read("lib/startCardcomPaymentPrep.ts");
  assert.match(paymentPrep, /posSpot\.currentOfferId/);
  assert.match(paymentPrep, /offer\.productId !== catalogPlant\.id/);
  assert.match(paymentPrep, /offer\.consumerPrice/);
  assert.doesNotMatch(paymentPrep, /variantId/);
  assert.doesNotMatch(paymentPrep, /variant_id/);

  const landing = read("lib/posLandingRead.ts");
  assert.match(landing, /pl\.id = o\.product_id/);
  assert.match(landing, /posSpot\.currentOfferId/);

  const plants = read("lib/types.ts");
  assert.doesNotMatch(plants, /averageSize/);
  assert.doesNotMatch(read("lib/plantStorage.ts"), /average_size/);
  assert.doesNotMatch(read("lib/plantValidation.ts"), /averageSize/);
  assert.match(plants, /supplierPrice: number/);

  const storage = read("lib/plantVariantStorage.ts");
  assert.match(storage, /PLANT_SIZE_DELETE_BLOCKED_SELLABLE/);
  assert.match(storage, /PLANT_SIZE_DELETE_BLOCKED_INVENTORY/);
  assert.match(storage, /PLANT_SIZE_DELETE_BLOCKED_POS/);
  assert.match(storage, /PLANT_SIZE_DELETE_BLOCKED_ORDER/);
  assert.match(storage, /FROM order_items/);
  assert.match(storage, /FROM sellable_variants/);

  const labels = read("lib/displayLabels.ts");
  assert.match(labels, /Cannot delete this size: used by a Sellable Variant/);
  assert.match(labels, /Cannot delete this size: has inventory\/history/);
  assert.match(labels, /Cannot delete this size: used by POS\/placement/);
  assert.match(labels, /Cannot delete this size: referenced by a historical order/);

  console.log("verify-plant-variants-schema: checkout/payment still use offer product_id + consumer_price");
}

async function main(): Promise<void> {
  assertCheckoutUnchanged();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const { sql } = await import("../lib/db");
  const { readOffers, getOfferById } = await import("../lib/offerStorage");
  const { readPosSpots } = await import("../lib/posSpotStorage");
  const { MANUAL_OFFER_ID } = await import("../lib/offerTypes");

  const tables = await sql`
    SELECT 1 AS ok
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'plant_variants'
  `;
  assert.equal((tables as { ok: number }[]).length, 1);

  const variantCols = await sql`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plant_variants'
    ORDER BY ordinal_position
  `;
  const variantColNames = (variantCols as { column_name: string }[]).map(
    (row) => row.column_name,
  );
  assert.deepEqual(variantColNames, [
    "id",
    "plant_id",
    "size_label",
    "nursery_pot_diameter_cm",
  ]);
  const variantByName = Object.fromEntries(
    (
      variantCols as {
        column_name: string;
        is_nullable: string;
        data_type: string;
      }[]
    ).map((row) => [row.column_name, row]),
  );
  assert.equal(variantByName.plant_id.is_nullable, "NO");
  assert.equal(variantByName.size_label.is_nullable, "YES");
  assert.equal(variantByName.nursery_pot_diameter_cm.is_nullable, "YES");
  assert.equal(variantByName.catalog_price, undefined);

  const offerVariantCol = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'offers'
      AND column_name = 'variant_id'
  `;
  assert.equal((offerVariantCol as unknown[]).length, 0);

  const droppedChecks = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conname IN (
      'plant_variants_catalog_price_positive',
      'plants_average_size_check',
      'offers_variant_product_fkey'
    )
  `;
  assert.equal((droppedChecks as unknown[]).length, 0);

  const plantPriceCols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'plants'
      AND column_name IN ('average_size', 'supplier_price')
  `;
  assert.deepEqual(
    (plantPriceCols as { column_name: string }[]).map((row) => row.column_name),
    ["supplier_price"],
  );

  const fks = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'plant_variants'::regclass
  `;
  const fkDefs = (fks as { conname: string; def: string }[]).map((row) => row.def);
  assert.ok(
    fkDefs.some((def) => def.includes("plant_id") && def.includes("plants")),
    "plant_variants.plant_id -> plants.id",
  );

  const droppedIndexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('offers_variant_id_idx', 'plant_variants_id_plant_id_key')
  `;
  assert.equal((droppedIndexes as unknown[]).length, 0);

  const applyDef = await sql`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'apply_plant_offer'
  `;
  const applySource = (applyDef as { def: string }[])[0]?.def ?? "";
  assert.match(applySource, /INSERT INTO offers/);
  assert.doesNotMatch(applySource, /\bvariant_id\b/);

  const uniqueIndexes = await sql`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('plant_variants', 'offers', 'pos_spots')
      AND indexdef ILIKE '%UNIQUE%'
  `;
  const uniqueDefs = uniqueIndexes as {
    tablename: string;
    indexname: string;
    indexdef: string;
  }[];
  assert.equal(
    uniqueDefs.some((row) => row.indexname === "plant_variants_id_plant_id_key"),
    false,
    "composite offer index is gone",
  );
  assert.equal(
    uniqueDefs.some(
      (row) =>
        row.tablename === "plant_variants" &&
        /\bplant_id\b/.test(row.indexdef) &&
        !row.indexdef.includes("(id, plant_id)"),
    ),
    false,
    "plant_id must not be unique by itself",
  );
  assert.equal(
    uniqueDefs.some((row) => /\bvariant_id\b/.test(row.indexdef)),
    false,
    "offers.variant_id must not be unique",
  );
  assert.equal(
    uniqueDefs.some((row) => /\bcurrent_offer_id\b/.test(row.indexdef)),
    false,
    "pos_spots.current_offer_id must not be unique",
  );

  const existingOffers = await sql`SELECT COUNT(*)::int AS total FROM offers`;
  assert.ok((existingOffers as { total: number }[])[0].total > 0, "offers exist");
  const manual = await getOfferById(MANUAL_OFFER_ID);
  if (manual) assert.equal("variantId" in manual, false);

  const orderCountBefore = await sql`SELECT COUNT(*)::int AS n FROM orders`;
  const orderNBefore = (orderCountBefore as { n: number }[])[0].n;

  const plants = await sql`
    SELECT id, inventory_type
    FROM plants
    ORDER BY created_at ASC NULLS LAST, id ASC
  `;
  const plantRows = plants as { id: string; inventory_type: string }[];
  const plantA = plantRows.find((row) => (row.inventory_type ?? "plants") === "plants");
  const plantB = plantRows.find((row) => row.id !== plantA?.id);
  const flower = plantRows.find((row) => row.inventory_type === "flowers");
  assert.ok(plantA, "need a plant catalog row");
  assert.ok(plantB, "need a second catalog row for mismatch");
  assert.ok(flower, "need a flower catalog row");

  const offers = await readOffers();
  assert.ok(offers.length > 0);
  assert.ok(offers.every((offer) => !("variantId" in offer)));

  const posSpots = await readPosSpots();
  assert.ok(posSpots.length > 0);
  const offerIdsOnPos = new Set(posSpots.map((spot) => spot.currentOfferId));
  assert.ok(offerIdsOnPos.size > 0, "POS spots still point at offers");

  const variantSmall = randomUUID();
  const variantLarge = randomUUID();
  const offerOne = `variant-verify-${randomUUID()}`;
  const offerTwo = `variant-verify-${randomUUID()}`;
  const offerNull = `variant-verify-${randomUUID()}`;
  const offerMismatch = `variant-verify-${randomUUID()}`;

  try {
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label, nursery_pot_diameter_cm)
      VALUES
        (${variantSmall}::uuid, ${plantA.id}, 'smaller', 12),
        (${variantLarge}::uuid, ${plantA.id}, 'larger', 18)
    `;
    const perPlant = await sql`
      SELECT COUNT(*)::int AS n FROM plant_variants WHERE plant_id = ${plantA.id}
    `;
    assert.ok(
      (perPlant as { n: number }[])[0].n >= 2,
      "one plant can have many variants",
    );

    await sql`
      INSERT INTO offers (id, product_id, consumer_price, status, created_at)
      VALUES
        (${offerOne}, ${plantA.id}, 10, 'active', now()),
        (${offerTwo}, ${plantA.id}, 20, 'active', now())
    `;
    const perProduct = await sql`
      SELECT COUNT(*)::int AS n
      FROM offers
      WHERE id IN (${offerOne}, ${offerTwo})
    `;
    assert.equal((perProduct as { n: number }[])[0].n, 2, "one plant can have many offers");

    const mapped = await getOfferById(offerOne);
    assert.equal(mapped?.productId, plantA.id);
    assert.equal("variantId" in (mapped ?? {}), false);
    assert.equal(mapped?.sellableVariantId ?? null, null);
    assert.equal(mapped?.consumerPrice, 10);

    await sql`
      INSERT INTO offers (id, product_id, consumer_price, status, created_at)
      VALUES (${offerNull}, ${plantA.id}, 15, 'active', now())
    `;
    const nullOffer = await getOfferById(offerNull);
    assert.equal("variantId" in (nullOffer ?? {}), false);
    assert.equal(nullOffer?.sellableVariantId ?? null, null);

    let legacyColumnRejected = false;
    try {
      await sql`
        INSERT INTO offers (id, product_id, variant_id, consumer_price, status, created_at)
        VALUES (${offerMismatch}, ${plantB.id}, ${variantSmall}::uuid, 99, 'active', now())
      `;
    } catch (error) {
      legacyColumnRejected = true;
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /variant_id/i);
    }
    assert.equal(legacyColumnRejected, true, "offers.variant_id cannot be written");

    const flowerOffers = await readOffers();
    assert.ok(
      flowerOffers
        .filter((offer) => offer.productId === flower.id)
        .every((offer) => !("variantId" in offer) && offer.sellableVariantId == null),
    );

    console.log("verify-plant-variants-schema: cardinalities and consistency ok");
  } finally {
    await sql`DELETE FROM offers WHERE id LIKE 'variant-verify-%'`;
    await sql`DELETE FROM plant_variants WHERE id = ${variantSmall}::uuid`;
    await sql`DELETE FROM plant_variants WHERE id = ${variantLarge}::uuid`;
  }

  const leftover = await sql`
    SELECT COUNT(*)::int AS n FROM offers WHERE id LIKE 'variant-verify-%'
  `;
  assert.equal((leftover as { n: number }[])[0].n, 0);

  const orderCountAfter = await sql`SELECT COUNT(*)::int AS n FROM orders`;
  assert.equal((orderCountAfter as { n: number }[])[0].n, orderNBefore);

  const liveOffers = await readOffers();
  assert.ok(liveOffers.every((offer) => !("variantId" in offer)));
  const liveSpots = await readPosSpots();
  assert.ok(
    liveSpots.every((spot) => !spot.plantVariantId || Boolean(spot.currentOfferId)),
    "occupying POS must keep an offer",
  );

  console.log("verify-plant-variants-schema: existing plants/offers/POS/orders untouched");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

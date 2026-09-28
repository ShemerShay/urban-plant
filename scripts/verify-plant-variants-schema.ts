/**
 * Phase 1.3: plant_variants schema + nullable offers.variant_id.
 * Does not change checkout, payment, orders, or catalog UI.
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
  assert.match(plants, /averageSize\?:/);
  assert.match(plants, /supplierPrice: number/);

  console.log("verify-plant-variants-schema: checkout/payment still use offer product_id + consumer_price");
}

async function main(): Promise<void> {
  assertCheckoutUnchanged();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const { sql } = await import("../lib/db");
  const { readOffers, appendOffer, getOfferById } = await import("../lib/offerStorage");
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

  const offerVariantCol = await sql`
    SELECT is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'offers'
      AND column_name = 'variant_id'
  `;
  assert.equal((offerVariantCol as unknown[]).length, 1);
  assert.equal((offerVariantCol as { is_nullable: string }[])[0].is_nullable, "YES");

  const plantPriceCols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'plants'
      AND column_name IN ('average_size', 'supplier_price')
  `;
  assert.equal((plantPriceCols as unknown[]).length, 2);

  const fks = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'plant_variants'::regclass
       OR (conrelid = 'offers'::regclass AND conname = 'offers_variant_product_fkey')
  `;
  const fkDefs = (fks as { conname: string; def: string }[]).map((row) => row.def);
  assert.ok(
    fkDefs.some((def) => def.includes("plant_id") && def.includes("plants")),
    "plant_variants.plant_id -> plants.id",
  );
  const composite = (fks as { conname: string; def: string }[]).find(
    (row) => row.conname === "offers_variant_product_fkey",
  );
  assert.ok(composite, "offers_variant_product_fkey exists");
  assert.match(composite.def, /FOREIGN KEY \(variant_id, product_id\)/);
  assert.match(composite.def, /REFERENCES plant_variants\(id, plant_id\)/);

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
  assert.ok(
    uniqueDefs.some((row) => row.indexname === "plant_variants_id_plant_id_key"),
    "supporting unique (id, plant_id)",
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

  const existingNull = await sql`
    SELECT COUNT(*)::int AS total,
           COUNT(variant_id)::int AS with_variant
    FROM offers
  `;
  const existing = (existingNull as { total: number; with_variant: number }[])[0];
  assert.ok(existing.total > 0, "offers exist");
  assert.equal(existing.with_variant, 0, "existing offers stay NULL variant_id (no backfill)");

  const manual = await sql`
    SELECT variant_id FROM offers WHERE id = ${MANUAL_OFFER_ID} LIMIT 1
  `;
  if ((manual as { variant_id: string | null }[]).length > 0) {
    assert.equal((manual as { variant_id: string | null }[])[0].variant_id, null);
  }

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
  assert.ok(offers.every((offer) => offer.variantId == null));

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
      INSERT INTO offers (id, product_id, variant_id, consumer_price, status, created_at)
      VALUES
        (${offerOne}, ${plantA.id}, ${variantSmall}::uuid, 10, 'active', now()),
        (${offerTwo}, ${plantA.id}, ${variantSmall}::uuid, 20, 'active', now())
    `;
    const perVariant = await sql`
      SELECT COUNT(*)::int AS n FROM offers WHERE variant_id = ${variantSmall}::uuid
    `;
    assert.equal((perVariant as { n: number }[])[0].n, 2, "one variant can have many offers");

    const mapped = await getOfferById(offerOne);
    assert.equal(mapped?.productId, plantA.id);
    assert.equal(mapped?.variantId, variantSmall);
    assert.equal(mapped?.consumerPrice, 10);

    await sql`
      INSERT INTO offers (id, product_id, consumer_price, status, created_at)
      VALUES (${offerNull}, ${plantA.id}, 15, 'active', now())
    `;
    const nullOffer = await getOfferById(offerNull);
    assert.equal(nullOffer?.variantId, null);

    const created = await appendOffer({
      productId: plantA.id,
      consumerPrice: 11,
    });
    assert.equal(created.variantId ?? null, null);
    await sql`DELETE FROM offers WHERE id = ${created.id}`;

    let mismatchRejected = false;
    try {
      await sql`
        INSERT INTO offers (id, product_id, variant_id, consumer_price, status, created_at)
        VALUES (${offerMismatch}, ${plantB.id}, ${variantSmall}::uuid, 99, 'active', now())
      `;
    } catch (error) {
      mismatchRejected = true;
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /offers_variant_product_fkey|foreign key/i);
    }
    assert.equal(mismatchRejected, true, "mismatched product_id / variant plant_id is rejected");

    const flowerOffers = await sql`
      SELECT o.id, o.variant_id
      FROM offers o
      INNER JOIN plants pl ON pl.id = o.product_id
      WHERE pl.inventory_type = 'flowers'
        AND o.id NOT LIKE 'variant-verify-%'
    `;
    for (const row of flowerOffers as { variant_id: string | null }[]) {
      assert.equal(row.variant_id, null, "flower offers stay NULL variant_id");
    }

    const stillNullExisting = await sql`
      SELECT COUNT(variant_id)::int AS n
      FROM offers
      WHERE id NOT LIKE 'variant-verify-%'
    `;
    assert.equal((stillNullExisting as { n: number }[])[0].n, 0);

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
  assert.ok(liveOffers.every((offer) => offer.variantId == null));
  const liveSpots = await readPosSpots();
  assert.ok(liveSpots.every((spot) => Boolean(spot.currentOfferId)));

  console.log("verify-plant-variants-schema: existing plants/offers/POS/orders untouched");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

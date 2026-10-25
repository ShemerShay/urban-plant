/**
 * Sellable Variant = Plant Size + optional Pot Size.
 * Run: npx tsx scripts/verify-sellable-variants.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertWiring(): void {
  const migration = read("db/migrations/047_sellable_variants.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sellable_variants/);
  assert.match(migration, /UNIQUE NULLS NOT DISTINCT \(plant_variant_id, pot_size_id\)/);
  assert.match(migration, /REFERENCES plant_variants \(id\) ON DELETE RESTRICT/);
  assert.match(migration, /REFERENCES pot_sizes \(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /INSERT INTO/);
  assert.doesNotMatch(migration, /catalog_price/);
  assert.doesNotMatch(migration, /sellable_variant_id/);
  assert.equal(existsSync(join(root, "app/admin/variants/page.tsx")), false);

  const shop = read("lib/catalogShop.ts");
  const cart = read("lib/catalogCart.ts");
  const pos = read("lib/posSpotStorage.ts");
  for (const source of [shop, cart, pos]) {
    assert.doesNotMatch(source, /sellable_variants/);
  }

  const admin = read("components/admin/AdminPlantsManager.tsx");
  assert.match(admin, /AdminSellableVariantsSection/);
  assert.match(admin, /admin\.plants\.supplierCost/);
  assert.doesNotMatch(admin, /plant\.price/);

  const wire = read("lib/plantWire.ts");
  assert.doesNotMatch(wire, /price: supplierPrice/);

  const offersAdmin = read("components/admin/AdminOffersManager.tsx");
  assert.doesNotMatch(offersAdmin, /supplierPrice/);
  assert.doesNotMatch(offersAdmin, /supplier_price/);
  assert.match(offersAdmin, /createDraft\.consumerPrice\.trim\(\) === ""/);

  const offersApi = read("app/api/offers/route.ts");
  assert.doesNotMatch(offersApi, /supplierPrice/);
  assert.doesNotMatch(offersApi, /supplier_price/);
  assert.match(offersApi, /appendFlowerOffer\(\{/);
  assert.doesNotMatch(offersApi, /appendOffer\(\{/);

  const offerStorage = read("lib/offerStorage.ts");
  assert.doesNotMatch(offerStorage, /defaultOffers/);
  assert.doesNotMatch(offerStorage, /saveOffers/);
  assert.doesNotMatch(offerStorage, /PLANTS_CATALOG_SEED/);
  assert.doesNotMatch(offerStorage, /supplierPrice/);
  assert.doesNotMatch(offerStorage, /offers\.length > 0/);

  const snapshot = read("lib/catalogCheckoutSnapshot.ts");
  assert.doesNotMatch(snapshot, /const price = parseNumeric\(supplierPrice\)/);

  console.log("verify-sellable-variants: wiring leaves Catalog, cart, and POS off sellable variants");
}

async function main(): Promise<void> {
  assertWiring();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (host.includes("twilight-truth")) {
    throw new Error("Refusing to verify against production");
  }

  const { sql } = await import("../lib/db");
  const { readOffers } = await import("../lib/offerStorage");
  const storedOffers = await sql`SELECT id FROM offers`;
  const loadedOffers = await readOffers();
  const storedIds = (storedOffers as { id: string }[]).map((row) => row.id).sort();
  const loadedIds = loadedOffers.map((offer) => offer.id).sort();
  assert.deepEqual(loadedIds, storedIds);
  console.log("verify-sellable-variants: empty or stored offers are returned as stored");

  const { parsePlantBody } = await import("../lib/plantValidation");
  const { createPlant, deletePlant } = await import("../lib/plantStorage");
  const { createPlantVariant, deletePlantVariant, PlantVariantWriteError } = await import(
    "../lib/plantVariantStorage"
  );
  const { createPot, deletePot } = await import("../lib/potStorage");
  const { createPotSize, deletePotSize } = await import("../lib/potSizeStorage");
  const {
    SellableVariantWriteError,
    createSellableVariant,
    deleteSellableVariant,
    readSellableVariantsForPlant,
  } = await import("../lib/sellableVariantStorage");
  const { deriveSellableVariantSupplierCost } = await import("../lib/sellableVariantCost");

  const missing = deriveSellableVariantSupplierCost({
    plantSupplierCost: 40,
    potSizeId: "size",
    potSupplierCost: null,
  });
  assert.equal(missing.supplierCost, null);
  assert.equal(missing.missingPotSupplierCost, true);
  assert.notEqual(missing.supplierCost, 0);

  const tag = `sellable-${Date.now()}`;
  const parsed = parsePlantBody(
    {
      id: randomUUID(),
      name: `${tag} plant`,
      subtitle: "Leaf",
      description: "A plant",
      supplierPrice: 40,
      currency: "ILS",
      images: ["https://example.com/p.jpg"],
      labels: ["indoor"],
      light: "Medium light",
      water: "Weekly",
      location: "Indoor",
      petFriendly: false,
      careInstructions: ["Water"],
      inventoryType: "plants",
    },
    { requireId: true },
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const flowerParsed = parsePlantBody(
    {
      id: randomUUID(),
      name: `${tag} flower`,
      supplierPrice: 15,
      currency: "ILS",
      inventoryType: "flowers",
    },
    { requireId: true },
  );
  assert.equal(flowerParsed.ok, true);
  if (!flowerParsed.ok) return;

  let plantId = "";
  let otherPlantId = "";
  let flowerId = "";
  let potId = "";

  try {
    const plant = await createPlant(parsed.plant);
    plantId = plant.id;
    const otherParsed = parsePlantBody(
      {
        ...parsed.plant,
        id: randomUUID(),
        name: `${tag} other plant`,
        supplierPrice: 99,
      },
      { requireId: true },
    );
    assert.equal(otherParsed.ok, true);
    if (!otherParsed.ok) return;
    const otherPlant = await createPlant(otherParsed.plant);
    otherPlantId = otherPlant.id;
    const otherSize = await createPlantVariant({
      plantId: otherPlantId,
      sizeLabel: "M",
      catalogPrice: 70,
    });
    const flower = await createPlant(flowerParsed.plant);
    flowerId = flower.id;
    const medium = await createPlantVariant({ plantId, sizeLabel: "M", catalogPrice: 55 });
    const small = await createPlantVariant({ plantId, sizeLabel: "S", catalogPrice: 30 });
    const pot = await createPot({ name: `${tag} terracotta` });
    potId = pot.id;
    const potM = await createPotSize({ potId, sizeLabel: "M", supplierPrice: 12.5 });
    const potS = await createPotSize({ potId, sizeLabel: "S" });
    assert.equal(potS.supplierPrice, null);

    const legacyId = randomUUID();
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label)
      VALUES (${legacyId}::uuid, ${plantId}, 'XL')
    `;

    const noPot = await createSellableVariant({
      plantId,
      plantSizeId: medium.id,
      potSizeId: null,
    });
    assert.equal(noPot.potSizeId, null);
    assert.equal(noPot.supplierCost, 40);
    assert.equal(noPot.missingPotSupplierCost, false);

    const withPot = await createSellableVariant({
      plantId,
      plantSizeId: medium.id,
      potSizeId: potM.id,
    });
    assert.equal(withPot.potSizeLabel, "M");
    assert.equal(withPot.supplierCost, 52.5);

    const cross = await createSellableVariant({
      plantId,
      plantSizeId: medium.id,
      potSizeId: potS.id,
    });
    assert.equal(cross.plantSizeLabel, "M");
    assert.equal(cross.potSizeLabel, "S");
    assert.equal(cross.supplierCost, null);
    assert.equal(cross.missingPotSupplierCost, true);

    let duplicateNoPot = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: medium.id, potSizeId: null });
    } catch (error) {
      duplicateNoPot = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "duplicate");
    }
    assert.equal(duplicateNoPot, true);

    let duplicatePair = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: medium.id, potSizeId: potM.id });
    } catch (error) {
      duplicatePair = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "duplicate");
    }
    assert.equal(duplicatePair, true);

    let badId = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: "not-a-uuid", potSizeId: null });
    } catch (error) {
      badId = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(badId, true);

    let unknownSize = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: randomUUID(), potSizeId: null });
    } catch (error) {
      unknownSize = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(unknownSize, true);

    let unknownPot = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: small.id, potSizeId: randomUUID() });
    } catch (error) {
      unknownPot = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(unknownPot, true);

    let legacy = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: legacyId, potSizeId: null });
    } catch (error) {
      legacy = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "invalid_plant_size");
    }
    assert.equal(legacy, true);

    let flowerRejected = false;
    try {
      await createSellableVariant({ plantId: flowerId, plantSizeId: medium.id, potSizeId: null });
    } catch (error) {
      flowerRejected = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "flower_plant");
    }
    assert.equal(flowerRejected, true);

    let crossPlant = false;
    try {
      await createSellableVariant({
        plantId,
        plantSizeId: otherSize.id,
        potSizeId: null,
      });
    } catch (error) {
      crossPlant = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(crossPlant, true);

    let malformedPot = false;
    try {
      await createSellableVariant({
        plantId,
        plantSizeId: small.id,
        potSizeId: "not-a-uuid",
      });
    } catch (error) {
      malformedPot = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(malformedPot, true);

    let wrongOwner = false;
    try {
      await deleteSellableVariant({
        plantId: otherPlantId,
        sellableVariantId: noPot.sellableVariantId,
      });
    } catch (error) {
      wrongOwner = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(wrongOwner, true);
    const stillThere = await readSellableVariantsForPlant(plantId);
    assert.equal(
      stillThere.some((row) => row.sellableVariantId === noPot.sellableVariantId),
      true,
    );

    const columns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sellable_variants'
    `;
    const columnNames = (columns as { column_name: string }[])
      .map((row) => row.column_name)
      .sort();
    assert.deepEqual(columnNames, [
      "created_at",
      "id",
      "plant_variant_id",
      "pot_size_id",
      "updated_at",
    ]);

    const listed = await readSellableVariantsForPlant(plantId);
    assert.equal(listed.length, 3);

    const variantRows = await sql`
      SELECT count(*)::int AS count FROM pot_variants WHERE pot_id = ${potId}::uuid
    `;
    assert.equal((variantRows as { count: number }[])[0]?.count, 0);

    const smallOnly = await createSellableVariant({
      plantId,
      plantSizeId: small.id,
      potSizeId: null,
    });
    await deleteSellableVariant({ plantId, sellableVariantId: smallOnly.sellableVariantId });
    await deletePlantVariant({ plantId, variantId: small.id });

    let blockedPlantSize = false;
    try {
      await deletePlantVariant({ plantId, variantId: medium.id });
    } catch (error) {
      blockedPlantSize = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "in_use");
    }
    assert.equal(blockedPlantSize, true);

    let blockedPotSize = false;
    try {
      await deletePotSize({ potId, sizeId: potM.id });
    } catch (error) {
      blockedPotSize = true;
      assert.ok(error instanceof Error);
      assert.match(error.message, /used by a variant/);
    }
    assert.equal(blockedPotSize, true);

    await deleteSellableVariant({ plantId, sellableVariantId: noPot.sellableVariantId });
    await deleteSellableVariant({ plantId, sellableVariantId: withPot.sellableVariantId });
    await deleteSellableVariant({ plantId, sellableVariantId: cross.sellableVariantId });
    await deletePlantVariant({ plantId, variantId: medium.id });
    await sql`DELETE FROM plant_variants WHERE id = ${legacyId}::uuid`;
    await deletePotSize({ potId, sizeId: potM.id });
    await deletePotSize({ potId, sizeId: potS.id });

    console.log("verify-sellable-variants: ok");
  } finally {
    if (plantId) {
      await sql`
        DELETE FROM sellable_variants
        WHERE plant_variant_id IN (SELECT id FROM plant_variants WHERE plant_id = ${plantId})
      `;
      await sql`DELETE FROM plant_variants WHERE plant_id = ${plantId}`;
      await deletePlant(plantId).catch(() => undefined);
    }
    if (otherPlantId) {
      await sql`DELETE FROM plant_variants WHERE plant_id = ${otherPlantId}`;
      await deletePlant(otherPlantId).catch(() => undefined);
    }
    if (flowerId) await deletePlant(flowerId).catch(() => undefined);
    if (potId) await deletePot(potId).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

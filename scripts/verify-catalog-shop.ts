/**
 * Public Catalog shop: published plants, catalog prices, stock, pot size_label match, product_view.
 * Does not change POS, offers, inventory writers, placement, or payments.
 *
 * Run: npx tsx scripts/verify-catalog-shop.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertShopWiring(): void {
  const shop = read("lib/catalogShop.ts");
  assert.match(shop, /catalog_published = true/);
  assert.match(shop, /inventory_type = 'plants'/);
  assert.doesNotMatch(shop, /supplier_price/);
  assert.doesNotMatch(shop, /nursery_pot_diameter_cm = /);
  assert.match(shop, /pv\.size_label = ANY/);

  const shopPage = read("app/shop/page.tsx");
  assert.match(shopPage, /readCatalogShopCards/);
  assert.match(shopPage, /max-w-5xl/);
  assert.match(shopPage, /ShopCatalogBar/);
  assert.doesNotMatch(shopPage, /href=\"\/cart\"/);
  assert.doesNotMatch(shopPage, /TrackProductView/);
  assert.doesNotMatch(shopPage, /product_view/);
  assert.doesNotMatch(shopPage, /PosPlantLanding/);
  assert.doesNotMatch(shopPage, /TrackPosScan/);

  const detailPage = read("app/shop/plants/[plantId]/page.tsx");
  assert.match(detailPage, /readCatalogShopDetail/);
  assert.match(detailPage, /notFound/);
  assert.match(detailPage, /TrackProductView/);
  assert.match(detailPage, /ShopCatalogBar/);
  assert.match(detailPage, /max-w-2xl/);
  assert.doesNotMatch(detailPage, /max-w-5xl/);
  assert.doesNotMatch(detailPage, /PosPlantLanding/);
  assert.doesNotMatch(detailPage, /TrackPosScan/);
  assert.doesNotMatch(detailPage, /FixedBottomCTA/);

  const detailUi = read("components/shop/ShopPlantDetail.tsx");
  assert.match(detailUi, /"use client"/);
  assert.match(detailUi, /selectedSizeId/);
  assert.match(detailUi, /selectedPotId/);
  assert.match(detailUi, /onSelect=\{selectSize\}/);
  assert.match(detailUi, /from \"@\/lib\/catalogShopSelection\"/);
  assert.match(detailUi, /import type \{ CatalogShopDetail/);
  assert.match(detailUi, /retainCompatiblePotId/);
  assert.match(detailUi, /compatiblePots\.length > 0/);
  assert.doesNotMatch(detailUi, /difficulty/);
  assert.match(detailUi, /petFriendly=\{plant\.petFriendly\}/);
  assert.match(detailUi, /shop\.addToCart/);
  assert.match(detailUi, /ANALYTICS_EVENTS\.addToCart/);
  assert.match(detailUi, /captureAnalyticsEvent/);
  assert.doesNotMatch(detailUi, /lg:grid/);
  assert.doesNotMatch(detailUi, /lg:grid-cols/);
  assert.doesNotMatch(detailUi, /FixedBottomCTA/);
  assert.doesNotMatch(detailUi, /startCardcom/);
  assert.doesNotMatch(detailUi, /routes\.checkout/);
  assert.doesNotMatch(detailUi, /href=\"\/cart\"/);
  assert.doesNotMatch(detailUi, /routes\.cart/);

  const shopCard = read("components/shop/ShopPlantCard.tsx");
  assert.match(shopCard, /formatCatalogPrice/);
  assert.match(shopCard, /CatalogSizeOptions/);
  assert.match(shopCard, /CatalogPotColorOptions/);
  assert.match(shopCard, /addCatalogCartItem/);
  assert.match(shopCard, /retainCompatiblePotId/);
  assert.match(shopCard, /selectedSizeId/);
  assert.doesNotMatch(shopCard, /ANALYTICS_EVENTS/);
  assert.doesNotMatch(shopCard, /startCardcom/);

  const tracker = read("components/analytics/TrackProductView.tsx");
  assert.match(tracker, /captureOncePerSession/);
  assert.match(tracker, /ANALYTICS_EVENTS\.productView/);
  assert.doesNotMatch(tracker, /sessionStorage/);

  const events = read("lib/analyticsEvents.ts");
  assert.match(events, /productView:\s*"product_view"/);
  assert.match(events, /function captureOncePerSession/);

  const checkout = read("app/checkout/pos/[spotSlug]/page.tsx");
  assert.doesNotMatch(checkout, /product_view/);
  assert.doesNotMatch(checkout, /TrackProductView/);
  const landing = read("components/plant/PosPlantLanding.tsx");
  assert.doesNotMatch(landing, /product_view/);
  assert.doesNotMatch(landing, /TrackProductView/);
  assert.match(landing, /TrackPosScan/);
  assert.doesNotMatch(landing, /!plant\.difficulty/);
  assert.match(landing, /!plant\.light \|\| !plant\.images\?\.length/);

  const paymentPrep = read("lib/startCardcomPaymentPrep.ts");
  assert.doesNotMatch(paymentPrep, /product_view/);
  assert.doesNotMatch(paymentPrep, /pot_variants/);
  const offerStorage = read("lib/offerStorage.ts");
  assert.doesNotMatch(offerStorage, /pot_variants/);
  const variants = read("lib/plantVariantStorage.ts");
  assert.match(variants, /A variant needs a size label or a nursery pot diameter/);
  assert.doesNotMatch(variants, /pot_variants/);
  assert.doesNotMatch(variants, /size_label IN \('S'/);

  const migration = read("db/migrations/041_pots.sql");
  assert.match(migration, /catalog_price > 0/);
  assert.match(migration, /size_label IN \('S', 'M', 'L'\)/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS inventory/);
  assert.doesNotMatch(migration, /ALTER TABLE plant_variants/);

  const potsApi = read("app/api/pots/route.ts");
  assert.match(potsApi, /isAdminRequest/);
  const potVariantApi = read("app/api/pots/[potId]/variants/route.ts");
  assert.match(potVariantApi, /isAdminRequest/);

  console.log("verify-catalog-shop: shop wiring leaves POS and plant variants unchanged");
}

async function main(): Promise<void> {
  assertShopWiring();

  const { retainCompatiblePotId, catalogSizeChoices, uniquePotColorChoices } = await import(
    "../lib/catalogShopSelection"
  );
  assert.equal(retainCompatiblePotId(null, [{ id: "pot-a" }]), null);
  assert.equal(retainCompatiblePotId("pot-a", [{ id: "pot-a" }, { id: "pot-b" }]), "pot-a");
  assert.equal(retainCompatiblePotId("pot-a", [{ id: "pot-b" }]), null);
  assert.deepEqual(
    catalogSizeChoices([
      { sizeLabel: "L" },
      { sizeLabel: "S" },
      { sizeLabel: "XL" },
      { sizeLabel: "M" },
    ]).map((size) => size.sizeLabel),
    ["S", "M", "L"],
  );
  assert.deepEqual(
    catalogSizeChoices([{ sizeLabel: "S" }, { sizeLabel: "S" }]),
    [],
  );
  const uniqueColors = uniquePotColorChoices([
    { id: "white", color: "White" },
    { id: "black", color: "Black" },
  ]);
  assert.deepEqual(
    uniqueColors.choices.map((pot) => pot.id),
    ["white", "black"],
  );
  assert.deepEqual(uniqueColors.ambiguousColors, []);
  const sharedColor = uniquePotColorChoices([
    { id: "clay-white", color: "White" },
    { id: "stone-white", color: "white" },
    { id: "black", color: "Black" },
  ]);
  assert.deepEqual(
    sharedColor.choices.map((pot) => pot.id),
    ["black"],
  );
  assert.deepEqual(sharedColor.ambiguousColors, ["White"]);

  const plantsManager = read("components/admin/AdminPlantsManager.tsx");
  assert.doesNotMatch(plantsManager, /draft\.difficulty/);
  assert.doesNotMatch(plantsManager, /admin\.plants\.difficulty/);
  assert.match(plantsManager, /admin\.plants\.labelsHint/);
  assert.match(plantsManager, /draft\.petFriendly/);
  const infoGrid = read("components/plant/PlantProductInfoGrid.tsx");
  assert.match(infoGrid, /plant\.info\.petFriendly/);
  assert.doesNotMatch(infoGrid, /difficulty/);
  assert.doesNotMatch(infoGrid, /careLabel/);
  assert.match(plantsManager, /admin\.common\.yes/);
  assert.match(plantsManager, /admin\.common\.no/);
  const section = read("components/admin/shared/AdminManagementSection.tsx");
  assert.match(section, /text-sm font-normal text-slate-600/);
  const plantUpdate = read("app/api/plants/[plantId]/route.ts");
  assert.match(plantUpdate, /existing\.difficulty/);

  const { parsePlantBody } = await import("../lib/plantValidation");
  const plantWithoutDifficulty = parsePlantBody(
    {
      id: "verify-plant-options",
      name: "Monstera",
      subtitle: "A leafy plant",
      description: "A description",
      supplierPrice: 20,
      currency: "ILS",
      images: ["https://example.com/p.jpg"],
      labels: ["indoor"],
      light: "Medium light",
      water: "Weekly",
      location: "Indoor",
      petFriendly: true,
      careInstructions: ["Water weekly"],
      inventoryType: "plants",
    },
    { requireId: true },
  );
  assert.equal(plantWithoutDifficulty.ok, true);
  if (plantWithoutDifficulty.ok) {
    assert.equal(plantWithoutDifficulty.plant.difficulty, undefined);
    assert.equal(plantWithoutDifficulty.plant.petFriendly, true);
  }

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const { sql } = await import("../lib/db");
  const { createPlant, deletePlant, getPlantByIdAsync, updatePlant } = await import(
    "../lib/plantStorage"
  );
  const { createPlantVariant, updatePlantVariant } = await import("../lib/plantVariantStorage");
  const { applyInventoryDelta } = await import("../lib/inventoryStorage");
  const { readCatalogShopCards, readCatalogShopDetail } = await import("../lib/catalogShop");
  const { PotWriteError, createPot, createPotVariant } = await import("../lib/potStorage");

  const plantRows = await sql`SELECT id, inventory_type FROM plants`;
  const plantRow = (plantRows as { id: string; inventory_type: string | null }[]).find(
    (row) => (row.inventory_type ?? "plants") === "plants",
  );
  assert.ok(plantRow, "need a plant catalog row");
  const sourcePlant = await getPlantByIdAsync(plantRow.id);
  assert.ok(sourcePlant);
  assert.ok(sourcePlant.images?.[0], "source plant needs an image to confirm card reuse");

  const tag = `catalog-shop-verify-${randomUUID().slice(0, 8)}`;
  const testPlantId = randomUUID();
  const variantIds: string[] = [];
  const potIds: string[] = [];

  async function cleanup(): Promise<void> {
    if (variantIds.length > 0) {
      await sql`DELETE FROM inventory_history WHERE variant_id = ANY(${variantIds}::uuid[])`;
      await sql`DELETE FROM inventory WHERE variant_id = ANY(${variantIds}::uuid[])`;
      await sql`DELETE FROM plant_variants WHERE id = ANY(${variantIds}::uuid[])`;
    }
    await deletePlant(testPlantId);
    if (potIds.length > 0) {
      await sql`DELETE FROM pots WHERE id = ANY(${potIds}::uuid[])`;
    }
  }

  try {
    const createdPlant = await createPlant({
      ...sourcePlant,
      id: testPlantId,
      name: tag,
      nameHe: "צמח בדיקה",
      catalogPublished: false,
      createdAt: new Date().toISOString(),
    });
    const nextPetFriendly = createdPlant.petFriendly !== true;
    const petSaved = await updatePlant(testPlantId, {
      ...createdPlant,
      petFriendly: nextPetFriendly,
    });
    assert.equal(petSaved?.petFriendly, nextPetFriendly);
    assert.equal(petSaved?.difficulty, createdPlant.difficulty);
    const petReloaded = await getPlantByIdAsync(testPlantId);
    assert.equal(petReloaded?.petFriendly, nextPetFriendly);
    assert.equal(petReloaded?.difficulty, createdPlant.difficulty);

    assert.equal(
      (await readCatalogShopCards()).some((card) => card.id === testPlantId),
      false,
    );
    assert.equal(await readCatalogShopDetail(testPlantId), null);
    assert.equal(await readCatalogShopDetail("missing-shop-plant"), null);

    await updatePlant(testPlantId, { ...createdPlant, catalogPublished: true });
    const publishedOnly = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(publishedOnly);
    assert.equal(publishedOnly.image, sourcePlant.images?.[0]);
    assert.equal(publishedOnly.name, tag);
    assert.equal(publishedOnly.nameHe, "צמח בדיקה");
    assert.equal(publishedOnly.priceMin, null);
    assert.equal(publishedOnly.priceMax, null);
    assert.equal(publishedOnly.unavailable, true);

    const small = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "S",
      nurseryPotDiameterCm: 12,
      catalogPrice: 40,
    });
    variantIds.push(small.id);
    const onePrice = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(onePrice);
    assert.equal(onePrice.priceMin, 40);
    assert.equal(onePrice.priceMax, 40);
    assert.equal(onePrice.unavailable, true);

    const bare = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "bare",
      nurseryPotDiameterCm: 8,
    });
    variantIds.push(bare.id);
    assert.equal(bare.catalogPrice ?? null, null);
    const stillOne = await readCatalogShopDetail(testPlantId);
    assert.ok(stillOne);
    assert.equal(stillOne.sizes.length, 1);
    assert.equal(stillOne.sizes[0]?.catalogPrice, 40);

    const medium = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "M",
      nurseryPotDiameterCm: 17,
      catalogPrice: 90,
    });
    const large = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "L",
      nurseryPotDiameterCm: 21,
      catalogPrice: 70,
    });
    const extra = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "XL",
      nurseryPotDiameterCm: 30,
      catalogPrice: 15,
    });
    variantIds.push(medium.id, large.id, extra.id);
    await applyInventoryDelta({ variantId: medium.id, delta: 2, note: `${tag} receive` });

    const ranged = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(ranged);
    assert.equal(ranged.priceMin, 15);
    assert.equal(ranged.priceMax, 90);
    assert.equal(ranged.unavailable, false);

    const clay = await createPot({ name: `${tag} clay`, nameHe: "חימר", image: sourcePlant.images[0] });
    const stone = await createPot({ name: `${tag} stone` });
    potIds.push(clay.id, stone.id);
    const white = await createPotVariant({
      potId: clay.id,
      sizeLabel: "S",
      color: "White",
      colorHe: "לבן",
      catalogPrice: 25,
    });
    const black = await createPotVariant({
      potId: clay.id,
      sizeLabel: "M",
      color: "Black",
      catalogPrice: 35,
    });
    const terracotta = await createPotVariant({
      potId: stone.id,
      sizeLabel: "L",
      color: "Terracotta",
      catalogPrice: 40,
    });

    let badPrice = false;
    try {
      await createPotVariant({
        potId: clay.id,
        sizeLabel: "S",
        color: "Grey",
        catalogPrice: 0,
      });
    } catch (error) {
      badPrice = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "invalid_catalog_price");
    }
    assert.equal(badPrice, true);

    let badSize = false;
    try {
      await createPotVariant({
        potId: clay.id,
        sizeLabel: "XL",
        color: "Grey",
        catalogPrice: 10,
      });
    } catch (error) {
      badSize = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "invalid_size_label");
    }
    assert.equal(badSize, true);

    const cardWithPots = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(cardWithPots);
    assert.equal(cardWithPots.sizes.some((size) => size.sizeLabel === "XL"), true);
    const cardSizes = catalogSizeChoices(cardWithPots.sizes);
    assert.deepEqual(
      cardSizes.map((size) => size.sizeLabel),
      ["S", "M", "L"],
    );
    assert.equal(cardSizes.find((size) => size.sizeLabel === "S")?.pots[0]?.id, white.id);
    assert.equal(cardSizes.find((size) => size.sizeLabel === "M")?.pots[0]?.color, "Black");
    assert.deepEqual(
      uniquePotColorChoices(cardSizes.find((size) => size.sizeLabel === "S")?.pots ?? []).ambiguousColors,
      [],
    );

    const detail = await readCatalogShopDetail(testPlantId);
    assert.ok(detail);
    assert.deepEqual(
      detail.sizes.map((size) => size.sizeLabel),
      ["S", "M", "L", "XL"],
    );
    const byLabel = new Map(detail.sizes.map((size) => [size.sizeLabel, size]));
    const sizeS = byLabel.get("S");
    const sizeM = byLabel.get("M");
    const sizeL = byLabel.get("L");
    const sizeXl = byLabel.get("XL");
    assert.ok(sizeS && sizeM && sizeL && sizeXl);
    assert.equal(sizeS.nurseryPotDiameterCm, 12);
    assert.equal(sizeS.catalogPrice, 40);
    assert.equal(sizeS.quantity, 0);
    assert.equal(sizeM.quantity, 2);
    assert.equal(sizeM.catalogPrice, 90);
    assert.equal(sizeL.nurseryPotDiameterCm, 21);
    assert.equal(sizeXl.catalogPrice, 15);
    assert.equal(sizeXl.pots.length, 0);
    assert.equal(sizeS.pots.length, 1);
    assert.equal(sizeS.pots[0]?.id, white.id);
    assert.equal(sizeS.pots[0]?.color, "White");
    assert.equal(sizeS.pots[0]?.colorHe, "לבן");
    assert.equal(sizeS.pots[0]?.catalogPrice, 25);
    assert.equal(sizeS.pots[0]?.image, sourcePlant.images[0]);
    assert.equal(sizeM.pots.length, 1);
    assert.equal(sizeM.pots[0]?.id, black.id);
    assert.equal(sizeM.pots[0]?.catalogPrice, 35);
    assert.equal(sizeL.pots.length, 1);
    assert.equal(sizeL.pots[0]?.id, terracotta.id);
    assert.equal(sizeL.pots.some((pot) => pot.sizeLabel !== "L"), false);
    assert.equal(sizeS.pots.some((pot) => pot.sizeLabel !== "S"), false);

    await applyInventoryDelta({ variantId: medium.id, delta: -2, note: `${tag} clear` });
    const soldOut = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(soldOut);
    assert.equal(soldOut.unavailable, true);
    assert.equal(soldOut.priceMin, 15);
    assert.equal(soldOut.priceMax, 90);
    const soldOutDetail = await readCatalogShopDetail(testPlantId);
    assert.equal(soldOutDetail?.sizes.find((size) => size.sizeLabel === "M")?.quantity, 0);

    await updatePlantVariant({
      plantId: testPlantId,
      variantId: extra.id,
      sizeLabel: "XL",
    });
    const current = await getPlantByIdAsync(testPlantId);
    assert.ok(current);
    await updatePlant(testPlantId, { ...current, catalogPublished: false });
    assert.equal(
      (await readCatalogShopCards()).some((card) => card.id === testPlantId),
      false,
    );
    assert.equal(await readCatalogShopDetail(testPlantId), null);
  } finally {
    await cleanup();
  }

  console.log("verify-catalog-shop: ok");
}

main().catch((error) => {
  console.error("verify-catalog-shop FAILED", error);
  process.exit(1);
});

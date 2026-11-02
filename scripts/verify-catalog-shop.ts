/**
 * Public Catalog shop: published plants, catalog prices, stock, pot size_label match, product_view.
 * Does not change POS, offers, inventory writers, placement, or payments.
 *
 * Run: npx tsx scripts/verify-catalog-shop.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertShopWiring(): void {
  const imageStorage = read("lib/plantImageStorage.ts");
  const imageBlobs = read("lib/plantImageBlobs.ts");
  const imageRoute = read("app/plant-library/[filename]/route.ts");
  assert.match(imageStorage, /readFile\(filePath\)/);
  assert.match(imageStorage, /writePlantLibraryBlob/);
  assert.match(imageStorage, /readPlantLibraryBlob/);
  assert.match(imageStorage, /deletePlantLibraryBlob/);
  assert.doesNotMatch(imageStorage, /writeFile/);
  assert.match(imageRoute, /getPlantLibraryImageBytes/);
  assert.doesNotMatch(imageStorage, /getPlantLibraryImageFromDb/);
  assert.doesNotMatch(imageRoute, /plant_library_images/);
  assert.match(imageBlobs, /PLANT_LIBRARY_BLOB_STORE = "plant-library"/);
  assert.match(imageBlobs, /getStore\(PLANT_LIBRARY_BLOB_STORE\)/);
  assert.doesNotMatch(imageBlobs, /getDeployStore\(/);
  assert.doesNotMatch(imageBlobs, /consistency:\s*"strong"/);

  const shop = read("lib/catalogShop.ts");
  assert.match(shop, /catalog_published = true/);
  assert.match(shop, /inventory_type = 'plants'/);
  assert.doesNotMatch(shop, /supplier_price/);
  assert.doesNotMatch(shop, /nursery_pot_diameter_cm = /);
  assert.match(shop, /offer_availabilities/);
  assert.match(shop, /consumer_price/);
  assert.doesNotMatch(shop, /pot_variants/);
  assert.doesNotMatch(shop, /catalog_price/);
  assert.match(shop, /plantSizeCodes/);
  assert.match(shop, /pot\.image AS pot_image/);
  assert.doesNotMatch(shop, /!potImage\) continue/);
  const selectionSrc = read("lib/catalogShopSelection.ts");
  const eligibility = selectionSrc.slice(
    selectionSrc.indexOf("export function variantIsEligible"),
    selectionSrc.indexOf("export function comparePotBearingVariants"),
  );
  assert.doesNotMatch(eligibility, /potImage/);
  assert.doesNotMatch(shop, /average_size/);
  assert.doesNotMatch(shop, /averageSize/);

  const shopPage = read("app/shop/page.tsx");
  assert.match(shopPage, /readCatalogShopCards/);
  assert.match(shopPage, /max-w-5xl/);
  assert.match(shopPage, /ShopCatalogBar/);
  const catalogBar = read("components/shop/ShopCatalogBar.tsx");
  assert.match(catalogBar, /shop\.back/);
  assert.match(catalogBar, /rtl:rotate-180/);
  assert.match(catalogBar, /routes\.shop\.index\(\)/);
  assert.match(shopPage, /ShopCatalogGrid/);
  assert.doesNotMatch(shopPage, /href=\"\/cart\"/);
  assert.doesNotMatch(shopPage, /TrackProductView/);
  assert.doesNotMatch(shopPage, /product_view/);
  assert.doesNotMatch(shopPage, /PosPlantLanding/);
  assert.doesNotMatch(shopPage, /TrackPosScan/);

  const grid = read("components/shop/ShopCatalogGrid.tsx");
  assert.match(grid, /plantMatchesCatalogSizeFilter/);
  assert.match(grid, /plantSizeCodes/);
  assert.match(grid, /sizeFilter=\{filter\}/);
  assert.doesNotMatch(grid, /averageSize/);

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
  assert.match(detailUi, /resolveExplicitConfiguration/);
  assert.match(detailUi, /from \"@\/lib\/catalogShopSelection\"/);
  assert.match(detailUi, /import type \{ CatalogShopDetail/);
  assert.match(detailUi, /selectedVariantId/);
  assert.match(detailUi, /variant\.potImage/);
  assert.match(detailUi, /shop\.noPot/);
  assert.match(detailUi, /selectNoPot/);
  assert.doesNotMatch(detailUi, /variantChoiceLabel/);
  assert.doesNotMatch(detailUi, /catalog_price/);
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
  assert.match(shopCard, /resolveCardConfiguration/);
  assert.match(shopCard, /defaultCatalogCardSizeId/);
  assert.match(shopCard, /addCatalogCartItem/);
  assert.match(shopCard, /w-4\/5/);
  assert.match(shopCard, /ANALYTICS_EVENTS\.addToCart/);
  assert.match(shopCard, /selectedSizeId/);
  assert.match(shopCard, /resolved && resolvedVariant\?\.potImage/);
  assert.match(shopCard, /src=\{resolvedVariant\.potImage\}/);
  assert.match(shopCard, /additionalVariantOptionCount/);
  assert.match(shopCard, /extraOptions > 0/);
  assert.doesNotMatch(shopCard, /GalleryCue/);
  assert.doesNotMatch(shopCard, /shop\.unavailable/);
  assert.doesNotMatch(shopCard, /useState\(sizeOptions\[0\]/);
  assert.doesNotMatch(shopCard, /useState\(""\)/);
  assert.doesNotMatch(shopCard, /opacity-60/);
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
  assert.doesNotMatch(landing, /difficulty/);
  assert.match(landing, /!plant\.light \|\| !plant\.images\?\.length/);

  const paymentPrep = read("lib/startCardcomPaymentPrep.ts");
  assert.doesNotMatch(paymentPrep, /product_view/);
  assert.doesNotMatch(paymentPrep, /pot_variants/);
  const offerStorage = read("lib/offerStorage.ts");
  assert.doesNotMatch(offerStorage, /pot_variants/);
  const variants = read("lib/plantVariantStorage.ts");
  assert.match(variants, /A variant needs a size label or a nursery pot diameter/);
  assert.match(variants, /sizeLabel must be S, M, or L/);
  assert.doesNotMatch(variants, /pot_variants/);
  assert.doesNotMatch(variants, /size_label IN \('S'/);
  const sizePanel = read("components/admin/AdminPlantVariantsPanel.tsx");
  assert.match(sizePanel, /PLANT_SIZE_LABELS/);
  assert.match(sizePanel, /isPlantSizeLabel/);
  assert.doesNotMatch(sizePanel, /setSizeLabel\(e\.target\.value\)/);

  const migration = read("db/migrations/041_pots.sql");
  assert.match(migration, /catalog_price > 0/);
  assert.match(migration, /size_label IN \('S', 'M', 'L'\)/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS inventory/);
  assert.doesNotMatch(migration, /ALTER TABLE plant_variants/);

  const potsApi = read("app/api/pots/route.ts");
  assert.match(potsApi, /isAdminRequest/);
  assert.match(read("app/api/pots/[potId]/route.ts"), /isAdminRequest/);
  assert.equal(existsSync(join(root, "app/api/pots/[potId]/sizes/route.ts")), false);
  assert.equal(existsSync(join(root, "app/api/pots/[potId]/variants/route.ts")), false);

  console.log("verify-catalog-shop: shop wiring leaves POS and plant variants unchanged");
}

async function assertPlantImageStores(): Promise<void> {
  const { getPlantLibraryImageBytes } = await import("../lib/plantImageStorage");
  const {
    deletePlantLibraryBlob,
    readPlantLibraryBlob,
    usesNetlifyBlobStore,
    writePlantLibraryBlob,
  } = await import("../lib/plantImageBlobs");
  assert.equal(
    usesNetlifyBlobStore(),
    false,
    "catalog verification must use the local blob directory, not the site-wide store",
  );

  const shippedName = "pot-vaso-classic-36-light.png";
  const shipped = await getPlantLibraryImageBytes(shippedName);
  const shippedDisk = readFileSync(join(root, "data", "plant-library", shippedName));
  assert.ok(shipped);
  assert.equal(shipped.mimeType, "image/png");
  assert.equal(shipped.data.length, shippedDisk.length);
  assert.equal(await readPlantLibraryBlob(shippedName), null);

  const misnamed = await getPlantLibraryImageBytes("green-island-ficus-tree-catalog-b9ced762.png");
  assert.equal(misnamed?.mimeType, "image/jpeg");
  assert.equal(misnamed?.data[0], 0xff);

  assert.equal(await getPlantLibraryImageBytes("does-not-exist.png"), null);

  for (const potName of [
    "pot-concrete-cube-off-white.jpg",
    "pot-rounded-stone-cream.jpg",
    "pot-vaso-alto-natural-beige.jpg",
    "pot-vaso-classic-light-peach.jpg",
    "pot-vaso-ribbed-rounded-beige.jpg",
    "pot-vaso-rounded-terracotta.jpg",
  ]) {
    assert.equal(existsSync(join(root, "data", "plant-library", potName)), true, potName);
  }

  const uploadName = `verify-blob-${randomUUID().slice(0, 8)}.jpg`;
  const payload = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  await writePlantLibraryBlob(uploadName, payload);
  try {
    assert.equal(existsSync(join(root, "data", "plant-library", uploadName)), false);
    const uploaded = await getPlantLibraryImageBytes(uploadName);
    assert.equal(uploaded?.mimeType, "image/jpeg");
    assert.deepEqual(uploaded?.data, payload);
  } finally {
    await deletePlantLibraryBlob(uploadName);
  }
  assert.equal(await readPlantLibraryBlob(uploadName), null);
  assert.equal(await getPlantLibraryImageBytes(uploadName), null);
}

async function main(): Promise<void> {
  assertShopWiring();
  await assertPlantImageStores();

  const {
    additionalVariantOptionCount,
    catalogSizeChoices,
    defaultCatalogCardSizeId,
    plantMatchesCatalogSizeFilter,
    resolveCardVariant,
    resolveExplicitConfiguration,
  } = await import("../lib/catalogShopSelection");
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
  assert.equal(plantMatchesCatalogSizeFilter(["S", "M"], "all"), true);
  assert.equal(plantMatchesCatalogSizeFilter(["S", "M"], "S"), true);
  assert.equal(plantMatchesCatalogSizeFilter(["S", "M"], "M"), true);
  assert.equal(plantMatchesCatalogSizeFilter(["S", "M"], "L"), false);
  assert.equal(plantMatchesCatalogSizeFilter(["XL", "Medium"], "S"), false);
  function sellableSize(id: string, label: string, quantity = 3) {
    return {
      id,
      sizeLabel: label,
      quantity,
      variants: [
        {
          id: `${id}-v`,
          potId: null,
          offerId: `${id}-o`,
          unitPrice: 40,
          potQuantity: 0,
        },
      ],
    };
  }
  const sizeS = sellableSize("size-s", "S");
  const sizeM = sellableSize("size-m", "M");
  const sizeL = sellableSize("size-l", "L");
  const soldOutM = sellableSize("size-m-out", "M", 0);
  assert.equal(defaultCatalogCardSizeId([sizeS, sizeM, sizeL]), "size-m");
  assert.equal(defaultCatalogCardSizeId([sizeS]), "size-s");
  assert.equal(defaultCatalogCardSizeId([sizeL]), "size-l");
  assert.equal(defaultCatalogCardSizeId([sizeS, sizeL]), "size-s");
  assert.equal(defaultCatalogCardSizeId([sizeS, sizeM, sizeL], "L"), "size-l");
  assert.equal(defaultCatalogCardSizeId([sizeS, sizeM, sizeL], "S"), "size-s");
  assert.equal(defaultCatalogCardSizeId([sizeS, soldOutM, sizeL]), "size-s");
  assert.equal(defaultCatalogCardSizeId([sizeS, soldOutM, sizeL], "M"), "size-s");
  assert.equal(defaultCatalogCardSizeId([soldOutM]), "");
  const potA = {
    id: "sv-b",
    potId: "pot-b",
    potName: "Beta",
    potImage: "/plant-library/beta.jpg",
    offerId: "o-b",
    unitPrice: 20,
    potQuantity: 2,
  };
  const potB = {
    id: "sv-a",
    potId: "pot-a",
    potName: "Alpha",
    potImage: "/plant-library/alpha.jpg",
    offerId: "o-a",
    unitPrice: 30,
    potQuantity: 1,
  };
  const noPot = {
    id: "sv-none",
    potId: null,
    offerId: "o-none",
    unitPrice: 10,
    potQuantity: 0,
  };
  const sized = { id: "size", quantity: 3, variants: [potA, potB, noPot] };
  assert.equal(resolveCardVariant(sized)?.id, "sv-a");
  assert.equal(resolveCardVariant({ ...sized, variants: [noPot] })?.id, "sv-none");
  assert.equal(resolveCardVariant({ ...sized, quantity: 0 }), null);
  const imagelessAlpha = { ...potB, id: "sv-bare", potImage: undefined };
  assert.equal(
    resolveCardVariant({ ...sized, variants: [potA, imagelessAlpha, noPot] })?.id,
    "sv-bare",
  );
  const counted = { ...sized, sizeLabel: "M" };
  assert.equal(additionalVariantOptionCount([counted], "sv-a"), 2);
  assert.equal(additionalVariantOptionCount([counted], "sv-none"), 2);
  assert.equal(
    additionalVariantOptionCount([{ ...counted, variants: [potB] }], "sv-a"),
    0,
  );
  assert.equal(
    resolveExplicitConfiguration(
      { id: "size", quantity: 3, variants: [imagelessAlpha] },
      "sv-bare",
    )?.offerId,
    "o-a",
  );

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
  assert.doesNotMatch(plantUpdate, /difficulty/);
  const plantStorage = read("lib/plantStorage.ts");
  assert.doesNotMatch(plantStorage, /difficulty/);
  const dropDifficulty = read("db/migrations/045_plants_drop_difficulty.sql");
  assert.match(dropDifficulty, /DROP COLUMN IF EXISTS difficulty/);

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
    assert.equal(plantWithoutDifficulty.plant.petFriendly, true);
    assert.equal("difficulty" in plantWithoutDifficulty.plant, false);
  }

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const { sql } = await import("../lib/db");
  const { createPlant, deletePlant, getPlantByIdAsync, updatePlant } = await import(
    "../lib/plantStorage"
  );
  const { PlantVariantWriteError, createPlantVariant, updatePlantVariant } = await import(
    "../lib/plantVariantStorage"
  );
  const { applyInventoryDelta } = await import("../lib/inventoryStorage");
  const { firstStoredPlantImage, readCatalogShopCards, readCatalogShopDetail } = await import(
    "../lib/catalogShop"
  );
  assert.equal(
    firstStoredPlantImage([
      "/plant-library/green-island-ficus-tree-catalog-b9ced762.png",
      "/plant-library/green-island-ficus-tree-room-de0435a6.png",
    ]),
    "/plant-library/green-island-ficus-tree-catalog-b9ced762.png",
  );
  assert.equal(
    firstStoredPlantImage([
      "/plant-library/happy-leaf-photos-room-1f7bb676.jpg",
      "/plant-library/happy-leaf-photos-catalog-26ebd598.jpg",
    ]),
    "/plant-library/happy-leaf-photos-room-1f7bb676.jpg",
  );
  assert.equal(firstStoredPlantImage(["  /a.jpg  ", "", "/b.jpg"]), "/a.jpg");
  assert.equal(firstStoredPlantImage("not-an-array"), undefined);
  const { createPot, updatePot } = await import("../lib/potStorage");
  const { applyPotInventoryDelta } = await import("../lib/potInventoryStorage");
  const { createSellableVariant } = await import("../lib/sellableVariantStorage");
  const { createOrReusePlantOffer } = await import("../lib/offerStorage");

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
  const sellableIds: string[] = [];
  const potIds: string[] = [];

  async function seedNoPotOffer(plantSizeId: string, price: number): Promise<void> {
    const variant = await createSellableVariant({
      plantId: testPlantId,
      plantSizeId,
      potId: null,
    });
    sellableIds.push(variant.sellableVariantId);
    await createOrReusePlantOffer({
      sellableVariantId: variant.sellableVariantId,
      consumerPrice: price,
      availabilities: [{ scope: "catalog" }],
    });
  }

  async function cleanup(): Promise<void> {
    if (sellableIds.length > 0) {
      await sql`
        DELETE FROM offer_availabilities
        WHERE offer_id IN (
          SELECT id FROM offers WHERE sellable_variant_id = ANY(${sellableIds}::uuid[])
        )
      `;
      await sql`DELETE FROM offers WHERE sellable_variant_id = ANY(${sellableIds}::uuid[])`;
      await sql`DELETE FROM sellable_variants WHERE id = ANY(${sellableIds}::uuid[])`;
    }
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
    assert.equal("difficulty" in (petSaved ?? {}), false);
    const petReloaded = await getPlantByIdAsync(testPlantId);
    assert.equal(petReloaded?.petFriendly, nextPetFriendly);
    assert.equal("difficulty" in (petReloaded ?? {}), false);

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
    assert.equal(publishedOnly.sizes.length, 0);
    assert.equal(publishedOnly.unavailable, true);

    const small = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "S",
      nurseryPotDiameterCm: 12,
    });
    variantIds.push(small.id);
    const pricedWithoutOffer = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(pricedWithoutOffer);
    assert.equal(pricedWithoutOffer.sizes.length, 0);
    assert.equal(pricedWithoutOffer.unavailable, true);
    await seedNoPotOffer(small.id, 40);
    const onePrice = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(onePrice);
    assert.equal(onePrice.sizes[0]?.variants[0]?.unitPrice, 40);
    assert.equal(onePrice.unavailable, true);

    let bareRejected = false;
    try {
      await createPlantVariant({
        plantId: testPlantId,
        sizeLabel: "bare",
        nurseryPotDiameterCm: 8,
      });
    } catch (error) {
      bareRejected = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "invalid_size_label");
    }
    assert.equal(bareRejected, true);

    let diameterOnlyRejected = false;
    try {
      await createPlantVariant({
        plantId: testPlantId,
        nurseryPotDiameterCm: 8,
      });
    } catch (error) {
      diameterOnlyRejected = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "invalid_size_label");
    }
    assert.equal(diameterOnlyRejected, true);

    const legacyBare = await sql`
      INSERT INTO plant_variants (plant_id, size_label, nursery_pot_diameter_cm)
      VALUES (${testPlantId}, 'bare', 8)
      RETURNING id
    `;
    const bare = (legacyBare as { id: string }[])[0];
    assert.ok(bare);
    variantIds.push(bare.id);
    const stillOne = await readCatalogShopDetail(testPlantId);
    assert.ok(stillOne);
    assert.equal(stillOne.sizes.length, 1);
    assert.equal(stillOne.sizes[0]?.variants[0]?.unitPrice, 40);
    assert.equal("averageSize" in stillOne, false);

    const medium = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "M",
      nurseryPotDiameterCm: 17,
    });
    await seedNoPotOffer(medium.id, 90);
    const withSmallAndMedium = (await readCatalogShopCards()).find(
      (card) => card.id === testPlantId,
    );
    assert.ok(withSmallAndMedium);
    assert.deepEqual(withSmallAndMedium.plantSizeCodes, ["S", "M"]);
    assert.equal(plantMatchesCatalogSizeFilter(withSmallAndMedium.plantSizeCodes, "S"), true);
    assert.equal(plantMatchesCatalogSizeFilter(withSmallAndMedium.plantSizeCodes, "M"), true);
    assert.equal(plantMatchesCatalogSizeFilter(withSmallAndMedium.plantSizeCodes, "L"), false);

    const large = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "L",
      nurseryPotDiameterCm: 21,
    });
    let xlRejected = false;
    try {
      await createPlantVariant({
        plantId: testPlantId,
        sizeLabel: "XL",
        nurseryPotDiameterCm: 30,
      });
    } catch (error) {
      xlRejected = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "invalid_size_label");
    }
    assert.equal(xlRejected, true);
    const legacyXl = await sql`
      INSERT INTO plant_variants (plant_id, size_label, nursery_pot_diameter_cm)
      VALUES (${testPlantId}, 'XL', 30)
      RETURNING id
    `;
    const extra = (legacyXl as { id: string }[])[0];
    assert.ok(extra);
    variantIds.push(medium.id, large.id, extra.id);
    await seedNoPotOffer(large.id, 70);
    await applyInventoryDelta({ variantId: medium.id, delta: 2, note: `${tag} receive` });

    const ranged = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(ranged);
    assert.equal(ranged.unavailable, false);
    assert.equal(ranged.sizes.some((size) => size.sizeLabel === "XL"), false);

    const clay = await createPot({ name: `${tag} clay`, nameHe: "חימר", image: sourcePlant.images[0] });
    const stone = await createPot({ name: `${tag} stone` });
    potIds.push(clay.id, stone.id);

    const cardWithPots = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(cardWithPots);
    assert.equal(cardWithPots.sizes.some((size) => size.sizeLabel === "XL"), false);
    assert.deepEqual(cardWithPots.plantSizeCodes, ["S", "M", "L"]);
    const cardSizes = catalogSizeChoices(cardWithPots.sizes);
    assert.deepEqual(
      cardSizes.map((size) => size.sizeLabel),
      ["S", "M", "L"],
    );
    assert.equal(
      cardSizes.every((size) => size.variants.every((variant) => variant.potId == null)),
      true,
    );

    await updatePot({ potId: clay.id, supplierPrice: 8 });
    await applyPotInventoryDelta({
      potId: clay.id,
      delta: 2,
      note: `${tag} clay`,
    });
    const claySellable = await createSellableVariant({
      plantId: testPlantId,
      plantSizeId: medium.id,
      potId: clay.id,
    });
    sellableIds.push(claySellable.sellableVariantId);
    const clayOffer = await createOrReusePlantOffer({
      sellableVariantId: claySellable.sellableVariantId,
      consumerPrice: 110,
      availabilities: [{ scope: "catalog" }],
    });
    await updatePot({ potId: stone.id, supplierPrice: 6 });
    await applyPotInventoryDelta({
      potId: stone.id,
      delta: 2,
      note: `${tag} stone`,
    });
    const stoneSellable = await createSellableVariant({
      plantId: testPlantId,
      plantSizeId: medium.id,
      potId: stone.id,
    });
    sellableIds.push(stoneSellable.sellableVariantId);
    const stoneOffer = await createOrReusePlantOffer({
      sellableVariantId: stoneSellable.sellableVariantId,
      consumerPrice: 80,
      availabilities: [{ scope: "catalog" }],
    });

    const detail = await readCatalogShopDetail(testPlantId);
    assert.ok(detail);
    assert.deepEqual(
      detail.sizes.map((size) => size.sizeLabel),
      ["S", "M", "L"],
    );
    const byLabel = new Map(detail.sizes.map((size) => [size.sizeLabel, size]));
    const sizeS = byLabel.get("S");
    const sizeM = byLabel.get("M");
    const sizeL = byLabel.get("L");
    assert.ok(sizeS && sizeM && sizeL);
    assert.equal(sizeS.nurseryPotDiameterCm, 12);
    assert.equal(sizeS.variants[0]?.unitPrice, 40);
    assert.equal(sizeS.quantity, 0);
    assert.equal(sizeM.quantity, 2);
    assert.equal(sizeM.variants[0]?.unitPrice, 90);
    assert.equal(sizeL.nurseryPotDiameterCm, 21);
    assert.equal(sizeL.variants[0]?.unitPrice, 70);
    const pictured = sizeM.variants.find((variant) => variant.id === claySellable.sellableVariantId);
    const imageless = sizeM.variants.find((variant) => variant.id === stoneSellable.sellableVariantId);
    assert.equal(pictured?.potImage, sourcePlant.images[0]);
    assert.equal(pictured?.offerId, clayOffer.offer.id);
    assert.equal(pictured?.unitPrice, 110);
    assert.ok(imageless);
    assert.equal(imageless.potImage, undefined);
    assert.equal(imageless.offerId, stoneOffer.offer.id);
    assert.equal(imageless.unitPrice, 80);
    assert.equal(resolveCardVariant(sizeM)?.id, claySellable.sellableVariantId);
    assert.equal(resolveCardVariant(sizeM)?.potImage, sourcePlant.images[0]);
    assert.equal(
      resolveExplicitConfiguration(sizeM, stoneSellable.sellableVariantId)?.offerId,
      stoneOffer.offer.id,
    );
    await updatePot({ potId: clay.id, image: null });
    const afterClear = await readCatalogShopDetail(testPlantId);
    const clearedSize = afterClear?.sizes.find((entry) => entry.id === medium.id);
    const cleared = clearedSize?.variants.find((variant) => variant.id === claySellable.sellableVariantId);
    assert.ok(clearedSize && cleared);
    assert.equal(cleared.potImage, undefined);
    assert.equal(cleared.offerId, clayOffer.offer.id);
    assert.equal(resolveCardVariant(clearedSize)?.id, claySellable.sellableVariantId);
    assert.equal(resolveCardVariant(clearedSize)?.potImage, undefined);

    await applyInventoryDelta({ variantId: medium.id, delta: -2, note: `${tag} clear` });
    const soldOut = (await readCatalogShopCards()).find((card) => card.id === testPlantId);
    assert.ok(soldOut);
    assert.equal(soldOut.unavailable, true);
    const soldOutDetail = await readCatalogShopDetail(testPlantId);
    assert.equal(soldOutDetail?.sizes.find((size) => size.sizeLabel === "M")?.quantity, 0);

    const keptLegacy = await updatePlantVariant({
      plantId: testPlantId,
      variantId: extra.id,
      sizeLabel: "XL",
    });
    assert.equal(keptLegacy.sizeLabel, "XL");
    let remapRejected = false;
    try {
      await updatePlantVariant({
        plantId: testPlantId,
        variantId: extra.id,
        sizeLabel: "Huge",
      });
    } catch (error) {
      remapRejected = true;
      assert.ok(error instanceof PlantVariantWriteError);
      assert.equal(error.code, "invalid_size_label");
    }
    assert.equal(remapRejected, true);
    const stillLegacy = await sql`
      SELECT size_label FROM plant_variants WHERE id = ${extra.id}::uuid
    `;
    assert.equal((stillLegacy as { size_label: string }[])[0]?.size_label, "XL");
    const current = await getPlantByIdAsync(testPlantId);
    assert.ok(current);
    assert.equal("averageSize" in current, false);
    await updatePlant(testPlantId, { ...current, catalogPublished: false });
    const averageColumn = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'plants' AND column_name = 'average_size'
    `;
    assert.equal((averageColumn as unknown[]).length, 0);
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

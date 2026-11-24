/**
 * Plant Size supplier price (061) + plant-library DB image fallback.
 *
 * Run: npx tsx scripts/verify-plant-size-supplier-price.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertStaticContracts(): void {
  const migration = read("db/migrations/061_plant_variants_supplier_price.sql");
  assert.match(migration, /ALTER TABLE plant_variants/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS supplier_price/);
  assert.match(migration, /plant_variants_supplier_price_nonneg/);
  assert.match(migration, /pv.supplier_price IS NULL/);
  assert.match(migration, /ALTER TABLE plants/);
  assert.match(migration, /DROP COLUMN IF EXISTS supplier_price/);
  assert.match(migration, /061 refused to drop plants\.supplier_price/);
  assert.match(migration, /not preserved on any plant size/);
  assert.match(migration, /COALESCE\(p\.inventory_type, 'plants'\) <> 'flowers'/);
  assert.doesNotMatch(migration, /INSERT INTO plant_variants/);
  assert.ok(
    migration.indexOf("UPDATE plant_variants") < migration.indexOf("RAISE EXCEPTION"),
    "backfill must run before the preservation guard",
  );
  assert.ok(
    migration.indexOf("RAISE EXCEPTION") < migration.indexOf("DROP COLUMN IF EXISTS supplier_price"),
    "preservation guard must run before plants.supplier_price is dropped",
  );
  assert.match(migration, /plant_variants\.supplier_price@sale/);
  assert.match(migration, /plant_variants\.supplier_price@cycle/);
  assert.match(migration, /plants\.supplier_price@sale/);
  assert.match(migration, /plants\.supplier_price@cycle/);
  assert.doesNotMatch(migration, /UPDATE placement_segments/);
  assert.doesNotMatch(migration, /UPDATE order_items/);
  assert.doesNotMatch(migration, /UPDATE orders/);

  const storage = read("lib/plantVariantStorage.ts");
  assert.match(storage, /supplierPrice: number \| null/);
  assert.match(storage, /parsePlantVariantSupplierPrice/);
  assert.match(storage, /invalid_supplier_price/);

  const plantType = read("lib/types.ts");
  assert.doesNotMatch(plantType, /supplierPrice: number/);
  assert.doesNotMatch(plantType, /baseSupplierPrice/);
  assert.doesNotMatch(read("lib/plantStorage.ts"), /supplier_price/);
  assert.doesNotMatch(read("lib/plantValidation.ts"), /supplierPrice must be a non-negative number/);
  assert.doesNotMatch(read("lib/plantValidation.ts"), /baseSupplierPrice/);

  const sizesAdmin = read("components/admin/AdminPlantVariantsPanel.tsx");
  assert.match(sizesAdmin, /supplierPrice/);
  assert.match(sizesAdmin, /admin\.plants\.supplierCost/);
  assert.match(sizesAdmin, /createSupplierCost/);
  assert.match(sizesAdmin, /editSupplierCost/);

  const plantsAdmin = read("components/admin/AdminPlantsManager.tsx");
  assert.doesNotMatch(plantsAdmin, /\bsupplierPrice\b/);
  assert.doesNotMatch(plantsAdmin, /baseSupplierPrice/);
  assert.doesNotMatch(plantsAdmin, /admin\.plants\.supplierCost/);

  const sellableAdmin = read("components/admin/AdminSellableVariantsSection.tsx");
  assert.doesNotMatch(sellableAdmin, /supplierPrice/);
  const sellableCreate = sellableAdmin.slice(
    sellableAdmin.indexOf("async function handleCreate"),
    sellableAdmin.indexOf("async function handleSaveEdit"),
  );
  assert.doesNotMatch(sellableCreate, /supplierPrice/);
  assert.doesNotMatch(sellableCreate, /supplier_price/);

  const placement = read("lib/placementSegment.ts");
  assert.match(placement, /pv\.supplier_price/);
  assert.match(placement, /plant_variants\.supplier_price@cycle/);
  assert.match(placement, /plants\.supplier_price@cycle/);
  assert.match(placement, /pots\.supplier_price@segment/);

  const catalogPrep = read("lib/catalogPaymentPrep.ts");
  assert.match(catalogPrep, /pv\.supplier_price/);
  assert.match(catalogPrep, /plant_variants\.supplier_price@sale/);
  assert.doesNotMatch(catalogPrep, /WHEN p\.supplier_price/);
  assert.doesNotMatch(catalogPrep, /'plants\.supplier_price@sale'/);

  const snapshot = read("lib/catalogCheckoutSnapshot.ts");
  assert.match(snapshot, /snapshotPlantVariantUnitCosts/);
  assert.match(snapshot, /FROM plant_variants/);
  assert.match(snapshot, /plant_variants\.supplier_price@sale/);
  assert.match(snapshot, /plants\.supplier_price@sale/);

  const partnerPrep = read("lib/startCardcomPaymentPrep.ts");
  assert.match(partnerPrep, /partnerSupplierCostFromPlantPrice\(sizeSupplierPrice\)/);
  assert.doesNotMatch(partnerPrep, /plant\.supplierPrice/);
  assert.match(partnerPrep, /: null;/);

  const imageSrc = read("lib/plantImageStorage.ts");
  const getBytes = imageSrc.slice(imageSrc.indexOf("export async function getPlantLibraryImageBytes"));
  assert.match(getBytes, /readPlantLibraryBlob/);
  assert.match(getBytes, /getPlantLibraryImageFromDb/);
  assert.ok(
    getBytes.indexOf("readPlantLibraryBlob") < getBytes.indexOf("getPlantLibraryImageFromDb"),
    "DB image lookup is after disk and blob",
  );

  console.log("verify-plant-size-supplier-price: static contracts ok");
}

async function main(): Promise<void> {
  assertStaticContracts();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const dbHost = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (dbHost.includes("twilight-truth")) {
    throw new Error("Refusing to verify against production");
  }

  const { sql } = await import("../lib/db");
  const { parsePlantBody } = await import("../lib/plantValidation");
  const { createPlant, deletePlant } = await import("../lib/plantStorage");
  const {
    createPlantVariant,
    updatePlantVariant,
    deletePlantVariant,
  } = await import("../lib/plantVariantStorage");
  const {
    LEGACY_PLANT_UNIT_COST_SOURCE,
    PLANT_UNIT_COST_SOURCE,
    parseCatalogPaymentSnapshot,
    snapshotPlantVariantUnitCosts,
  } = await import("../lib/catalogCheckoutSnapshot");
  const {
    LEGACY_PARTNER_SUPPLIER_UNIT_COST_SOURCE,
    PARTNER_SUPPLIER_UNIT_COST_SOURCE,
    partnerSupplierCostFromPlantPrice,
    parseStoredPartnerSupplierCost,
  } = await import("../lib/partnerSupplierCost");
  const { getPlantLibraryImageBytes } = await import("../lib/plantImageStorage");
  const { savePlantLibraryImageToDb } = await import("../lib/plantImageDbStorage");

  const cols = await sql`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'plant_variants'
      AND column_name = 'supplier_price'
  `;
  assert.equal((cols as unknown[]).length, 1);
  assert.equal((cols as { is_nullable: string }[])[0].is_nullable, "YES");

  const plantPriceCols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'plants'
      AND column_name = 'supplier_price'
  `;
  assert.equal((plantPriceCols as unknown[]).length, 0, "plants.supplier_price must be dropped");

  const checks = await sql`
    SELECT 1 AS ok
    FROM pg_constraint
    WHERE conname = 'plant_variants_supplier_price_nonneg'
  `;
  assert.equal((checks as unknown[]).length, 1);

  assert.equal(PLANT_UNIT_COST_SOURCE, "plant_variants.supplier_price@sale");
  assert.equal(PARTNER_SUPPLIER_UNIT_COST_SOURCE, PLANT_UNIT_COST_SOURCE);
  assert.equal(LEGACY_PLANT_UNIT_COST_SOURCE, "plants.supplier_price@sale");
  assert.equal(LEGACY_PARTNER_SUPPLIER_UNIT_COST_SOURCE, LEGACY_PLANT_UNIT_COST_SOURCE);

  const tagged = partnerSupplierCostFromPlantPrice(25);
  assert.deepEqual(tagged, {
    supplierUnitCost: 25,
    supplierUnitCostSource: PARTNER_SUPPLIER_UNIT_COST_SOURCE,
  });
  assert.equal(partnerSupplierCostFromPlantPrice(null), null);
  assert.deepEqual(
    parseStoredPartnerSupplierCost({
      supplierUnitCost: 12.5,
      supplierUnitCostSource: LEGACY_PARTNER_SUPPLIER_UNIT_COST_SOURCE,
    }),
    {
      supplierUnitCost: 12.5,
      supplierUnitCostSource: LEGACY_PARTNER_SUPPLIER_UNIT_COST_SOURCE,
    },
  );
  assert.deepEqual(
    parseStoredPartnerSupplierCost({
      supplierUnitCost: 8,
      supplierUnitCostSource: PARTNER_SUPPLIER_UNIT_COST_SOURCE,
    }),
    {
      supplierUnitCost: 8,
      supplierUnitCostSource: PARTNER_SUPPLIER_UNIT_COST_SOURCE,
    },
  );

  const historical = parseCatalogPaymentSnapshot({
    sourcePartnerId: null,
    lines: [
      {
        lineNo: 1,
        plantId: "plant",
        plantVariantId: "variant",
        sellableVariantId: "sv",
        offerId: "offer",
        potId: null,
        potSizeId: null,
        potColorId: null,
        quantity: 1,
        unitPrice: 10,
        lineTotal: 10,
        currency: "ILS",
        plantName: "Historical",
        plantNameHe: null,
        sizeLabel: "M",
        potName: null,
        potSizeLabel: null,
        potColor: null,
        potColorHe: null,
        plantUnitCost: 7,
        plantUnitCostSource: LEGACY_PLANT_UNIT_COST_SOURCE,
        potUnitCost: null,
        potUnitCostSource: null,
      },
    ],
  });
  assert.equal(historical?.lines[0]?.plantUnitCost, 7);
  assert.equal(historical?.lines[0]?.plantUnitCostSource, LEGACY_PLANT_UNIT_COST_SOURCE);

  const tag = `size-price-${randomUUID().slice(0, 8)}`;
  const parsed = parsePlantBody(
    {
      id: randomUUID(),
      name: `${tag} plant`,
      subtitle: "Leaf",
      description: "A plant",
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

  let plantId = "";
  let sizeM = "";
  let sizeL = "";
  let sizeS = "";
  const imageFilename = `verify-db-fallback-${randomUUID().slice(0, 8)}.jpg`;
  try {
    const plant = await createPlant(parsed.plant);
    plantId = plant.id;
    assert.equal("supplierPrice" in plant, false);
    const medium = await createPlantVariant({
      plantId,
      sizeLabel: "M",
      supplierPrice: 25,
    });
    const large = await createPlantVariant({
      plantId,
      sizeLabel: "L",
      supplierPrice: 55,
    });
    const small = await createPlantVariant({
      plantId,
      sizeLabel: "S",
    });
    sizeM = medium.id;
    sizeL = large.id;
    sizeS = small.id;
    assert.equal(medium.supplierPrice, 25);
    assert.equal(large.supplierPrice, 55);
    assert.equal(small.supplierPrice, null);

    const updated = await updatePlantVariant({
      plantId,
      variantId: sizeS,
      supplierPrice: 12.5,
    });
    assert.equal(updated.supplierPrice, 12.5);

    const costs = await snapshotPlantVariantUnitCosts([sizeM, sizeL, sizeS]);
    assert.equal(costs.get(sizeM)?.plantUnitCost, 25);
    assert.equal(costs.get(sizeL)?.plantUnitCost, 55);
    assert.equal(costs.get(sizeS)?.plantUnitCost, 12.5);
    assert.equal(costs.get(sizeM)?.plantUnitCostSource, PLANT_UNIT_COST_SOURCE);

    const jpeg = Buffer.from(
      "ffd8ffe000104a46494600010100000100010000ffd9",
      "hex",
    );
    await savePlantLibraryImageToDb(jpeg, "image/jpeg", imageFilename);
    const fromDb = await getPlantLibraryImageBytes(imageFilename);
    assert.equal(Boolean(fromDb), true);
    assert.equal(fromDb?.data.byteLength, jpeg.byteLength);
    assert.equal(fromDb?.data[0], 0xff);
    assert.equal(fromDb?.data[1], 0xd8);

    const onDisk = await getPlantLibraryImageBytes(
      "chatgpt-image-sep-28-2026-11-55-47-am-1-0a0a7ff9.jpg",
    );
    assert.equal(Boolean(onDisk), true);
    assert.ok((onDisk?.data.byteLength ?? 0) > 1000);

    console.log("verify-plant-size-supplier-price: sizes, snapshots, image fallback ok");
  } finally {
    await sql`DELETE FROM plant_library_images WHERE filename = ${imageFilename}`;
    if (sizeS) await deletePlantVariant({ plantId, variantId: sizeS }).catch(() => undefined);
    if (sizeM) await deletePlantVariant({ plantId, variantId: sizeM }).catch(() => undefined);
    if (sizeL) await deletePlantVariant({ plantId, variantId: sizeL }).catch(() => undefined);
    if (plantId) await deletePlant(plantId).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

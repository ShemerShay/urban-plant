/**
 * Sellable Variant = Plant Size + optional Catalog Pot.
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
  const sku = read("db/migrations/056_catalog_pot_sku.sql");
  assert.match(sku, /UNIQUE NULLS NOT DISTINCT \(plant_variant_id, pot_id\)/);
  assert.match(sku, /REFERENCES pots \(id\) ON DELETE RESTRICT/);
  assert.match(sku, /DROP COLUMN IF EXISTS pot_size_id/);
  assert.doesNotMatch(migration, /INSERT INTO/);
  assert.doesNotMatch(migration, /catalog_price/);
  assert.doesNotMatch(migration, /sellable_variant_id/);
  assert.equal(existsSync(join(root, "app/admin/variants/page.tsx")), false);

  const shop = read("lib/catalogShop.ts");
  const cart = read("lib/catalogCart.ts");
  const pos = read("lib/posSpotStorage.ts");
  assert.match(shop, /FROM sellable_variants/);
  for (const source of [cart, pos]) {
    assert.doesNotMatch(source, /sellable_variants/);
  }

  const potsAdmin = read("components/admin/AdminPotsManager.tsx");
  assert.match(potsAdmin, /routes\.api\.pots\(\)/);
  const section = read("components/admin/AdminSellableVariantsSection.tsx");
  assert.match(section, /routes\.api\.pots\(\)/);
  assert.match(section, /catalogPotEditChoices/);
  assert.match(section, /admin\.plants\.sellableVariants\.edit/);
  assert.match(section, /admin\.plants\.sellableVariants\.delete/);
  assert.match(section, /method: "PATCH"/);
  const saveEdit = section.slice(
    section.indexOf("async function handleSaveEdit"),
    section.indexOf("async function confirmDelete"),
  );
  assert.match(saveEdit, /potId/);
  assert.doesNotMatch(saveEdit, /plantSizeId/);
  assert.doesNotMatch(saveEdit, /potColorId/);
  assert.doesNotMatch(saveEdit, /potSizeId/);
  assert.doesNotMatch(saveEdit, /supplierCost/);
  const storage = read("lib/sellableVariantStorage.ts");
  assert.match(storage, /export async function updateSellableVariantPot/);
  assert.match(storage, /SELLABLE_VARIANT_ACTIVE_OFFER_MESSAGE/);
  assert.match(
    storage,
    /This variant is used by an active offer\. Create a new variant for a different configuration\./,
  );
  assert.doesNotMatch(storage, /SELLABLE_VARIANT_POT_LOCKED_MESSAGE/);
  assert.doesNotMatch(storage, /Its pot cannot be changed/);
  assert.doesNotMatch(storage, /already used by an offer, order, or placement/);
  assert.match(section, /existingSellableVariantId/);
  assert.match(section, /activeOfferLocked/);
  assert.match(section, /referencedByActiveOffer/);
  assert.match(section, /quantity,/);
  assert.doesNotMatch(section, /quantity > 0/);
  const potChoices = read("lib/catalogPotEditChoices.ts");
  assert.match(potChoices, /even when central quantity is 0/);
  assert.doesNotMatch(potChoices, /quantity > 0/);
  const updateFn = storage.slice(
    storage.indexOf("export async function updateSellableVariantPot"),
    storage.indexOf("export async function deleteSellableVariant"),
  );
  const updateAt = updateFn.indexOf("UPDATE sellable_variants");
  const setClause = updateFn.slice(updateAt, updateFn.indexOf("WHERE id", updateAt));
  assert.match(setClause, /pot_id/);
  assert.doesNotMatch(setClause, /pot_size_id/);
  assert.doesNotMatch(setClause, /plant_variant_id/);
  assert.doesNotMatch(updateFn, /pot_color/);
  assert.match(updateFn, /status = 'active'/);
  assert.doesNotMatch(updateFn, /order_items/);
  assert.doesNotMatch(updateFn, /placement_segments/);
  assert.doesNotMatch(updateFn, /UPDATE pos_spots/);
  assert.doesNotMatch(updateFn, /pot_inventory/);

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
  assert.doesNotMatch(read("lib/adminOrderDisplay.ts"), /sellable_variants/);
  assert.doesNotMatch(read("lib/catalogDocumentLines.ts"), /sellable_variants/);
  assert.doesNotMatch(read("lib/placementSegment.ts"), /sellable_variants/);

  console.log("verify-sellable-variants: Catalog reads sellable variants; cart and POS storage do not name that table");
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

  const { catalogPotEditChoices } = await import("../lib/catalogPotEditChoices");
  const sampleChoices = catalogPotEditChoices([
    { id: "pot-diameter", name: "Ceramic", diameterCm: 14, active: true, quantity: 0 },
    { id: "pot-plain", name: "Terracotta", active: true, quantity: 3 },
    { id: "pot-inactive", name: "Retired", diameterCm: 20, active: false, quantity: 9 },
  ]);
  assert.deepEqual(
    sampleChoices.map((choice) => choice.label),
    ["Ceramic · 14 cm", "Terracotta"],
  );
  assert.equal(sampleChoices[0]?.potId, "pot-diameter");
  assert.equal(sampleChoices[1]?.potId, "pot-plain");
  const withInactive = catalogPotEditChoices(
    [
      { id: "pot-diameter", name: "Ceramic", diameterCm: 14, active: true },
      { id: "pot-inactive", name: "Retired", diameterCm: 20, active: false },
    ],
    { includePotId: "pot-inactive" },
  );
  assert.equal(
    withInactive.find((choice) => choice.potId === "pot-inactive")?.label,
    "Retired · 20 cm",
  );

  const catalogPots = await sql`
    SELECT id, name, diameter_cm, active
    FROM pots
    ORDER BY name ASC, id ASC
  `;
  const liveChoices = catalogPotEditChoices(
    (catalogPots as {
      id: string;
      name: string;
      diameter_cm: string | number | null;
      active: boolean | null;
    }[]).map((pot) => {
      const diameter =
        pot.diameter_cm == null
          ? undefined
          : typeof pot.diameter_cm === "number"
            ? pot.diameter_cm
            : Number(pot.diameter_cm);
      return {
        id: pot.id,
        name: pot.name,
        active: pot.active !== false,
        ...(diameter != null && Number.isFinite(diameter) ? { diameterCm: diameter } : {}),
      };
    }),
  );
  const activePots = (
    catalogPots as { id: string; name: string; active: boolean | null }[]
  ).filter((pot) => pot.active !== false && pot.name.trim());
  assert.equal(liveChoices.length, activePots.length);
  for (const pot of activePots) {
    assert.ok(
      liveChoices.some(
        (choice) => choice.potId === pot.id && (choice.label === pot.name || choice.label.startsWith(`${pot.name} · `)),
      ),
      pot.name,
    );
  }

  const { parsePlantBody } = await import("../lib/plantValidation");
  const { createPlant, deletePlant } = await import("../lib/plantStorage");
  const { createPlantVariant, deletePlantVariant, PlantVariantWriteError } = await import(
    "../lib/plantVariantStorage"
  );
  const { createPot, deletePot, PotWriteError, readPots, updatePot } = await import("../lib/potStorage");
  const { getPotInventoryQuantity, setPotCentralQuantity } = await import("../lib/potInventoryStorage");
  const {
    SellableVariantWriteError,
    SELLABLE_VARIANT_ACTIVE_OFFER_MESSAGE,
    SELLABLE_VARIANT_DUPLICATE_MESSAGE,
    SELLABLE_VARIANT_INACTIVE_POT_MESSAGE,
    createSellableVariant,
    deleteSellableVariant,
    readSellableVariantsForPlant,
    updateSellableVariantPot,
  } = await import("../lib/sellableVariantStorage");
  const { deriveSellableVariantSupplierCost } = await import("../lib/sellableVariantCost");

  const missing = deriveSellableVariantSupplierCost({
    plantSupplierCost: 40,
    potId: "size",
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
  let potSId = "";
  let potLId = "";
  let inactivePotId = "";
  let zeroPotId = "";
  let besidePotId = "";
  let offerId = "";
  let orderId = "";
  let partnerLocationId = "";
  let spotId = "";
  let cycleId = "";

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
    });
    const flower = await createPlant(flowerParsed.plant);
    flowerId = flower.id;
    const medium = await createPlantVariant({ plantId, sizeLabel: "M" });
    const small = await createPlantVariant({ plantId, sizeLabel: "S" });
    const potM = await updatePot({
      potId: (await createPot({ name: `${tag} terracotta` })).id,
      supplierPrice: 12.5,
    });
    potId = potM.id;
    const potS = await createPot({ name: `${tag} pot s` });
    potSId = potS.id;
    assert.equal(potS.supplierPrice, null);

    const legacyId = randomUUID();
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label)
      VALUES (${legacyId}::uuid, ${plantId}, 'XL')
    `;

    const noPot = await createSellableVariant({
      plantId,
      plantSizeId: medium.id,
      potId: null,
    });
    assert.equal(noPot.potId, null);
    assert.equal(noPot.supplierCost, 40);
    assert.equal(noPot.missingPotSupplierCost, false);

    const withPot = await createSellableVariant({
      plantId,
      plantSizeId: medium.id,
      potId: potM.id,
    });
    assert.equal(withPot.potId, potM.id);
    assert.equal(withPot.potName, `${tag} terracotta`);
    assert.equal(withPot.supplierCost, 52.5);

    const cross = await createSellableVariant({
      plantId,
      plantSizeId: medium.id,
      potId: potS.id,
    });
    assert.equal(cross.plantSizeLabel, "M");
    assert.equal(cross.potId, potS.id);
    assert.equal(cross.potName, `${tag} pot s`);
    assert.equal(cross.supplierCost, null);
    assert.equal(cross.missingPotSupplierCost, true);

    let duplicateNoPot = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: medium.id, potId: null });
    } catch (error) {
      duplicateNoPot = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "duplicate");
      assert.equal(error.existingSellableVariantId, noPot.sellableVariantId);
    }
    assert.equal(duplicateNoPot, true);

    let duplicatePair = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: medium.id, potId: potM.id });
    } catch (error) {
      duplicatePair = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "duplicate");
      assert.equal(error.existingSellableVariantId, withPot.sellableVariantId);
    }
    assert.equal(duplicatePair, true);

    let badId = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: "not-a-uuid", potId: null });
    } catch (error) {
      badId = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(badId, true);

    let unknownSize = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: randomUUID(), potId: null });
    } catch (error) {
      unknownSize = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(unknownSize, true);

    let unknownPot = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: small.id, potId: randomUUID() });
    } catch (error) {
      unknownPot = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(unknownPot, true);

    let legacy = false;
    try {
      await createSellableVariant({ plantId, plantSizeId: legacyId, potId: null });
    } catch (error) {
      legacy = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "invalid_plant_size");
    }
    assert.equal(legacy, true);

    let flowerRejected = false;
    try {
      await createSellableVariant({ plantId: flowerId, plantSizeId: medium.id, potId: null });
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
        potId: null,
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
        potId: "not-a-uuid",
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
      "pot_id",
      "updated_at",
    ]);

    const listed = await readSellableVariantsForPlant(plantId);
    assert.equal(listed.length, 3);

    const potL = await updatePot({
      potId: (await createPot({ name: `${tag} pot l` })).id,
      supplierPrice: 7,
    });
    potLId = potL.id;
    const toPot = await updateSellableVariantPot({
      plantId,
      sellableVariantId: noPot.sellableVariantId,
      potId: potL.id,
    });
    assert.equal(toPot.sellableVariantId, noPot.sellableVariantId);
    assert.equal(toPot.plantSizeId, medium.id);
    assert.equal(toPot.plantSizeLabel, "M");
    assert.equal(toPot.potId, potL.id);
    assert.equal(toPot.supplierCost, 47);
    assert.equal(toPot.missingPotSupplierCost, false);

    const backToBare = await updateSellableVariantPot({
      plantId,
      sellableVariantId: noPot.sellableVariantId,
      potId: null,
    });
    assert.equal(backToBare.sellableVariantId, noPot.sellableVariantId);
    assert.equal(backToBare.plantSizeId, medium.id);
    assert.equal(backToBare.potId, null);
    assert.equal(backToBare.supplierCost, 40);

    let duplicateEdit = false;
    try {
      await updateSellableVariantPot({
        plantId,
        sellableVariantId: noPot.sellableVariantId,
        potId: potM.id,
      });
    } catch (error) {
      duplicateEdit = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "duplicate");
      assert.equal(error.message, SELLABLE_VARIANT_DUPLICATE_MESSAGE);
      assert.equal(error.existingSellableVariantId, withPot.sellableVariantId);
    }
    assert.equal(duplicateEdit, true);
    const afterDuplicate = await readSellableVariantsForPlant(plantId);
    assert.equal(
      afterDuplicate.find((row) => row.sellableVariantId === noPot.sellableVariantId)?.potId,
      null,
    );

    let duplicateBareEdit = false;
    try {
      await updateSellableVariantPot({
        plantId,
        sellableVariantId: withPot.sellableVariantId,
        potId: null,
      });
    } catch (error) {
      duplicateBareEdit = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "duplicate");
      assert.equal(error.existingSellableVariantId, noPot.sellableVariantId);
    }
    assert.equal(duplicateBareEdit, true);
    const potKept = await readSellableVariantsForPlant(plantId);
    assert.equal(
      potKept.find((row) => row.sellableVariantId === withPot.sellableVariantId)?.potId,
      potM.id,
    );

    const zeroPot = await createPot({ name: `${tag} zero qty` });
    zeroPotId = zeroPot.id;
    assert.equal(await getPotInventoryQuantity(zeroPotId), 0);
    const emptyInventory = await sql`
      SELECT count(*)::int AS count FROM pot_inventory WHERE pot_id = ${zeroPotId}::uuid
    `;
    assert.equal((emptyInventory as { count: number }[])[0]?.count, 0);
    const choiceInputs = (pots: Awaited<ReturnType<typeof readPots>>) =>
      pots.map((pot) => ({
        id: pot.id,
        name: pot.name,
        active: pot.active,
        quantity: pot.quantity,
        ...(pot.diameterCm != null ? { diameterCm: pot.diameterCm } : {}),
      }));
    const missingRowChoices = catalogPotEditChoices(choiceInputs(await readPots()));
    assert.equal(
      missingRowChoices.some((choice) => choice.potId === zeroPotId),
      true,
    );
    const plantBeforeZero = await sql`
      SELECT COALESCE((SELECT quantity FROM inventory WHERE variant_id = ${small.id}::uuid), 0)::int AS qty
    `;
    const zeroVariant = await createSellableVariant({
      plantId,
      plantSizeId: small.id,
      potId: zeroPotId,
    });
    assert.equal(zeroVariant.potId, zeroPotId);
    const stillEmpty = await sql`
      SELECT count(*)::int AS count FROM pot_inventory WHERE pot_id = ${zeroPotId}::uuid
    `;
    assert.equal((stillEmpty as { count: number }[])[0]?.count, 0);
    const plantAfterZero = await sql`
      SELECT COALESCE((SELECT quantity FROM inventory WHERE variant_id = ${small.id}::uuid), 0)::int AS qty
    `;
    assert.deepEqual(plantAfterZero, plantBeforeZero);
    await deleteSellableVariant({ plantId, sellableVariantId: zeroVariant.sellableVariantId });

    await setPotCentralQuantity({ potId: zeroPotId, quantity: 1 });
    assert.equal(await setPotCentralQuantity({ potId: zeroPotId, quantity: 0 }), 0);
    const historyBefore = await sql`
      SELECT count(*)::int AS count FROM pot_inventory_history WHERE pot_id = ${zeroPotId}::uuid
    `;
    const explicitZeroChoices = catalogPotEditChoices(choiceInputs(await readPots()));
    assert.equal(
      explicitZeroChoices.some(
        (choice) => choice.potId === zeroPotId && choice.label.startsWith(`${tag} zero qty`),
      ),
      true,
    );
    const zeroAgain = await createSellableVariant({
      plantId,
      plantSizeId: small.id,
      potId: zeroPotId,
    });
    assert.equal(await getPotInventoryQuantity(zeroPotId), 0);
    const historyAfter = await sql`
      SELECT count(*)::int AS count FROM pot_inventory_history WHERE pot_id = ${zeroPotId}::uuid
    `;
    assert.deepEqual(historyAfter, historyBefore);
    const plantAfterExplicitZero = await sql`
      SELECT COALESCE((SELECT quantity FROM inventory WHERE variant_id = ${small.id}::uuid), 0)::int AS qty
    `;
    assert.deepEqual(plantAfterExplicitZero, plantBeforeZero);
    await deleteSellableVariant({ plantId, sellableVariantId: zeroAgain.sellableVariantId });
    await deletePot(zeroPotId);
    zeroPotId = "";

    offerId = `${tag}-offer`;
    await sql`
      INSERT INTO offers (id, product_id, sellable_variant_id, consumer_price, status, created_at)
      VALUES (${offerId}, ${plantId}, ${noPot.sellableVariantId}::uuid, 79, 'active', now())
    `;
    await sql`
      INSERT INTO offer_availabilities (offer_id, scope)
      VALUES (${offerId}, 'catalog')
    `;
    const { createPartnerLocation } = await import("../lib/partnerLocationStorage");
    const { appendPosSpot } = await import("../lib/posSpotStorage");
    partnerLocationId = `${tag}-partner`;
    await sql`
      INSERT INTO partners (id, name)
      VALUES (${partnerLocationId}, ${`${tag} partner`})
    `;
    await createPartnerLocation({
      id: partnerLocationId,
      partnerId: partnerLocationId,
      name: `${tag} partner`,
      address: "Test street",
      type: "cafe",
      partnerType: "cafe",
      payments: [],
      pickupDisabled: false,
      monthlyRevenue: 0,
      setupCost: 0,
      notes: "",
    });
    const spot = await appendPosSpot({
      id: randomUUID(),
      spotName: `${tag}-spot`,
      partnerLocationId,
      posNumber: "77",
      posName: `${tag} spot`,
      spotSlug: `${tag}-spot`,
      currentOfferId: offerId,
      plantVariantId: medium.id,
      potId: undefined,
      status: "available",
      checkStatus: false,
      createdAt: new Date().toISOString(),
    });
    spotId = spot.id;
    const cycles = await sql`
      INSERT INTO placement_cycles (
        pos_spot_id, plant_variant_id, started_at, ended_at, end_reason
      )
      VALUES (
        ${spotId}::uuid,
        ${medium.id}::uuid,
        now() - interval '2 days',
        now() - interval '1 day',
        'removed'
      )
      RETURNING id::text AS id
    `;
    cycleId = (cycles as { id: string }[])[0]?.id ?? "";
    await sql`
      INSERT INTO placement_segments (
        placement_cycle_id, started_at, ended_at, offer_id, consumer_price,
        sellable_variant_id, pot_id
      )
      VALUES (
        ${cycleId}::uuid,
        now() - interval '2 days',
        now() - interval '1 day',
        ${offerId},
        79,
        ${noPot.sellableVariantId}::uuid,
        NULL
      )
    `;
    orderId = randomUUID();
    await sql`
      INSERT INTO orders (
        order_id, product_id, product_name, price, full_name,
        fulfillment_method, order_status, created_at, channel
      )
      VALUES (
        ${orderId}::uuid, ${plantId}, ${`${tag} plant`}, 79, 'Snapshot Buyer',
        'delivery', 'sold', now(), 'catalog'
      )
    `;
    await sql`
      INSERT INTO order_items (
        order_id, line_no, plant_id, plant_variant_id, sellable_variant_id, offer_id,
        quantity, unit_price, line_total, currency, plant_name, pot_name, pot_id
      )
      VALUES (
        ${orderId}::uuid, 1, ${plantId}, ${medium.id}::uuid, ${noPot.sellableVariantId}::uuid, ${offerId},
        1, 79, 79, 'ILS', ${`${tag} plant`}, 'Snapshot Pot', NULL
      )
    `;
    const lockedRows = await readSellableVariantsForPlant(plantId);
    assert.equal(
      lockedRows.find((row) => row.sellableVariantId === noPot.sellableVariantId)?.referencedByActiveOffer,
      true,
    );
    assert.equal(
      lockedRows.find((row) => row.sellableVariantId === withPot.sellableVariantId)?.referencedByActiveOffer,
      false,
    );
    const unchanged = await updateSellableVariantPot({
      plantId,
      sellableVariantId: noPot.sellableVariantId,
      potId: null,
    });
    assert.equal(unchanged.potId, null);
    assert.equal(unchanged.referencedByActiveOffer, true);
    const beforeStock = await sql`
      SELECT
        COALESCE((SELECT quantity FROM pot_inventory WHERE pot_id = ${potL.id}::uuid), 0)::int AS pot_qty,
        COALESCE((SELECT quantity FROM inventory WHERE variant_id = ${medium.id}::uuid), 0)::int AS plant_qty,
        (SELECT count(*)::int FROM pot_inventory_history WHERE pot_id = ${potL.id}::uuid) AS pot_history,
        (SELECT count(*)::int FROM inventory_history WHERE variant_id = ${medium.id}::uuid) AS plant_history
    `;
    let lockedEdit = false;
    try {
      await updateSellableVariantPot({
        plantId,
        sellableVariantId: noPot.sellableVariantId,
        potId: potL.id,
      });
    } catch (error) {
      lockedEdit = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "active_offer");
      assert.equal(error.message, SELLABLE_VARIANT_ACTIVE_OFFER_MESSAGE);
    }
    assert.equal(lockedEdit, true);
    let lockedDuplicate = false;
    try {
      await updateSellableVariantPot({
        plantId,
        sellableVariantId: noPot.sellableVariantId,
        potId: potM.id,
      });
    } catch (error) {
      lockedDuplicate = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "active_offer");
    }
    assert.equal(lockedDuplicate, true);
    const stillBare = await readSellableVariantsForPlant(plantId);
    assert.equal(
      stillBare.find((row) => row.sellableVariantId === noPot.sellableVariantId)?.potId,
      null,
    );
    const besidePot = await createPot({ name: `${tag} beside` });
    besidePotId = besidePot.id;
    const beside = await createSellableVariant({
      plantId,
      plantSizeId: medium.id,
      potId: besidePot.id,
    });
    assert.notEqual(beside.sellableVariantId, noPot.sellableVariantId);
    assert.equal(beside.potId, besidePot.id);
    assert.equal(beside.referencedByActiveOffer, false);
    const lockedAfterCreate = await readSellableVariantsForPlant(plantId);
    assert.equal(
      lockedAfterCreate.find((row) => row.sellableVariantId === noPot.sellableVariantId)?.potId,
      null,
    );
    await deleteSellableVariant({ plantId, sellableVariantId: beside.sellableVariantId });
    await deletePot(besidePot.id);
    besidePotId = "";
    const editedOffer = await sql`
      SELECT sellable_variant_id::text AS sellable_variant_id, status
      FROM offers
      WHERE id = ${offerId}
    `;
    assert.equal(
      (editedOffer as { sellable_variant_id: string; status: string }[])[0]?.sellable_variant_id,
      noPot.sellableVariantId,
    );
    assert.equal((editedOffer as { status: string }[])[0]?.status, "active");
    const catalog = await sql`
      SELECT sv.id::text AS sellable_variant_id, sv.pot_id::text AS pot_id
      FROM sellable_variants sv
      INNER JOIN offers o
        ON o.sellable_variant_id = sv.id
       AND o.status = 'active'
      INNER JOIN offer_availabilities a
        ON a.offer_id = o.id
       AND a.scope = 'catalog'
      WHERE o.id = ${offerId}
    `;
    const catalogRow = (catalog as { sellable_variant_id: string; pot_id: string | null }[])[0];
    assert.equal(catalogRow?.sellable_variant_id, noPot.sellableVariantId);
    assert.equal(catalogRow?.pot_id, null);
    const historicalOrder = await sql`
      SELECT pot_id::text AS pot_id, pot_name, sellable_variant_id::text AS sellable_variant_id
      FROM order_items
      WHERE order_id = ${orderId}::uuid
    `;
    const orderLine = (historicalOrder as { pot_id: string | null; pot_name: string | null; sellable_variant_id: string }[])[0];
    assert.equal(orderLine?.pot_id, null);
    assert.equal(orderLine?.pot_name, "Snapshot Pot");
    assert.equal(orderLine?.sellable_variant_id, noPot.sellableVariantId);
    const historicalSegment = await sql`
      SELECT pot_id::text AS pot_id, sellable_variant_id::text AS sellable_variant_id
      FROM placement_segments
      WHERE placement_cycle_id = ${cycleId}::uuid
    `;
    const segment = (historicalSegment as { pot_id: string | null; sellable_variant_id: string }[])[0];
    assert.equal(segment?.pot_id, null);
    assert.equal(segment?.sellable_variant_id, noPot.sellableVariantId);
    const physicalSpot = await sql`
      SELECT pot_id::text AS pot_id, current_offer_id
      FROM pos_spots
      WHERE id = ${spotId}::uuid
    `;
    assert.equal((physicalSpot as { pot_id: string | null }[])[0]?.pot_id, null);
    assert.equal((physicalSpot as { current_offer_id: string }[])[0]?.current_offer_id, offerId);
    const afterStock = await sql`
      SELECT
        COALESCE((SELECT quantity FROM pot_inventory WHERE pot_id = ${potL.id}::uuid), 0)::int AS pot_qty,
        COALESCE((SELECT quantity FROM inventory WHERE variant_id = ${medium.id}::uuid), 0)::int AS plant_qty,
        (SELECT count(*)::int FROM pot_inventory_history WHERE pot_id = ${potL.id}::uuid) AS pot_history,
        (SELECT count(*)::int FROM inventory_history WHERE variant_id = ${medium.id}::uuid) AS plant_history
    `;
    assert.deepEqual(afterStock, beforeStock);
    await sql`UPDATE offers SET status = 'inactive' WHERE id = ${offerId}`;
    const unlockedRows = await readSellableVariantsForPlant(plantId);
    assert.equal(
      unlockedRows.find((row) => row.sellableVariantId === noPot.sellableVariantId)?.referencedByActiveOffer,
      false,
    );
    const edited = await updateSellableVariantPot({
      plantId,
      sellableVariantId: noPot.sellableVariantId,
      potId: potL.id,
    });
    assert.equal(edited.sellableVariantId, noPot.sellableVariantId);
    assert.equal(edited.plantSizeId, medium.id);
    assert.equal(edited.plantSizeLabel, "M");
    assert.equal(edited.potId, potL.id);
    assert.equal(edited.referencedByActiveOffer, false);
    const offerAfterEdit = await sql`
      SELECT sellable_variant_id::text AS sellable_variant_id, status
      FROM offers
      WHERE id = ${offerId}
    `;
    assert.equal(
      (offerAfterEdit as { sellable_variant_id: string }[])[0]?.sellable_variant_id,
      noPot.sellableVariantId,
    );
    assert.equal((offerAfterEdit as { status: string }[])[0]?.status, "inactive");
    const spotAfterEdit = await sql`
      SELECT pot_id::text AS pot_id, current_offer_id
      FROM pos_spots
      WHERE id = ${spotId}::uuid
    `;
    assert.equal((spotAfterEdit as { pot_id: string | null }[])[0]?.pot_id, null);
    assert.equal((spotAfterEdit as { current_offer_id: string }[])[0]?.current_offer_id, offerId);
    const stockAfterEdit = await sql`
      SELECT
        COALESCE((SELECT quantity FROM pot_inventory WHERE pot_id = ${potL.id}::uuid), 0)::int AS pot_qty,
        COALESCE((SELECT quantity FROM inventory WHERE variant_id = ${medium.id}::uuid), 0)::int AS plant_qty,
        (SELECT count(*)::int FROM pot_inventory_history WHERE pot_id = ${potL.id}::uuid) AS pot_history,
        (SELECT count(*)::int FROM inventory_history WHERE variant_id = ${medium.id}::uuid) AS plant_history
    `;
    assert.deepEqual(stockAfterEdit, beforeStock);
    const restored = await updateSellableVariantPot({
      plantId,
      sellableVariantId: noPot.sellableVariantId,
      potId: null,
    });
    assert.equal(restored.sellableVariantId, noPot.sellableVariantId);
    assert.equal(restored.potId, null);
    const segmentAfterRestore = await sql`
      SELECT pot_id::text AS pot_id
      FROM placement_segments
      WHERE placement_cycle_id = ${cycleId}::uuid
    `;
    assert.equal((segmentAfterRestore as { pot_id: string | null }[])[0]?.pot_id, null);
    const orderAfterRestore = await sql`
      SELECT pot_name FROM order_items WHERE order_id = ${orderId}::uuid
    `;
    assert.equal((orderAfterRestore as { pot_name: string }[])[0]?.pot_name, "Snapshot Pot");

    assert.equal((orderAfterRestore as { pot_name: string }[])[0]?.pot_name, "Snapshot Pot");
    let duplicateAfterUnlock = false;
    try {
      await updateSellableVariantPot({
        plantId,
        sellableVariantId: noPot.sellableVariantId,
        potId: potM.id,
      });
    } catch (error) {
      duplicateAfterUnlock = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "duplicate");
      assert.equal(error.message, SELLABLE_VARIANT_DUPLICATE_MESSAGE);
    }
    assert.equal(duplicateAfterUnlock, true);
    await sql`DELETE FROM placement_segments WHERE placement_cycle_id = ${cycleId}::uuid`;
    await sql`DELETE FROM placement_cycles WHERE id = ${cycleId}::uuid`;
    cycleId = "";
    await sql`DELETE FROM pos_spots WHERE id = ${spotId}::uuid`;
    spotId = "";
    await sql`DELETE FROM order_items WHERE order_id = ${orderId}::uuid`;
    await sql`DELETE FROM orders WHERE order_id = ${orderId}::uuid`;
    orderId = "";
    await sql`DELETE FROM partner_locations WHERE id = ${partnerLocationId}`;
    await sql`DELETE FROM partners WHERE id = ${partnerLocationId}`;
    partnerLocationId = "";
    await sql`DELETE FROM offers WHERE id = ${offerId}`;
    offerId = "";

    const inactivePot = await createPot({ name: `${tag} inactive` });
    inactivePotId = inactivePot.id;
    await sql`UPDATE pots SET active = false WHERE id = ${inactivePotId}::uuid`;
    await updatePot({ potId: inactivePotId, supplierPrice: 3 });
    let inactiveRejected = false;
    try {
      await updateSellableVariantPot({
        plantId,
        sellableVariantId: noPot.sellableVariantId,
        potId: inactivePotId,
      });
    } catch (error) {
      inactiveRejected = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "inactive_pot");
      assert.equal(error.message, SELLABLE_VARIANT_INACTIVE_POT_MESSAGE);
    }
    assert.equal(inactiveRejected, true);
    const afterInactive = await sql`
      SELECT pot_id
      FROM sellable_variants
      WHERE id = ${noPot.sellableVariantId}::uuid
    `;
    assert.equal((afterInactive as { pot_id: string | null }[])[0]?.pot_id, null);
    await deletePot(inactivePotId);
    inactivePotId = "";
    await deletePot(potL.id);
    potLId = "";

    const variantTable = await sql`SELECT to_regclass('public.pot_variants') AS name`;
    assert.equal((variantTable as { name: string | null }[])[0]?.name, null);

    const smallOnly = await createSellableVariant({
      plantId,
      plantSizeId: small.id,
      potId: null,
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
      assert.equal(error.message, "Cannot delete this size: used by a Sellable Variant");
    }
    assert.equal(blockedPlantSize, true);

    let blockedPot = false;
    try {
      await deletePot(potM.id);
    } catch (error) {
      blockedPot = true;
      assert.ok(error instanceof PotWriteError);
      assert.match(error.message, /^This pot cannot be deleted because it is used by/);
    }
    assert.equal(blockedPot, true);

    await deleteSellableVariant({ plantId, sellableVariantId: noPot.sellableVariantId });
    await deleteSellableVariant({ plantId, sellableVariantId: withPot.sellableVariantId });
    await deleteSellableVariant({ plantId, sellableVariantId: cross.sellableVariantId });
    await deletePlantVariant({ plantId, variantId: medium.id });
    await sql`DELETE FROM plant_variants WHERE id = ${legacyId}::uuid`;
    await deletePot(potM.id);
    potId = "";
    await deletePot(potS.id);
    potSId = "";

    console.log("verify-sellable-variants: ok");
  } finally {
    if (cycleId) {
      await sql`DELETE FROM placement_segments WHERE placement_cycle_id = ${cycleId}::uuid`;
      await sql`DELETE FROM placement_cycles WHERE id = ${cycleId}::uuid`;
    }
    if (spotId) await sql`DELETE FROM pos_spots WHERE id = ${spotId}::uuid`;
    if (orderId) {
      await sql`DELETE FROM order_items WHERE order_id = ${orderId}::uuid`;
      await sql`DELETE FROM orders WHERE order_id = ${orderId}::uuid`;
    }
    if (partnerLocationId) {
      await sql`DELETE FROM partner_locations WHERE id = ${partnerLocationId}`;
      await sql`DELETE FROM partners WHERE id = ${partnerLocationId}`;
    }
    if (offerId) await sql`DELETE FROM offers WHERE id = ${offerId}`;
    if (plantId) {
      await sql`DELETE FROM offers WHERE product_id = ${plantId}`;
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
    if (potSId) await deletePot(potSId).catch(() => undefined);
    if (potLId) await deletePot(potLId).catch(() => undefined);
    if (inactivePotId) await deletePot(inactivePotId).catch(() => undefined);
    if (zeroPotId) await deletePot(zeroPotId).catch(() => undefined);
    if (besidePotId) await deletePot(besidePotId).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

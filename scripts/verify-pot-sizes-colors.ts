/**
 * Catalog Pot SKU and central pot inventory.
 * One pot is the physical SKU. Quantity lives on pot_inventory.
 * Size and color tables are gone.
 *
 * Run: npx tsx scripts/verify-pot-sizes-colors.ts
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
  const migration = read("db/migrations/056_catalog_pot_sku.sql");
  assert.match(migration, /DROP TABLE IF EXISTS pot_colors/);
  assert.match(migration, /DROP TABLE IF EXISTS pot_sizes/);
  assert.match(migration, /pots_supplier_price_non_negative/);
  assert.match(migration, /supplier_price IS NULL OR supplier_price >= 0/);
  assert.match(migration, /UNIQUE NULLS NOT DISTINCT \(plant_variant_id, pot_id\)/);
  assert.match(migration, /REFERENCES pots \(id\) ON DELETE CASCADE/);
  assert.match(migration, /pot_inventory_history_delta_nonzero/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION assert_pot_central_quantity_available/);
  assert.match(migration, /This pot is out of stock/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS pot_sizes/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS pot_colors/);
  assert.doesNotMatch(migration, /INSERT INTO pot_colors/);

  const shop = read("lib/catalogShop.ts");
  assert.match(shop, /FROM pots/);
  assert.match(shop, /pot_inventory/);
  assert.doesNotMatch(shop, /pot_colors/);
  assert.doesNotMatch(shop, /pot_sizes/);
  const holds = read("lib/catalogStockHolds.ts");
  assert.match(holds, /FROM pots/);
  assert.match(holds, /pot_inventory/);
  assert.doesNotMatch(holds, /pot_colors/);
  assert.doesNotMatch(read("lib/catalogCart.ts"), /potVariantId|potColorId/);

  const admin = read("components/admin/AdminPotsManager.tsx");
  assert.match(admin, /admin\.pots\.supplierCost/);
  assert.match(admin, /admin\.pots\.quantity/);
  assert.match(admin, /PlantImagePicker/);
  assert.match(admin, /single/);
  assert.match(admin, /image: image\.trim\(\) \|\| null/);
  assert.match(admin, /image: editImage\.trim\(\) \|\| null/);
  assert.match(admin, /src=\{pot\.image\}/);
  assert.match(admin, /admin\.pots\.photoRequired/);
  assert.match(admin, /urls\[urls\.length - 1\]/);
  assert.doesNotMatch(admin, /addSize|addColor|potColorInventory|catalogPrice|potVariants/);
  assert.match(read("db/migrations/041_pots.sql"), /image\s+text/);
  assert.match(read("lib/potStorage.ts"), /p\.image/);
  assert.doesNotMatch(migration, /DROP COLUMN[^;]*image/);
  assert.match(read("app/api/pots/route.ts"), /readPots\(\)/);
  assert.equal(existsSync(join(root, "lib/potSizeStorage.ts")), false);
  assert.equal(existsSync(join(root, "lib/potSizes.ts")), false);
  const routeHelpers = read("lib/routes.ts");
  assert.doesNotMatch(routeHelpers, /potSizes:|potSize:|potColors:|potColor:|potColorInventory:/);
  const messages = read("lib/messages.ts");
  assert.doesNotMatch(messages, /admin\.pots\.addSize|admin\.pots\.addColor|admin\.pots\.noSizes|shop\.potColors/);
  assert.doesNotMatch(messages, /admin\.partners\.detail\.potColor/);

  for (const rel of ["app/api/pots/route.ts", "app/api/pots/[potId]/route.ts"]) {
    assert.match(read(rel), /isAdminRequest/, rel);
  }

  console.log("verify-pot-sizes-colors: wiring uses Catalog Pots, not size or color tables");
}

async function main(): Promise<void> {
  assertWiring();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!host.startsWith("ep-snowy-credit-alavcarh")) {
    throw new Error("Refusing to verify against a database that is not the dev branch");
  }

  const { sql } = await import("../lib/db");
  const { parsePlantBody } = await import("../lib/plantValidation");
  const { createPlant, deletePlant } = await import("../lib/plantStorage");
  const { createPlantVariant } = await import("../lib/plantVariantStorage");
  const { applyInventoryDelta, getInventoryQuantity } = await import("../lib/inventoryStorage");
  const { createPot, deletePot, PotWriteError, readPots, updatePot } = await import("../lib/potStorage");
  const {
    POT_ADMIN_QUANTITY_NOTE,
    POT_OUT_OF_STOCK_MESSAGE,
    PotInventoryChangeError,
    applyPotInventoryDelta,
    getPotInventoryQuantity,
    readPotInventoryHistory,
    setPotCentralQuantity,
  } = await import("../lib/potInventoryStorage");
  const { createSellableVariant } = await import("../lib/sellableVariantStorage");
  const { createOrReusePlantOffer } = await import("../lib/offerStorage");
  const { resolveOccupancyForPosCreate } = await import("../lib/posOccupancy");
  const { writePosCreate } = await import("../lib/posCentralStock");
  const { insertOrderItems } = await import("../lib/orderItemStorage");
  const { POT_UNIT_COST_SOURCE } = await import("../lib/catalogCheckoutSnapshot");

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('pot_sizes', 'pot_colors', 'pot_inventory', 'pot_inventory_history', 'pots')
  `;
  const tableNames = new Set((tables as { table_name: string }[]).map((row) => row.table_name));
  assert.equal(tableNames.has("pot_sizes"), false);
  assert.equal(tableNames.has("pot_colors"), false);
  assert.equal(tableNames.has("pots"), true);
  assert.equal(tableNames.has("pot_inventory"), true);
  assert.equal(tableNames.has("pot_inventory_history"), true);

  const columns = await sql`
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('pots', 'pot_inventory', 'pot_inventory_history')
  `;
  const present = new Set(
    (columns as { table_name: string; column_name: string }[]).map(
      (row) => `${row.table_name}.${row.column_name}`,
    ),
  );
  for (const column of [
    "pots.supplier_price",
    "pots.image",
    "pot_inventory.pot_id",
    "pot_inventory.quantity",
    "pot_inventory_history.pot_id",
    "pot_inventory_history.delta",
    "pot_inventory_history.note",
  ]) {
    assert.equal(present.has(column), true, column);
  }
  assert.equal(present.has("pot_inventory.pot_color_id"), false);
  assert.equal(present.has("pot_inventory_history.pot_color_id"), false);
  const supplierNullable = (
    columns as { table_name: string; column_name: string; is_nullable: string }[]
  ).find((row) => row.table_name === "pots" && row.column_name === "supplier_price");
  assert.equal(supplierNullable?.is_nullable, "YES");

  const { GET } = await import("../app/api/pots/route");
  async function adminPotPayload(): Promise<{ id: string; image?: string }[]> {
    const response = await GET({
      cookies: {
        get: (name: string) => (name === "admin_auth" ? { value: "1" } : undefined),
      },
    } as never);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { pots?: { id: string; image?: string }[] };
    return body.pots ?? [];
  }

  const storedImages = await sql`
    SELECT id::text AS id, image
    FROM pots
    WHERE image IS NOT NULL
    ORDER BY id
  `;
  const storedRows = storedImages as { id: string; image: string }[];
  assert.ok(storedRows.length > 0);
  const listed = await readPots();
  const initialPayload = await adminPotPayload();
  for (const stored of storedRows) {
    assert.equal(listed.find((row) => row.id === stored.id)?.image, stored.image, stored.id);
    assert.equal(
      initialPayload.find((row) => row.id === stored.id)?.image,
      stored.image,
      stored.id,
    );
  }

  const tag = `catalog-pot-${Date.now()}`;
  const potIds: string[] = [];
  const plantIds: string[] = [];
  const variantIds: string[] = [];
  const sellableIds: string[] = [];
  const offerIds: string[] = [];
  const orderIds: string[] = [];
  const spotIds: string[] = [];

  async function cleanup(): Promise<void> {
    if (spotIds.length > 0) {
      await sql`
        DELETE FROM placement_segments
        WHERE placement_cycle_id IN (
          SELECT id FROM placement_cycles WHERE pos_spot_id = ANY(${spotIds}::uuid[])
        )
      `;
      await sql`DELETE FROM placement_cycles WHERE pos_spot_id = ANY(${spotIds}::uuid[])`;
      await sql`DELETE FROM pos_spots WHERE id = ANY(${spotIds}::uuid[])`;
    }
    if (orderIds.length > 0) {
      await sql`DELETE FROM order_items WHERE order_id = ANY(${orderIds}::uuid[])`;
      await sql`DELETE FROM orders WHERE order_id = ANY(${orderIds}::uuid[])`;
    }
    if (offerIds.length > 0) {
      await sql`DELETE FROM offer_availabilities WHERE offer_id = ANY(${offerIds})`;
      await sql`DELETE FROM offers WHERE id = ANY(${offerIds})`;
    }
    if (sellableIds.length > 0) {
      await sql`DELETE FROM sellable_variants WHERE id = ANY(${sellableIds}::uuid[])`;
    }
    if (variantIds.length > 0) {
      await sql`DELETE FROM inventory_history WHERE variant_id = ANY(${variantIds}::uuid[])`;
      await sql`DELETE FROM inventory WHERE variant_id = ANY(${variantIds}::uuid[])`;
      await sql`DELETE FROM plant_variants WHERE id = ANY(${variantIds}::uuid[])`;
    }
    for (const plantId of plantIds) {
      await deletePlant(plantId).catch(() => undefined);
    }
    for (const potId of potIds) {
      await sql`DELETE FROM pot_inventory_history WHERE pot_id = ${potId}::uuid`;
      await sql`DELETE FROM pot_inventory WHERE pot_id = ${potId}::uuid`;
      await sql`DELETE FROM pots WHERE id = ${potId}::uuid`;
    }
  }

  try {
    const behavior = await createPot({ name: `${tag} behavior`, nameHe: "התנהגות" });
    potIds.push(behavior.id);
    assert.equal(behavior.supplierPrice, null);
    assert.equal(behavior.quantity, 0);
    assert.equal(behavior.image, undefined);
    const uploaded = await updatePot({
      potId: behavior.id,
      image: "/plant-library/pot-photo-a.jpg",
      supplierPrice: 0,
    });
    assert.equal(uploaded.image, "/plant-library/pot-photo-a.jpg");
    assert.equal(uploaded.supplierPrice, 0);
    assert.equal(
      (await readPots()).find((row) => row.id === behavior.id)?.image,
      "/plant-library/pot-photo-a.jpg",
    );
    assert.equal(
      (await adminPotPayload()).find((row) => row.id === behavior.id)?.image,
      "/plant-library/pot-photo-a.jpg",
    );
    const priced = await updatePot({ potId: behavior.id, supplierPrice: 12.5 });
    assert.equal(priced.supplierPrice, 12.5);
    assert.equal(priced.image, "/plant-library/pot-photo-a.jpg");
    const cleared = await updatePot({ potId: behavior.id, supplierPrice: null });
    assert.equal(cleared.supplierPrice, null);
    assert.equal(cleared.image, "/plant-library/pot-photo-a.jpg");
    let negativeCost = false;
    try {
      await updatePot({ potId: behavior.id, supplierPrice: -1 });
    } catch (error) {
      negativeCost = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "invalid_supplier_price");
    }
    assert.equal(negativeCost, true);
    const restored = await updatePot({ potId: behavior.id, supplierPrice: 12.5 });
    assert.equal(restored.supplierPrice, 12.5);
    assert.equal(restored.image, "/plant-library/pot-photo-a.jpg");

    assert.equal(await getPotInventoryQuantity(behavior.id), 0);
    assert.equal((await readPotInventoryHistory(behavior.id)).length, 0);
    assert.equal(await setPotCentralQuantity({ potId: behavior.id, quantity: 0 }), 0);
    assert.equal((await readPotInventoryHistory(behavior.id)).length, 0);
    const missingRow = await sql`
      SELECT count(*)::int AS count FROM pot_inventory WHERE pot_id = ${behavior.id}::uuid
    `;
    assert.equal((missingRow as { count: number }[])[0]?.count, 0);

    assert.equal(
      await setPotCentralQuantity({ potId: behavior.id, quantity: 2 }),
      2,
    );
    const adminHistory = await readPotInventoryHistory(behavior.id);
    assert.deepEqual(
      adminHistory.map((entry) => ({ delta: entry.delta, note: entry.note })),
      [{ delta: 2, note: POT_ADMIN_QUANTITY_NOTE }],
    );
    assert.equal(await setPotCentralQuantity({ potId: behavior.id, quantity: 2 }), 2);
    assert.equal((await readPotInventoryHistory(behavior.id)).length, 1);

    let zeroDelta = false;
    try {
      await applyPotInventoryDelta({ potId: behavior.id, delta: 0, note: `${tag} zero` });
    } catch (error) {
      zeroDelta = true;
      assert.ok(error instanceof PotInventoryChangeError);
      assert.equal(error.code, "delta_zero");
    }
    assert.equal(zeroDelta, true);

    await applyPotInventoryDelta({ potId: behavior.id, delta: -2, note: `${tag} send` });
    assert.equal(await getPotInventoryQuantity(behavior.id), 0);
    let negative = false;
    try {
      await applyPotInventoryDelta({ potId: behavior.id, delta: -1, note: `${tag} too far` });
    } catch (error) {
      negative = true;
      assert.ok(error instanceof PotInventoryChangeError);
      assert.equal(error.code, "insufficient_quantity");
    }
    assert.equal(negative, true);
    assert.equal(await getPotInventoryQuantity(behavior.id), 0);

    const stockOnly = await createPot({ name: `${tag} stock only` });
    potIds.push(stockOnly.id);
    await setPotCentralQuantity({ potId: stockOnly.id, quantity: 4 });
    await deletePot(stockOnly.id);
    potIds.splice(potIds.indexOf(stockOnly.id), 1);
    const stockGone = await sql`SELECT id FROM pots WHERE id = ${stockOnly.id}::uuid`;
    assert.equal((stockGone as { id: string }[]).length, 0);

    const locations = await sql`SELECT id FROM partner_locations ORDER BY id ASC LIMIT 1`;
    const partnerLocationId = (locations as { id: string }[])[0]?.id;
    assert.ok(partnerLocationId, "need a partner location");

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
    const plant = await createPlant(parsed.plant);
    plantIds.push(plant.id);
    const size = await createPlantVariant({ plantId: plant.id, sizeLabel: "S" });
    variantIds.push(size.id);
    await applyInventoryDelta({ variantId: size.id, delta: 3, note: `${tag} plant` });

    const placedPot = await createPot({ name: `${tag} placed` });
    potIds.push(placedPot.id);
    await updatePot({ potId: placedPot.id, supplierPrice: 4 });
    const sellable = await createSellableVariant({
      plantId: plant.id,
      plantSizeId: size.id,
      potId: placedPot.id,
    });
    sellableIds.push(sellable.sellableVariantId);

    const orderPot = await createPot({ name: `${tag} ordered` });
    potIds.push(orderPot.id);
    const orderId = randomUUID();
    orderIds.push(orderId);
    const now = new Date().toISOString();
    await sql`
      INSERT INTO orders (
        order_id, product_id, product_name, price, full_name, phone,
        address, apartment_or_notes, fulfillment_method, order_status, created_at,
        channel, partner_id, source
      )
      VALUES (
        ${orderId}::uuid, ${plant.id}, ${tag}, 40, 'Pot Verify',
        '0500000000', 'Verify 1', '', 'delivery', 'sold', ${now}::timestamptz,
        'catalog', NULL, 'online'
      )
    `;
    await insertOrderItems(orderId, [
      {
        lineNo: 1,
        plantId: plant.id,
        plantVariantId: size.id,
        sellableVariantId: sellable.sellableVariantId,
        offerId: `${tag}-order-offer`,
        potId: orderPot.id,
        potSizeId: null,
        potColorId: null,
        quantity: 1,
        unitPrice: 40,
        lineTotal: 40,
        currency: "ILS",
        plantName: tag,
        plantNameHe: null,
        sizeLabel: "S",
        potName: orderPot.name,
        potSizeLabel: null,
        potColor: null,
        potColorHe: null,
        plantUnitCost: 40,
        plantUnitCostSource: "plants.supplier_price@sale",
        potUnitCost: null,
        potUnitCostSource: null,
      },
    ]);
    await deletePot(orderPot.id);
    potIds.splice(potIds.indexOf(orderPot.id), 1);
    const orderLine = await sql`
      SELECT pot_id::text AS pot_id, pot_size_id, pot_color_id
      FROM order_items
      WHERE order_id = ${orderId}::uuid
    `;
    assert.equal((orderLine as { pot_id: string }[])[0]?.pot_id, orderPot.id);
    assert.equal((orderLine as { pot_size_id: string | null }[])[0]?.pot_size_id, null);
    assert.equal((orderLine as { pot_color_id: string | null }[])[0]?.pot_color_id, null);

    let blocked = false;
    try {
      await deletePot(placedPot.id);
    } catch (error) {
      blocked = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "in_use");
      assert.match(error.message, /^This pot cannot be deleted because it is used by/);
    }
    assert.equal(blocked, true);
    const potRemains = await sql`SELECT id FROM pots WHERE id = ${placedPot.id}::uuid`;
    assert.equal((potRemains as { id: string }[]).length, 1);

    const offer = await createOrReusePlantOffer({
      sellableVariantId: sellable.sellableVariantId,
      consumerPrice: 48,
      status: "active",
      availabilities: [{ scope: "partner_location", partnerLocationId }],
    });
    offerIds.push(offer.offer.id);
    await setPotCentralQuantity({ potId: placedPot.id, quantity: 0 });
    const plantBefore = await getInventoryQuantity(size.id);
    const plantHistoryBefore = await sql`
      SELECT count(*)::int AS n FROM inventory_history WHERE variant_id = ${size.id}::uuid
    `;
    const slug = `pot-oos-${tag}`.slice(0, 48);
    const occupancy = await resolveOccupancyForPosCreate({
      offerId: offer.offer.id,
      partnerLocationId,
    });
    assert.equal(occupancy.potId, placedPot.id);
    let outOfStock = false;
    try {
      const created = await writePosCreate({
        occupancyAction: occupancy.action,
        inventorySource: "central",
        posSpot: {
          id: randomUUID(),
          spotName: slug,
          partnerLocationId,
          posNumber: "1",
          posName: slug,
          spotSlug: slug,
          status: "available",
          checkStatus: false,
          createdAt: new Date().toISOString(),
          currentOfferId: occupancy.currentOfferId ?? offer.offer.id,
          plantVariantId: occupancy.plantVariantId ?? size.id,
          potId: occupancy.potId ?? placedPot.id,
          offerPlacedAt: occupancy.offerPlacedAt ?? new Date().toISOString(),
        },
        variantId: occupancy.plantVariantId,
        potId: occupancy.potId,
      });
      spotIds.push(created.id);
    } catch (error) {
      outOfStock = true;
      assert.ok(error instanceof PotInventoryChangeError);
      assert.equal(error.message, POT_OUT_OF_STOCK_MESSAGE);
    }
    assert.equal(outOfStock, true);
    assert.equal(await getInventoryQuantity(size.id), plantBefore);
    const plantHistoryAfter = await sql`
      SELECT count(*)::int AS n FROM inventory_history WHERE variant_id = ${size.id}::uuid
    `;
    assert.equal(
      (plantHistoryAfter as { n: number }[])[0]?.n,
      (plantHistoryBefore as { n: number }[])[0]?.n,
    );
    const writtenSpot = await sql`SELECT id FROM pos_spots WHERE spot_slug = ${slug}`;
    assert.equal((writtenSpot as { id: string }[]).length, 0);
    assert.equal(await getPotInventoryQuantity(placedPot.id), 0);
    assert.equal(POT_UNIT_COST_SOURCE, "pots.supplier_price@sale");
  } finally {
    await cleanup();
  }

  console.log("verify-pot-sizes-colors: ok");
}

main().catch((error) => {
  console.error("verify-pot-sizes-colors FAILED", error);
  process.exit(1);
});

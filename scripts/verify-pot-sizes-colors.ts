/**
 * Pot Size, Pot Color, and central pot inventory.
 * Legacy pot_variants stay the Catalog path.
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

function splitSql(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^(BEGIN|COMMIT)$/i.test(statement));
}

function assertWiring(): void {
  const migration = read("db/migrations/046_pot_sizes_colors.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pot_sizes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pot_colors/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pot_inventory/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pot_inventory_history/);
  assert.match(migration, /size_label IN \('S', 'M', 'L'\)/);
  assert.match(migration, /supplier_price IS NULL OR supplier_price > 0/);
  assert.match(migration, /NULL::numeric\(10, 2\)/);
  assert.match(migration, /INSERT INTO pot_colors \(id/);
  assert.match(migration, /pv\.id/);
  assert.match(migration, /lower\(btrim\(pv\.color\)\)/);
  assert.match(migration, /pot_colors_size_color_folded_key/);
  assert.equal(existsSync(join(root, "app/api/pots/[potId]/variants/route.ts")), false);
  assert.doesNotMatch(migration, /catalog_price/);
  assert.doesNotMatch(migration, /DROP TABLE/);
  assert.doesNotMatch(migration, /sellable_variant/);
  assert.doesNotMatch(migration, /offer_availabilities/);

  const shop = read("lib/catalogShop.ts");
  assert.match(shop, /pot_variants/);
  assert.doesNotMatch(shop, /pot_colors/);
  assert.doesNotMatch(shop, /pot_inventory/);
  for (const rel of [
    "lib/catalogCart.ts",
    "lib/catalogCheckoutFlow.ts",
    "lib/catalogStockHolds.ts",
    "lib/offerStorage.ts",
    "lib/posSpotStorage.ts",
    "lib/plantVariantStorage.ts",
    "lib/inventoryStorage.ts",
  ]) {
    const source = read(rel);
    assert.doesNotMatch(source, /pot_colors/, rel);
    assert.doesNotMatch(source, /pot_inventory/, rel);
  }

  const admin = read("components/admin/AdminPotsManager.tsx");
  assert.match(admin, /admin\.pots\.supplierCost/);
  assert.match(admin, /admin\.pots\.addSize/);
  assert.match(admin, /admin\.pots\.addColor/);
  assert.match(admin, /potColorInventory/);
  assert.doesNotMatch(admin, /catalogPrice/);
  assert.doesNotMatch(admin, /potVariants/);
  assert.doesNotMatch(admin, /addVariant/);

  for (const rel of [
    "app/api/pots/route.ts",
    "app/api/pots/[potId]/route.ts",
    "app/api/pots/[potId]/sizes/route.ts",
    "app/api/pots/[potId]/sizes/[sizeId]/route.ts",
    "app/api/pots/[potId]/sizes/[sizeId]/colors/route.ts",
    "app/api/pots/[potId]/sizes/[sizeId]/colors/[colorId]/route.ts",
    "app/api/pots/[potId]/sizes/[sizeId]/colors/[colorId]/inventory/route.ts",
  ]) {
    assert.match(read(rel), /isAdminRequest/, rel);
  }

  console.log("verify-pot-sizes-colors: wiring leaves Catalog, cart, checkout, and POS unchanged");
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
  const { createPot, deletePot, PotWriteError } = await import("../lib/potStorage");
  const {
    createPotColor,
    createPotSize,
    deletePotColor,
    deletePotSize,
    readPotsWithSizes,
    updatePotColor,
    updatePotSize,
  } = await import("../lib/potSizeStorage");
  const {
    applyPotInventoryDelta,
    getPotInventoryQuantity,
    PotInventoryChangeError,
    readPotInventoryHistory,
  } = await import("../lib/potInventoryStorage");

  const columns = await sql`
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('pot_sizes', 'pot_colors', 'pot_inventory', 'pot_inventory_history', 'pot_variants')
    ORDER BY table_name, column_name
  `;
  const present = new Set(
    (columns as { table_name: string; column_name: string }[]).map(
      (row) => `${row.table_name}.${row.column_name}`,
    ),
  );
  for (const column of [
    "pot_sizes.id",
    "pot_sizes.pot_id",
    "pot_sizes.size_label",
    "pot_sizes.supplier_price",
    "pot_sizes.created_at",
    "pot_sizes.updated_at",
    "pot_colors.id",
    "pot_colors.pot_size_id",
    "pot_colors.color",
    "pot_colors.color_he",
    "pot_colors.created_at",
    "pot_inventory.pot_color_id",
    "pot_inventory.quantity",
    "pot_inventory_history.delta",
    "pot_inventory_history.note",
    "pot_variants.catalog_price",
    "pot_variants.id",
  ]) {
    assert.equal(present.has(column), true, column);
  }
  assert.equal(present.has("pot_sizes.catalog_price"), false);
  assert.equal(present.has("pot_colors.catalog_price"), false);
  assert.equal(present.has("pot_colors.supplier_price"), false);
  const supplierNullable = (columns as { table_name: string; column_name: string; is_nullable: string }[]).find(
    (row) => row.table_name === "pot_sizes" && row.column_name === "supplier_price",
  );
  assert.equal(supplierNullable?.is_nullable, "YES");

  const tag = `pot-size-${Date.now()}`;
  const legacyPotId = randomUUID();
  const brownM = randomUUID();
  const blackM = randomUUID();
  const brownL = randomUUID();
  let behaviorPotId = "";

  async function cleanup(): Promise<void> {
    const ids = [legacyPotId, behaviorPotId].filter(Boolean);
    if (ids.length === 0) return;
    await sql`
      DELETE FROM pot_inventory_history
      WHERE pot_color_id IN (
        SELECT c.id
        FROM pot_colors c
        INNER JOIN pot_sizes s ON s.id = c.pot_size_id
        WHERE s.pot_id = ANY(${ids}::uuid[])
      )
    `;
    await sql`
      DELETE FROM pot_inventory
      WHERE pot_color_id IN (
        SELECT c.id
        FROM pot_colors c
        INNER JOIN pot_sizes s ON s.id = c.pot_size_id
        WHERE s.pot_id = ANY(${ids}::uuid[])
      )
    `;
    await sql`DELETE FROM pots WHERE id = ANY(${ids}::uuid[])`;
  }

  try {
    await sql`
      INSERT INTO pots (id, name, name_he)
      VALUES (${legacyPotId}::uuid, ${`${tag} legacy`}, 'מורשת')
    `;
    await sql`
      INSERT INTO pot_variants (id, pot_id, size_label, color, color_he, catalog_price)
      VALUES
        (${brownM}::uuid, ${legacyPotId}::uuid, 'M', 'Brown', 'חום', 55),
        (${blackM}::uuid, ${legacyPotId}::uuid, 'M', 'Black', NULL, 60),
        (${brownL}::uuid, ${legacyPotId}::uuid, 'L', 'Brown', 'חום', 70)
    `;
    const inserts = splitSql(read("db/migrations/046_pot_sizes_colors.sql")).filter((statement) =>
      /^INSERT INTO pot_(sizes|colors)/i.test(statement),
    );
    assert.equal(inserts.length, 2);
    for (const statement of inserts) {
      await sql.query(statement, []);
    }

    const sizes = await sql`
      SELECT id, size_label, supplier_price
      FROM pot_sizes
      WHERE pot_id = ${legacyPotId}::uuid
      ORDER BY size_label
    `;
    assert.deepEqual(
      (sizes as { size_label: string; supplier_price: string | null }[]).map((row) => ({
        size: row.size_label,
        cost: row.supplier_price,
      })),
      [
        { size: "L", cost: null },
        { size: "M", cost: null },
      ],
    );
    const colors = await sql`
      SELECT c.id, s.size_label, c.color
      FROM pot_colors c
      INNER JOIN pot_sizes s ON s.id = c.pot_size_id
      WHERE s.pot_id = ${legacyPotId}::uuid
      ORDER BY s.size_label, c.color
    `;
    assert.deepEqual(colors, [
      { id: brownL, size_label: "L", color: "Brown" },
      { id: blackM, size_label: "M", color: "Black" },
      { id: brownM, size_label: "M", color: "Brown" },
    ]);
    assert.notEqual(brownM, brownL);
    const legacyPrices = await sql`
      SELECT id, catalog_price::float AS catalog_price
      FROM pot_variants
      WHERE pot_id = ${legacyPotId}::uuid
      ORDER BY catalog_price
    `;
    assert.deepEqual(
      (legacyPrices as { catalog_price: number }[]).map((row) => row.catalog_price),
      [55, 60, 70],
    );
    const seededInventory = await sql`
      SELECT count(*)::int AS count
      FROM pot_inventory i
      INNER JOIN pot_colors c ON c.id = i.pot_color_id
      INNER JOIN pot_sizes s ON s.id = c.pot_size_id
      WHERE s.pot_id = ${legacyPotId}::uuid
    `;
    assert.equal((seededInventory as { count: number }[])[0]?.count, 0);
    assert.equal(await getPotInventoryQuantity(brownM), 0);
    for (const statement of inserts) {
      await sql.query(statement, []);
    }
    const replayed = await sql`
      SELECT count(*)::int AS count
      FROM pot_colors c
      INNER JOIN pot_sizes s ON s.id = c.pot_size_id
      WHERE s.pot_id = ${legacyPotId}::uuid
    `;
    assert.equal((replayed as { count: number }[])[0]?.count, 3);

    const behavior = await createPot({ name: `${tag} behavior`, nameHe: "התנהגות" });
    behaviorPotId = behavior.id;
    let invalidSize = false;
    try {
      await createPotSize({ potId: behavior.id, sizeLabel: "XL", supplierPrice: 10 });
    } catch (error) {
      invalidSize = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "invalid_size_label");
    }
    assert.equal(invalidSize, true);
    let invalidCost = false;
    try {
      await createPotSize({ potId: behavior.id, sizeLabel: "S", supplierPrice: 0 });
    } catch (error) {
      invalidCost = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "invalid_supplier_price");
    }
    assert.equal(invalidCost, true);

    const small = await createPotSize({ potId: behavior.id, sizeLabel: "S", supplierPrice: 12.5 });
    assert.equal(small.supplierPrice, 12.5);
    const medium = await createPotSize({ potId: behavior.id, sizeLabel: "M" });
    assert.equal(medium.supplierPrice, null);
    const cleared = await updatePotSize({
      potId: behavior.id,
      sizeId: small.id,
      supplierPrice: null,
    });
    assert.equal(cleared.supplierPrice, null);
    const restored = await updatePotSize({
      potId: behavior.id,
      sizeId: small.id,
      supplierPrice: 12.5,
    });
    assert.equal(restored.supplierPrice, 12.5);
    let duplicateSize = false;
    try {
      await createPotSize({ potId: behavior.id, sizeLabel: "S", supplierPrice: 4 });
    } catch (error) {
      duplicateSize = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "duplicate");
    }
    assert.equal(duplicateSize, true);
    let badPotId = false;
    try {
      await updatePotSize({ potId: "not-a-uuid", sizeId: small.id, supplierPrice: 3 });
    } catch (error) {
      badPotId = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(badPotId, true);

    const white = await createPotColor({
      potId: behavior.id,
      sizeId: small.id,
      color: "White",
      colorHe: "לבן",
    });
    const black = await createPotColor({
      potId: behavior.id,
      sizeId: small.id,
      color: "Black",
    });
    assert.equal(white.quantity, 0);
    assert.equal(black.quantity, 0);
    assert.equal(await getPotInventoryQuantity(white.id), 0);
    const mediumWhite = await createPotColor({
      potId: behavior.id,
      sizeId: medium.id,
      color: "White",
      colorHe: "לבן",
    });
    assert.notEqual(white.id, mediumWhite.id);

    const variantRows = await sql`
      SELECT count(*)::int AS count
      FROM pot_variants
      WHERE pot_id = ${behavior.id}::uuid
    `;
    assert.equal((variantRows as { count: number }[])[0]?.count, 0);

    let foldedDuplicate = false;
    try {
      await createPotColor({ potId: behavior.id, sizeId: small.id, color: " WHITE " });
    } catch (error) {
      foldedDuplicate = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "duplicate");
    }
    assert.equal(foldedDuplicate, true);
    let wrongSize = false;
    try {
      await updatePotColor({
        potId: behavior.id,
        sizeId: medium.id,
        colorId: white.id,
        colorHe: "לא",
      });
    } catch (error) {
      wrongSize = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "not_found");
    }
    assert.equal(wrongSize, true);
    const grey = await createPotColor({
      potId: behavior.id,
      sizeId: small.id,
      color: "Grey",
    });
    let missingNegative = false;
    try {
      await applyPotInventoryDelta({
        potId: behavior.id,
        sizeId: small.id,
        potColorId: grey.id,
        delta: -1,
        note: `${tag} empty`,
      });
    } catch (error) {
      missingNegative = true;
      assert.ok(error instanceof PotInventoryChangeError);
      assert.equal(error.code, "insufficient_quantity");
    }
    assert.equal(missingNegative, true);
    assert.equal(await getPotInventoryQuantity(grey.id), 0);
    assert.equal((await readPotInventoryHistory(grey.id)).length, 0);
    const greyStored = await sql`
      SELECT count(*)::int AS count
      FROM pot_inventory
      WHERE pot_color_id = ${grey.id}::uuid
    `;
    assert.equal((greyStored as { count: number }[])[0]?.count, 0);
    await deletePotColor({ potId: behavior.id, sizeId: small.id, colorId: grey.id });
    let zeroDelta = false;
    try {
      await applyPotInventoryDelta({
        potId: behavior.id,
        sizeId: small.id,
        potColorId: white.id,
        delta: 0,
        note: `${tag} zero`,
      });
    } catch (error) {
      zeroDelta = true;
      assert.ok(error instanceof PotInventoryChangeError);
      assert.equal(error.code, "delta_zero");
    }
    assert.equal(zeroDelta, true);
    let wrongParentAdjust = false;
    try {
      await applyPotInventoryDelta({
        potId: behavior.id,
        sizeId: medium.id,
        potColorId: white.id,
        delta: 1,
        note: `${tag} wrong size`,
      });
    } catch (error) {
      wrongParentAdjust = true;
      assert.ok(error instanceof PotInventoryChangeError);
      assert.equal(error.code, "color_not_found");
    }
    assert.equal(wrongParentAdjust, true);

    await applyPotInventoryDelta({
      potId: behavior.id,
      sizeId: small.id,
      potColorId: white.id,
      delta: 2,
      note: `${tag} receive`,
    });
    await applyPotInventoryDelta({
      potId: behavior.id,
      sizeId: small.id,
      potColorId: black.id,
      delta: 1,
      note: `${tag} receive black`,
    });
    assert.equal(await getPotInventoryQuantity(white.id), 2);
    assert.equal(await getPotInventoryQuantity(black.id), 1);
    assert.equal(await getPotInventoryQuantity(mediumWhite.id), 0);

    await applyPotInventoryDelta({
      potId: behavior.id,
      sizeId: medium.id,
      potColorId: mediumWhite.id,
      delta: 4,
      note: `${tag} medium white`,
    });
    assert.equal(await getPotInventoryQuantity(white.id), 2);
    assert.equal(await getPotInventoryQuantity(mediumWhite.id), 4);

    await applyPotInventoryDelta({
      potId: behavior.id,
      sizeId: small.id,
      potColorId: white.id,
      delta: -2,
      note: `${tag} send`,
    });
    assert.equal(await getPotInventoryQuantity(white.id), 0);
    let negative = false;
    try {
      await applyPotInventoryDelta({
        potId: behavior.id,
        sizeId: small.id,
        potColorId: white.id,
        delta: -1,
        note: `${tag} too far`,
      });
    } catch (error) {
      negative = true;
      assert.ok(error instanceof PotInventoryChangeError);
      assert.equal(error.code, "insufficient_quantity");
    }
    assert.equal(negative, true);
    assert.equal(await getPotInventoryQuantity(white.id), 0);
    assert.equal(await getPotInventoryQuantity(black.id), 1);
    const history = await readPotInventoryHistory(white.id);
    assert.deepEqual(
      history.map((entry) => entry.delta),
      [2, -2],
    );

    const renamed = await updatePotColor({
      potId: behavior.id,
      sizeId: small.id,
      colorId: black.id,
      colorHe: "שחור",
    });
    assert.equal(renamed.color, "Black");
    assert.equal(renamed.colorHe, "שחור");
    assert.equal(renamed.quantity, 1);

    let blockedColor = false;
    try {
      await deletePotColor({ potId: behavior.id, sizeId: small.id, colorId: white.id });
    } catch (error) {
      blockedColor = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "in_use");
    }
    assert.equal(blockedColor, true);
    let blockedSize = false;
    try {
      await deletePotSize({ potId: behavior.id, sizeId: small.id });
    } catch (error) {
      blockedSize = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "in_use");
    }
    assert.equal(blockedSize, true);

    const large = await createPotSize({ potId: behavior.id, sizeLabel: "L" });
    const green = await createPotColor({
      potId: behavior.id,
      sizeId: large.id,
      color: "Green",
    });
    await deletePotColor({ potId: behavior.id, sizeId: large.id, colorId: green.id });
    await deletePotSize({ potId: behavior.id, sizeId: large.id });

    const loaded = (await readPotsWithSizes()).find((pot) => pot.id === behavior.id);
    assert.ok(loaded);
    assert.deepEqual(
      loaded.sizes.map((size) => size.sizeLabel),
      ["S", "M"],
    );
    const loadedSmall = loaded.sizes.find((size) => size.id === small.id);
    assert.equal(loadedSmall?.supplierPrice, 12.5);
    assert.deepEqual(
      loadedSmall?.colors.map((row) => ({ color: row.color, quantity: row.quantity })),
      [
        { color: "Black", quantity: 1 },
        { color: "White", quantity: 0 },
      ],
    );
    assert.equal(loaded.sizes.find((size) => size.id === medium.id)?.colors[0]?.quantity, 4);

    let blockedPot = false;
    try {
      await deletePot(behavior.id);
    } catch (error) {
      blockedPot = true;
      assert.ok(error instanceof PotWriteError);
      assert.equal(error.code, "in_use");
    }
    assert.equal(blockedPot, true);
    const potRemains = await sql`SELECT id FROM pots WHERE id = ${behavior.id}::uuid`;
    assert.equal((potRemains as { id: string }[]).length, 1);

    const legacyStill = await sql`
      SELECT catalog_price::float AS catalog_price
      FROM pot_variants
      WHERE id = ${brownM}::uuid
    `;
    assert.equal((legacyStill as { catalog_price: number }[])[0]?.catalog_price, 55);
  } finally {
    await cleanup();
  }

  console.log("verify-pot-sizes-colors: ok");
}

main().catch((error) => {
  console.error("verify-pot-sizes-colors FAILED", error);
  process.exit(1);
});

/**
 * Slice 5 catalog cutover checks.
 * Creates and deletes its own rows. Refuses the production host.
 *
 * Run: npx tsx scripts/verify-catalog-offer-cutover.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertSources(): void {
  const migration = read("db/migrations/049_catalog_offer_cutover.sql");
  assert.match(migration, /catalog cutover blocked: in-flight catalog payment attempts/);
  assert.match(migration, /catalog cutover blocked: unit_price would not reproduce line_total/);
  assert.match(migration, /catalog cutover blocked: unit_price does not reproduce line_total/);
  assert.match(migration, /pot_sizes_supplier_price_non_negative/);
  assert.match(migration, /DROP COLUMN IF EXISTS plant_unit_price/);
  assert.match(migration, /DROP COLUMN IF EXISTS pot_unit_price/);
  assert.match(migration, /DROP COLUMN IF EXISTS pot_variant_id/);
  assert.doesNotMatch(migration, /ROUND\(/i);

  const shop = read("lib/catalogShop.ts");
  assert.doesNotMatch(shop, /catalog_price/);
  assert.doesNotMatch(shop, /pot_variants/);
  assert.match(shop, /consumer_price/);
  assert.match(shop, /pot\.image AS pot_image/);
  assert.doesNotMatch(shop, /!potImage\) continue/);
  const prep = read("lib/catalogPaymentPrep.ts");
  assert.doesNotMatch(prep, /parent_pot\.image/);
  assert.match(prep, /NULLIF\(btrim\(parent_pot\.name\), ''\) IS NOT NULL/);

  const cartSource = read("lib/catalogCart.ts");
  assert.doesNotMatch(cartSource, /potVariantId/);
  assert.doesNotMatch(read("app/api/shop/cart/resolve/route.ts"), /catalogLegacyCart/);
  assert.throws(() => read("lib/catalogLegacyCart.ts"));

  const events = read("lib/analyticsEvents.ts");
  assert.match(events, /sellable_variant_id\?: string/);
  assert.match(events, /pot_color_id\?: string/);
  assert.doesNotMatch(events, /plant_price/);
  assert.doesNotMatch(events, /pot_price/);
  assert.doesNotMatch(events, /pot_variant_id/);
  assert.match(events, /purchaseCompleted:\s*"purchase_completed"/);

  const purchase = read("components/analytics/TrackPurchaseCompleted.tsx");
  assert.match(purchase, /ANALYTICS_EVENTS\.purchaseCompleted/);
  assert.doesNotMatch(purchase, /plant_price|pot_price|pot_variant_id|plantUnitPrice/);

  const card = read("components/shop/ShopPlantCard.tsx");
  assert.match(card, /defaultCatalogCardSizeId/);
  assert.doesNotMatch(card, /useState\(""\)/);
  assert.doesNotMatch(card, /opacity-60/);
  assert.match(card, /resolveCardConfiguration/);
  assert.match(card, /additionalInStockColorCount/);
  assert.match(card, /w-4\/5/);
  assert.match(card, /ANALYTICS_EVENTS\.addToCart/);
  assert.match(card, /disabled=\{!canAdd\}/);
  assert.match(card, /resolved && resolvedVariant\?\.potImage/);
  assert.match(card, /src=\{resolvedVariant\.potImage\}/);
  assert.doesNotMatch(card, /backgroundColor/);
  assert.doesNotMatch(card, /plant_price|pot_price|potVariantId/);

  const detail = read("components/shop/ShopPlantDetail.tsx");
  assert.match(detail, /resolveExplicitConfiguration/);
  assert.match(detail, /max-w-md/);
  assert.match(detail, /ANALYTICS_EVENTS\.addToCart/);
  assert.match(detail, /unitPrice/);
  assert.doesNotMatch(detail, /catalog_price|potVariantId|plantPrice/);

  const cartUi = read("components/shop/ShopCart.tsx");
  assert.match(cartUi, /ANALYTICS_EVENTS\.removeFromCart/);
  assert.match(cartUi, /sellable_variant_id: line\.sellableVariantId/);
  assert.doesNotMatch(cartUi, /plant_price|pot_price|pot_variant_id/);

  const shopPage = read("app/shop/page.tsx");
  const plantPage = read("app/shop/plants/[plantId]/page.tsx");
  assert.match(shopPage, /PlantPageContactLink/);
  assert.match(shopPage, /shop\.whatsapp/);
  assert.match(plantPage, /PlantPageContactLink/);
  assert.match(plantPage, /plant\.whatsapp\.withoutPartner/);
  const contact = read("components/plant/PlantPageContactLink.tsx");
  assert.match(contact, /instagram/i);
  assert.match(contact, /accessibility/i);
  assert.match(read("lib/messages.ts"), /shop\.whatsapp/);

  const pos = read("components/plant/PosPlantLanding.tsx");
  assert.doesNotMatch(pos, /sellableVariantId|catalog_stock_holds|resolveCardConfiguration/);
  const flower = read("components/checkout/FlowerPaymentStartError.tsx");
  assert.doesNotMatch(flower, /catalog_stock_holds|sellableVariantId/);
  const partnerPrep = read("lib/startCardcomPaymentPrep.ts");
  assert.doesNotMatch(partnerPrep, /pot_color_id|catalog_stock_holds/);

  console.log("verify-catalog-offer-cutover: sources ok");
}

async function assertSelection(): Promise<void> {
  const selection = await import("../lib/catalogShopSelection");
  const sellable = (id: string, label: string, quantity = 2) => ({
    id,
    sizeLabel: label,
    quantity,
    variants: [
      {
        id: `${id}-sv`,
        potSizeId: null,
        offerId: `${id}-offer`,
        unitPrice: 40,
        colors: [],
      },
    ],
  });
  assert.equal(
    selection.defaultCatalogCardSizeId([sellable("s", "S"), sellable("m", "M"), sellable("l", "L")]),
    "m",
  );
  assert.equal(selection.defaultCatalogCardSizeId([sellable("s", "S")]), "s");
  assert.equal(selection.defaultCatalogCardSizeId([sellable("l", "L")]), "l");
  assert.equal(
    selection.defaultCatalogCardSizeId([sellable("s", "S"), sellable("l", "L")]),
    "s",
  );
  assert.equal(
    selection.defaultCatalogCardSizeId(
      [sellable("s", "S"), sellable("m", "M"), sellable("l", "L")],
      "L",
    ),
    "l",
  );
  const noOffer = {
    id: "size",
    quantity: 4,
    variants: [
      {
        id: "sv",
        potSizeId: null,
        offerId: "",
        unitPrice: 40,
        colors: [],
      },
    ],
  };
  assert.equal(selection.resolveCardVariant(noOffer), null);
  assert.equal(selection.resolveCardConfiguration(noOffer, null), null);
  assert.equal(
    selection.resolveCardVariant({ id: "size", quantity: 4, variants: [] }),
    null,
  );

  const white = { id: "color-b", color: "White", quantity: 2 };
  const black = { id: "color-a", color: "Black", quantity: 1 };
  const beta = {
    id: "sv-b",
    potSizeId: "ps-b",
    potName: "Beta",
    potImage: "/plant-library/beta.jpg",
    potSizeLabel: "S",
    offerId: "offer-b",
    unitPrice: 20,
    colors: [white],
  };
  const alphaLarge = {
    id: "sv-a-l",
    potSizeId: "ps-a-l",
    potName: "Alpha",
    potImage: "/plant-library/alpha-l.jpg",
    potSizeLabel: "L",
    offerId: "offer-a-l",
    unitPrice: 30,
    colors: [black, white],
  };
  const alphaSmall = {
    id: "sv-a-s",
    potSizeId: "ps-a-s",
    potName: "Alpha",
    potImage: "/plant-library/alpha-s.jpg",
    potSizeLabel: "S",
    offerId: "offer-a-s",
    unitPrice: 25,
    colors: [black],
  };
  const noPot = {
    id: "sv-none",
    potSizeId: null,
    offerId: "offer-none",
    unitPrice: 10,
    colors: [],
  };
  const size = {
    id: "size-1",
    quantity: 3,
    variants: [beta, alphaLarge, alphaSmall, noPot],
  };
  assert.equal(selection.resolveCardVariant(size)?.id, "sv-a-s");
  const resolved = selection.resolveCardConfiguration(size, null);
  assert.equal(resolved?.sellableVariantId, "sv-a-s");
  assert.equal(resolved?.potColorId, "color-a");
  assert.equal(resolved?.unitPrice, 25);
  assert.equal(selection.additionalInStockColorCount(alphaLarge, "color-a"), 1);
  const stable = selection.resolveCardConfiguration(size, {
    colorId: "color-b",
    setKey: selection.colorSetKey(alphaSmall),
  });
  assert.equal(stable?.sellableVariantId, "sv-a-s");
  assert.equal(stable?.potColorId, "color-a");
  const kept = selection.stablePotColorId(alphaLarge, {
    colorId: "color-b",
    setKey: selection.colorSetKey(alphaLarge),
  });
  assert.equal(kept, "color-b");
  assert.equal(
    selection.resolveCardVariant({ ...size, variants: [noPot] })?.id,
    "sv-none",
  );
  assert.equal(selection.resolveCardVariant({ ...size, quantity: 0 }), null);
  const imageless = { ...alphaSmall, id: "sv-bare", potImage: " " };
  assert.equal(
    selection.resolveCardVariant({ ...size, variants: [imageless, noPot] })?.id,
    "sv-bare",
  );
  const explicitBare = selection.resolveExplicitConfiguration(
    { ...size, variants: [imageless] },
    "sv-bare",
    "color-a",
  );
  assert.equal(explicitBare?.offerId, "offer-a-s");
  assert.equal(explicitBare?.unitPrice, 25);
  assert.equal(explicitBare?.potColorId, "color-a");
  assert.equal(
    selection.resolveCardVariant({
      ...size,
      variants: [beta, imageless, noPot],
    })?.id,
    "sv-bare",
  );
  const explicit = selection.resolveExplicitConfiguration(size, "sv-a-l", "color-b");
  assert.equal(explicit?.offerId, "offer-a-l");
  assert.equal(explicit?.unitPrice, 30);
  assert.equal(selection.resolveExplicitConfiguration(size, "sv-a-l", "missing"), null);

  console.log("verify-catalog-offer-cutover: selection ok");
}

async function main(): Promise<void> {
  assertSources();
  await assertSelection();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const costs = await import("../lib/catalogCheckoutSnapshot");
  const zero = costs.plantUnitCostFromSupplierPrice(0);
  assert.equal(zero.plantUnitCost, 0);
  assert.equal(zero.plantUnitCostSource, "plants.supplier_price@sale");
  const potZero = costs.potUnitCostFromSupplierPrice(0);
  assert.equal(potZero.potUnitCost, 0);
  assert.equal(costs.plantUnitCostFromSupplierPrice(null).plantUnitCost, null);
  assert.equal(costs.catalogLineTotal(55, 2), 110);
  const dbHost = process.env.DATABASE_URL ?? "";
  if (dbHost.includes("twilight-truth")) {
    throw new Error("refusing production database");
  }

  const { sql } = await import("../lib/db");
  await sql`UPDATE payment_attempts SET finalized_order_id = NULL WHERE product_id IN (SELECT id FROM plants WHERE name LIKE 'catalog-cutover-%')`;
  await sql`DELETE FROM catalog_stock_holds WHERE attempt_id IN (SELECT id FROM payment_attempts WHERE product_id IN (SELECT id FROM plants WHERE name LIKE 'catalog-cutover-%'))`;
  await sql`DELETE FROM order_items WHERE plant_id IN (SELECT id FROM plants WHERE name LIKE 'catalog-cutover-%')`;
  await sql`DELETE FROM orders WHERE product_id IN (SELECT id FROM plants WHERE name LIKE 'catalog-cutover-%')`;
  await sql`DELETE FROM payment_attempts WHERE product_id IN (SELECT id FROM plants WHERE name LIKE 'catalog-cutover-%')`;
  await sql`DELETE FROM offer_availabilities WHERE offer_id IN (
    SELECT o.id FROM offers o
    JOIN sellable_variants sv ON sv.id = o.sellable_variant_id
    JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    JOIN plants p ON p.id = pv.plant_id
    WHERE p.name LIKE 'catalog-cutover-%'
  )`;
  await sql`DELETE FROM offers WHERE sellable_variant_id IN (
    SELECT sv.id FROM sellable_variants sv
    JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    JOIN plants p ON p.id = pv.plant_id
    WHERE p.name LIKE 'catalog-cutover-%'
  )`;
  await sql`DELETE FROM sellable_variants WHERE plant_variant_id IN (
    SELECT pv.id FROM plant_variants pv
    JOIN plants p ON p.id = pv.plant_id
    WHERE p.name LIKE 'catalog-cutover-%'
  )`;
  await sql`DELETE FROM inventory_history WHERE variant_id IN (
    SELECT pv.id FROM plant_variants pv JOIN plants p ON p.id = pv.plant_id WHERE p.name LIKE 'catalog-cutover-%'
  )`;
  await sql`DELETE FROM inventory WHERE variant_id IN (
    SELECT pv.id FROM plant_variants pv JOIN plants p ON p.id = pv.plant_id WHERE p.name LIKE 'catalog-cutover-%'
  )`;
  await sql`DELETE FROM plant_variants WHERE plant_id IN (SELECT id FROM plants WHERE name LIKE 'catalog-cutover-%')`;
  await sql`DELETE FROM pot_inventory_history WHERE pot_color_id IN (
    SELECT c.id FROM pot_colors c JOIN pot_sizes s ON s.id = c.pot_size_id JOIN pots pot ON pot.id = s.pot_id
    WHERE pot.name LIKE 'catalog-cutover-%'
  )`;
  await sql`DELETE FROM pot_inventory WHERE pot_color_id IN (
    SELECT c.id FROM pot_colors c JOIN pot_sizes s ON s.id = c.pot_size_id JOIN pots pot ON pot.id = s.pot_id
    WHERE pot.name LIKE 'catalog-cutover-%'
  )`;
  await sql`DELETE FROM pot_colors WHERE pot_size_id IN (
    SELECT s.id FROM pot_sizes s JOIN pots pot ON pot.id = s.pot_id WHERE pot.name LIKE 'catalog-cutover-%'
  )`;
  await sql`DELETE FROM pot_sizes WHERE pot_id IN (SELECT id FROM pots WHERE name LIKE 'catalog-cutover-%')`;
  await sql`DELETE FROM pots WHERE name LIKE 'catalog-cutover-%'`;
  await sql`DELETE FROM plants WHERE name LIKE 'catalog-cutover-%'`;
  const columns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'order_items'
      AND column_name IN ('unit_price', 'plant_unit_price', 'pot_unit_price', 'pot_variant_id')
  `;
  const names = new Set((columns as { column_name: string }[]).map((row) => row.column_name));
  assert.equal(names.has("unit_price"), true);
  assert.equal(names.has("plant_unit_price"), false);
  assert.equal(names.has("pot_unit_price"), false);
  assert.equal(names.has("pot_variant_id"), false);

  const money = await sql`
    SELECT count(*)::int AS n
    FROM order_items
    WHERE unit_price IS NULL
       OR unit_price * quantity IS DISTINCT FROM line_total
  `;
  assert.equal(Number((money as { n: number }[])[0]?.n), 0);

  let blocked = false;
  const gateAttempt = randomUUID();
  try {
    await sql.transaction([
      sql`
        INSERT INTO payment_attempts (
          id, status, pos_spot_id, channel, product_id, product_name,
          full_name, customer_email, phone, fulfillment_method, amount,
          payment_resume_token, created_at, updated_at, expires_at
        ) VALUES (
          ${gateAttempt}::uuid,
          'created',
          NULL,
          'catalog',
          ${randomUUID()},
          'cutover gate',
          'Gate',
          '',
          '0500000000',
          'delivery',
          10,
          ${`gate-${gateAttempt}`},
          now(),
          now(),
          now() + interval '17 minutes'
        )
      `,
      sql`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM payment_attempts
            WHERE channel = 'catalog'
              AND status IN ('created', 'awaiting_payment')
              AND (expires_at IS NULL OR expires_at > now())
          ) THEN
            RAISE EXCEPTION 'catalog cutover blocked: in-flight catalog payment attempts'
              USING ERRCODE = 'P0001';
          END IF;
        END $$
      `,
    ]);
  } catch (error) {
    blocked = error instanceof Error && /in-flight catalog payment attempts/.test(error.message);
  }
  assert.equal(blocked, true);
  const leftover = await sql`
    SELECT id FROM payment_attempts WHERE id = ${gateAttempt}::uuid
  `;
  assert.equal((leftover as unknown[]).length, 0);

  const { createPlant, deletePlant, getPlantByIdAsync, updatePlant } = await import(
    "../lib/plantStorage"
  );
  const { createPlantVariant } = await import("../lib/plantVariantStorage");
  const { applyInventoryDelta, getInventoryQuantity } = await import("../lib/inventoryStorage");
  const { createPot } = await import("../lib/potStorage");
  const { createPotSize, createPotColor } = await import("../lib/potSizeStorage");
  const { applyPotInventoryDelta, getPotInventoryQuantity } = await import(
    "../lib/potInventoryStorage"
  );
  const { createSellableVariant } = await import("../lib/sellableVariantStorage");
  const { createOrReusePlantOffer } = await import("../lib/offerStorage");
  const { acquireCatalogStockHolds, releaseCatalogStockHolds, CatalogStockHoldError } =
    await import("../lib/catalogStockHolds");
  const { finalizeCatalogVerifiedPayment } = await import("../lib/finalizeCatalogPayment");
  const { readCatalogShopDetail, resolveCatalogCartLines } = await import("../lib/catalogShop");
  const { startCatalogCardcomPayment } = await import("../lib/catalogPaymentPrep");
  const { TEL_AVIV_STREETS } = await import("../constants/telAvivStreets");

  const plantRows = await sql`SELECT id, inventory_type FROM plants`;
  const plantRow = (plantRows as { id: string; inventory_type: string | null }[]).find(
    (row) => (row.inventory_type ?? "plants") === "plants",
  );
  assert.ok(plantRow);
  const sourcePlant = await getPlantByIdAsync(plantRow.id);
  assert.ok(sourcePlant);

  const tag = `catalog-cutover-${randomUUID().slice(0, 8)}`;
  const testPlantId = randomUUID();
  const variantIds: string[] = [];
  const sellableIds: string[] = [];
  const potIds: string[] = [];
  const attemptIds: string[] = [];
  const orderIds: string[] = [];

  async function cleanup(): Promise<void> {
    if (attemptIds.length > 0) {
      await sql`UPDATE payment_attempts SET finalized_order_id = NULL WHERE id = ANY(${attemptIds}::uuid[])`;
      await sql`DELETE FROM catalog_stock_holds WHERE attempt_id = ANY(${attemptIds}::uuid[])`;
      await sql`DELETE FROM payment_attempts WHERE id = ANY(${attemptIds}::uuid[])`;
    }
    if (orderIds.length > 0) {
      await sql`DELETE FROM order_items WHERE order_id = ANY(${orderIds}::uuid[])`;
      await sql`DELETE FROM orders WHERE order_id = ANY(${orderIds}::uuid[])`;
    }
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
      await sql`DELETE FROM pot_inventory_history WHERE pot_color_id IN (
        SELECT c.id FROM pot_colors c
        JOIN pot_sizes s ON s.id = c.pot_size_id
        WHERE s.pot_id = ANY(${potIds}::uuid[])
      )`;
      await sql`DELETE FROM pot_inventory WHERE pot_color_id IN (
        SELECT c.id FROM pot_colors c
        JOIN pot_sizes s ON s.id = c.pot_size_id
        WHERE s.pot_id = ANY(${potIds}::uuid[])
      )`;
      await sql`DELETE FROM pot_colors WHERE pot_size_id IN (
        SELECT id FROM pot_sizes WHERE pot_id = ANY(${potIds}::uuid[])
      )`;
      await sql`DELETE FROM pot_sizes WHERE pot_id = ANY(${potIds}::uuid[])`;
      await sql`DELETE FROM pots WHERE id = ANY(${potIds}::uuid[])`;
    }
  }

  try {
    const createdPlant = await createPlant({
      ...sourcePlant,
      id: testPlantId,
      name: tag,
      nameHe: "בדיקת מעבר",
      catalogPublished: true,
      createdAt: new Date().toISOString(),
    });
    await updatePlant(testPlantId, { ...createdPlant, catalogPublished: true });
    const size = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "M",
      nurseryPotDiameterCm: 17,
    });
    variantIds.push(size.id);
    await applyInventoryDelta({ variantId: size.id, delta: 4, note: `${tag} receive` });
    const pot = await createPot({
      name: `${tag} pot`,
      nameHe: "עציץ",
      image: "/plant-library/catalog-cutover-pot.jpg",
    });
    potIds.push(pot.id);
    const potSize = await createPotSize({ potId: pot.id, sizeLabel: "M", supplierPrice: 12 });
    await sql`UPDATE pot_sizes SET supplier_price = 0 WHERE id = ${potSize.id}::uuid`;
    const storedCost = await sql`
      SELECT supplier_price FROM pot_sizes WHERE id = ${potSize.id}::uuid
    `;
    assert.equal(Number((storedCost as { supplier_price: string }[])[0]?.supplier_price), 0);
    const color = await createPotColor({
      potId: pot.id,
      sizeId: potSize.id,
      color: "Clay",
      colorHe: "חרס",
    });
    await applyPotInventoryDelta({
      potId: pot.id,
      sizeId: potSize.id,
      potColorId: color.id,
      delta: 3,
      note: `${tag} color`,
    });
    const noPotVariant = await createSellableVariant({
      plantId: testPlantId,
      plantSizeId: size.id,
      potSizeId: null,
    });
    const potVariant = await createSellableVariant({
      plantId: testPlantId,
      plantSizeId: size.id,
      potSizeId: potSize.id,
    });
    sellableIds.push(noPotVariant.sellableVariantId, potVariant.sellableVariantId);
    const noPotOffer = await createOrReusePlantOffer({
      sellableVariantId: noPotVariant.sellableVariantId,
      consumerPrice: 40,
      availabilities: [{ scope: "catalog" }],
    });
    const potOffer = await createOrReusePlantOffer({
      sellableVariantId: potVariant.sellableVariantId,
      consumerPrice: 55,
      availabilities: [{ scope: "catalog" }],
    });

    const resolved = await resolveCatalogCartLines([
      {
        plantId: testPlantId,
        plantSizeId: size.id,
        sellableVariantId: potVariant.sellableVariantId,
        offerId: potOffer.offer.id,
        potColorId: color.id,
        quantity: 1,
      },
      {
        plantId: testPlantId,
        plantSizeId: size.id,
        sellableVariantId: noPotVariant.sellableVariantId,
        offerId: noPotOffer.offer.id,
        potColorId: null,
        quantity: 1,
      },
    ]);
    assert.equal(resolved.length, 2);
    const potLine = resolved.find((line) => line.potColorId != null);
    const bareLine = resolved.find((line) => line.potColorId == null);
    assert.ok(potLine && bareLine);
    assert.equal(potLine.potColorId, color.id);
    assert.equal(potLine.offerId, potOffer.offer.id);
    assert.equal(potLine.unitPrice, 55);
    assert.equal(bareLine.offerId, noPotOffer.offer.id);
    assert.equal(bareLine.unitPrice, 40);

    async function insertAttempt(amount: number, snapshot: unknown): Promise<string> {
      const id = randomUUID();
      attemptIds.push(id);
      await sql`
        INSERT INTO payment_attempts (
          id, status, pos_spot_id, channel, product_id, product_name,
          full_name, customer_email, phone, fulfillment_method, amount,
          payment_resume_token, checkout_session_id, catalog_snapshot,
          created_at, updated_at, expires_at
        ) VALUES (
          ${id}::uuid,
          'awaiting_payment',
          NULL,
          'catalog',
          ${testPlantId},
          ${tag},
          'Cutover',
          '',
          '0500000000',
          'delivery',
          ${amount},
          ${`cutover-${id}`},
          ${`session-${id}`},
          ${JSON.stringify(snapshot)}::jsonb,
          now(),
          now(),
          now() + interval '17 minutes'
        )
      `;
      return id;
    }

    const bareAttempt = await insertAttempt(40, {
      lines: [
        {
          lineNo: 1,
          plantId: testPlantId,
          plantVariantId: size.id,
          sellableVariantId: noPotVariant.sellableVariantId,
          offerId: noPotOffer.offer.id,
          potSizeId: null,
          potColorId: null,
          quantity: 1,
          unitPrice: 40,
          lineTotal: 40,
          currency: "ILS",
          plantName: tag,
          plantNameHe: "בדיקת מעבר",
          sizeLabel: "M",
          plantUnitCost: 0,
          plantUnitCostSource: "plants.supplier_price@sale",
        },
      ],
    });
    const bareHolds = await acquireCatalogStockHolds({
      attemptId: bareAttempt,
      lines: [{ plantVariantId: size.id, quantity: 1 }],
    });
    assert.equal(bareHolds.length, 1);
    assert.equal(bareHolds[0]?.plantVariantId, size.id);
    assert.equal(bareHolds[0]?.potColorId, null);
    const beforeBare = await getInventoryQuantity(size.id);
    const bareResult = await finalizeCatalogVerifiedPayment({
      attemptId: bareAttempt,
      checkoutSessionId: `session-${bareAttempt}`,
      cardcomTransactionId: 1,
    });
    assert.equal(bareResult.outcome, "finalized");
    if (bareResult.outcome === "finalized") orderIds.push(bareResult.orderId);
    assert.equal(await getInventoryQuantity(size.id), beforeBare - 1);
    const bareItem = await sql`
      SELECT unit_price, plant_unit_cost, sellable_variant_id::text AS sellable_variant_id, offer_id
      FROM order_items
      WHERE order_id = ${(bareResult.outcome === "finalized" ? bareResult.orderId : "")}::uuid
    `;
    const storedBare = (
      bareItem as {
        unit_price: string;
        plant_unit_cost: string | null;
        sellable_variant_id: string;
        offer_id: string;
      }[]
    )[0];
    assert.equal(Number(storedBare?.unit_price), 40);
    assert.equal(Number(storedBare?.plant_unit_cost), 0);
    assert.equal(storedBare?.offer_id, noPotOffer.offer.id);

    const shortAttempt = await insertAttempt(55, {
      lines: [
        {
          lineNo: 1,
          plantId: testPlantId,
          plantVariantId: size.id,
          sellableVariantId: potVariant.sellableVariantId,
          offerId: potOffer.offer.id,
          potSizeId: potSize.id,
          potColorId: color.id,
          quantity: 1,
          unitPrice: 55,
          lineTotal: 55,
          currency: "ILS",
          plantName: tag,
          sizeLabel: "M",
          potName: pot.name,
          potSizeLabel: "M",
          potColor: "Clay",
          potUnitCost: 0,
          potUnitCostSource: "pot_sizes.supplier_price@sale",
        },
      ],
    });
    let shortFailed = false;
    try {
      await acquireCatalogStockHolds({
        attemptId: shortAttempt,
        lines: [
          { plantVariantId: size.id, quantity: 1 },
          { potColorId: color.id, quantity: 99 },
        ],
      });
    } catch (error) {
      shortFailed = error instanceof CatalogStockHoldError && error.code === "insufficient_quantity";
    }
    assert.equal(shortFailed, true);
    const shortHolds = await sql`
      SELECT count(*)::int AS n FROM catalog_stock_holds WHERE attempt_id = ${shortAttempt}::uuid
    `;
    assert.equal(Number((shortHolds as { n: number }[])[0]?.n), 0);

    const colorBefore = await getPotInventoryQuantity(color.id);
    const plantBefore = await getInventoryQuantity(size.id);
    const potAttempt = await insertAttempt(55, {
      lines: [
        {
          lineNo: 1,
          plantId: testPlantId,
          plantVariantId: size.id,
          sellableVariantId: potVariant.sellableVariantId,
          offerId: potOffer.offer.id,
          potSizeId: potSize.id,
          potColorId: color.id,
          quantity: 1,
          unitPrice: 55,
          lineTotal: 55,
          currency: "ILS",
          plantName: tag,
          sizeLabel: "M",
          potName: pot.name,
          potSizeLabel: "M",
          potColor: "Clay",
          potColorHe: "חרס",
          plantUnitCost: 0,
          plantUnitCostSource: "plants.supplier_price@sale",
          potUnitCost: 0,
          potUnitCostSource: "pot_sizes.supplier_price@sale",
        },
      ],
    });
    const potHolds = await acquireCatalogStockHolds({
      attemptId: potAttempt,
      lines: [
        { plantVariantId: size.id, quantity: 1 },
        { potColorId: color.id, quantity: 1 },
      ],
    });
    assert.equal(potHolds.length, 2);
    assert.equal(await getInventoryQuantity(size.id), plantBefore);
    assert.equal(await getPotInventoryQuantity(color.id), colorBefore);
    await releaseCatalogStockHolds(potAttempt);
    assert.equal(await getInventoryQuantity(size.id), plantBefore);
    const released = await sql`
      SELECT status FROM catalog_stock_holds WHERE attempt_id = ${potAttempt}::uuid
    `;
    assert.equal((released as { status: string }[]).every((row) => row.status === "released"), true);

    const sellAttempt = await insertAttempt(55, {
      lines: [
        {
          lineNo: 1,
          plantId: testPlantId,
          plantVariantId: size.id,
          sellableVariantId: potVariant.sellableVariantId,
          offerId: potOffer.offer.id,
          potSizeId: potSize.id,
          potColorId: color.id,
          quantity: 1,
          unitPrice: 55,
          lineTotal: 55,
          currency: "ILS",
          plantName: tag,
          sizeLabel: "M",
          potName: pot.name,
          potSizeLabel: "M",
          potColor: "Clay",
          potUnitCost: 0,
          potUnitCostSource: "pot_sizes.supplier_price@sale",
        },
      ],
    });
    await acquireCatalogStockHolds({
      attemptId: sellAttempt,
      lines: [
        { plantVariantId: size.id, quantity: 1 },
        { potColorId: color.id, quantity: 1 },
      ],
    });
    const sold = await finalizeCatalogVerifiedPayment({
      attemptId: sellAttempt,
      checkoutSessionId: `session-${sellAttempt}`,
      cardcomTransactionId: 2,
    });
    assert.equal(sold.outcome, "finalized");
    if (sold.outcome === "finalized") orderIds.push(sold.orderId);
    assert.equal(await getInventoryQuantity(size.id), plantBefore - 1);
    assert.equal(await getPotInventoryQuantity(color.id), colorBefore - 1);
    const histories = await sql`
      SELECT
        (SELECT count(*)::int FROM inventory_history WHERE variant_id = ${size.id}::uuid AND note LIKE ${"catalog sale %"}) AS plants,
        (SELECT count(*)::int FROM pot_inventory_history WHERE pot_color_id = ${color.id}::uuid AND note LIKE ${"catalog sale %"}) AS colors
    `;
    const history = (histories as { plants: number; colors: number }[])[0];
    assert.equal(Number(history?.plants), 2);
    assert.equal(Number(history?.colors), 1);

    const pictured = (await readCatalogShopDetail(testPlantId))?.sizes
      .flatMap((entry) => entry.variants)
      .find((entry) => entry.id === potVariant.sellableVariantId);
    assert.equal(pictured?.potImage, "/plant-library/catalog-cutover-pot.jpg");
    assert.equal(pictured?.offerId, potOffer.offer.id);
    await sql`UPDATE pots SET image = NULL WHERE id = ${pot.id}::uuid`;
    const imagelessDetail = (await readCatalogShopDetail(testPlantId))?.sizes
      .flatMap((entry) => entry.variants)
      .find((entry) => entry.id === potVariant.sellableVariantId);
    assert.ok(imagelessDetail);
    assert.equal(imagelessDetail.potImage, undefined);
    assert.equal(imagelessDetail.offerId, potOffer.offer.id);
    assert.equal(imagelessDetail.unitPrice, 55);
    const imagelessCart = await resolveCatalogCartLines([
      {
        plantId: testPlantId,
        plantSizeId: size.id,
        sellableVariantId: potVariant.sellableVariantId,
        offerId: potOffer.offer.id,
        potColorId: color.id,
        quantity: 1,
      },
    ]);
    assert.equal(imagelessCart.length, 1);
    assert.equal(imagelessCart[0]?.unitPrice, 55);
    assert.equal(imagelessCart[0]?.potColorId, color.id);

    const lowProfileId = `lp-imageless-${randomUUID()}`;
    const prep = await startCatalogCardcomPayment(
      {
        lines: [
          {
            plantId: testPlantId,
            plantSizeId: size.id,
            sellableVariantId: potVariant.sellableVariantId,
            offerId: potOffer.offer.id,
            potColorId: color.id,
            quantity: 1,
            unitPrice: 55,
          },
        ],
        fullName: "Cutover",
        phone: "0546605603",
        emailOptIn: false,
        deliveryStreet: TEL_AVIV_STREETS[0] ?? "Rothschild Blvd",
        deliveryHouseNumber: "12",
      },
      {
        publicOrigin: "https://urban-plant-catalog-cutover-verify.example.com",
        cardcomEnvironment: "test",
        createLowProfile: async () => ({
          ResponseCode: 0,
          Description: "OK",
          LowProfileId: lowProfileId,
          Url: `https://example.test/pay?id=${lowProfileId}`,
        }),
      },
    );
    assert.equal(prep.ok, true, prep.ok ? "" : `${prep.code}: ${prep.error}`);
    if (prep.ok) {
      attemptIds.push(prep.attemptId);
      const imagelessSale = await finalizeCatalogVerifiedPayment({
        attemptId: prep.attemptId,
        checkoutSessionId: lowProfileId,
        cardcomTransactionId: 3,
      });
      assert.equal(imagelessSale.outcome, "finalized");
      if (imagelessSale.outcome === "finalized") orderIds.push(imagelessSale.orderId);
      assert.equal(await getInventoryQuantity(size.id), plantBefore - 2);
      assert.equal(await getPotInventoryQuantity(color.id), colorBefore - 2);
    }

    console.log("verify-catalog-offer-cutover: database ok");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error("verify-catalog-offer-cutover FAILED", error);
  process.exit(1);
});

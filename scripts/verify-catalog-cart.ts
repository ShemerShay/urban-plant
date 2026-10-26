/**
 * Catalog Cart: browser storage, product CTA, drawer, read-only resolve.
 * Does not write inventory, create holds, or start checkout/Cardcom.
 *
 * Run: npx tsx scripts/verify-catalog-cart.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertCartWiring(): void {
  const cartLib = read("lib/catalogCart.ts");
  assert.match(cartLib, /up_catalog_cart/);
  assert.match(cartLib, /catalogCartTotalQuantity/);
  assert.match(cartLib, /plantId \+ plantSizeId \+ sellableVariantId \+ offerId \+ potColorId|catalogCartItemKey/);
  assert.doesNotMatch(cartLib, /applyInventoryDelta/);
  assert.doesNotMatch(cartLib, /startCardcom/);
  assert.doesNotMatch(cartLib, /catalog_stock_holds/);

  const store = read("lib/catalogCartStore.ts");
  assert.match(store, /useSyncExternalStore/);
  assert.match(store, /localStorage/);
  assert.doesNotMatch(store, /addEventListener\(\s*["']storage["']/);
  assert.doesNotMatch(store, /sessionStorage/);

  const detailUi = read("components/shop/ShopPlantDetail.tsx");
  assert.match(detailUi, /shop\.addToCart/);
  assert.match(detailUi, /addCatalogCartItem/);
  assert.match(detailUi, /selectedVariantId/);
  assert.doesNotMatch(detailUi, /FixedBottomCTA/);
  assert.doesNotMatch(detailUi, /startCardcom/);
  assert.doesNotMatch(detailUi, /ANALYTICS_EVENTS\.removeFromCart/);

  assert.equal(existsSync(join(root, "app/cart/page.tsx")), false);

  const bar = read("components/shop/ShopCatalogBar.tsx");
  assert.match(bar, /catalogCartTotalQuantity/);
  assert.match(bar, /ShopCart/);
  assert.match(bar, /aria-haspopup=\"dialog\"/);
  assert.doesNotMatch(bar, /href=\"\/cart\"/);
  assert.doesNotMatch(bar, /routes\.shop\.cart/);

  const cartUi = read("components/shop/ShopCart.tsx");
  assert.match(cartUi, /role=\"dialog\"/);
  assert.match(cartUi, /shop\.cartEmpty/);
  assert.match(cartUi, /shop\.cartTotal/);
  assert.match(cartUi, /shop\.cartRemove/);
  assert.match(cartUi, /ANALYTICS_EVENTS\.removeFromCart/);
  assert.match(cartUi, /captureAnalyticsEvent/);
  assert.doesNotMatch(cartUi, /ANALYTICS_EVENTS\.addToCart/);
  assert.doesNotMatch(cartUi, /startCardcom/);
  assert.match(cartUi, /routes\.shop\.checkout\(\)/);
  assert.doesNotMatch(cartUi, /shopCheckout\(/);
  assert.doesNotMatch(cartUi, /startCatalogCardcomPayment/);
  assert.doesNotMatch(cartUi, /href=\"\/cart\"/);
  assert.doesNotMatch(cartUi, /href=\{routes\.shop\.index/);

  const resolveRoute = read("app/api/shop/cart/resolve/route.ts");
  assert.match(resolveRoute, /export async function POST/);
  assert.match(resolveRoute, /resolveCatalogCartLines/);
  assert.doesNotMatch(resolveRoute, /export async function GET/);
  assert.doesNotMatch(resolveRoute, /applyInventoryDelta/);
  assert.doesNotMatch(resolveRoute, /isAdminRequest/);
  assert.doesNotMatch(resolveRoute, /startCardcom/);

  const shopReads = read("lib/catalogShop.ts");
  assert.match(shopReads, /resolveCatalogCartLines/);
  assert.match(shopReads, /Does not write inventory/);
  assert.doesNotMatch(shopReads, /!potImage\) continue/);
  assert.doesNotMatch(shopReads, /applyInventoryDelta/);

  const header = read("components/plant/PlantPageHeader.tsx");
  assert.doesNotMatch(header, /shop\.cart/);
  assert.doesNotMatch(header, /routes\.shop\.cart/);

  const posLanding = read("components/plant/PosPlantLanding.tsx");
  assert.doesNotMatch(posLanding, /addCatalogCartItem/);
  assert.doesNotMatch(posLanding, /useCatalogCart/);

  const events = read("lib/analyticsEvents.ts");
  assert.match(events, /addToCart:\s*"add_to_cart"/);
  assert.match(events, /removeFromCart:\s*"remove_from_cart"/);
  assert.match(events, /productView:\s*"product_view"/);

  const tracker = read("components/analytics/TrackProductView.tsx");
  assert.match(tracker, /captureOncePerSession/);
  assert.match(tracker, /ANALYTICS_EVENTS\.productView/);

  const routes = read("lib/routes.ts");
  assert.doesNotMatch(routes, /cart: \(\) => "\/cart"/);
  assert.match(routes, /shopCartResolve: \(\) => "\/api\/shop\/cart\/resolve"/);

  console.log("verify-catalog-cart: drawer links to checkout without starting payment");
}

async function assertCartHelpers(): Promise<void> {
  const cart = await import("../lib/catalogCart");
  assert.deepEqual(cart.parseCatalogCart(null), cart.EMPTY_CATALOG_CART);
  assert.deepEqual(cart.parseCatalogCart("not-json"), cart.EMPTY_CATALOG_CART);
  assert.deepEqual(cart.parseCatalogCart('{"v":2,"items":[]}'), cart.EMPTY_CATALOG_CART);
  assert.deepEqual(
    cart.parseCatalogCart(
      '{"v":1,"items":[{"plantId":"p","plantVariantId":"v","potVariantId":null,"quantity":1.5}]}',
    ),
    cart.EMPTY_CATALOG_CART,
  );

  const legacy = cart.parseCatalogCart(
    JSON.stringify({
      v: 1,
      items: [
        { plantId: "p1", plantVariantId: "v1", potVariantId: null, quantity: 2 },
        { plantId: "p1", plantVariantId: "v1", potVariantId: null, quantity: 1 },
      ],
    }),
  );
  assert.equal(legacy.v, 1);
  assert.equal(legacy.items.length, 2);

  const noPot = {
    plantId: "p1",
    plantSizeId: "size-1",
    sellableVariantId: "sv-1",
    offerId: "offer-1",
    potColorId: null as string | null,
  };
  const withColor = { ...noPot, potColorId: "color-a" };
  const otherSize = { ...noPot, plantSizeId: "size-2", sellableVariantId: "sv-2" };
  assert.notEqual(cart.catalogCartItemKey(withColor), cart.catalogCartItemKey(noPot));
  assert.notEqual(cart.catalogCartItemKey(noPot), cart.catalogCartItemKey(otherSize));

  const merged = cart.parseCatalogCart(
    JSON.stringify({
      v: 2,
      items: [
        { ...noPot, quantity: 2 },
        { ...noPot, quantity: 1 },
      ],
    }),
  );
  assert.equal(merged.v, 2);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0]?.quantity, 3);

  let next = cart.addCatalogCartItem(cart.EMPTY_CATALOG_CART, noPot, 2);
  assert.equal(next.added, true);
  assert.equal(next.cart.items[0]?.quantity, 1);
  next = cart.addCatalogCartItem(next.cart, noPot, 2);
  assert.equal(next.added, true);
  assert.equal(next.cart.items[0]?.quantity, 2);
  next = cart.addCatalogCartItem(next.cart, noPot, 2);
  assert.equal(next.added, false);
  assert.equal(next.cart.items[0]?.quantity, 2);

  const mixed = cart.addCatalogCartItem(next.cart, withColor, 2);
  assert.equal(mixed.added, true);
  assert.equal(mixed.cart.items.length, 2);
  assert.equal(cart.catalogCartTotalQuantity(mixed.cart), 3);

  const bumped = cart.updateCatalogCartQuantity(mixed.cart, noPot, 1, 2);
  assert.equal(bumped.v, 2);
  if (bumped.v !== 2) throw new Error("expected v2");
  assert.equal(bumped.items.find((item) => item.potColorId == null)?.quantity, 1);
  const blocked = cart.updateCatalogCartQuantity(bumped, noPot, 9, 2);
  assert.equal(blocked.v, 2);
  if (blocked.v !== 2) throw new Error("expected v2");
  assert.equal(blocked.items.find((item) => item.potColorId == null)?.quantity, 2);
  const removed = cart.removeCatalogCartItem(blocked, withColor);
  assert.equal(removed.v, 2);
  if (removed.v !== 2) throw new Error("expected v2");
  assert.equal(removed.items.length, 1);
  assert.equal(removed.items[0]?.potColorId, null);

  const request = cart.parseCatalogCartRequest({
    v: 2,
    items: [{ ...noPot, quantity: 1 }],
  });
  assert.equal(request?.v, 2);
  assert.equal(request && request.v === 2 ? request.items.length : 0, 1);
  assert.equal(cart.parseCatalogCartRequest({ items: "nope" }), null);

  console.log("verify-catalog-cart: helpers ok");
}

async function main(): Promise<void> {
  assertCartWiring();
  await assertCartHelpers();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const { sql } = await import("../lib/db");
  const { createPlant, deletePlant, getPlantByIdAsync, updatePlant } = await import(
    "../lib/plantStorage"
  );
  const { createPlantVariant } = await import("../lib/plantVariantStorage");
  const { applyInventoryDelta, getInventoryQuantity } = await import("../lib/inventoryStorage");
  const { readCatalogShopDetail, resolveCatalogCartLines } = await import("../lib/catalogShop");
  const { createPot, updatePot } = await import("../lib/potStorage");
  const { createPotSize, createPotColor } = await import("../lib/potSizeStorage");
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

  const tag = `catalog-cart-verify-${randomUUID().slice(0, 8)}`;
  const testPlantId = randomUUID();
  const variantIds: string[] = [];
  const sellableIds: string[] = [];
  const potIds: string[] = [];
  const attemptIds: string[] = [];

  async function seedOffer(plantSizeId: string, price: number, potSizeId: string | null) {
    const variant = await createSellableVariant({
      plantId: testPlantId,
      plantSizeId,
      potSizeId,
    });
    sellableIds.push(variant.sellableVariantId);
    const created = await createOrReusePlantOffer({
      sellableVariantId: variant.sellableVariantId,
      consumerPrice: price,
      availabilities: [{ scope: "catalog" }],
    });
    return { sellableVariantId: variant.sellableVariantId, offerId: created.offer.id };
  }

  async function cleanup(): Promise<void> {
    if (attemptIds.length > 0) {
      await sql`DELETE FROM catalog_stock_holds WHERE attempt_id = ANY(${attemptIds}::uuid[])`;
      await sql`DELETE FROM payment_attempts WHERE id = ANY(${attemptIds}::uuid[])`;
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
      nameHe: "צמח עגלה",
      catalogPublished: false,
      createdAt: new Date().toISOString(),
    });

    const small = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "S",
      nurseryPotDiameterCm: 12,
      catalogPrice: 40,
    });
    const medium = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "M",
      nurseryPotDiameterCm: 17,
      catalogPrice: 90,
    });
    const unpriced = await createPlantVariant({
      plantId: testPlantId,
      sizeLabel: "L",
      nurseryPotDiameterCm: 8,
    });
    variantIds.push(small.id, medium.id, unpriced.id);
    await applyInventoryDelta({ variantId: medium.id, delta: 2, note: `${tag} receive` });

    const clay = await createPot({
      name: `${tag} clay`,
      nameHe: "חימר",
      image: "/plant-library/catalog-cart-pot.jpg",
    });
    potIds.push(clay.id);
    const potSize = await createPotSize({ potId: clay.id, sizeLabel: "M", supplierPrice: 10 });
    const black = await createPotColor({
      potId: clay.id,
      sizeId: potSize.id,
      color: "Black",
      colorHe: "שחור",
    });
    const otherSize = await createPotSize({ potId: clay.id, sizeLabel: "S", supplierPrice: 8 });
    const white = await createPotColor({
      potId: clay.id,
      sizeId: otherSize.id,
      color: "White",
      colorHe: "לבן",
    });
    await applyPotInventoryDelta({
      potId: clay.id,
      sizeId: potSize.id,
      potColorId: black.id,
      delta: 2,
      note: `${tag} color`,
    });
    const mediumOffer = await seedOffer(medium.id, 90, null);
    const smallOffer = await seedOffer(small.id, 40, null);
    const potOffer = await seedOffer(medium.id, 125, potSize.id);

    const line = (
      offer: { sellableVariantId: string; offerId: string },
      patch: { quantity?: number; potColorId?: string | null; plantSizeId?: string } = {},
    ) => ({
      plantId: testPlantId,
      plantSizeId: patch.plantSizeId ?? medium.id,
      sellableVariantId: offer.sellableVariantId,
      offerId: offer.offerId,
      potColorId: patch.potColorId ?? null,
      quantity: patch.quantity ?? 1,
    });

    const unpublished = await resolveCatalogCartLines([line(mediumOffer)]);
    assert.equal(unpublished.length, 0);

    await updatePlant(testPlantId, { ...createdPlant, catalogPublished: true });

    const historyBefore = await sql`
      SELECT count(*)::int AS n FROM inventory_history WHERE variant_id = ${medium.id}::uuid
    `;
    const qtyBefore = await getInventoryQuantity(medium.id);

    const clamped = await resolveCatalogCartLines([line(mediumOffer, { quantity: 5 })]);
    assert.equal(clamped.length, 1);
    assert.equal(clamped[0]?.quantity, 2);
    assert.equal(clamped[0]?.availableQuantity, 2);
    assert.equal(clamped[0]?.unitPrice, 90);

    const holdAttemptId = randomUUID();
    attemptIds.push(holdAttemptId);
    await sql`
      INSERT INTO payment_attempts (
        id, status, pos_spot_id, channel, product_id, product_name,
        full_name, customer_email, phone, fulfillment_method, amount,
        payment_resume_token, created_at, updated_at, expires_at
      ) VALUES (
        ${holdAttemptId}::uuid,
        'awaiting_payment',
        NULL,
        'catalog',
        ${testPlantId},
        ${tag},
        'Hold Test',
        '',
        '0500000000',
        'delivery',
        90,
        ${`cart-hold-${holdAttemptId}`},
        now(),
        now(),
        now() + interval '17 minutes'
      )
    `;
    await sql`
      INSERT INTO catalog_stock_holds (
        attempt_id, plant_variant_id, pot_color_id, quantity, status, expires_at
      ) VALUES (
        ${holdAttemptId}::uuid,
        ${medium.id}::uuid,
        NULL,
        1,
        'active',
        now() + interval '17 minutes'
      )
    `;
    const held = await resolveCatalogCartLines([line(mediumOffer, { quantity: 5 })]);
    assert.equal(held.length, 1);
    assert.equal(held[0]?.quantity, 1);
    assert.equal(held[0]?.availableQuantity, 1);
    assert.equal(await getInventoryQuantity(medium.id), qtyBefore);

    await sql`
      UPDATE catalog_stock_holds
      SET expires_at = now() - interval '1 minute', updated_at = now()
      WHERE attempt_id = ${holdAttemptId}::uuid
    `;
    const expiredHold = await resolveCatalogCartLines([line(mediumOffer, { quantity: 5 })]);
    assert.equal(expiredHold[0]?.availableQuantity, 2);
    await sql`DELETE FROM catalog_stock_holds WHERE attempt_id = ${holdAttemptId}::uuid`;
    await sql`DELETE FROM payment_attempts WHERE id = ${holdAttemptId}::uuid`;
    attemptIds.pop();
    assert.equal(clamped[0]?.potColorId, null);
    assert.equal(clamped[0]?.name, tag);

    const oos = await resolveCatalogCartLines([
      line(smallOffer, { plantSizeId: small.id, quantity: 1 }),
    ]);
    assert.equal(oos.length, 0);

    const missingPrice = await resolveCatalogCartLines([
      {
        plantId: testPlantId,
        plantSizeId: unpriced.id,
        sellableVariantId: randomUUID(),
        offerId: "missing-offer",
        potColorId: null,
        quantity: 1,
      },
    ]);
    assert.equal(missingPrice.length, 0);

    const withPot = await resolveCatalogCartLines([
      line(potOffer, { potColorId: black.id }),
    ]);
    assert.equal(withPot.length, 1);
    assert.equal(withPot[0]?.potColorId, black.id);
    assert.equal(withPot[0]?.unitPrice, 125);
    assert.equal(withPot[0]?.potColor, "Black");
    const pictured = (await readCatalogShopDetail(testPlantId))?.sizes
      .find((entry) => entry.id === medium.id)
      ?.variants.find((entry) => entry.id === potOffer.sellableVariantId);
    assert.equal(pictured?.potImage, "/plant-library/catalog-cart-pot.jpg");
    await updatePot({ potId: clay.id, image: null });
    const withoutImage = await resolveCatalogCartLines([
      line(potOffer, { potColorId: black.id }),
    ]);
    assert.equal(withoutImage.length, 1);
    assert.equal(withoutImage[0]?.potColorId, black.id);
    assert.equal(withoutImage[0]?.unitPrice, 125);
    assert.equal(withoutImage[0]?.offerId, potOffer.offerId);
    const cleared = (await readCatalogShopDetail(testPlantId))?.sizes
      .find((entry) => entry.id === medium.id)
      ?.variants.find((entry) => entry.id === potOffer.sellableVariantId);
    assert.ok(cleared);
    assert.equal(cleared.potImage, undefined);
    assert.equal(cleared.offerId, potOffer.offerId);

    const wrongColor = await resolveCatalogCartLines([
      line(potOffer, { potColorId: white.id }),
    ]);
    assert.equal(wrongColor.length, 0);

    const mixedLines = await resolveCatalogCartLines([
      line(mediumOffer),
      line(potOffer, { potColorId: black.id }),
      line(smallOffer, { plantSizeId: small.id }),
    ]);
    assert.equal(mixedLines.length, 2);
    assert.equal(mixedLines[0]?.potColorId, null);
    assert.equal(mixedLines[1]?.potColorId, black.id);

    const historyAfter = await sql`
      SELECT count(*)::int AS n FROM inventory_history WHERE variant_id = ${medium.id}::uuid
    `;
    assert.equal(
      Number((historyAfter as { n: string | number }[])[0]?.n),
      Number((historyBefore as { n: string | number }[])[0]?.n),
    );
    assert.equal(await getInventoryQuantity(medium.id), qtyBefore);

    const current = await getPlantByIdAsync(testPlantId);
    assert.ok(current);
    await updatePlant(testPlantId, { ...current, catalogPublished: false });
    const afterUnpublish = await resolveCatalogCartLines([line(mediumOffer)]);
    assert.equal(afterUnpublish.length, 0);
  } finally {
    await cleanup();
  }

  console.log("verify-catalog-cart: ok");
}

main().catch((error) => {
  console.error("verify-catalog-cart FAILED", error);
  process.exit(1);
});

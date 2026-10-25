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
  assert.match(cartLib, /plantId \+ plantVariantId \+ potVariantId|catalogCartItemKey/);
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
  assert.match(detailUi, /current === id \? null/);
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
      cart.parseCatalogCart('{"v":1,"items":[{"plantId":"p","plantVariantId":"v","potVariantId":null,"quantity":1.5}]}'),
      cart.EMPTY_CATALOG_CART,
    );
    assert.deepEqual(
      cart.parseCatalogCart('{"v":1,"items":[{"plantId":"","plantVariantId":"v","potVariantId":null,"quantity":1}]}'),
      cart.EMPTY_CATALOG_CART,
    );

    const parsed = cart.parseCatalogCart(
      JSON.stringify({
        v: 1,
        items: [
          { plantId: "p1", plantVariantId: "v1", potVariantId: null, quantity: 2 },
          { plantId: "p1", plantVariantId: "v1", potVariantId: null, quantity: 1 },
        ],
      }),
    );
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0]?.quantity, 3);

    const withPot = {
      plantId: "p1",
      plantVariantId: "v1",
      potVariantId: "pot-a",
    };
    const noPot = { plantId: "p1", plantVariantId: "v1", potVariantId: null };
    const otherSize = { plantId: "p1", plantVariantId: "v2", potVariantId: null };
    assert.notEqual(cart.catalogCartItemKey(withPot), cart.catalogCartItemKey(noPot));
    assert.notEqual(cart.catalogCartItemKey(noPot), cart.catalogCartItemKey(otherSize));

    let next = cart.addCatalogCartItem(cart.EMPTY_CATALOG_CART, noPot, 2);
    assert.equal(next.added, true);
    assert.equal(next.cart.items[0]?.quantity, 1);
    next = cart.addCatalogCartItem(next.cart, noPot, 2);
    assert.equal(next.added, true);
    assert.equal(next.cart.items[0]?.quantity, 2);
    next = cart.addCatalogCartItem(next.cart, noPot, 2);
    assert.equal(next.added, false);
    assert.equal(next.cart.items[0]?.quantity, 2);

    const mixed = cart.addCatalogCartItem(next.cart, withPot, 2);
    assert.equal(mixed.added, true);
    assert.equal(mixed.cart.items.length, 2);
    assert.equal(cart.catalogCartTotalQuantity(mixed.cart), 3);
    assert.equal(cart.catalogCartTotalQuantity(cart.EMPTY_CATALOG_CART), 0);

    const bumped = cart.updateCatalogCartQuantity(mixed.cart, noPot, 1, 2);
    assert.equal(
      bumped.items.find((item) => item.potVariantId == null)?.quantity,
      1,
    );
    const blocked = cart.updateCatalogCartQuantity(bumped, noPot, 9, 2);
    assert.equal(
      blocked.items.find((item) => item.potVariantId == null)?.quantity,
      2,
    );
    const removed = cart.removeCatalogCartItem(blocked, withPot);
    assert.equal(removed.items.length, 1);
    assert.equal(removed.items[0]?.potVariantId, null);

    const request = cart.parseCatalogCartRequestItems({
      items: [{ plantId: "p1", plantVariantId: "v1", potVariantId: null, quantity: 1 }],
    });
    assert.equal(request?.length, 1);
    assert.equal(cart.parseCatalogCartRequestItems({ items: "nope" }), null);

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
  const { resolveCatalogCartLines } = await import("../lib/catalogShop");
  const { createPot } = await import("../lib/potStorage");

  async function seedLegacyPotVariant(input: {
    potId: string;
    sizeLabel: string;
    color: string;
    colorHe?: string | null;
    catalogPrice: number;
  }): Promise<{ id: string }> {
    const rows = await sql`
      INSERT INTO pot_variants (pot_id, size_label, color, color_he, catalog_price)
      VALUES (
        ${input.potId}::uuid,
        ${input.sizeLabel},
        ${input.color},
        ${input.colorHe ?? null},
        ${input.catalogPrice}
      )
      RETURNING id
    `;
    const row = (rows as { id: string }[])[0];
    assert.ok(row);
    return row;
  }

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
  const potIds: string[] = [];
  const attemptIds: string[] = [];

  async function cleanup(): Promise<void> {
    if (attemptIds.length > 0) {
      await sql`DELETE FROM payment_attempts WHERE id = ANY(${attemptIds}::uuid[])`;
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

    const clay = await createPot({ name: `${tag} clay`, nameHe: "חימר" });
    potIds.push(clay.id);
    const white = await seedLegacyPotVariant({
      potId: clay.id,
      sizeLabel: "S",
      color: "White",
      colorHe: "לבן",
      catalogPrice: 25,
    });
    const black = await seedLegacyPotVariant({
      potId: clay.id,
      sizeLabel: "M",
      color: "Black",
      catalogPrice: 35,
    });

    const unpublished = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: null, quantity: 1 },
    ]);
    assert.equal(unpublished.length, 0);

    await updatePlant(testPlantId, { ...createdPlant, catalogPublished: true });

    const historyBefore = await sql`
      SELECT count(*)::int AS n FROM inventory_history WHERE variant_id = ${medium.id}::uuid
    `;
    const qtyBefore = await getInventoryQuantity(medium.id);

    const clamped = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: null, quantity: 5 },
    ]);
    assert.equal(clamped.length, 1);
    assert.equal(clamped[0]?.quantity, 2);
    assert.equal(clamped[0]?.availableQuantity, 2);
    assert.equal(clamped[0]?.plantPrice, 90);

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
        attempt_id, plant_variant_id, quantity, status, expires_at
      ) VALUES (
        ${holdAttemptId}::uuid,
        ${medium.id}::uuid,
        1,
        'active',
        now() + interval '17 minutes'
      )
    `;
    const held = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: null, quantity: 5 },
    ]);
    assert.equal(held.length, 1);
    assert.equal(held[0]?.quantity, 1);
    assert.equal(held[0]?.availableQuantity, 1);
    assert.equal(await getInventoryQuantity(medium.id), qtyBefore);

    await sql`
      UPDATE catalog_stock_holds
      SET expires_at = now() - interval '1 minute', updated_at = now()
      WHERE attempt_id = ${holdAttemptId}::uuid
    `;
    const expiredHold = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: null, quantity: 5 },
    ]);
    assert.equal(expiredHold[0]?.availableQuantity, 2);
    await sql`DELETE FROM payment_attempts WHERE id = ${holdAttemptId}::uuid`;
    attemptIds.pop();
    assert.equal(clamped[0]?.potVariantId, null);
    assert.equal(clamped[0]?.name, tag);

    const oos = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: small.id, potVariantId: null, quantity: 1 },
    ]);
    assert.equal(oos.length, 0);

    const missingPrice = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: unpriced.id, potVariantId: null, quantity: 1 },
    ]);
    assert.equal(missingPrice.length, 0);

    const missingVariant = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: randomUUID(), potVariantId: null, quantity: 1 },
    ]);
    assert.equal(missingVariant.length, 0);

    const withPot = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: black.id, quantity: 1 },
    ]);
    assert.equal(withPot.length, 1);
    assert.equal(withPot[0]?.potVariantId, black.id);
    assert.equal(withPot[0]?.potPrice, 35);
    assert.equal(withPot[0]?.potColor, "Black");

    const incompatiblePot = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: white.id, quantity: 1 },
    ]);
    assert.equal(incompatiblePot.length, 0);

    const missingPot = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: randomUUID(), quantity: 1 },
    ]);
    assert.equal(missingPot.length, 0);

    const mixedLines = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: null, quantity: 1 },
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: black.id, quantity: 1 },
      { plantId: testPlantId, plantVariantId: small.id, potVariantId: null, quantity: 1 },
    ]);
    assert.equal(mixedLines.length, 2);
    assert.equal(mixedLines[0]?.potVariantId, null);
    assert.equal(mixedLines[1]?.potVariantId, black.id);

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
    const afterUnpublish = await resolveCatalogCartLines([
      { plantId: testPlantId, plantVariantId: medium.id, potVariantId: null, quantity: 1 },
    ]);
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

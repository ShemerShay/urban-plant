/**
 * Slice A: POS occupancy contract.
 * Does not decrement central inventory. Does not add Placement Cycle/Segment.
 *
 * Run: npx tsx scripts/verify-pos-occupancy-contract.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertNoInventoryWrites(): void {
  const occupancy = read("lib/posOccupancy.ts");
  assert.doesNotMatch(occupancy, /inventoryStorage/);
  assert.doesNotMatch(occupancy, /applyInventoryDelta/);
  assert.doesNotMatch(occupancy, /inventory_history/);
  assert.match(occupancy, /plantVariantId/);
  assert.match(occupancy, /Place is not allowed on an occupied POS/);

  const pos = read("lib/posSpotStorage.ts");
  assert.doesNotMatch(pos, /applyInventoryDelta/);
  assert.match(pos, /plant_variant_id/);

  const pocket = read("lib/pocketStorage.ts");
  assert.doesNotMatch(pocket, /applyInventoryDelta/);
  assert.match(pocket, /plant_variant_id = NULL/);
  assert.doesNotMatch(pocket, /status = 'inactive'/);

  const payment = read("lib/paymentAttemptStorage.ts");
  assert.match(payment, /plant_variant_id = NULL/);
  assert.match(payment, /inventory_type <> 'flowers'/);

  const orders = read("lib/ordersStorage.ts");
  assert.match(orders, /plant_variant_id = NULL/);

  const prep = read("lib/startCardcomPaymentPrep.ts");
  assert.match(prep, /posAllowsNewCustomerPurchase/);
  assert.doesNotMatch(prep, /applyInventoryDelta/);

  console.log("verify-pos-occupancy-contract: no central inventory writes; sale clears occupancy");
}

function assertPartnerCountsExcludeEmpty(): void {
  const summary = read("lib/partnerPlantSummary.ts");
  assert.match(summary, /if \(!spot\.currentOfferId\) return false/);
  console.log("verify-pos-occupancy-contract: empty POS excluded from plant counts");
}

function assertEmptyPosCheckoutLanding(): void {
  const occupancy = read("lib/posOccupancy.ts");
  assert.match(occupancy, /export function isEmptyPosOccupancy/);
  assert.match(occupancy, /spot\.status === "sold"/);

  const checkout = read("app/checkout/pos/[spotSlug]/page.tsx");
  assert.match(checkout, /if \(!resolved\) notFound\(\)/);
  assert.match(checkout, /isEmptyPosOccupancy\(posSpot\)/);
  assert.match(checkout, /if \(!offer \|\| offer\.status !== "active"\) notFound\(\)/);
  assert.match(checkout, /if \(!plant\) notFound\(\)/);
  assert.match(checkout, /checkout\.empty\.title/);
  assert.match(checkout, /data-pos-empty="true"/);
  assert.match(checkout, /CheckoutForm/);
  assert.match(checkout, /startCardcomPaymentPrep/);
  assert.match(checkout, /FlowerPosScanRedirect/);

  const emptyBranch = checkout.slice(
    checkout.indexOf("if (isEmptyPosOccupancy(posSpot))"),
    checkout.indexOf("if (!offer || offer.status !== \"active\") notFound()"),
  );
  assert.match(emptyBranch, /checkout\.empty\.title/);
  assert.doesNotMatch(emptyBranch, /CheckoutForm/);
  assert.doesNotMatch(emptyBranch, /startCardcomPaymentPrep/);
  assert.doesNotMatch(emptyBranch, /TrackCheckoutStarted/);
  assert.doesNotMatch(emptyBranch, /notFound\(\)/);

  const unknownSlugGate = checkout.slice(0, checkout.indexOf("isEmptyPosOccupancy(posSpot)"));
  assert.match(unknownSlugGate, /if \(!resolved\) notFound\(\)/);

  const notFoundPage = read("app/not-found.tsx");
  assert.match(notFoundPage, /notFound\.title/);

  console.log("verify-pos-occupancy-contract: empty POS QR landing is narrow; unknown slug still 404s");
}

async function fetchLocalPath(
  path: string,
): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:3000${path}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  assertNoInventoryWrites();
  assertPartnerCountsExcludeEmpty();
  assertEmptyPosCheckoutLanding();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const { sql } = await import("../lib/db");
  const { appendPosSpot, getPosSpotById, updatePosSpot, acquirePosSpotHoldForPayment, completePosSpotSaleFromHold, releasePosSpotHoldForPayment } =
    await import("../lib/posSpotStorage");
  const { createPocket, deletePocket } = await import("../lib/pocketStorage");
  const {
    occupancyToSpotFields,
    PosOccupancyError,
    isEmptyPosOccupancy,
    posAllowsNewCustomerPurchase,
    resolveOccupancyForPosCreate,
    resolveOccupancyForPosPatch,
  } = await import("../lib/posOccupancy");
  const { getPosSpotForCustomerPurchase } = await import("../lib/purchaseEligibility");
  const { startCardcomPaymentPrep } = await import("../lib/startCardcomPaymentPrep");
  const { insertPaymentAttempt, deletePaymentAttemptById } = await import(
    "../lib/paymentAttemptStorage"
  );
  const { getInventoryQuantity } = await import("../lib/inventoryStorage");

  const cols = await sql`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pos_spots'
      AND column_name IN ('plant_variant_id', 'current_offer_id')
  `;
  const byName = Object.fromEntries(
    (cols as { column_name: string; is_nullable: string; data_type: string }[]).map((row) => [
      row.column_name,
      row,
    ]),
  );
  assert.equal(byName.plant_variant_id?.data_type, "uuid");
  assert.equal(byName.plant_variant_id?.is_nullable, "YES");
  assert.equal(byName.current_offer_id?.is_nullable, "YES");

  const check = await sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'pos_spots'::regclass
      AND conname = 'pos_spots_occupancy_offer_when_variant'
  `;
  assert.match(
    (check as { def: string }[])[0]?.def ?? "",
    /plant_variant_id IS NULL.*current_offer_id IS NOT NULL/,
  );

  const partners = await sql`SELECT id FROM partner_locations LIMIT 1`;
  const partnerLocationId = (partners as { id: string }[])[0]?.id;
  assert.ok(partnerLocationId, "need a partner location");

  const plants = await sql`
    SELECT id, inventory_type
    FROM plants
    ORDER BY created_at ASC NULLS LAST, id ASC
  `;
  const plantRows = plants as { id: string; inventory_type: string }[];
  const plant = plantRows.find((row) => (row.inventory_type ?? "plants") === "plants");
  const flower = plantRows.find((row) => row.inventory_type === "flowers");
  assert.ok(plant, "need a plant catalog row");
  assert.ok(flower, "need a flower catalog row");

  const tag = `occ-a-${randomUUID().slice(0, 8)}`;
  const variantA = randomUUID();
  const variantB = randomUUID();
  const offerA = `occ-offer-a-${tag}`;
  const offerB = `occ-offer-b-${tag}`;
  const offerFlower = `occ-offer-f-${tag}`;
  const offerLegacy = `occ-offer-l-${tag}`;
  const slugPlant = `occ-plant-${tag}`;
  const slugFlower = `occ-flower-${tag}`;
  const slugLegacy = `occ-legacy-${tag}`;
  const attemptIds: string[] = [];
  let pocketId: string | undefined;
  let plantSpotId: string | undefined;
  let flowerSpotId: string | undefined;
  let legacySpotId: string | undefined;

  async function applyPatch(
    id: string,
    existing: NonNullable<Awaited<ReturnType<typeof getPosSpotById>>>,
    input: Omit<Parameters<typeof resolveOccupancyForPosPatch>[0], "existing">,
  ) {
    const occupancy = await resolveOccupancyForPosPatch({ ...input, existing });
    const updated = await updatePosSpot(id, {
      partnerLocationId: existing.partnerLocationId,
      posNumber: existing.posNumber ?? "1",
      posName: existing.posName,
      ...occupancyToSpotFields(occupancy),
    });
    assert.ok(updated);
    return { occupancy, updated };
  }

  try {
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label)
      VALUES
        (${variantA}::uuid, ${plant.id}, ${`${tag}-small`}),
        (${variantB}::uuid, ${plant.id}, ${`${tag}-large`})
    `;
    await sql`
      INSERT INTO offers (id, product_id, variant_id, consumer_price, status, created_at)
      VALUES
        (${offerA}, ${plant.id}, ${variantA}::uuid, 40, 'active', now()),
        (${offerB}, ${plant.id}, ${variantB}::uuid, 55, 'active', now()),
        (${offerFlower}, ${flower.id}, NULL, 25, 'active', now()),
        (${offerLegacy}, ${plant.id}, NULL, 33, 'active', now())
    `;

    const occupancyHistoryBefore = await sql`
      SELECT COUNT(*)::int AS n FROM inventory_history
    `;
    const historyBefore = (occupancyHistoryBefore as { n: number }[])[0].n;
    const qtyABefore = await getInventoryQuantity(variantA);

    const pocket = await createPocket({
      partnerLocationId,
      name: `${tag}-pocket`,
    });
    pocketId = pocket.id;
    const pocketB = await createPocket({
      partnerLocationId,
      name: `${tag}-pocket-b`,
    });

    const createPlant = await resolveOccupancyForPosCreate({
      offerId: offerA,
      plantVariantId: variantA,
    });
    assert.equal(createPlant.action, "place");
    const plantSpot = await appendPosSpot({
      id: randomUUID(),
      spotName: slugPlant,
      partnerLocationId,
      posNumber: "91",
      posName: slugPlant,
      spotSlug: slugPlant,
      currentOfferId: offerA,
      plantVariantId: variantA,
      status: "available",
      checkStatus: false,
      offerPlacedAt: createPlant.offerPlacedAt ?? new Date().toISOString(),
      createdAt: new Date().toISOString(),
      pocketId: pocket.id,
    });
    plantSpotId = plantSpot.id;

    const createFlower = await resolveOccupancyForPosCreate({ offerId: offerFlower });
    assert.equal(createFlower.plantVariantId, null);
    const flowerSpot = await appendPosSpot({
      id: randomUUID(),
      spotName: slugFlower,
      partnerLocationId,
      posNumber: "92",
      posName: slugFlower,
      spotSlug: slugFlower,
      currentOfferId: offerFlower,
      status: "available",
      checkStatus: false,
      offerPlacedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    flowerSpotId = flowerSpot.id;

    const legacySpot = await appendPosSpot({
      id: randomUUID(),
      spotName: slugLegacy,
      partnerLocationId,
      posNumber: "93",
      posName: slugLegacy,
      spotSlug: slugLegacy,
      currentOfferId: offerLegacy,
      status: "available",
      checkStatus: false,
      offerPlacedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    legacySpotId = legacySpot.id;

    // 1. Legacy variant assign without Replace.
    let legacy = await getPosSpotById(legacySpot.id);
    assert.ok(legacy);
    assert.equal(legacy.plantVariantId, undefined);
    const assigned = await applyPatch(legacy.id, legacy, {
      occupancyIntent: "assign_variant",
      requestedVariantId: variantA,
      requestedOfferId: offerLegacy,
    });
    assert.equal(assigned.occupancy.action, "assign_variant");
    assert.equal(assigned.updated.plantVariantId, variantA);
    assert.equal(assigned.updated.currentOfferId, offerLegacy);
    assert.equal(assigned.updated.offerPlacedAt, legacy.offerPlacedAt);

    // Reset legacy to offer-only for later checkout-compat check.
    await sql`
      UPDATE pos_spots SET plant_variant_id = NULL WHERE id = ${legacy.id}::uuid
    `;
    legacy = await getPosSpotById(legacy.id);
    assert.ok(legacy);
    assert.equal(legacy.plantVariantId, undefined);
    assert.equal(posAllowsNewCustomerPurchase(legacy), true);

    // 2-3. Place works; Place on occupied is rejected.
    const placed = await getPosSpotById(plantSpot.id);
    assert.ok(placed?.plantVariantId);
    await assert.rejects(
      () =>
        applyPatch(placed.id, placed, {
          occupancyIntent: "place",
          requestedVariantId: variantB,
          requestedOfferId: offerB,
        }),
      (err: unknown) => err instanceof PosOccupancyError,
    );

    // 4. Pocket move keeps occupancy.
    const beforeMove = await getPosSpotById(plantSpot.id);
    assert.ok(beforeMove);
    const moved = await updatePosSpot(plantSpot.id, {
      partnerLocationId,
      posNumber: beforeMove.posNumber ?? "91",
      posName: beforeMove.posName,
      updatePocketId: true,
      pocketId: pocketB.id,
      currentOfferId: beforeMove.currentOfferId,
      plantVariantId: beforeMove.plantVariantId,
    });
    assert.equal(moved?.plantVariantId, variantA);
    assert.equal(moved?.currentOfferId, offerA);
    assert.equal(moved?.offerPlacedAt, beforeMove.offerPlacedAt);
    assert.equal(moved?.pocketId, pocketB.id);

    // 5. Same-variant offer update keeps occupancy (use another offer of variant A).
    await sql`
      UPDATE offers SET variant_id = ${variantA}::uuid WHERE id = ${offerB}
    `;
    const sameVariantOffer = await applyPatch(plantSpot.id, (await getPosSpotById(plantSpot.id))!, {
      requestedOfferId: offerB,
      requestedVariantId: variantA,
    });
    assert.equal(sameVariantOffer.occupancy.action, "update");
    assert.equal(sameVariantOffer.updated.plantVariantId, variantA);
    assert.equal(sameVariantOffer.updated.currentOfferId, offerB);
    assert.equal(sameVariantOffer.updated.offerPlacedAt, moved?.offerPlacedAt);

    // 6. Variant change uses Replace.
    await sql`
      UPDATE offers SET variant_id = ${variantB}::uuid WHERE id = ${offerB}
    `;
    const replaced = await applyPatch(plantSpot.id, (await getPosSpotById(plantSpot.id))!, {
      requestedOfferId: offerB,
      requestedVariantId: variantB,
    });
    assert.equal(replaced.occupancy.action, "replace");
    assert.equal(replaced.updated.plantVariantId, variantB);
    assert.notEqual(replaced.updated.offerPlacedAt, sameVariantOffer.updated.offerPlacedAt);

    // 7. Same-variant physical replacement via explicit intent.
    const sameUnitReplace = await applyPatch(plantSpot.id, replaced.updated, {
      occupancyIntent: "replace",
      requestedVariantId: variantB,
      requestedOfferId: offerB,
      sameVariantReplace: true,
    });
    assert.equal(sameUnitReplace.occupancy.action, "replace");
    assert.equal(sameUnitReplace.updated.plantVariantId, variantB);
    assert.notEqual(sameUnitReplace.updated.offerPlacedAt, replaced.updated.offerPlacedAt);

    // 8. Remove clears occupancy, keeps POS/QR.
    const removed = await applyPatch(plantSpot.id, sameUnitReplace.updated, {
      occupancyIntent: "remove",
    });
    assert.equal(removed.occupancy.action, "remove");
    assert.equal(removed.updated.plantVariantId, undefined);
    assert.equal(removed.updated.currentOfferId, undefined);
    assert.equal(removed.updated.id, plantSpot.id);
    assert.ok(removed.updated.spotSlug);
    assert.equal(posAllowsNewCustomerPurchase(removed.updated), false);
    assert.equal(isEmptyPosOccupancy(removed.updated), true);

    const emptyResolved = await getPosSpotForCustomerPurchase(removed.updated.spotSlug);
    assert.ok(emptyResolved);
    assert.equal(emptyResolved.posSpot.id, plantSpot.id);
    assert.equal(emptyResolved.purchaseEnabled, false);

    const unknownResolved = await getPosSpotForCustomerPurchase(
      `missing-empty-pos-qr-${randomUUID()}`,
    );
    assert.equal(unknownResolved, undefined);

    const emptyPrep = await startCardcomPaymentPrep(
      {
        plantId: plant.id,
        spotSlug: removed.updated.spotSlug,
        fullName: "Empty Pos Verify",
        customerEmail: "empty-pos-verify@example.com",
        phone: "0546605603",
        fulfillmentMethod: "pickup",
      },
      {
        createLowProfile: async () => {
          throw new Error("Cardcom must not be called for empty POS");
        },
      },
    );
    assert.equal(emptyPrep.ok, false);
    if (!emptyPrep.ok) {
      assert.equal(emptyPrep.code, "unavailable");
    }

    const emptyPage = await fetchLocalPath(`/checkout/pos/${removed.updated.spotSlug}`);
    const unknownPage = await fetchLocalPath(
      `/checkout/pos/missing-empty-pos-qr-${randomUUID()}`,
    );
    const unrelated404 = await fetchLocalPath(`/this-route-does-not-exist-${randomUUID()}`);
    if (emptyPage && unknownPage && unrelated404) {
      assert.equal(emptyPage.status, 200);
      assert.match(emptyPage.body, /data-pos-empty="true"/);
      assert.match(emptyPage.body, /This spot is empty|הנקודה הזו ריקה/);
      assert.doesNotMatch(emptyPage.body, /id="checkout-form"/);
      assert.doesNotMatch(emptyPage.body, /Complete Order|השלמת הזמנה/);
      assert.doesNotMatch(unknownPage.body, /data-pos-empty="true"/);
      assert.doesNotMatch(unknownPage.body, /This spot is empty|הנקודה הזו ריקה/);
      assert.equal(unrelated404.status, 404);
      assert.doesNotMatch(unrelated404.body, /data-pos-empty="true"/);
      console.log("verify-pos-occupancy-contract: empty POS HTTP 200; unknown/unrelated still not empty landing");
    } else {
      console.log("verify-pos-occupancy-contract: skip HTTP landing checks (no local server)");
    }

    const emptyHold = await acquirePosSpotHoldForPayment(plantSpot.id, randomUUID());
    assert.equal(emptyHold.ok, false);

    // Place again after Remove.
    const placedAgain = await applyPatch(plantSpot.id, removed.updated, {
      occupancyIntent: "place",
      requestedVariantId: variantA,
      requestedOfferId: offerA,
    });
    assert.equal(placedAgain.occupancy.action, "place");
    assert.equal(placedAgain.updated.status, "available");
    assert.equal(placedAgain.updated.plantVariantId, variantA);

    // 9-10. Deactivate with plant assigned; no inventory change.
    const deactivated = await updatePosSpot(plantSpot.id, {
      partnerLocationId,
      posNumber: placedAgain.updated.posNumber ?? "91",
      posName: placedAgain.updated.posName,
      currentOfferId: placedAgain.updated.currentOfferId,
      plantVariantId: placedAgain.updated.plantVariantId,
      updateStatus: true,
      status: "inactive",
    });
    assert.equal(deactivated?.status, "inactive");
    assert.equal(deactivated?.plantVariantId, variantA);
    assert.equal(deactivated?.currentOfferId, offerA);

    const deactivatedEmpty = await applyPatch(plantSpot.id, deactivated!, {
      occupancyIntent: "remove",
    });
    const deactivatedBare = await updatePosSpot(plantSpot.id, {
      partnerLocationId,
      posNumber: deactivatedEmpty.updated.posNumber ?? "91",
      posName: deactivatedEmpty.updated.posName,
      updateStatus: true,
      status: "inactive",
    });
    assert.equal(deactivatedBare?.status, "inactive");
    assert.equal(deactivatedBare?.plantVariantId, undefined);

    const qtyAAfterAdmin = await getInventoryQuantity(variantA);
    assert.equal(qtyAAfterAdmin, qtyABefore);

    // Restore occupancy for sale test.
    await applyPatch(plantSpot.id, (await getPosSpotById(plantSpot.id))!, {
      occupancyIntent: "place",
      requestedVariantId: variantA,
      requestedOfferId: offerA,
    });
    await updatePosSpot(plantSpot.id, {
      partnerLocationId,
      posNumber: "91",
      posName: slugPlant,
      updateStatus: true,
      status: "available",
    });

    // 11-12. Plant sale ends occupancy, keeps offer; duplicate finalize is idempotent.
    const saleAttempt = randomUUID();
    const now = new Date().toISOString();
    await insertPaymentAttempt({
      id: saleAttempt,
      status: "created",
      posSpotId: plantSpot.id,
      productId: plant.id,
      productName: "Occupancy Verify Plant",
      fullName: "Occ Verify",
      customerEmail: "occ-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      amount: 40,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    attemptIds.push(saleAttempt);
    const held = await acquirePosSpotHoldForPayment(plantSpot.id, saleAttempt);
    assert.equal(held.ok, true);
    const sold = await completePosSpotSaleFromHold(plantSpot.id, saleAttempt);
    assert.equal(sold.ok, true);
    if (sold.ok) {
      assert.equal(sold.posSpot.status, "sold");
      assert.equal(sold.posSpot.currentOfferId, offerA);
      assert.equal(sold.posSpot.plantVariantId, undefined);
      assert.equal(sold.posSpot.id, plantSpot.id);
      assert.equal(isEmptyPosOccupancy(sold.posSpot), false);
      assert.equal(posAllowsNewCustomerPurchase(sold.posSpot), false);
      const soldPage = await fetchLocalPath(`/checkout/pos/${sold.posSpot.spotSlug}`);
      if (soldPage) {
        assert.equal(soldPage.status, 200);
        assert.doesNotMatch(soldPage.body, /data-pos-empty="true"/);
        assert.doesNotMatch(soldPage.body, /This spot is empty|הנקודה הזו ריקה/);
      }
    }
    const soldAgain = await completePosSpotSaleFromHold(plantSpot.id, saleAttempt);
    assert.equal(soldAgain.ok, false);

    // Hold/release does not change occupancy: set back to available occupied, then hold+release.
    await sql`
      UPDATE pos_spots
      SET status = 'available', plant_variant_id = ${variantA}::uuid, current_offer_id = ${offerA}
      WHERE id = ${plantSpot.id}::uuid
    `;
    const releaseAttempt = randomUUID();
    await insertPaymentAttempt({
      id: releaseAttempt,
      status: "created",
      posSpotId: plantSpot.id,
      productId: plant.id,
      productName: "Occupancy Verify Plant",
      fullName: "Occ Verify",
      customerEmail: "occ-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      amount: 40,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    attemptIds.push(releaseAttempt);
    const holdOcc = await acquirePosSpotHoldForPayment(plantSpot.id, releaseAttempt);
    assert.equal(holdOcc.ok, true);
    if (holdOcc.ok) {
      assert.equal(holdOcc.posSpot.plantVariantId, variantA);
    }
    const released = await releasePosSpotHoldForPayment(plantSpot.id, releaseAttempt);
    assert.equal(released.ok, true);
    if (released.ok) {
      assert.equal(released.posSpot.plantVariantId, variantA);
      assert.equal(released.posSpot.status, "available");
    }

    // 14. Flowers unchanged: no variant, sale no-op, still purchasable.
    const flowerRow = await getPosSpotById(flowerSpot.id);
    assert.ok(flowerRow);
    assert.equal(flowerRow.plantVariantId, undefined);
    assert.equal(flowerRow.currentOfferId, offerFlower);
    assert.equal(posAllowsNewCustomerPurchase(flowerRow), true);
    assert.equal(isEmptyPosOccupancy(flowerRow), false);
    const flowerAttempt = randomUUID();
    await insertPaymentAttempt({
      id: flowerAttempt,
      status: "created",
      posSpotId: flowerSpot.id,
      productId: flower.id,
      productName: "Occupancy Verify Flower",
      fullName: "Occ Verify",
      customerEmail: "occ-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "pickup",
      amount: 25,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    attemptIds.push(flowerAttempt);
    const flowerSale = await completePosSpotSaleFromHold(flowerSpot.id, flowerAttempt);
    assert.equal(flowerSale.ok, false);
    const flowerAfter = await getPosSpotById(flowerSpot.id);
    assert.equal(flowerAfter?.status, "available");
    assert.equal(flowerAfter?.currentOfferId, offerFlower);
    assert.equal(flowerAfter?.plantVariantId, undefined);

    await assert.rejects(
      () => resolveOccupancyForPosCreate({ offerId: offerFlower, plantVariantId: variantA }),
      (err: unknown) => err instanceof PosOccupancyError,
    );

    // 15. Pocket deletion removes remaining plant occupancy and keeps POS.
    await sql`
      UPDATE pos_spots
      SET pocket_id = ${pocket.id}::uuid, plant_variant_id = ${variantA}::uuid, current_offer_id = ${offerA}, status = 'available'
      WHERE id = ${plantSpot.id}::uuid
    `;
    await sql`
      UPDATE pos_spots SET pocket_id = ${pocket.id}::uuid WHERE id = ${flowerSpot.id}::uuid
    `;
    const deleted = await deletePocket(pocket.id);
    assert.equal(deleted.deleted, true);
    pocketId = undefined;
    const afterPocket = await getPosSpotById(plantSpot.id);
    assert.ok(afterPocket);
    assert.equal(afterPocket.pocketId, undefined);
    assert.equal(afterPocket.plantVariantId, undefined);
    assert.equal(afterPocket.currentOfferId, undefined);
    assert.equal(afterPocket.id, plantSpot.id);
    const flowerAfterPocket = await getPosSpotById(flowerSpot.id);
    assert.equal(flowerAfterPocket?.pocketId, undefined);
    assert.equal(flowerAfterPocket?.currentOfferId, offerFlower);
    assert.equal(flowerAfterPocket?.id, flowerSpot.id);

    await deletePocket(pocketB.id);

    const historyAfter = await sql`SELECT COUNT(*)::int AS n FROM inventory_history`;
    assert.equal((historyAfter as { n: number }[])[0].n, historyBefore);
    const qtyAFinal = await getInventoryQuantity(variantA);
    assert.equal(qtyAFinal, qtyABefore);

    console.log("verify-pos-occupancy-contract: occupancy, sale, pocket, flowers, inventory ok");
  } finally {
    for (const attemptId of attemptIds) {
      try {
        await deletePaymentAttemptById(attemptId);
      } catch {
        // best-effort
      }
    }
    const spotIds = [plantSpotId, flowerSpotId, legacySpotId].filter(Boolean) as string[];
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
    if (pocketId) {
      try {
        await deletePocket(pocketId);
      } catch {
        // already deleted
      }
    }
    await sql`DELETE FROM pockets WHERE name LIKE ${`${tag}-pocket%`}`;
    await sql`DELETE FROM offers WHERE id = ${offerA} OR id = ${offerB} OR id = ${offerFlower} OR id = ${offerLegacy}`;
    await sql`
      DELETE FROM placement_segments
      WHERE placement_cycle_id IN (
        SELECT id FROM placement_cycles
        WHERE plant_variant_id IN (${variantA}::uuid, ${variantB}::uuid)
      )
    `;
    await sql`DELETE FROM placement_cycles WHERE plant_variant_id IN (${variantA}::uuid, ${variantB}::uuid)`;
    await sql`DELETE FROM plant_variants WHERE id IN (${variantA}::uuid, ${variantB}::uuid)`;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

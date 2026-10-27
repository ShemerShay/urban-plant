/**
 * Slice 6: Partner/POS Offer cutover.
 * Run: npx tsx scripts/verify-pos-offer-cutover.ts
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { createPosCutoverFixture } from "./pos-offer-cutover-fixture.ts";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertSources(): void {
  const migration = read("db/migrations/050_pos_offer_cutover.sql");
  assert.match(migration, /pos_spots[\s\S]*pot_color_id/);
  assert.match(migration, /placement_segments[\s\S]*sellable_variant_id/);
  assert.match(migration, /placement_segments[\s\S]*pot_color_id/);
  assert.doesNotMatch(migration, /ALTER TABLE placement_cycles/);
  assert.doesNotMatch(migration, /DROP COLUMN.*variant_id/);
  assert.doesNotMatch(migration, /INSERT INTO offers/);
  assert.doesNotMatch(migration, /INSERT INTO pot_colors/);

  const offerTypes = read("lib/offerTypes.ts");
  assert.match(offerTypes, /isPlantPosEligibleOffer/);
  assert.match(offerTypes, /offerAvailableAtPartnerLocation/);
  assert.doesNotMatch(offerTypes, /variantId\?:/);

  const occupancy = read("lib/posOccupancy.ts");
  assert.match(occupancy, /isPlantPosEligibleOffer/);
  assert.match(occupancy, /introducesNewPotColor/);
  const inventorySource = read("lib/inventorySource.ts");
  assert.match(inventorySource, /selectablePosPotColors/);
  assert.doesNotMatch(occupancy, /assign_variant/);
  assert.doesNotMatch(occupancy, /offer\.variantId/);

  const storage = read("lib/offerStorage.ts");
  assert.doesNotMatch(storage, /variantId:/);
  assert.doesNotMatch(storage, /o\.variant_id/);

  const admin = read("components/admin/AdminPartnerDetail.tsx");
  assert.match(admin, /derivedPlantSize/);
  assert.match(admin, /potColorId/);
  assert.doesNotMatch(admin, /setPlantVariantId/);
  assert.doesNotMatch(admin, /variantId/);

  const checkout = read("app/checkout/pos/[spotSlug]/page.tsx");
  assert.match(checkout, /placement\.plantSizeLabel/);
  assert.match(checkout, /placement\.potColor/);
  assert.doesNotMatch(checkout, /supplierPrice|supplier_price|supplierCost/);

  assert.equal(existsSync(join(root, "components/admin/AdminPosSpotEditForm.tsx")), false);
  assert.equal(existsSync(join(root, "components/admin/AdminQrGenerator.tsx")), false);
  assert.equal(existsSync(join(root, "components/admin/AdminPosSpotList.tsx")), false);

  const catalogShop = read("lib/catalogShop.ts");
  assert.match(catalogShop, /sellable_variant_id/);
  const flowersCheckout = read("app/checkout/pos/[spotSlug]/page.tsx");
  assert.match(flowersCheckout, /FlowerPosScanRedirect/);

  console.log("verify-pos-offer-cutover: sources ok");
}

async function main(): Promise<void> {
  assertSources();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (host.includes("twilight-truth")) {
    throw new Error("Refusing to verify against production");
  }

  const { sql } = await import("../lib/db");
  const { isPlantPosEligibleOffer, offerAvailableAtPartnerLocation } = await import(
    "../lib/offerTypes"
  );
  const { getOfferById, readOffers, updateOffer } = await import("../lib/offerStorage");
  const {
    adminSaveNeedsInventorySource,
    selectablePosPotColors,
  } = await import("../lib/inventorySource");
  const {
    occupancyToSpotFields,
    PosOccupancyError,
    resolveOccupancyForPosCreate,
    resolveOccupancyForPosPatch,
  } = await import("../lib/posOccupancy");
  const { appendPosSpot, getPosSpotById } = await import("../lib/posSpotStorage");
  const { writePosCreate, writePosUpdate } = await import("../lib/posCentralStock");
  const { applyInventoryDelta, getInventoryQuantity } = await import("../lib/inventoryStorage");
  const { applyPotInventoryDelta, getPotInventoryQuantity } = await import(
    "../lib/potInventoryStorage"
  );
  const { getPosLandingDetails } = await import("../lib/posLandingRead");

  const cols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'pos_spots' AND column_name = 'pot_color_id')
        OR (table_name = 'placement_segments' AND column_name IN ('sellable_variant_id', 'pot_color_id'))
        OR (table_name = 'offers' AND column_name = 'variant_id')
      )
  `;
  const names = new Set((cols as { column_name: string }[]).map((row) => row.column_name));
  assert.equal(names.has("pot_color_id"), true);
  assert.equal(names.has("sellable_variant_id"), true);
  assert.equal(names.has("variant_id"), false);

  const cycleCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'placement_cycles'
      AND column_name IN ('sellable_variant_id', 'pot_color_id', 'pot_size_id')
  `;
  assert.equal((cycleCols as { column_name: string }[]).length, 0);

  const locations = await sql`SELECT id FROM partner_locations ORDER BY id ASC LIMIT 2`;
  const locationRows = locations as { id: string }[];
  const partnerLocationId = locationRows[0]?.id;
  const secondLocationId = locationRows[1]?.id;
  assert.ok(partnerLocationId, "need a partner location");

  const flowers = await sql`
    SELECT id FROM plants WHERE inventory_type = 'flowers' ORDER BY id ASC LIMIT 1
  `;
  const flowerPlantId = (flowers as { id: string }[])[0]?.id;
  assert.ok(flowerPlantId, "need a flower catalog row");

  const tag = `s6-${randomUUID().slice(0, 8)}`;
  const fixture = await createPosCutoverFixture({
    sql,
    tag,
    partnerLocationId,
    secondLocationId,
    flowerPlantId,
  });
  const spotIds: string[] = [];

  function emptySpot(slug: string, posNumber: string) {
    return {
      id: randomUUID(),
      spotName: slug,
      partnerLocationId,
      posNumber,
      posName: slug,
      spotSlug: slug,
      status: "available" as const,
      checkStatus: false as const,
      createdAt: new Date().toISOString(),
    };
  }

  async function patch(
    existing: NonNullable<Awaited<ReturnType<typeof getPosSpotById>>>,
    input: Omit<Parameters<typeof resolveOccupancyForPosPatch>[0], "existing" | "partnerLocationId">,
    source: unknown = "already_at_partner",
  ) {
    const occupancy = await resolveOccupancyForPosPatch({
      ...input,
      existing,
      partnerLocationId,
    });
    const updated = await writePosUpdate({
      occupancyAction: occupancy.action,
      inventorySource: source,
      introducesNewPotColor: occupancy.introducesNewPotColor,
      id: existing.id,
      existing,
      variantId: occupancy.plantVariantId,
      potColorId: occupancy.potColorId,
      patch: {
        partnerLocationId,
        posNumber: existing.posNumber ?? "1",
        posName: existing.posName,
        ...occupancyToSpotFields(occupancy),
      },
    });
    assert.ok(updated);
    return { occupancy, updated };
  }

  async function cycles(spotId: string) {
    return (await sql`
      SELECT id, ended_at, end_reason
      FROM placement_cycles
      WHERE pos_spot_id = ${spotId}::uuid
      ORDER BY started_at ASC, id ASC
    `) as { id: string; ended_at: string | null; end_reason: string | null }[];
  }

  async function openSegments(spotId: string) {
    return (await sql`
      SELECT s.offer_id, s.sellable_variant_id, s.pot_color_id, s.pocket_id, s.consumer_price
      FROM placement_segments s
      INNER JOIN placement_cycles c ON c.id = s.placement_cycle_id
      WHERE c.pos_spot_id = ${spotId}::uuid AND s.ended_at IS NULL
    `) as {
      offer_id: string | null;
      sellable_variant_id: string | null;
      pot_color_id: string | null;
      pocket_id: string | null;
      consumer_price: string | number | null;
    }[];
  }

  try {
    const offerS = await getOfferById(fixture.offerS);
    assert.ok(offerS);
    assert.equal("variantId" in offerS, false);
    assert.equal(isPlantPosEligibleOffer(offerS, partnerLocationId), true);
    if (secondLocationId) {
      assert.equal(offerAvailableAtPartnerLocation(offerS, secondLocationId), true);
      assert.equal(isPlantPosEligibleOffer(offerS, secondLocationId), true);
    }
    const live = await readOffers();
    assert.ok(live.every((offer) => !("variantId" in offer)));

    const elsewhere = await sql`
      SELECT id FROM partner_locations
      WHERE id <> ${partnerLocationId}
        AND (${secondLocationId ?? ""} = '' OR id <> ${secondLocationId ?? partnerLocationId})
      LIMIT 1
    `;
    const otherId = (elsewhere as { id: string }[])[0]?.id;
    if (otherId) {
      assert.equal(isPlantPosEligibleOffer(offerS, otherId), false);
    }

    const legacy = await getOfferById(fixture.offerLegacy);
    assert.ok(legacy);
    assert.equal(legacy.sellableVariantId, null);
    assert.equal(isPlantPosEligibleOffer(legacy, partnerLocationId), false);
    await assert.rejects(
      () =>
        resolveOccupancyForPosCreate({
          offerId: fixture.offerLegacy,
          partnerLocationId,
        }),
      (err: unknown) => err instanceof PosOccupancyError,
    );

    const derived = await resolveOccupancyForPosCreate({
      offerId: fixture.offerS,
      partnerLocationId,
    });
    assert.equal(derived.action, "place");
    assert.equal(derived.plantVariantId, fixture.variantS);
    assert.equal(derived.potColorId, null);

    await assert.rejects(
      () =>
        resolveOccupancyForPosCreate({
          offerId: fixture.offerPot,
          partnerLocationId,
        }),
      (err: unknown) =>
        err instanceof PosOccupancyError && /Pot Color/.test((err as Error).message),
    );

    await applyInventoryDelta({ variantId: fixture.variantS, delta: 5, note: `${tag} plant S` });
    await applyInventoryDelta({ variantId: fixture.variantL, delta: 3, note: `${tag} plant L` });
    await applyPotInventoryDelta({
      potId: fixture.potId,
      sizeId: fixture.potSizeId,
      potColorId: fixture.colorA,
      delta: 4,
      note: `${tag} color A`,
    });
    await applyPotInventoryDelta({
      potId: fixture.potId,
      sizeId: fixture.potSizeId,
      potColorId: fixture.colorB,
      delta: 3,
      note: `${tag} color B`,
    });

    const createPotPlace = await resolveOccupancyForPosCreate({
      offerId: fixture.offerPot,
      partnerLocationId,
      potColorId: fixture.colorA,
    });
    const centralSpot = {
      ...emptySpot(`s6-central-${tag}`, "61"),
      currentOfferId: createPotPlace.currentOfferId ?? fixture.offerPot,
      plantVariantId: createPotPlace.plantVariantId ?? fixture.variantS,
      potColorId: createPotPlace.potColorId ?? fixture.colorA,
      offerPlacedAt: createPotPlace.offerPlacedAt ?? new Date().toISOString(),
    };
    spotIds.push(centralSpot.id);
    const placedCentral = await writePosCreate({
      occupancyAction: createPotPlace.action,
      inventorySource: "central",
      posSpot: centralSpot,
      variantId: createPotPlace.plantVariantId,
      potColorId: createPotPlace.potColorId,
    });
    assert.equal(placedCentral.plantVariantId, fixture.variantS);
    assert.equal(placedCentral.potColorId, fixture.colorA);
    assert.equal(await getInventoryQuantity(fixture.variantS), 4);
    assert.equal(await getPotInventoryQuantity(fixture.colorA), 3);
    assert.equal(await getPotInventoryQuantity(fixture.colorB), 3);

    const atpCreate = await resolveOccupancyForPosCreate({
      offerId: fixture.offerPot,
      partnerLocationId,
      potColorId: fixture.colorA,
    });
    const atpSpot = {
      ...emptySpot(`s6-atp-${tag}`, "62"),
      currentOfferId: atpCreate.currentOfferId ?? fixture.offerPot,
      plantVariantId: atpCreate.plantVariantId ?? fixture.variantS,
      potColorId: atpCreate.potColorId ?? fixture.colorA,
      offerPlacedAt: atpCreate.offerPlacedAt ?? new Date().toISOString(),
    };
    spotIds.push(atpSpot.id);
    await writePosCreate({
      occupancyAction: atpCreate.action,
      inventorySource: "already_at_partner",
      posSpot: atpSpot,
      variantId: atpCreate.plantVariantId,
      potColorId: atpCreate.potColorId,
    });
    assert.equal(await getInventoryQuantity(fixture.variantS), 4);
    assert.equal(await getPotInventoryQuantity(fixture.colorA), 3);

    const plantBeforeSameOffer = await getInventoryQuantity(fixture.variantS);
    const colorBeforeSameOffer = await getPotInventoryQuantity(fixture.colorA);
    const sameColorUpdate = await patch(
      (await getPosSpotById(centralSpot.id))!,
      {
        occupancyIntent: "update",
        requestedOfferId: fixture.offerPot,
        requestedPotColorId: fixture.colorA,
      },
      "central",
    );
    assert.equal(sameColorUpdate.occupancy.action, "update");
    assert.equal(sameColorUpdate.occupancy.introducesNewPotColor, false);
    assert.equal(await getInventoryQuantity(fixture.variantS), plantBeforeSameOffer);
    assert.equal(await getPotInventoryQuantity(fixture.colorA), colorBeforeSameOffer);

    const colorUpdate = await patch(
      (await getPosSpotById(centralSpot.id))!,
      {
        occupancyIntent: "update",
        requestedOfferId: fixture.offerPot,
        requestedPotColorId: fixture.colorB,
      },
      "central",
    );
    assert.equal(colorUpdate.occupancy.introducesNewPotColor, true);
    assert.equal(colorUpdate.updated.potColorId, fixture.colorB);
    assert.equal(await getInventoryQuantity(fixture.variantS), plantBeforeSameOffer);
    assert.equal(await getPotInventoryQuantity(fixture.colorA), colorBeforeSameOffer);
    assert.equal(await getPotInventoryQuantity(fixture.colorB), 2);

    const atpColorBefore = await getPotInventoryQuantity(fixture.colorB);
    const atpPlantBefore = await getInventoryQuantity(fixture.variantS);
    const atpColorUpdate = await patch((await getPosSpotById(atpSpot.id))!, {
      occupancyIntent: "update",
      requestedOfferId: fixture.offerPot,
      requestedPotColorId: fixture.colorB,
    });
    assert.equal(atpColorUpdate.occupancy.introducesNewPotColor, true);
    assert.equal(await getPotInventoryQuantity(fixture.colorB), atpColorBefore);
    assert.equal(await getInventoryQuantity(fixture.variantS), atpPlantBefore);

    const removePot = await patch((await getPosSpotById(centralSpot.id))!, {
      occupancyIntent: "update",
      requestedOfferId: fixture.offerS,
    });
    assert.equal(removePot.updated.plantVariantId, fixture.variantS);
    assert.equal(removePot.updated.potColorId, undefined);
    assert.equal(await getInventoryQuantity(fixture.variantS), plantBeforeSameOffer);
    assert.equal(await getPotInventoryQuantity(fixture.colorB), 2);

    const occupiedForSize = await getPosSpotById(centralSpot.id);
    assert.ok(occupiedForSize);
    await assert.rejects(
      () =>
        resolveOccupancyForPosPatch({
          existing: occupiedForSize,
          partnerLocationId,
          occupancyIntent: "update",
          requestedOfferId: fixture.offerL,
        }),
      (err: unknown) =>
        err instanceof PosOccupancyError && /Replace/.test((err as Error).message),
    );

    const plantBeforeReplace = await getInventoryQuantity(fixture.variantL);
    const colorBeforeReplace = await getPotInventoryQuantity(fixture.colorA);
    const replaced = await patch(
      (await getPosSpotById(centralSpot.id))!,
      {
        occupancyIntent: "replace",
        requestedOfferId: fixture.offerPot,
        requestedPotColorId: fixture.colorA,
      },
      "central",
    );
    assert.equal(replaced.occupancy.action, "replace");
    assert.equal(replaced.updated.plantVariantId, fixture.variantS);
    assert.equal(replaced.updated.potColorId, fixture.colorA);
    assert.equal(await getInventoryQuantity(fixture.variantS), plantBeforeSameOffer - 1);
    assert.equal(await getInventoryQuantity(fixture.variantL), plantBeforeReplace);
    assert.equal(await getPotInventoryQuantity(fixture.colorA), colorBeforeReplace - 1);

    const cycleRows = await cycles(centralSpot.id);
    assert.ok(cycleRows.length >= 2);
    assert.equal(cycleRows[cycleRows.length - 2]?.end_reason, "replaced");
    assert.equal(cycleRows[cycleRows.length - 1]?.ended_at, null);

    const beforeRemoveCycles = await cycles(atpSpot.id);
    const openBeforeRemove = beforeRemoveCycles.filter((row) => !row.ended_at);
    assert.equal(openBeforeRemove.length, 1);
    const removed = await patch((await getPosSpotById(atpSpot.id))!, { occupancyIntent: "remove" });
    assert.equal(removed.updated.plantVariantId, undefined);
    assert.equal(removed.updated.potColorId, undefined);
    assert.equal(removed.updated.currentOfferId, undefined);
    const afterRemoveCycles = await cycles(atpSpot.id);
    assert.equal(
      afterRemoveCycles.filter((row) => row.end_reason === "removed").length,
      1,
    );
    assert.equal(afterRemoveCycles.filter((row) => !row.ended_at).length, 0);
    assert.equal((await openSegments(atpSpot.id)).length, 0);

    const emptyForPlace = await appendPosSpot(emptySpot(`s6-react-${tag}`, "63"));
    spotIds.push(emptyForPlace.id);
    const placedForDeact = await patch(emptyForPlace, {
      occupancyIntent: "place",
      requestedOfferId: fixture.offerS,
    });
    const deactivated = await writePosUpdate({
      occupancyAction: "deactivate",
      inventorySource: undefined,
      id: placedForDeact.updated.id,
      existing: placedForDeact.updated,
      variantId: placedForDeact.updated.plantVariantId,
      patch: {
        partnerLocationId,
        posNumber: placedForDeact.updated.posNumber ?? "63",
        posName: placedForDeact.updated.posName,
        updateStatus: true,
        status: "inactive",
        occupancyAction: "deactivate",
      },
    });
    assert.equal(deactivated?.status, "inactive");
    assert.equal(deactivated?.plantVariantId, fixture.variantS);
    const deactCycles = await cycles(emptyForPlace.id);
    assert.equal(deactCycles.filter((row) => row.end_reason === "deactivated").length, 1);
    const reactivated = await writePosUpdate({
      occupancyAction: "update",
      inventorySource: undefined,
      id: emptyForPlace.id,
      existing: deactivated!,
      variantId: deactivated!.plantVariantId,
      patch: {
        partnerLocationId,
        posNumber: deactivated!.posNumber ?? "63",
        posName: deactivated!.posName,
        updateStatus: true,
        status: "available",
      },
    });
    assert.equal(reactivated?.status, "available");
    assert.equal(reactivated?.plantVariantId, fixture.variantS);
    assert.equal(reactivated?.currentOfferId, fixture.offerS);
    const reactCycles = await cycles(emptyForPlace.id);
    assert.equal(reactCycles.filter((row) => !row.ended_at).length, 1);

    const salePlantBefore = await getInventoryQuantity(fixture.variantS);
    const saleColorBefore = await getPotInventoryQuantity(fixture.colorA);
    const { completePosSpotSaleFromHold, acquirePosSpotHoldForPayment } = await import(
      "../lib/posSpotStorage"
    );
    const { insertPaymentAttempt, deletePaymentAttemptById } = await import(
      "../lib/paymentAttemptStorage"
    );
    const saleAttempt = randomUUID();
    const now = new Date().toISOString();
    await insertPaymentAttempt({
      id: saleAttempt,
      status: "created",
      posSpotId: centralSpot.id,
      productId: fixture.plantId,
      productName: "Slice 6 sale",
      fullName: "S6",
      customerEmail: "s6@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "pickup",
      amount: 88,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    const held = await acquirePosSpotHoldForPayment(centralSpot.id, saleAttempt);
    assert.equal(held.ok, true);
    const sold = await completePosSpotSaleFromHold(centralSpot.id, saleAttempt);
    assert.equal(sold.ok, true);
    if (sold.ok) {
      assert.equal(sold.posSpot.status, "sold");
      assert.equal(sold.posSpot.currentOfferId, fixture.offerPot);
      assert.equal(sold.posSpot.plantVariantId, undefined);
      assert.equal(sold.posSpot.potColorId, undefined);
    }
    assert.equal(await getInventoryQuantity(fixture.variantS), salePlantBefore);
    assert.equal(await getPotInventoryQuantity(fixture.colorA), saleColorBefore);
    await deletePaymentAttemptById(saleAttempt);

    const splitSpot = await appendPosSpot(emptySpot(`s6-seg-${tag}`, "64"));
    spotIds.push(splitSpot.id);
    await patch(splitSpot, {
      occupancyIntent: "place",
      requestedOfferId: fixture.offerS,
    });
    const cyclesBeforeSplit = await cycles(splitSpot.id);
    assert.equal(cyclesBeforeSplit.filter((row) => !row.ended_at).length, 1);
    await patch((await getPosSpotById(splitSpot.id))!, {
      occupancyIntent: "update",
      requestedOfferId: fixture.offerS2,
    });
    assert.equal((await cycles(splitSpot.id)).filter((row) => !row.ended_at).length, 1);
    const segs = await openSegments(splitSpot.id);
    assert.equal(segs.length, 1);
    assert.equal(segs[0]?.offer_id, fixture.offerS2);
    assert.equal(segs[0]?.sellable_variant_id, fixture.sellableS);

    const addPot = await patch((await getPosSpotById(splitSpot.id))!, {
      occupancyIntent: "update",
      requestedOfferId: fixture.offerPot,
      requestedPotColorId: fixture.colorA,
    });
    assert.equal(addPot.updated.potColorId, fixture.colorA);
    assert.equal((await cycles(splitSpot.id)).filter((row) => !row.ended_at).length, 1);
    const colorSeg = await openSegments(splitSpot.id);
    assert.equal(colorSeg[0]?.pot_color_id, fixture.colorA);
    assert.equal(colorSeg[0]?.sellable_variant_id, fixture.sellableSPot);

    const occupiedLanding = await getPosLandingDetails((await getPosSpotById(splitSpot.id))!);
    assert.equal(occupiedLanding.placement.plantSizeLabel, "S");
    assert.ok(occupiedLanding.placement.potColor);
    assert.ok(occupiedLanding.placement.potSizeLabel);
    assert.equal(occupiedLanding.offer?.consumerPrice, 88);

    const keepColorSpot = await appendPosSpot(emptySpot(`s6-keep-color-${tag}`, "66"));
    spotIds.push(keepColorSpot.id);
    await patch(keepColorSpot, {
      occupancyIntent: "place",
      requestedOfferId: fixture.offerPot,
      requestedPotColorId: fixture.colorA,
    });
    const colorAQty = await getPotInventoryQuantity(fixture.colorA);
    if (colorAQty > 0) {
      await applyPotInventoryDelta({
        potId: fixture.potId,
        sizeId: fixture.potSizeId,
        potColorId: fixture.colorA,
        delta: -colorAQty,
        note: `${tag} drain A`,
      });
    }
    assert.equal(await getPotInventoryQuantity(fixture.colorA), 0);
    const selectableKept = selectablePosPotColors(
      [
        { id: fixture.colorA, quantity: 0 },
        { id: fixture.colorB, quantity: 1 },
      ],
      { inventorySource: "central", occupiedColorId: fixture.colorA },
    );
    assert.equal(selectableKept.some((color) => color.id === fixture.colorA), true);
    const plantBeforeKeep = await getInventoryQuantity(fixture.variantS);
    const colorBeforeKeep = await getPotInventoryQuantity(fixture.colorA);
    const cyclesBeforeKeep = await cycles(keepColorSpot.id);
    assert.equal(cyclesBeforeKeep.filter((row) => !row.ended_at).length, 1);
    const keepColor = await patch((await getPosSpotById(keepColorSpot.id))!, {
      occupancyIntent: "update",
      requestedOfferId: fixture.offerPot2,
      requestedPotColorId: fixture.colorA,
    });
    assert.equal(keepColor.occupancy.action, "update");
    assert.equal(keepColor.occupancy.introducesNewPotColor, false);
    assert.equal(keepColor.updated.potColorId, fixture.colorA);
    assert.equal(keepColor.updated.currentOfferId, fixture.offerPot2);
    assert.equal(await getInventoryQuantity(fixture.variantS), plantBeforeKeep);
    assert.equal(await getPotInventoryQuantity(fixture.colorA), colorBeforeKeep);
    assert.equal((await cycles(keepColorSpot.id)).filter((row) => !row.ended_at).length, 1);
    assert.equal((await cycles(keepColorSpot.id))[0]?.id, cyclesBeforeKeep[0]?.id);
    assert.equal(
      adminSaveNeedsInventorySource({
        selectedIsPlant: true,
        creating: false,
        occupiedVariantId: fixture.variantS,
        selectedVariantId: fixture.variantS,
        sameVariantReplace: false,
        existingOfferIsFlower: false,
        introducesNewPotColor: false,
      }),
      false,
    );

    const segsBeforePrice = await openSegments(keepColorSpot.id);
    assert.equal(segsBeforePrice[0]?.pot_color_id, fixture.colorA);
    assert.equal(segsBeforePrice[0]?.sellable_variant_id, fixture.sellableSPot);
    const segmentCountBeforePrice = (
      (await sql`
        SELECT COUNT(*)::int AS n
        FROM placement_segments s
        INNER JOIN placement_cycles c ON c.id = s.placement_cycle_id
        WHERE c.pos_spot_id = ${keepColorSpot.id}::uuid
      `) as { n: number }[]
    )[0].n;
    await updateOffer(fixture.offerPot2, { consumerPrice: 93 });
    const segsAfterPrice = await sql`
      SELECT s.offer_id, s.sellable_variant_id, s.pot_color_id, s.consumer_price, s.ended_at,
             s.placement_cycle_id
      FROM placement_segments s
      INNER JOIN placement_cycles c ON c.id = s.placement_cycle_id
      WHERE c.pos_spot_id = ${keepColorSpot.id}::uuid
      ORDER BY s.started_at ASC, s.id ASC
    ` as {
      offer_id: string;
      sellable_variant_id: string | null;
      pot_color_id: string | null;
      consumer_price: string | number;
      ended_at: string | Date | null;
      placement_cycle_id: string;
    }[];
    assert.equal(segsAfterPrice.length, segmentCountBeforePrice + 1);
    const closedPrice = segsAfterPrice.filter((row) => row.ended_at != null);
    const openPrice = segsAfterPrice.filter((row) => row.ended_at == null);
    assert.equal(openPrice.length, 1);
    assert.equal(Number(openPrice[0]?.consumer_price), 93);
    assert.equal(openPrice[0]?.sellable_variant_id, fixture.sellableSPot);
    assert.equal(openPrice[0]?.pot_color_id, fixture.colorA);
    assert.equal(openPrice[0]?.offer_id, fixture.offerPot2);
    assert.ok(closedPrice.every((row) => row.placement_cycle_id === openPrice[0]?.placement_cycle_id));
    assert.equal((await cycles(keepColorSpot.id)).filter((row) => !row.ended_at).length, 1);
    assert.equal(await getInventoryQuantity(fixture.variantS), plantBeforeKeep);
    assert.equal(await getPotInventoryQuantity(fixture.colorA), 0);

    const legacySpot = await appendPosSpot({
      ...emptySpot(`s6-legacy-${tag}`, "65"),
      currentOfferId: fixture.offerLegacy,
    });
    spotIds.push(legacySpot.id);
    const legacyLanding = await getPosLandingDetails(legacySpot);
    assert.equal(legacyLanding.placement.plantSizeLabel, null);
    assert.equal(legacyLanding.placement.potColor, null);
    assert.equal(legacyLanding.offer?.id, fixture.offerLegacy);
    assert.equal(legacyLanding.offer?.sellableVariantId, null);

    console.log("verify-pos-offer-cutover: eligibility, occupancy, inventory, cycle, segment, landing ok");
  } finally {
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
    await fixture.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Placement History Snapshots & Analytics Backend Verifier.
 *
 * Run: npx tsx scripts/verify-placement-history-snapshots.ts
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
  const migration = read("db/migrations/060_placement_history_snapshots.sql");
  assert.match(migration, /ALTER TABLE placement_cycles/);
  assert.match(migration, /placement_kind IN \('initial', 'restock'\)/);
  assert.match(migration, /ALTER TABLE placement_segments/);
  assert.match(migration, /total_supplier_unit_cost/);
  assert.match(migration, /plants\.supplier_price@cycle/);
  assert.match(migration, /pots\.supplier_price@segment/);
  assert.match(migration, /incomplete/i);
  assert.doesNotMatch(migration, /plants\.supplier_price@segment/);
  assert.doesNotMatch(migration, /ALTER TABLE pos_spots/);
  assert.doesNotMatch(migration, /INSERT INTO events/i);

  const cycleSrc = read("lib/placementCycle.ts");
  assert.match(cycleSrc, /same physical plant/);
  assert.match(cycleSrc, /pause_segment/);
  assert.match(cycleSrc, /resume_segment/);
  assert.doesNotMatch(cycleSrc, /kind: "close", reason: "deactivated"/);

  const segmentSrc = read("lib/placementSegment.ts");
  assert.match(segmentSrc, /prev_plant_unit_cost/);
  assert.match(segmentSrc, /is_new_cycle/);
  assert.match(segmentSrc, /paused_segments/);
  assert.match(segmentSrc, /resume_targets/);
  assert.match(segmentSrc, /plants\.supplier_price@cycle/);
  assert.match(segmentSrc, /plant_variants\.supplier_price@cycle/);

  const offerSrc = read("lib/offerStorage.ts");
  assert.match(offerSrc, /cs\.plant_unit_cost/);
  assert.match(offerSrc, /cs\.pot_unit_cost/);
  assert.doesNotMatch(offerSrc, /plants\.supplier_price@/);

  const posSrc = read("lib/posSpotStorage.ts");
  assert.match(posSrc, /PosSpotPartnerLocationImmutableError/);
  assert.doesNotMatch(posSrc, /partner_location_id = \$\{patch\.partnerLocationId/);

  const analytics = read("lib/analytics/placementAnalytics.ts");
  assert.match(analytics, /server-only/);
  assert.match(analytics, /placement_cycles\.order_id|c\.order_id/);
  assert.match(analytics, /attributeScansToSegments/);
  assert.match(analytics, /ANALYTICS_EVENTS\.posScan/);
  assert.doesNotMatch(analytics, /FROM\s+events\b[\s\S]*sql`/);
  assert.doesNotMatch(analytics, /INSERT INTO/i);
  assert.doesNotMatch(analytics, /JOIN\s+pos_spots\b/i);
  assert.doesNotMatch(analytics, /JOIN\s+pockets\b/i);
  assert.doesNotMatch(analytics, /JOIN\s+plants\b/i);
  assert.doesNotMatch(analytics, /JOIN\s+pots\b/i);

  console.log("verify-placement-history: static contracts ok");
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
  const { attributeScansToSegments, loadPlacementAnalytics } = await import(
    "../lib/analytics/placementAnalytics"
  );
  const { appendPosSpot, getPosSpotById, updatePosSpot, PosSpotPartnerLocationImmutableError } =
    await import("../lib/posSpotStorage");
  const {
    occupancyToSpotFields,
    resolveOccupancyForPosPatch,
  } = await import("../lib/posOccupancy");
  const { writePosUpdate } = await import("../lib/posCentralStock");
  const { applyInventoryDelta, getInventoryQuantity } = await import("../lib/inventoryStorage");
  const { applyPotInventoryDelta, getPotInventoryQuantity } = await import(
    "../lib/potInventoryStorage"
  );
  const { createPocket, updatePocket } = await import("../lib/pocketStorage");
  const { getOfferById, updateOffer, createOrReusePlantOffer } = await import("../lib/offerStorage");
  const { createPartner, updatePartner } = await import("../lib/partnerStorage");
  const { createPartnerLocation, updatePartnerLocation } = await import(
    "../lib/partnerLocationStorage"
  );
  const { getPlantByIdAsync, updatePlant } = await import("../lib/plantStorage");
  const { updatePlantVariant } = await import("../lib/plantVariantStorage");
  const { createPot, deletePot, updatePot } = await import("../lib/potStorage");
  const { createSellableVariant } = await import("../lib/sellableVariantStorage");
  const { deletePaymentAttemptById, finalizeVerifiedPaymentAttemptAtomic, insertPaymentAttempt } =
    await import("../lib/paymentAttemptStorage");
  const { createPosCutoverFixture } = await import("./pos-offer-cutover-fixture.ts");

  const cols = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('placement_cycles', 'placement_segments')
  `;
  const byTable = new Map<string, Set<string>>();
  for (const row of cols as { table_name: string; column_name: string }[]) {
    const s = byTable.get(row.table_name) ?? new Set<string>();
    s.add(row.column_name);
    byTable.set(row.table_name, s);
  }
  for (const col of [
    "partner_id",
    "partner_name",
    "partner_location_id",
    "partner_location_name",
    "plant_id",
    "plant_name",
    "size_label",
    "placement_kind",
  ]) {
    assert.equal(byTable.get("placement_cycles")?.has(col), true, `missing cycle col ${col}`);
  }
  for (const col of [
    "pot_name",
    "plant_unit_cost",
    "plant_unit_cost_source",
    "pot_unit_cost",
    "pot_unit_cost_source",
    "total_supplier_unit_cost",
  ]) {
    assert.equal(byTable.get("placement_segments")?.has(col), true, `missing segment col ${col}`);
  }

  const flowers = await sql`
    SELECT id FROM plants WHERE inventory_type = 'flowers' ORDER BY id ASC LIMIT 1
  `;
  const flowerPlantId = (flowers as { id: string }[])[0]?.id;
  assert.ok(flowerPlantId, "need a flower plant row");

  const tag = `ph-${randomUUID().slice(0, 8)}`;
  const partnerId = `partner-${tag}`;
  const locationId = `loc-${tag}`;
  const otherLocationId = `loc2-${tag}`;
  const initialPartnerName = `Partner Original ${tag}`;
  const initialLocationName = `Location Original ${tag}`;

  const createdSpotIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAttemptIds: string[] = [];
  const createdPocketIds: string[] = [];
  let extraPotId: string | null = null;
  let extraSellableId: string | null = null;
  let extraOfferId: string | null = null;

  await createPartner({ id: partnerId, name: initialPartnerName });
  await createPartnerLocation({
    id: locationId,
    partnerId,
    name: initialLocationName,
    address: "1 Test St",
    type: "cafe",
    partnerType: "cafe",
    payments: [],
    pickupDisabled: false,
    monthlyRevenue: 0,
    setupCost: 0,
    notes: "",
  });
  await createPartnerLocation({
    id: otherLocationId,
    partnerId,
    name: `Location Other ${tag}`,
    address: "2 Test St",
    type: "cafe",
    partnerType: "cafe",
    payments: [],
    pickupDisabled: false,
    monthlyRevenue: 0,
    setupCost: 0,
    notes: "",
  });
  await sql`
    UPDATE partner_commission_tiers
    SET commission_rate = 15
    WHERE partner_id = ${partnerId}
  `;

  const fixture = await createPosCutoverFixture({
    sql,
    tag,
    partnerLocationId: locationId,
    flowerPlantId,
  });

  try {
    async function setSizeSupplierPrices(price: number): Promise<void> {
      await updatePlantVariant({
        plantId: fixture.plantId,
        variantId: fixture.variantS,
        supplierPrice: price,
      });
      await updatePlantVariant({
        plantId: fixture.plantId,
        variantId: fixture.variantL,
        supplierPrice: price,
      });
    }

    const pocketA = await createPocket({ partnerLocationId: locationId, name: `${tag}-PocketA` });
    const pocketB = await createPocket({ partnerLocationId: locationId, name: `${tag}-PocketB` });
    createdPocketIds.push(pocketA.id, pocketB.id);

    // Seed central stock for initial + replacement + pot checks
    await applyInventoryDelta({ variantId: fixture.variantS, delta: 2, note: `${tag} seed S` });
    await applyInventoryDelta({ variantId: fixture.variantL, delta: 1, note: `${tag} seed L` });
    await applyPotInventoryDelta({ potId: fixture.potId, delta: 2, note: `${tag} seed potA` });

    const eventsBefore = (
      await sql`SELECT count(*)::int AS n FROM events WHERE partner_location_id = ${locationId}`
    )[0] as { n: number };

    const spotSlug = `ph-spot-${tag}`;
    const spot = await appendPosSpot({
      id: randomUUID(),
      spotName: spotSlug,
      partnerLocationId: locationId,
      posNumber: "1",
      pocketId: pocketA.id,
      posName: spotSlug,
      spotSlug,
      status: "available",
      checkStatus: false,
      createdAt: new Date().toISOString(),
    });
    createdSpotIds.push(spot.id);

    // 1. Initial placement from central_stock
    const sQty0 = await getInventoryQuantity(fixture.variantS);
    const placeOcc = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(spot.id))!,
      partnerLocationId: locationId,
      occupancyIntent: "place",
      requestedOfferId: fixture.offerS,
    });
    await writePosUpdate({
      occupancyAction: placeOcc.action,
      inventorySource: "central",
      introducesNewPot: placeOcc.introducesNewPotColor,
      id: spot.id,
      existing: (await getPosSpotById(spot.id))!,
      variantId: placeOcc.plantVariantId,
      potId: placeOcc.potId,
      patch: {
        partnerLocationId: locationId,
        posNumber: "1",
        posName: spotSlug,
        ...occupancyToSpotFields(placeOcc),
      },
    });
    assert.equal(await getInventoryQuantity(fixture.variantS), sQty0 - 1);

    let cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(cycles.length, 1);
    const cycle1Id = String(cycles[0].id);
    assert.equal(cycles[0].partner_id, partnerId);
    assert.equal(cycles[0].partner_name, initialPartnerName);
    assert.equal(cycles[0].partner_location_id, locationId);
    assert.equal(cycles[0].partner_location_name, initialLocationName);
    assert.equal(cycles[0].plant_id, fixture.plantId);
    assert.equal(cycles[0].plant_name, `${tag} plant`);
    assert.equal(cycles[0].size_label, "S");
    assert.equal(cycles[0].placement_kind, "initial");

    let segs = (await sql`
      SELECT * FROM placement_segments WHERE placement_cycle_id = ${cycle1Id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(segs.length, 1);
    assert.equal(segs[0].pocket_id, pocketA.id);
    assert.equal(segs[0].pocket_name, `${tag}-PocketA`);
    assert.equal(segs[0].pot_id, null);
    assert.equal(segs[0].pot_name, null);
    assert.equal(Number(segs[0].plant_unit_cost), 40);
    assert.equal(segs[0].plant_unit_cost_source, "plant_variants.supplier_price@cycle");
    assert.equal(segs[0].pot_unit_cost, null);
    assert.equal(segs[0].pot_unit_cost_source, null);
    assert.equal(Number(segs[0].total_supplier_unit_cost), 40);

    // 1b. Live plant cost change must not affect later same-cycle segments
    await setSizeSupplierPrices(77);

    // 2. Pocket move on same physical plant -> same cycle, new segment, inherited plant cost
    await updatePosSpot(spot.id, {
      partnerLocationId: locationId,
      posNumber: "1",
      posName: spotSlug,
      updatePocketId: true,
      pocketId: pocketB.id,
    });
    cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(cycles.length, 1);
    assert.equal(cycles[0].placement_kind, "initial");
    segs = (await sql`
      SELECT * FROM placement_segments WHERE placement_cycle_id = ${cycle1Id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(segs.length, 2);
    assert.notEqual(segs[0].ended_at, null);
    assert.equal(segs[1].ended_at, null);
    assert.equal(segs[1].pocket_id, pocketB.id);
    assert.equal(segs[1].pocket_name, `${tag}-PocketB`);
    assert.equal(Number(segs[1].plant_unit_cost), 40);
    assert.equal(segs[1].plant_unit_cost_source, "plant_variants.supplier_price@cycle");
    assert.equal(segs[1].pot_unit_cost, null);

    // 3. Pot/Offer change on same physical plant (no-pot -> potA cost 12) -> same cycle, new segment with combined cost
    const potQty0 = await getPotInventoryQuantity(fixture.potId);
    const potOcc = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(spot.id))!,
      partnerLocationId: locationId,
      occupancyIntent: "update",
      requestedOfferId: fixture.offerPot,
    });
    await writePosUpdate({
      occupancyAction: potOcc.action,
      inventorySource: "central",
      introducesNewPot: potOcc.introducesNewPotColor,
      id: spot.id,
      existing: (await getPosSpotById(spot.id))!,
      variantId: potOcc.plantVariantId,
      potId: potOcc.potId,
      patch: {
        partnerLocationId: locationId,
        posNumber: "1",
        posName: spotSlug,
        ...occupancyToSpotFields(potOcc),
      },
    });
    assert.equal(await getPotInventoryQuantity(fixture.potId), potQty0 - 1);
    cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(cycles.length, 1);
    segs = (await sql`
      SELECT * FROM placement_segments WHERE placement_cycle_id = ${cycle1Id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(segs.length, 3);
    assert.equal(segs[2].pot_id, fixture.potId);
    assert.equal(segs[2].pot_name, `${tag} pot a`);
    assert.equal(Number(segs[2].plant_unit_cost), 40);
    assert.equal(segs[2].plant_unit_cost_source, "plant_variants.supplier_price@cycle");
    assert.equal(Number(segs[2].pot_unit_cost), 12);
    assert.equal(segs[2].pot_unit_cost_source, "pots.supplier_price@segment");
    assert.equal(Number(segs[2].total_supplier_unit_cost), 52);

    // 3a. Live plant + pot cost changes must not rewrite this Cycle's inherited costs
    await setSizeSupplierPrices(99);
    await updatePot({ potId: fixture.potId, supplierPrice: 88 });

    // 3b. Price change on Offer -> same cycle, new segment; inherit plant + pot costs
    const offerObj = await getOfferById(fixture.offerPot);
    assert.ok(offerObj);
    const nextPrice = Number(offerObj.consumerPrice) + 5;
    await updateOffer(offerObj.id, {
      consumerPrice: nextPrice,
    });
    segs = (await sql`
      SELECT * FROM placement_segments WHERE placement_cycle_id = ${cycle1Id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(segs.length, 4);
    assert.equal(Number(segs[3].consumer_price), nextPrice);
    assert.equal(Number(segs[3].plant_unit_cost), 40);
    assert.equal(segs[3].plant_unit_cost_source, "plant_variants.supplier_price@cycle");
    assert.equal(Number(segs[3].pot_unit_cost), 12);
    assert.equal(segs[3].pot_unit_cost_source, "pots.supplier_price@segment");
    assert.equal(Number(segs[3].total_supplier_unit_cost), 52);

    // 3c. Pot change snapshots the new pot cost and keeps the Cycle plant cost
    const potBQty0 = await getPotInventoryQuantity(fixture.potBId);
    const potBOcc = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(spot.id))!,
      partnerLocationId: locationId,
      occupancyIntent: "update",
      requestedOfferId: fixture.offerPotB,
    });
    await writePosUpdate({
      occupancyAction: potBOcc.action,
      inventorySource: "central",
      introducesNewPot: potBOcc.introducesNewPotColor,
      id: spot.id,
      existing: (await getPosSpotById(spot.id))!,
      variantId: potBOcc.plantVariantId,
      potId: potBOcc.potId,
      patch: {
        partnerLocationId: locationId,
        posNumber: "1",
        posName: spotSlug,
        ...occupancyToSpotFields(potBOcc),
      },
    });
    assert.equal(await getPotInventoryQuantity(fixture.potBId), potBQty0 - 1);
    segs = (await sql`
      SELECT * FROM placement_segments WHERE placement_cycle_id = ${cycle1Id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(segs.length, 5);
    assert.equal(segs[4].pot_id, fixture.potBId);
    assert.equal(Number(segs[4].plant_unit_cost), 40);
    assert.equal(Number(segs[4].pot_unit_cost), 8);
    assert.equal(segs[4].pot_unit_cost_source, "pots.supplier_price@segment");
    assert.equal(Number(segs[4].total_supplier_unit_cost), 48);

    // 3d. Pot without supplier_price -> total_supplier_unit_cost must be NULL (missing is not zero)
    const nullCostPot = await createPot({ name: `${tag} null-cost pot` });
    extraPotId = nullCostPot.id;
    const svNullCost = await createSellableVariant({
      plantId: fixture.plantId,
      plantSizeId: fixture.variantS,
      potId: nullCostPot.id,
    });
    extraSellableId = svNullCost.sellableVariantId;
    const createdNullOffer = await createOrReusePlantOffer({
      sellableVariantId: svNullCost.sellableVariantId,
      consumerPrice: 66,
      status: "active",
      availabilities: [{ scope: "partner_location", partnerLocationId: locationId }],
    });
    extraOfferId = createdNullOffer.offer.id;
    const nullCostOcc = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(spot.id))!,
      partnerLocationId: locationId,
      occupancyIntent: "update",
      requestedOfferId: extraOfferId,
    });
    await writePosUpdate({
      occupancyAction: nullCostOcc.action,
      inventorySource: "already_at_partner",
      introducesNewPot: nullCostOcc.introducesNewPotColor,
      id: spot.id,
      existing: (await getPosSpotById(spot.id))!,
      variantId: nullCostOcc.plantVariantId,
      potId: nullCostOcc.potId,
      patch: {
        partnerLocationId: locationId,
        posNumber: "1",
        posName: spotSlug,
        ...occupancyToSpotFields(nullCostOcc),
      },
    });
    segs = (await sql`
      SELECT * FROM placement_segments WHERE placement_cycle_id = ${cycle1Id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(segs.length, 6);
    assert.equal(segs[5].pot_id, nullCostPot.id);
    assert.equal(segs[5].pot_name, `${tag} null-cost pot`);
    assert.equal(Number(segs[5].plant_unit_cost), 40);
    assert.equal(segs[5].plant_unit_cost_source, "plant_variants.supplier_price@cycle");
    assert.equal(segs[5].pot_unit_cost, null);
    assert.equal(segs[5].pot_unit_cost_source, null);
    assert.equal(segs[5].total_supplier_unit_cost, null);

    // 4. Replacement -> closes cycle1 ('replaced') & opens cycle2 ('restock', size 'L')
    const lQty0 = await getInventoryQuantity(fixture.variantL);
    const repOcc = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(spot.id))!,
      partnerLocationId: locationId,
      occupancyIntent: "replace",
      requestedOfferId: fixture.offerL,
    });
    await writePosUpdate({
      occupancyAction: repOcc.action,
      inventorySource: "central",
      introducesNewPot: repOcc.introducesNewPotColor,
      id: spot.id,
      existing: (await getPosSpotById(spot.id))!,
      variantId: repOcc.plantVariantId,
      potId: repOcc.potId,
      patch: {
        partnerLocationId: locationId,
        posNumber: "1",
        posName: spotSlug,
        ...occupancyToSpotFields(repOcc),
      },
    });
    assert.equal(await getInventoryQuantity(fixture.variantL), lQty0 - 1);

    cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(cycles.length, 2);
    assert.equal(cycles[0].end_reason, "replaced");
    assert.equal(cycles[0].placement_kind, "initial");
    assert.equal(cycles[1].ended_at, null);
    assert.equal(cycles[1].placement_kind, "restock");
    assert.equal(cycles[1].size_label, "L");
    assert.equal(cycles[1].plant_name, `${tag} plant`);
    const cycle2Id = String(cycles[1].id);
    const restockSegs = (await sql`
      SELECT * FROM placement_segments WHERE placement_cycle_id = ${cycle2Id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(restockSegs.length, 1);
    assert.equal(Number(restockSegs[0].plant_unit_cost), 99);
    assert.equal(restockSegs[0].plant_unit_cost_source, "plant_variants.supplier_price@cycle");

    // 5. Sale closes cycle2 with end_reason = 'sold' & links order_id
    const attemptId = randomUUID();
    const saleSession = `cs-${tag}-${randomUUID().slice(0, 6)}`;
    createdAttemptIds.push(attemptId);
    const offerL = await getOfferById(fixture.offerL);
    assert.ok(offerL);
    await insertPaymentAttempt({
      id: attemptId,
      channel: "partner",
      checkoutSessionId: saleSession,
      cardcomEnv: "test",
      status: "awaiting_payment",
      posSpotId: spot.id,
      offerId: offerL.id,
      productId: fixture.plantId,
      productName: `${tag} plant`,
      amount: offerL.consumerPrice,
      fullName: "Test Buyer",
      customerEmail: "buyer@example.com",
      phone: "0500000000",
      address: "1 Test St",
      apartmentOrNotes: "",
      fulfillmentMethod: "pickup",
      paymentResumeToken: `rt-${tag}`,
      snapshot: {
        productId: fixture.plantId,
        productName: `${tag} plant`,
        offerId: offerL.id,
        consumerPrice: offerL.consumerPrice,
        fulfillmentType: "pickup",
        partnerLocationId: locationId,
        partnerLocationName: initialLocationName,
        inventoryType: "plants",
        supplierUnitCost: 40,
        supplierUnitCostSource: "plants.supplier_price@sale",
      },
      isInternal: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const finalized = await finalizeVerifiedPaymentAttemptAtomic({
      attemptId,
      checkoutSessionId: saleSession,
      posSpotId: spot.id,
      fulfillmentMethod: "pickup",
      cardcomTransactionId: 900001,
    });
    assert.equal(finalized.ok, true);
    if (finalized.ok) {
      createdOrderIds.push(finalized.order.orderId);
    }

    cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(cycles[1].end_reason, "sold");
    assert.ok(cycles[1].ended_at);
    assert.equal(cycles[1].order_id, createdOrderIds[0]);

    // 6. Mutate live labels/costs/names -> historical analytics MUST NOT change!
    await updatePartner(partnerId, { name: `MUTATED Partner ${tag}` });
    await updatePartnerLocation(locationId, {
      id: locationId,
      partnerId,
      name: `MUTATED Location ${tag}`,
      address: "99 Changed St",
      type: "cafe",
      partnerType: "cafe",
      payments: [],
      pickupDisabled: false,
      monthlyRevenue: 0,
      setupCost: 0,
      notes: "",
    });
    const livePlant = await getPlantByIdAsync(fixture.plantId);
    assert.ok(livePlant);
    await updatePlant(fixture.plantId, {
      ...livePlant,
      name: `MUTATED Plant ${tag}`,
    });
    await setSizeSupplierPrices(999);
    await updatePot({ potId: fixture.potId, name: `MUTATED Pot ${tag}`, supplierPrice: 888 });
    await updatePocket(pocketA.id, { name: `${tag}-MUTATED-PocketA` });

    // 7. Deactivate + Remove checks on a second spot
    const spot2Slug = `ph-spot2-${tag}`;
    const spot2 = await appendPosSpot({
      id: randomUUID(),
      spotName: spot2Slug,
      partnerLocationId: locationId,
      posNumber: "2",
      pocketId: pocketB.id,
      posName: spot2Slug,
      spotSlug: spot2Slug,
      status: "available",
      checkStatus: false,
      createdAt: new Date().toISOString(),
    });
    createdSpotIds.push(spot2.id);

    const place2 = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(spot2.id))!,
      partnerLocationId: locationId,
      occupancyIntent: "place",
      requestedOfferId: fixture.offerPot,
    });
    await writePosUpdate({
      occupancyAction: place2.action,
      inventorySource: "already_at_partner",
      introducesNewPot: place2.introducesNewPotColor,
      id: spot2.id,
      existing: (await getPosSpotById(spot2.id))!,
      variantId: place2.plantVariantId,
      potId: place2.potId,
      patch: {
        partnerLocationId: locationId,
        posNumber: "2",
        posName: spot2Slug,
        ...occupancyToSpotFields(place2),
      },
    });
    let s2Cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot2.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(s2Cycles.length, 1);
    assert.equal(s2Cycles[0].ended_at, null);
    assert.equal(s2Cycles[0].end_reason, null);
    assert.equal(s2Cycles[0].placement_kind, "initial");
    const spot2CycleId = String(s2Cycles[0].id);
    let s2Segs = (await sql`
      SELECT * FROM placement_segments
      WHERE placement_cycle_id = ${spot2CycleId}::uuid
      ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(s2Segs.length, 1);
    const spot2PlantCost = Number(s2Segs[0].plant_unit_cost);
    const spot2PotCost = Number(s2Segs[0].pot_unit_cost);
    assert.equal(spot2PlantCost, 999);
    assert.equal(spot2PotCost, 888);
    await setSizeSupplierPrices(1111);
    await updatePot({ potId: fixture.potId, supplierPrice: 7 });
    await new Promise((resolve) => setTimeout(resolve, 250));

    await updatePosSpot(spot2.id, {
      partnerLocationId: locationId,
      posNumber: "2",
      posName: spot2Slug,
      updateStatus: true,
      status: "inactive",
    });
    s2Cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot2.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(s2Cycles.length, 1);
    assert.equal(String(s2Cycles[0].id), spot2CycleId);
    assert.equal(s2Cycles[0].ended_at, null);
    assert.equal(s2Cycles[0].end_reason, null);
    assert.equal(s2Cycles[0].placement_kind, "initial");
    s2Segs = (await sql`
      SELECT * FROM placement_segments
      WHERE placement_cycle_id = ${spot2CycleId}::uuid
      ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(s2Segs.length, 1);
    assert.ok(s2Segs[0].ended_at);
    assert.equal(Number(s2Segs[0].plant_unit_cost), spot2PlantCost);
    assert.equal(Number(s2Segs[0].pot_unit_cost), spot2PotCost);
    const pausedSegmentId = String(s2Segs[0].id);
    const pausedStartedMs = Date.parse(String(s2Segs[0].started_at));
    const pausedEndedMs = Date.parse(String(s2Segs[0].ended_at));

    await setSizeSupplierPrices(2222);
    await updatePot({ potId: fixture.potId, supplierPrice: 3 });
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Re-activate continues the same physical Cycle (not initial, not restock)
    // and opens a new Segment so inactive time is not exposure.
    await updatePosSpot(spot2.id, {
      partnerLocationId: locationId,
      posNumber: "2",
      posName: spot2Slug,
      updateStatus: true,
      status: "available",
    });
    s2Cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot2.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(s2Cycles.length, 1);
    assert.equal(String(s2Cycles[0].id), spot2CycleId);
    assert.equal(s2Cycles[0].ended_at, null);
    assert.equal(s2Cycles[0].end_reason, null);
    assert.equal(s2Cycles[0].placement_kind, "initial");
    s2Segs = (await sql`
      SELECT * FROM placement_segments
      WHERE placement_cycle_id = ${spot2CycleId}::uuid
      ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(s2Segs.length, 2);
    assert.equal(String(s2Segs[0].id), pausedSegmentId);
    assert.ok(s2Segs[0].ended_at);
    assert.equal(s2Segs[1].ended_at, null);
    assert.notEqual(String(s2Segs[1].id), pausedSegmentId);
    assert.equal(Number(s2Segs[1].plant_unit_cost), spot2PlantCost);
    assert.equal(s2Segs[1].plant_unit_cost_source, "plant_variants.supplier_price@cycle");
    assert.equal(Number(s2Segs[1].pot_unit_cost), spot2PotCost);
    assert.equal(s2Segs[1].pot_unit_cost_source, "pots.supplier_price@segment");
    const resumedStartedMs = Date.parse(String(s2Segs[1].started_at));
    assert.ok(pausedEndedMs >= pausedStartedMs);
    assert.ok(resumedStartedMs >= pausedEndedMs);
    assert.ok(resumedStartedMs - pausedEndedMs >= 200);
    const inactiveMidMs = pausedEndedMs + Math.floor((resumedStartedMs - pausedEndedMs) / 2);
    const inactiveAttr = attributeScansToSegments(
      [
        {
          segmentId: String(s2Segs[0].id),
          cycleId: spot2CycleId,
          posSpotId: spot2.id,
          startedAtMs: pausedStartedMs,
          endedAtMs: pausedEndedMs,
        },
        {
          segmentId: String(s2Segs[1].id),
          cycleId: spot2CycleId,
          posSpotId: spot2.id,
          startedAtMs: resumedStartedMs,
          endedAtMs: null,
        },
      ],
      [
        { posSpotId: spot2.id, distinctId: "u-active", timestampMs: pausedStartedMs },
        { posSpotId: spot2.id, distinctId: "u-inactive", timestampMs: inactiveMidMs },
        { posSpotId: spot2.id, distinctId: "u-resumed", timestampMs: resumedStartedMs },
      ],
    );
    assert.equal(inactiveAttr.segmentScans.get(String(s2Segs[0].id))?.scans, 1);
    assert.equal(inactiveAttr.segmentScans.get(String(s2Segs[1].id))?.scans, 1);
    assert.equal(inactiveAttr.unattributedScans, 1);

    await assert.rejects(
      () =>
        updatePosSpot(spot2.id, {
          partnerLocationId: otherLocationId,
          posNumber: "2",
          posName: spot2Slug,
        }),
      (err: unknown) => err instanceof PosSpotPartnerLocationImmutableError,
    );
    const spot2AfterMoveAttempt = await getPosSpotById(spot2.id);
    assert.equal(spot2AfterMoveAttempt?.partnerLocationId, locationId);

    // Remove the continued Cycle
    const rem2 = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(spot2.id))!,
      partnerLocationId: locationId,
      occupancyIntent: "remove",
    });
    await writePosUpdate({
      occupancyAction: rem2.action,
      inventorySource: "already_at_partner",
      introducesNewPot: rem2.introducesNewPotColor,
      id: spot2.id,
      existing: (await getPosSpotById(spot2.id))!,
      variantId: rem2.plantVariantId,
      potId: rem2.potId,
      patch: {
        partnerLocationId: locationId,
        posNumber: "2",
        posName: spot2Slug,
        ...occupancyToSpotFields(rem2),
      },
    });
    s2Cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot2.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(s2Cycles.length, 1);
    assert.equal(String(s2Cycles[0].id), spot2CycleId);
    assert.equal(s2Cycles[0].end_reason, "removed");

    // Place again into now-empty POS -> initial (not restock)
    const placeAfterRemove = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(spot2.id))!,
      partnerLocationId: locationId,
      occupancyIntent: "place",
      requestedOfferId: fixture.offerS,
    });
    await writePosUpdate({
      occupancyAction: placeAfterRemove.action,
      inventorySource: "already_at_partner",
      introducesNewPot: placeAfterRemove.introducesNewPotColor,
      id: spot2.id,
      existing: (await getPosSpotById(spot2.id))!,
      variantId: placeAfterRemove.plantVariantId,
      potId: placeAfterRemove.potId,
      patch: {
        partnerLocationId: locationId,
        posNumber: "2",
        posName: spot2Slug,
        ...occupancyToSpotFields(placeAfterRemove),
      },
    });
    s2Cycles = (await sql`
      SELECT * FROM placement_cycles WHERE pos_spot_id = ${spot2.id}::uuid ORDER BY started_at ASC
    `) as Record<string, unknown>[];
    assert.equal(s2Cycles.length, 2);
    assert.equal(s2Cycles[1].placement_kind, "initial");
    assert.notEqual(String(s2Cycles[1].id), spot2CycleId);

    // 8. Insert synthetic pre-060 unknown legacy cycle + segment (all snapshot/cost cols NULL)
    const legacyCycleId = randomUUID();
    const tLegacyStart = new Date("2026-06-01T10:00:00.000Z");
    const tLegacyEnd = new Date("2026-06-05T10:00:00.000Z");
    await sql`
      INSERT INTO placement_cycles (
        id, pos_spot_id, plant_variant_id, partner_id, partner_location_id,
        started_at, ended_at, end_reason, order_id
      )
      VALUES (
        ${legacyCycleId}::uuid,
        ${spot2.id}::uuid,
        ${fixture.variantS}::uuid,
        ${partnerId},
        ${locationId},
        ${tLegacyStart.toISOString()}::timestamptz,
        ${tLegacyEnd.toISOString()}::timestamptz,
        'removed',
        NULL
      )
    `;
    await sql`
      INSERT INTO placement_segments (
        id, placement_cycle_id, started_at, ended_at, pocket_id, pocket_name,
        offer_id, consumer_price
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${legacyCycleId}::uuid,
        ${tLegacyStart.toISOString()}::timestamptz,
        ${tLegacyEnd.toISOString()}::timestamptz,
        NULL,
        NULL,
        ${fixture.offerS},
        40
      )
    `;

    // 9. Verify backend placement analytics (immutability + unknown stays unknown + aggregates)
    const report = await loadPlacementAnalytics({
      partnerId,
      includeScans: false,
    });
    assert.equal(report.summary.totalPlacements, 5);
    assert.equal(report.summary.activePlacements, 1);
    assert.equal(report.summary.soldPlacements, 1);
    assert.equal(report.summary.replacedPlacements, 1);
    assert.equal(report.summary.removedPlacements, 2);
    assert.equal(report.summary.deactivatedPlacements, 0);
    assert.equal(report.summary.initialPlacements, 3);
    assert.equal(report.summary.restockPlacements, 1);
    assert.equal(report.summary.unknownKindPlacements, 1);
    assert.equal(report.summary.totalSales, 1);
    assert.equal(report.summary.totalRevenue, offerL.consumerPrice);
    assert.equal(
      report.summary.totalCommissionAmount,
      Math.round(offerL.consumerPrice * 0.15 * 100) / 100,
    );
    assert.ok(report.summary.avgTimeToSaleMs != null && report.summary.avgTimeToSaleMs >= 0);

    const cyc2 = report.placements.find((c) => c.cycleId === cycle2Id);
    assert.ok(cyc2);
    assert.equal(cyc2.endReason, "sold");
    assert.equal(cyc2.placementKind, "restock");
    assert.equal(cyc2.sizeLabel, "L");
    assert.equal(cyc2.plantName, `${tag} plant`);
    assert.equal(cyc2.segments[0].plantUnitCost, 99);

    // Immutability assertions against mutated live names/prices
    const cyc1 = report.placements.find((c) => c.cycleId === cycle1Id)!;
    assert.equal(cyc1.partnerName, initialPartnerName);
    assert.equal(cyc1.partnerLocationName, initialLocationName);
    assert.equal(cyc1.plantName, `${tag} plant`);
    assert.equal(cyc1.segments[0].pocketName, `${tag}-PocketA`);
    assert.equal(cyc1.segments[2].potName, `${tag} pot a`);
    assert.equal(cyc1.segments[2].plantUnitCost, 40);
    assert.equal(cyc1.segments[2].potUnitCost, 12);
    assert.equal(cyc1.segments[2].totalSupplierUnitCost, 52);

    // Unknown pre-060 row stays null, never fabricated as 0 or 'initial'
    const cycLegacy = report.placements.find((c) => c.cycleId === legacyCycleId)!;
    assert.equal(cycLegacy.placementKind, null);
    assert.equal(cycLegacy.plantName, null);
    assert.equal(cycLegacy.segments[0].plantUnitCost, null);
    assert.equal(cycLegacy.segments[0].totalSupplierUnitCost, null);
    assert.equal(report.reliability.legacyCyclesWithoutKind, 1);
    assert.ok(report.reliability.segmentsWithoutCostSnapshot >= 2); // legacy + null-cost pot segment

    // 10. Verify PostHog pos_scan timestamp join helper
    const t0 = Date.parse("2026-10-01T10:00:00.000Z");
    const t1 = Date.parse("2026-10-01T11:00:00.000Z");
    const t2 = Date.parse("2026-10-01T12:00:00.000Z");
    const attr = attributeScansToSegments(
      [
        {
          segmentId: "seg-1",
          cycleId: "cyc-1",
          posSpotId: spot.id,
          startedAtMs: t0,
          endedAtMs: t1,
        },
        {
          segmentId: "seg-2",
          cycleId: "cyc-1",
          posSpotId: spot.id,
          startedAtMs: t1,
          endedAtMs: t2,
        },
      ],
      [
        { posSpotId: spot.id, distinctId: "u1", timestampMs: t0 - 1000 }, // pre-placement
        { posSpotId: spot.id, distinctId: "u1", timestampMs: t0 + 1000 }, // seg-1
        { posSpotId: spot.id, distinctId: "u2", timestampMs: t0 + 5000 }, // seg-1
        { posSpotId: spot.id, distinctId: "u1", timestampMs: t1 + 1000 }, // seg-2
        { posSpotId: spot.id, distinctId: "u3", timestampMs: t2 + 1000 }, // post-close
      ],
    );
    assert.equal(attr.segmentScans.get("seg-1")?.scans, 2);
    assert.equal(attr.segmentScans.get("seg-1")?.distinctIds.size, 2);
    assert.equal(attr.segmentScans.get("seg-2")?.scans, 1);
    assert.equal(attr.cycleScans.get("cyc-1")?.scans, 3);
    assert.equal(attr.cycleScans.get("cyc-1")?.distinctIds.size, 2);
    assert.equal(attr.unattributedScans, 2);

    // 11. Legacy Neon `events` table untouched by placement/segment/analytics flow
    const eventsAfter = (
      await sql`SELECT count(*)::int AS n FROM events WHERE partner_location_id = ${locationId}`
    )[0] as { n: number };
    assert.equal(eventsAfter.n, eventsBefore.n);

    console.log("verify-placement-history: snapshots, cost, immutability, analytics ok");
  } finally {
    for (const attemptId of createdAttemptIds) {
      try {
        await deletePaymentAttemptById(attemptId);
      } catch {
        // best-effort
      }
    }
    if (createdSpotIds.length > 0) {
      await sql`
        DELETE FROM placement_segments
        WHERE placement_cycle_id IN (
          SELECT id FROM placement_cycles WHERE pos_spot_id = ANY(${createdSpotIds}::uuid[])
        )
      `;
      await sql`DELETE FROM placement_cycles WHERE pos_spot_id = ANY(${createdSpotIds}::uuid[])`;
    }
    for (const orderId of createdOrderIds) {
      await sql`DELETE FROM orders WHERE order_id = ${orderId}::uuid`;
    }
    if (createdSpotIds.length > 0) {
      await sql`DELETE FROM pos_spots WHERE id = ANY(${createdSpotIds}::uuid[])`;
    }
    if (createdPocketIds.length > 0) {
      await sql`DELETE FROM pockets WHERE id = ANY(${createdPocketIds}::uuid[])`;
    }
    if (extraOfferId) {
      await sql`DELETE FROM offer_availabilities WHERE offer_id = ${extraOfferId}`;
      await sql`DELETE FROM offers WHERE id = ${extraOfferId}`;
    }
    if (extraSellableId) {
      await sql`DELETE FROM sellable_variants WHERE id = ${extraSellableId}::uuid`;
    }
    if (extraPotId) {
      await deletePot(extraPotId);
    }
    await fixture.cleanup();
    await sql`DELETE FROM partner_locations WHERE id = ${otherLocationId}`;
    await sql`DELETE FROM partner_locations WHERE id = ${locationId}`;
    await sql`DELETE FROM partner_commission_tiers WHERE partner_id = ${partnerId}`;
    await sql`DELETE FROM partners WHERE id = ${partnerId}`;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

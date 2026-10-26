/**
 * Placement Cycle: one physical plant unit lifetime on one POS.
 *
 * Run: npx tsx scripts/verify-placement-cycles.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertStaticBoundaries(): void {
  const migration = read("db/migrations/038_placement_cycles.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS placement_cycles/);
  assert.match(migration, /end_reason IN \('sold', 'removed', 'replaced', 'deactivated'\)/);
  assert.match(migration, /placement_cycles_one_open_per_pos/);
  assert.doesNotMatch(migration, /INSERT INTO placement_cycles/i);
  assert.doesNotMatch(migration, /pocket/i);
  assert.doesNotMatch(migration, /current_offer/i);
  assert.doesNotMatch(migration, /placement_segment/i);

  const occupancy = read("lib/posOccupancy.ts");
  assert.doesNotMatch(occupancy, /placement_cycles/);
  assert.doesNotMatch(occupancy, /placementCycle/);

  const events = read("lib/eventTypes.ts");
  assert.match(events, /plant_placed/);
  assert.match(events, /plant_sold/);

  const posCreate = read("app/api/pos-spots/route.ts");
  assert.match(posCreate, /type: "plant_placed"/);

  console.log("verify-placement-cycles: static schema and out-of-scope boundaries ok");
}

async function main(): Promise<void> {
  assertStaticBoundaries();

  const { cycleEffectForPosWrite } = await import("../lib/placementCycle");
  assert.equal(
    cycleEffectForPosWrite({
      occupancyAction: "place",
      existingStatus: "available",
      nextStatus: "available",
      existingVariantId: null,
      nextVariantId: "v1",
    }).kind,
    "open",
  );
  assert.equal(
    cycleEffectForPosWrite({
      occupancyAction: "replace",
      existingStatus: "available",
      nextStatus: "available",
      existingVariantId: "v1",
      nextVariantId: "v1",
    }).kind,
    "replace",
  );
  assert.equal(
    cycleEffectForPosWrite({
      occupancyAction: "update",
      existingStatus: "available",
      nextStatus: "available",
      existingVariantId: "v1",
      nextVariantId: "v1",
    }).kind,
    "none",
  );
  assert.equal(
    (
      cycleEffectForPosWrite({
        occupancyAction: "remove",
        existingStatus: "available",
        nextStatus: "available",
        existingVariantId: "v1",
        nextVariantId: null,
      }) as { kind: "close"; reason: string }
    ).reason,
    "removed",
  );
  assert.equal(
    (
      cycleEffectForPosWrite({
        occupancyAction: "update",
        existingStatus: "available",
        nextStatus: "inactive",
        existingVariantId: "v1",
        nextVariantId: "v1",
      }) as { kind: "close"; reason: string }
    ).reason,
    "deactivated",
  );
  assert.equal(
    cycleEffectForPosWrite({
      occupancyAction: "update",
      existingStatus: "inactive",
      nextStatus: "available",
      existingVariantId: "v1",
      nextVariantId: "v1",
    }).kind,
    "open",
  );
  console.log("verify-placement-cycles: effect matrix ok");

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const { sql } = await import("../lib/db");
  const {
    appendPosSpot,
    getPosSpotById,
    updatePosSpot,
    acquirePosSpotHoldForPayment,
    releasePosSpotHoldForPayment,
  } = await import("../lib/posSpotStorage");
  const { createPocket, deletePocket } = await import("../lib/pocketStorage");
  const {
    occupancyToSpotFields,
    PosOccupancyError,
    resolveOccupancyForPosCreate,
    resolveOccupancyForPosPatch,
  } = await import("../lib/posOccupancy");
  const {
    OccupancyWriteFailedError,
    commitPosUpdateFromCentral,
    writePosCreate,
    writePosUpdate,
  } = await import("../lib/posCentralStock");
  const { applyInventoryDelta, getInventoryQuantity } = await import("../lib/inventoryStorage");
  const { insertPaymentAttempt, deletePaymentAttemptById, finalizeVerifiedPaymentAttemptAtomic } =
    await import("../lib/paymentAttemptStorage");
  const { createPosCutoverFixture } = await import("./pos-offer-cutover-fixture.ts");

  const table = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'placement_cycles'
  `;
  const cols = new Set((table as { column_name: string }[]).map((row) => row.column_name));
  for (const name of [
    "id",
    "pos_spot_id",
    "plant_variant_id",
    "started_at",
    "ended_at",
    "end_reason",
    "order_id",
  ]) {
    assert.equal(cols.has(name), true, `missing column ${name}`);
  }
  assert.equal(cols.has("pocket_id"), false);
  assert.equal(cols.has("current_offer_id"), false);

  const uniq = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'placement_cycles_one_open_per_pos'
  `;
  assert.equal((uniq as { indexname: string }[]).length, 1);

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

  const tag = `cyc-${randomUUID().slice(0, 8)}`;
  const fixture = await createPosCutoverFixture({
    sql,
    tag,
    partnerLocationId,
    flowerPlantId: flower.id,
  });
  const variantA = fixture.variantS;
  const variantB = fixture.variantL;
  const emptyVariant = fixture.variantL;
  const offerA = fixture.offerS;
  const offerB = fixture.offerL;
  const offerFlower = fixture.offerFlower;
  const offerEmpty = fixture.offerL;
  const offerLegacy = fixture.offerLegacy;
  const attemptIds: string[] = [];
  const orderIds: string[] = [];
  const spotIds: string[] = [];
  let pocketId: string | undefined;

  type CycleRow = {
    id: string;
    pos_spot_id: string;
    plant_variant_id: string;
    started_at: string | Date;
    ended_at: string | Date | null;
    end_reason: string | null;
    order_id: string | null;
  };

  async function cyclesFor(posSpotId: string): Promise<CycleRow[]> {
    return (await sql`
      SELECT id, pos_spot_id, plant_variant_id, started_at, ended_at, end_reason, order_id
      FROM placement_cycles
      WHERE pos_spot_id = ${posSpotId}::uuid
      ORDER BY started_at ASC, id ASC
    `) as CycleRow[];
  }

  async function openCycles(posSpotId: string): Promise<CycleRow[]> {
    return (await cyclesFor(posSpotId)).filter((row) => row.ended_at == null);
  }

  function emptySpot(slug: string, posNumber: string) {
    const createdAt = new Date().toISOString();
    return {
      id: randomUUID(),
      spotName: slug,
      partnerLocationId,
      posNumber,
      posName: slug,
      spotSlug: slug,
      status: "available" as const,
      checkStatus: false as const,
      createdAt,
    };
  }

  async function writePlace(
    existing: NonNullable<Awaited<ReturnType<typeof getPosSpotById>>>,
    variantId: string,
    offerId: string,
    source: unknown = "already_at_partner",
  ) {
    const occupancy = await resolveOccupancyForPosPatch({
      existing,
      partnerLocationId: existing.partnerLocationId,
      occupancyIntent: "place",
      requestedOfferId: offerId,
    });
    return writePosUpdate({
      occupancyAction: occupancy.action,
      inventorySource: source,
      introducesNewPotColor: occupancy.introducesNewPotColor,
      id: existing.id,
      existing,
      variantId: occupancy.plantVariantId,
      potColorId: occupancy.potColorId,
      patch: {
        partnerLocationId: existing.partnerLocationId,
        posNumber: existing.posNumber ?? "1",
        posName: existing.posName,
        ...occupancyToSpotFields(occupancy),
      },
    });
  }

  async function writeReplace(
    existing: NonNullable<Awaited<ReturnType<typeof getPosSpotById>>>,
    variantId: string,
    offerId: string,
    sameVariant = false,
  ) {
    const occupancy = await resolveOccupancyForPosPatch({
      existing,
      partnerLocationId: existing.partnerLocationId,
      occupancyIntent: "replace",
      requestedOfferId: offerId,
      sameVariantReplace: sameVariant,
    });
    return writePosUpdate({
      occupancyAction: occupancy.action,
      inventorySource: "already_at_partner",
      introducesNewPotColor: occupancy.introducesNewPotColor,
      id: existing.id,
      existing,
      variantId: occupancy.plantVariantId,
      potColorId: occupancy.potColorId,
      patch: {
        partnerLocationId: existing.partnerLocationId,
        posNumber: existing.posNumber ?? "1",
        posName: existing.posName,
        ...occupancyToSpotFields(occupancy),
      },
    });
  }

  try {
    await sql`SELECT 1`;

    const cycleCountBefore = await sql`SELECT COUNT(*)::int AS n FROM placement_cycles`;
    const cyclesAtStart = (cycleCountBefore as { n: number }[])[0].n;

    const legacyOccupied = await appendPosSpot({
      ...emptySpot(`cyc-legacy-unit-${tag}`, "81"),
      currentOfferId: offerA,
      plantVariantId: variantA,
    });
    spotIds.push(legacyOccupied.id);
    assert.equal((await cyclesFor(legacyOccupied.id)).length, 0);
    const afterLegacyInsert = await sql`SELECT COUNT(*)::int AS n FROM placement_cycles`;
    assert.equal((afterLegacyInsert as { n: number }[])[0].n, cyclesAtStart);

    const createOccupancy = await resolveOccupancyForPosCreate({
      offerId: offerA,
      partnerLocationId,
    });
    const slugPlant = `cyc-plant-${tag}`;
    const createdAt = new Date().toISOString();
    const created = await writePosCreate({
      occupancyAction: createOccupancy.action,
      inventorySource: "already_at_partner",
      posSpot: {
        id: randomUUID(),
        spotName: slugPlant,
        partnerLocationId,
        posNumber: "82",
        posName: slugPlant,
        spotSlug: slugPlant,
        currentOfferId: createOccupancy.currentOfferId ?? offerA,
        plantVariantId: createOccupancy.plantVariantId ?? variantA,
        status: "available",
        checkStatus: false,
        offerPlacedAt: createOccupancy.offerPlacedAt ?? createdAt,
        createdAt,
      },
      variantId: createOccupancy.plantVariantId,
    });
    spotIds.push(created.id);
    const placedCycles = await cyclesFor(created.id);
    assert.equal(placedCycles.length, 1);
    assert.equal(placedCycles[0].ended_at, null);
    assert.equal(placedCycles[0].end_reason, null);
    assert.equal(placedCycles[0].plant_variant_id, variantA);
    assert.equal(placedCycles[0].order_id, null);
    const firstCycleId = placedCycles[0].id;

    await assert.rejects(
      () => writePlace(created, variantB, offerB),
      (err: unknown) => err instanceof PosOccupancyError,
    );
    assert.equal((await openCycles(created.id)).length, 1);
    assert.equal((await openCycles(created.id))[0].id, firstCycleId);

    const variantReplaced = await writeReplace((await getPosSpotById(created.id))!, variantB, offerB);
    assert.equal(variantReplaced?.plantVariantId, variantB);
    const afterVariantReplace = await cyclesFor(created.id);
    assert.equal(afterVariantReplace.length, 2);
    assert.equal(afterVariantReplace[0].id, firstCycleId);
    assert.equal(afterVariantReplace[0].end_reason, "replaced");
    assert.ok(afterVariantReplace[0].ended_at);
    assert.equal(afterVariantReplace[1].ended_at, null);
    assert.equal(afterVariantReplace[1].plant_variant_id, variantB);
    assert.equal((await openCycles(created.id)).length, 1);

    const sameReplaced = await writeReplace(
      (await getPosSpotById(created.id))!,
      variantB,
      offerB,
      true,
    );
    assert.equal(sameReplaced?.plantVariantId, variantB);
    const afterSame = await cyclesFor(created.id);
    assert.equal(afterSame.length, 3);
    assert.equal(afterSame[1].end_reason, "replaced");
    assert.equal(afterSame[2].ended_at, null);
    assert.equal(afterSame[2].plant_variant_id, variantB);
    const openAfterSame = (await openCycles(created.id))[0];

    const occupied = await getPosSpotById(created.id);
    assert.ok(occupied);
    const updated = await resolveOccupancyForPosPatch({
      existing: occupied,
      partnerLocationId,
      occupancyIntent: "update",
      requestedOfferId: fixture.offerL2,
    });
    assert.equal(updated.action, "update");
    await writePosUpdate({
      occupancyAction: updated.action,
      inventorySource: "already_at_partner",
      id: occupied.id,
      existing: occupied,
      variantId: occupied.plantVariantId,
      patch: {
        partnerLocationId: occupied.partnerLocationId,
        posNumber: occupied.posNumber ?? "82",
        posName: occupied.posName,
        ...occupancyToSpotFields(updated),
      },
    });
    const pocket = await createPocket({ partnerLocationId, name: `${tag}-pocket` });
    pocketId = pocket.id;
    await writePosUpdate({
      occupancyAction: "update",
      inventorySource: "already_at_partner",
      id: occupied.id,
      existing: (await getPosSpotById(occupied.id))!,
      variantId: variantB,
      patch: {
        partnerLocationId,
        posNumber: "82",
        posName: occupied.posName,
        updatePocketId: true,
        pocketId: pocket.id,
      },
    });
    const afterUpdate = await openCycles(created.id);
    assert.equal(afterUpdate.length, 1);
    assert.equal(afterUpdate[0].id, openAfterSame.id);
    assert.equal(String(afterUpdate[0].started_at), String(openAfterSame.started_at));

    const holdAttempt = randomUUID();
    const now = new Date().toISOString();
    await insertPaymentAttempt({
      id: holdAttempt,
      status: "created",
      posSpotId: created.id,
      offerId: offerB,
      productId: fixture.plantId,
      productName: "Cycle Verify Plant",
      fullName: "Cycle Verify",
      customerEmail: "cycle-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      amount: 55,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    attemptIds.push(holdAttempt);
    assert.equal((await acquirePosSpotHoldForPayment(created.id, holdAttempt)).ok, true);
    assert.equal((await releasePosSpotHoldForPayment(created.id, holdAttempt)).ok, true);
    const afterHold = await openCycles(created.id);
    assert.equal(afterHold.length, 1);
    assert.equal(afterHold[0].id, openAfterSame.id);

    const removed = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(created.id))!,
      occupancyIntent: "remove",
    });
    await writePosUpdate({
      occupancyAction: removed.action,
      inventorySource: "already_at_partner",
      id: created.id,
      existing: (await getPosSpotById(created.id))!,
      variantId: null,
      patch: {
        partnerLocationId,
        posNumber: "82",
        posName: slugPlant,
        ...occupancyToSpotFields(removed),
      },
    });
    const afterRemove = await cyclesFor(created.id);
    assert.equal(afterRemove[afterRemove.length - 1].end_reason, "removed");
    assert.equal((await openCycles(created.id)).length, 0);

    await writePlace((await getPosSpotById(created.id))!, variantA, offerA);
    const reopenId = (await openCycles(created.id))[0].id;
    await updatePosSpot(created.id, {
      partnerLocationId,
      posNumber: "82",
      posName: slugPlant,
      updateStatus: true,
      status: "inactive",
    });
    const afterDeactivate = await cyclesFor(created.id);
    const deactivatedRow = afterDeactivate.find((row) => row.id === reopenId);
    assert.equal(deactivatedRow?.end_reason, "deactivated");
    assert.equal((await getPosSpotById(created.id))?.plantVariantId, variantA);
    assert.equal((await openCycles(created.id)).length, 0);
    const inactiveOccupied = await getPosSpotById(created.id);
    assert.ok(inactiveOccupied);
    await assert.rejects(
      () => writePlace(inactiveOccupied, variantA, offerA),
      (err: unknown) => err instanceof PosOccupancyError,
    );

    await updatePosSpot(created.id, {
      partnerLocationId,
      posNumber: "82",
      posName: slugPlant,
      updateStatus: true,
      status: "available",
    });
    const afterReactivate = await openCycles(created.id);
    assert.equal(afterReactivate.length, 1);
    assert.notEqual(afterReactivate[0].id, reopenId);
    assert.equal(afterReactivate[0].plant_variant_id, variantA);

    const flowerSwitchExisting = await getPosSpotById(created.id);
    assert.ok(flowerSwitchExisting);
    const flowerOcc = await resolveOccupancyForPosPatch({
      existing: flowerSwitchExisting,
      requestedOfferId: offerFlower,
    });
    await writePosUpdate({
      occupancyAction: flowerOcc.action,
      inventorySource: "already_at_partner",
      id: created.id,
      existing: flowerSwitchExisting,
      variantId: flowerOcc.plantVariantId,
      patch: {
        partnerLocationId,
        posNumber: "82",
        posName: slugPlant,
        ...occupancyToSpotFields(flowerOcc),
      },
    });
    assert.equal((await getPosSpotById(created.id))?.plantVariantId, undefined);
    const afterFlower = await cyclesFor(created.id);
    assert.equal(afterFlower[afterFlower.length - 1].end_reason, "removed");
    assert.equal((await openCycles(created.id)).length, 0);

    await writePlace((await getPosSpotById(created.id))!, variantA, offerA);
    await writePosUpdate({
      occupancyAction: "update",
      inventorySource: "already_at_partner",
      id: created.id,
      existing: (await getPosSpotById(created.id))!,
      variantId: variantA,
      patch: {
        partnerLocationId,
        posNumber: "82",
        posName: slugPlant,
        updatePocketId: true,
        pocketId: pocket.id,
      },
    });
    const beforePocketDelete = (await openCycles(created.id))[0];
    const deletedPocket = await deletePocket(pocket.id);
    assert.equal(deletedPocket.deleted, true);
    pocketId = undefined;
    const afterPocket = await cyclesFor(created.id);
    assert.equal(
      afterPocket.find((row) => row.id === beforePocketDelete.id)?.end_reason,
      "removed",
    );
    assert.equal((await getPosSpotById(created.id))?.pocketId, undefined);
    assert.equal((await getPosSpotById(created.id))?.plantVariantId, undefined);

    const saleSpot = await writePlace((await getPosSpotById(created.id))!, variantA, offerA);
    assert.ok(saleSpot);
    const saleSession = `cs-cyc-${randomUUID()}`;
    const saleAttempt = randomUUID();
    await insertPaymentAttempt({
      id: saleAttempt,
      status: "awaiting_payment",
      posSpotId: created.id,
      offerId: offerA,
      productId: fixture.plantId,
      productName: "Cycle Verify Plant",
      fullName: "Cycle Verify",
      customerEmail: "cycle-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "pickup",
      amount: 40,
      checkoutSessionId: saleSession,
      paymentResumeToken: `resume-${randomUUID()}`,
      snapshot: {
        productId: fixture.plantId,
        productName: "Cycle Verify Plant",
        offerId: offerA,
        consumerPrice: 40,
        fulfillmentType: "pickup",
        partnerLocationId,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    attemptIds.push(saleAttempt);
    assert.equal((await acquirePosSpotHoldForPayment(created.id, saleAttempt)).ok, true);
    const openBeforeSale = (await openCycles(created.id))[0];
    const sold = await finalizeVerifiedPaymentAttemptAtomic({
      attemptId: saleAttempt,
      checkoutSessionId: saleSession,
      posSpotId: created.id,
      fulfillmentMethod: "pickup",
    });
    assert.equal(sold.ok, true);
    if (sold.ok) {
      orderIds.push(sold.order.orderId);
      const soldCycle = (await cyclesFor(created.id)).find((row) => row.id === openBeforeSale.id);
      assert.equal(soldCycle?.end_reason, "sold");
      assert.equal(soldCycle?.order_id, sold.order.orderId);
      const endedAt = soldCycle?.ended_at;
      const dup = await finalizeVerifiedPaymentAttemptAtomic({
        attemptId: saleAttempt,
        checkoutSessionId: saleSession,
        posSpotId: created.id,
        fulfillmentMethod: "pickup",
      });
      assert.equal(dup.ok, false);
      const afterDup = (await cyclesFor(created.id)).find((row) => row.id === openBeforeSale.id);
      assert.equal(String(afterDup?.ended_at), String(endedAt));
      assert.equal(afterDup?.order_id, sold.order.orderId);
    }

    const flowerCreate = await resolveOccupancyForPosCreate({
      offerId: offerFlower,
      partnerLocationId,
    });
    const flowerSlug = `cyc-flower-${tag}`;
    const flowerSpot = await writePosCreate({
      occupancyAction: flowerCreate.action,
      inventorySource: "already_at_partner",
      posSpot: {
        id: randomUUID(),
        spotName: flowerSlug,
        partnerLocationId,
        posNumber: "83",
        posName: flowerSlug,
        spotSlug: flowerSlug,
        currentOfferId: offerFlower,
        status: "available",
        checkStatus: false,
        offerPlacedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      variantId: null,
    });
    spotIds.push(flowerSpot.id);
    assert.equal((await cyclesFor(flowerSpot.id)).length, 0);
    const flowerSession = `cs-cyc-f-${randomUUID()}`;
    const flowerAttempt = randomUUID();
    await insertPaymentAttempt({
      id: flowerAttempt,
      status: "awaiting_payment",
      posSpotId: flowerSpot.id,
      offerId: offerFlower,
      productId: flower.id,
      productName: "Cycle Verify Flower",
      fullName: "Cycle Verify",
      customerEmail: "cycle-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "pickup",
      amount: 25,
      checkoutSessionId: flowerSession,
      paymentResumeToken: `resume-${randomUUID()}`,
      snapshot: {
        productId: flower.id,
        productName: "Cycle Verify Flower",
        offerId: offerFlower,
        consumerPrice: 25,
        fulfillmentType: "pickup",
        partnerLocationId,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    attemptIds.push(flowerAttempt);
    const flowerFinal = await finalizeVerifiedPaymentAttemptAtomic({
      attemptId: flowerAttempt,
      checkoutSessionId: flowerSession,
      posSpotId: flowerSpot.id,
      fulfillmentMethod: "pickup",
    });
    assert.equal(flowerFinal.ok, true);
    if (flowerFinal.ok) orderIds.push(flowerFinal.order.orderId);
    assert.equal((await cyclesFor(flowerSpot.id)).length, 0);

    const legacySpot = await appendPosSpot({
      ...emptySpot(`cyc-legacy-assign-${tag}`, "84"),
      currentOfferId: offerLegacy,
    });
    spotIds.push(legacySpot.id);
    assert.equal((await cyclesFor(legacySpot.id)).length, 0);
    const assigned = await resolveOccupancyForPosPatch({
      existing: legacySpot,
      partnerLocationId,
      occupancyIntent: "place",
      requestedOfferId: offerA,
    });
    assert.equal(assigned.action, "place");
    await writePosUpdate({
      occupancyAction: assigned.action,
      inventorySource: "already_at_partner",
      id: legacySpot.id,
      existing: legacySpot,
      variantId: assigned.plantVariantId,
      patch: {
        partnerLocationId,
        posNumber: "84",
        posName: legacySpot.posName,
        ...occupancyToSpotFields(assigned),
      },
    });
    const assignedCycles = await cyclesFor(legacySpot.id);
    assert.equal(assignedCycles.length, 1);
    assert.equal(assignedCycles[0].ended_at, null);
    assert.equal(assignedCycles[0].plant_variant_id, variantA);

    const failSpot = await appendPosSpot(emptySpot(`cyc-fail-${tag}`, "85"));
    spotIds.push(failSpot.id);
    const qtyFailBefore = await getInventoryQuantity(emptyVariant);
    const cyclesFailBefore = (await cyclesFor(failSpot.id)).length;
    let zeroFailed = false;
    try {
      await writePlace(failSpot, emptyVariant, offerEmpty, "central");
    } catch {
      zeroFailed = true;
    }
    assert.equal(zeroFailed, true);
    assert.equal((await getPosSpotById(failSpot.id))?.plantVariantId, undefined);
    assert.equal((await getInventoryQuantity(emptyVariant)), qtyFailBefore);
    assert.equal((await cyclesFor(failSpot.id)).length, cyclesFailBefore);

    await applyInventoryDelta({ variantId: variantB, delta: 2, note: `${tag} guard B` });
    const occupiedForGuard = await getPosSpotById(legacySpot.id);
    assert.ok(occupiedForGuard?.plantVariantId);
    const qtyBBeforeGuard = await getInventoryQuantity(variantB);
    const cyclesGuardBefore = await cyclesFor(legacySpot.id);
    let guardFailed = false;
    try {
      await commitPosUpdateFromCentral({
        id: legacySpot.id,
        patch: {
          partnerLocationId,
          posNumber: occupiedForGuard.posNumber ?? "84",
          posName: occupiedForGuard.posName,
          plantVariantId: variantB,
          currentOfferId: offerB,
        },
        variantId: variantB,
        action: "place",
        decrementPlant: true,
        decrementPotColor: false,
        existing: occupiedForGuard,
      });
    } catch (error) {
      guardFailed = true;
      assert.ok(error instanceof OccupancyWriteFailedError);
    }
    assert.equal(guardFailed, true);
    assert.equal((await getPosSpotById(legacySpot.id))?.plantVariantId, variantA);
    assert.equal(await getInventoryQuantity(variantB), qtyBBeforeGuard);
    const cyclesGuardAfter = await cyclesFor(legacySpot.id);
    assert.equal(cyclesGuardAfter.length, cyclesGuardBefore.length);
    assert.equal(cyclesGuardAfter[0].id, cyclesGuardBefore[0].id);
    assert.equal(cyclesGuardAfter[0].ended_at, null);

    const openCounts = await sql`
      SELECT pos_spot_id, COUNT(*)::int AS n
      FROM placement_cycles
      WHERE ended_at IS NULL
        AND pos_spot_id = ANY(${spotIds}::uuid[])
      GROUP BY pos_spot_id
      HAVING COUNT(*) > 1
    `;
    assert.equal((openCounts as { n: number }[]).length, 0);

    console.log("verify-placement-cycles: lifecycle, sale, pocket, atomicity ok");
  } finally {
    for (const attemptId of attemptIds) {
      try {
        await deletePaymentAttemptById(attemptId);
      } catch {
        // best-effort
      }
    }
    if (spotIds.length > 0) {
      await sql`
        DELETE FROM placement_segments
        WHERE placement_cycle_id IN (
          SELECT id FROM placement_cycles WHERE pos_spot_id = ANY(${spotIds}::uuid[])
        )
      `;
      await sql`DELETE FROM placement_cycles WHERE pos_spot_id = ANY(${spotIds}::uuid[])`;
    }
    for (const orderId of orderIds) {
      await sql`DELETE FROM orders WHERE order_id = ${orderId}::uuid`;
    }
    if (spotIds.length > 0) {
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
    await fixture.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

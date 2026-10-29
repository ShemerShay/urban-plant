/**
 * Slice B: POS Place / Replace connected to central Back Office inventory.
 *
 * Run: npx tsx scripts/verify-pos-central-inventory.ts
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertStaticBoundaries(): void {
  const occupancy = read("lib/posOccupancy.ts");
  assert.doesNotMatch(occupancy, /inventoryStorage/);
  assert.doesNotMatch(occupancy, /posCentralStock/);
  assert.doesNotMatch(occupancy, /applyInventoryDelta/);

  const pos = read("lib/posSpotStorage.ts");
  assert.doesNotMatch(pos, /applyInventoryDelta/);
  assert.doesNotMatch(pos, /inventory_history/);
  assert.match(pos, /occupancyWriteGuard/);

  const pocket = read("lib/pocketStorage.ts");
  assert.doesNotMatch(pocket, /applyInventoryDelta/);
  assert.doesNotMatch(pocket, /posCentralStock/);

  const payment = read("lib/paymentAttemptStorage.ts");
  assert.doesNotMatch(payment, /applyInventoryDelta/);
  assert.doesNotMatch(payment, /posCentralStock/);

  const orders = read("lib/ordersStorage.ts");
  assert.doesNotMatch(orders, /applyInventoryDelta/);
  assert.doesNotMatch(orders, /posCentralStock/);

  const prep = read("lib/startCardcomPaymentPrep.ts");
  assert.doesNotMatch(prep, /applyInventoryDelta/);
  assert.doesNotMatch(prep, /posCentralStock/);

  const composer = read("lib/posCentralStock.ts");
  assert.match(composer, /prepareInventoryDelta/);
  assert.match(composer, /inventorySource/);
  assert.match(composer, /already_at_partner/);
  assert.doesNotMatch(composer, /Placement Cycle|placement_segment/i);

  const migrations = readdirSync(join(root, "db/migrations"));
  assert.equal(existsSync(join(root, "db/migrations/038_pos_central_inventory.sql")), false);
  assert.equal(
    migrations
      .filter((name) => name.startsWith("038_") && name !== "038_placement_cycles.sql")
      .length,
    0,
    "Slice B must not add a schema migration besides later Placement Cycle",
  );

  console.log("verify-pos-central-inventory: static boundaries ok");
}

async function main(): Promise<void> {
  assertStaticBoundaries();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const { sql } = await import("../lib/db");
  const {
    appendPosSpot,
    getPosSpotById,
    updatePosSpot,
  } = await import("../lib/posSpotStorage");
  const { createPocket, deletePocket } = await import("../lib/pocketStorage");
  const {
    occupancyToSpotFields,
    resolveOccupancyForPosCreate,
    resolveOccupancyForPosPatch,
  } = await import("../lib/posOccupancy");
  const {
    OccupancyWriteFailedError,
    PosCentralStockError,
    commitPosUpdateFromCentral,
    writePosCreate,
    writePosUpdate,
  } = await import("../lib/posCentralStock");
  const {
    InventoryChangeError,
    applyInventoryDelta,
    getInventoryQuantity,
    readInventoryHistory,
  } = await import("../lib/inventoryStorage");
  const {
    PotInventoryChangeError,
    applyPotInventoryDelta,
    getPotInventoryQuantity,
  } = await import("../lib/potInventoryStorage");
  const { insertPaymentAttempt, deletePaymentAttemptById, finalizeVerifiedPaymentAttemptAtomic } =
    await import("../lib/paymentAttemptStorage");
  const { createPosCutoverFixture } = await import("./pos-offer-cutover-fixture.ts");

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

  const tag = `inv-b-${randomUUID().slice(0, 8)}`;
  const fixture = await createPosCutoverFixture({
    sql,
    tag,
    partnerLocationId,
    flowerPlantId: flower.id,
  });
  const variantA = fixture.variantS;
  const variantB = fixture.variantL;
  const offerA = fixture.offerS;
  const offerB = fixture.offerL;
  const offerFlower = fixture.offerFlower;
  const offerEmpty = fixture.offerL;
  const emptyVariant = fixture.variantL;
  const offerLast = fixture.offerL;
  const lastVariant = fixture.variantL;
  const attemptIds: string[] = [];
  const orderIds: string[] = [];
  const spotIds: string[] = [];
  let pocketId: string | undefined;

  async function historyCount(variantId: string): Promise<number> {
    return (await readInventoryHistory(variantId)).length;
  }

  async function minusOneCount(variantId: string): Promise<number> {
    return (await readInventoryHistory(variantId)).filter((row) => row.delta === -1).length;
  }

  async function drainPot(potId: string): Promise<void> {
    const qty = await getPotInventoryQuantity(potId);
    if (qty > 0) {
      await applyPotInventoryDelta({
        potId,
        delta: -qty,
        note: `${tag} drain`,
      });
    }
  }

  async function occupancySnapshot(posSpotId: string) {
    const spot = await getPosSpotById(posSpotId);
    const cycleRows = (await sql`
      SELECT id, ended_at, end_reason
      FROM placement_cycles
      WHERE pos_spot_id = ${posSpotId}::uuid
      ORDER BY started_at ASC, id ASC
    `) as { id: string; ended_at: string | Date | null; end_reason: string | null }[];
    const segmentRows = (await sql`
      SELECT s.id, s.ended_at, s.offer_id, s.pot_id, s.sellable_variant_id
      FROM placement_segments s
      INNER JOIN placement_cycles c ON c.id = s.placement_cycle_id
      WHERE c.pos_spot_id = ${posSpotId}::uuid
      ORDER BY s.started_at ASC, s.id ASC
    `) as {
      id: string;
      ended_at: string | Date | null;
      offer_id: string | null;
      pot_id: string | null;
      sellable_variant_id: string | null;
    }[];
    return {
      plantVariantId: spot?.plantVariantId ?? null,
      currentOfferId: spot?.currentOfferId ?? null,
      potId: spot?.potId ?? null,
      cycles: cycleRows.map((row) => ({
        id: row.id,
        ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
        end_reason: row.end_reason,
      })),
      segments: segmentRows.map((row) => ({
        id: row.id,
        ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
        offer_id: row.offer_id,
        pot_id: row.pot_id,
        sellable_variant_id: row.sellable_variant_id,
      })),
    };
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
    source: unknown,
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
      introducesNewPot: occupancy.introducesNewPotColor,
      id: existing.id,
      existing,
      variantId: occupancy.plantVariantId,
      potId: occupancy.potId,
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
    source: unknown,
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
      inventorySource: source,
      introducesNewPot: occupancy.introducesNewPotColor,
      id: existing.id,
      existing,
      variantId: occupancy.plantVariantId,
      potId: occupancy.potId,
      patch: {
        partnerLocationId: existing.partnerLocationId,
        posNumber: existing.posNumber ?? "1",
        posName: existing.posName,
        ...occupancyToSpotFields(occupancy),
      },
    });
  }

  try {
    await sql`
      DELETE FROM placement_segments
      WHERE placement_cycle_id IN (
        SELECT id FROM placement_cycles
        WHERE pos_spot_id IN (SELECT id FROM pos_spots WHERE spot_slug LIKE 'inv-b-%')
      )
    `;
    await sql`
      DELETE FROM placement_cycles
      WHERE pos_spot_id IN (SELECT id FROM pos_spots WHERE spot_slug LIKE 'inv-b-%')
    `;
    await sql`DELETE FROM pos_spots WHERE spot_slug LIKE 'inv-b-%'`;
    await sql`DELETE FROM offers WHERE id LIKE 'inv-b-offer-%'`;
    const leftoverVariants = await sql`
      SELECT id FROM plant_variants
      WHERE size_label LIKE 'inv-b-%'
    `;
    const leftoverIds = (leftoverVariants as { id: string }[]).map((row) => row.id);
    if (leftoverIds.length > 0) {
      await sql`
        DELETE FROM placement_segments
        WHERE placement_cycle_id IN (
          SELECT id FROM placement_cycles WHERE plant_variant_id = ANY(${leftoverIds}::uuid[])
        )
      `;
      await sql`DELETE FROM placement_cycles WHERE plant_variant_id = ANY(${leftoverIds}::uuid[])`;
      await sql`DELETE FROM inventory_history WHERE variant_id = ANY(${leftoverIds}::uuid[])`;
      await sql`DELETE FROM inventory WHERE variant_id = ANY(${leftoverIds}::uuid[])`;
      await sql`DELETE FROM plant_variants WHERE id = ANY(${leftoverIds}::uuid[])`;
    }

    await applyInventoryDelta({ variantId: variantA, delta: 5, note: `${tag} seed A` });
    assert.equal(await getInventoryQuantity(variantA), 5);
    assert.equal(await getInventoryQuantity(variantB), 0);

    // 1. Place from central decrements by 1 and adds one -1 history row.
    const createOccupancy = await resolveOccupancyForPosCreate({
      offerId: offerA,
      partnerLocationId,
    });
    assert.equal(createOccupancy.action, "place");
    const createdAt = new Date().toISOString();
    const slugPlant = `inv-b-plant-${tag}`;
    const plantSpotInput = {
      id: randomUUID(),
      spotName: slugPlant,
      partnerLocationId,
      posNumber: "71",
      posName: slugPlant,
      spotSlug: slugPlant,
      currentOfferId: createOccupancy.currentOfferId ?? offerA,
      plantVariantId: createOccupancy.plantVariantId ?? variantA,
      status: "available" as const,
      checkStatus: false as const,
      offerPlacedAt: createOccupancy.offerPlacedAt ?? createdAt,
      createdAt,
    };
    spotIds.push(plantSpotInput.id);
    const created = await writePosCreate({
      occupancyAction: createOccupancy.action,
      inventorySource: "central",
      posSpot: plantSpotInput,
      variantId: createOccupancy.plantVariantId,
    });
    assert.equal(created.plantVariantId, variantA);
    assert.equal(await getInventoryQuantity(variantA), 4);
    assert.equal(await minusOneCount(variantA), 1);

    // 2. Zero stock fails with no occupancy/history change.
    const emptyZero = await appendPosSpot(emptySpot(`inv-b-zero-${tag}`, "72"));
    spotIds.push(emptyZero.id);
    const historyEmptyBefore = await historyCount(emptyVariant);
    let zeroFailed = false;
    try {
      await writePlace(emptyZero, emptyVariant, offerEmpty, "central");
    } catch (error) {
      zeroFailed = true;
      assert.ok(error instanceof InventoryChangeError);
      assert.equal(error.code, "insufficient_quantity");
    }
    assert.equal(zeroFailed, true);
    const afterZero = await getPosSpotById(emptyZero.id);
    assert.equal(afterZero?.plantVariantId, undefined);
    assert.equal(await getInventoryQuantity(emptyVariant), 0);
    assert.equal(await historyCount(emptyVariant), historyEmptyBefore);

    await applyInventoryDelta({ variantId: variantB, delta: 4, note: `${tag} seed B` });
    assert.equal(await getInventoryQuantity(variantB), 4);

    // 3. Place already-at-partner changes occupancy only.
    const emptyPartner = await appendPosSpot(emptySpot(`inv-b-atp-${tag}`, "73"));
    spotIds.push(emptyPartner.id);
    const qtyABeforeAtp = await getInventoryQuantity(variantA);
    const histABeforeAtp = await historyCount(variantA);
    const placedAtp = await writePlace(emptyPartner, variantA, offerA, "already_at_partner");
    assert.equal(placedAtp?.plantVariantId, variantA);
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeAtp);
    assert.equal(await historyCount(variantA), histABeforeAtp);

    // 4. Missing source on Place/Replace fails with no writes.
    const emptyMissing = await appendPosSpot(emptySpot(`inv-b-miss-${tag}`, "74"));
    spotIds.push(emptyMissing.id);
    const qtyABeforeMissing = await getInventoryQuantity(variantA);
    let missingFailed = false;
    try {
      await writePlace(emptyMissing, variantA, offerA, undefined);
    } catch (error) {
      missingFailed = true;
      assert.ok(error instanceof PosCentralStockError);
      assert.match(error.message, /inventorySource is required/);
    }
    assert.equal(missingFailed, true);
    assert.equal((await getPosSpotById(emptyMissing.id))?.plantVariantId, undefined);
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeMissing);

    const occupiedForReplace = await getPosSpotById(plantSpotInput.id);
    assert.ok(occupiedForReplace?.plantVariantId);
    let missingReplaceFailed = false;
    try {
      await writeReplace(occupiedForReplace, variantB, offerB, undefined);
    } catch (error) {
      missingReplaceFailed = true;
      assert.ok(error instanceof PosCentralStockError);
    }
    assert.equal(missingReplaceFailed, true);
    assert.equal((await getPosSpotById(plantSpotInput.id))?.plantVariantId, variantA);

    // 5. Replace to another Variant from central decrements only the new Variant.
    const qtyABeforeReplace = await getInventoryQuantity(variantA);
    const qtyBBeforeReplace = await getInventoryQuantity(variantB);
    const histABeforeReplace = await historyCount(variantA);
    const replaced = await writeReplace(
      (await getPosSpotById(plantSpotInput.id))!,
      variantB,
      offerB,
      "central",
    );
    assert.equal(replaced?.plantVariantId, variantB);
    assert.equal(await getInventoryQuantity(variantB), qtyBBeforeReplace - 1);
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeReplace);
    assert.equal(await historyCount(variantA), histABeforeReplace);
    assert.equal(await minusOneCount(variantB), 1);

    // 6. Same-Variant physical Replace from central decrements by 1.
    const qtyBBeforeSame = await getInventoryQuantity(variantB);
    const sameReplaced = await writeReplace(
      (await getPosSpotById(plantSpotInput.id))!,
      variantB,
      offerB,
      "central",
      true,
    );
    assert.equal(sameReplaced?.plantVariantId, variantB);
    assert.equal(await getInventoryQuantity(variantB), qtyBBeforeSame - 1);
    assert.equal(await minusOneCount(variantB), 2);

    // 7. Replace already-at-partner does not affect stock.
    const qtyABeforeAtpReplace = await getInventoryQuantity(variantA);
    const qtyBBeforeAtpReplace = await getInventoryQuantity(variantB);
    const histBBeforeAtpReplace = await historyCount(variantB);
    const replacedAtp = await writeReplace(
      (await getPosSpotById(plantSpotInput.id))!,
      variantA,
      offerA,
      "already_at_partner",
    );
    assert.equal(replacedAtp?.plantVariantId, variantA);
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeAtpReplace);
    assert.equal(await getInventoryQuantity(variantB), qtyBBeforeAtpReplace);
    assert.equal(await historyCount(variantB), histBBeforeAtpReplace);

    // 8. Update / Remove / Deactivate / hold / release / sale / pocket delete do not affect stock.
    const qtyABeforeAdmin = await getInventoryQuantity(variantA);
    const histABeforeAdmin = await historyCount(variantA);
    const occupied = await getPosSpotById(plantSpotInput.id);
    assert.ok(occupied);
    const updated = await resolveOccupancyForPosPatch({
      existing: occupied,
      partnerLocationId,
      occupancyIntent: "update",
      requestedOfferId: offerA,
    });
    assert.equal(updated.action, "update");
    await writePosUpdate({
      occupancyAction: updated.action,
      inventorySource: "central",
      id: occupied.id,
      existing: occupied,
      variantId: occupied.plantVariantId,
      patch: {
        partnerLocationId: occupied.partnerLocationId,
        posNumber: occupied.posNumber ?? "71",
        posName: occupied.posName,
        ...occupancyToSpotFields(updated),
      },
    });
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeAdmin);

    const removedOcc = await resolveOccupancyForPosPatch({
      existing: (await getPosSpotById(plantSpotInput.id))!,
      occupancyIntent: "remove",
    });
    await writePosUpdate({
      occupancyAction: removedOcc.action,
      inventorySource: "central",
      id: plantSpotInput.id,
      existing: (await getPosSpotById(plantSpotInput.id))!,
      variantId: null,
      patch: {
        partnerLocationId,
        posNumber: "71",
        posName: slugPlant,
        ...occupancyToSpotFields(removedOcc),
      },
    });
    assert.equal((await getPosSpotById(plantSpotInput.id))?.plantVariantId, undefined);
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeAdmin);

    await writePlace((await getPosSpotById(plantSpotInput.id))!, variantA, offerA, "already_at_partner");
    await updatePosSpot(plantSpotInput.id, {
      partnerLocationId,
      posNumber: "71",
      posName: slugPlant,
      updateStatus: true,
      status: "inactive",
    });
    assert.equal((await getPosSpotById(plantSpotInput.id))?.status, "inactive");
    assert.equal((await getPosSpotById(plantSpotInput.id))?.plantVariantId, variantA);
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeAdmin);

    await updatePosSpot(plantSpotInput.id, {
      partnerLocationId,
      posNumber: "71",
      posName: slugPlant,
      updateStatus: true,
      status: "available",
    });

    const saleAttempt = randomUUID();
    const saleSession = `cs-inv-${randomUUID()}`;
    await insertPaymentAttempt({
      id: saleAttempt,
      status: "awaiting_payment",
      posSpotId: plantSpotInput.id,
      productId: fixture.plantId,
      productName: "Inv B Verify Plant",
      fullName: "Inv B",
      customerEmail: "inv-b@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      amount: 40,
      checkoutSessionId: saleSession,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    attemptIds.push(saleAttempt);
    const sold = await finalizeVerifiedPaymentAttemptAtomic({
      attemptId: saleAttempt,
      checkoutSessionId: saleSession,
      posSpotId: plantSpotInput.id,
      fulfillmentMethod: "delivery",
    });
    assert.equal(sold.ok, true);
    if (sold.ok) orderIds.push(sold.order.orderId);
    assert.equal((await getPosSpotById(plantSpotInput.id))?.status, "sold");
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeAdmin);
    assert.equal(await historyCount(variantA), histABeforeAdmin);

    const pocket = await createPocket({
      partnerLocationId,
      name: `${tag}-pocket`,
    });
    pocketId = pocket.id;
    const pocketSpot = await appendPosSpot({
      ...emptySpot(`inv-b-pocket-${tag}`, "75"),
      pocketId: pocket.id,
    });
    spotIds.push(pocketSpot.id);
    await writePlace(pocketSpot, variantA, offerA, "already_at_partner");
    const qtyBeforePocket = await getInventoryQuantity(variantA);
    const deleted = await deletePocket(pocket.id);
    assert.equal(deleted.deleted, true);
    pocketId = undefined;
    assert.equal((await getPosSpotById(pocketSpot.id))?.plantVariantId, undefined);
    assert.equal(await getInventoryQuantity(variantA), qtyBeforePocket);

    // 9. Flowers never affect inventory.
    const flowerCreate = await resolveOccupancyForPosCreate({
      offerId: offerFlower,
      partnerLocationId,
    });
    assert.equal(flowerCreate.action, "update");
    const slugFlower = `inv-b-flower-${tag}`;
    const flowerSpot = {
      id: randomUUID(),
      spotName: slugFlower,
      partnerLocationId,
      posNumber: "76",
      posName: slugFlower,
      spotSlug: slugFlower,
      currentOfferId: offerFlower,
      status: "available" as const,
      checkStatus: false as const,
      createdAt: new Date().toISOString(),
    };
    spotIds.push(flowerSpot.id);
    const qtyABeforeFlower = await getInventoryQuantity(variantA);
    await writePosCreate({
      occupancyAction: flowerCreate.action,
      inventorySource: undefined,
      posSpot: flowerSpot,
      variantId: null,
    });
    assert.equal((await getPosSpotById(flowerSpot.id))?.plantVariantId, undefined);
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeFlower);

    // 10. Failed/raced POS write rolls back stock/history.
    const racedEmpty = await appendPosSpot(emptySpot(`inv-b-race-${tag}`, "77"));
    spotIds.push(racedEmpty.id);
    const stale = await getPosSpotById(racedEmpty.id);
    assert.ok(stale);
    await sql`
      UPDATE pos_spots
      SET plant_variant_id = ${variantA}::uuid, current_offer_id = ${offerA}
      WHERE id = ${racedEmpty.id}::uuid
    `;
    const qtyABeforeRace = await getInventoryQuantity(variantA);
    const histABeforeRace = await historyCount(variantA);
    const raceOccupancy = await resolveOccupancyForPosPatch({
      existing: stale,
      partnerLocationId,
      occupancyIntent: "place",
      requestedOfferId: offerA,
    });
    let raceFailed = false;
    try {
      await commitPosUpdateFromCentral({
        id: racedEmpty.id,
        existing: stale,
        variantId: variantA,
        action: "place",
        decrementPlant: true,
        decrementPot: false,
        patch: {
          partnerLocationId,
          posNumber: stale.posNumber ?? "77",
          posName: stale.posName,
          ...occupancyToSpotFields(raceOccupancy),
        },
      });
    } catch (error) {
      raceFailed = true;
      assert.ok(error instanceof OccupancyWriteFailedError);
    }
    assert.equal(raceFailed, true);
    assert.equal(await getInventoryQuantity(variantA), qtyABeforeRace);
    assert.equal(await historyCount(variantA), histABeforeRace);

    // 10b. Plant decrement + failed Pot Color write rolls Place/Replace/Update back.
    async function assertPotWriteRolledBack(run: () => Promise<unknown>, before: {
      spotId: string;
      occupancy: Awaited<ReturnType<typeof occupancySnapshot>>;
      plantQty: number;
      plantHist: number;
      colorAQty: number;
      colorBQty: number;
    }) {
      let failed = false;
      try {
        await run();
      } catch (error) {
        failed = true;
        assert.ok(
          error instanceof PotInventoryChangeError ||
            error instanceof OccupancyWriteFailedError ||
            error instanceof InventoryChangeError,
          String(error),
        );
      }
      assert.equal(failed, true);
      assert.deepEqual(await occupancySnapshot(before.spotId), before.occupancy);
      assert.equal(await getInventoryQuantity(variantA), before.plantQty);
      assert.equal(await historyCount(variantA), before.plantHist);
      assert.equal(await getPotInventoryQuantity(fixture.potId), before.colorAQty);
      assert.equal(await getPotInventoryQuantity(fixture.potBId), before.colorBQty);
    }

    await drainPot(fixture.potId);
    await drainPot(fixture.potBId);
    if ((await getInventoryQuantity(variantA)) < 1) {
      await applyInventoryDelta({ variantId: variantA, delta: 2, note: `${tag} pot-fail plant` });
    }

    const failPlaceSpot = await appendPosSpot(emptySpot(`inv-b-potfail-place-${tag}`, "80"));
    spotIds.push(failPlaceSpot.id);
    await assertPotWriteRolledBack(
      () => writePlace(failPlaceSpot, variantA, fixture.offerPot, "central"),
      {
        spotId: failPlaceSpot.id,
        occupancy: await occupancySnapshot(failPlaceSpot.id),
        plantQty: await getInventoryQuantity(variantA),
        plantHist: await historyCount(variantA),
        colorAQty: await getPotInventoryQuantity(fixture.potId),
        colorBQty: await getPotInventoryQuantity(fixture.potBId),
      },
    );

    const failReplaceSpot = await appendPosSpot(emptySpot(`inv-b-potfail-replace-${tag}`, "81"));
    spotIds.push(failReplaceSpot.id);
    await writePlace(failReplaceSpot, variantA, offerA, "already_at_partner");
    await assertPotWriteRolledBack(
      async () => {
        const occupied = await getPosSpotById(failReplaceSpot.id);
        assert.ok(occupied);
        return writeReplace(occupied, variantA, fixture.offerPot, "central", false);
      },
      {
        spotId: failReplaceSpot.id,
        occupancy: await occupancySnapshot(failReplaceSpot.id),
        plantQty: await getInventoryQuantity(variantA),
        plantHist: await historyCount(variantA),
        colorAQty: await getPotInventoryQuantity(fixture.potId),
        colorBQty: await getPotInventoryQuantity(fixture.potBId),
      },
    );

    const failUpdateSpot = await appendPosSpot(emptySpot(`inv-b-potfail-update-${tag}`, "82"));
    spotIds.push(failUpdateSpot.id);
    await writePlace(failUpdateSpot, variantA, fixture.offerPot, "already_at_partner");
    const failUpdateExisting = await getPosSpotById(failUpdateSpot.id);
    assert.ok(failUpdateExisting);
    const failUpdateOccupancy = await resolveOccupancyForPosPatch({
      existing: failUpdateExisting,
      partnerLocationId,
      occupancyIntent: "update",
      requestedOfferId: fixture.offerPotB,
    });
    assert.equal(failUpdateOccupancy.introducesNewPotColor, true);
    assert.equal(failUpdateOccupancy.potId, fixture.potBId);
    await assertPotWriteRolledBack(
      () =>
        writePosUpdate({
          occupancyAction: failUpdateOccupancy.action,
          inventorySource: "central",
          introducesNewPot: failUpdateOccupancy.introducesNewPotColor,
          id: failUpdateSpot.id,
          existing: failUpdateExisting,
          variantId: failUpdateOccupancy.plantVariantId,
          potId: failUpdateOccupancy.potId,
          patch: {
            partnerLocationId,
            posNumber: failUpdateExisting.posNumber ?? "82",
            posName: failUpdateExisting.posName,
            ...occupancyToSpotFields(failUpdateOccupancy),
          },
        }),
      {
        spotId: failUpdateSpot.id,
        occupancy: await occupancySnapshot(failUpdateSpot.id),
        plantQty: await getInventoryQuantity(variantA),
        plantHist: await historyCount(variantA),
        colorAQty: await getPotInventoryQuantity(fixture.potId),
        colorBQty: await getPotInventoryQuantity(fixture.potBId),
      },
    );

    // 11. Two concurrent Places using the last unit allow only one success.
    const lastQty = await getInventoryQuantity(lastVariant);
    if (lastQty > 1) {
      await applyInventoryDelta({
        variantId: lastVariant,
        delta: 1 - lastQty,
        note: `${tag} last unit`,
      });
    } else if (lastQty === 0) {
      await applyInventoryDelta({ variantId: lastVariant, delta: 1, note: `${tag} last unit` });
    }
    const concurrentOne = await appendPosSpot(emptySpot(`inv-b-c1-${tag}`, "78"));
    const concurrentTwo = await appendPosSpot(emptySpot(`inv-b-c2-${tag}`, "79"));
    spotIds.push(concurrentOne.id, concurrentTwo.id);
    const results = await Promise.allSettled([
      writePlace(concurrentOne, lastVariant, offerLast, "central"),
      writePlace(concurrentTwo, lastVariant, offerLast, "central"),
    ]);
    const fulfilled = results.filter((row) => row.status === "fulfilled");
    const rejected = results.filter((row) => row.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(rejectedReason instanceof InventoryChangeError);
    assert.equal(rejectedReason.code, "insufficient_quantity");
    assert.equal(await getInventoryQuantity(lastVariant), 0);
    const occupiedCount = [(await getPosSpotById(concurrentOne.id))?.plantVariantId, (await getPosSpotById(concurrentTwo.id))?.plantVariantId].filter(
      (id) => id === lastVariant,
    ).length;
    assert.equal(occupiedCount, 1);

    console.log("verify-pos-central-inventory: place/replace/stock/concurrency ok");
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

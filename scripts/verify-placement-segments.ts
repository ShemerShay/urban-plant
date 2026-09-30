/**
 * Placement Segment: exposure history inside one Placement Cycle.
 *
 * Run: npx tsx scripts/verify-placement-segments.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function splitSqlStatements(source: string): string[] {
  const withoutComments = source.replace(/--[^\n]*/g, "");
  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^(BEGIN|COMMIT)$/i.test(statement));
}

function assertStaticBoundaries(): void {
  const migration = read("db/migrations/039_placement_segments.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS placement_segments/);
  assert.match(migration, /pocket_name/);
  assert.match(migration, /consumer_price/);
  assert.match(migration, /placement_segments_one_open_per_cycle/);
  assert.doesNotMatch(migration, /end_reason/);
  assert.doesNotMatch(migration, /REFERENCES pockets/i);
  assert.doesNotMatch(migration, /c\.started_at/);
  assert.match(migration, /ended_at IS NULL/);
  assert.match(migration, /NOT EXISTS/);
  const insert = splitSqlStatements(migration).find((statement) =>
    statement.startsWith("INSERT INTO placement_segments"),
  );
  assert.ok(insert, "go-live insert missing");
  assert.match(insert, /now\(\)/);
  assert.match(insert, /c\.ended_at IS NULL/);
  assert.match(insert, /p\.pocket_id/);
  assert.match(insert, /ELSE NULL/);
  assert.match(insert, /o\.consumer_price IS NOT NULL/);
  assert.doesNotMatch(insert, /p\.pocket_id IS NULL/);
  assert.match(migration, /pocket_name IS NULL\s+OR/);

  const occupancy = read("lib/posOccupancy.ts");
  assert.doesNotMatch(occupancy, /placement_segments/);
  const events = read("lib/eventTypes.ts");
  assert.doesNotMatch(events, /placement_segments/);

  console.log("verify-placement-segments: static schema boundaries ok");
}

type SegmentRow = {
  id: string;
  placement_cycle_id: string;
  started_at: string | Date;
  ended_at: string | Date | null;
  pocket_id: string | null;
  pocket_name: string | null;
  offer_id: string;
  consumer_price: string | number;
  pos_spot_id: string;
};

function priceOf(row: SegmentRow): number {
  return Number(row.consumer_price);
}

async function main(): Promise<void> {
  assertStaticBoundaries();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const { sql } = await import("../lib/db");
  const {
    acquirePosSpotHoldForPayment,
    appendPosSpot,
    completePosSpotSaleFromHold,
    getPosSpotById,
    releasePosSpotHoldForPayment,
    updatePosSpot,
  } = await import("../lib/posSpotStorage");
  const { createPocket, deletePocket, updatePocket } = await import("../lib/pocketStorage");
  const { updateOffer } = await import("../lib/offerStorage");
  const {
    occupancyToSpotFields,
    resolveOccupancyForPosCreate,
    resolveOccupancyForPosPatch,
  } = await import("../lib/posOccupancy");
  const { OccupancyWriteFailedError, writePosCreate, writePosUpdate } = await import(
    "../lib/posCentralStock"
  );
  const { InventoryChangeError } = await import("../lib/inventoryStorage");
  const { deletePaymentAttemptById, finalizeVerifiedPaymentAttemptAtomic, insertPaymentAttempt } =
    await import("../lib/paymentAttemptStorage");

  const cols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'placement_segments'
  `;
  const colNames = new Set((cols as { column_name: string }[]).map((row) => row.column_name));
  for (const name of [
    "id",
    "placement_cycle_id",
    "started_at",
    "ended_at",
    "pocket_id",
    "pocket_name",
    "offer_id",
    "consumer_price",
  ]) {
    assert.equal(colNames.has(name), true, `missing column ${name}`);
  }
  assert.equal(colNames.has("end_reason"), false);
  assert.equal(colNames.has("pos_spot_id"), false);
  assert.equal(colNames.has("plant_variant_id"), false);

  const pocketFk = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'placement_segments'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%pockets%'
  `;
  assert.equal((pocketFk as { conname: string }[]).length, 0);

  const uniq = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'placement_segments_one_open_per_cycle'
  `;
  assert.equal((uniq as { indexname: string }[]).length, 1);

  const partners = await sql`SELECT id, name, address FROM partner_locations LIMIT 1`;
  const partner = (partners as { id: string; name: string; address: string }[])[0];
  assert.ok(partner, "need a partner location");
  const partnerLocationId = partner.id;

  const plants = await sql`
    SELECT id, inventory_type
    FROM plants
    ORDER BY created_at ASC NULLS LAST, id ASC
  `;
  const plantRows = plants as { id: string; inventory_type: string | null }[];
  const plant = plantRows.find((row) => (row.inventory_type ?? "plants") === "plants");
  const flower = plantRows.find((row) => row.inventory_type === "flowers");
  assert.ok(plant, "need a plant catalog row");
  assert.ok(flower, "need a flower catalog row");

  const tag = `seg-${randomUUID().slice(0, 8)}`;
  const variantA = randomUUID();
  const variantB = randomUUID();
  const emptyVariant = randomUUID();
  const offerA = `seg-offer-a-${tag}`;
  const offerA2 = `seg-offer-a2-${tag}`;
  const offerShared = `seg-offer-s-${tag}`;
  const offerOther = `seg-offer-o-${tag}`;
  const offerFlower = `seg-offer-f-${tag}`;
  const offerEmpty = `seg-offer-e-${tag}`;
  const offerLegacy = `seg-offer-l-${tag}`;
  const spotIds: string[] = [];
  const attemptIds: string[] = [];
  const orderIds: string[] = [];
  const pocketIds: string[] = [];

  async function segmentsFor(posSpotId: string): Promise<SegmentRow[]> {
    return (await sql`
      SELECT
        s.id,
        s.placement_cycle_id,
        s.started_at,
        s.ended_at,
        s.pocket_id,
        s.pocket_name,
        s.offer_id,
        s.consumer_price,
        c.pos_spot_id
      FROM placement_segments s
      INNER JOIN placement_cycles c ON c.id = s.placement_cycle_id
      WHERE c.pos_spot_id = ${posSpotId}::uuid
      ORDER BY s.started_at ASC, s.id ASC
    `) as SegmentRow[];
  }

  function openSegments(rows: SegmentRow[]): SegmentRow[] {
    return rows.filter((row) => row.ended_at == null);
  }

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

  async function placeOn(
    existing: NonNullable<Awaited<ReturnType<typeof getPosSpotById>>>,
    variantId: string,
    offerId: string,
    source: unknown = "already_at_partner",
  ) {
    const occupancy = await resolveOccupancyForPosPatch({
      existing,
      occupancyIntent: "place",
      requestedVariantId: variantId,
      requestedOfferId: offerId,
    });
    return writePosUpdate({
      occupancyAction: occupancy.action,
      inventorySource: source,
      id: existing.id,
      existing,
      variantId: occupancy.plantVariantId,
      patch: {
        partnerLocationId,
        posNumber: existing.posNumber ?? "1",
        posName: existing.posName,
        ...occupancyToSpotFields(occupancy),
      },
    });
  }

  async function patchSpot(
    id: string,
    extra: Record<string, unknown>,
    occupancyIntent?: "update" | "replace" | "remove",
    sameVariantReplace = false,
  ) {
    const existing = await getPosSpotById(id);
    assert.ok(existing);
    const occupancy = await resolveOccupancyForPosPatch({
      existing,
      occupancyIntent: occupancyIntent ?? null,
      requestedOfferId:
        "currentOfferId" in extra ? (extra.currentOfferId as string | null) : undefined,
      requestedVariantId:
        "plantVariantId" in extra ? (extra.plantVariantId as string | null) : undefined,
      sameVariantReplace,
    });
    return writePosUpdate({
      occupancyAction: occupancy.action,
      inventorySource: "already_at_partner",
      id,
      existing,
      variantId: occupancy.plantVariantId,
      patch: {
        partnerLocationId,
        posNumber: existing.posNumber ?? "1",
        posName: existing.posName,
        ...occupancyToSpotFields(occupancy),
        ...extra,
      },
    });
  }

  const goLiveInsert = splitSqlStatements(read("db/migrations/039_placement_segments.sql")).find(
    (statement) => statement.startsWith("INSERT INTO placement_segments"),
  );
  assert.ok(goLiveInsert);

  try {
    await sql`
      INSERT INTO plant_variants (id, plant_id, size_label)
      VALUES
        (${variantA}::uuid, ${plant.id}, ${`${tag}-small`}),
        (${variantB}::uuid, ${plant.id}, ${`${tag}-large`}),
        (${emptyVariant}::uuid, ${plant.id}, ${`${tag}-empty`})
    `;
    await sql`
      INSERT INTO offers (id, product_id, variant_id, consumer_price, status, created_at)
      VALUES
        (${offerA}, ${plant.id}, ${variantA}::uuid, 40, 'active', now()),
        (${offerA2}, ${plant.id}, ${variantA}::uuid, 44, 'active', now()),
        (${offerShared}, ${plant.id}, ${variantA}::uuid, 40, 'active', now()),
        (${offerOther}, ${plant.id}, ${variantB}::uuid, 55, 'active', now()),
        (${offerFlower}, ${flower.id}, NULL, 25, 'active', now()),
        (${offerEmpty}, ${plant.id}, ${emptyVariant}::uuid, 12, 'active', now()),
        (${offerLegacy}, ${plant.id}, NULL, 33, 'active', now())
    `;

    const pocketA = await createPocket({ partnerLocationId, name: `${tag}-shelf` });
    const pocketB = await createPocket({ partnerLocationId, name: `${tag}-window` });
    const pocketC = await createPocket({ partnerLocationId, name: `${tag}-counter` });
    pocketIds.push(pocketA.id, pocketB.id, pocketC.id);

    const created = await writePosCreate({
      occupancyAction: "place",
      inventorySource: "already_at_partner",
      posSpot: {
        ...emptySpot(`seg-plant-${tag}`, "9101"),
        currentOfferId: offerA,
        plantVariantId: variantA,
        offerPlacedAt: new Date().toISOString(),
      },
      variantId: variantA,
    });
    spotIds.push(created.id);
    let rows = await segmentsFor(created.id);
    assert.equal(rows.length, 1);
    assert.equal(openSegments(rows).length, 1);
    assert.equal(rows[0].offer_id, offerA);
    assert.equal(priceOf(rows[0]), 40);
    assert.equal(rows[0].pocket_id, null);
    assert.equal(rows[0].pocket_name, null);
    const firstSegmentId = rows[0].id;
    const firstCycleId = rows[0].placement_cycle_id;

    await updatePosSpot(created.id, {
      partnerLocationId,
      posNumber: "9101",
      posName: created.posName,
      updatePosWeeklyNote: true,
      posWeeklyNote: "watered",
      spotDescription: "by the door",
    });
    rows = await segmentsFor(created.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, firstSegmentId);

    const holdAttempt = randomUUID();
    const now = new Date().toISOString();
    await insertPaymentAttempt({
      id: holdAttempt,
      status: "created",
      posSpotId: created.id,
      offerId: offerA,
      productId: plant.id,
      productName: "Segment Verify Plant",
      fullName: "Segment Verify",
      customerEmail: "segment-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      amount: 40,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    attemptIds.push(holdAttempt);
    assert.equal((await acquirePosSpotHoldForPayment(created.id, holdAttempt)).ok, true);
    assert.equal((await releasePosSpotHoldForPayment(created.id, holdAttempt)).ok, true);
    rows = await segmentsFor(created.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, firstSegmentId);

    await updatePosSpot(created.id, {
      partnerLocationId,
      posNumber: "9101",
      posName: created.posName,
      updatePocketId: true,
      pocketId: pocketA.id,
    });
    rows = await segmentsFor(created.id);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, firstSegmentId);
    assert.equal(rows[0].pocket_id, null);
    assert.ok(rows[0].ended_at);
    assert.equal(openSegments(rows).length, 1);
    assert.equal(openSegments(rows)[0].pocket_id, pocketA.id);
    assert.equal(openSegments(rows)[0].pocket_name, `${tag}-shelf`);
    assert.equal(openSegments(rows)[0].placement_cycle_id, firstCycleId);
    assert.equal(priceOf(openSegments(rows)[0]), 40);
    const pocketSegmentId = openSegments(rows)[0].id;

    await updatePosSpot(created.id, {
      partnerLocationId,
      posNumber: "9101",
      posName: created.posName,
      updatePocketId: true,
      pocketId: pocketA.id,
    });
    rows = await segmentsFor(created.id);
    assert.equal(rows.length, 2);
    assert.equal(openSegments(rows)[0].id, pocketSegmentId);

    const renamed = await updatePocket(pocketA.id, { name: `${tag}-shelf-west` });
    assert.equal(renamed?.name, `${tag}-shelf-west`);
    rows = await segmentsFor(created.id);
    assert.equal(rows.length, 2);
    assert.equal(openSegments(rows)[0].id, pocketSegmentId);
    assert.equal(openSegments(rows)[0].pocket_name, `${tag}-shelf`);

    await patchSpot(created.id, { currentOfferId: offerA2 });
    rows = await segmentsFor(created.id);
    assert.equal(rows.length, 3);
    assert.equal(rows[1].id, pocketSegmentId);
    assert.equal(rows[1].offer_id, offerA);
    assert.equal(rows[1].pocket_name, `${tag}-shelf`);
    assert.equal(priceOf(rows[1]), 40);
    assert.ok(rows[1].ended_at);
    assert.equal(openSegments(rows).length, 1);
    assert.equal(openSegments(rows)[0].offer_id, offerA2);
    assert.equal(priceOf(openSegments(rows)[0]), 44);
    assert.equal(openSegments(rows)[0].pocket_id, pocketA.id);
    assert.equal(openSegments(rows)[0].pocket_name, `${tag}-shelf-west`);
    assert.equal(openSegments(rows)[0].placement_cycle_id, firstCycleId);

    const beforeBoth = (await segmentsFor(created.id)).length;
    await updatePosSpot(created.id, {
      partnerLocationId,
      posNumber: "9101",
      posName: created.posName,
      updatePocketId: true,
      pocketId: pocketB.id,
      currentOfferId: offerA,
      plantVariantId: variantA,
    });
    rows = await segmentsFor(created.id);
    assert.equal(rows.length, beforeBoth + 1);
    assert.equal(openSegments(rows).length, 1);
    assert.equal(openSegments(rows)[0].pocket_id, pocketB.id);
    assert.equal(openSegments(rows)[0].pocket_name, `${tag}-window`);
    assert.equal(openSegments(rows)[0].offer_id, offerA);
    assert.equal(priceOf(rows.find((row) => row.id === pocketSegmentId)!), 40);
    assert.equal(rows.find((row) => row.id === pocketSegmentId)?.pocket_name, `${tag}-shelf`);

    const replaced = await patchSpot(
      created.id,
      { currentOfferId: offerOther, plantVariantId: variantB },
      "replace",
    );
    assert.equal(replaced?.plantVariantId, variantB);
    rows = await segmentsFor(created.id);
    const oldCycleSegments = rows.filter((row) => row.placement_cycle_id === firstCycleId);
    assert.equal(openSegments(oldCycleSegments).length, 0);
    const newCycleOpen = openSegments(rows);
    assert.equal(newCycleOpen.length, 1);
    assert.notEqual(newCycleOpen[0].placement_cycle_id, firstCycleId);
    assert.equal(newCycleOpen[0].offer_id, offerOther);
    assert.equal(priceOf(newCycleOpen[0]), 55);
    assert.equal(rows.find((row) => row.id === firstSegmentId)?.pocket_id, null);
    assert.equal(priceOf(rows.find((row) => row.id === pocketSegmentId)!), 40);

    await patchSpot(created.id, { currentOfferId: offerOther, plantVariantId: variantB }, "replace", true);
    rows = await segmentsFor(created.id);
    assert.equal(openSegments(rows).length, 1);
    assert.equal(
      rows.filter((row) => row.placement_cycle_id === newCycleOpen[0].placement_cycle_id && row.ended_at)
        .length,
      1,
    );

    await patchSpot(created.id, { currentOfferId: null }, "remove");
    rows = await segmentsFor(created.id);
    assert.equal(openSegments(rows).length, 0);

    await placeOn((await getPosSpotById(created.id))!, variantA, offerA);
    await updatePosSpot(created.id, {
      partnerLocationId,
      posNumber: "9101",
      posName: created.posName,
      updateStatus: true,
      status: "inactive",
    });
    rows = await segmentsFor(created.id);
    assert.equal(openSegments(rows).length, 0);
    assert.equal((await getPosSpotById(created.id))?.plantVariantId, variantA);

    await updatePosSpot(created.id, {
      partnerLocationId,
      posNumber: "9101",
      posName: created.posName,
      updateStatus: true,
      status: "available",
    });
    rows = await segmentsFor(created.id);
    assert.equal(openSegments(rows).length, 1);
    const reactivated = openSegments(rows)[0];
    assert.equal(reactivated.offer_id, offerA);
    assert.equal(priceOf(reactivated), 40);

    await patchSpot(created.id, { currentOfferId: offerFlower });
    rows = await segmentsFor(created.id);
    assert.equal(openSegments(rows).length, 0);
    assert.equal((await getPosSpotById(created.id))?.plantVariantId, undefined);

    const flowerCreate = await resolveOccupancyForPosCreate({ offerId: offerFlower });
    const flowerSpot = await writePosCreate({
      occupancyAction: flowerCreate.action,
      inventorySource: "already_at_partner",
      posSpot: {
        ...emptySpot(`seg-flower-${tag}`, "9102"),
        currentOfferId: offerFlower,
        offerPlacedAt: new Date().toISOString(),
      },
      variantId: null,
    });
    spotIds.push(flowerSpot.id);
    assert.equal((await segmentsFor(flowerSpot.id)).length, 0);

    const legacy = await appendPosSpot({
      ...emptySpot(`seg-legacy-${tag}`, "9103"),
      currentOfferId: offerLegacy,
    });
    spotIds.push(legacy.id);
    assert.equal((await segmentsFor(legacy.id)).length, 0);
    const assigned = await resolveOccupancyForPosPatch({
      existing: legacy,
      occupancyIntent: "assign_variant",
      requestedVariantId: variantA,
      requestedOfferId: offerA,
    });
    await writePosUpdate({
      occupancyAction: assigned.action,
      inventorySource: "already_at_partner",
      id: legacy.id,
      existing: legacy,
      variantId: assigned.plantVariantId,
      patch: {
        partnerLocationId,
        posNumber: "9103",
        posName: legacy.posName,
        ...occupancyToSpotFields(assigned),
      },
    });
    rows = await segmentsFor(legacy.id);
    assert.equal(rows.length, 1);
    assert.equal(openSegments(rows).length, 1);
    assert.equal(rows[0].offer_id, offerA);

    const sharedA = await appendPosSpot(emptySpot(`seg-shared-a-${tag}`, "9104"));
    const sharedB = await appendPosSpot(emptySpot(`seg-shared-b-${tag}`, "9105"));
    const otherSpot = await appendPosSpot(emptySpot(`seg-other-${tag}`, "9106"));
    const closedSpot = await appendPosSpot(emptySpot(`seg-closed-${tag}`, "9107"));
    spotIds.push(sharedA.id, sharedB.id, otherSpot.id, closedSpot.id);
    await placeOn(sharedA, variantA, offerShared);
    await placeOn(sharedB, variantA, offerShared);
    await placeOn(otherSpot, variantB, offerOther);
    await placeOn(closedSpot, variantA, offerShared);
    await patchSpot(closedSpot.id, { currentOfferId: null }, "remove");
    const closedHistory = await segmentsFor(closedSpot.id);
    assert.equal(openSegments(closedHistory).length, 0);
    assert.equal(priceOf(closedHistory[0]), 40);
    const sharedBefore = (await segmentsFor(sharedA.id)).length;
    const otherBefore = await segmentsFor(otherSpot.id);

    await updateOffer(offerShared, { consumerPrice: 40, status: "inactive" });
    assert.equal((await segmentsFor(sharedA.id)).length, sharedBefore);
    await updateOffer(offerShared, { status: "active", productId: plant.id });
    assert.equal((await segmentsFor(sharedA.id)).length, sharedBefore);

    await updateOffer(offerShared, { consumerPrice: 48 });
    const sharedARows = await segmentsFor(sharedA.id);
    const sharedBRows = await segmentsFor(sharedB.id);
    assert.equal(sharedARows.length, sharedBefore + 1);
    assert.equal(sharedBRows.length, 2);
    assert.equal(priceOf(sharedARows[0]), 40);
    assert.equal(priceOf(openSegments(sharedARows)[0]), 48);
    assert.equal(priceOf(openSegments(sharedBRows)[0]), 48);
    assert.equal(openSegments(sharedARows)[0].offer_id, offerShared);
    assert.equal((await segmentsFor(otherSpot.id)).length, otherBefore.length);
    assert.equal(priceOf(openSegments(await segmentsFor(otherSpot.id))[0]), 55);
    const closedAfterPrice = await segmentsFor(closedSpot.id);
    assert.equal(closedAfterPrice.length, closedHistory.length);
    assert.equal(priceOf(closedAfterPrice[0]), 40);
    assert.equal(openSegments(closedAfterPrice).length, 0);

    await updateOffer(offerShared, { consumerPrice: 48 });
    assert.equal((await segmentsFor(sharedA.id)).length, sharedARows.length);

    const deleteSpot = await appendPosSpot(emptySpot(`seg-del-${tag}`, "9108"));
    spotIds.push(deleteSpot.id);
    await placeOn(deleteSpot, variantA, offerA);
    await updatePosSpot(deleteSpot.id, {
      partnerLocationId,
      posNumber: "9108",
      posName: deleteSpot.posName,
      updatePocketId: true,
      pocketId: pocketC.id,
    });
    const beforeDelete = await segmentsFor(deleteSpot.id);
    const named = openSegments(beforeDelete)[0];
    assert.equal(named.pocket_name, `${tag}-counter`);
    const removedPocket = await deletePocket(pocketC.id);
    assert.equal(removedPocket.deleted, true);
    pocketIds.splice(pocketIds.indexOf(pocketC.id), 1);
    const afterDelete = await segmentsFor(deleteSpot.id);
    assert.equal(openSegments(afterDelete).length, 0);
    const preserved = afterDelete.find((row) => row.id === named.id);
    assert.equal(preserved?.pocket_id, pocketC.id);
    assert.equal(preserved?.pocket_name, `${tag}-counter`);
    const pocketGone = await sql`SELECT id FROM pockets WHERE id = ${pocketC.id}::uuid`;
    assert.equal((pocketGone as { id: string }[]).length, 0);

    const saleSpot = await appendPosSpot(emptySpot(`seg-sale-${tag}`, "9109"));
    spotIds.push(saleSpot.id);
    await placeOn(saleSpot, variantA, offerA);
    const saleOpen = openSegments(await segmentsFor(saleSpot.id))[0];
    const saleAttempt = randomUUID();
    const saleSession = `cs-seg-${randomUUID()}`;
    await insertPaymentAttempt({
      id: saleAttempt,
      status: "awaiting_payment",
      posSpotId: saleSpot.id,
      offerId: offerA,
      productId: plant.id,
      productName: "Segment Verify Plant",
      fullName: "Segment Verify",
      customerEmail: "segment-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "pickup",
      amount: 40,
      checkoutSessionId: saleSession,
      paymentResumeToken: `resume-${randomUUID()}`,
      snapshot: {
        productId: plant.id,
        productName: "Segment Verify Plant",
        offerId: offerA,
        consumerPrice: 40,
        fulfillmentType: "pickup",
        partnerLocationId,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    attemptIds.push(saleAttempt);
    assert.equal((await acquirePosSpotHoldForPayment(saleSpot.id, saleAttempt)).ok, true);
    const sold = await finalizeVerifiedPaymentAttemptAtomic({
      attemptId: saleAttempt,
      checkoutSessionId: saleSession,
      posSpotId: saleSpot.id,
      fulfillmentMethod: "pickup",
    });
    assert.equal(sold.ok, true);
    if (sold.ok) orderIds.push(sold.order.orderId);
    rows = await segmentsFor(saleSpot.id);
    assert.equal(openSegments(rows).length, 0);
    assert.equal(rows.find((row) => row.id === saleOpen.id)?.offer_id, offerA);
    assert.equal(priceOf(rows.find((row) => row.id === saleOpen.id)!), 40);
    const dup = await finalizeVerifiedPaymentAttemptAtomic({
      attemptId: saleAttempt,
      checkoutSessionId: saleSession,
      posSpotId: saleSpot.id,
      fulfillmentMethod: "pickup",
    });
    assert.equal(dup.ok, false);
    assert.equal((await segmentsFor(saleSpot.id)).length, rows.length);

    const holdSale = await appendPosSpot(emptySpot(`seg-holdsale-${tag}`, "9110"));
    spotIds.push(holdSale.id);
    await placeOn(holdSale, variantA, offerA);
    const holdSaleAttempt = randomUUID();
    await insertPaymentAttempt({
      id: holdSaleAttempt,
      status: "awaiting_payment",
      posSpotId: holdSale.id,
      offerId: offerA,
      productId: plant.id,
      productName: "Segment Verify Plant",
      fullName: "Segment Verify",
      customerEmail: "segment-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "pickup",
      amount: 40,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    attemptIds.push(holdSaleAttempt);
    assert.equal((await acquirePosSpotHoldForPayment(holdSale.id, holdSaleAttempt)).ok, true);
    const directSold = await completePosSpotSaleFromHold(holdSale.id, holdSaleAttempt);
    assert.equal(directSold.ok, true);
    assert.equal(openSegments(await segmentsFor(holdSale.id)).length, 0);

    const failSpot = await appendPosSpot(emptySpot(`seg-fail-${tag}`, "9111"));
    spotIds.push(failSpot.id);
    let zeroFailed = false;
    try {
      await placeOn(failSpot, emptyVariant, offerEmpty, "central");
    } catch (error) {
      zeroFailed = true;
      assert.ok(
        error instanceof OccupancyWriteFailedError || error instanceof InventoryChangeError,
      );
    }
    assert.equal(zeroFailed, true);
    assert.equal((await segmentsFor(failSpot.id)).length, 0);
    assert.equal((await getPosSpotById(failSpot.id))?.plantVariantId, undefined);

    const raceSpot = await appendPosSpot(emptySpot(`seg-race-${tag}`, "9112"));
    spotIds.push(raceSpot.id);
    await placeOn(raceSpot, variantA, offerA);
    const raceCycle = openSegments(await segmentsFor(raceSpot.id))[0].placement_cycle_id;
    const results = await Promise.allSettled([
      updatePosSpot(raceSpot.id, {
        partnerLocationId,
        posNumber: "9112",
        posName: raceSpot.posName,
        updatePocketId: true,
        pocketId: pocketA.id,
      }),
      updatePosSpot(raceSpot.id, {
        partnerLocationId,
        posNumber: "9112",
        posName: raceSpot.posName,
        updatePocketId: true,
        pocketId: pocketB.id,
      }),
    ]);
    assert.ok(results.some((result) => result.status === "fulfilled"));
    const raceRows = await segmentsFor(raceSpot.id);
    assert.equal(openSegments(raceRows).length, 1);
    const raceSpotRow = await getPosSpotById(raceSpot.id);
    assert.equal(openSegments(raceRows)[0].pocket_id ?? null, raceSpotRow?.pocketId ?? null);
    assert.equal(openSegments(raceRows)[0].placement_cycle_id, raceCycle);
    const doubles = await sql`
      SELECT placement_cycle_id
      FROM placement_segments
      WHERE ended_at IS NULL
        AND placement_cycle_id = ${raceCycle}::uuid
      GROUP BY placement_cycle_id
      HAVING COUNT(*) > 1
    `;
    assert.equal((doubles as { placement_cycle_id: string }[]).length, 0);

    let duplicateRejected = false;
    try {
      const openRow = openSegments(raceRows)[0];
      await sql`
        INSERT INTO placement_segments (
          placement_cycle_id, started_at, ended_at, pocket_id, pocket_name, offer_id, consumer_price
        )
        VALUES (
          ${openRow.placement_cycle_id}::uuid,
          now(),
          NULL,
          ${openRow.pocket_id}::uuid,
          ${openRow.pocket_name},
          ${openRow.offer_id},
          ${priceOf(openRow)}
        )
      `;
    } catch {
      duplicateRejected = true;
    }
    assert.equal(duplicateRejected, true);
    assert.equal(openSegments(await segmentsFor(raceSpot.id)).length, 1);

    const migrateSpot = await appendPosSpot(emptySpot(`seg-live-${tag}`, "9113"));
    spotIds.push(migrateSpot.id);
    await placeOn(migrateSpot, variantA, offerA);
    await updatePosSpot(migrateSpot.id, {
      partnerLocationId,
      posNumber: "9113",
      posName: migrateSpot.posName,
      updatePocketId: true,
      pocketId: pocketB.id,
    });
    const liveCycle = openSegments(await segmentsFor(migrateSpot.id))[0].placement_cycle_id;
    await sql`
      UPDATE placement_cycles
      SET started_at = '2020-01-01T00:00:00.000Z'
      WHERE id = ${liveCycle}::uuid
    `;
    await sql`DELETE FROM placement_segments WHERE placement_cycle_id = ${liveCycle}::uuid`;
    await sql.query(goLiveInsert!, []);
    let liveRows = await segmentsFor(migrateSpot.id);
    assert.equal(liveRows.length, 1);
    assert.equal(liveRows[0].ended_at, null);
    assert.equal(liveRows[0].pocket_id, pocketB.id);
    assert.equal(liveRows[0].pocket_name, `${tag}-window`);
    assert.equal(liveRows[0].offer_id, offerA);
    assert.equal(priceOf(liveRows[0]), 40);
    assert.ok(new Date(liveRows[0].started_at).getTime() > new Date("2020-01-01T00:00:00.000Z").getTime());
    const closedCountBefore = (await segmentsFor(closedSpot.id)).length;
    await sql.query(goLiveInsert!, []);
    liveRows = await segmentsFor(migrateSpot.id);
    assert.equal(liveRows.length, 1);
    assert.equal((await segmentsFor(closedSpot.id)).length, closedCountBefore);

    const noPocketSpot = await appendPosSpot(emptySpot(`seg-nopocket-${tag}`, "9114"));
    spotIds.push(noPocketSpot.id);
    await placeOn(noPocketSpot, variantA, offerA);
    const noPocketCycle = openSegments(await segmentsFor(noPocketSpot.id))[0].placement_cycle_id;
    await sql`
      UPDATE placement_cycles
      SET started_at = '2020-01-01T00:00:00.000Z'
      WHERE id = ${noPocketCycle}::uuid
    `;
    await sql`DELETE FROM placement_segments WHERE placement_cycle_id = ${noPocketCycle}::uuid`;
    await sql.query(goLiveInsert!, []);
    const noPocketRows = await segmentsFor(noPocketSpot.id);
    assert.equal(noPocketRows.length, 1);
    assert.equal(noPocketRows[0].ended_at, null);
    assert.equal(noPocketRows[0].pocket_id, null);
    assert.equal(noPocketRows[0].pocket_name, null);
    assert.equal(noPocketRows[0].offer_id, offerA);
    assert.equal(priceOf(noPocketRows[0]), 40);
    assert.ok(
      new Date(noPocketRows[0].started_at).getTime() >
        new Date("2020-01-01T00:00:00.000Z").getTime(),
    );

    const missingPocketId = randomUUID();
    const danglingSpot = await appendPosSpot(emptySpot(`seg-dangling-${tag}`, "9115"));
    spotIds.push(danglingSpot.id);
    await placeOn(danglingSpot, variantA, offerA);
    const danglingCycle = openSegments(await segmentsFor(danglingSpot.id))[0].placement_cycle_id;
    const pocketFks = (await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'pos_spots'::regclass
        AND contype = 'f'
        AND pg_get_constraintdef(oid) ILIKE '%REFERENCES pockets%'
    `) as { conname: string; def: string }[];
    const pocketFkRow = pocketFks[0];
    assert.ok(pocketFkRow, "pos_spots pocket foreign key");
    assert.match(pocketFkRow.conname, /^[a-z_][a-z0-9_]*$/);
    await sql.query(`ALTER TABLE pos_spots DROP CONSTRAINT ${pocketFkRow.conname}`, []);
    try {
      await sql`
        UPDATE pos_spots
        SET pocket_id = ${missingPocketId}::uuid
        WHERE id = ${danglingSpot.id}::uuid
      `;
      await sql`DELETE FROM placement_segments WHERE placement_cycle_id = ${danglingCycle}::uuid`;
      await sql.query(goLiveInsert!, []);
      const danglingRows = await segmentsFor(danglingSpot.id);
      assert.equal(danglingRows.length, 1);
      assert.equal(danglingRows[0].ended_at, null);
      assert.equal(danglingRows[0].pocket_id, missingPocketId);
      assert.equal(danglingRows[0].pocket_name, null);
      assert.equal(danglingRows[0].offer_id, offerA);
      assert.equal(priceOf(danglingRows[0]), 40);
    } finally {
      await sql`
        UPDATE pos_spots
        SET pocket_id = NULL
        WHERE id = ${danglingSpot.id}::uuid
      `;
      await sql.query(
        `ALTER TABLE pos_spots ADD CONSTRAINT ${pocketFkRow.conname} ${pocketFkRow.def}`,
        [],
      );
    }

    const blankPocket = await createPocket({ partnerLocationId, name: `${tag}-blank` });
    pocketIds.push(blankPocket.id);
    const blankSpot = await appendPosSpot(emptySpot(`seg-blank-${tag}`, "9116"));
    spotIds.push(blankSpot.id);
    await placeOn(blankSpot, variantA, offerA);
    await updatePosSpot(blankSpot.id, {
      partnerLocationId,
      posNumber: "9116",
      posName: blankSpot.posName,
      updatePocketId: true,
      pocketId: blankPocket.id,
    });
    const blankCycle = openSegments(await segmentsFor(blankSpot.id))[0].placement_cycle_id;
    await sql`ALTER TABLE pockets DROP CONSTRAINT IF EXISTS pockets_name_not_blank`;
    try {
      await sql`UPDATE pockets SET name = '   ' WHERE id = ${blankPocket.id}::uuid`;
      await sql`DELETE FROM placement_segments WHERE placement_cycle_id = ${blankCycle}::uuid`;
      await sql.query(goLiveInsert!, []);
      const blankRows = await segmentsFor(blankSpot.id);
      assert.equal(blankRows.length, 1);
      assert.equal(blankRows[0].ended_at, null);
      assert.equal(blankRows[0].pocket_id, blankPocket.id);
      assert.equal(blankRows[0].pocket_name, null);
      assert.equal(blankRows[0].offer_id, offerA);
      assert.equal(priceOf(blankRows[0]), 40);
    } finally {
      await sql`UPDATE pockets SET name = ${`${tag}-blank`} WHERE id = ${blankPocket.id}::uuid`;
      await sql`
        ALTER TABLE pockets
        ADD CONSTRAINT pockets_name_not_blank CHECK (length(trim(name)) > 0)
      `;
    }

    await sql.query(goLiveInsert!, []);
    const uncovered = await sql`
      SELECT c.id
      FROM placement_cycles c
      WHERE c.ended_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM placement_segments s
          WHERE s.placement_cycle_id = c.id
            AND s.ended_at IS NULL
        )
    `;
    assert.equal((uncovered as { id: string }[]).length, 0);
    await sql.query(goLiveInsert!, []);
    assert.equal((await segmentsFor(migrateSpot.id)).length, 1);
    assert.equal((await segmentsFor(noPocketSpot.id)).length, 1);
    assert.equal((await segmentsFor(danglingSpot.id)).length, 1);
    assert.equal((await segmentsFor(blankSpot.id)).length, 1);

    console.log("verify-placement-segments: lifecycle, price, pocket, go-live ok");
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
    for (const pocketId of pocketIds) {
      try {
        await deletePocket(pocketId);
      } catch {
        await sql`DELETE FROM pockets WHERE id = ${pocketId}::uuid`;
      }
    }
    await sql`DELETE FROM pockets WHERE name LIKE ${`${tag}-%`}`;
    await sql`
      DELETE FROM offers
      WHERE id IN (
        ${offerA}, ${offerA2}, ${offerShared}, ${offerOther}, ${offerFlower}, ${offerEmpty}, ${offerLegacy}
      )
    `;
    await sql`
      DELETE FROM placement_segments
      WHERE placement_cycle_id IN (
        SELECT id FROM placement_cycles
        WHERE plant_variant_id IN (${variantA}::uuid, ${variantB}::uuid, ${emptyVariant}::uuid)
      )
    `;
    await sql`
      DELETE FROM placement_cycles
      WHERE plant_variant_id IN (${variantA}::uuid, ${variantB}::uuid, ${emptyVariant}::uuid)
    `;
    await sql`
      DELETE FROM inventory_history
      WHERE variant_id IN (${variantA}::uuid, ${variantB}::uuid, ${emptyVariant}::uuid)
    `;
    await sql`
      DELETE FROM inventory
      WHERE variant_id IN (${variantA}::uuid, ${variantB}::uuid, ${emptyVariant}::uuid)
    `;
    await sql`
      DELETE FROM plant_variants
      WHERE id IN (${variantA}::uuid, ${variantB}::uuid, ${emptyVariant}::uuid)
    `;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

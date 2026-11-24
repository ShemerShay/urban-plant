/**
 * Admin Offer PATCH: price, status, Catalog + partner-location availabilities.
 * Run: npx tsx scripts/verify-offer-patch.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ADMIN_COOKIE, ADMIN_COOKIE_VALUE } from "../lib/adminAuth.ts";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertWiring(): void {
  const storage = read("lib/offerStorage.ts");
  assert.match(storage, /sql\.transaction\(/);
  assert.match(storage, /DELETE FROM offer_availabilities/);
  assert.match(storage, /offer_availabilities_offer_scope_location_key/);
  assert.match(storage, /RETURNING\s+s\.placement_cycle_id/);
  assert.match(storage, /s\.plant_unit_cost/);
  assert.match(storage, /s\.plant_unit_cost_source/);
  assert.match(storage, /s\.pot_unit_cost/);
  assert.match(storage, /s\.pot_unit_cost_source/);
  assert.match(storage, /s\.pot_name/);
  assert.match(storage, /s\.total_supplier_unit_cost/);
  assert.match(storage, /cs\.plant_unit_cost/);
  assert.match(storage, /cs\.plant_unit_cost_source/);
  assert.match(storage, /cs\.pot_unit_cost/);
  assert.match(storage, /cs\.pot_unit_cost_source/);
  assert.match(storage, /cs\.pot_name/);
  assert.match(storage, /cs\.total_supplier_unit_cost/);
  assert.doesNotMatch(storage, /pv\.supplier_price/);
  assert.doesNotMatch(storage, /plants\.supplier_price@/);
  assert.doesNotMatch(storage, /ON DELETE CASCADE[\s\S]*FROM offers/);

  const route = read("app/api/offers/[offerId]/route.ts");
  const patch = route.slice(route.indexOf("export async function PATCH"));
  assert.match(patch, /isAdminRequest/);
  assert.match(patch, /updateOffer/);
  assert.match(patch, /availabilities/);
  console.log("verify-offer-patch: wiring ok");
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

  const { NextRequest } = await import("next/server");
  const { PATCH } = await import("../app/api/offers/[offerId]/route");
  const { sql } = await import("../lib/db");
  const { parsePlantBody } = await import("../lib/plantValidation");
  const { createPlant, deletePlant } = await import("../lib/plantStorage");
  const { createPlantSizeWithOpeningQuantity } = await import("../lib/plantVariantStorage");
  const { createSellableVariant } = await import("../lib/sellableVariantStorage");
  const { createPartner } = await import("../lib/partnerStorage");
  const { createPartnerLocation } = await import("../lib/partnerLocationStorage");
  const {
    appendFlowerOffer,
    createOrReusePlantOffer,
    getOfferById,
  } = await import("../lib/offerStorage");

  const adminHeaders = {
    "content-type": "application/json",
    cookie: `${ADMIN_COOKIE}=${ADMIN_COOKIE_VALUE}`,
  };

  async function adminPatch(offerId: string, body: unknown) {
    const response = await PATCH(
      new NextRequest(`http://local.test/api/offers/${encodeURIComponent(offerId)}`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ offerId }) },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function availabilityCount(offerId: string): Promise<number> {
    const rows = await sql`
      SELECT count(*)::int AS n FROM offer_availabilities WHERE offer_id = ${offerId}
    `;
    return (rows as { n: number }[])[0]?.n ?? -1;
  }

  const tag = `offer-patch-${randomUUID().slice(0, 8)}`;
  const parsed = parsePlantBody(
    {
      id: randomUUID(),
      name: `${tag} plant`,
      subtitle: "Leaf",
      description: "A plant",
      currency: "ILS",
      images: ["https://example.com/p.jpg"],
      labels: ["indoor"],
      light: "Medium light",
      water: "Weekly",
      location: "Indoor",
      petFriendly: false,
      careInstructions: ["Water"],
      inventoryType: "plants",
    },
    { requireId: true },
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const flowerParsed = parsePlantBody(
    {
      id: randomUUID(),
      name: `${tag} flower`,
      currency: "ILS",
      inventoryType: "flowers",
    },
    { requireId: true },
  );
  assert.equal(flowerParsed.ok, true);
  if (!flowerParsed.ok) return;

  let plantId = "";
  let flowerId = "";
  let partnerId = "";
  const locationIds: string[] = [];
  let offerId = "";
  let legacyId = "";
  let flowerOfferId = "";

  try {
    const plant = await createPlant(parsed.plant);
    plantId = plant.id;
    const flower = await createPlant(flowerParsed.plant);
    flowerId = flower.id;
    const sized = await createPlantSizeWithOpeningQuantity({
      plantId,
      sizeLabel: "M",
      quantity: 0,
      supplierPrice: 12,
    });
    const sellable = await createSellableVariant({
      plantId,
      plantSizeId: sized.variant.id,
      potId: null,
    });
    const partner = await createPartner({ id: randomUUID(), name: `${tag} partner` });
    partnerId = partner.id;
    const locA = await createPartnerLocation({
      id: randomUUID(),
      partnerId,
      name: `${tag} north`,
      address: "1 North",
      type: "cafe",
      partnerType: "cafe",
      payments: [],
      pickupDisabled: false,
      monthlyRevenue: 0,
      setupCost: 0,
      notes: "",
    });
    const locB = await createPartnerLocation({
      id: randomUUID(),
      partnerId,
      name: `${tag} south`,
      address: "2 South",
      type: "cafe",
      partnerType: "cafe",
      payments: [],
      pickupDisabled: false,
      monthlyRevenue: 0,
      setupCost: 0,
      notes: "",
    });
    locationIds.push(locA.id, locB.id);

    const created = await createOrReusePlantOffer({
      sellableVariantId: sellable.sellableVariantId,
      consumerPrice: 70,
      status: "active",
      availabilities: [
        { scope: "catalog" },
        { scope: "partner_location", partnerLocationId: locA.id },
      ],
    });
    offerId = created.offer.id;

    const priceOnly = await adminPatch(offerId, { consumerPrice: 71 });
    assert.equal(priceOnly.status, 200, JSON.stringify(priceOnly.body));
    const afterPrice = await getOfferById(offerId);
    assert.equal(afterPrice?.consumerPrice, 71);
    assert.equal(afterPrice?.status, "active");
    console.log("verify-offer-patch: price only 200");

    const statusOnly = await adminPatch(offerId, { status: "inactive" });
    assert.equal(statusOnly.status, 200, JSON.stringify(statusOnly.body));
    assert.equal((await getOfferById(offerId))?.status, "inactive");
    const statusBack = await adminPatch(offerId, { status: "active" });
    assert.equal(statusBack.status, 200, JSON.stringify(statusBack.body));
    console.log("verify-offer-patch: status 200");

    const catalogOnly = await adminPatch(offerId, {
      availabilities: [{ scope: "catalog", partnerLocationId: null }],
    });
    assert.equal(catalogOnly.status, 200, JSON.stringify(catalogOnly.body));
    const afterCatalog = await getOfferById(offerId);
    assert.deepEqual(afterCatalog?.availabilities, [{ scope: "catalog", partnerLocationId: null }]);
    assert.equal(await availabilityCount(offerId), 1);
    console.log("verify-offer-patch: catalog availability 200");

    const partnersOnly = await adminPatch(offerId, {
      availabilities: [
        { scope: "partner_location", partnerLocationId: locA.id },
        { scope: "partner_location", partnerLocationId: locB.id },
      ],
    });
    assert.equal(partnersOnly.status, 200, JSON.stringify(partnersOnly.body));
    const afterPartners = await getOfferById(offerId);
    assert.equal(afterPartners?.availabilities.length, 2);
    assert.equal(await availabilityCount(offerId), 2);
    console.log("verify-offer-patch: partner-location availabilities 200");

    const combined = await adminPatch(offerId, {
      consumerPrice: 70,
      status: "active",
      availabilities: [
        { scope: "catalog", partnerLocationId: null },
        { scope: "partner_location", partnerLocationId: locA.id },
        { scope: "partner_location", partnerLocationId: locB.id },
      ],
    });
    assert.equal(combined.status, 200, JSON.stringify(combined.body));
    const reloaded = await getOfferById(offerId);
    assert.equal(reloaded?.consumerPrice, 70);
    assert.equal(reloaded?.status, "active");
    assert.equal(reloaded?.availabilities.some((row) => row.scope === "catalog"), true);
    assert.equal(
      reloaded?.availabilities.filter((row) => row.scope === "partner_location").length,
      2,
    );
    assert.equal(await availabilityCount(offerId), 3);
    const combinedAgain = await adminPatch(offerId, {
      consumerPrice: 70,
      status: "active",
      availabilities: [
        { scope: "catalog", partnerLocationId: null },
        { scope: "partner_location", partnerLocationId: locA.id },
        { scope: "partner_location", partnerLocationId: locB.id },
      ],
    });
    assert.equal(combinedAgain.status, 200, JSON.stringify(combinedAgain.body));
    assert.equal(await availabilityCount(offerId), 3);
    console.log("verify-offer-patch: combined edit 200, no duplicate rows");

    legacyId = randomUUID();
    await sql`
      INSERT INTO offers (id, product_id, consumer_price, status, created_at)
      VALUES (${legacyId}, ${plantId}, 40, 'active', now())
    `;
    const legacyRead = await getOfferById(legacyId);
    assert.equal(legacyRead?.sellableVariantId, null);
    const legacyPatched = await adminPatch(legacyId, { consumerPrice: 41, status: "inactive" });
    assert.equal(legacyPatched.status, 200, JSON.stringify(legacyPatched.body));
    const legacyAfter = await getOfferById(legacyId);
    assert.equal(legacyAfter?.consumerPrice, 41);
    assert.equal(legacyAfter?.status, "inactive");
    const legacyBlocked = await adminPatch(legacyId, {
      availabilities: [{ scope: "catalog", partnerLocationId: null }],
    });
    assert.equal(legacyBlocked.status, 400);
    console.log("verify-offer-patch: legacy offer read/PATCH 200");

    const flowerOffer = await appendFlowerOffer({
      productId: flowerId,
      consumerPrice: 15,
      status: "active",
    });
    flowerOfferId = flowerOffer.id;
    const flowerPatched = await adminPatch(flowerOfferId, { consumerPrice: 16, status: "inactive" });
    assert.equal(flowerPatched.status, 200, JSON.stringify(flowerPatched.body));
    const flowerAfter = await getOfferById(flowerOfferId);
    assert.equal(flowerAfter?.consumerPrice, 16);
    assert.equal(flowerAfter?.status, "inactive");
    assert.equal(flowerAfter?.sellableVariantId, null);
    const flowerBlocked = await adminPatch(flowerOfferId, {
      availabilities: [{ scope: "catalog", partnerLocationId: null }],
    });
    assert.equal(flowerBlocked.status, 400);
    console.log("verify-offer-patch: flower offer PATCH 200");

    console.log("verify-offer-patch: ok");
  } finally {
    if (legacyId) await sql`DELETE FROM offers WHERE id = ${legacyId}`.catch(() => undefined);
    if (flowerOfferId) {
      await sql`DELETE FROM offers WHERE id = ${flowerOfferId}`.catch(() => undefined);
    }
    if (offerId) {
      await sql`DELETE FROM offer_availabilities WHERE offer_id = ${offerId}`.catch(() => undefined);
      await sql`DELETE FROM offers WHERE id = ${offerId}`.catch(() => undefined);
    }
    if (plantId) await deletePlant(plantId).catch(() => undefined);
    if (flowerId) await deletePlant(flowerId).catch(() => undefined);
    if (locationIds.length > 0) {
      await sql`DELETE FROM partner_locations WHERE id = ANY(${locationIds}::text[])`.catch(
        () => undefined,
      );
    }
    if (partnerId) await sql`DELETE FROM partners WHERE id = ${partnerId}`.catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

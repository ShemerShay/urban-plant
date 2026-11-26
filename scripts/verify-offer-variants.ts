/**
 * Plant Offers on Sellable Variants, plus the migration statement scanner.
 * Run: npx tsx scripts/verify-offer-variants.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ADMIN_COOKIE, ADMIN_COOKIE_VALUE } from "../lib/adminAuth.ts";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

async function assertScanner(): Promise<void> {
  const { splitSqlStatements, splitSqlStatementsLegacy } = await import("./apply-sql-file.mjs");
  const migrationDir = join(root, "db/migrations");
  const files = readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(files.includes("001_initial_schema.sql"));
  assert.ok(files.includes("048_offers_on_sellable_variants.sql"));
  assert.ok(files.includes("052_legacy_catalog_cleanup.sql"));

  for (const name of files) {
    const sql = readFileSync(join(migrationDir, name), "utf8");
    const parsed = splitSqlStatements(sql);
    const legacy = splitSqlStatementsLegacy(sql);
    const keepsQuotedSemicolon = parsed.some((statement: string) => statement.includes(";"));
    if (keepsQuotedSemicolon) {
      assert.ok(
        parsed.length < legacy.length,
        `${name} must keep a semicolon inside quotes in the same statement`,
      );
    } else {
      assert.deepEqual(parsed, legacy, `${name} parser regression`);
    }
  }

  assert.ok(files.includes("062_offers_admin_hidden.sql"));
  const hiddenMigration = read("db/migrations/062_offers_admin_hidden.sql");
  assert.match(
    hiddenMigration,
    /ADD COLUMN IF NOT EXISTS admin_hidden boolean NOT NULL DEFAULT false/,
  );

  const initial = read("db/migrations/001_initial_schema.sql");
  assert.match(initial, /--.*spot_description;/);
  assert.deepEqual(splitSqlStatements(initial), splitSqlStatementsLegacy(initial));

  const sample = `
BEGIN;
-- keep; this semicolon
SELECT 1;
CREATE FUNCTION f() RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- inside; comment
  PERFORM 1;
END;
$fn$;
COMMIT;
`;
  const parsed = splitSqlStatements(sample);
  assert.equal(parsed.length, 2);
  assert.match(parsed[0], /^SELECT 1$/);
  assert.match(parsed[1], /CREATE FUNCTION f/);
  assert.match(parsed[1], /PERFORM 1;/);
  assert.ok(splitSqlStatementsLegacy(sample).length > parsed.length);

  const migration = read("db/migrations/048_offers_on_sellable_variants.sql");
  const statements = splitSqlStatements(migration);
  assert.ok(statements.length < splitSqlStatementsLegacy(migration).length);
  const apply = statements.find((statement) => statement.includes("FUNCTION apply_plant_offer"));
  const guard = statements.find((statement) =>
    statement.includes("FUNCTION enforce_offer_sellable_variant_integrity"),
  );
  assert.ok(apply && apply.includes("FOR UPDATE OF sv") && apply.includes("RETURN NEXT"));
  assert.ok(guard && guard.includes("active catalog offer already exists"));
  assert.equal(
    statements.some((statement) => /^\s*INSERT\s+INTO/i.test(statement)),
    false,
  );
  assert.equal(
    statements.some((statement) => /^\s*UPDATE\s+/i.test(statement)),
    false,
  );
  assert.match(migration, /UNIQUE NULLS NOT DISTINCT \(offer_id, scope, partner_location_id\)/);
  assert.match(migration, /offers_sellable_variant_consumer_price_key/);

  const cutover = read("db/migrations/050_pos_offer_cutover.sql");
  const cutoverStatements = splitSqlStatements(cutover);
  const occupancyFn = cutoverStatements.find((statement) =>
    statement.includes("FUNCTION enforce_pos_occupancy_offer_color"),
  );
  assert.ok(occupancyFn && occupancyFn.includes("RETURNS trigger"));
  assert.ok(splitSqlStatementsLegacy(cutover).length > cutoverStatements.length);

  const cleanup = read("db/migrations/052_legacy_catalog_cleanup.sql");
  const cleanupStatements = splitSqlStatements(cleanup);
  assert.equal(cleanupStatements.length, 11);
  assert.ok(cleanupStatements.length < splitSqlStatementsLegacy(cleanup).length);
  const notice = cleanupStatements.find((statement: string) => statement.includes("$notice$"));
  assert.ok(notice && notice.includes("RAISE NOTICE") && notice.includes("EXECUTE"));
  assert.equal(notice.match(/\$notice\$/g)?.length, 2);
  const cleanupApply = cleanupStatements.find((statement: string) =>
    statement.includes("FUNCTION apply_plant_offer"),
  );
  assert.ok(cleanupApply);
  assert.match(cleanupApply, /INSERT INTO offers \(/);
  assert.match(cleanupApply, /RETURN NEXT/);
  assert.doesNotMatch(cleanupApply, /\bvariant_id\b/);
  assert.equal(cleanupApply.match(/\$apply_plant_offer\$/g)?.length, 2);
  assert.equal(
    cleanupStatements.filter((statement: string) => /^(ALTER TABLE|DROP )/i.test(statement)).length,
    9,
  );
  assert.equal(
    cleanupStatements.some((statement: string) => /^\s*(END IF|EXECUTE|INSERT INTO|UPDATE)\b/i.test(statement)),
    false,
  );
  console.log("verify-offer-variants: migration parser matches existing files");
}

function assertCustomerPathsUntouched(): void {
  for (const rel of ["scripts/seed-from-json.mjs"]) {
    const source = read(rel);
    assert.doesNotMatch(source, /offer_availabilities/, rel);
    assert.doesNotMatch(source, /sellable_variant_id/, rel);
  }
  assert.doesNotMatch(read("lib/offerTypes.ts"), /variantId\?:/);
  assert.match(read("lib/posOccupancy.ts"), /isPlantPosEligibleOffer/);
  assert.match(read("components/admin/AdminPartnerDetail.tsx"), /potId/);
  assert.doesNotMatch(read("components/admin/AdminPartnerDetail.tsx"), /potColorId/);
  const offersApi = read("app/api/offers/route.ts");
  const getFn = offersApi.slice(
    offersApi.indexOf("export async function GET"),
    offersApi.indexOf("export async function POST"),
  );
  assert.match(getFn, /isAdminRequest/);
  assert.match(offersApi.slice(offersApi.indexOf("export async function POST")), /isAdminRequest/);
  const offerByIdRoute = read("app/api/offers/[offerId]/route.ts");
  assert.match(offerByIdRoute, /isAdminRequest/);
  assert.match(offerByIdRoute, /export async function DELETE/);
  assert.match(offerByIdRoute, /deleteOffer\(/);
  const storage = read("lib/offerStorage.ts");
  const deleteAt = storage.indexOf("export async function deleteOffer");
  assert.ok(deleteAt >= 0);
  const deleteFn = storage.slice(deleteAt, storage.indexOf("async function readVariantPlant"));
  assert.match(deleteFn, /FOR UPDATE/);
  assert.match(deleteFn, /current_offer_id/);
  assert.match(deleteFn, /admin_hidden = true/);
  assert.match(deleteFn, /DELETE FROM offers/);
  assert.doesNotMatch(deleteFn, /SET status/);
  assert.doesNotMatch(deleteFn, /status = 'inactive'/);
  const offersAdmin = read("components/admin/AdminOffersManager.tsx");
  assert.match(offersAdmin, /async function confirmDelete/);
  assert.match(offersAdmin, /AdminConfirmDialog/);
  assert.match(offersAdmin, /listedOffers/);
  assert.match(offersAdmin, /return offers/);
  assert.doesNotMatch(offersAdmin, /filter\(\(offer\) => Boolean\(offer\.sellableVariantId\)\)/);
  const offersPlantsPage = read("app/admin/offers/plants/page.tsx");
  assert.match(offersPlantsPage, /enrichOffersWithProduct\(offersRaw\)/);
  assert.doesNotMatch(offersPlantsPage, /Boolean\(offer\.sellableVariantId\)/);
  assert.match(offersAdmin, /admin\.offers\.legacyPos/);
  assert.match(offersAdmin, /variantBacked=\{Boolean\(offer\.sellableVariantId\)\}/);
  assert.match(offersAdmin, /offer\.sellableVariantId/);
  assert.match(offersAdmin, /function groupPlantOffers/);
  assert.match(offersAdmin, /groups.get\(productId\)/);
  assert.match(offersAdmin, /isPlants \? groupPlantOffers\(filteredOffers\)/);
  assert.match(offersAdmin, /groupedPlantOffers\.map/);
  assert.match(offersAdmin, /grouped/);
  assert.match(offersAdmin, /offerVariantSummary/);
  assert.doesNotMatch(
    offersAdmin.slice(offersAdmin.indexOf("function groupPlantOffers")),
    /groups.get\(offer\.productName\)/,
  );
  const messages = read("lib/messages.ts");
  assert.match(messages, /"admin.offers.groupCount"/);
  assert.match(messages, /"admin.offers.groupToggleAria"/);
  assert.doesNotMatch(read("components/admin/AdminPartnerDetail.tsx"), /admin\.offers\.delete/);
  assert.doesNotMatch(read("components/admin/AdminPartnerDetail.tsx"), /routes\.api\.offer\(/);
  const runner = read("scripts/apply-sql-file.mjs");
  assert.doesNotMatch(runner, /048_/);
  assert.doesNotMatch(runner, /dev-partner-page/);
  assert.doesNotMatch(runner, /twilight-truth/);
  assert.doesNotMatch(runner, /snowy-credit/);
  assert.match(runner, /export function splitSqlStatements/);
  assert.doesNotMatch(storage, /supplier_price/);
  assert.doesNotMatch(storage, /supplierPrice/);
  assert.doesNotMatch(storage, /appendOffer\(/);
  assert.doesNotMatch(storage, /\bvariant_id\b/);
  console.log("verify-offer-variants: shop, cart, checkout, holds, and POS stay on the current path");
}

async function main(): Promise<void> {
  await assertScanner();
  assertCustomerPathsUntouched();

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (host.includes("twilight-truth")) {
    throw new Error("Refusing to verify against production");
  }

  const { NextRequest } = await import("next/server");
  const { GET, POST } = await import("../app/api/offers/route");
  const { PATCH, DELETE } = await import("../app/api/offers/[offerId]/route");
  const { sql } = await import("../lib/db");
  const { parsePlantBody } = await import("../lib/plantValidation");
  const { createPlant, deletePlant } = await import("../lib/plantStorage");
  const { createPlantVariant } = await import("../lib/plantVariantStorage");
  const { createPot, deletePot, updatePot } = await import("../lib/potStorage");
  const { createSellableVariant, deleteSellableVariant, SellableVariantWriteError } =
    await import("../lib/sellableVariantStorage");
  const { createPartner } = await import("../lib/partnerStorage");
  const { createPartnerLocation } = await import("../lib/partnerLocationStorage");
  const {
    OfferWriteError,
    OFFER_ASSIGNED_TO_POS,
    OFFER_CATALOG_CONFLICT,
    OFFER_OPEN_PLACEMENT,
    OFFER_PRICE_CONFLICT,
    OFFER_REMOVED_REUSE,
    OFFER_UNFINISHED_PAYMENT,
    appendFlowerOffer,
    createOrReusePlantOffer,
    getOfferById,
    updateOffer,
  } = await import("../lib/offerStorage");

  const { posAllowsNewCustomerPurchase } = await import("../lib/posOccupancy");
  const { getPosSpotById } = await import("../lib/posSpotStorage");

  const unauthenticatedGet = new NextRequest("http://local.test/api/offers?inventoryType=plants");
  assert.equal((await GET(unauthenticatedGet)).status, 401);
  const adminGet = new NextRequest("http://local.test/api/offers?inventoryType=plants", {
    headers: { cookie: `${ADMIN_COOKIE}=${ADMIN_COOKIE_VALUE}` },
  });
  assert.equal((await GET(adminGet)).status, 200);
  const unauthenticated = new NextRequest("http://local.test/api/offers?inventoryType=plants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consumerPrice: 1, sellableVariantId: randomUUID(), status: "active" }),
  });
  assert.equal((await POST(unauthenticated)).status, 401);
  const unauthenticatedPatch = new NextRequest("http://local.test/api/offers/missing", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consumerPrice: 1 }),
  });
  assert.equal(
    (
      await PATCH(unauthenticatedPatch, {
        params: Promise.resolve({ offerId: "missing" }),
      })
    ).status,
    401,
  );
  const unauthenticatedDelete = new NextRequest("http://local.test/api/offers/missing", {
    method: "DELETE",
  });
  assert.equal(
    (
      await DELETE(unauthenticatedDelete, {
        params: Promise.resolve({ offerId: "missing" }),
      })
    ).status,
    401,
  );

  const tag = `offer-sv-${Date.now()}`;
  const parsed = parsePlantBody(
    {
      id: randomUUID(),
      name: `${tag} plant`,
      subtitle: "Leaf",
      description: "A plant",
      supplierPrice: 40,
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
      supplierPrice: 15,
      currency: "ILS",
      inventoryType: "flowers",
    },
    { requireId: true },
  );
  assert.equal(flowerParsed.ok, true);
  if (!flowerParsed.ok) return;
  const otherParsed = parsePlantBody(
    {
      ...parsed.plant,
      id: randomUUID(),
      name: `${tag} other`,
      supplierPrice: 70,
    },
    { requireId: true },
  );
  assert.equal(otherParsed.ok, true);
  if (!otherParsed.ok) return;

  let plantId = "";
  let otherPlantId = "";
  let flowerId = "";
  let potId = "";
  let partnerId = "";
  const locationIds: string[] = [];

  const adminHeaders = {
    "content-type": "application/json",
    cookie: `${ADMIN_COOKIE}=${ADMIN_COOKIE_VALUE}`,
  };

  async function adminPost(query: string, body: unknown) {
    const response = await POST(
      new NextRequest(`http://local.test/api/offers?inventoryType=${query}`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function adminDelete(offerId: string) {
    const response = await DELETE(
      new NextRequest(`http://local.test/api/offers/${encodeURIComponent(offerId)}`, {
        method: "DELETE",
        headers: adminHeaders,
      }),
      { params: Promise.resolve({ offerId }) },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function listedIds(): Promise<string[]> {
    const response = await GET(
      new NextRequest("http://local.test/api/offers?inventoryType=plants", {
        headers: adminHeaders,
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { offers?: { id: string }[] };
    return (body.offers ?? []).map((offer) => offer.id);
  }

  async function assertDeleteBlocked(
    offerId: string,
    error: string,
    kind: "pos" | "payment" | "placement",
  ) {
    const before = await sql`
      SELECT admin_hidden, status, consumer_price::float8 AS consumer_price
      FROM offers WHERE id = ${offerId}
    `;
    const result = await adminDelete(offerId);
    assert.equal(result.status, 409);
    assert.equal(result.body.error, error);
    const blockers = result.body.blockers as { kind: string }[] | undefined;
    assert.ok(blockers?.some((item) => item.kind === kind));
    const kept = await getOfferById(offerId);
    assert.equal(kept?.id, offerId);
    assert.equal(kept?.adminHidden, false);
    const after = (await sql`
      SELECT admin_hidden, status, consumer_price::float8 AS consumer_price
      FROM offers WHERE id = ${offerId}
    `) as { admin_hidden: boolean; status: string; consumer_price: number }[];
    const previous = (before as { admin_hidden: boolean; status: string; consumer_price: number }[])[0];
    assert.equal(after[0]?.admin_hidden, false);
    assert.equal(after[0]?.status, previous?.status);
    assert.equal(after[0]?.consumer_price, previous?.consumer_price);
  }

  async function assertRemovedFromCatalog(offerId: string, price: number, status: string) {
    const result = await adminDelete(offerId);
    assert.equal(result.status, 200);
    assert.equal(result.body.error, undefined);
    const kept = await getOfferById(offerId);
    assert.equal(kept?.id, offerId);
    assert.equal(kept?.adminHidden, true);
    assert.equal(kept?.status, status);
    assert.equal(kept?.consumerPrice, price);
    assert.equal(kept?.availabilities.length, 0);
    assert.equal((await listedIds()).includes(offerId), false);
    const stored = await sql`
      SELECT admin_hidden, status, consumer_price::float8 AS consumer_price
      FROM offers WHERE id = ${offerId}
    `;
    const row = (stored as { admin_hidden: boolean; status: string; consumer_price: number }[])[0];
    assert.equal(row?.admin_hidden, true);
    assert.equal(row?.status, status);
    assert.equal(row?.consumer_price, price);
  }

  try {
    const plant = await createPlant(parsed.plant);
    plantId = plant.id;
    const other = await createPlant(otherParsed.plant);
    otherPlantId = other.id;
    const flower = await createPlant(flowerParsed.plant);
    flowerId = flower.id;
    const size = await createPlantVariant({ plantId, sizeLabel: "M", supplierPrice: 40 });
    const pot = await createPot({ name: `${tag} pot` });
    potId = pot.id;
    await updatePot({ potId, supplierPrice: 12.5 });
    const noPot = await createSellableVariant({ plantId, plantSizeId: size.id, potId: null });
    const withPot = await createSellableVariant({
      plantId,
      plantSizeId: size.id,
      potId,
    });
    assert.equal(noPot.supplierCost, 40);
    assert.equal(withPot.supplierCost, 52.5);

    const partner = await createPartner({ id: randomUUID(), name: `${tag} partner` });
    partnerId = partner.id;
    const branchA = await createPartnerLocation({
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
    const branchB = await createPartnerLocation({
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
    locationIds.push(branchA.id, branchB.id);

    const blank = await adminPost("plants", {
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: "",
      status: "active",
    });
    assert.equal(blank.status, 400);
    const missingPrice = await adminPost("plants", {
      sellableVariantId: noPot.sellableVariantId,
      status: "active",
    });
    assert.equal(missingPrice.status, 400);

    const zero = await adminPost("plants", {
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 0,
      status: "inactive",
    });
    assert.equal(zero.status, 201);
    const zeroOffer = zero.body.offer as { id: string; consumerPrice: number; productId: string; sellableVariantId: string };
    assert.equal(zeroOffer.consumerPrice, 0);
    assert.equal("variantId" in zeroOffer, false);
    assert.equal(zeroOffer.productId, plantId);
    assert.equal(zeroOffer.sellableVariantId, noPot.sellableVariantId);
    assert.notEqual(zeroOffer.consumerPrice, noPot.supplierCost);

    const potOffer = await createOrReusePlantOffer({
      sellableVariantId: withPot.sellableVariantId,
      consumerPrice: 99,
      status: "active",
      availabilities: [
        { scope: "catalog" },
        { scope: "partner_location", partnerLocationId: branchA.id },
        { scope: "partner_location", partnerLocationId: branchB.id },
      ],
    });
    assert.equal(potOffer.reused, false);
    assert.equal(potOffer.offer.productId, plantId);
    assert.equal("variantId" in potOffer.offer, false);
    assert.equal(potOffer.offer.sellableVariantId, withPot.sellableVariantId);
    assert.equal(potOffer.offer.sellableVariant?.potName, pot.name);
    assert.equal(potOffer.offer.consumerPrice, 99);
    assert.notEqual(potOffer.offer.consumerPrice, withPot.supplierCost);
    assert.equal(
      potOffer.offer.availabilities.some((row) => row.scope === "catalog"),
      true,
    );
    assert.equal(potOffer.offer.availabilities.length, 3);

    const oneLocation = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 11,
      status: "active",
      availabilities: [{ scope: "partner_location", partnerLocationId: branchA.id }],
    });
    assert.deepEqual(
      oneLocation.offer.availabilities.map((row) => row.partnerLocationId),
      [branchA.id],
    );

    let duplicateContexts = false;
    try {
      await createOrReusePlantOffer({
        sellableVariantId: noPot.sellableVariantId,
        consumerPrice: 12,
        availabilities: [
          { scope: "catalog" },
          { scope: "catalog" },
        ],
      });
    } catch (error) {
      duplicateContexts = true;
      assert.ok(error instanceof OfferWriteError);
      assert.equal(error.code, "invalid");
    }
    assert.equal(duplicateContexts, true);

    for (const availabilities of [
      [{ scope: "shop" }],
      [{ scope: "catalog", partnerLocationId: branchA.id }],
      [{ scope: "partner_location" }],
      [{ scope: "partner_location", partnerLocationId: randomUUID() }],
      { scope: "catalog" },
    ]) {
      let malformed = false;
      try {
        await createOrReusePlantOffer({
          sellableVariantId: noPot.sellableVariantId,
          consumerPrice: 13,
          availabilities,
        });
      } catch (error) {
        malformed = true;
        assert.ok(error instanceof OfferWriteError);
        assert.equal(error.code, "invalid");
      }
      assert.equal(malformed, true);
    }

    let mismatched = false;
    try {
      await createOrReusePlantOffer({
        sellableVariantId: noPot.sellableVariantId,
        consumerPrice: 14,
        productId: otherPlantId,
      });
    } catch (error) {
      mismatched = true;
      assert.ok(error instanceof OfferWriteError);
      assert.equal(error.code, "invalid");
    }
    assert.equal(mismatched, true);

    const mismatchId = `offer-sv-mismatch-${randomUUID()}`;
    let dbMismatch = false;
    try {
      await sql`
        INSERT INTO offers (
          id, product_id, sellable_variant_id, consumer_price, status, created_at
        ) VALUES (
          ${mismatchId},
          ${otherPlantId},
          ${noPot.sellableVariantId}::uuid,
          15,
          'active',
          now()
        )
      `;
    } catch (error) {
      dbMismatch = true;
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /product_id must match the sellable variant plant/);
    }
    assert.equal(dbMismatch, true);

    const flowerVariantId = `offer-sv-flower-${randomUUID()}`;
    let flowerDbRejected = false;
    try {
      await sql`
        INSERT INTO offers (
          id, product_id, sellable_variant_id, consumer_price, status, created_at
        ) VALUES (
          ${flowerVariantId},
          ${flowerId},
          ${noPot.sellableVariantId}::uuid,
          16,
          'active',
          now()
        )
      `;
    } catch (error) {
      flowerDbRejected = true;
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /flower offers cannot have a sellable variant|product_id must match/);
    }
    assert.equal(flowerDbRejected, true);

    const flowerApi = await adminPost("flowers", {
      productId: flowerId,
      consumerPrice: 18,
      status: "active",
      sellableVariantId: noPot.sellableVariantId,
    });
    assert.equal(flowerApi.status, 400);
    const flowerAvailability = await adminPost("flowers", {
      productId: flowerId,
      consumerPrice: 18,
      status: "active",
      availabilities: [{ scope: "catalog" }],
    });
    assert.equal(flowerAvailability.status, 400);
    const flowerCreated = await appendFlowerOffer({ productId: flowerId, consumerPrice: 18, status: "active" });
    assert.equal(flowerCreated.sellableVariantId, null);
    assert.equal("variantId" in flowerCreated, false);
    assert.deepEqual(flowerCreated.availabilities, []);

    const legacyId = `offer-sv-legacy-${randomUUID()}`;
    await sql`
      INSERT INTO offers (id, product_id, consumer_price, status, created_at)
      VALUES (${legacyId}, ${plantId}, 21, 'active', now())
    `;
    const legacyUpdated = await updateOffer(legacyId, { consumerPrice: 22, status: "inactive" });
    assert.equal(legacyUpdated?.consumerPrice, 22);
    assert.equal(legacyUpdated?.sellableVariantId, null);
    assert.equal("variantId" in (legacyUpdated ?? {}), false);
    assert.deepEqual(legacyUpdated?.availabilities, []);
    let legacyGain = false;
    try {
      await updateOffer(legacyId, {
        availabilities: [{ scope: "catalog" }],
      });
    } catch (error) {
      legacyGain = true;
      assert.ok(error instanceof OfferWriteError);
      assert.equal(error.code, "invalid");
    }
    assert.equal(legacyGain, true);
    const legacyStill = await getOfferById(legacyId);
    assert.equal(legacyStill?.consumerPrice, 22);
    assert.deepEqual(legacyStill?.availabilities, []);

    let legacyAvailability = false;
    try {
      await sql`
        INSERT INTO offer_availabilities (offer_id, scope, partner_location_id)
        VALUES (${legacyId}, 'catalog', NULL)
      `;
    } catch (error) {
      legacyAvailability = true;
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /availability requires a sellable variant/);
    }
    assert.equal(legacyAvailability, true);

    const inactive = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 149,
      status: "inactive",
      availabilities: [{ scope: "partner_location", partnerLocationId: branchA.id }],
    });
    const activated = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 149,
      status: "active",
      availabilities: [{ scope: "partner_location", partnerLocationId: branchB.id }],
    });
    assert.equal(activated.reused, true);
    assert.equal(activated.offer.id, inactive.offer.id);
    assert.equal(activated.offer.status, "active");
    assert.deepEqual(
      activated.offer.availabilities.map((row) => row.partnerLocationId).sort(),
      [branchA.id, branchB.id].sort(),
    );

    const routeReuse = await adminPost("plants", {
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 149,
      status: "inactive",
      availabilities: [{ scope: "partner_location", partnerLocationId: branchA.id }],
    });
    assert.equal(routeReuse.status, 201);
    assert.equal(routeReuse.body.reused, true);
    const reusedOffer = routeReuse.body.offer as { id: string; status: string };
    assert.equal(reusedOffer.id, inactive.offer.id);
    assert.equal(reusedOffer.status, "inactive");

    const activeCatalog = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 159,
      status: "active",
      availabilities: [{ scope: "catalog" }],
    });
    assert.equal(activeCatalog.reused, false);
    const beforeConflict = await getOfferById(inactive.offer.id);
    let catalogConflict = false;
    try {
      await createOrReusePlantOffer({
        sellableVariantId: noPot.sellableVariantId,
        consumerPrice: 149,
        status: "active",
        availabilities: [{ scope: "catalog" }],
      });
    } catch (error) {
      catalogConflict = true;
      assert.ok(error instanceof OfferWriteError);
      assert.equal(error.code, "conflict");
      assert.equal(error.message, OFFER_CATALOG_CONFLICT);
    }
    assert.equal(catalogConflict, true);
    const afterConflict = await getOfferById(inactive.offer.id);
    assert.equal(afterConflict?.status, beforeConflict?.status);
    assert.deepEqual(afterConflict?.availabilities, beforeConflict?.availabilities);
    assert.equal(
      afterConflict?.availabilities.some((row) => row.scope === "catalog"),
      false,
    );

    const otherPrice = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 180,
      status: "inactive",
      availabilities: [{ scope: "partner_location", partnerLocationId: branchA.id }],
    });
    assert.notEqual(otherPrice.offer.id, inactive.offer.id);
    let priceConflict = false;
    try {
      await updateOffer(otherPrice.offer.id, { consumerPrice: 149 });
    } catch (error) {
      priceConflict = true;
      assert.ok(error instanceof OfferWriteError);
      assert.equal(error.code, "conflict");
      assert.equal(error.message, OFFER_PRICE_CONFLICT);
    }
    assert.equal(priceConflict, true);
    const stillSeparate = await getOfferById(otherPrice.offer.id);
    assert.equal(stillSeparate?.consumerPrice, 180);
    assert.notEqual(stillSeparate?.id, inactive.offer.id);

    const beside = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 181,
      status: "inactive",
      availabilities: [{ scope: "catalog" }],
    });
    assert.equal(beside.offer.status, "inactive");
    assert.equal(beside.offer.availabilities.some((row) => row.scope === "catalog"), true);
    let secondActive = false;
    try {
      await updateOffer(beside.offer.id, { status: "active" });
    } catch (error) {
      secondActive = true;
      assert.ok(error instanceof OfferWriteError);
      assert.equal(error.code, "conflict");
    }
    assert.equal(secondActive, true);
    const besideStill = await getOfferById(beside.offer.id);
    assert.equal(besideStill?.status, "inactive");

    const locationOne = await createOrReusePlantOffer({
      sellableVariantId: withPot.sellableVariantId,
      consumerPrice: 201,
      status: "active",
      availabilities: [{ scope: "partner_location", partnerLocationId: branchA.id }],
    });
    const locationTwo = await createOrReusePlantOffer({
      sellableVariantId: withPot.sellableVariantId,
      consumerPrice: 202,
      status: "active",
      availabilities: [{ scope: "partner_location", partnerLocationId: branchA.id }],
    });
    assert.notEqual(locationOne.offer.id, locationTwo.offer.id);
    assert.equal(locationOne.offer.status, "active");
    assert.equal(locationTwo.offer.status, "active");

    await updateOffer(potOffer.offer.id, {
      availabilities: [
        { scope: "partner_location", partnerLocationId: branchA.id },
        { scope: "partner_location", partnerLocationId: branchB.id },
      ],
    });

    const [firstConcurrent, secondConcurrent] = await Promise.allSettled([
      createOrReusePlantOffer({
        sellableVariantId: withPot.sellableVariantId,
        consumerPrice: 301,
        status: "active",
        availabilities: [{ scope: "catalog" }],
      }),
      createOrReusePlantOffer({
        sellableVariantId: withPot.sellableVariantId,
        consumerPrice: 302,
        status: "active",
        availabilities: [{ scope: "catalog" }],
      }),
    ]);
    const concurrentOutcomes = [firstConcurrent, secondConcurrent];
    assert.equal(concurrentOutcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(concurrentOutcomes.filter((item) => item.status === "rejected").length, 1);
    const rejected = concurrentOutcomes.find((item) => item.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof OfferWriteError);
    assert.equal(rejected.reason.code, "conflict");
    const activeCatalogCount = await sql`
      SELECT COUNT(*)::int AS n
      FROM offers o
      INNER JOIN offer_availabilities a ON a.offer_id = o.id AND a.scope = 'catalog'
      WHERE o.sellable_variant_id = ${withPot.sellableVariantId}::uuid
        AND o.status = 'active'
    `;
    assert.equal((activeCatalogCount as { n: number }[])[0]?.n, 1);

    const [sameA, sameB] = await Promise.all([
      createOrReusePlantOffer({
        sellableVariantId: withPot.sellableVariantId,
        consumerPrice: 303,
        status: "active",
        availabilities: [{ scope: "partner_location", partnerLocationId: branchA.id }],
      }),
      createOrReusePlantOffer({
        sellableVariantId: withPot.sellableVariantId,
        consumerPrice: 303,
        status: "active",
        availabilities: [{ scope: "partner_location", partnerLocationId: branchB.id }],
      }),
    ]);
    assert.equal(sameA.offer.id, sameB.offer.id);
    const sameRows = await sql`
      SELECT COUNT(*)::int AS n
      FROM offers
      WHERE sellable_variant_id = ${withPot.sellableVariantId}::uuid
        AND consumer_price = 303
    `;
    assert.equal((sameRows as { n: number }[])[0]?.n, 1);
    const sameOffer = await getOfferById(sameA.offer.id);
    assert.deepEqual(
      sameOffer?.availabilities.map((row) => row.partnerLocationId).filter(Boolean).sort(),
      [branchA.id, branchB.id].sort(),
    );

    const removable = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 404,
      status: "inactive",
      availabilities: [
        { scope: "catalog" },
        { scope: "partner_location", partnerLocationId: branchA.id },
      ],
    });
    const removableAvail = await sql`
      SELECT count(*)::int AS n FROM offer_availabilities WHERE offer_id = ${removable.offer.id}
    `;
    assert.equal((removableAvail as { n: number }[])[0]?.n, 2);
    const deleted = await adminDelete(removable.offer.id);
    assert.equal(deleted.status, 200);
    assert.equal(await getOfferById(removable.offer.id), undefined);
    const leftoverAvail = await sql`
      SELECT count(*)::int AS n FROM offer_availabilities WHERE offer_id = ${removable.offer.id}
    `;
    assert.equal((leftoverAvail as { n: number }[])[0]?.n, 0);

    const missingDelete = await adminDelete(randomUUID());
    assert.equal(missingDelete.status, 404);

    const posOffer = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 405,
      status: "active",
    });
    const posSpotId = randomUUID();
    await sql`
      INSERT INTO pos_spots (
        id, spot_name, partner_location_id, pos_name, spot_slug, current_offer_id, status, check_status, created_at
      ) VALUES (
        ${posSpotId}::uuid, ${`${tag} pos`}, ${branchA.id}, ${`${tag} pos`}, ${`offer-del-${posSpotId.slice(0, 8)}`},
        ${posOffer.offer.id}, 'available', false, now()
      )
    `;
    await assertDeleteBlocked(posOffer.offer.id, OFFER_ASSIGNED_TO_POS, "pos");
    const spotStill = await sql`
      SELECT current_offer_id, status FROM pos_spots WHERE id = ${posSpotId}::uuid
    `;
    assert.equal((spotStill as { current_offer_id: string }[])[0]?.current_offer_id, posOffer.offer.id);
    await sql`UPDATE pos_spots SET current_offer_id = NULL WHERE id = ${posSpotId}::uuid`;

    for (const spotStatus of ["sold", "inactive", "held_for_payment"] as const) {
      const statusOffer = await createOrReusePlantOffer({
        sellableVariantId: noPot.sellableVariantId,
        consumerPrice: 500 + spotStatus.length,
        status: "active",
      });
      const statusSpotId = randomUUID();
      await sql`
        INSERT INTO pos_spots (
          id, spot_name, partner_location_id, pos_name, spot_slug, current_offer_id, status,
          check_status, created_at, payment_hold_started_at
        ) VALUES (
          ${statusSpotId}::uuid,
          ${`${tag} ${spotStatus}`},
          ${branchA.id},
          ${`${tag} ${spotStatus}`},
          ${`offer-${spotStatus.slice(0, 3)}-${statusSpotId.slice(0, 8)}`},
          ${statusOffer.offer.id},
          ${spotStatus},
          false,
          now(),
          ${spotStatus === "held_for_payment" ? new Date().toISOString() : null}
        )
      `;
      const blocked = await adminDelete(statusOffer.offer.id);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.error, OFFER_ASSIGNED_TO_POS);
      const blockers = blocked.body.blockers as { kind: string; status?: string; posName?: string }[];
      assert.ok(blockers.some((item) => item.kind === "pos" && item.status === spotStatus));
      const assigned = await sql`
        SELECT current_offer_id FROM pos_spots WHERE id = ${statusSpotId}::uuid
      `;
      assert.equal(
        (assigned as { current_offer_id: string }[])[0]?.current_offer_id,
        statusOffer.offer.id,
      );
    }

    const orderOffer = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 406,
      status: "active",
    });
    const orderId = randomUUID();
    await sql`
      INSERT INTO orders (
        order_id, product_id, product_name, price, full_name,
        fulfillment_method, order_status, created_at, channel, offer_id
      ) VALUES (
        ${orderId}::uuid, ${plantId}, ${`${tag} plant`}, 406, 'Delete Buyer',
        'delivery', 'sold', now(), 'catalog', ${orderOffer.offer.id}
      )
    `;
    await assertRemovedFromCatalog(orderOffer.offer.id, 406, "active");
    const orderStill = await sql`SELECT offer_id FROM orders WHERE order_id = ${orderId}::uuid`;
    assert.equal((orderStill as { offer_id: string }[])[0]?.offer_id, orderOffer.offer.id);

    const payOffer = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 407,
      status: "active",
    });
    const payId = randomUUID();
    await sql`
      INSERT INTO payment_attempts (
        id, status, offer_id, product_id, product_name, full_name, customer_email,
        fulfillment_method, amount, payment_resume_token, created_at, updated_at, channel
      ) VALUES (
        ${payId}::uuid, 'cancelled', ${payOffer.offer.id}, ${plantId}, ${`${tag} plant`},
        'Delete Buyer', 'delete@example.com', 'delivery', 407, ${randomUUID()}, now(), now(), 'catalog'
      )
    `;
    await assertRemovedFromCatalog(payOffer.offer.id, 407, "active");
    const payStill = await sql`SELECT offer_id, status FROM payment_attempts WHERE id = ${payId}::uuid`;
    assert.equal((payStill as { offer_id: string; status: string }[])[0]?.offer_id, payOffer.offer.id);
    assert.equal((payStill as { status: string }[])[0]?.status, "cancelled");

    const pendingOffer = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 417,
      status: "active",
    });
    const pendingId = randomUUID();
    await sql`
      INSERT INTO payment_attempts (
        id, status, offer_id, product_id, product_name, full_name, customer_email,
        fulfillment_method, amount, payment_resume_token, created_at, updated_at, channel
      ) VALUES (
        ${pendingId}::uuid, 'awaiting_payment', ${pendingOffer.offer.id}, ${plantId}, ${`${tag} plant`},
        'Delete Buyer', 'delete@example.com', 'delivery', 417, ${randomUUID()}, now(), now(), 'catalog'
      )
    `;
    await assertDeleteBlocked(pendingOffer.offer.id, OFFER_UNFINISHED_PAYMENT, "payment");

    const historyOffer = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 408,
      status: "active",
    });
    const cycleId = randomUUID();
    await sql`
      INSERT INTO placement_cycles (
        id, pos_spot_id, plant_variant_id, started_at, ended_at, end_reason
      ) VALUES (
        ${cycleId}::uuid, ${posSpotId}::uuid, ${size.id}::uuid, now(), now(), 'removed'
      )
    `;
    await sql`
      INSERT INTO placement_segments (
        placement_cycle_id, started_at, ended_at, offer_id, consumer_price
      ) VALUES (
        ${cycleId}::uuid, now(), now(), ${historyOffer.offer.id}, 408
      )
    `;
    await assertRemovedFromCatalog(historyOffer.offer.id, 408, "active");
    const segmentStill = await sql`
      SELECT offer_id, consumer_price::float8 AS consumer_price
      FROM placement_segments
      WHERE offer_id = ${historyOffer.offer.id}
    `;
    assert.equal((segmentStill as { offer_id: string }[])[0]?.offer_id, historyOffer.offer.id);
    assert.equal((segmentStill as { consumer_price: number }[])[0]?.consumer_price, 408);

    const openOffer = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 418,
      status: "inactive",
    });
    const openCycleId = randomUUID();
    await sql`
      INSERT INTO placement_cycles (id, pos_spot_id, plant_variant_id, started_at)
      VALUES (${openCycleId}::uuid, ${posSpotId}::uuid, ${size.id}::uuid, now())
    `;
    await sql`
      INSERT INTO placement_segments (
        placement_cycle_id, started_at, offer_id, consumer_price
      ) VALUES (
        ${openCycleId}::uuid, now(), ${openOffer.offer.id}, 418
      )
    `;
    await assertDeleteBlocked(openOffer.offer.id, OFFER_OPEN_PLACEMENT, "placement");
    assert.equal((await listedIds()).includes(openOffer.offer.id), true);

    const itemOffer = await createOrReusePlantOffer({
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 409,
      status: "active",
    });
    await sql`
      INSERT INTO order_items (
        order_id, line_no, plant_id, plant_variant_id, sellable_variant_id, offer_id,
        quantity, unit_price, line_total, currency, plant_name
      ) VALUES (
        ${orderId}::uuid, 1, ${plantId}, ${size.id}::uuid, ${noPot.sellableVariantId}::uuid,
        ${itemOffer.offer.id}, 1, 409, 409, 'ILS', ${`${tag} plant`}
      )
    `;
    await assertRemovedFromCatalog(itemOffer.offer.id, 409, "active");
    const itemStill = await sql`
      SELECT offer_id FROM order_items WHERE offer_id = ${itemOffer.offer.id}
    `;
    assert.equal((itemStill as { offer_id: string }[])[0]?.offer_id, itemOffer.offer.id);
    const revived = await adminPost("plants", {
      sellableVariantId: noPot.sellableVariantId,
      consumerPrice: 409,
      status: "active",
      availabilities: [{ scope: "catalog" }],
    });
    assert.equal(revived.status, 409);
    assert.equal(revived.body.error, OFFER_REMOVED_REUSE);
    const stillHidden = await sql`
      SELECT admin_hidden, status FROM offers WHERE id = ${itemOffer.offer.id}
    `;
    assert.equal((stillHidden as { admin_hidden: boolean; status: string }[])[0]?.admin_hidden, true);
    assert.equal((stillHidden as { status: string }[])[0]?.status, "active");

    const legacyAssignedId = `legacy-assigned-${tag}`;
    await sql`
      INSERT INTO offers (id, product_id, consumer_price, status, created_at)
      VALUES (${legacyAssignedId}, ${plantId}, 80, 'active', now())
    `;
    const legacySpotId = randomUUID();
    await sql`
      INSERT INTO pos_spots (
        id, spot_name, partner_location_id, pos_name, spot_slug, current_offer_id, status, check_status, created_at
      ) VALUES (
        ${legacySpotId}::uuid, ${`${tag} legacy`}, ${branchA.id}, ${`${tag} legacy`},
        ${`legacy-${legacySpotId.slice(0, 8)}`}, ${legacyAssignedId}, 'available', false, now()
      )
    `;
    const legacySpot = await getPosSpotById(legacySpotId);
    assert.ok(legacySpot);
    assert.equal(posAllowsNewCustomerPurchase(legacySpot), true);
    assert.equal(legacySpot.plantVariantId, undefined);
    await assertDeleteBlocked(legacyAssignedId, OFFER_ASSIGNED_TO_POS, "pos");
    const legacyStillAssigned = await sql`
      SELECT current_offer_id FROM pos_spots WHERE id = ${legacySpotId}::uuid
    `;
    assert.equal(
      (legacyStillAssigned as { current_offer_id: string }[])[0]?.current_offer_id,
      legacyAssignedId,
    );

    const legacyHistoryId = `legacy-history-${tag}`;
    await sql`
      INSERT INTO offers (id, product_id, consumer_price, status, created_at)
      VALUES (${legacyHistoryId}, ${plantId}, 81, 'inactive', now())
    `;
    const legacyOrderId = randomUUID();
    await sql`
      INSERT INTO orders (
        order_id, product_id, product_name, price, full_name,
        fulfillment_method, order_status, created_at, channel, offer_id
      ) VALUES (
        ${legacyOrderId}::uuid, ${plantId}, ${`${tag} legacy`}, 81, 'Legacy Buyer',
        'delivery', 'sold', now(), 'catalog', ${legacyHistoryId}
      )
    `;
    assert.equal((await listedIds()).includes(legacyHistoryId), true);
    await assertRemovedFromCatalog(legacyHistoryId, 81, "inactive");
    const legacyOrderStill = await sql`
      SELECT offer_id FROM orders WHERE order_id = ${legacyOrderId}::uuid
    `;
    assert.equal((legacyOrderStill as { offer_id: string }[])[0]?.offer_id, legacyHistoryId);

    const legacyFreeId = `legacy-free-${tag}`;
    await sql`
      INSERT INTO offers (id, product_id, consumer_price, status, created_at)
      VALUES (${legacyFreeId}, ${plantId}, 82, 'inactive', now())
    `;
    assert.equal((await listedIds()).includes(legacyFreeId), true);
    const legacyDeleted = await adminDelete(legacyFreeId);
    assert.equal(legacyDeleted.status, 200);
    assert.equal(await getOfferById(legacyFreeId), undefined);

    let blockedDelete = false;
    try {
      await deleteSellableVariant({ plantId, sellableVariantId: noPot.sellableVariantId });
    } catch (error) {
      blockedDelete = true;
      assert.ok(error instanceof SellableVariantWriteError);
      assert.equal(error.code, "in_use");
    }
    assert.equal(blockedDelete, true);
    const variantStill = await sql`
      SELECT id FROM sellable_variants WHERE id = ${noPot.sellableVariantId}::uuid
    `;
    assert.equal((variantStill as { id: string }[]).length, 1);

    let blockedLocation = false;
    try {
      await sql`DELETE FROM partner_locations WHERE id = ${branchA.id}`;
    } catch {
      blockedLocation = true;
    }
    assert.equal(blockedLocation, true);
    const locationStill = await sql`SELECT id FROM partner_locations WHERE id = ${branchA.id}`;
    assert.equal((locationStill as { id: string }[]).length, 1);

    console.log("verify-offer-variants: ok");
  } finally {
    if (plantId) {
      await sql`
        DELETE FROM payment_attempts
        WHERE product_id = ${plantId}
           OR offer_id IN (SELECT id FROM offers WHERE product_id = ${plantId})
      `.catch(() => undefined);
      await sql`
        DELETE FROM order_items
        WHERE plant_id = ${plantId}
           OR offer_id IN (SELECT id FROM offers WHERE product_id = ${plantId})
      `.catch(() => undefined);
      await sql`
        DELETE FROM orders
        WHERE product_id = ${plantId}
           OR offer_id IN (SELECT id FROM offers WHERE product_id = ${plantId})
      `.catch(() => undefined);
      await sql`
        DELETE FROM placement_segments
        WHERE offer_id IN (SELECT id FROM offers WHERE product_id = ${plantId})
      `.catch(() => undefined);
      await sql`
        DELETE FROM placement_cycles
        WHERE plant_variant_id IN (SELECT id FROM plant_variants WHERE plant_id = ${plantId})
      `.catch(() => undefined);
      await sql`
        DELETE FROM pos_spots
        WHERE partner_location_id = ANY(${locationIds}::text[])
           OR current_offer_id IN (SELECT id FROM offers WHERE product_id = ${plantId})
      `.catch(() => undefined);
      await sql`
        DELETE FROM offers
        WHERE sellable_variant_id IN (
          SELECT sv.id
          FROM sellable_variants sv
          INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
          WHERE pv.plant_id = ${plantId}
        )
        OR id LIKE 'offer-sv-%'
        OR product_id = ${plantId}
      `;
    }
    if (flowerId) await sql`DELETE FROM offers WHERE product_id = ${flowerId}`;
    if (plantId) {
      await sql`
        DELETE FROM sellable_variants
        WHERE plant_variant_id IN (SELECT id FROM plant_variants WHERE plant_id = ${plantId})
      `;
      await sql`DELETE FROM plant_variants WHERE plant_id = ${plantId}`;
      await deletePlant(plantId).catch(() => undefined);
    }
    if (otherPlantId) await deletePlant(otherPlantId).catch(() => undefined);
    if (flowerId) await deletePlant(flowerId).catch(() => undefined);
    if (potId) {
      await deletePot(potId).catch(() => undefined);
    }
    for (const locationId of locationIds) {
      await sql`DELETE FROM partner_locations WHERE id = ${locationId}`.catch(() => undefined);
    }
    if (partnerId) {
      await sql`DELETE FROM partner_commission_tiers WHERE partner_id = ${partnerId}`.catch(() => undefined);
      await sql`DELETE FROM partners WHERE id = ${partnerId}`.catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

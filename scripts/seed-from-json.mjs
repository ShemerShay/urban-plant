/**
 * Idempotent seed: prototype JSON + mockLocations → Neon Postgres.
 * Run: npm run db:seed
 *
 * Requires: migration applied, DATABASE_URL in .env.local.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

import { loadEnvLocal } from "./load-env-local.mjs";
import { partnerLocations } from "./seed/partner-locations.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";
const ORDER_STATUSES = new Set(["sold", "picked_up", "delivered", "cancelled"]);
const EVENT_TYPES = new Set([
  "order_created",
  "order_cancelled",
  "manual_status_update",
  "plant_placed",
]);

/** @type {ReturnType<typeof neon>} */
let sql;

function assertNoQrSlug(value, context) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoQrSlug(item, `${context}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (key === "qrSlug" || key === "qr_slug") {
      throw new Error(`${context}: forbidden key "${key}" — run npm run db:cleanup-qr-slug first`);
    }
    assertNoQrSlug(value[key], `${context}.${key}`);
  }
}

function requireSpotSlug(record, context) {
  const spotSlug =
    typeof record.spotSlug === "string" && record.spotSlug.trim()
      ? record.spotSlug.trim()
      : null;
  if (!spotSlug) {
    throw new Error(`${context}: spotSlug is required`);
  }
  return spotSlug;
}

function normalizeOrderStatus(raw, source) {
  if (typeof raw === "string" && ORDER_STATUSES.has(raw)) return raw;
  if (
    (source === "deliveryStatus" && (raw === "available" || raw === "pending")) ||
    raw === "available" ||
    raw === "pending_payment"
  ) {
    return "sold";
  }
  return "sold";
}

async function readJsonArray(filename) {
  const filePath = path.join(dataDir, filename);
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${filename}: expected a JSON array`);
  }
  assertNoQrSlug(parsed, filename);
  return parsed;
}

async function seedPartnerLocations() {
  let count = 0;
  for (const loc of partnerLocations) {
    await sql`
      INSERT INTO partner_locations (id, name, address, type, partner_type, created_at)
      VALUES (
        ${loc.id},
        ${loc.name},
        ${loc.address},
        ${loc.type},
        ${loc.partnerType},
        ${loc.createdAt ?? SEED_CREATED_AT}::timestamptz
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        address = EXCLUDED.address,
        type = EXCLUDED.type,
        partner_type = EXCLUDED.partner_type
    `;
    count += 1;
  }
  return count;
}

async function seedOffers(rows) {
  const manualOffer = {
    id: "manual-offer",
    productId: "manual",
    consumerPrice: 0,
    status: "active",
    createdAt: SEED_CREATED_AT,
  };
  const all = [...rows];
  if (!all.some((o) => o.id === manualOffer.id)) {
    all.push(manualOffer);
  }

  let count = 0;
  for (const raw of all) {
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const productId = typeof raw.productId === "string" ? raw.productId.trim() : "";
    const consumerPrice =
      typeof raw.consumerPrice === "number" && Number.isFinite(raw.consumerPrice)
        ? raw.consumerPrice
        : null;
    const status = raw.status === "inactive" ? "inactive" : "active";
    const createdAt =
      typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : SEED_CREATED_AT;
    const supplierPrice =
      typeof raw.supplierPrice === "number" && Number.isFinite(raw.supplierPrice)
        ? raw.supplierPrice
        : null;
    const supplierName =
      typeof raw.supplierName === "string" && raw.supplierName.trim()
        ? raw.supplierName.trim()
        : null;

    if (!id || !productId || consumerPrice === null) {
      throw new Error(`offers.json: invalid offer row (id=${id || "?"})`);
    }

    await sql`
      INSERT INTO offers (
        id, product_id, consumer_price, supplier_price, supplier_name, status, created_at
      )
      VALUES (
        ${id},
        ${productId},
        ${consumerPrice},
        ${supplierPrice},
        ${supplierName},
        ${status},
        ${createdAt}::timestamptz
      )
      ON CONFLICT (id) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        consumer_price = EXCLUDED.consumer_price,
        supplier_price = EXCLUDED.supplier_price,
        supplier_name = EXCLUDED.supplier_name,
        status = EXCLUDED.status,
        created_at = EXCLUDED.created_at
    `;
    count += 1;
  }
  return count;
}

async function seedPosSpots(rows) {
  const spotIds = new Set();
  let count = 0;

  for (const raw of rows) {
    const context = `pos-spots.json id=${raw.id ?? "?"}`;
    const spotSlug = requireSpotSlug(raw, context);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const partnerLocationId =
      typeof raw.partnerLocationId === "string" ? raw.partnerLocationId.trim() : "";
    const currentOfferId =
      typeof raw.currentOfferId === "string" ? raw.currentOfferId.trim() : "";
    const spotDescription =
      typeof raw.spotDescription === "string" && raw.spotDescription.trim()
        ? raw.spotDescription.trim()
        : "Display spot";
    const status =
      raw.status === "sold" || raw.status === "inactive" ? raw.status : "available";
    const createdAt =
      typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : SEED_CREATED_AT;

    if (!id || !partnerLocationId || !currentOfferId) {
      throw new Error(`${context}: missing id, partnerLocationId, or currentOfferId`);
    }

    const posNumber =
      typeof raw.posNumber === "string" && raw.posNumber.trim() ? raw.posNumber.trim() : null;
    const placementNotes =
      typeof raw.placementNotes === "string" && raw.placementNotes.trim()
        ? raw.placementNotes.trim()
        : null;
    const placedAt =
      typeof raw.placedAt === "string" && raw.placedAt ? raw.placedAt : null;
    const latestMaintenanceStatus =
      raw.latestMaintenanceStatus === "checked" ||
      raw.latestMaintenanceStatus === "needs_watering" ||
      raw.latestMaintenanceStatus === "needs_treatment"
        ? raw.latestMaintenanceStatus
        : null;
    const lastCheckedAt =
      typeof raw.lastCheckedAt === "string" && raw.lastCheckedAt ? raw.lastCheckedAt : null;
    const lastWateredAt =
      typeof raw.lastWateredAt === "string" && raw.lastWateredAt ? raw.lastWateredAt : null;
    const lastHandledAt =
      typeof raw.lastHandledAt === "string" && raw.lastHandledAt ? raw.lastHandledAt : null;
    const lastHandledBy =
      typeof raw.lastHandledBy === "string" && raw.lastHandledBy.trim()
        ? raw.lastHandledBy.trim()
        : null;

    await sql`
      INSERT INTO pos_spots (
        id,
        partner_location_id,
        pos_number,
        spot_description,
        placement_notes,
        spot_slug,
        current_offer_id,
        status,
        placed_at,
        latest_maintenance_status,
        last_checked_at,
        last_watered_at,
        last_handled_at,
        last_handled_by,
        created_at
      )
      VALUES (
        ${id},
        ${partnerLocationId},
        ${posNumber},
        ${spotDescription},
        ${placementNotes},
        ${spotSlug},
        ${currentOfferId},
        ${status},
        ${placedAt}::timestamptz,
        ${latestMaintenanceStatus},
        ${lastCheckedAt}::timestamptz,
        ${lastWateredAt}::timestamptz,
        ${lastHandledAt}::timestamptz,
        ${lastHandledBy},
        ${createdAt}::timestamptz
      )
      ON CONFLICT (id) DO UPDATE SET
        partner_location_id = EXCLUDED.partner_location_id,
        pos_number = EXCLUDED.pos_number,
        spot_description = EXCLUDED.spot_description,
        placement_notes = EXCLUDED.placement_notes,
        spot_slug = EXCLUDED.spot_slug,
        current_offer_id = EXCLUDED.current_offer_id,
        status = EXCLUDED.status,
        placed_at = EXCLUDED.placed_at,
        latest_maintenance_status = EXCLUDED.latest_maintenance_status,
        last_checked_at = EXCLUDED.last_checked_at,
        last_watered_at = EXCLUDED.last_watered_at,
        last_handled_at = EXCLUDED.last_handled_at,
        last_handled_by = EXCLUDED.last_handled_by,
        created_at = EXCLUDED.created_at
    `;
    spotIds.add(id);
    count += 1;
  }

  return { count, spotIds };
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  assertNoQrSlug(snapshot, "orders.snapshot");
  if (
    Object.prototype.hasOwnProperty.call(snapshot, "spotSlug") &&
    (snapshot.spotSlug === undefined || snapshot.spotSlug === null || snapshot.spotSlug === "")
  ) {
    throw new Error("orders.snapshot: spotSlug must be a non-empty string when present");
  }
  return snapshot;
}

async function seedOrders(rows, spotIds, offerIds) {
  const warnings = [];
  let count = 0;

  for (const raw of rows) {
    const orderId = typeof raw.orderId === "string" ? raw.orderId.trim() : "";
    const plantId = typeof raw.plantId === "string" ? raw.plantId : "";
    const plantName = typeof raw.plantName === "string" ? raw.plantName : "";
    const price =
      typeof raw.price === "number" && Number.isFinite(raw.price) ? raw.price : null;
    const fullName = typeof raw.fullName === "string" ? raw.fullName : "";
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : null;
    const fulfillmentMethod = raw.fulfillmentMethod === "pickup" ? "pickup" : "delivery";

    let orderStatus;
    if (raw.orderStatus !== undefined) {
      orderStatus = normalizeOrderStatus(raw.orderStatus, "orderStatus");
    } else if (raw.deliveryStatus !== undefined) {
      orderStatus = normalizeOrderStatus(raw.deliveryStatus, "deliveryStatus");
    } else {
      orderStatus = "sold";
    }

    if (!orderId || !plantId || !plantName || price === null || !fullName || !createdAt) {
      throw new Error(`orders.json: invalid order row (orderId=${orderId || "?"})`);
    }

    let posSpotId =
      typeof raw.posSpotId === "string" && raw.posSpotId.trim() ? raw.posSpotId.trim() : null;
    if (posSpotId && !spotIds.has(posSpotId)) {
      warnings.push(`order ${orderId}: pos_spot_id ${posSpotId} not in pos-spots seed — storing NULL`);
      posSpotId = null;
    }

    let offerId =
      typeof raw.offerId === "string" && raw.offerId.trim() ? raw.offerId.trim() : null;
    if (offerId && !offerIds.has(offerId)) {
      warnings.push(`order ${orderId}: offer_id ${offerId} missing — storing NULL`);
      offerId = null;
    }

    const partnerLocationId =
      typeof raw.locationId === "string" && raw.locationId.trim() ? raw.locationId.trim() : null;
    const partnerLocationName =
      typeof raw.locationName === "string" && raw.locationName.trim()
        ? raw.locationName.trim()
        : null;
    const partnerLocationAddress =
      typeof raw.locationAddress === "string" && raw.locationAddress.trim()
        ? raw.locationAddress.trim()
        : null;

    const snapshot = sanitizeSnapshot(raw.snapshot);

    await sql`
      INSERT INTO orders (
        order_id,
        checkout_session_id,
        pos_spot_id,
        offer_id,
        product_id,
        product_name,
        partner_location_id,
        partner_location_name,
        partner_location_address,
        price,
        full_name,
        customer_email,
        phone,
        address,
        apartment_or_notes,
        fulfillment_method,
        order_status,
        source,
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        delivered_at,
        picked_up_at,
        snapshot,
        created_at
      )
      VALUES (
        ${orderId}::uuid,
        ${typeof raw.checkoutSessionId === "string" ? raw.checkoutSessionId : null},
        ${posSpotId},
        ${offerId},
        ${plantId},
        ${plantName},
        ${partnerLocationId},
        ${partnerLocationName},
        ${partnerLocationAddress},
        ${price},
        ${fullName},
        ${typeof raw.customerEmail === "string" && raw.customerEmail.trim() ? raw.customerEmail.trim() : null},
        ${typeof raw.phone === "string" ? raw.phone : ""},
        ${typeof raw.address === "string" ? raw.address : ""},
        ${typeof raw.apartmentOrNotes === "string" ? raw.apartmentOrNotes : ""},
        ${fulfillmentMethod},
        ${orderStatus},
        ${raw.source === "manual" || raw.source === "admin" || raw.source === "online" ? raw.source : null},
        ${typeof raw.cancelledAt === "string" ? raw.cancelledAt : null}::timestamptz,
        ${typeof raw.cancelledBy === "string" ? raw.cancelledBy : null},
        ${typeof raw.cancellationReason === "string" ? raw.cancellationReason : null},
        ${typeof raw.deliveredAt === "string" ? raw.deliveredAt : null}::timestamptz,
        ${typeof raw.pickedUpAt === "string" ? raw.pickedUpAt : null}::timestamptz,
        ${snapshot ? JSON.stringify(snapshot) : null}::jsonb,
        ${createdAt}::timestamptz
      )
      ON CONFLICT (order_id) DO UPDATE SET
        checkout_session_id = EXCLUDED.checkout_session_id,
        pos_spot_id = EXCLUDED.pos_spot_id,
        offer_id = EXCLUDED.offer_id,
        product_id = EXCLUDED.product_id,
        product_name = EXCLUDED.product_name,
        partner_location_id = EXCLUDED.partner_location_id,
        partner_location_name = EXCLUDED.partner_location_name,
        partner_location_address = EXCLUDED.partner_location_address,
        price = EXCLUDED.price,
        full_name = EXCLUDED.full_name,
        customer_email = EXCLUDED.customer_email,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        apartment_or_notes = EXCLUDED.apartment_or_notes,
        fulfillment_method = EXCLUDED.fulfillment_method,
        order_status = EXCLUDED.order_status,
        source = EXCLUDED.source,
        cancelled_at = EXCLUDED.cancelled_at,
        cancelled_by = EXCLUDED.cancelled_by,
        cancellation_reason = EXCLUDED.cancellation_reason,
        delivered_at = EXCLUDED.delivered_at,
        picked_up_at = EXCLUDED.picked_up_at,
        snapshot = EXCLUDED.snapshot,
        created_at = EXCLUDED.created_at
    `;
    count += 1;
  }

  return { count, warnings };
}

function sanitizeEventData(data, context) {
  if (data === undefined || data === null) return null;
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${context}: data must be an object`);
  }
  assertNoQrSlug(data, `${context}.data`);
  if (Object.prototype.hasOwnProperty.call(data, "spotSlug")) {
    const slug = data.spotSlug;
    if (typeof slug !== "string" || !slug.trim()) {
      throw new Error(`${context}.data: spotSlug must be a non-empty string when present`);
    }
  }
  return data;
}

async function seedEvents(rows) {
  let count = 0;

  for (const raw of rows) {
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const type = typeof raw.type === "string" ? raw.type : "";
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : null;

    if (!id || !EVENT_TYPES.has(type) || !createdAt) {
      throw new Error(`events.json: invalid event (id=${id || "?"})`);
    }

    const data = sanitizeEventData(raw.data, `events.json id=${id}`);

    await sql`
      INSERT INTO events (
        id,
        type,
        pos_spot_id,
        offer_id,
        order_id,
        product_id,
        partner_location_id,
        created_at,
        created_by,
        data
      )
      VALUES (
        ${id}::uuid,
        ${type},
        ${typeof raw.posSpotId === "string" && raw.posSpotId.trim() ? raw.posSpotId.trim() : null},
        ${typeof raw.offerId === "string" && raw.offerId.trim() ? raw.offerId.trim() : null},
        ${typeof raw.orderId === "string" && raw.orderId.trim() ? raw.orderId : null}::uuid,
        ${typeof raw.productId === "string" && raw.productId.trim() ? raw.productId.trim() : null},
        ${typeof raw.partnerLocationId === "string" && raw.partnerLocationId.trim()
          ? raw.partnerLocationId.trim()
          : null},
        ${createdAt}::timestamptz,
        ${typeof raw.createdBy === "string" && raw.createdBy.trim() ? raw.createdBy.trim() : null},
        ${data ? JSON.stringify(data) : null}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        pos_spot_id = EXCLUDED.pos_spot_id,
        offer_id = EXCLUDED.offer_id,
        order_id = EXCLUDED.order_id,
        product_id = EXCLUDED.product_id,
        partner_location_id = EXCLUDED.partner_location_id,
        created_at = EXCLUDED.created_at,
        created_by = EXCLUDED.created_by,
        data = EXCLUDED.data
    `;
    count += 1;
  }

  return count;
}

async function printCounts() {
  const [
    partnerLocations,
    offers,
    posSpots,
    orders,
    events,
  ] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM partner_locations`,
    sql`SELECT count(*)::int AS n FROM offers`,
    sql`SELECT count(*)::int AS n FROM pos_spots`,
    sql`SELECT count(*)::int AS n FROM orders`,
    sql`SELECT count(*)::int AS n FROM events`,
  ]);
  console.log(`  partner_locations: ${partnerLocations[0].n}`);
  console.log(`  offers: ${offers[0].n}`);
  console.log(`  pos_spots: ${posSpots[0].n}`);
  console.log(`  orders: ${orders[0].n}`);
  console.log(`  events: ${events[0].n}`);
}

await loadEnvLocal();
sql = neon(process.env.DATABASE_URL);

console.log("Seeding Neon from prototype data...\n");

const partnerCount = await seedPartnerLocations();
console.log(`partner_locations: ${partnerCount} row(s)`);

const offerRows = await readJsonArray("offers.json");
const offerCount = await seedOffers(offerRows);
const offerIds = new Set([
  ...offerRows.map((o) => o.id).filter(Boolean),
  "manual-offer",
]);
console.log(`offers: ${offerCount} row(s) (includes manual-offer if missing)`);

const posSpotRows = await readJsonArray("pos-spots.json");
const { count: posSpotCount, spotIds } = await seedPosSpots(posSpotRows);
console.log(`pos_spots: ${posSpotCount} row(s)`);

const orderRows = await readJsonArray("orders.json");
const { count: orderCount, warnings: orderWarnings } = await seedOrders(
  orderRows,
  spotIds,
  offerIds,
);
console.log(`orders: ${orderCount} row(s)`);
for (const w of orderWarnings) console.warn(`  warn: ${w}`);

const eventRows = await readJsonArray("events.json");
const eventCount = await seedEvents(eventRows);
console.log(`events: ${eventCount} row(s)`);

console.log("\nTable counts:");
await printCounts();

console.log("\nSeed complete.");

/**
 * Smoke-test DB-backed storage (requires DATABASE_URL in .env.local).
 * Run: npm run db:verify-storage
 */
import { randomUUID } from "node:crypto";

import { loadEnvLocal } from "./load-env-local.mjs";

async function main() {
  await loadEnvLocal();

  const { appendEvent, readEvents } = await import("../lib/eventStorage");
  const { appendOrder, readOrders, replaceOrder } = await import("../lib/ordersStorage");
  const { readPartnerLocations } = await import("../lib/partnerLocationStorage");
  const { getPosSpotBySpotSlug, setPosSpotStatus } = await import("../lib/posSpotStorage");

  const slug = "cafe-noir-front-shelf";
  const spot = await getPosSpotBySpotSlug(slug);
  if (!spot) {
    console.error(`FAIL: POS spot not found for /pos/${slug}`);
    process.exit(1);
  }
  console.log(`OK: /pos/${slug} resolves → ${spot.id} (${spot.status})`);

  const partners = await readPartnerLocations();
  console.log(`OK: partner_locations → ${partners.length} row(s)`);

  const testOrderId = randomUUID();
  const beforeStatus = spot.status;
  await appendOrder({
    orderId: testOrderId,
    id: testOrderId,
    posSpotId: spot.id,
    offerId: spot.currentOfferId,
    plantId: "monstera",
    plantName: "Monstera Deliciosa",
    locationId: spot.partnerLocationId,
    locationName: "Cafe Noir",
    locationAddress: "Tel Aviv",
    price: 89,
    fullName: "Storage Verify",
    phone: "0500000000",
    address: "Test",
    apartmentOrNotes: "",
    fulfillmentMethod: "delivery",
    createdAt: new Date().toISOString(),
    orderStatus: "sold",
    source: "admin",
  });

  const soldSpot = await setPosSpotStatus(spot.id, "sold");
  if (soldSpot?.status !== "sold") {
    console.error("FAIL: POS spot did not become sold");
    process.exit(1);
  }
  console.log("OK: POS spot status → sold");

  await appendEvent({
    id: randomUUID(),
    type: "order_created",
    posSpotId: spot.id,
    offerId: spot.currentOfferId,
    orderId: testOrderId,
    productId: "monstera",
    partnerLocationId: spot.partnerLocationId,
    createdAt: new Date().toISOString(),
    createdBy: "admin",
    data: { fulfillmentMethod: "delivery", orderStatus: "sold" },
  });

  const orders = await readOrders();
  const inserted = orders.find((o) => o.orderId === testOrderId);
  if (!inserted) {
    console.error("FAIL: order not found after appendOrder");
    process.exit(1);
  }
  console.log("OK: order inserted");

  const cancelledAt = new Date().toISOString();
  await replaceOrder({
    ...inserted,
    orderStatus: "cancelled",
    cancelledAt,
    cancelledBy: "admin",
    cancellationReason: "verify script",
  });
  const restored = await setPosSpotStatus(spot.id, "available");
  if (restored?.status !== "available") {
    console.error("FAIL: POS spot not restored to available");
    process.exit(1);
  }
  console.log("OK: cancel flow → order cancelled, POS spot available");

  const events = await readEvents();
  const createdEvent = events.find(
    (e) => e.orderId === testOrderId && e.type === "order_created",
  );
  if (!createdEvent) {
    console.error("FAIL: order_created event missing");
    process.exit(1);
  }
  console.log("OK: event inserted");

  await setPosSpotStatus(spot.id, beforeStatus);
  console.log(`OK: restored POS spot status → ${beforeStatus}`);
  console.log("\nAll storage checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

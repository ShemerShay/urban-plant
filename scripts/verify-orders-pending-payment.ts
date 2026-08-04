/**
 * Phase A verification: pending_payment on orders (schema/types/normalizer).
 * No Cardcom, no POS mutations, no email.
 *
 * Run: npx tsx scripts/verify-orders-pending-payment.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  canFinalizePendingPayment,
  canTransitionOrderStatus,
  isOrderStatus,
  isVerifiedPaidOrderStatus,
  ORDER_STATUS_LABELS,
  parseOrderStatus,
} from "../lib/status";

function assertPure(): void {
  assert.equal(isOrderStatus("pending_payment"), true);
  assert.equal(parseOrderStatus("pending_payment"), "pending_payment");
  assert.equal(ORDER_STATUS_LABELS.pending_payment, "Pending payment");
  assert.notEqual(ORDER_STATUS_LABELS.pending_payment, ORDER_STATUS_LABELS.sold);

  assert.equal(isVerifiedPaidOrderStatus("pending_payment"), false);
  assert.equal(isVerifiedPaidOrderStatus("sold"), true);
  assert.equal(isVerifiedPaidOrderStatus("picked_up"), true);
  assert.equal(isVerifiedPaidOrderStatus("delivered"), true);
  assert.equal(isVerifiedPaidOrderStatus("cancelled"), false);

  assert.equal(canFinalizePendingPayment("pending_payment", "sold"), true);
  assert.equal(canFinalizePendingPayment("pending_payment", "picked_up"), true);
  assert.equal(canFinalizePendingPayment("pending_payment", "cancelled"), true);
  assert.equal(canFinalizePendingPayment("pending_payment", "delivered"), false);
  assert.equal(canFinalizePendingPayment("sold", "picked_up"), false);

  assert.equal(canTransitionOrderStatus("pending_payment", "sold"), false);
  assert.equal(canTransitionOrderStatus("pending_payment", "picked_up"), false);
  assert.equal(canTransitionOrderStatus("pending_payment", "delivered"), false);
  assert.equal(canTransitionOrderStatus("pending_payment", "cancelled"), true);
  assert.equal(canTransitionOrderStatus("sold", "delivered"), true);

  console.log("verify-orders-pending-payment: pure status helpers ok");
}

async function assertNormalizerAndDb(): Promise<void> {
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  try {
    await loadEnvLocal();
  } catch {
    console.log("verify-orders-pending-payment: skip DB (no DATABASE_URL)");
    return;
  }

  const { normalizeLegacyOrderStatus, appendOrder, readOrders, replaceOrder } =
    await import("../lib/ordersStorage");
  const { sql } = await import("../lib/db");

  assert.equal(
    normalizeLegacyOrderStatus("pending_payment", "orderStatus"),
    "pending_payment",
  );
  assert.notEqual(
    normalizeLegacyOrderStatus("pending_payment", "orderStatus"),
    "sold",
  );
  assert.equal(normalizeLegacyOrderStatus("sold", "orderStatus"), "sold");
  assert.equal(normalizeLegacyOrderStatus("picked_up", "orderStatus"), "picked_up");
  assert.equal(normalizeLegacyOrderStatus("delivered", "orderStatus"), "delivered");
  assert.equal(normalizeLegacyOrderStatus("cancelled", "orderStatus"), "cancelled");
  assert.equal(normalizeLegacyOrderStatus("available", "orderStatus"), "sold");
  assert.equal(normalizeLegacyOrderStatus("pending", "deliveryStatus"), "sold");

  console.log("verify-orders-pending-payment: normalizer ok");

  // CHECK accepts pending_payment
  const orderId = randomUUID();
  const sessionA = `lp-test-${randomUUID()}`;
  const sessionB = `lp-test-${randomUUID()}`;

  await appendOrder({
    orderId,
    plantId: "verify-pending-plant",
    plantName: "Verify Pending Plant",
    locationId: null,
    locationName: null,
    locationAddress: null,
    price: 1,
    fullName: "Verify Pending",
    customerEmail: "verify-pending@example.com",
    phone: "0500000000",
    address: "",
    apartmentOrNotes: "",
    fulfillmentMethod: "delivery",
    createdAt: new Date().toISOString(),
    orderStatus: "pending_payment",
    source: "online",
    checkoutSessionId: sessionA,
  });

  const loaded = (await readOrders()).find((o) => o.orderId === orderId);
  assert.ok(loaded);
  assert.equal(loaded!.orderStatus, "pending_payment");
  assert.equal(loaded!.checkoutSessionId, sessionA);
  assert.equal(ORDER_STATUS_LABELS[loaded!.orderStatus], "Pending payment");
  assert.equal(isVerifiedPaidOrderStatus(loaded!.orderStatus), false);

  // Unknown status rejected by CHECK
  let unknownRejected = false;
  try {
    await sql`
      UPDATE orders
      SET order_status = 'not_a_real_status'
      WHERE order_id = ${orderId}::uuid
    `;
  } catch {
    unknownRejected = true;
  }
  assert.equal(unknownRejected, true);

  // Duplicate non-null checkout_session_id rejected
  const orderId2 = randomUUID();
  let dupRejected = false;
  try {
    await appendOrder({
      orderId: orderId2,
      plantId: "verify-pending-plant-2",
      plantName: "Verify Pending Plant 2",
      locationId: null,
      locationName: null,
      locationAddress: null,
      price: 1,
      fullName: "Verify Pending 2",
      phone: "0500000001",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      createdAt: new Date().toISOString(),
      orderStatus: "pending_payment",
      source: "online",
      checkoutSessionId: sessionA,
    });
  } catch {
    dupRejected = true;
  }
  assert.equal(dupRejected, true);

  // Multiple null checkout_session_id allowed
  const orderId3 = randomUUID();
  const orderId4 = randomUUID();
  await appendOrder({
    orderId: orderId3,
    plantId: "verify-null-session-a",
    plantName: "Null Session A",
    locationId: null,
    locationName: null,
    locationAddress: null,
    price: 1,
    fullName: "Null A",
    phone: "0500000002",
    address: "",
    apartmentOrNotes: "",
    fulfillmentMethod: "delivery",
    createdAt: new Date().toISOString(),
    orderStatus: "pending_payment",
    source: "online",
  });
  await appendOrder({
    orderId: orderId4,
    plantId: "verify-null-session-b",
    plantName: "Null Session B",
    locationId: null,
    locationName: null,
    locationAddress: null,
    price: 1,
    fullName: "Null B",
    phone: "0500000003",
    address: "",
    apartmentOrNotes: "",
    fulfillmentMethod: "delivery",
    createdAt: new Date().toISOString(),
    orderStatus: "pending_payment",
    source: "online",
  });

  // Different non-null session ok
  await replaceOrder({
    ...loaded!,
    checkoutSessionId: sessionB,
  });

  console.log("verify-orders-pending-payment: DB CHECK + unique session ok");

  // Cleanup test rows (no POS / email / Cardcom)
  await sql`DELETE FROM orders WHERE order_id = ${orderId}::uuid`;
  await sql`DELETE FROM orders WHERE order_id = ${orderId3}::uuid`;
  await sql`DELETE FROM orders WHERE order_id = ${orderId4}::uuid`;
  await sql`DELETE FROM orders WHERE order_id = ${orderId2}::uuid`;
}

assertPure();
void assertNormalizerAndDb()
  .then(() => {
    console.log("verify-orders-pending-payment: done (no Cardcom / POS / email)");
  })
  .catch((error) => {
    console.error("verify-orders-pending-payment: FAILED", error);
    process.exitCode = 1;
  });

/**
 * Admin Catalog order visibility + read-only needs_reconciliation.
 * Source and helper checks only. Does not call Cardcom or Gmail.
 *
 * Run: npx tsx scripts/verify-admin-catalog-orders.ts
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  catalogLineViewFromStoredLine,
  catalogStoredItemSummary,
  catalogStoredPlantName,
  reconciliationAttemptViewFromAttempt,
} from "../lib/adminOrderDisplay";
import { filterOrders, parseChannel } from "../lib/adminOrdersFilterUtils";
import type { SavedOrder } from "../lib/orderTypes";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function line(patch: Partial<ReturnType<typeof catalogLineViewFromStoredLine>> = {}) {
  return catalogLineViewFromStoredLine({
    lineNo: 1,
    plantId: "plant-a",
    plantName: "Monstera",
    plantNameHe: "מונסטרה",
    sizeLabel: "M",
    potName: "Clay",
    potColor: "Terracotta",
    quantity: 2,
    unitPrice: 50,
    lineTotal: 100,
    currency: "ILS",
    ...patch,
  });
}

function order(patch: Partial<SavedOrder> = {}): SavedOrder {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    plantId: "plant-a",
    plantName: "Urban Plant (2 items)",
    locationId: null,
    locationName: null,
    locationAddress: null,
    price: 100,
    fullName: "Ada",
    phone: "0500000000",
    address: "Tel Aviv, Rothschild Blvd 12",
    apartmentOrNotes: "",
    fulfillmentMethod: "delivery",
    createdAt: "2026-04-01T10:00:00.000Z",
    orderStatus: "sold",
    channel: "catalog",
    ...patch,
  };
}

function assertSources(): void {
  const page = read("app/admin/orders/page.tsx");
  assert.match(page, /getOrderItemsByOrderIds/);
  assert.match(page, /listCatalogPaymentAttemptsNeedingReconciliation/);
  assert.match(page, /reconciliationViews\.length > 0/);
  assert.doesNotMatch(page, /approve|refund|retry|manual.?resolv/i);

  const card = read("components/admin/AdminOrderCard.tsx");
  assert.match(card, /isCatalogAdminOrder/);
  assert.match(card, /AdminCatalogOrderLines/);
  assert.match(card, /partnerLocation/);
  assert.match(card, /getPlantById/);

  const recon = read("components/admin/AdminReconciliationCard.tsx");
  assert.match(recon, /AdminCatalogOrderLines/);
  assert.doesNotMatch(recon, /<button/);
  assert.doesNotMatch(recon, /fetch\(/);
  assert.doesNotMatch(recon, /approve|refund|retry/i);

  const storage = read("lib/ordersStorage.ts");
  assert.match(storage, /export async function readOrders/);
  assert.match(storage, /purchase_email_status/);
  assert.doesNotMatch(storage, /FROM order_items/);
  const readOrdersSlice = storage.slice(
    storage.indexOf("export async function readOrders"),
    storage.indexOf("export async function saveOrders"),
  );
  assert.match(readOrdersSlice, /purchase_email_status/);
  assert.match(readOrdersSlice, /cardcom_transaction_id/);
  assert.doesNotMatch(readOrdersSlice, /order_items/);

  const attempts = read("lib/paymentAttemptStorage.ts");
  assert.match(attempts, /listCatalogPaymentAttemptsNeedingReconciliation/);
  assert.match(attempts, /markCatalogLateSuccessNeedsReconciliation/);
  assert.match(attempts, /channel = 'catalog'/);
  assert.match(attempts, /AND status IN \('expired', 'cancelled', 'failed'\)/);

  const webhook = read("lib/processCardcomWebhook.ts");
  assert.match(webhook, /alertCatalogReconciliation/);
  assert.match(webhook, /finalized\.firstTransition/);
  assert.match(webhook, /markCatalogLateSuccessNeedsReconciliation/);
  assert.doesNotMatch(webhook, /alertCatalogReconciliation\(current, true/);
  assert.match(webhook, /notifyCatalogReconciliation \?\? notifyCatalogNeedsReconciliation/);
  assert.match(webhook, /catalog_reconciliation_alert_failed/);

  const finalize = read("lib/finalizeCatalogPayment.ts");
  assert.match(finalize, /firstTransition: claimed/);
  assert.match(finalize, /firstTransition: true/);
  assert.match(finalize, /AND a.status = 'awaiting_payment'/);
  assert.doesNotMatch(finalize, /notifyCatalogNeedsReconciliation|sendInternalCatalogReconciliationAlert/);
  assert.doesNotMatch(finalize, /sendPurchaseEmail/);

  const alert = read("lib/catalogReconciliationAlert.ts");
  assert.match(alert, /sendInternalCatalogReconciliationAlert/);
  assert.match(alert, /send_failed/);
  assert.match(alert, /attempt.channel !== "catalog"/);

  assert.equal(existsSync(join(root, "app/admin/orders/[orderId]/page.tsx")), false);
  assert.doesNotMatch(read("lib/adminNav.ts"), /reconciliation/);

  console.log("verify-admin-catalog-orders: source boundaries ok");
}

async function assertHelpers(): Promise<void> {
  assert.equal(parseChannel(undefined), "all");
  assert.equal(parseChannel("catalog"), "catalog");
  assert.equal(parseChannel("partner"), "partner");
  assert.equal(parseChannel("flowers"), "all");

  const catalog = order();
  const secondLine = line({
    lineNo: 2,
    plantId: "plant-b",
    plantName: "Fern",
    plantNameHe: "שרך",
    potName: null,
    potColor: null,
    quantity: 1,
    unitPrice: 55,
    lineTotal: 55,
  });
  const items = {
    [catalog.orderId]: [line(), secondLine],
  };

  const partner = order({
    orderId: "22222222-2222-2222-2222-222222222222",
    channel: "partner",
    plantId: "pos-plant",
    plantName: "POS Monstera",
    locationId: "loc-1",
    locationName: "Alon",
    snapshot: {
      productId: "pos-plant",
      productName: "POS Monstera",
      offerId: "offer-1",
      consumerPrice: 89,
      partnerLocationId: "loc-1",
      partnerLocationName: "Alon",
      fulfillmentType: "pickup",
    },
    fulfillmentMethod: "pickup",
  });

  const all = [catalog, partner];

  assert.equal(filterOrders(all, {
    statuses: [],
    channel: "catalog",
    location: "all",
    plant: "all",
  }, items).map((row) => row.orderId).join(), catalog.orderId);

  assert.equal(filterOrders(all, {
    statuses: [],
    channel: "partner",
    location: "all",
    plant: "all",
  }, items).map((row) => row.orderId).join(), partner.orderId);

  assert.equal(filterOrders(all, {
    statuses: [],
    channel: "all",
    location: "all",
    plant: "plant-b",
  }, items).map((row) => row.orderId).join(), catalog.orderId);

  assert.equal(filterOrders(all, {
    statuses: [],
    channel: "all",
    location: "all",
    plant: "pos-plant",
  }, items).map((row) => row.orderId).join(), partner.orderId);

  assert.equal(filterOrders(all, {
    statuses: [],
    channel: "all",
    location: "loc-1",
    plant: "all",
  }, items).map((row) => row.orderId).join(), partner.orderId);

  assert.equal(filterOrders([catalog], {
    statuses: ["sold"],
    channel: "all",
    location: "all",
    plant: "all",
  }, items).length, 1);

  assert.equal(catalogStoredPlantName(line(), "he"), "מונסטרה");
  assert.equal(catalogStoredPlantName(line(), "en"), "Monstera");
  assert.match(catalogStoredItemSummary(items[catalog.orderId], "en"), /Monstera/);
  assert.doesNotMatch(catalogStoredItemSummary(items[catalog.orderId], "en"), /Urban Plant/);

  const recon = reconciliationAttemptViewFromAttempt({
    id: "attempt-1",
    createdAt: "2026-04-01T10:00:00.000Z",
    fullName: "Ada",
    phone: "0500000000",
    customerEmail: "ada@example.com",
    address: "Tel Aviv, Rothschild Blvd 12",
    apartmentOrNotes: "",
    amount: 155,
    failureReason: "catalog_holds_unsafe",
    cardcomTransactionId: 99,
    catalogSnapshot: { lines: items[catalog.orderId] },
  });
  assert.equal(recon.lines.length, 2);
  assert.equal(recon.lines[1]?.plantName, "Fern");
  assert.equal(recon.amount, 155);

  await import("./stub-server-only.mjs");
  const { buildInternalCatalogReconciliationAlertHtml } = await import("../lib/purchaseEmail");
  const html = buildInternalCatalogReconciliationAlertHtml({
    attemptId: "attempt-1",
    fullName: "Ada",
    customerEmail: "ada@example.com",
    amountDisplay: "₪155",
    phone: "0500000000",
    address: "Tel Aviv, Rothschild Blvd 12",
    failureReason: "catalog_holds_unsafe",
    cardcomTransactionId: 99,
    lines: [
      { plantName: "Monstera", potName: "Clay", quantity: 2 },
      { plantName: "Fern", quantity: 1 },
    ],
  });
  assert.match(html, /attempt-1/);
  assert.match(html, /Ada/);
  assert.match(html, /catalog_holds_unsafe/);
  assert.match(html, /Monstera \+ Clay × 2/);
  assert.match(html, /Fern × 1/);

  console.log("verify-admin-catalog-orders: helper checks ok");
}

async function main(): Promise<void> {
  assertSources();
  await assertHelpers();
  console.log("verify-admin-catalog-orders: ok");
}

void main();

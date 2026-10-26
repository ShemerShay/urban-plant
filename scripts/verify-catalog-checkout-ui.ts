/**
 * Catalog checkout UI: cart handoff, delivery form, payment errors, and success clearing.
 * Does not call Cardcom, migrate a database, or change POS payment preparation.
 *
 * Run: npx tsx scripts/verify-catalog-checkout-ui.ts
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EMPTY_CATALOG_CART,
  subtractPurchasedCatalogItems,
  type CatalogCartResolvedLine,
} from "../lib/catalogCart";
import {
  catalogCheckoutLinesMatch,
  catalogCheckoutPaymentFailure,
  catalogCheckoutPaymentLines,
  claimCatalogCheckoutSubmit,
  releaseCatalogCheckoutSubmit,
  shouldClearCatalogCartOnStatus,
} from "../lib/catalogCheckoutFlow";
import {
  mapPaymentAttemptToClientState,
  paymentVerificationRedirectPath,
} from "../lib/cardcomPaymentStatus";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function line(patch: Partial<CatalogCartResolvedLine> = {}): CatalogCartResolvedLine {
  return {
    plantId: "plant-1",
    plantSizeId: "size-1",
    sellableVariantId: "sv-1",
    offerId: "offer-1",
    potColorId: null,
    quantity: 1,
    availableQuantity: 4,
    name: "Fern",
    unitPrice: 40,
    currency: "ILS",
    ...patch,
  };
}

function assertWiring(): void {
  assert.equal(existsSync(join(root, "app/cart/page.tsx")), false);
  assert.equal(existsSync(join(root, "app/checkout/shop/page.tsx")), true);

  const cartUi = read("components/shop/ShopCart.tsx");
  assert.match(cartUi, /routes\.shop\.checkout\(\)/);
  assert.match(cartUi, /disabled/);
  assert.doesNotMatch(cartUi, /shopCheckout\(/);
  assert.doesNotMatch(cartUi, /startCatalogCardcomPayment/);
  assert.doesNotMatch(cartUi, /cardcomCreate/);
  assert.doesNotMatch(cartUi, /href=\"\/cart\"/);

  const checkout = read("components/shop/ShopCheckout.tsx");
  assert.match(checkout, /useState\(false\)/);
  assert.match(checkout, /show=\{\{ email: false \}\}/);
  assert.match(checkout, /emailOptIn \?/);
  assert.match(checkout, /CheckoutEmailOptIn/);
  assert.match(checkout, /DeliveryAddressFields/);
  assert.match(checkout, /routes\.api\.shopCheckout\(\)/);
  assert.match(checkout, /routes\.api\.cardcomRetry\(\)/);
  assert.match(checkout, /catalogCheckoutPaymentFailure/);
  assert.match(checkout, /setReviewRequired\(true\)/);
  assert.match(checkout, /shop\.cartChanged/);
  assert.match(checkout, /shop\.insufficientStock/);
  assert.match(checkout, /formatCatalogPrice\(0/);
  assert.match(checkout, /rememberCatalogCheckoutSnapshot/);
  assert.match(checkout, /claimCatalogCheckoutSubmit/);
  assert.match(checkout, /ShopSoftSpinner/);
  assert.match(checkout, /<details /);
  assert.match(checkout, /lg:hidden/);
  assert.match(checkout, /lg:sticky/);
  assert.doesNotMatch(checkout, /shop\.deliveryOnly/);
  assert.doesNotMatch(checkout, /common\.loading\}<\/p>/);
  assert.doesNotMatch(checkout, /fulfillmentMethod/);
  assert.doesNotMatch(checkout, /finalizeCatalog/);
  assert.doesNotMatch(checkout, /pickup/);

  const checkoutPage = read("app/checkout/shop/page.tsx");
  assert.match(checkoutPage, /data-page=\"shop-checkout\"/);
  assert.match(checkoutPage, /getAwaitingPaymentAttemptForResume/);
  assert.match(checkoutPage, /attempt\.channel !== \"catalog\"/);
  assert.doesNotMatch(checkoutPage, /plantUnitCost/);
  assert.doesNotMatch(checkoutPage, /startCatalogCardcomPayment/);

  const route = read("app/api/shop/checkout/route.ts");
  assert.match(route, /export async function POST/);
  assert.match(route, /startCatalogCardcomPayment/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.doesNotMatch(route, /INSERT INTO/);
  assert.doesNotMatch(route, /catalog_stock_holds/);
  assert.doesNotMatch(route, /finalizeCatalog/);

  const shopReads = read("lib/catalogShop.ts");
  assert.match(shopReads, /catalog_stock_holds/);
  assert.match(shopReads, /expires_at > now\(\)/);
  assert.match(shopReads, /Does not write inventory/);
  assert.doesNotMatch(shopReads, /UPDATE inventory/);
  assert.doesNotMatch(shopReads, /applyInventoryDelta/);
  assert.doesNotMatch(shopReads, /!potImage\) continue/);
  const catalogPrep = read("lib/catalogPaymentPrep.ts");
  assert.doesNotMatch(catalogPrep, /parent_pot\.image/);
  assert.doesNotMatch(catalogPrep, /potImage/);

  const posCreate = read("app/api/payments/cardcom/create/route.ts");
  assert.match(posCreate, /startCardcomPaymentPrep/);
  assert.doesNotMatch(posCreate, /startCatalogCardcomPayment/);

  const retryRoute = read("app/api/payments/cardcom/retry/route.ts");
  assert.match(retryRoute, /retryCardcomPayment/);
  assert.doesNotMatch(retryRoute, /startCatalogCardcomPayment/);

  const posCheckout = read("app/checkout/pos/[spotSlug]/page.tsx");
  assert.doesNotMatch(posCheckout, /ShopCheckout/);
  assert.doesNotMatch(posCheckout, /startCatalogCardcomPayment/);
  const posForm = read("components/checkout/CheckoutForm.tsx");
  assert.doesNotMatch(posForm, /shopCheckout/);
  assert.doesNotMatch(posForm, /clearCatalogCartForPaymentStatus/);

  const fields = read("components/checkout/CheckoutCustomerFields.tsx");
  assert.match(fields, /className=\"sr-only\"/);
  assert.doesNotMatch(fields, /text-body font-medium text-slate-700/);
  const address = read("components/checkout/DeliveryAddressFields.tsx");
  assert.match(address, /className=\"sr-only\"/);
  assert.doesNotMatch(address, /text-body font-medium text-slate-700/);
  const shopLoading = read("app/checkout/shop/loading.tsx");
  assert.match(shopLoading, /ShopSoftSpinner/);
  assert.match(shopLoading, /data-page=\"shop-checkout\"/);

  const flowers = read("components/checkout/FlowerPosScanRedirect.tsx");
  assert.doesNotMatch(flowers, /checkout\/shop/);
  assert.doesNotMatch(flowers, /startCatalogCardcomPayment/);

  const success = read("components/payment/PaymentVerificationClient.tsx");
  const completedAt = success.indexOf('status.state === "completed"');
  const clearAt = success.indexOf("clearCatalogCartForPaymentStatus({");
  const confirmationAt = success.indexOf('status.state === "confirmation_required"');
  assert.ok(completedAt >= 0 && clearAt > completedAt);
  assert.ok(confirmationAt > clearAt);
  assert.doesNotMatch(success, /reconciliation/i);
  assert.match(success, /payment\.verify\.confirmationTitle/);
  assert.match(success, /payment\.verify\.catalogFailedTitle/);

  const statusServer = read("lib/cardcomPaymentStatusServer.ts");
  assert.match(statusServer, /attempt\.channel === \"catalog\"/);
  assert.match(statusServer, /confirmation_required/);
  assert.doesNotMatch(statusServer, /finalizeCatalog/);

  for (const rel of [
    "components/shop/ShopCheckout.tsx",
    "components/shop/ShopPaymentReturnNotice.tsx",
    "components/payment/PaymentVerificationClient.tsx",
    "app/checkout/shop/page.tsx",
    "lib/messages.ts",
  ]) {
    assert.doesNotMatch(read(rel), /reconciliation/i, rel);
  }

  const prep = read("lib/catalogPaymentPrep.ts");
  assert.match(prep, /failedRedirectUrl: absoluteAppUrl\(origin, `\/shop\?/);
  assert.match(prep, /retryCatalogCardcomPayment/);
  assert.doesNotMatch(read("lib/startCardcomPaymentPrep.ts"), /startCatalogCardcomPayment/);

  console.log("verify-catalog-checkout-ui: wiring ok");
}

function assertDecisions(): void {
  const shown = [line({ unitPrice: 40, quantity: 2 })];
  const same = [line({ unitPrice: 40, quantity: 2 })];
  const repriced = [line({ unitPrice: 55, quantity: 2 })];
  assert.equal(catalogCheckoutLinesMatch(shown, same), true);
  assert.equal(catalogCheckoutLinesMatch(shown, repriced), false);

  const withColor = [line({ potColorId: "color-1", unitPrice: 55 })];
  assert.equal(catalogCheckoutPaymentLines(withColor)?.[0]?.unitPrice, 55);
  assert.equal(catalogCheckoutPaymentLines(withColor)?.[0]?.potColorId, "color-1");
  assert.equal(catalogCheckoutPaymentLines([line({ unitPrice: 0 })]), null);

  assert.deepEqual(catalogCheckoutPaymentFailure("cart_changed"), {
    notice: "cart_changed",
    refreshCart: true,
    reviewRequired: true,
  });
  assert.deepEqual(catalogCheckoutPaymentFailure("insufficient_stock"), {
    notice: "insufficient_stock",
    refreshCart: true,
    reviewRequired: false,
  });
  assert.equal(catalogCheckoutPaymentFailure("server_error").notice, null);

  const guard = { busy: false };
  assert.equal(claimCatalogCheckoutSubmit(guard), true);
  assert.equal(claimCatalogCheckoutSubmit(guard), false);
  releaseCatalogCheckoutSubmit(guard);
  assert.equal(claimCatalogCheckoutSubmit(guard), true);

  const attemptId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    shouldClearCatalogCartOnStatus({
      state: "completed",
      urlAttemptId: attemptId,
      snapshotAttemptId: attemptId,
    }),
    true,
  );
  for (const state of ["pending", "cancelled", "confirmation_required", "not_found"]) {
    assert.equal(
      shouldClearCatalogCartOnStatus({
        state,
        urlAttemptId: attemptId,
        snapshotAttemptId: attemptId,
      }),
      false,
      state,
    );
  }
  assert.equal(
    shouldClearCatalogCartOnStatus({
      state: "completed",
      urlAttemptId: attemptId,
      snapshotAttemptId: "22222222-2222-4222-8222-222222222222",
    }),
    false,
  );

  const item = {
    plantId: "plant-1",
    plantSizeId: "size-1",
    sellableVariantId: "sv-1",
    offerId: "offer-1",
    potColorId: null as string | null,
    quantity: 3,
  };
  const other = {
    plantId: "plant-2",
    plantSizeId: "size-2",
    sellableVariantId: "sv-2",
    offerId: "offer-2",
    potColorId: "color-2",
    quantity: 1,
  };
  const cart = { v: 2 as const, items: [item, other] };
  const purchased = subtractPurchasedCatalogItems(cart, [{ ...item, quantity: 2 }]);
  assert.deepEqual(purchased.items, [{ ...item, quantity: 1 }, other]);
  assert.equal(
    subtractPurchasedCatalogItems(cart, [item, other]),
    EMPTY_CATALOG_CART,
  );

  assert.equal(mapPaymentAttemptToClientState("catalog", "needs_reconciliation"), "confirmation_required");
  assert.equal(mapPaymentAttemptToClientState("partner", "needs_reconciliation"), "cancelled");
  assert.equal(mapPaymentAttemptToClientState(undefined, "needs_reconciliation"), "cancelled");
  assert.equal(mapPaymentAttemptToClientState("catalog", "finalized"), "completed");
  assert.equal(mapPaymentAttemptToClientState("catalog", "awaiting_payment"), "pending");
  assert.equal(mapPaymentAttemptToClientState("catalog", "failed"), "cancelled");
  assert.equal(mapPaymentAttemptToClientState("catalog", "expired"), "cancelled");

  const resume = "a".repeat(64);
  assert.equal(
    paymentVerificationRedirectPath(
      { state: "cancelled", channel: "catalog" },
      { orderId: attemptId, resumeToken: resume },
    ),
    null,
  );
  assert.equal(
    paymentVerificationRedirectPath(
      { state: "cancelled", spotSlug: "demo-spot" },
      { orderId: attemptId, resumeToken: resume },
    ),
    `/checkout/pos/demo-spot?paymentFailed=1&orderId=${attemptId}&resume=${resume}`,
  );
  assert.equal(
    paymentVerificationRedirectPath(
      { state: "confirmation_required" },
      { orderId: attemptId, resumeToken: resume },
    ),
    null,
  );

  console.log("verify-catalog-checkout-ui: decisions ok");
}

function main(): void {
  assertWiring();
  assertDecisions();
  console.log("verify-catalog-checkout-ui: ok");
}

main();

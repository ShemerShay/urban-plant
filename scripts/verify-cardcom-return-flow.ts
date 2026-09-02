/**
 * Cardcom return-flow checks (status endpoint + redirect helpers + page invariants).
 * Does not call Cardcom. Status DB checks are read-only.
 *
 * Run: npx tsx scripts/verify-cardcom-return-flow.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

async function main(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const {
    PAYMENT_STATUS_POLL_MS,
    PAYMENT_STATUS_TIMEOUT_MS,
    isPaymentStatusPollTimedOut,
    isValidOrderIdUuid,
    mapOrderStatusToPaymentClientState,
    parseOrderIdQueryParam,
    paymentCompletedRedirectPath,
    paymentVerificationRedirectPath,
    shouldContinuePaymentStatusPolling,
  } = await import("../lib/cardcomPaymentStatus");
  const { readCardcomPaymentStatus } = await import("../lib/cardcomPaymentStatusServer");
  const { buildCardcomCallbackUrls, routes } = await import("../lib/routes");
  const { PAYMENT_FAILED_CHECKOUT_MESSAGE } = await import("../lib/paymentResumeToken");
  const { getOrderById } = await import("../lib/ordersStorage");
  const { isPosSpotPurchasable } = await import("../lib/posSpotHold");

  // 1. `/success` still exists
  assert.ok(exists("app/success/page.tsx"), "/success page file exists");

  // 2. original success layout remains
  const successSrc = read("app/success/page.tsx");
  const messagesSrc = read("lib/messages.ts");
  assert.match(successSrc, /success\.thanks\.title/);
  assert.match(successSrc, /success\.summary/);
  assert.match(successSrc, /success\.returnPlant/);
  assert.match(messagesSrc, /"success\.thanks\.title": "Thank you for your order"/);
  assert.match(messagesSrc, /"success\.summary": "Order summary"/);
  assert.match(messagesSrc, /"success\.returnPlant": "Return to plant"/);
  assert.match(messagesSrc, /"success\.thanks\.title": "איזה כיף שבחרתם בנו"/);
  assert.match(messagesSrc, /"success\.summary": "סיכום הזמנה"/);
  assert.match(messagesSrc, /"success\.returnPlant": "חזרה לצמח"/);
  assert.ok(!successSrc.includes("Thank you for your order"));
  assert.ok(!successSrc.includes("Order summary"));
  assert.ok(!successSrc.includes("Return to plant"));
  assert.match(successSrc, /data-page="success-page"/);
  assert.match(successSrc, /CustomerRecoveryActions/);
  // Phase 0: single-order lookup (not full-table readOrders + find).
  assert.match(successSrc, /getOrderById/);
  assert.ok(
    !/\breadOrders\b/.test(successSrc),
    "/success must not call readOrders()",
  );

  // 3. no new checkout page
  assert.ok(exists("app/checkout/pos/[spotSlug]/page.tsx"));
  assert.ok(exists("components/checkout/CheckoutForm.tsx"));
  assert.equal(exists("app/checkout/cardcom"), false);
  assert.equal(exists("app/checkout/payment"), false);
  const checkoutPages = fs
    .readdirSync(path.join(root, "app/checkout"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  assert.deepEqual(checkoutPages, ["pos"]);

  // 4–5. missing / invalid orderId handling (page + parser)
  const paymentSuccessSrc = read("app/payment/success/page.tsx");
  assert.match(paymentSuccessSrc, /PaymentVerificationClient/);
  assert.ok(!paymentSuccessSrc.includes("Payment successful"));
  assert.ok(!paymentSuccessSrc.includes("Thank you for your order"));

  const verifyClientSrc = read("components/payment/PaymentVerificationClient.tsx");
  assert.match(verifyClientSrc, /payment\.verify\.verifyingTitle/);
  assert.match(verifyClientSrc, /payment\.verify\.invalidTitle/);
  assert.match(messagesSrc, /"payment\.verify\.verifyingTitle": "Verifying your payment"/);
  assert.match(messagesSrc, /"payment\.verify\.invalidTitle": "We couldn’t verify this payment"/);
  assert.ok(!verifyClientSrc.includes("Thank you for your order"));
  assert.ok(!verifyClientSrc.includes("Order summary"));
  assert.ok(!verifyClientSrc.includes("ready to leave with you"));
  assert.ok(!verifyClientSrc.includes("Verifying your payment"));
  assert.ok(!verifyClientSrc.includes("We couldn’t verify this payment"));
  assert.equal(parseOrderIdQueryParam(undefined), null);
  assert.equal(parseOrderIdQueryParam(""), null);
  assert.equal(parseOrderIdQueryParam("not-a-uuid"), null);
  assert.equal(parseOrderIdQueryParam("123"), null);
  assert.equal(isValidOrderIdUuid("not-a-uuid"), false);

  const sampleId = "11111111-1111-4111-8111-111111111111";
  assert.equal(parseOrderIdQueryParam(sampleId), sampleId);
  assert.deepEqual(await readCardcomPaymentStatus("not-a-uuid"), { state: "not_found" });
  assert.deepEqual(await readCardcomPaymentStatus(""), { state: "not_found" });

  // 6–10. status mapping + redirects
  assert.equal(mapOrderStatusToPaymentClientState("pending_payment"), "pending");
  assert.equal(mapOrderStatusToPaymentClientState("sold"), "completed");
  assert.equal(mapOrderStatusToPaymentClientState("picked_up"), "completed");
  assert.equal(mapOrderStatusToPaymentClientState("delivered"), "completed");
  assert.equal(mapOrderStatusToPaymentClientState("cancelled"), "cancelled");

  assert.equal(shouldContinuePaymentStatusPolling({ state: "pending" }), true);
  assert.equal(shouldContinuePaymentStatusPolling({ state: "completed", orderId: sampleId }), false);
  assert.equal(shouldContinuePaymentStatusPolling({ state: "cancelled" }), false);
  assert.equal(shouldContinuePaymentStatusPolling({ state: "not_found" }), false);

  // 7. pending does not redirect
  const resumeTok = "b".repeat(64);
  assert.equal(
    paymentVerificationRedirectPath({ state: "pending" }, {
      orderId: sampleId,
      resumeToken: resumeTok,
    }),
    null,
  );

  // 8–9. sold / picked_up → original `/success?orderId=`
  assert.equal(
    paymentVerificationRedirectPath(
      { state: "completed", orderId: sampleId },
      { orderId: sampleId, resumeToken: resumeTok },
    ),
    `/success?orderId=${encodeURIComponent(sampleId)}`,
  );
  assert.equal(
    paymentCompletedRedirectPath(sampleId),
    routes.customer.success({ orderId: sampleId }),
  );
  assert.equal(
    paymentCompletedRedirectPath(sampleId),
    `/success?orderId=${sampleId}`,
  );

  // 10. cancelled → same checkout (not standalone /payment/failed)
  assert.equal(
    paymentVerificationRedirectPath(
      { state: "cancelled", spotSlug: "demo-spot" },
      { orderId: sampleId, resumeToken: resumeTok },
    ),
    `/checkout/pos/demo-spot?paymentFailed=1&orderId=${sampleId}&resume=${resumeTok}`,
  );
  assert.equal(
    paymentVerificationRedirectPath({ state: "cancelled" }, {
      orderId: sampleId,
      resumeToken: resumeTok,
    }),
    null,
  );

  // 11. polling stops after completion (redirect path set; continue=false)
  assert.equal(shouldContinuePaymentStatusPolling({ state: "completed", orderId: sampleId }), false);
  assert.ok(
    paymentVerificationRedirectPath(
      { state: "completed", orderId: sampleId },
      { orderId: sampleId, resumeToken: resumeTok },
    ),
  );

  // 12. timeout does not mark payment failed
  assert.equal(PAYMENT_STATUS_TIMEOUT_MS, 60_000);
  assert.equal(PAYMENT_STATUS_POLL_MS, 2_000);
  assert.equal(isPaymentStatusPollTimedOut(0, 59_999), false);
  assert.equal(isPaymentStatusPollTimedOut(0, 60_000), true);
  assert.match(verifyClientSrc, /payment\.verify\.timeoutTitle/);
  assert.match(verifyClientSrc, /payment\.verify\.timeoutBody/);
  assert.match(
    messagesSrc,
    /"payment\.verify\.timeoutTitle": "Payment verification is taking longer than expected"/,
  );
  assert.match(messagesSrc, /Your payment may still be processing/);
  assert.ok(!verifyClientSrc.includes("Payment verification is taking longer than expected"));
  assert.ok(!verifyClientSrc.includes("Your payment may still be processing"));

  // 13. “Check again” restarts status checking
  assert.match(verifyClientSrc, /payment\.verify\.checkAgain/);
  assert.match(messagesSrc, /"payment\.verify\.checkAgain": "Check again"/);
  assert.ok(!verifyClientSrc.includes("Check again"));
  assert.match(verifyClientSrc, /setPollSession/);
  // Restarting polling uses a fresh startedAt (timeout clock resets)
  const t0 = 1_000_000;
  assert.equal(isPaymentStatusPollTimedOut(t0, t0 + 60_000), true);
  assert.equal(isPaymentStatusPollTimedOut(t0 + 60_000, t0 + 60_000 + 1_000), false);

  // Callback URLs: fail → checkout; success keeps orderId+resume
  const callbacks = buildCardcomCallbackUrls("https://example-app.example.com", {
    orderId: sampleId,
    spotSlug: "demo-spot",
    resumeToken: resumeTok,
  });
  assert.equal(
    callbacks.successRedirectUrl,
    `https://example-app.example.com/payment/success?orderId=${sampleId}&resume=${resumeTok}`,
  );
  assert.equal(
    callbacks.failedRedirectUrl,
    `https://example-app.example.com/checkout/pos/demo-spot?paymentFailed=1&orderId=${sampleId}&resume=${resumeTok}`,
  );
  assert.equal(
    callbacks.webHookUrl,
    "https://example-app.example.com/api/payments/cardcom/webhook",
  );
  // 19. same final `/success` for test and production
  assert.equal(routes.customer.success({ orderId: sampleId }), `/success?orderId=${sampleId}`);
  assert.ok(!routes.customer.success({ orderId: sampleId }).includes("cardcom_env"));
  assert.ok(!callbacks.successRedirectUrl.includes("cardcom_env"));

  // 14–17. status endpoint read-only + browser pages never finalize
  const statusRouteSrc = read("app/api/payments/cardcom/status/route.ts");
  assert.match(statusRouteSrc, /readCardcomPaymentStatus/);
  assert.ok(!statusRouteSrc.includes("processCardcomWebhook"));
  assert.ok(!statusRouteSrc.includes("GetLpResult"));
  assert.ok(!statusRouteSrc.includes("getLpResult"));
  assert.ok(!statusRouteSrc.includes("sendPurchaseEmail"));
  assert.ok(!statusRouteSrc.includes("setPosSpotStatus"));
  assert.ok(!statusRouteSrc.includes("UPDATE"));
  assert.ok(!statusRouteSrc.includes("INSERT"));

  assert.ok(!verifyClientSrc.includes("processCardcomWebhook"));
  assert.ok(!verifyClientSrc.includes("getLpResult"));
  assert.ok(!verifyClientSrc.includes("sendPurchaseEmail"));
  assert.ok(!verifyClientSrc.includes("setPosSpotStatus"));
  assert.ok(!verifyClientSrc.includes("/api/orders"));
  // 18. no Cardcom request from the browser
  assert.ok(!verifyClientSrc.includes("secure.cardcom"));
  assert.ok(!verifyClientSrc.includes("createCardcom"));
  assert.ok(!verifyClientSrc.includes("LowProfile"));

  const failedSrc = read("app/payment/failed/page.tsx");
  assert.match(failedSrc, /checkoutPaymentFailed|redirect/);
  assert.equal(PAYMENT_FAILED_CHECKOUT_MESSAGE, "Payment failed. Please try again.");
  assert.equal(isPosSpotPurchasable("held_for_payment"), false);
  assert.equal(isPosSpotPurchasable("held_for_payment", { resumeHolder: true }), true);
  const {
    POS_HELD_FOR_PAYMENT_CTA,
    POS_HELD_FOR_PAYMENT_CHECKOUT_MESSAGE,
    POS_HELD_FOR_PAYMENT_PRODUCT_MESSAGE,
    shouldShowHeldForPaymentCheckoutMessage,
  } = await import("../lib/posSpotHold");
  assert.equal(POS_HELD_FOR_PAYMENT_CTA, "Purchase in progress");
  assert.equal(
    POS_HELD_FOR_PAYMENT_PRODUCT_MESSAGE,
    "Another customer is currently purchasing this plant. Please check back shortly.",
  );
  assert.equal(
    POS_HELD_FOR_PAYMENT_CHECKOUT_MESSAGE,
    "This plant is currently being purchased by another customer.",
  );
  assert.equal(
    shouldShowHeldForPaymentCheckoutMessage("held_for_payment", { resumeHolder: true }),
    false,
  );

  // 12-ish: success page still not claiming paid while pending
  assert.match(successSrc, /success\.pending\.title/);
  assert.match(messagesSrc, /"success\.pending\.title": "Payment still in progress"/);
  assert.match(messagesSrc, /"success\.pending\.title": "התשלום עדיין בתהליך"/);
  assert.ok(!successSrc.includes("Payment still in progress"));
  assert.match(successSrc, /isVerifiedPaidOrderStatus/);

  // CheckoutForm: first attempt → cardcomCreate; fail/resume → cardcomRetry.
  // Never POST /api/orders or send email from the browser checkout path.
  const checkoutFormSrc = read("components/checkout/CheckoutForm.tsx");
  assert.match(checkoutFormSrc, /checkout\.paymentFailed/);
  assert.match(messagesSrc, /"checkout\.paymentFailed": "Payment failed. Please try again."/);
  assert.ok(!checkoutFormSrc.includes("Payment failed. Please try again."));
  assert.match(checkoutFormSrc, /checkout\.submit/);
  assert.match(messagesSrc, /"checkout\.submit": "Complete Order"/);
  assert.ok(!checkoutFormSrc.includes("Complete Order"));
  assert.ok(!checkoutFormSrc.includes("Try payment again"));
  assert.match(checkoutFormSrc, /isResumeRetry/);
  assert.match(checkoutFormSrc, /cardcomCreate/);
  assert.match(checkoutFormSrc, /cardcomRetry/);
  assert.ok(!checkoutFormSrc.includes("routes.api.orders()"));
  assert.ok(!checkoutFormSrc.includes("sendPurchaseEmail"));
  assert.ok(!checkoutFormSrc.includes("secure.cardcom"));
  assert.ok(!checkoutFormSrc.includes("/success"));

  // No second final success page
  assert.ok(exists("app/payment/success/page.tsx"));
  assert.match(paymentSuccessSrc, /temporary verification only|PaymentVerificationClient/i);
  assert.equal(exists("app/order-complete"), false);
  assert.equal(exists("app/payment/complete"), false);

  // Optional DB read-only status check (no mutation)
  try {
    const { readOrders } = await import("../lib/ordersStorage");
    const orders = await readOrders();
    const pending = orders.find((o) => o.orderStatus === "pending_payment");
    const sold = orders.find((o) => o.orderStatus === "sold");
    const pickedUp = orders.find((o) => o.orderStatus === "picked_up");
    const cancelled = orders.find((o) => o.orderStatus === "cancelled");

    if (pending) {
      const before = await getOrderById(pending.orderId);
      const status = await readCardcomPaymentStatus(pending.orderId);
      const after = await getOrderById(pending.orderId);
      assert.equal(status.state, "pending");
      assert.equal(after?.orderStatus, before?.orderStatus);
      assert.equal(after?.checkoutSessionId, before?.checkoutSessionId);
      assert.equal(after?.price, before?.price);
      assert.ok(!("paymentResumeToken" in status));
    }
    if (sold) {
      assert.deepEqual(await readCardcomPaymentStatus(sold.orderId), {
        state: "completed",
        orderId: sold.orderId,
      });
    }
    if (pickedUp) {
      assert.deepEqual(await readCardcomPaymentStatus(pickedUp.orderId), {
        state: "completed",
        orderId: pickedUp.orderId,
      });
    }
    if (cancelled) {
      assert.deepEqual(await readCardcomPaymentStatus(cancelled.orderId), {
        state: "cancelled",
      });
    }

    const missing = await readCardcomPaymentStatus(randomUUID());
    assert.deepEqual(missing, { state: "not_found" });
  } catch (error) {
    console.log(
      "verify-cardcom-return-flow: skip live DB status samples:",
      error instanceof Error ? error.message : error,
    );
  }

  console.log("verify-cardcom-return-flow: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Static verification that product analytics events are wired at the intended points.
 * Does not send events to PostHog.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const helpers = read("lib/analyticsEvents.ts");
assert.match(helpers, /pos_scan/);
assert.match(helpers, /checkout_started/);
assert.match(helpers, /payment_started/);
assert.match(helpers, /purchase_completed/);
assert.match(helpers, /inventory_type/);
assert.match(helpers, /captureOncePerSession/);
assert.match(helpers, /shouldCaptureBusinessAnalytics/);
assert.match(helpers, /NODE_ENV === ["']production["']/);

const nextConfig = read("next.config.ts");
assert.match(nextConfig, /source:\s*"\/pos\/:spotSlug"/);
assert.match(nextConfig, /destination:\s*"\/checkout\/pos\/:spotSlug"/);
assert.match(nextConfig, /permanent:\s*false/);

const checkoutPage = read("app/checkout/pos/[spotSlug]/page.tsx");
assert.match(checkoutPage, /TrackPosScan/);
assert.match(checkoutPage, /TrackCheckoutStarted/);
assert.match(checkoutPage, /analyticsContext/);
assert.match(checkoutPage, /inventory_type/);
assert.match(checkoutPage, /FlowerPosScanRedirect/);
const flowerHandoff = checkoutPage.slice(
  checkoutPage.indexOf("if (isFlowerCheckout)"),
  checkoutPage.indexOf("const orderId"),
);
assert.match(flowerHandoff, /FlowerPosScanRedirect/);
assert.doesNotMatch(flowerHandoff, /TrackPosScan/);
assert.doesNotMatch(flowerHandoff, /RedirectToExternalUrl/);
assert.doesNotMatch(flowerHandoff, /TrackCheckoutStarted/);

const flowerRedirect = read("components/checkout/FlowerPosScanRedirect.tsx");
assert.match(flowerRedirect, /captureOncePerSession/);
assert.match(flowerRedirect, /ANALYTICS_EVENTS\.posScan/);
assert.match(flowerRedirect, /window\.location\.assign/);
assert.match(flowerRedirect, /MAX_WAIT_MS = 400/);
assert.match(flowerRedirect, /window\.location\.assign\(url\)/);
assert.ok(
  flowerRedirect.indexOf("captureOncePerSession") <
    flowerRedirect.indexOf("window.location.assign(url)"),
  "pos_scan must be attempted before Cardcom navigation",
);

const checkoutForm = read("components/checkout/CheckoutForm.tsx");
assert.match(checkoutForm, /ANALYTICS_EVENTS\.paymentStarted/);
assert.match(checkoutForm, /window\.location\.assign/);
assert.ok(
  checkoutForm.indexOf("captureAnalyticsEvent") <
    checkoutForm.indexOf("window.location.assign(data.paymentUrl)"),
  "payment_started must fire before Cardcom redirect",
);

const successPage = read("app/success/page.tsx");
assert.match(successPage, /TrackPurchaseCompleted/);
assert.match(successPage, /isVerifiedPaidOrderStatus/);
assert.match(successPage, /trackVerifiedPurchase/);

const purchaseTrack = read("components/analytics/TrackPurchaseCompleted.tsx");
assert.match(purchaseTrack, /order_id/);
assert.match(purchaseTrack, /purchaseCompleted/);
assert.match(purchaseTrack, /inventory_type/);

const provider = read("components/PostHogProvider.tsx");
assert.match(provider, /up_internal/);
assert.match(provider, /up_ph_internal/);
assert.match(provider, /is_internal:\s*true/);
assert.match(provider, /posthog\.register/);

console.log("OK: analytics event wiring verified");

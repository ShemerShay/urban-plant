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
assert.match(helpers, /captureOncePerSession/);
assert.match(helpers, /shouldCaptureBusinessAnalytics/);
assert.match(helpers, /NODE_ENV === ["']production["']/);

const posPage = read("app/pos/[spotSlug]/page.tsx");
assert.match(posPage, /TrackPosScan/);
assert.match(posPage, /getPosLandingDetails/);
assert.match(posPage, /pocket_name/);

const checkoutPage = read("app/checkout/pos/[spotSlug]/page.tsx");
assert.match(checkoutPage, /TrackCheckoutStarted/);
assert.match(checkoutPage, /analyticsContext/);

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

console.log("OK: analytics event wiring verified");

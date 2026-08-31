/**
 * Minimal PostHog product analytics helpers (client-side).
 * Session dedupe avoids React remount / refresh inflation within one tab session.
 */

export const ANALYTICS_EVENTS = {
  posScan: "pos_scan",
  checkoutStarted: "checkout_started",
  paymentStarted: "payment_started",
  purchaseCompleted: "purchase_completed",
} as const;

/** Shared commerce context attached to funnel events when available. */
export type AnalyticsCommerceProps = {
  pos_spot_id?: string;
  spot_slug?: string;
  plant_id?: string;
  plant_name?: string;
  inventory_type?: string;
  offer_id?: string;
  partner_id?: string;
  partner_name?: string;
  pocket_id?: string;
  pocket_name?: string;
  amount?: number;
  fulfillment_method?: string;
  attempt_id?: string;
  order_id?: string;
};

export type AnalyticsCaptureClient = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
};

/**
 * Custom business events (`pos_scan`, etc.) only in production builds.
 * Local `next dev` has NODE_ENV=development — those events are skipped.
 * `$pageview` is unaffected (handled separately by PostHogPageView).
 */
export function shouldCaptureBusinessAnalytics(): boolean {
  return process.env.NODE_ENV === "production";
}

function sessionKey(event: string, id: string): string {
  return `up_ph:${event}:${id}`;
}

/** Drop empty/undefined values so PostHog only gets trustworthy fields. */
export function cleanAnalyticsProps(
  props: AnalyticsCommerceProps,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

function isPostHogReady(
  posthog: AnalyticsCaptureClient | null | undefined,
): posthog is AnalyticsCaptureClient {
  if (!posthog) return false;
  // posthog-js no-ops capture() until init sets __loaded.
  if (
    "__loaded" in posthog &&
    (posthog as AnalyticsCaptureClient & { __loaded?: boolean }).__loaded === false
  ) {
    return false;
  }
  return true;
}

/**
 * Capture once per browser tab session for a stable id (e.g. spot id or order id).
 * Returns true if the event was sent (or attempted).
 */
export function captureOncePerSession(
  posthog: AnalyticsCaptureClient | null | undefined,
  event: string,
  dedupeId: string,
  props: AnalyticsCommerceProps,
): boolean {
  if (!shouldCaptureBusinessAnalytics()) return false;
  if (!dedupeId) return false;
  // Do not burn the session dedupe key if PostHog is not ready yet.
  if (!isPostHogReady(posthog)) return false;
  const key = sessionKey(event, dedupeId);
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(key)) {
      return false;
    }
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(key, "1");
    }
  } catch {
    // sessionStorage unavailable — still capture; caller should also guard with a ref if needed.
  }
  posthog.capture(event, cleanAnalyticsProps(props));
  return true;
}

/** Capture without session dedupe (e.g. each successful payment start). */
export function captureAnalyticsEvent(
  posthog: AnalyticsCaptureClient | null | undefined,
  event: string,
  props: AnalyticsCommerceProps,
): void {
  if (!shouldCaptureBusinessAnalytics()) return;
  if (!isPostHogReady(posthog)) return;
  posthog.capture(event, cleanAnalyticsProps(props));
}

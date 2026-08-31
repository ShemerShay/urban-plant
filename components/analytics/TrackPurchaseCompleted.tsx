"use client";

import { useEffect, useRef } from "react";
import { usePostHog } from "posthog-js/react";

import {
  ANALYTICS_EVENTS,
  captureOncePerSession,
  type AnalyticsCommerceProps,
} from "@/lib/analyticsEvents";

type TrackPurchaseCompletedProps = AnalyticsCommerceProps & {
  /** Must be a verified paid Neon order id — never fire without this. */
  order_id: string;
};

/**
 * Fires `purchase_completed` once per tab session per order when the success
 * page has confirmed a verified paid order exists in Neon.
 */
export function TrackPurchaseCompleted({
  order_id,
  pos_spot_id,
  spot_slug,
  plant_id,
  plant_name,
  inventory_type,
  offer_id,
  partner_id,
  partner_name,
  amount,
  fulfillment_method,
}: TrackPurchaseCompletedProps) {
  const posthog = usePostHog();
  const firedRef = useRef(false);
  const orderId = order_id.trim();

  useEffect(() => {
    if (!orderId || firedRef.current) return;
    const sent = captureOncePerSession(
      posthog,
      ANALYTICS_EVENTS.purchaseCompleted,
      orderId,
      {
        order_id: orderId,
        pos_spot_id,
        spot_slug,
        plant_id,
        plant_name,
        inventory_type,
        offer_id,
        partner_id,
        partner_name,
        amount,
        fulfillment_method,
      },
    );
    if (sent) firedRef.current = true;
  }, [
    posthog,
    orderId,
    pos_spot_id,
    spot_slug,
    plant_id,
    plant_name,
    inventory_type,
    offer_id,
    partner_id,
    partner_name,
    amount,
    fulfillment_method,
  ]);

  return null;
}

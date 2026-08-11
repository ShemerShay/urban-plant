"use client";

import { useEffect, useRef } from "react";
import { usePostHog } from "posthog-js/react";

import {
  ANALYTICS_EVENTS,
  captureOncePerSession,
  type AnalyticsCommerceProps,
} from "@/lib/analyticsEvents";

/** Fires `checkout_started` once per tab session per POS spot when checkout mounts. */
export function TrackCheckoutStarted({
  pos_spot_id,
  spot_slug,
  plant_id,
  plant_name,
  offer_id,
  partner_id,
  partner_name,
  pocket_id,
  pocket_name,
  amount,
}: AnalyticsCommerceProps) {
  const posthog = usePostHog();
  const firedRef = useRef(false);
  const posSpotId = pos_spot_id?.trim() ?? "";

  useEffect(() => {
    if (!posSpotId || firedRef.current) return;
    const sent = captureOncePerSession(
      posthog,
      ANALYTICS_EVENTS.checkoutStarted,
      posSpotId,
      {
        pos_spot_id: posSpotId,
        spot_slug,
        plant_id,
        plant_name,
        offer_id,
        partner_id,
        partner_name,
        pocket_id,
        pocket_name,
        amount,
      },
    );
    if (sent) firedRef.current = true;
  }, [
    posthog,
    posSpotId,
    spot_slug,
    plant_id,
    plant_name,
    offer_id,
    partner_id,
    partner_name,
    pocket_id,
    pocket_name,
    amount,
  ]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import { usePostHog } from "posthog-js/react";

import {
  ANALYTICS_EVENTS,
  captureOncePerSession,
  type AnalyticsCommerceProps,
} from "@/lib/analyticsEvents";

/** Fires `pos_scan` once per tab session per POS spot when the QR/POS plant page mounts. */
export function TrackPosScan({
  pos_spot_id,
  spot_slug,
  plant_id,
  plant_name,
  inventory_type,
  offer_id,
  partner_id,
  partner_name,
  pocket_id,
  pocket_name,
}: AnalyticsCommerceProps) {
  const posthog = usePostHog();
  const firedRef = useRef(false);
  const posSpotId = pos_spot_id?.trim() ?? "";

  useEffect(() => {
    if (!posSpotId || firedRef.current) return;
    const sent = captureOncePerSession(posthog, ANALYTICS_EVENTS.posScan, posSpotId, {
      pos_spot_id: posSpotId,
      spot_slug,
      plant_id,
      plant_name,
      inventory_type,
      offer_id,
      partner_id,
      partner_name,
      pocket_id,
      pocket_name,
    });
    if (sent) firedRef.current = true;
  }, [
    posthog,
    posSpotId,
    spot_slug,
    plant_id,
    plant_name,
    inventory_type,
    offer_id,
    partner_id,
    partner_name,
    pocket_id,
    pocket_name,
  ]);

  return null;
}

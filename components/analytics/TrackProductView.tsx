"use client";

import { useEffect, useRef } from "react";
import { usePostHog } from "posthog-js/react";

import {
  ANALYTICS_EVENTS,
  captureOncePerSession,
  type AnalyticsCommerceProps,
} from "@/lib/analyticsEvents";

/** Fires `product_view` once per tab session per plant when the Catalog detail page mounts. */
export function TrackProductView({
  plant_id,
  plant_name,
  inventory_type,
  channel = "catalog",
}: AnalyticsCommerceProps) {
  const posthog = usePostHog();
  const firedRef = useRef(false);
  const plantId = plant_id?.trim() ?? "";

  useEffect(() => {
    if (!plantId || firedRef.current) return;
    const sent = captureOncePerSession(posthog, ANALYTICS_EVENTS.productView, plantId, {
      plant_id: plantId,
      plant_name,
      inventory_type,
      channel,
    });
    if (sent) firedRef.current = true;
  }, [posthog, plantId, plant_name, inventory_type, channel]);

  return null;
}

"use client";

import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";

import {
  ANALYTICS_EVENTS,
  captureOncePerSession,
  type AnalyticsCommerceProps,
} from "@/lib/analyticsEvents";

/** Hard cap so analytics cannot block Cardcom. Easy to change or remove. */
const MAX_WAIT_MS = 400;
const POLL_MS = 50;

function isPostHogClientReady(
  posthog: { capture?: unknown; __loaded?: boolean } | null | undefined,
): boolean {
  if (!posthog) return false;
  if (posthog.__loaded === false) return false;
  return true;
}

/**
 * Flower-only Cardcom handoff: wait briefly for PostHog, capture `pos_scan`, then
 * always navigate. No UI. Plants still use TrackPosScan + checkout form.
 */
export function FlowerPosScanRedirect({
  url,
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
}: AnalyticsCommerceProps & { url: string }) {
  const posthog = usePostHog();
  const posSpotId = pos_spot_id?.trim() ?? "";

  useEffect(() => {
    let finished = false;
    let pollId = 0;
    let hardId = 0;

    const go = () => {
      if (finished) return;
      finished = true;
      window.clearInterval(pollId);
      window.clearTimeout(hardId);
      try {
        captureOncePerSession(
          posthog,
          ANALYTICS_EVENTS.posScan,
          posSpotId,
          {
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
          },
          { send_instantly: true, transport: "sendBeacon" },
        );
      } catch {
        // Analytics must never block payment.
      }
      window.location.assign(url);
    };

    hardId = window.setTimeout(go, MAX_WAIT_MS);

    if (isPostHogClientReady(posthog)) {
      go();
      return () => {
        finished = true;
        window.clearTimeout(hardId);
      };
    }

    pollId = window.setInterval(() => {
      if (isPostHogClientReady(posthog)) go();
    }, POLL_MS);

    return () => {
      finished = true;
      window.clearInterval(pollId);
      window.clearTimeout(hardId);
    };
  }, [
    posthog,
    url,
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

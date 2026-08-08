/**
 * Whether checkout can start for a POS Spot. Local availability lives on POS Spot.
 * Lazily expires abandoned held_for_payment holds (17 minutes) before checking.
 */

import { expireStalePaymentHoldBySpotSlug } from "@/lib/paymentHoldExpiry";
import { isPosSpotPurchasable } from "@/lib/posSpotHold";
import { getPosSpotBySpotSlug } from "@/lib/posSpotStorage";
import type { PosSpot } from "@/lib/posSpotTypes";

/**
 * Expire any stale hold for this slug, then return one fresh POS row + purchase gate.
 * Callers must derive CTA / messages / badges from the returned `posSpot.status`
 * (do not keep a pre-expiry snapshot).
 */
export async function getPosSpotForCustomerPurchase(
  spotSlug: string,
): Promise<{ posSpot: PosSpot; purchaseEnabled: boolean } | undefined> {
  const slug = spotSlug.trim();
  if (!slug) return undefined;

  await expireStalePaymentHoldBySpotSlug(slug);
  const posSpot = await getPosSpotBySpotSlug(slug);
  if (!posSpot) return undefined;

  return {
    posSpot,
    purchaseEnabled: isPosSpotPurchasable(posSpot.status),
  };
}

export async function canPurchasePosSpot(spotSlugOrId: string): Promise<boolean> {
  const resolved = await getPosSpotForCustomerPurchase(spotSlugOrId);
  return resolved?.purchaseEnabled ?? false;
}

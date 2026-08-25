/**
 * Whether checkout can start for a POS Spot. Local availability lives on POS Spot.
 * Lazily expires abandoned held_for_payment holds (17 minutes) before checking.
 */

import { expireStalePaymentHold } from "@/lib/paymentHoldExpiry";
import { isPosSpotPurchasable } from "@/lib/posSpotHold";
import { getPosSpotBySpotSlug } from "@/lib/posSpotStorage";
import type { PosSpot } from "@/lib/posSpotTypes";

/**
 * Return one POS row + purchase gate. Hold expiry runs when the loaded row is
 * `held_for_payment`. Available POS still run expiry so flower attempts can
 * expire without a hold (POS status is not updated).
 * Callers must derive CTA / messages / badges from the returned `posSpot.status`.
 */
export async function getPosSpotForCustomerPurchase(
  spotSlug: string,
): Promise<{ posSpot: PosSpot; purchaseEnabled: boolean } | undefined> {
  const slug = spotSlug.trim();
  if (!slug) return undefined;

  let posSpot = await getPosSpotBySpotSlug(slug);
  if (!posSpot) return undefined;

  if (posSpot.status === "held_for_payment" || posSpot.status === "available") {
    const expiry = await expireStalePaymentHold(posSpot.id);
    // `not_stale` means the CTE did not UPDATE pos_spots. Other results may have
    // changed status (released, sold, or concurrent release) — re-read then.
    const holdUnchanged = !expiry.expired && expiry.reason === "not_stale";
    if (posSpot.status === "held_for_payment" && !holdUnchanged) {
      posSpot = (await getPosSpotBySpotSlug(slug)) ?? posSpot;
    }
  }

  return {
    posSpot,
    purchaseEnabled: isPosSpotPurchasable(posSpot.status),
  };
}

export async function canPurchasePosSpot(spotSlugOrId: string): Promise<boolean> {
  const resolved = await getPosSpotForCustomerPurchase(spotSlugOrId);
  return resolved?.purchaseEnabled ?? false;
}

/**
 * Whether checkout can start for a POS Spot. Local availability lives on POS Spot.
 * Lazily expires abandoned held_for_payment holds (17 minutes) before checking.
 */

import { expireStalePaymentHoldBySpotSlug } from "@/lib/paymentHoldExpiry";
import { isPosSpotPurchasable } from "@/lib/posSpotHold";
import { getPosSpotBySpotSlug } from "@/lib/posSpotStorage";

export async function canPurchasePosSpot(spotSlugOrId: string): Promise<boolean> {
  await expireStalePaymentHoldBySpotSlug(spotSlugOrId);
  const posSpot = await getPosSpotBySpotSlug(spotSlugOrId);
  return posSpot ? isPosSpotPurchasable(posSpot.status) : false;
}

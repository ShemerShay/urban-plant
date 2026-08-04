/**
 * Whether checkout can start for a POS Spot. Local availability lives on POS Spot.
 */

import { isPosSpotPurchasable } from "@/lib/posSpotHold";
import { getPosSpotBySpotSlug } from "@/lib/posSpotStorage";

export async function canPurchasePosSpot(spotSlugOrId: string): Promise<boolean> {
  const posSpot = await getPosSpotBySpotSlug(spotSlugOrId);
  return posSpot ? isPosSpotPurchasable(posSpot.status) : false;
}

/**
 * Whether checkout can start for a POS Spot. Local availability lives on POS Spot.
 */

import { findLegacyPosSpot, getPosSpotBySpotSlug } from "@/lib/posSpotStorage";

export async function canPurchasePlantAtLocation(
  plantId: string,
  locationId: string | null | undefined,
): Promise<boolean> {
  if (!locationId?.trim()) return true;
  const match = await findLegacyPosSpot(plantId, locationId);
  return match ? match.posSpot.status === "available" : true;
}

export async function canPurchasePosSpot(spotSlugOrId: string): Promise<boolean> {
  const posSpot = await getPosSpotBySpotSlug(spotSlugOrId);
  return posSpot?.status === "available";
}

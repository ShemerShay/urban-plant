import type { InventoryType } from "./inventoryType.ts";
import type { Offer } from "./offerTypes.ts";
import type { PosSpot } from "./posSpotTypes.ts";

export type PartnerPlantOffer = {
  id: string;
  productId: string;
  productName: string;
  /** `null` when the offer or its catalog product can no longer be resolved. */
  inventoryType: InventoryType | null;
};

export type PartnerPlantProduct = {
  name: string;
  inventoryType: InventoryType;
};

/**
 * Plant metadata for every offer referenced by the given POS rows, independent of offer status.
 * Unresolvable offers/products get `inventoryType: null` so they are never counted as plants.
 */
export function resolveSpotOffers(
  spots: PosSpot[],
  offers: Pick<Offer, "id" | "productId">[],
  productById: Map<string, PartnerPlantProduct>,
): PartnerPlantOffer[] {
  const offerById = new Map(offers.map((offer) => [offer.id, offer]));
  const resolved = new Map<string, PartnerPlantOffer>();
  for (const spot of spots) {
    const offerId = spot.currentOfferId;
    if (!offerId || resolved.has(offerId)) continue;
    const offer = offerById.get(offerId);
    const product = offer ? productById.get(offer.productId) : undefined;
    resolved.set(offerId, {
      id: offerId,
      productId: offer?.productId ?? "",
      productName: product?.name ?? offer?.productId ?? offerId,
      inventoryType: product?.inventoryType ?? null,
    });
  }
  return Array.from(resolved.values());
}

export type PartnerPlantGroup = {
  id: string;
  name: string;
  spots: PosSpot[];
};

export type PlantCounts = {
  active: number;
  total: number;
};

/**
 * Partner-page counting only: `available` is active, `sold`/`inactive` are unavailable,
 * and `held_for_payment` is left out of both counts and lists.
 */
export function isCountedPlantSpot(
  spot: PosSpot,
  offer: PartnerPlantOffer | undefined,
): boolean {
  if (offer?.inventoryType !== "plants") return false;
  if (!spot.currentOfferId) return false;
  return spot.status === "available" || spot.status === "sold" || spot.status === "inactive";
}

export function countPlantSpots(spots: PosSpot[]): PlantCounts {
  let active = 0;
  for (const spot of spots) {
    if (spot.status === "available") active += 1;
  }
  return { active, total: spots.length };
}

export function groupPlantSpotsByType(
  spots: PosSpot[],
  offerById: Map<string, PartnerPlantOffer>,
): PartnerPlantGroup[] {
  const byProduct = new Map<string, PartnerPlantGroup>();
  for (const spot of spots) {
    if (!spot.currentOfferId) continue;
    const offer = offerById.get(spot.currentOfferId);
    if (!offer) continue;
    const existing = byProduct.get(offer.productId);
    if (existing) existing.spots.push(spot);
    else {
      byProduct.set(offer.productId, {
        id: offer.productId,
        name: offer.productName,
        spots: [spot],
      });
    }
  }
  return Array.from(byProduct.values()).sort((a, b) => a.name.localeCompare(b.name));
}

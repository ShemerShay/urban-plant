import type { PlantProduct } from "@/lib/types";

export type OfferStatus = "active" | "inactive";

/** Admin-only placeholder for manual orders — never assign to a POS spot / QR. */
export const MANUAL_OFFER_ID = "manual-offer";
export const MANUAL_PRODUCT_ID = "manual";

export type OfferAvailabilityScope = "catalog" | "partner_location";

export interface OfferAvailability {
  scope: OfferAvailabilityScope;
  partnerLocationId: string | null;
}

/** Read model for a plant Offer’s Sellable Variant. Supplier cost is not included. */
export interface OfferSellableVariant {
  sellableVariantId: string;
  plantName: string;
  plantSizeLabel: string;
  potName: string | null;
  potSizeLabel: string | null;
}

export interface Offer {
  id: string;
  productId: string;
  /** Legacy Plant Size. Null on new plant Offers; still read by POS until Slice 6. */
  variantId?: string | null;
  /** Plant Offers point at one Sellable Variant. Flowers and legacy rows stay null. */
  sellableVariantId: string | null;
  sellableVariant: OfferSellableVariant | null;
  availabilities: OfferAvailability[];
  consumerPrice: number;
  status: OfferStatus;
  createdAt: string;
}

/** True when an offer can back a customer-facing POS plant page. */
export function isPosAssignableOffer(
  offer: Pick<Offer, "id" | "productId" | "status">,
): boolean {
  if (offer.id === MANUAL_OFFER_ID || offer.productId === MANUAL_PRODUCT_ID) {
    return false;
  }
  return offer.status === "active";
}

/** Offer row enriched with catalog plant fields (images, currency). */
export type OfferWithProduct = Offer & {
  productName: string;
  currency: PlantProduct["currency"];
  plantImages: string[];
  plantSubtitle: string;
};

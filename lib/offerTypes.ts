import type { PlantProduct } from "@/lib/types";

export type OfferStatus = "active" | "inactive";

/** Admin-only placeholder for manual orders — never assign to a POS spot / QR. */
export const MANUAL_OFFER_ID = "manual-offer";
export const MANUAL_PRODUCT_ID = "manual";

export interface Offer {
  id: string;
  productId: string;
  consumerPrice: number;
  supplierPrice?: number;
  supplierName?: string;
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

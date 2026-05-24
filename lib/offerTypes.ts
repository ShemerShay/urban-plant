import type { PlantProduct } from "@/lib/types";

export type OfferStatus = "active" | "inactive";

export interface Offer {
  id: string;
  productId: string;
  consumerPrice: number;
  supplierPrice?: number;
  supplierName?: string;
  status: OfferStatus;
  createdAt: string;
}

/** Offer row enriched with catalog plant fields (images, currency). */
export type OfferWithProduct = Offer & {
  productName: string;
  currency: PlantProduct["currency"];
  plantImages: string[];
  plantSubtitle: string;
};

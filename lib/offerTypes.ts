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

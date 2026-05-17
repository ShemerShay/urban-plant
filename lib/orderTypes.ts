import type { OrderStatus } from "./status";

export type FulfillmentMethod = "delivery" | "pickup";

export interface OrderSnapshot {
  productId: string;
  productName: string;
  productFamily?: string;
  productImage?: string;
  productDescription: string;
  offerId: string;
  consumerPrice: number;
  supplierPrice?: number;
  supplierName?: string;
  partnerLocationId?: string;
  partnerLocationName?: string;
  posSpotId?: string;
  posSpotDescription?: string;
  spotSlug?: string;
  fulfillmentType: FulfillmentMethod;
  care: {
    light?: string;
    wateringDays?: string;
    averageSize?: "small" | "medium" | "large";
    maintenanceConditions?: string;
    careInstructions?: string[];
  };
}

/** Persisted order shape for prototype JSON storage */
export interface SavedOrder {
  id?: string;
  orderId: string;
  checkoutSessionId?: string;
  posSpotId?: string;
  offerId?: string;
  plantId: string;
  plantName: string;
  /** QR partner slug; null when checkout had no ?location= */
  locationId: string | null;
  /** Resolved partner display name; null if unknown or missing */
  locationName: string | null;
  /** Resolved partner address; null if unknown or missing */
  locationAddress: string | null;
  /** Monetary amount (same as catalog line price for catalog plants). */
  price: number;
  fullName: string;
  /** Customer email from checkout (optional for legacy persisted rows). */
  customerEmail?: string;
  phone: string;
  address: string;
  apartmentOrNotes: string;
  fulfillmentMethod: FulfillmentMethod;
  createdAt: string;
  /** Fulfillment tracking for completed orders. */
  orderStatus: OrderStatus;
  source?: "online" | "manual" | "admin";
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  snapshot?: OrderSnapshot;
  deliveredAt?: string;
  pickedUpAt?: string;
}

import type { OrderStatus } from "./status";

export type FulfillmentMethod = "delivery" | "pickup";

/** Which Cardcom terminal/credentials created checkout_session_id. */
export type OrderCardcomEnv = "test" | "production";

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
}

/** Persisted order shape for prototype JSON storage */
export interface SavedOrder {
  id?: string;
  orderId: string;
  checkoutSessionId?: string;
  /** Which Cardcom terminal/credentials created checkout_session_id. */
  cardcomEnv?: OrderCardcomEnv;
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
  /** Order lifecycle status (includes pending_payment before verified Cardcom payment). */
  orderStatus: OrderStatus;
  source?: "online" | "manual" | "admin";
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  snapshot?: OrderSnapshot;
  deliveredAt?: string;
  pickedUpAt?: string;
}

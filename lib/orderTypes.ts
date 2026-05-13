import type { OrderStatus } from "./status";

export type FulfillmentMethod = "delivery" | "pickup";

/** Persisted order shape for prototype JSON storage */
export interface SavedOrder {
  orderId: string;
  plantId: string;
  plantName: string;
  /** QR partner slug; null when checkout had no ?location= */
  locationId: string | null;
  /** Resolved partner display name; null if unknown or missing */
  locationName: string | null;
  /** Resolved partner address; null if unknown or missing */
  locationAddress: string | null;
  price: number;
  fullName: string;
  phone: string;
  address: string;
  apartmentOrNotes: string;
  fulfillmentMethod: FulfillmentMethod;
  createdAt: string;
  /** Fulfillment tracking; `available` = released back to shelf. */
  orderStatus: OrderStatus;
  deliveredAt?: string;
  pickedUpAt?: string;
}

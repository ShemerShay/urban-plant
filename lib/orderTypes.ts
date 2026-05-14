import type { OrderStatus } from "./status";

export type FulfillmentMethod = "delivery" | "pickup";

/** CardCom / checkout payment lifecycle (separate from operational `orderStatus`). */
export type PaymentStatus = "pending_payment" | "paid" | "payment_failed";

export function parsePaymentStatus(value: unknown): PaymentStatus | undefined {
  if (value === "pending_payment" || value === "paid" || value === "payment_failed") {
    return value;
  }
  return undefined;
}

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
  /** Fulfillment tracking; `available` = released back to shelf. */
  orderStatus: OrderStatus;
  /** Payment gateway lifecycle; omitted on legacy rows (treated as completed). */
  paymentStatus?: PaymentStatus;
  lowProfileId?: string;
  cardcomTransactionId?: string;
  deliveredAt?: string;
  pickedUpAt?: string;
}

import type { OrderStatus } from "./status";

export type FulfillmentMethod = "delivery" | "pickup";

/** Which Cardcom terminal/credentials created checkout_session_id. */
export type OrderCardcomEnv = "test" | "production";

/** Post-payment Urban Plant confirmation email lifecycle. */
export type PurchaseEmailStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  /** Plant order without a customer email: document created, customer email intentionally not sent. */
  | "skipped";

export interface OrderSnapshot {
  productId: string;
  productName: string;
  productFamily?: string;
  productImage?: string;
  productDescription?: string;
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
  /** Frozen at Partner payment prep so later analytics do not read the live plant. */
  inventoryType?: "plants" | "flowers";
  /** Plant size id on the POS at payment prep. Omitted when the spot has none. */
  plantVariantId?: string;
  /** Plant size label copied at payment prep. */
  sizeLabel?: string;
  /**
   * Plant supplier cost copied at Partner payment prep.
   * Flowers use the same snapshot. Catalog cost stays on order lines.
   */
  supplierUnitCost?: number;
  supplierUnitCostSource?: "plants.supplier_price@sale";
}

export function saleTimeSnapshotFields(
  source: Record<string, unknown>,
): Pick<OrderSnapshot, "inventoryType" | "plantVariantId" | "sizeLabel"> {
  const inventoryType =
    source.inventoryType === "plants" || source.inventoryType === "flowers"
      ? source.inventoryType
      : undefined;
  const plantVariantId =
    typeof source.plantVariantId === "string" && source.plantVariantId.trim()
      ? source.plantVariantId.trim()
      : undefined;
  const sizeLabel =
    typeof source.sizeLabel === "string" && source.sizeLabel.trim()
      ? source.sizeLabel.trim()
      : undefined;
  return {
    ...(inventoryType ? { inventoryType } : {}),
    ...(plantVariantId ? { plantVariantId } : {}),
    ...(sizeLabel ? { sizeLabel } : {}),
  };
}

/** Persisted order shape for prototype JSON storage */
export interface SavedOrder {
  id?: string;
  orderId: string;
  checkoutSessionId?: string;
  /** Which Cardcom terminal/credentials created checkout_session_id. */
  cardcomEnv?: OrderCardcomEnv;
  /**
   * Unguessable token proving the browser started this pending payment.
   * Only placed in Cardcom redirect URLs — never expose via public status APIs.
   */
  paymentResumeToken?: string;
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
  /** Sales channel. Distinct from `source`, which is how the row was created. */
  channel?: "partner" | "catalog";
  /** Top-level Partner for Partner sales; null for Catalog. */
  partnerId?: string | null;
  /**
   * Assigned Partner-plant commission for this order's calendar month.
   * Flowers and Catalog are null. 0 is an explicit 0% deal.
   */
  commissionRate?: number | null;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  snapshot?: OrderSnapshot;
  deliveredAt?: string;
  pickedUpAt?: string;
  /** Cardcom TranzactionInfo.TranzactionId from verified GetLpResult. */
  cardcomTransactionId?: number;
  /** Resolved CreateDocument DocumentType (never "Auto"). */
  cardcomDocumentType?: string;
  cardcomDocumentNumber?: number;
  purchaseEmailStatus?: PurchaseEmailStatus;
  purchaseEmailSentAt?: string;
  purchaseEmailLastError?: string;
}

import type { CatalogPaymentSnapshot } from "./catalogCheckoutSnapshot";
import type { FulfillmentMethod, OrderCardcomEnv, OrderSnapshot } from "./orderTypes";

/**
 * Payment attempt lifecycle (Option B). Distinct from OrderStatus / PosSpotStatus.
 * Phase 2: schema/types only — not used by checkout/Cardcom yet.
 */
export type PaymentAttemptStatus =
  | "created"
  | "awaiting_payment"
  | "finalized"
  | "expired"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";

const PAYMENT_ATTEMPT_STATUS_SET = new Set<PaymentAttemptStatus>([
  "created",
  "awaiting_payment",
  "finalized",
  "expired",
  "failed",
  "cancelled",
  "needs_reconciliation",
]);

export function isPaymentAttemptStatus(value: unknown): value is PaymentAttemptStatus {
  return (
    typeof value === "string" &&
    PAYMENT_ATTEMPT_STATUS_SET.has(value as PaymentAttemptStatus)
  );
}

export function parsePaymentAttemptStatus(value: unknown): PaymentAttemptStatus | null {
  return isPaymentAttemptStatus(value) ? value : null;
}

/** Partner attempts are POS checkout. Catalog attempts have no POS spot. */
export type PaymentAttemptChannel = "partner" | "catalog";

export function isPaymentAttemptChannel(value: unknown): value is PaymentAttemptChannel {
  return value === "partner" || value === "catalog";
}

/** Persisted payment attempt shape (pre-Order Cardcom correlation). */
export interface SavedPaymentAttempt {
  id: string;
  status: PaymentAttemptStatus;
  /** Required for partner attempts. Null for catalog attempts. */
  posSpotId: string | null;
  /**
   * Omitted on write means partner, so existing POS inserts stay partner checkout.
   * Reads always include the stored channel.
   */
  channel?: PaymentAttemptChannel;
  /** Catalog line snapshot, including supplier cost captured at attempt creation. */
  catalogSnapshot?: CatalogPaymentSnapshot;
  offerId?: string;
  productId: string;
  productName: string;
  fullName: string;
  customerEmail: string;
  phone: string;
  address: string;
  apartmentOrNotes: string;
  fulfillmentMethod: FulfillmentMethod;
  amount: number;
  snapshot?: OrderSnapshot;
  checkoutSessionId?: string;
  cardcomEnv?: OrderCardcomEnv;
  paymentResumeToken: string;
  paymentRetryLockAt?: string;
  expiresAt?: string;
  failureReason?: string;
  finalizedOrderId?: string;
  cardcomTransactionId?: number;
  /** Staff browser. Omitted on write means false. */
  isInternal?: boolean;
  createdAt: string;
  updatedAt: string;
}

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

/** Persisted payment attempt shape (pre-Order Cardcom correlation). */
export interface SavedPaymentAttempt {
  id: string;
  status: PaymentAttemptStatus;
  posSpotId: string;
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
  createdAt: string;
  updatedAt: string;
}

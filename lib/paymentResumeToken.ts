/**
 * Client-safe payment resume token helpers (no Node crypto).
 * Token creation / constant-time compare live in `lib/paymentResume.ts` (server-only).
 */

/** True when value looks like a 64-char hex resume token. */
export function isPaymentResumeTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value.trim());
}

/** Inline checkout copy after Cardcom fail/cancel return. */
export const PAYMENT_FAILED_CHECKOUT_MESSAGE = "Payment failed. Please try again.";

/**
 * Payment resume token: proves the browser is the customer who started Cardcom payment.
 * Stored on the pending order; placed only in Cardcom redirect URLs (not status API).
 */

import { randomBytes, timingSafeEqual } from "crypto";

/** Create an unguessable resume token (hex). */
export function createPaymentResumeToken(): string {
  return randomBytes(32).toString("hex");
}

export function isPaymentResumeTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value.trim());
}

/** Constant-time compare for resume tokens. */
export function paymentResumeTokensEqual(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right || left.length !== right.length) return false;
  try {
    return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
  } catch {
    return false;
  }
}

/** Inline checkout copy after Cardcom fail/cancel return. */
export const PAYMENT_FAILED_CHECKOUT_MESSAGE = "התשלום נכשל. אפשר לנסות שוב.";

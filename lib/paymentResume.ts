/**
 * Payment resume token: proves the browser is the customer who started Cardcom payment.
 * Stored on the pending order; placed only in Cardcom redirect URLs (not status API).
 * Shape check / checkout copy: `lib/paymentResumeToken.ts` (client-safe).
 */

import "server-only";

import { randomBytes, timingSafeEqual } from "crypto";

/** Create an unguessable resume token (hex). */
export function createPaymentResumeToken(): string {
  return randomBytes(32).toString("hex");
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

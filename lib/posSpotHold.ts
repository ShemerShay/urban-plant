/**
 * POS purchase-hold gates and customer copy.
 * Hold begins only when starting external payment (wired later) — not on browse/checkout open.
 */

import type { PosSpotStatus } from "./posSpotTypes";

/** Customer-facing CTA when status is held_for_payment. */
export const POS_HELD_FOR_PAYMENT_CTA = "Purchase in progress";

/** Customer-facing disabled CTA when status is sold. */
export const POS_SOLD_CTA = "Already found a home";

/** Shown under the product-page CTA only when status === held_for_payment. */
export const POS_HELD_FOR_PAYMENT_PRODUCT_MESSAGE =
  "Another customer is currently purchasing this plant. Please check back shortly.";

/** Shown above the checkout CTA only when status === held_for_payment. */
export const POS_HELD_FOR_PAYMENT_CHECKOUT_MESSAGE =
  "This plant is currently being purchased by another customer.";

/** Only `available` may begin a purchase / payment attempt.
 * Resume holders (matching payment_resume_token) may continue while held_for_payment.
 */
export function isPosSpotPurchasable(
  status: PosSpotStatus,
  options?: { resumeHolder?: boolean },
): boolean {
  if (options?.resumeHolder && status === "held_for_payment") return true;
  return status === "available";
}

export function shouldShowHeldForPaymentProductMessage(status: PosSpotStatus): boolean {
  return status === "held_for_payment";
}

export function shouldShowHeldForPaymentCheckoutMessage(
  status: PosSpotStatus,
  options?: { resumeHolder?: boolean },
): boolean {
  if (options?.resumeHolder) return false;
  return status === "held_for_payment";
}

export function productPageCtaText(
  status: PosSpotStatus,
  availableCtaText: string,
): string {
  if (status === "held_for_payment") return POS_HELD_FOR_PAYMENT_CTA;
  if (status === "sold") return POS_SOLD_CTA;
  return availableCtaText;
}

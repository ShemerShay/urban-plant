/**
 * POS purchase-hold gates and customer copy.
 * Hold begins only when starting external payment (wired later) — not on browse/checkout open.
 */

import type { PosSpotStatus } from "./posSpotTypes";

/** Customer-facing CTA when status is held_for_payment. */
export const POS_HELD_FOR_PAYMENT_CTA = "בתהליך רכישה";

/** Shown under the product-page CTA only when status === held_for_payment. */
export const POS_HELD_FOR_PAYMENT_PRODUCT_MESSAGE =
  "לקוח אחר נמצא כרגע בתהליך התשלום. אם הרכישה לא תושלם, הצמח יחזור להיות זמין בעוד כמה דקות.";

/** Shown above the checkout CTA only when status === held_for_payment. */
export const POS_HELD_FOR_PAYMENT_CHECKOUT_MESSAGE =
  "לקוח אחר נמצא כרגע בתהליך התשלום עבור הצמח הזה.";

/** Only `available` may begin a purchase / payment attempt. */
export function isPosSpotPurchasable(status: PosSpotStatus): boolean {
  return status === "available";
}

export function shouldShowHeldForPaymentProductMessage(status: PosSpotStatus): boolean {
  return status === "held_for_payment";
}

export function shouldShowHeldForPaymentCheckoutMessage(status: PosSpotStatus): boolean {
  return status === "held_for_payment";
}

export function productPageCtaText(
  status: PosSpotStatus,
  availableCtaText: string,
): string {
  if (status === "held_for_payment") return POS_HELD_FOR_PAYMENT_CTA;
  return availableCtaText;
}

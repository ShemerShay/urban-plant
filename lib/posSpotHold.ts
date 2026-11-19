/**
 * POS purchase gates.
 * Partner plant checkout does not reserve the spot. A spot is purchasable while available.
 * Admin may still set held_for_payment; a resume holder may continue in that state.
 */

import type { InventoryType } from "./inventoryType";
import type { PosSpotStatus } from "./posSpotTypes";

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

/** Whether webhook/retry/finalize may proceed. Plants and flowers both require available. */
export function posAllowsVerifiedPaymentFinalize(
  inventoryType: InventoryType,
  pos: { status: PosSpotStatus; paymentHoldAttemptId?: string },
  _paymentAttemptId: string,
): boolean {
  if (inventoryType === "flowers" || inventoryType === "plants") {
    return pos.status === "available";
  }
  return false;
}

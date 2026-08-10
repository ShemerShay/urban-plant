/**
 * Server-only Cardcom payment status read (attempt or legacy order lookup).
 * Never finalizes payment, mutates POS, sends email, or calls Cardcom.
 */

import "server-only";

import { getPaymentAttemptById } from "@/lib/paymentAttemptStorage";
import { getOrderById } from "@/lib/ordersStorage";
import {
  mapOrderStatusToPaymentClientState,
  parseOrderIdQueryParam,
  type CardcomPaymentStatusResponse,
} from "@/lib/cardcomPaymentStatus";

function mapAttemptStatusToClientState(
  status: string,
): Exclude<CardcomPaymentStatusResponse["state"], "not_found"> | "not_found" {
  switch (status) {
    case "created":
    case "awaiting_payment":
      return "pending";
    case "finalized":
      return "completed";
    case "expired":
    case "cancelled":
    case "failed":
      return "cancelled";
    case "needs_reconciliation":
      // Never report success for unpaid reconciliation.
      return "cancelled";
    default:
      return "not_found";
  }
}

/**
 * Load attempt or order by correlation id and return a minimal safe status payload.
 * Query param remains `orderId` for URL compatibility (= attempt id for new sessions).
 * Completed responses always return the real Order id.
 * Never returns paymentResumeToken.
 */
export async function readCardcomPaymentStatus(
  orderIdRaw: unknown,
): Promise<CardcomPaymentStatusResponse> {
  const correlationId = parseOrderIdQueryParam(orderIdRaw);
  if (!correlationId) {
    return { state: "not_found" };
  }

  const attempt = await getPaymentAttemptById(correlationId);
  if (attempt) {
    const spotSlug = attempt.snapshot?.spotSlug?.trim() || undefined;
    const state = mapAttemptStatusToClientState(attempt.status);
    if (state === "completed") {
      if (!attempt.finalizedOrderId) {
        return { state: "not_found" };
      }
      return { state: "completed", orderId: attempt.finalizedOrderId };
    }
    if (state === "cancelled") {
      return spotSlug ? { state: "cancelled", spotSlug } : { state: "cancelled" };
    }
    if (state === "pending") {
      return spotSlug ? { state: "pending", spotSlug } : { state: "pending" };
    }
    return { state: "not_found" };
  }

  const order = await getOrderById(correlationId);
  if (!order) {
    return { state: "not_found" };
  }

  const spotSlug = order.snapshot?.spotSlug?.trim() || undefined;
  const state = mapOrderStatusToPaymentClientState(order.orderStatus);
  if (state === "completed") {
    return { state: "completed", orderId: order.orderId };
  }
  if (state === "cancelled") {
    return spotSlug ? { state: "cancelled", spotSlug } : { state: "cancelled" };
  }
  if (state === "pending") {
    return spotSlug ? { state: "pending", spotSlug } : { state: "pending" };
  }
  return { state };
}

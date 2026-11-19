/**
 * Server-only Cardcom payment status read (attempt or legacy order lookup).
 * Never finalizes payment, mutates POS, sends email, or calls Cardcom.
 */

import "server-only";

import { getPaymentAttemptById } from "@/lib/paymentAttemptStorage";
import { getOrderById } from "@/lib/ordersStorage";
import {
  mapOrderStatusToPaymentClientState,
  mapPaymentAttemptToClientState,
  parseOrderIdQueryParam,
  type CardcomPaymentStatusResponse,
} from "@/lib/cardcomPaymentStatus";

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
    const state = mapPaymentAttemptToClientState(attempt.channel, attempt.status);
    if (attempt.channel === "catalog") {
      if (state === "completed") {
        if (!attempt.finalizedOrderId) {
          return { state: "not_found" };
        }
        return { state: "completed", orderId: attempt.finalizedOrderId };
      }
      if (state === "confirmation_required") {
        return { state: "confirmation_required" };
      }
      if (state === "cancelled") {
        return { state: "cancelled", channel: "catalog" };
      }
      if (state === "pending") {
        return { state: "pending", channel: "catalog" };
      }
      return { state: "not_found" };
    }

    const spotSlug = attempt.snapshot?.spotSlug?.trim() || undefined;
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

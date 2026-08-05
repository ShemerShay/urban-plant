/**
 * Server-only Cardcom payment status read (order lookup).
 * Never finalizes payment, mutates POS, sends email, or calls Cardcom.
 */

import "server-only";

import { getOrderById } from "@/lib/ordersStorage";
import {
  mapOrderStatusToPaymentClientState,
  parseOrderIdQueryParam,
  type CardcomPaymentStatusResponse,
} from "@/lib/cardcomPaymentStatus";

/**
 * Load order by id and return a minimal safe status payload.
 * Read-only: no writes, no Cardcom, no email.
 * Never returns paymentResumeToken.
 */
export async function readCardcomPaymentStatus(
  orderIdRaw: unknown,
): Promise<CardcomPaymentStatusResponse> {
  const orderId = parseOrderIdQueryParam(orderIdRaw);
  if (!orderId) {
    return { state: "not_found" };
  }

  const order = await getOrderById(orderId);
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

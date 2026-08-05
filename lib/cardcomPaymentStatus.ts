/**
 * Read-only Cardcom payment status for browser return-page polling.
 * Never finalizes payment, mutates POS, sends email, or calls Cardcom.
 */

import { getOrderById } from "@/lib/ordersStorage";
import type { OrderStatus } from "@/lib/status";
import { routes } from "@/lib/routes";

/** Browser poll interval for `/payment/success`. */
export const PAYMENT_STATUS_POLL_MS = 2000;

/** Stop automatic polling after this duration (does not mark payment failed). */
export const PAYMENT_STATUS_TIMEOUT_MS = 60_000;

const ORDER_ID_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CardcomPaymentClientState =
  | "pending"
  | "completed"
  | "cancelled"
  | "not_found";

export type CardcomPaymentStatusResponse =
  | { state: "pending"; spotSlug?: string }
  | { state: "completed"; orderId: string }
  | { state: "cancelled"; spotSlug?: string }
  | { state: "not_found" };

/** Strict UUID check for browser-supplied orderId (lookup key only). */
export function isValidOrderIdUuid(value: unknown): value is string {
  return typeof value === "string" && ORDER_ID_UUID_PATTERN.test(value.trim());
}

export function parseOrderIdQueryParam(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return isValidOrderIdUuid(v) ? v : null;
}

/** Map persisted order status → safe client poll state. */
export function mapOrderStatusToPaymentClientState(
  status: OrderStatus,
): Exclude<CardcomPaymentClientState, "not_found"> {
  switch (status) {
    case "pending_payment":
      return "pending";
    case "sold":
    case "picked_up":
    case "delivered":
      return "completed";
    case "cancelled":
      return "cancelled";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

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

export function paymentCompletedRedirectPath(orderId: string): string {
  return routes.customer.success({ orderId });
}

/** Cancelled → same checkout (requires spotSlug + resume from Success URL). */
export function paymentCancelledCheckoutRedirectPath(input: {
  spotSlug: string;
  orderId: string;
  resumeToken: string;
}): string {
  return routes.customer.checkoutPaymentFailed(input);
}

/** Where `/payment/success` should navigate after a poll result. */
export function paymentVerificationRedirectPath(
  status: CardcomPaymentStatusResponse,
  known: { orderId: string | null; resumeToken: string | null },
): string | null {
  if (status.state === "completed") {
    return paymentCompletedRedirectPath(status.orderId);
  }
  if (status.state === "cancelled" && status.spotSlug && known.orderId && known.resumeToken) {
    return paymentCancelledCheckoutRedirectPath({
      spotSlug: status.spotSlug,
      orderId: known.orderId,
      resumeToken: known.resumeToken,
    });
  }
  return null;
}

export function shouldContinuePaymentStatusPolling(
  status: CardcomPaymentStatusResponse,
): boolean {
  return status.state === "pending";
}

export function isPaymentStatusPollTimedOut(
  startedAtMs: number,
  nowMs: number,
  timeoutMs: number = PAYMENT_STATUS_TIMEOUT_MS,
): boolean {
  return nowMs - startedAtMs >= timeoutMs;
}

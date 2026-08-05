/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { NextRequest, NextResponse } from "next/server";

import { randomUUID } from "crypto";

import { appendEvent } from "@/lib/eventStorage";
import {
  adminCancelPendingPaymentOrder,
  getOrderById,
  replaceOrder,
} from "@/lib/ordersStorage";
import type { SavedOrder } from "@/lib/orderTypes";
import { setPosSpotStatus } from "@/lib/posSpotStorage";
import type { OrderStatus } from "@/lib/status";
import {
  canAdminCancelOrder,
  canTransitionOrderStatus,
  isOrderStatus,
  isVerifiedPaidOrderStatus,
  parseOrderStatus,
} from "@/lib/status";

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

function nextOrderWithStatus(prev: SavedOrder, status: OrderStatus): SavedOrder {
  const now = new Date().toISOString();
  const base: SavedOrder = {
    ...prev,
    orderStatus: status,
  };
  delete base.deliveredAt;
  delete base.pickedUpAt;
  delete base.cancelledAt;
  delete base.cancelledBy;
  delete base.cancellationReason;
  if (status === "delivered") {
    base.deliveredAt = now;
  } else if (status === "picked_up") {
    base.pickedUpAt = now;
  }
  return base;
}

async function appendManualStatusEvent(prev: SavedOrder, updated: SavedOrder): Promise<void> {
  await appendEvent({
    id: randomUUID(),
    type: "manual_status_update",
    ...(updated.posSpotId ? { posSpotId: updated.posSpotId } : {}),
    ...(updated.offerId ? { offerId: updated.offerId } : {}),
    orderId: updated.orderId,
    productId: updated.plantId,
    ...(updated.locationId ? { partnerLocationId: updated.locationId } : {}),
    createdAt: new Date().toISOString(),
    createdBy: "admin",
    data: {
      previousStatus: prev.orderStatus,
      nextStatus: updated.orderStatus,
    },
  });
}

function relatedPosSpotId(order: SavedOrder): string | undefined {
  return order.posSpotId;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { orderId } = await params;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const prev = await getOrderById(orderId);
  if (!prev) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!canAdminCancelOrder(prev.orderStatus)) {
    return NextResponse.json(
      {
        error: isVerifiedPaidOrderStatus(prev.orderStatus)
          ? "Verified paid orders cannot be cancelled. Payment and POS inventory stay as-is."
          : "Only pending payment orders can be cancelled.",
      },
      { status: 409 },
    );
  }

  let cancellationReason = "Cancelled by admin";
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === "object") {
      const raw = (body as Record<string, unknown>).cancellationReason;
      if (typeof raw === "string" && raw.trim()) cancellationReason = raw.trim();
    }
  } catch {
    // DELETE with no JSON body is still a valid cancel request.
  }

  const result = await adminCancelPendingPaymentOrder({
    orderId,
    cancellationReason,
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json(
      {
        error:
          result.reason === "not_cancellable"
            ? "Order can no longer be cancelled (payment may have completed)."
            : "Could not cancel order. Try again.",
      },
      { status: 409 },
    );
  }

  const updated = result.order;
  const posSpotId = relatedPosSpotId(updated);
  await appendEvent({
    id: randomUUID(),
    type: "order_cancelled",
    ...(posSpotId ? { posSpotId } : {}),
    ...(updated.offerId ? { offerId: updated.offerId } : {}),
    orderId: updated.orderId,
    productId: updated.plantId,
    ...(updated.locationId ? { partnerLocationId: updated.locationId } : {}),
    createdAt: updated.cancelledAt ?? new Date().toISOString(),
    createdBy: "admin",
    data: {
      cancellationReason,
      releasedPos: result.releasedPos,
    },
  });

  return NextResponse.json({ ok: true, order: updated });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { orderId } = await params;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { action, orderStatus: orderStatusRaw, deliveryStatus, cancellationReason } = body as Record<
    string,
    unknown
  >;

  let requested: OrderStatus | null = parseOrderStatus(orderStatusRaw);
  if (!requested && deliveryStatus !== undefined) {
    requested = parseOrderStatus(deliveryStatus);
  }
  if (!requested && action === "markDelivered") {
    requested = "delivered";
  }

  if (!requested || !isOrderStatus(requested)) {
    return NextResponse.json(
      {
        error:
          'Invalid order status. Send orderStatus: "pending_payment" | "sold" | "picked_up" | "delivered" | "cancelled" (or legacy action: "markDelivered").',
      },
      { status: 400 },
    );
  }

  const prev = await getOrderById(orderId);
  if (!prev) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (requested === "cancelled") {
    if (!canAdminCancelOrder(prev.orderStatus)) {
      return NextResponse.json(
        {
          error: isVerifiedPaidOrderStatus(prev.orderStatus)
            ? "Verified paid orders cannot be cancelled. Payment and POS inventory stay as-is."
            : "Only pending payment orders can be cancelled.",
        },
        { status: 409 },
      );
    }
    const reason =
      typeof cancellationReason === "string" && cancellationReason.trim()
        ? cancellationReason.trim()
        : "Cancelled by admin";
    const result = await adminCancelPendingPaymentOrder({
      orderId,
      cancellationReason: reason,
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            result.reason === "not_cancellable"
              ? "Order can no longer be cancelled (payment may have completed)."
              : "Could not cancel order. Try again.",
        },
        { status: 409 },
      );
    }
    await appendManualStatusEvent(prev, result.order);
    return NextResponse.json({ ok: true, order: result.order });
  }

  if (!canTransitionOrderStatus(prev.orderStatus, requested)) {
    return NextResponse.json(
      {
        error:
          prev.orderStatus === "pending_payment"
            ? "Pending payment orders cannot be marked paid from admin. Cancel the order, or wait for payment verification."
            : `Cannot change order status from ${prev.orderStatus} to ${requested}.`,
      },
      { status: 400 },
    );
  }

  const updated = nextOrderWithStatus(prev, requested);
  await replaceOrder(updated);
  const posSpotId = relatedPosSpotId(updated);
  // Never move a verified paid order's POS back to available via status PATCH.
  if (posSpotId && (requested === "sold" || requested === "picked_up" || requested === "delivered")) {
    await setPosSpotStatus(posSpotId, "sold");
  }
  await appendManualStatusEvent(prev, updated);

  return NextResponse.json({ ok: true, order: updated });
}

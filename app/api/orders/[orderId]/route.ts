/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { NextRequest, NextResponse } from "next/server";

import { randomUUID } from "crypto";

import { appendEvent } from "@/lib/eventStorage";
import { readOrders, replaceOrder } from "@/lib/ordersStorage";
import type { SavedOrder } from "@/lib/orderTypes";
import { findLegacyPosSpot, setPosSpotStatus } from "@/lib/posSpotStorage";
import type { OrderStatus } from "@/lib/status";
import { isOrderStatus, parseOrderStatus } from "@/lib/status";

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

async function relatedPosSpotId(order: SavedOrder): Promise<string | undefined> {
  if (order.posSpotId) return order.posSpotId;
  return (await findLegacyPosSpot(order.plantId, order.locationId))?.posSpot.id;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { orderId } = await params;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const orders = await readOrders();
  const prev = orders.find((o) => o.orderId === orderId);
  if (!prev) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
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

  const cancelledAt = new Date().toISOString();
  const updated: SavedOrder = {
    ...prev,
    orderStatus: "cancelled",
    cancelledAt,
    cancelledBy: "admin",
    cancellationReason,
  };
  delete updated.deliveredAt;
  delete updated.pickedUpAt;

  await replaceOrder(updated);
  const posSpotId = await relatedPosSpotId(updated);
  if (posSpotId) await setPosSpotStatus(posSpotId, "available");
  await appendEvent({
    id: randomUUID(),
    type: "order_cancelled",
    ...(posSpotId ? { posSpotId } : {}),
    ...(updated.offerId ? { offerId: updated.offerId } : {}),
    orderId: updated.orderId,
    productId: updated.plantId,
    ...(updated.locationId ? { partnerLocationId: updated.locationId } : {}),
    createdAt: cancelledAt,
    createdBy: "admin",
    data: {
      cancellationReason,
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
          'Invalid order status. Send orderStatus: "sold" | "picked_up" | "delivered" | "cancelled" (or legacy action: "markDelivered").',
      },
      { status: 400 },
    );
  }

  const orders = await readOrders();
  const prev = orders.find((o) => o.orderId === orderId);
  if (!prev) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const updated = nextOrderWithStatus(prev, requested);
  if (requested === "cancelled") {
    updated.cancelledAt = new Date().toISOString();
    updated.cancelledBy = "admin";
    updated.cancellationReason =
      typeof cancellationReason === "string" && cancellationReason.trim()
        ? cancellationReason.trim()
        : "Cancelled by admin";
  }
  await replaceOrder(updated);
  const posSpotId = await relatedPosSpotId(updated);
  if (posSpotId) await setPosSpotStatus(posSpotId, requested === "cancelled" ? "available" : "sold");
  await appendManualStatusEvent(prev, updated);

  return NextResponse.json({ ok: true, order: updated });
}

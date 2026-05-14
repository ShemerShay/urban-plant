/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { NextRequest, NextResponse } from "next/server";

import { markInventoryAvailable, markInventorySold } from "@/lib/inventoryStorage";
import { deleteOrderById, readOrders, replaceOrder } from "@/lib/ordersStorage";
import type { SavedOrder } from "@/lib/orderTypes";
import type { OrderStatus } from "@/lib/status";
import { isOrderStatus, parseOrderStatus } from "@/lib/status";

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

async function syncShelfToOrderStatus(
  plantId: string,
  locationId: string | null,
  status: OrderStatus,
): Promise<void> {
  if (status === "pending_payment") return;
  if (status === "available") {
    await markInventoryAvailable(plantId, locationId);
    return;
  }
  // `sold`, `picked_up`, and `delivered` all keep the physical unit off the shelf.
  await markInventorySold(plantId, locationId);
}

function nextOrderWithStatus(prev: SavedOrder, status: OrderStatus): SavedOrder {
  const now = new Date().toISOString();
  const base: SavedOrder = {
    ...prev,
    orderStatus: status,
  };
  delete base.deliveredAt;
  delete base.pickedUpAt;
  if (status === "delivered") {
    base.deliveredAt = now;
  } else if (status === "picked_up") {
    base.pickedUpAt = now;
  }
  return base;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { orderId } = await params;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const orders = await readOrders();
  const prev = orders.find((o) => o.orderId === orderId);
  if (!prev) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  await deleteOrderById(orderId);
  if (prev.orderStatus !== "pending_payment") {
    await markInventoryAvailable(prev.plantId, prev.locationId);
  }

  return NextResponse.json({ ok: true });
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

  const { action, orderStatus: orderStatusRaw, deliveryStatus } = body as Record<
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
          'Invalid order status. Send orderStatus: "pending_payment" | "available" | "sold" | "picked_up" | "delivered" (or legacy action: "markDelivered").',
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
  await replaceOrder(updated);
  await syncShelfToOrderStatus(updated.plantId, updated.locationId, requested);

  return NextResponse.json({ ok: true, order: updated });
}

/** Full status union (catalog / POS spot + fulfillment). */
export type PlantStatus = "available" | "sold" | "picked_up" | "delivered" | "cancelled";

export const PLANT_STATUS_LABELS: Record<PlantStatus, string> = {
  available: "Available",
  sold: "Sold",
  picked_up: "Sold & Taken",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/**
 * Order lifecycle including unpaid checkout rows awaiting Cardcom verification.
 * pending_payment is not a completed sale.
 */
export type OrderStatus =
  | "pending_payment"
  | "sold"
  | "picked_up"
  | "delivered"
  | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Pending payment",
  sold: "Sold",
  picked_up: "Sold & Taken",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Local POS spot availability. */
export type InventoryStatus = "available" | "sold" | "inactive" | "held_for_payment";

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  available: "Available",
  sold: "Sold",
  inactive: "Inactive",
  /** Customer-facing hold copy (never show the raw enum to customers). */
  held_for_payment: "בתהליך רכישה",
};

/** Admin / English label for held_for_payment. */
export const POS_HELD_FOR_PAYMENT_ADMIN_LABEL = "Held for payment";

const ORDER_SET = new Set<OrderStatus>([
  "pending_payment",
  "sold",
  "picked_up",
  "delivered",
  "cancelled",
]);

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && ORDER_SET.has(value as OrderStatus);
}

export function parseOrderStatus(value: unknown): OrderStatus | null {
  return isOrderStatus(value) ? value : null;
}

/** Verified paid fulfillment statuses (not pending_payment / cancelled). */
export function isVerifiedPaidOrderStatus(status: OrderStatus): boolean {
  return status === "sold" || status === "picked_up" || status === "delivered";
}

/**
 * Allowed admin/API transitions. Cardcom webhook will use pending → sold|picked_up later.
 * Admin must not mark pending_payment as paid (sold/picked_up/delivered).
 */
export function canTransitionOrderStatus(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  if (from === to) return true;
  if (to === "cancelled") {
    return from !== "cancelled";
  }
  if (from === "pending_payment") {
    // Paid transitions are reserved for verified payment finalization (not admin).
    return false;
  }
  if (from === "cancelled") {
    return false;
  }
  if (to === "pending_payment") {
    return false;
  }
  if (to === "delivered") {
    return from === "sold" || from === "picked_up" || from === "delivered";
  }
  if (to === "sold" || to === "picked_up") {
    return from === "sold" || from === "picked_up" || from === "delivered";
  }
  return false;
}

/** Future webhook finalization helper (not wired yet). */
export function canFinalizePendingPayment(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  if (from !== "pending_payment") return false;
  return to === "sold" || to === "picked_up" || to === "cancelled";
}

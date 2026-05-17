/** Full status union (catalog / POS spot + fulfillment). */
export type PlantStatus = "available" | "sold" | "picked_up" | "delivered" | "cancelled";

export const PLANT_STATUS_LABELS: Record<PlantStatus, string> = {
  available: "Available",
  sold: "Sold",
  picked_up: "Sold & Taken",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Completed order lifecycle. Checkout/payment-pending state does not live on Order. */
export type OrderStatus = "sold" | "picked_up" | "delivered" | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  sold: "Sold",
  picked_up: "Sold & Taken",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Local POS spot availability. */
export type InventoryStatus = "available" | "sold" | "inactive";

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  available: "Available",
  sold: "Sold",
  inactive: "Inactive",
};

const ORDER_SET = new Set<OrderStatus>([
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

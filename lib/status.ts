/** Full status union (shelf + fulfillment). */
export type PlantStatus = "available" | "sold" | "picked_up" | "delivered";

export const PLANT_STATUS_LABELS: Record<PlantStatus, string> = {
  available: "Available",
  sold: "Sold",
  picked_up: "Sold & Taken",
  delivered: "Delivered",
};

/**
 * Order lifecycle. `available` means the unit was released back to the shelf
 * (plant is buyable again at that location when inventory allows).
 */
export type OrderStatus = "available" | "sold" | "picked_up" | "delivered";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  available: "Available — on shelf again",
  sold: "Sold",
  picked_up: "Sold & Taken",
  delivered: "Delivered",
};

/** Plant unit at a partner location (on-prem shelf vs sold from shelf). */
export type InventoryStatus = "available" | "sold";

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  available: "Available",
  sold: "Sold",
};

const ORDER_SET = new Set<OrderStatus>(["available", "sold", "picked_up", "delivered"]);

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && ORDER_SET.has(value as OrderStatus);
}

export function parseOrderStatus(value: unknown): OrderStatus | null {
  return isOrderStatus(value) ? value : null;
}

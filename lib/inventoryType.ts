/**
 * Catalog inventory type: organizes Admin and whether a paid sale consumes the POS.
 * `plants` → POS becomes sold. `flowers` → POS returns to available.
 */

export const INVENTORY_TYPES = ["plants", "flowers"] as const;
export type InventoryType = (typeof INVENTORY_TYPES)[number];

export const DEFAULT_INVENTORY_TYPE: InventoryType = "plants";

export function isInventoryType(value: unknown): value is InventoryType {
  return value === "plants" || value === "flowers";
}

export function parseInventoryType(value: unknown): InventoryType | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isInventoryType(trimmed) ? trimmed : null;
}

export function inventoryTypeOrDefault(value: unknown): InventoryType {
  return parseInventoryType(value) ?? DEFAULT_INVENTORY_TYPE;
}

/** SQL-equivalent: flowers → available, anything else → sold. */
export function posStatusAfterSuccessfulPayment(
  inventoryType: InventoryType,
): "sold" | "available" {
  return inventoryType === "flowers" ? "available" : "sold";
}

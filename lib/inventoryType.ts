/**
 * Catalog inventory type: Admin grouping and POS payment lock policy.
 *
 * plants → unique unit; acquire held_for_payment; successful payment sets POS sold.
 * flowers → reusable POS; no hold; POS status is not updated by payment.
 */

export const INVENTORY_TYPES = ["plants", "flowers"] as const;
export type InventoryType = (typeof INVENTORY_TYPES)[number];

export const DEFAULT_INVENTORY_TYPE: InventoryType = "plants";

/** Cardcom LowProfile line item for flower charges (internal catalog name is not sent). */
export const CARDCOM_FLOWER_LINE_ITEM_NAME = "פרחים";

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

export function posRequiresPaymentHold(inventoryType: InventoryType): boolean {
  return inventoryType !== "flowers";
}

/**
 * Canonical in-memory rule after verified payment.
 * Plants → sold. Flowers → do not change POS (returns null).
 */
export function posStatusAfterSuccessfulPayment(
  inventoryType: InventoryType,
): "sold" | null {
  return inventoryType === "flowers" ? null : "sold";
}

export function cardcomLineItemName(
  inventoryType: InventoryType,
  internalProductName: string,
): string {
  if (inventoryType === "flowers") return CARDCOM_FLOWER_LINE_ITEM_NAME;
  return internalProductName;
}

/**
 * Operator intent for whether a physical unit leaves Back Office stock.
 * Request-only. Not stored.
 */

export const INVENTORY_SOURCES = ["central", "already_at_partner"] as const;

export type InventorySource = (typeof INVENTORY_SOURCES)[number];

export function parseInventorySource(value: unknown): InventorySource | null {
  if (value === "central" || value === "already_at_partner") return value;
  return null;
}

export function occupancyActionNeedsInventorySource(
  action: string,
  introducesNewPotColor = false,
): boolean {
  return action === "place" || action === "replace" || (action === "update" && introducesNewPotColor);
}

/**
 * Client-side: show the source choice for Place, physical Replace, or an Update
 * that introduces a new physical Pot Color.
 */
export function adminSaveNeedsInventorySource(input: {
  selectedIsPlant: boolean;
  creating: boolean;
  occupiedVariantId: string;
  selectedVariantId: string;
  sameVariantReplace: boolean;
  existingOfferIsFlower: boolean;
  introducesNewPotColor: boolean;
}): boolean {
  if (!input.selectedIsPlant) return false;
  if (input.existingOfferIsFlower && !input.creating) return false;
  if (input.creating) return true;
  const occupied = input.occupiedVariantId.trim();
  const selected = input.selectedVariantId.trim();
  if (!occupied) return true;
  if (selected && selected !== occupied) return true;
  if (input.sameVariantReplace) return true;
  if (input.introducesNewPotColor) return true;
  return false;
}

/**
 * Occupying Color stays selectable on Update even at 0 central stock.
 * Central stock > 0 is required only for a newly introduced Color.
 */
export function selectablePosPotColors<T extends { id: string; quantity: number }>(
  colors: T[],
  input: { inventorySource: InventorySource | ""; occupiedColorId: string },
): T[] {
  const occupied = input.occupiedColorId.trim();
  if (input.inventorySource === "central") {
    return colors.filter((color) => color.quantity > 0 || color.id === occupied);
  }
  return colors;
}

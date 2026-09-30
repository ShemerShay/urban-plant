/**
 * Operator intent for whether a physical plant unit leaves Back Office stock.
 * Request-only. Not stored. Ignored unless the occupancy action is Place or Replace.
 */

export const INVENTORY_SOURCES = ["central", "already_at_partner"] as const;

export type InventorySource = (typeof INVENTORY_SOURCES)[number];

export function parseInventorySource(value: unknown): InventorySource | null {
  if (value === "central" || value === "already_at_partner") return value;
  return null;
}

export function occupancyActionNeedsInventorySource(action: string): boolean {
  return action === "place" || action === "replace";
}

/**
 * Client-side: show the source choice only when this save is a plant Place or physical Replace.
 * Legacy assign-variant (plant offer, no occupancy) is not Place.
 */
export function adminSaveNeedsInventorySource(input: {
  selectedIsPlant: boolean;
  creating: boolean;
  occupiedVariantId: string;
  selectedVariantId: string;
  sameVariantReplace: boolean;
  existingOfferId: string;
  existingOfferIsFlower: boolean;
}): boolean {
  if (!input.selectedIsPlant) return false;
  if (input.creating) return true;
  const occupied = input.occupiedVariantId.trim();
  const selected = input.selectedVariantId.trim();
  if (occupied && selected && selected !== occupied) return true;
  if (occupied && input.sameVariantReplace) return true;
  if (!occupied) {
    if (input.existingOfferId.trim() && !input.existingOfferIsFlower) return false;
    return true;
  }
  return false;
}

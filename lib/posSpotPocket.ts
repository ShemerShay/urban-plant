/**
 * POS spot pocket values — normalized DB values with human-readable UI labels.
 */

export const POS_SPOT_POCKETS = [
  { value: "entrance", label: "Entrance" },
  { value: "storefront_window", label: "Storefront Window" },
  { value: "counter", label: "Counter" },
  { value: "reception", label: "Reception" },
  { value: "waiting_area", label: "Waiting Area" },
  { value: "seating_area", label: "Seating Area" },
  { value: "treatment_area", label: "Treatment Area" },
  { value: "mirror_station", label: "Mirror Station" },
  { value: "shelf_display", label: "Shelf Display" },
  { value: "wall_side", label: "Wall Side" },
  { value: "corner", label: "Corner" },
  { value: "outdoor", label: "Outdoor" },
  { value: "other", label: "Other" },
] as const;

export type PosSpotPocketValue = (typeof POS_SPOT_POCKETS)[number]["value"];

const POCKET_VALUE_SET = new Set<string>(POS_SPOT_POCKETS.map((p) => p.value));

export function isPosSpotPocketValue(value: string): value is PosSpotPocketValue {
  return POCKET_VALUE_SET.has(value);
}

export function pocketDisplayLabel(pocket: string | undefined, pocketOther?: string): string | undefined {
  if (!pocket) return undefined;
  if (pocket === "other") {
    const custom = typeof pocketOther === "string" ? pocketOther.trim() : "";
    return custom || "Other";
  }
  const found = POS_SPOT_POCKETS.find((p) => p.value === pocket);
  if (found) return found.label;
  return pocket.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Legacy pocket text helper — not used for QR / slug identity. */
export function pocketNameForSlug(pocket: string, pocketOther?: string): string {
  if (pocket === "other") {
    const custom = typeof pocketOther === "string" ? pocketOther.trim() : "";
    return custom || "other";
  }
  return pocket;
}

export function formatPosSpotDisplayName(
  partnerName: string,
  spotNumber: string,
  pocket: string,
  pocketOther?: string,
): string {
  const pocketLabel = pocketDisplayLabel(pocket, pocketOther) ?? pocket;
  return `${partnerName.trim()} · ${spotNumber.trim()} · ${pocketLabel}`;
}

/** UI helper for POS spot cards — safe to import from Client Components. */
export function posSpotPocketLabel(spot: {
  pocket?: string;
  pocketOther?: string;
}): string | undefined {
  return pocketDisplayLabel(spot.pocket, spot.pocketOther);
}

/**
 * Resolve pocket display name: prefer Pocket entity name, else legacy enum columns,
 * else "Unassigned" when explicitly requested.
 */
export function resolvePosSpotPocketLabel(options: {
  pocketName?: string | null;
  pocket?: string;
  pocketOther?: string;
  unassignedLabel?: string;
}): string {
  if (typeof options.pocketName === "string" && options.pocketName.trim()) {
    return options.pocketName.trim();
  }
  const legacy = pocketDisplayLabel(options.pocket, options.pocketOther);
  if (legacy) return legacy;
  return options.unassignedLabel ?? "Unassigned";
}

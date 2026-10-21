import { PLANT_SIZE_LABELS, type PlantSizeLabel } from "@/lib/plantSizes";

/** Keep the selected pot only when it still matches the current plant Variant. */
export function retainCompatiblePotId(
  selectedPotId: string | null,
  pots: { id: string }[],
): string | null {
  if (!selectedPotId) return null;
  return pots.some((pot) => pot.id === selectedPotId) ? selectedPotId : null;
}

/** Real S/M/L plant sizes, in that order. A repeated label is omitted. */
export function catalogSizeChoices<T extends { sizeLabel?: string }>(sizes: T[]): T[] {
  const choices: T[] = [];
  for (const label of PLANT_SIZE_LABELS) {
    const matches = sizes.filter((size) => size.sizeLabel === label);
    if (matches.length === 1 && matches[0]) choices.push(matches[0]);
  }
  return choices;
}

/** Listing filter. "all" keeps every plant. A size matches only that plant-size row. */
export function plantMatchesCatalogSizeFilter(
  plantSizeCodes: readonly string[],
  filter: "all" | PlantSizeLabel,
): boolean {
  if (filter === "all") return true;
  return plantSizeCodes.includes(filter);
}

/**
 * One swatch per color that belongs to exactly one compatible pot variant.
 * Shared colors are listed and not chosen.
 */
export function uniquePotColorChoices<T extends { id: string; color: string }>(
  pots: T[],
): { choices: T[]; ambiguousColors: string[] } {
  const counts = new Map<string, number>();
  for (const pot of pots) {
    const key = pot.color.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const choices: T[] = [];
  const ambiguousColors: string[] = [];
  const seenAmbiguous = new Set<string>();
  for (const pot of pots) {
    const key = pot.color.trim().toLowerCase();
    if (!key) continue;
    if ((counts.get(key) ?? 0) === 1) {
      choices.push(pot);
    } else if (!seenAmbiguous.has(key)) {
      seenAmbiguous.add(key);
      ambiguousColors.push(pot.color.trim());
    }
  }
  return { choices, ambiguousColors };
}

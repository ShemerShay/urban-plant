/** Catalog plant sizes. Stored on plant_variants.size_label. */
export const PLANT_SIZE_LABELS = ["S", "M", "L"] as const;

export type PlantSizeLabel = (typeof PLANT_SIZE_LABELS)[number];

export function isPlantSizeLabel(value: string | null | undefined): value is PlantSizeLabel {
  return value === "S" || value === "M" || value === "L";
}

/** Distinct S/M/L labels, in that order. Other labels are ignored. */
export function catalogPlantSizeCodes(
  labels: readonly (string | null | undefined)[],
): PlantSizeLabel[] {
  const found = new Set<PlantSizeLabel>();
  for (const label of labels) {
    if (typeof label !== "string") continue;
    const trimmed = label.trim();
    if (isPlantSizeLabel(trimmed)) found.add(trimmed);
  }
  return PLANT_SIZE_LABELS.filter((label) => found.has(label));
}

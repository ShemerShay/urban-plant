/** Decorative pot sizes. S/M/L is the Pot Size domain, not a plant-size match. */
export const POT_SIZE_LABELS = ["S", "M", "L"] as const;

export type PotSizeLabel = (typeof POT_SIZE_LABELS)[number];

export function isPotSizeLabel(value: string): value is PotSizeLabel {
  return value === "S" || value === "M" || value === "L";
}

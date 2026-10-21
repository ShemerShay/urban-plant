/** Decorative pot sizes. Shop pot matching is exact size_label equality. */
export const POT_SIZE_LABELS = ["S", "M", "L"] as const;

export type PotSizeLabel = (typeof POT_SIZE_LABELS)[number];

export function isPotSizeLabel(value: string): value is PotSizeLabel {
  return value === "S" || value === "M" || value === "L";
}

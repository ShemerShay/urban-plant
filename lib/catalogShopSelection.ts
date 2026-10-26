import { PLANT_SIZE_LABELS, type PlantSizeLabel } from "@/lib/plantSizes";

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

export type CatalogColorChoice = {
  id: string;
  color: string;
  colorHe?: string;
  quantity: number;
};

export type CatalogVariantChoice = {
  id: string;
  potSizeId: string | null;
  potName?: string;
  potImage?: string;
  potSizeLabel?: string;
  offerId: string;
  unitPrice: number;
  colors: CatalogColorChoice[];
};

export type CatalogSizeChoice = {
  id: string;
  quantity: number;
  variants: CatalogVariantChoice[];
};

export type CatalogResolvedConfiguration = {
  plantSizeId: string;
  sellableVariantId: string;
  offerId: string;
  unitPrice: number;
  potColorId: string | null;
  availableQuantity: number;
};

const POT_SIZE_RANK: Record<string, number> = { S: 0, M: 1, L: 2 };

export function inStockColors(variant: CatalogVariantChoice): CatalogColorChoice[] {
  return variant.colors.filter((color) => color.quantity > 0);
}

export function variantIsEligible(
  size: CatalogSizeChoice,
  variant: CatalogVariantChoice,
): boolean {
  if (size.quantity <= 0) return false;
  if (!variant.offerId || !(variant.unitPrice > 0)) return false;
  if (variant.potSizeId == null) return true;
  return inStockColors(variant).length > 0;
}

export function comparePotBearingVariants(
  a: CatalogVariantChoice,
  b: CatalogVariantChoice,
): number {
  const name = (a.potName ?? "").localeCompare(b.potName ?? "", "en");
  if (name !== 0) return name;
  const rank =
    (POT_SIZE_RANK[a.potSizeLabel ?? ""] ?? 9) - (POT_SIZE_RANK[b.potSizeLabel ?? ""] ?? 9);
  if (rank !== 0) return rank;
  return a.id.localeCompare(b.id);
}

/** One eligible pot-bearing Variant, otherwise the eligible no-pot Variant. */
export function resolveCardVariant(size: CatalogSizeChoice): CatalogVariantChoice | null {
  const eligible = size.variants.filter((variant) => variantIsEligible(size, variant));
  const potBearing = eligible
    .filter((variant) => variant.potSizeId != null)
    .sort(comparePotBearingVariants);
  if (potBearing[0]) return potBearing[0];
  const noPot = eligible
    .filter((variant) => variant.potSizeId == null)
    .sort((a, b) => a.id.localeCompare(b.id));
  return noPot[0] ?? null;
}

export function colorSetKey(variant: CatalogVariantChoice): string {
  return inStockColors(variant)
    .map((color) => color.id)
    .sort()
    .join(",");
}

export function defaultPotColorId(variant: CatalogVariantChoice): string | null {
  if (variant.potSizeId == null) return null;
  const colors = [...inStockColors(variant)].sort((a, b) => {
    const name = a.color.localeCompare(b.color, "en");
    if (name !== 0) return name;
    return a.id.localeCompare(b.id);
  });
  return colors[0]?.id ?? null;
}

/** Keep the chosen color until the Plant Size changes or the in-stock color set changes. */
export function stablePotColorId(
  variant: CatalogVariantChoice,
  previous: { colorId: string | null; setKey: string } | null,
): string | null {
  if (variant.potSizeId == null) return null;
  const key = colorSetKey(variant);
  if (
    previous &&
    previous.setKey === key &&
    previous.colorId &&
    inStockColors(variant).some((color) => color.id === previous.colorId)
  ) {
    return previous.colorId;
  }
  return defaultPotColorId(variant);
}

export function additionalInStockColorCount(
  variant: CatalogVariantChoice,
  selectedColorId: string | null,
): number {
  return inStockColors(variant).filter((color) => color.id !== selectedColorId).length;
}

export function availableQuantityFor(
  size: CatalogSizeChoice,
  variant: CatalogVariantChoice,
  potColorId: string | null,
): number {
  if (size.quantity <= 0) return 0;
  if (variant.potSizeId == null) return potColorId == null ? size.quantity : 0;
  const color = inStockColors(variant).find((entry) => entry.id === potColorId);
  if (!color) return 0;
  return Math.min(size.quantity, color.quantity);
}

export function resolveCardConfiguration(
  size: CatalogSizeChoice,
  previousColor: { colorId: string | null; setKey: string } | null,
): (CatalogResolvedConfiguration & { setKey: string }) | null {
  const variant = resolveCardVariant(size);
  if (!variant) return null;
  const potColorId = stablePotColorId(variant, previousColor);
  const availableQuantity = availableQuantityFor(size, variant, potColorId);
  if (availableQuantity <= 0) return null;
  return {
    plantSizeId: size.id,
    sellableVariantId: variant.id,
    offerId: variant.offerId,
    unitPrice: variant.unitPrice,
    potColorId,
    availableQuantity,
    setKey: colorSetKey(variant),
  };
}

/** Plant page chooser. Color does not change the Offer. Pot Size can. */
export function resolveExplicitConfiguration(
  size: CatalogSizeChoice,
  sellableVariantId: string,
  potColorId: string | null,
): CatalogResolvedConfiguration | null {
  const variant = size.variants.find((entry) => entry.id === sellableVariantId);
  if (!variant || size.quantity <= 0 || !(variant.unitPrice > 0) || !variant.offerId) {
    return null;
  }
  const availableQuantity = availableQuantityFor(size, variant, potColorId);
  if (availableQuantity <= 0) return null;
  return {
    plantSizeId: size.id,
    sellableVariantId: variant.id,
    offerId: variant.offerId,
    unitPrice: variant.unitPrice,
    potColorId: variant.potSizeId == null ? null : potColorId,
    availableQuantity,
  };
}

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

export type CatalogVariantChoice = {
  id: string;
  potId: string | null;
  potName?: string;
  potImage?: string;
  offerId: string;
  unitPrice: number;
  potQuantity: number;
};

export type CatalogSizeChoice = {
  id: string;
  sizeLabel?: string;
  quantity: number;
  variants: CatalogVariantChoice[];
};

/**
 * Catalog-card default Plant Size. Filter wins when that size exists.
 * Otherwise prefer eligible M, then a sole eligible size, then S, then L.
 */
export function defaultCatalogCardSizeId(
  sizes: CatalogSizeChoice[],
  filter: "all" | PlantSizeLabel = "all",
): string {
  const choices = catalogSizeChoices(sizes);
  if (filter !== "all") {
    const filtered = choices.find((size) => size.sizeLabel === filter);
    if (filtered) return filtered.id;
  }
  const eligible = choices.filter((size) => resolveCardConfiguration(size) != null);
  const medium = eligible.find((size) => size.sizeLabel === "M");
  if (medium) return medium.id;
  if (eligible.length === 1 && eligible[0]) return eligible[0].id;
  for (const label of ["S", "L"] as const) {
    const next = eligible.find((size) => size.sizeLabel === label);
    if (next) return next.id;
  }
  const fallbackMedium = choices.find((size) => size.sizeLabel === "M");
  if (fallbackMedium) return fallbackMedium.id;
  return choices[0]?.id ?? "";
}

export type CatalogResolvedConfiguration = {
  plantSizeId: string;
  sellableVariantId: string;
  offerId: string;
  unitPrice: number;
  potId: string | null;
  availableQuantity: number;
};

export function variantIsEligible(
  size: CatalogSizeChoice,
  variant: CatalogVariantChoice,
): boolean {
  if (size.quantity <= 0) return false;
  if (!variant.offerId || !(variant.unitPrice > 0)) return false;
  if (variant.potId == null) return true;
  return variant.potQuantity > 0;
}

export function comparePotBearingVariants(
  a: CatalogVariantChoice,
  b: CatalogVariantChoice,
): number {
  const name = (a.potName ?? "").localeCompare(b.potName ?? "", "en");
  if (name !== 0) return name;
  return a.id.localeCompare(b.id);
}

/** One eligible pot-bearing Variant, otherwise the eligible no-pot Variant. */
export function resolveCardVariant(size: CatalogSizeChoice): CatalogVariantChoice | null {
  const eligible = size.variants.filter((variant) => variantIsEligible(size, variant));
  const potBearing = eligible
    .filter((variant) => variant.potId != null)
    .sort(comparePotBearingVariants);
  if (potBearing[0]) return potBearing[0];
  const noPot = eligible
    .filter((variant) => variant.potId == null)
    .sort((a, b) => a.id.localeCompare(b.id));
  return noPot[0] ?? null;
}

export function availableQuantityFor(
  size: CatalogSizeChoice,
  variant: CatalogVariantChoice,
): number {
  if (size.quantity <= 0) return 0;
  if (variant.potId == null) return size.quantity;
  if (variant.potQuantity <= 0) return 0;
  return Math.min(size.quantity, variant.potQuantity);
}

export function resolveCardConfiguration(
  size: CatalogSizeChoice,
): CatalogResolvedConfiguration | null {
  const variant = resolveCardVariant(size);
  if (!variant) return null;
  const availableQuantity = availableQuantityFor(size, variant);
  if (availableQuantity <= 0) return null;
  return {
    plantSizeId: size.id,
    sellableVariantId: variant.id,
    offerId: variant.offerId,
    unitPrice: variant.unitPrice,
    potId: variant.potId,
    availableQuantity,
  };
}

/** Plant page chooser. The Catalog Pot is part of the Variant. */
export function resolveExplicitConfiguration(
  size: CatalogSizeChoice,
  sellableVariantId: string,
): CatalogResolvedConfiguration | null {
  const variant = size.variants.find((entry) => entry.id === sellableVariantId);
  if (!variant || size.quantity <= 0 || !(variant.unitPrice > 0) || !variant.offerId) {
    return null;
  }
  const availableQuantity = availableQuantityFor(size, variant);
  if (availableQuantity <= 0) return null;
  return {
    plantSizeId: size.id,
    sellableVariantId: variant.id,
    offerId: variant.offerId,
    unitPrice: variant.unitPrice,
    potId: variant.potId,
    availableQuantity,
  };
}

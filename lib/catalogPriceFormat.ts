import type { Locale } from "@/lib/locale";
import type { PlantProduct } from "@/lib/types";

export function formatCatalogPrice(
  price: number,
  currency: PlantProduct["currency"],
  locale: Locale,
): string {
  const hasFraction = Math.round(price * 100) % 100 !== 0;
  return new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(price);
}

/** One price, or lowest–highest when priced variants differ. Null when nothing is priced. */
export function formatCatalogPriceSummary(
  priceMin: number | null,
  priceMax: number | null,
  currency: PlantProduct["currency"],
  locale: Locale,
): string | null {
  if (priceMin == null || priceMax == null) return null;
  const low = formatCatalogPrice(priceMin, currency, locale);
  if (priceMin === priceMax) return low;
  const high = formatCatalogPrice(priceMax, currency, locale);
  return `${low}–${high}`;
}

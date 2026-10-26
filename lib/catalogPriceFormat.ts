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

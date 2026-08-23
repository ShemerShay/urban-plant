import { PLANTS_CATALOG_SEED } from "@/lib/plantsCatalogSeed";
import { plantToWire, type PlantProductWire } from "@/lib/plantWire";
import type { PlantProduct } from "@/lib/types";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { t } from "@/lib/messages";

/** Static seed catalog for client bundles. Server routes should use `@/lib/plantCatalog`. */
export const mockPlants: PlantProductWire[] = PLANTS_CATALOG_SEED.map((plant) =>
  plantToWire(plant as PlantProduct),
);

export function getPlantById(id: string): PlantProductWire | undefined {
  return mockPlants.find((plant) => plant.id === id);
}

export function formatPrice(
  price: number,
  currency: PlantProduct["currency"],
  locale: Locale = DEFAULT_LOCALE,
) {
  return new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

/** Single-line CTA copy for product/checkout (ILS uses ₪ without space). */
export function formatBuyCta(
  price: number,
  currency: PlantProduct["currency"],
  locale: Locale = DEFAULT_LOCALE,
) {
  const amount = currency === "ILS" ? `₪${price}` : formatPrice(price, currency, locale);
  return t(locale, "plant.cta.buy", { price: amount });
}

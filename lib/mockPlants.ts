import { PLANTS_CATALOG_SEED } from "@/lib/plantsCatalogSeed";
import { plantToWire, type PlantProductWire } from "@/lib/plantWire";
import type { PlantProduct } from "@/lib/types";

/** Static seed catalog for client bundles. Server routes should use `@/lib/plantCatalog`. */
export const mockPlants: PlantProductWire[] = PLANTS_CATALOG_SEED.map((plant) =>
  plantToWire(plant as PlantProduct),
);

export function getPlantById(id: string): PlantProductWire | undefined {
  return mockPlants.find((plant) => plant.id === id);
}

export function formatPrice(price: number, currency: PlantProduct["currency"]) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

/** Single-line CTA copy for product/checkout (ILS uses ₪ without space). */
export function formatBuyCta(price: number, currency: PlantProduct["currency"]) {
  if (currency === "ILS") return `Buy for ₪${price}`;
  return `Buy for ${formatPrice(price, currency)}`;
}

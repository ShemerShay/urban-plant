import type { PlantProduct } from "@/lib/types";

/** Admin/API JSON shape (unchanged field name `price` for UI). */
export type PlantProductWire = Omit<PlantProduct, "supplierPrice"> & { price: number };

export function plantToWire(plant: PlantProduct): PlantProductWire {
  const { supplierPrice, ...rest } = plant;
  return { ...rest, price: supplierPrice };
}

export function plantsToWire(plants: PlantProduct[]): PlantProductWire[] {
  return plants.map(plantToWire);
}

/** Accept legacy `price` or `supplierPrice` in request bodies. */
export function wireBodyToParseInput(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (body.supplierPrice !== undefined || body.supplier_price !== undefined) {
    return body;
  }
  if (body.price !== undefined) {
    const { price, ...rest } = body;
    return { ...rest, supplierPrice: price };
  }
  return body;
}

import type { PlantProduct } from "@/lib/types";

/** Admin/API JSON shape. Supplier cost is `supplierPrice`. */
export type PlantProductWire = PlantProduct;

export function plantToWire(plant: PlantProduct): PlantProductWire {
  return plant;
}

export function plantsToWire(plants: PlantProduct[]): PlantProductWire[] {
  return plants;
}

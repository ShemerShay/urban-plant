import type { PlantProduct } from "@/lib/types";

/** Admin/API JSON shape. Plant supplier cost lives on Plant Size, not here. */
export type PlantProductWire = PlantProduct;

export function plantToWire(plant: PlantProduct): PlantProductWire {
  return plant;
}

export function plantsToWire(plants: PlantProduct[]): PlantProductWire[] {
  return plants;
}

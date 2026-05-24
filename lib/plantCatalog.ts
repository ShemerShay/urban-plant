import { readPlantsSync } from "@/lib/plantStorage";
import type { PlantProduct } from "@/lib/types";

/** Resolve a catalog plant from persisted storage (server / API routes). */
export function getPlantById(id: string): PlantProduct | undefined {
  return readPlantsSync().find((plant) => plant.id === id);
}

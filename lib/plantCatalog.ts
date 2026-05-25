import { getPlantByIdAsync } from "@/lib/plantStorage";
import type { PlantProduct } from "@/lib/types";

/** Resolve a catalog plant from Postgres (server / API routes). */
export async function getPlantById(id: string): Promise<PlantProduct | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  return getPlantByIdAsync(trimmed);
}

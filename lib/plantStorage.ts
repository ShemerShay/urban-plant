import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PLANTS_CATALOG_SEED } from "@/lib/plantsCatalogSeed";
import type { PlantProduct } from "@/lib/types";

const PLANTS_FILE = path.join(process.cwd(), "data", "plants.json");

let cache: PlantProduct[] | null = null;

function normalizePlantRecord(raw: unknown): PlantProduct {
  if (!raw || typeof raw !== "object") {
    throw new Error("Each plant must be a JSON object");
  }
  const { status: _legacyStatus, ...rest } = raw as Record<string, unknown>;
  return rest as unknown as PlantProduct;
}

function parsePlantsFile(raw: string): PlantProduct[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("plants.json must be a JSON array");
  }
  return parsed.map(normalizePlantRecord);
}

async function persistPlants(plants: PlantProduct[]): Promise<void> {
  await writeFile(PLANTS_FILE, `${JSON.stringify(plants, null, 2)}\n`, "utf-8");
  cache = plants;
}

async function ensurePlantsFile(): Promise<PlantProduct[]> {
  try {
    const raw = await readFile(PLANTS_FILE, "utf-8");
    const plants = parsePlantsFile(raw);
    cache = plants;
    return plants;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
    await persistPlants([...PLANTS_CATALOG_SEED]);
    return cache ?? [...PLANTS_CATALOG_SEED];
  }
}

export async function readPlants(): Promise<PlantProduct[]> {
  if (cache) return cache;
  return ensurePlantsFile();
}

export function readPlantsSync(): PlantProduct[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(PLANTS_FILE, "utf-8");
    cache = parsePlantsFile(raw);
    return cache;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [...PLANTS_CATALOG_SEED];
    throw error;
  }
}

export async function getPlantByIdAsync(id: string): Promise<PlantProduct | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const plants = await readPlants();
  return plants.find((plant) => plant.id === trimmed);
}

export async function createPlant(plant: PlantProduct): Promise<PlantProduct> {
  const plants = await readPlants();
  if (plants.some((item) => item.id === plant.id)) {
    throw new Error("A plant with this id already exists");
  }
  const next = [...plants, plant];
  await persistPlants(next);
  return plant;
}

export async function updatePlant(
  id: string,
  plant: PlantProduct,
): Promise<PlantProduct | null> {
  const trimmed = id.trim();
  const plants = await readPlants();
  const index = plants.findIndex((item) => item.id === trimmed);
  if (index < 0) return null;
  if (plant.id !== trimmed) {
    throw new Error("Plant id cannot be changed");
  }
  const next = [...plants];
  next[index] = plant;
  await persistPlants(next);
  return plant;
}

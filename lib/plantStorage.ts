/**
 * Plant catalog backed by Neon Postgres (`plants` table).
 */

import { sql } from "@/lib/db";
import { inventoryTypeOrDefault, type InventoryType } from "@/lib/inventoryType";
import { PLANTS_CATALOG_SEED } from "@/lib/plantsCatalogSeed";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";
import type { CareLevel, LightLevel, PlantProduct } from "@/lib/types";

export type PlantRow = {
  id: string;
  name: string;
  name_he: string | null;
  family: string | null;
  subtitle: string | null;
  subtitle_he: string | null;
  description: string | null;
  description_he: string | null;
  supplier_price: string | number;
  currency: string;
  images: unknown;
  labels: unknown;
  light: string | null;
  water: string | null;
  water_he: string | null;
  average_size: string | null;
  supplier_name: string | null;
  difficulty: string | null;
  location: string | null;
  pet_friendly: boolean | null;
  care_instructions: unknown;
  created_at: string | Date | null;
  inventory_type?: string | null;
};

function parseJsonStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function jsonArrayOrNull(value: string[] | undefined): string | null {
  return value && value.length > 0 ? JSON.stringify(value) : null;
}

function optionalTrimmed(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function mapPlantRow(row: PlantRow): PlantProduct {
  const supplierPrice = parseNumeric(row.supplier_price);
  const createdAt = toIsoString(row.created_at);
  const family = optionalTrimmed(row.family);
  const supplierName = optionalTrimmed(row.supplier_name);
  const nameHe = optionalTrimmed(row.name_he);
  const subtitleHe = optionalTrimmed(row.subtitle_he);
  const descriptionHe = optionalTrimmed(row.description_he);
  const waterHe = optionalTrimmed(row.water_he);
  const averageSizeRaw = row.average_size?.trim();
  const averageSize =
    averageSizeRaw === "small" ||
    averageSizeRaw === "medium" ||
    averageSizeRaw === "large" ||
    averageSizeRaw === "x-large"
      ? averageSizeRaw
      : undefined;

  const subtitle = optionalTrimmed(row.subtitle);
  const description = optionalTrimmed(row.description);
  const water = optionalTrimmed(row.water);
  const location = optionalTrimmed(row.location);
  const images = parseJsonStringArray(row.images);
  const labels = parseJsonStringArray(row.labels);
  const careInstructions = parseJsonStringArray(row.care_instructions);
  const lightRaw = optionalTrimmed(row.light);
  const light =
    lightRaw === "Low light" ||
    lightRaw === "Medium light" ||
    lightRaw === "Bright indirect light" ||
    lightRaw === "Direct sun"
      ? (lightRaw as LightLevel)
      : undefined;
  const difficultyRaw = optionalTrimmed(row.difficulty);
  const difficulty =
    difficultyRaw === "Easy" || difficultyRaw === "Moderate" || difficultyRaw === "Advanced"
      ? (difficultyRaw as CareLevel)
      : undefined;

  return {
    id: row.id,
    name: row.name,
    supplierPrice,
    price: supplierPrice,
    currency: row.currency as PlantProduct["currency"],
    ...(subtitle ? { subtitle } : {}),
    ...(description ? { description } : {}),
    ...(images ? { images } : {}),
    ...(labels ? { labels } : {}),
    ...(light ? { light } : {}),
    ...(water ? { water } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(location ? { location } : {}),
    ...(row.pet_friendly === true || row.pet_friendly === false
      ? { petFriendly: row.pet_friendly }
      : {}),
    ...(careInstructions ? { careInstructions } : {}),
    ...(nameHe ? { nameHe } : {}),
    ...(family ? { family } : {}),
    ...(subtitleHe ? { subtitleHe } : {}),
    ...(descriptionHe ? { descriptionHe } : {}),
    ...(waterHe ? { waterHe } : {}),
    ...(averageSize ? { averageSize } : {}),
    ...(supplierName ? { supplierName } : {}),
    ...(createdAt ? { createdAt } : {}),
    inventoryType: inventoryTypeOrDefault(row.inventory_type),
  };
}

function seedPlantsWithSupplierPrice(): PlantProduct[] {
  return PLANTS_CATALOG_SEED.map((plant) => {
    const legacyPrice = (plant as PlantProduct & { price?: number }).price;
    const supplierPrice =
      typeof plant.supplierPrice === "number"
        ? plant.supplierPrice
        : typeof legacyPrice === "number"
          ? legacyPrice
          : 0;
    return {
      ...plant,
      supplierPrice,
      price: supplierPrice,
      inventoryType: plant.inventoryType ?? "plants",
    };
  });
}

export async function readPlants(filter?: {
  inventoryType?: InventoryType;
}): Promise<PlantProduct[]> {
  const rows = filter?.inventoryType
    ? await sql`
        SELECT
          id, name, name_he, family, subtitle, subtitle_he, description, description_he,
          supplier_price, currency, images, labels, light, water, water_he, average_size,
          supplier_name, difficulty, location, pet_friendly,
          care_instructions, created_at, inventory_type
        FROM plants
        WHERE inventory_type = ${filter.inventoryType}
        ORDER BY name ASC
      `
    : await sql`
        SELECT
          id, name, name_he, family, subtitle, subtitle_he, description, description_he,
          supplier_price, currency, images, labels, light, water, water_he, average_size,
          supplier_name, difficulty, location, pet_friendly,
          care_instructions, created_at, inventory_type
        FROM plants
        ORDER BY name ASC
      `;
  const plants = (rows as PlantRow[]).map(mapPlantRow);
  if (plants.length > 0) return plants;

  const total = await sql`SELECT COUNT(*)::int AS n FROM plants`;
  const n = Number((total as { n: number }[])[0]?.n ?? 0);
  if (n > 0) return [];
  if (filter?.inventoryType === "flowers") return [];
  return seedPlantsWithSupplierPrice();
}

export async function getPlantByIdAsync(id: string): Promise<PlantProduct | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT
      id, name, name_he, family, subtitle, subtitle_he, description, description_he,
      supplier_price, currency, images, labels, light, water, water_he, average_size,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, created_at, inventory_type
    FROM plants
    WHERE id = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as PlantRow[])[0];
  if (row) return mapPlantRow(row);
  return (await readPlants()).find((plant) => plant.id === trimmed);
}

export async function createPlant(plant: PlantProduct): Promise<PlantProduct> {
  const existing = await getPlantByIdAsync(plant.id);
  if (existing) {
    throw new Error("A plant with this id already exists");
  }

  const imagesJson = jsonArrayOrNull(plant.images);
  const labelsJson = jsonArrayOrNull(plant.labels);
  const careJson = jsonArrayOrNull(plant.careInstructions);

  const rows = await sql`
    INSERT INTO plants (
      id, name, name_he, family, subtitle, subtitle_he, description, description_he,
      supplier_price, currency, images, labels, light, water, water_he, average_size,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, created_at, inventory_type
    )
    VALUES (
      ${plant.id},
      ${plant.name},
      ${plant.nameHe ?? null},
      ${plant.family ?? null},
      ${plant.subtitle ?? null},
      ${plant.subtitleHe ?? null},
      ${plant.description ?? null},
      ${plant.descriptionHe ?? null},
      ${plant.supplierPrice},
      ${plant.currency},
      ${imagesJson}::jsonb,
      ${labelsJson}::jsonb,
      ${plant.light ?? null},
      ${plant.water ?? null},
      ${plant.waterHe ?? null},
      ${plant.averageSize ?? null},
      ${plant.supplierName ?? null},
      ${plant.difficulty ?? null},
      ${plant.location ?? null},
      ${plant.petFriendly ?? null},
      ${careJson}::jsonb,
      ${plant.createdAt ?? new Date().toISOString()}::timestamptz,
      ${inventoryTypeOrDefault(plant.inventoryType)}
    )
    RETURNING
      id, name, name_he, family, subtitle, subtitle_he, description, description_he,
      supplier_price, currency, images, labels, light, water, water_he, average_size,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, created_at, inventory_type
  `;
  const row = (rows as PlantRow[])[0];
  if (!row) throw new Error("Could not create plant");
  return mapPlantRow(row);
}

export async function updatePlant(
  id: string,
  plant: PlantProduct,
): Promise<PlantProduct | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (plant.id !== trimmed) {
    throw new Error("Plant id cannot be changed");
  }

  const imagesJson = jsonArrayOrNull(plant.images);
  const labelsJson = jsonArrayOrNull(plant.labels);
  const careJson = jsonArrayOrNull(plant.careInstructions);

  const rows = await sql`
    UPDATE plants
    SET
      name = ${plant.name},
      name_he = ${plant.nameHe ?? null},
      family = ${plant.family ?? null},
      subtitle = ${plant.subtitle ?? null},
      subtitle_he = ${plant.subtitleHe ?? null},
      description = ${plant.description ?? null},
      description_he = ${plant.descriptionHe ?? null},
      supplier_price = ${plant.supplierPrice},
      currency = ${plant.currency},
      images = ${imagesJson}::jsonb,
      labels = ${labelsJson}::jsonb,
      light = ${plant.light ?? null},
      water = ${plant.water ?? null},
      water_he = ${plant.waterHe ?? null},
      average_size = ${plant.averageSize ?? null},
      supplier_name = ${plant.supplierName ?? null},
      difficulty = ${plant.difficulty ?? null},
      location = ${plant.location ?? null},
      pet_friendly = ${plant.petFriendly ?? null},
      care_instructions = ${careJson}::jsonb
    WHERE id = ${trimmed}
    RETURNING
      id, name, name_he, family, subtitle, subtitle_he, description, description_he,
      supplier_price, currency, images, labels, light, water, water_he, average_size,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, created_at, inventory_type
  `;
  const row = (rows as PlantRow[])[0];
  return row ? mapPlantRow(row) : null;
}

export async function deletePlant(id: string): Promise<boolean> {
  const trimmed = id.trim();
  if (!trimmed) return false;
  const rows = await sql`
    DELETE FROM plants
    WHERE id = ${trimmed}
    RETURNING id
  `;
  return (rows as { id: string }[]).length > 0;
}

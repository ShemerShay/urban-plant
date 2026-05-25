/**
 * Plant catalog backed by Neon Postgres (`plants` table).
 */

import { sql } from "@/lib/db";
import { PLANTS_CATALOG_SEED } from "@/lib/plantsCatalogSeed";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";
import type { CareLevel, LightLevel, PlantProduct } from "@/lib/types";

type PlantRow = {
  id: string;
  name: string;
  family: string | null;
  subtitle: string;
  description: string;
  supplier_price: string | number;
  currency: string;
  images: unknown;
  labels: unknown;
  light: string;
  water: string;
  average_size: string | null;
  maintenance_conditions: string | null;
  supplier_name: string | null;
  difficulty: string;
  location: string;
  pet_friendly: boolean;
  care_instructions: unknown;
  commercial_copy: string;
  created_at: string | Date | null;
};

function parseJsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapPlantRow(row: PlantRow): PlantProduct {
  const supplierPrice = parseNumeric(row.supplier_price);
  const createdAt = toIsoString(row.created_at);
  const family =
    typeof row.family === "string" && row.family.trim() ? row.family.trim() : undefined;
  const supplierName =
    typeof row.supplier_name === "string" && row.supplier_name.trim()
      ? row.supplier_name.trim()
      : undefined;
  const maintenanceConditions =
    typeof row.maintenance_conditions === "string" && row.maintenance_conditions.trim()
      ? row.maintenance_conditions.trim()
      : undefined;
  const averageSizeRaw = row.average_size?.trim();
  const averageSize =
    averageSizeRaw === "small" || averageSizeRaw === "medium" || averageSizeRaw === "large"
      ? averageSizeRaw
      : undefined;

  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description,
    supplierPrice,
    price: supplierPrice,
    currency: row.currency as PlantProduct["currency"],
    images: parseJsonStringArray(row.images),
    labels: parseJsonStringArray(row.labels),
    light: row.light as LightLevel,
    water: row.water,
    difficulty: row.difficulty as CareLevel,
    location: row.location,
    petFriendly: row.pet_friendly,
    careInstructions: parseJsonStringArray(row.care_instructions),
    commercialCopy: row.commercial_copy,
    ...(family ? { family } : {}),
    ...(averageSize ? { averageSize } : {}),
    ...(maintenanceConditions ? { maintenanceConditions } : {}),
    ...(supplierName ? { supplierName } : {}),
    ...(createdAt ? { createdAt } : {}),
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
    return { ...plant, supplierPrice, price: supplierPrice };
  });
}

export async function readPlants(): Promise<PlantProduct[]> {
  const rows = await sql`
    SELECT
      id, name, family, subtitle, description, supplier_price, currency,
      images, labels, light, water, average_size, maintenance_conditions,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, commercial_copy, created_at
    FROM plants
    ORDER BY name ASC
  `;
  const plants = (rows as PlantRow[]).map(mapPlantRow);
  return plants.length > 0 ? plants : seedPlantsWithSupplierPrice();
}

export async function getPlantByIdAsync(id: string): Promise<PlantProduct | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT
      id, name, family, subtitle, description, supplier_price, currency,
      images, labels, light, water, average_size, maintenance_conditions,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, commercial_copy, created_at
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

  const imagesJson = JSON.stringify(plant.images);
  const labelsJson = JSON.stringify(plant.labels);
  const careJson = JSON.stringify(plant.careInstructions);

  const rows = await sql`
    INSERT INTO plants (
      id, name, family, subtitle, description, supplier_price, currency,
      images, labels, light, water, average_size, maintenance_conditions,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, commercial_copy, created_at
    )
    VALUES (
      ${plant.id},
      ${plant.name},
      ${plant.family ?? null},
      ${plant.subtitle},
      ${plant.description},
      ${plant.supplierPrice},
      ${plant.currency},
      ${imagesJson}::jsonb,
      ${labelsJson}::jsonb,
      ${plant.light},
      ${plant.water},
      ${plant.averageSize ?? null},
      ${plant.maintenanceConditions ?? null},
      ${plant.supplierName ?? null},
      ${plant.difficulty},
      ${plant.location},
      ${plant.petFriendly},
      ${careJson}::jsonb,
      ${plant.commercialCopy},
      ${plant.createdAt ?? new Date().toISOString()}::timestamptz
    )
    RETURNING
      id, name, family, subtitle, description, supplier_price, currency,
      images, labels, light, water, average_size, maintenance_conditions,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, commercial_copy, created_at
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

  const imagesJson = JSON.stringify(plant.images);
  const labelsJson = JSON.stringify(plant.labels);
  const careJson = JSON.stringify(plant.careInstructions);

  const rows = await sql`
    UPDATE plants
    SET
      name = ${plant.name},
      family = ${plant.family ?? null},
      subtitle = ${plant.subtitle},
      description = ${plant.description},
      supplier_price = ${plant.supplierPrice},
      currency = ${plant.currency},
      images = ${imagesJson}::jsonb,
      labels = ${labelsJson}::jsonb,
      light = ${plant.light},
      water = ${plant.water},
      average_size = ${plant.averageSize ?? null},
      maintenance_conditions = ${plant.maintenanceConditions ?? null},
      supplier_name = ${plant.supplierName ?? null},
      difficulty = ${plant.difficulty},
      location = ${plant.location},
      pet_friendly = ${plant.petFriendly},
      care_instructions = ${careJson}::jsonb,
      commercial_copy = ${plant.commercialCopy}
    WHERE id = ${trimmed}
    RETURNING
      id, name, family, subtitle, description, supplier_price, currency,
      images, labels, light, water, average_size, maintenance_conditions,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, commercial_copy, created_at
  `;
  const row = (rows as PlantRow[])[0];
  return row ? mapPlantRow(row) : null;
}

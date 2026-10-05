/**
 * Public Catalog shop reads. Published plants only.
 * Prices come from plant_variants.catalog_price. Stock is central inventory quantity.
 * Pots match a plant variant only when size_label is exactly the same.
 */

import { sql } from "@/lib/db";
import { getInventoryQuantities } from "@/lib/inventoryStorage";
import type { PotSizeLabel } from "@/lib/potSizes";
import type { CareLevel, LightLevel, PlantProduct } from "@/lib/types";

export type CatalogShopCard = {
  id: string;
  name: string;
  nameHe?: string;
  currency: PlantProduct["currency"];
  image?: string;
  priceMin: number | null;
  priceMax: number | null;
  unavailable: boolean;
};

export type CatalogShopPotOption = {
  id: string;
  potId: string;
  name: string;
  nameHe?: string;
  image?: string;
  sizeLabel: PotSizeLabel;
  color: string;
  colorHe?: string;
  catalogPrice: number;
};

export type CatalogShopSize = {
  id: string;
  sizeLabel?: string;
  nurseryPotDiameterCm?: number;
  catalogPrice: number;
  quantity: number;
  pots: CatalogShopPotOption[];
};

export type CatalogShopDetail = {
  id: string;
  name: string;
  nameHe?: string;
  subtitle?: string;
  subtitleHe?: string;
  description?: string;
  descriptionHe?: string;
  currency: PlantProduct["currency"];
  images: string[];
  light?: LightLevel;
  water?: string;
  waterHe?: string;
  difficulty?: CareLevel;
  averageSize?: PlantProduct["averageSize"];
  sizes: CatalogShopSize[];
};

type PlantShopRow = {
  id: string;
  name: string;
  name_he: string | null;
  subtitle: string | null;
  subtitle_he: string | null;
  description: string | null;
  description_he: string | null;
  currency: string;
  images: unknown;
  light: string | null;
  water: string | null;
  water_he: string | null;
  average_size: string | null;
  difficulty: string | null;
};

type VariantShopRow = {
  id: string;
  plant_id: string;
  size_label: string | null;
  nursery_pot_diameter_cm: string | number | null;
  catalog_price: string | number | null;
};

type PotMatchRow = {
  id: string;
  pot_id: string;
  name: string;
  name_he: string | null;
  image: string | null;
  size_label: string;
  color: string;
  color_he: string | null;
  catalog_price: string | number;
};

function optionalTrimmed(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCurrency(value: string): PlantProduct["currency"] {
  if (value === "USD" || value === "EUR" || value === "ILS") return value;
  return "ILS";
}

function parsePrice(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseDiameter(value: string | number | null): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseLight(value: string | null): LightLevel | undefined {
  const raw = optionalTrimmed(value);
  if (
    raw === "Low light" ||
    raw === "Medium light" ||
    raw === "Bright indirect light" ||
    raw === "Direct sun"
  ) {
    return raw;
  }
  return undefined;
}

function parseDifficulty(value: string | null): CareLevel | undefined {
  const raw = optionalTrimmed(value);
  if (raw === "Easy" || raw === "Moderate" || raw === "Advanced") return raw;
  return undefined;
}

function parseAverageSize(value: string | null): PlantProduct["averageSize"] | undefined {
  const raw = optionalTrimmed(value);
  if (raw === "small" || raw === "medium" || raw === "large" || raw === "x-large") return raw;
  return undefined;
}

function sizeRank(label: string | undefined): number {
  if (label === "S") return 0;
  if (label === "M") return 1;
  if (label === "L") return 2;
  return 3;
}

function compareSizes(a: CatalogShopSize, b: CatalogShopSize): number {
  const da = a.nurseryPotDiameterCm;
  const db = b.nurseryPotDiameterCm;
  if (da != null && db != null && da !== db) return da - db;
  if (da != null && db == null) return -1;
  if (da == null && db != null) return 1;
  const rank = sizeRank(a.sizeLabel) - sizeRank(b.sizeLabel);
  if (rank !== 0) return rank;
  return (a.sizeLabel ?? "").localeCompare(b.sizeLabel ?? "");
}

async function readPublishedPlantRows(): Promise<PlantShopRow[]> {
  const rows = await sql`
    SELECT
      id, name, name_he, subtitle, subtitle_he, description, description_he,
      currency, images, light, water, water_he, average_size, difficulty
    FROM plants
    WHERE catalog_published = true
      AND inventory_type = 'plants'
    ORDER BY name ASC, id ASC
  `;
  return rows as PlantShopRow[];
}

async function readVariantRows(plantIds: string[]): Promise<VariantShopRow[]> {
  if (plantIds.length === 0) return [];
  const rows = await sql`
    SELECT id, plant_id, size_label, nursery_pot_diameter_cm, catalog_price
    FROM plant_variants
    WHERE plant_id = ANY(${plantIds}::text[])
  `;
  return rows as VariantShopRow[];
}

async function readPotsForLabels(labels: string[]): Promise<Map<string, CatalogShopPotOption[]>> {
  const unique = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  const grouped = new Map<string, CatalogShopPotOption[]>();
  if (unique.length === 0) return grouped;
  const rows = await sql`
    SELECT
      pv.id, pv.pot_id, pv.size_label, pv.color, pv.color_he, pv.catalog_price,
      p.name, p.name_he, p.image
    FROM pot_variants pv
    INNER JOIN pots p ON p.id = pv.pot_id
    WHERE pv.size_label = ANY(${unique}::text[])
    ORDER BY p.name ASC, pv.color ASC, pv.id ASC
  `;
  for (const row of rows as PotMatchRow[]) {
    const sizeLabel = row.size_label.trim();
    if (sizeLabel !== "S" && sizeLabel !== "M" && sizeLabel !== "L") continue;
    const nameHe = optionalTrimmed(row.name_he);
    const image = optionalTrimmed(row.image);
    const colorHe = optionalTrimmed(row.color_he);
    const catalogPrice = parsePrice(row.catalog_price);
    if (catalogPrice == null) continue;
    const option: CatalogShopPotOption = {
      id: row.id,
      potId: row.pot_id,
      name: row.name.trim(),
      sizeLabel,
      color: row.color.trim(),
      catalogPrice,
      ...(nameHe ? { nameHe } : {}),
      ...(image ? { image } : {}),
      ...(colorHe ? { colorHe } : {}),
    };
    const list = grouped.get(sizeLabel) ?? [];
    list.push(option);
    grouped.set(sizeLabel, list);
  }
  return grouped;
}

function toSize(
  row: VariantShopRow,
  quantity: number,
  potsByLabel: Map<string, CatalogShopPotOption[]>,
): CatalogShopSize | null {
  const catalogPrice = parsePrice(row.catalog_price);
  if (catalogPrice == null) return null;
  const sizeLabel = optionalTrimmed(row.size_label);
  const diameter = parseDiameter(row.nursery_pot_diameter_cm);
  const pots = sizeLabel ? (potsByLabel.get(sizeLabel) ?? []) : [];
  return {
    id: row.id,
    catalogPrice,
    quantity,
    pots,
    ...(sizeLabel ? { sizeLabel } : {}),
    ...(diameter != null ? { nurseryPotDiameterCm: diameter } : {}),
  };
}

function summarize(sizes: CatalogShopSize[]): {
  priceMin: number | null;
  priceMax: number | null;
  unavailable: boolean;
} {
  if (sizes.length === 0) {
    return { priceMin: null, priceMax: null, unavailable: true };
  }
  const prices = sizes.map((size) => size.catalogPrice);
  return {
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
    unavailable: sizes.every((size) => size.quantity <= 0),
  };
}

export async function readCatalogShopCards(): Promise<CatalogShopCard[]> {
  const plants = await readPublishedPlantRows();
  const variants = await readVariantRows(plants.map((plant) => plant.id));
  const quantities = await getInventoryQuantities(variants.map((variant) => variant.id));
  const byPlant = new Map<string, CatalogShopSize[]>();
  for (const variant of variants) {
    const size = toSize(variant, quantities.get(variant.id) ?? 0, new Map());
    if (!size) continue;
    const list = byPlant.get(variant.plant_id) ?? [];
    list.push(size);
    byPlant.set(variant.plant_id, list);
  }

  return plants.map((plant) => {
    const nameHe = optionalTrimmed(plant.name_he);
    const image = parseImages(plant.images)[0];
    const summary = summarize(byPlant.get(plant.id) ?? []);
    return {
      id: plant.id,
      name: plant.name,
      currency: parseCurrency(plant.currency),
      priceMin: summary.priceMin,
      priceMax: summary.priceMax,
      unavailable: summary.unavailable,
      ...(nameHe ? { nameHe } : {}),
      ...(image ? { image } : {}),
    };
  });
}

export async function readCatalogShopDetail(plantId: string): Promise<CatalogShopDetail | null> {
  const trimmed = plantId.trim();
  if (!trimmed) return null;
  const rows = await sql`
    SELECT
      id, name, name_he, subtitle, subtitle_he, description, description_he,
      currency, images, light, water, water_he, average_size, difficulty
    FROM plants
    WHERE id = ${trimmed}
      AND catalog_published = true
      AND inventory_type = 'plants'
    LIMIT 1
  `;
  const plant = (rows as PlantShopRow[])[0];
  if (!plant) return null;

  const variants = await readVariantRows([plant.id]);
  const quantities = await getInventoryQuantities(variants.map((variant) => variant.id));
  const labels = variants
    .map((variant) => optionalTrimmed(variant.size_label))
    .filter((label): label is string => Boolean(label));
  const potsByLabel = await readPotsForLabels(labels);
  const sizes = variants
    .map((variant) => toSize(variant, quantities.get(variant.id) ?? 0, potsByLabel))
    .filter((size): size is CatalogShopSize => size != null)
    .sort(compareSizes);

  const nameHe = optionalTrimmed(plant.name_he);
  const subtitle = optionalTrimmed(plant.subtitle);
  const subtitleHe = optionalTrimmed(plant.subtitle_he);
  const description = optionalTrimmed(plant.description);
  const descriptionHe = optionalTrimmed(plant.description_he);
  const water = optionalTrimmed(plant.water);
  const waterHe = optionalTrimmed(plant.water_he);
  const light = parseLight(plant.light);
  const difficulty = parseDifficulty(plant.difficulty);
  const averageSize = parseAverageSize(plant.average_size);

  return {
    id: plant.id,
    name: plant.name,
    currency: parseCurrency(plant.currency),
    images: parseImages(plant.images),
    sizes,
    ...(nameHe ? { nameHe } : {}),
    ...(subtitle ? { subtitle } : {}),
    ...(subtitleHe ? { subtitleHe } : {}),
    ...(description ? { description } : {}),
    ...(descriptionHe ? { descriptionHe } : {}),
    ...(water ? { water } : {}),
    ...(waterHe ? { waterHe } : {}),
    ...(light ? { light } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(averageSize ? { averageSize } : {}),
  };
}

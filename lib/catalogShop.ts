/**
 * Public Catalog shop reads. Published plants only.
 * Prices come from plant_variants.catalog_price. Stock is central inventory quantity.
 * Pots match a plant variant only when size_label is exactly the same.
 */

import type { CatalogCartItem, CatalogCartResolvedLine } from "@/lib/catalogCart";
import { sql } from "@/lib/db";
import { getInventoryQuantities } from "@/lib/inventoryStorage";
import type { PotSizeLabel } from "@/lib/potSizes";
import type { LightLevel, PlantProduct } from "@/lib/types";

export type CatalogShopCard = {
  id: string;
  name: string;
  nameHe?: string;
  currency: PlantProduct["currency"];
  image?: string;
  priceMin: number | null;
  priceMax: number | null;
  unavailable: boolean;
  sizes: CatalogShopSize[];
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
  petFriendly: boolean;
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
  pet_friendly: boolean | null;
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
      currency, images, light, water, water_he, average_size, pet_friendly
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
  const labels = variants
    .map((variant) => optionalTrimmed(variant.size_label))
    .filter((label): label is string => Boolean(label));
  const potsByLabel = await readPotsForLabels(labels);
  const byPlant = new Map<string, CatalogShopSize[]>();
  for (const variant of variants) {
    const size = toSize(variant, quantities.get(variant.id) ?? 0, potsByLabel);
    if (!size) continue;
    const list = byPlant.get(variant.plant_id) ?? [];
    list.push(size);
    byPlant.set(variant.plant_id, list);
  }

  return plants.map((plant) => {
    const nameHe = optionalTrimmed(plant.name_he);
    const image = parseImages(plant.images)[0];
    const sizes = (byPlant.get(plant.id) ?? []).sort(compareSizes);
    const summary = summarize(sizes);
    return {
      id: plant.id,
      name: plant.name,
      currency: parseCurrency(plant.currency),
      priceMin: summary.priceMin,
      priceMax: summary.priceMax,
      unavailable: summary.unavailable,
      sizes,
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
      currency, images, light, water, water_he, average_size, pet_friendly
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
  const averageSize = parseAverageSize(plant.average_size);

  return {
    id: plant.id,
    name: plant.name,
    currency: parseCurrency(plant.currency),
    images: parseImages(plant.images),
    sizes,
    petFriendly: plant.pet_friendly === true,
    ...(nameHe ? { nameHe } : {}),
    ...(subtitle ? { subtitle } : {}),
    ...(subtitleHe ? { subtitleHe } : {}),
    ...(description ? { description } : {}),
    ...(descriptionHe ? { descriptionHe } : {}),
    ...(water ? { water } : {}),
    ...(waterHe ? { waterHe } : {}),
    ...(light ? { light } : {}),
    ...(averageSize ? { averageSize } : {}),
  };
}

function variantKey(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * Stock another Catalog checkout can still buy.
 * Matches payment preparation: central quantity minus active unexpired holds.
 * Does not write inventory or holds.
 */
async function catalogAvailableQuantities(
  central: Map<string, number>,
): Promise<Map<string, number>> {
  const available = new Map<string, number>();
  const ids = [...central.keys()];
  for (const id of ids) available.set(id, Math.max(0, central.get(id) ?? 0));
  if (ids.length === 0) return available;

  const rows = await sql`
    SELECT plant_variant_id::text AS plant_variant_id, COALESCE(SUM(quantity), 0)::int AS quantity
    FROM catalog_stock_holds
    WHERE plant_variant_id = ANY(${ids}::uuid[])
      AND status = 'active'
      AND expires_at > now()
    GROUP BY plant_variant_id
  `;
  for (const row of rows as { plant_variant_id: string; quantity: number | string }[]) {
    const id = variantKey(row.plant_variant_id);
    const held = Number(row.quantity);
    if (!Number.isFinite(held)) continue;
    available.set(id, Math.max(0, (central.get(id) ?? 0) - held));
  }
  return available;
}

/**
 * Map stored Cart ids onto current published Catalog data.
 * Drops unpublished plants, missing/unpriced Variants, qty 0, and incompatible pots.
 * Clamps quantity to central stock minus active unexpired catalog holds.
 * Does not write inventory.
 */
export async function resolveCatalogCartLines(
  items: CatalogCartItem[],
): Promise<CatalogCartResolvedLine[]> {
  const plants = new Map<string, CatalogShopDetail | null>();
  const resolved: CatalogCartResolvedLine[] = [];

  for (const item of items) {
    if (!plants.has(item.plantId)) {
      plants.set(item.plantId, await readCatalogShopDetail(item.plantId));
    }
  }

  const central = new Map<string, number>();
  for (const plant of plants.values()) {
    if (!plant) continue;
    for (const size of plant.sizes) central.set(variantKey(size.id), size.quantity);
  }
  const availableByVariant = await catalogAvailableQuantities(central);

  for (const item of items) {
    const plant = plants.get(item.plantId);
    if (!plant) continue;

    const size = plant.sizes.find((entry) => variantKey(entry.id) === variantKey(item.plantVariantId));
    if (!size) continue;
    const available = availableByVariant.get(variantKey(size.id)) ?? 0;
    if (available <= 0) continue;

    let pot: CatalogShopPotOption | undefined;
    if (item.potVariantId) {
      pot = size.pots.find((entry) => entry.id === item.potVariantId);
      if (!pot) continue;
    }

    const quantity = Math.min(item.quantity, available);
    if (quantity < 1) continue;

    const nameHe = plant.nameHe;
    const image = plant.images[0];
    resolved.push({
      plantId: plant.id,
      plantVariantId: size.id,
      potVariantId: pot?.id ?? null,
      quantity,
      availableQuantity: available,
      name: plant.name,
      plantPrice: size.catalogPrice,
      currency: plant.currency,
      ...(nameHe ? { nameHe } : {}),
      ...(image ? { image } : {}),
      ...(size.sizeLabel ? { sizeLabel: size.sizeLabel } : {}),
      ...(size.nurseryPotDiameterCm != null
        ? { nurseryPotDiameterCm: size.nurseryPotDiameterCm }
        : {}),
      ...(pot
        ? {
            potName: pot.name,
            potColor: pot.color,
            potPrice: pot.catalogPrice,
            ...(pot.nameHe ? { potNameHe: pot.nameHe } : {}),
            ...(pot.colorHe ? { potColorHe: pot.colorHe } : {}),
          }
        : {}),
    });
  }

  return resolved;
}

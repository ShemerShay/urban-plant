/**
 * Public Catalog shop reads. Published plants only.
 * The active Catalog Offer is the only customer selling price.
 * Plant stock stays on the Plant Size. Pot stock stays on the Pot Color.
 * Does not write inventory.
 */

import type { CatalogCartItem, CatalogCartResolvedLine } from "@/lib/catalogCart";
import { sql } from "@/lib/db";
import { getInventoryQuantities } from "@/lib/inventoryStorage";
import { catalogPlantSizeCodes, type PlantSizeLabel } from "@/lib/plantSizes";
import type { PotSizeLabel } from "@/lib/potSizes";
import type { LightLevel, PlantProduct } from "@/lib/types";

export type CatalogShopColor = {
  id: string;
  color: string;
  colorHe?: string;
  quantity: number;
};

export type CatalogShopVariant = {
  id: string;
  potSizeId: string | null;
  potId?: string;
  potName?: string;
  potNameHe?: string;
  potImage?: string;
  potSizeLabel?: PotSizeLabel;
  offerId: string;
  unitPrice: number;
  colors: CatalogShopColor[];
};

export type CatalogShopSize = {
  id: string;
  sizeLabel?: string;
  nurseryPotDiameterCm?: number;
  quantity: number;
  variants: CatalogShopVariant[];
};

export type CatalogShopCard = {
  id: string;
  name: string;
  nameHe?: string;
  currency: PlantProduct["currency"];
  image?: string;
  unavailable: boolean;
  plantSizeCodes: PlantSizeLabel[];
  sizes: CatalogShopSize[];
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
  pet_friendly: boolean | null;
};

type VariantShopRow = {
  id: string;
  plant_id: string;
  size_label: string | null;
  nursery_pot_diameter_cm: string | number | null;
};

type OfferVariantRow = {
  id: string;
  plant_variant_id: string;
  pot_size_id: string | null;
  pot_id: string | null;
  pot_name: string | null;
  pot_name_he: string | null;
  pot_image: string | null;
  pot_size_label: string | null;
  offer_id: string;
  consumer_price: string | number;
};

type ColorRow = {
  id: string;
  pot_size_id: string;
  color: string;
  color_he: string | null;
  quantity: string | number | null;
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

function variantKey(id: string): string {
  return id.trim().toLowerCase();
}

function potSizeLabel(value: string | null): PotSizeLabel | undefined {
  const label = optionalTrimmed(value);
  if (label === "S" || label === "M" || label === "L") return label;
  return undefined;
}

async function readPublishedPlantRows(): Promise<PlantShopRow[]> {
  const rows = await sql`
    SELECT
      id, name, name_he, subtitle, subtitle_he, description, description_he,
      currency, images, light, water, water_he, pet_friendly
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
    SELECT id, plant_id, size_label, nursery_pot_diameter_cm
    FROM plant_variants
    WHERE plant_id = ANY(${plantIds}::text[])
  `;
  return rows as VariantShopRow[];
}

async function heldPlantQuantities(ids: string[]): Promise<Map<string, number>> {
  const held = new Map<string, number>();
  if (ids.length === 0) return held;
  const rows = await sql`
    SELECT plant_variant_id::text AS plant_variant_id, COALESCE(SUM(quantity), 0)::int AS quantity
    FROM catalog_stock_holds
    WHERE plant_variant_id = ANY(${ids}::uuid[])
      AND status = 'active'
      AND expires_at > now()
    GROUP BY plant_variant_id
  `;
  for (const row of rows as { plant_variant_id: string; quantity: number | string }[]) {
    held.set(variantKey(row.plant_variant_id), Number(row.quantity) || 0);
  }
  return held;
}

async function readOfferVariants(plantVariantIds: string[]): Promise<OfferVariantRow[]> {
  if (plantVariantIds.length === 0) return [];
  const rows = await sql`
    SELECT
      sv.id,
      sv.plant_variant_id,
      sv.pot_size_id,
      ps.pot_id,
      pot.name AS pot_name,
      pot.name_he AS pot_name_he,
      pot.image AS pot_image,
      ps.size_label AS pot_size_label,
      o.id AS offer_id,
      o.consumer_price
    FROM sellable_variants sv
    INNER JOIN offers o
      ON o.sellable_variant_id = sv.id
     AND o.status = 'active'
    INNER JOIN offer_availabilities a
      ON a.offer_id = o.id
     AND a.scope = 'catalog'
    LEFT JOIN pot_sizes ps ON ps.id = sv.pot_size_id
    LEFT JOIN pots pot ON pot.id = ps.pot_id
    WHERE sv.plant_variant_id = ANY(${plantVariantIds}::uuid[])
    ORDER BY pot.name ASC NULLS FIRST, ps.size_label ASC, sv.id ASC
  `;
  return rows as OfferVariantRow[];
}

async function readInStockColors(potSizeIds: string[]): Promise<Map<string, CatalogShopColor[]>> {
  const grouped = new Map<string, CatalogShopColor[]>();
  if (potSizeIds.length === 0) return grouped;
  const rows = await sql`
    SELECT
      c.id,
      c.pot_size_id,
      c.color,
      c.color_he,
      GREATEST(
        COALESCE(i.quantity, 0) - COALESCE((
          SELECT SUM(h.quantity)::int
          FROM catalog_stock_holds h
          WHERE h.pot_color_id = c.id
            AND h.status = 'active'
            AND h.expires_at > now()
        ), 0),
        0
      )::int AS quantity
    FROM pot_colors c
    LEFT JOIN pot_inventory i ON i.pot_color_id = c.id
    WHERE c.pot_size_id = ANY(${potSizeIds}::uuid[])
    ORDER BY c.color ASC, c.id ASC
  `;
  for (const row of rows as ColorRow[]) {
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const colorHe = optionalTrimmed(row.color_he);
    const color: CatalogShopColor = {
      id: row.id,
      color: row.color.trim(),
      quantity,
      ...(colorHe ? { colorHe } : {}),
    };
    const list = grouped.get(row.pot_size_id) ?? [];
    list.push(color);
    grouped.set(row.pot_size_id, list);
  }
  return grouped;
}

async function buildSizesByPlant(plantIds: string[]): Promise<Map<string, CatalogShopSize[]>> {
  const byPlant = new Map<string, CatalogShopSize[]>();
  const variants = await readVariantRows(plantIds);
  if (variants.length === 0) return byPlant;
  const variantIds = variants.map((variant) => variant.id);
  const quantities = await getInventoryQuantities(variantIds);
  const held = await heldPlantQuantities(variantIds);
  const offerRows = await readOfferVariants(variantIds);
  const potSizeIds = [
    ...new Set(
      offerRows
        .map((row) => row.pot_size_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const colorsBySize = await readInStockColors(potSizeIds);
  const variantsByPlantSize = new Map<string, CatalogShopVariant[]>();
  for (const row of offerRows) {
    const unitPrice = parsePrice(row.consumer_price);
    if (unitPrice == null) continue;
    const potLabel = potSizeLabel(row.pot_size_label);
    const potName = optionalTrimmed(row.pot_name ?? undefined);
    const potNameHe = optionalTrimmed(row.pot_name_he ?? undefined);
    const potImage = optionalTrimmed(row.pot_image ?? undefined);
    const shopVariant: CatalogShopVariant = {
      id: row.id,
      potSizeId: row.pot_size_id,
      offerId: row.offer_id,
      unitPrice,
      colors: row.pot_size_id ? (colorsBySize.get(row.pot_size_id) ?? []) : [],
      ...(row.pot_id ? { potId: row.pot_id } : {}),
      ...(potName ? { potName } : {}),
      ...(potNameHe ? { potNameHe } : {}),
      ...(potImage ? { potImage } : {}),
      ...(potLabel ? { potSizeLabel: potLabel } : {}),
    };
    const list = variantsByPlantSize.get(variantKey(row.plant_variant_id)) ?? [];
    list.push(shopVariant);
    variantsByPlantSize.set(variantKey(row.plant_variant_id), list);
  }

  for (const variant of variants) {
    const sellable = variantsByPlantSize.get(variantKey(variant.id)) ?? [];
    if (sellable.length === 0) continue;
    const central = quantities.get(variant.id) ?? 0;
    const quantity = Math.max(0, central - (held.get(variantKey(variant.id)) ?? 0));
    const sizeLabel = optionalTrimmed(variant.size_label);
    const diameter = parseDiameter(variant.nursery_pot_diameter_cm);
    const size: CatalogShopSize = {
      id: variant.id,
      quantity,
      variants: sellable,
      ...(sizeLabel ? { sizeLabel } : {}),
      ...(diameter != null ? { nurseryPotDiameterCm: diameter } : {}),
    };
    const list = byPlant.get(variant.plant_id) ?? [];
    list.push(size);
    byPlant.set(variant.plant_id, list);
  }

  for (const [plantId, sizes] of byPlant) {
    byPlant.set(plantId, sizes.sort(compareSizes));
  }
  return byPlant;
}

function plantIsUnavailable(sizes: CatalogShopSize[]): boolean {
  if (sizes.length === 0) return true;
  return sizes.every((size) => size.quantity <= 0);
}

export async function readCatalogShopCards(): Promise<CatalogShopCard[]> {
  const plants = await readPublishedPlantRows();
  const variants = await readVariantRows(plants.map((plant) => plant.id));
  const sizesByPlant = await buildSizesByPlant(plants.map((plant) => plant.id));
  const labelsByPlant = new Map<string, Array<string | null>>();
  for (const variant of variants) {
    const list = labelsByPlant.get(variant.plant_id) ?? [];
    list.push(variant.size_label);
    labelsByPlant.set(variant.plant_id, list);
  }

  return plants.map((plant) => {
    const nameHe = optionalTrimmed(plant.name_he);
    const image = parseImages(plant.images)[0];
    const sizes = sizesByPlant.get(plant.id) ?? [];
    return {
      id: plant.id,
      name: plant.name,
      currency: parseCurrency(plant.currency),
      unavailable: plantIsUnavailable(sizes),
      plantSizeCodes: catalogPlantSizeCodes(labelsByPlant.get(plant.id) ?? []),
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
      currency, images, light, water, water_he, pet_friendly
    FROM plants
    WHERE id = ${trimmed}
      AND catalog_published = true
      AND inventory_type = 'plants'
    LIMIT 1
  `;
  const plant = (rows as PlantShopRow[])[0];
  if (!plant) return null;
  const sizes = (await buildSizesByPlant([plant.id])).get(plant.id) ?? [];
  const nameHe = optionalTrimmed(plant.name_he);
  const subtitle = optionalTrimmed(plant.subtitle);
  const subtitleHe = optionalTrimmed(plant.subtitle_he);
  const description = optionalTrimmed(plant.description);
  const descriptionHe = optionalTrimmed(plant.description_he);
  const water = optionalTrimmed(plant.water);
  const waterHe = optionalTrimmed(plant.water_he);
  const light = parseLight(plant.light);

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
  };
}

/**
 * Map stored v2 Cart lines onto current published Catalog Offers.
 * Drops a line whose Offer, Variant, Plant Size, color, or stock no longer agrees.
 * Clamps quantity to the smaller of plant and color availability.
 * Does not write inventory.
 */
export async function resolveCatalogCartLines(
  items: CatalogCartItem[],
): Promise<CatalogCartResolvedLine[]> {
  const plants = new Map<string, CatalogShopDetail | null>();
  for (const item of items) {
    if (!plants.has(item.plantId)) {
      plants.set(item.plantId, await readCatalogShopDetail(item.plantId));
    }
  }

  const resolved: CatalogCartResolvedLine[] = [];
  for (const item of items) {
    const plant = plants.get(item.plantId);
    if (!plant) continue;
    const size = plant.sizes.find((entry) => variantKey(entry.id) === variantKey(item.plantSizeId));
    if (!size || size.quantity <= 0) continue;
    const sellable = size.variants.find(
      (entry) => variantKey(entry.id) === variantKey(item.sellableVariantId),
    );
    if (!sellable || sellable.offerId !== item.offerId) continue;

    let potColor: CatalogShopColor | undefined;
    if (sellable.potSizeId == null) {
      if (item.potColorId) continue;
    } else {
      if (!item.potColorId) continue;
      potColor = sellable.colors.find((entry) => variantKey(entry.id) === variantKey(item.potColorId!));
      if (!potColor || potColor.quantity <= 0) continue;
    }

    const available = potColor
      ? Math.min(size.quantity, potColor.quantity)
      : size.quantity;
    const quantity = Math.min(item.quantity, available);
    if (quantity < 1) continue;

    resolved.push({
      plantId: plant.id,
      plantSizeId: size.id,
      sellableVariantId: sellable.id,
      offerId: sellable.offerId,
      potColorId: potColor?.id ?? null,
      quantity,
      availableQuantity: available,
      name: plant.name,
      unitPrice: sellable.unitPrice,
      currency: plant.currency,
      ...(plant.nameHe ? { nameHe: plant.nameHe } : {}),
      ...(plant.images[0] ? { image: plant.images[0] } : {}),
      ...(size.sizeLabel ? { sizeLabel: size.sizeLabel } : {}),
      ...(size.nurseryPotDiameterCm != null
        ? { nurseryPotDiameterCm: size.nurseryPotDiameterCm }
        : {}),
      ...(sellable.potName
        ? {
            potName: sellable.potName,
            ...(sellable.potNameHe ? { potNameHe: sellable.potNameHe } : {}),
            ...(sellable.potSizeLabel ? { potSizeLabel: sellable.potSizeLabel } : {}),
          }
        : {}),
      ...(potColor
        ? {
            potColor: potColor.color,
            ...(potColor.colorHe ? { potColorHe: potColor.colorHe } : {}),
          }
        : {}),
    });
  }
  return resolved;
}

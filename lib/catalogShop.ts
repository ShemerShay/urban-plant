/**
 * Public Catalog shop reads. Published plants only.
 * The active Catalog Offer is the only customer selling price.
 * Plant stock stays on the Plant Size. Pot stock stays on the Catalog Pot.
 * Does not write inventory.
 */

import { cache } from "react";

import type { CatalogCartItem, CatalogCartResolvedLine } from "@/lib/catalogCart";
import {
  CATALOG_SHOP_CACHE_TAG,
  CATALOG_SHOP_REVALIDATE_SECONDS,
} from "@/lib/catalogShopCache";
import { sql } from "@/lib/db";
import { catalogPlantSizeCodes, type PlantSizeLabel } from "@/lib/plantSizes";
import type { LightLevel, PlantProduct } from "@/lib/types";

export type CatalogShopVariant = {
  id: string;
  potId: string | null;
  potName?: string;
  potNameHe?: string;
  potImage?: string;
  potColor?: string;
  offerId: string;
  unitPrice: number;
  potQuantity: number;
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

type CatalogConfigurationRow = VariantShopRow & {
  plant_quantity: string | number;
  sellable_variant_id: string | null;
  pot_id: string | null;
  pot_name: string | null;
  pot_name_he: string | null;
  pot_image: string | null;
  pot_color: string | null;
  offer_id: string | null;
  consumer_price: string | number | null;
  pot_quantity: string | number;
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

/** Catalog card thumbnail: the first persisted plant image, in stored order. */
export function firstStoredPlantImage(value: unknown): string | undefined {
  return parseImages(value)[0];
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

type CatalogSnapshotRow = PlantShopRow & {
  variant_id: string | null;
  size_label: string | null;
  nursery_pot_diameter_cm: string | number | null;
  plant_quantity: string | number | null;
  sellable_variant_id: string | null;
  pot_id: string | null;
  pot_name: string | null;
  pot_name_he: string | null;
  pot_image: string | null;
  pot_color: string | null;
  offer_id: string | null;
  consumer_price: string | number | null;
  pot_quantity: string | number | null;
};

/**
 * One Neon read for published plants and their catalog offers.
 * `plantIds` null reads the whole published plant catalog.
 * A non-null list still drops unpublished plants and non-plant inventory.
 */
async function readCatalogSnapshot(plantIds: string[] | null): Promise<{
  plants: PlantShopRow[];
  rows: CatalogConfigurationRow[];
}> {
  const rows = (await sql`
    WITH published_plants AS (
      SELECT
        id, name, name_he, subtitle, subtitle_he, description, description_he,
        currency, images, light, water, water_he, pet_friendly
      FROM plants
      WHERE catalog_published = true
        AND inventory_type = 'plants'
        AND (${plantIds}::text[] IS NULL OR id = ANY(${plantIds}::text[]))
    ),
    requested_variants AS (
      SELECT pv.id, pv.plant_id, pv.size_label, pv.nursery_pot_diameter_cm
      FROM plant_variants pv
      INNER JOIN published_plants published ON published.id = pv.plant_id
    ),
    active_plant_holds AS (
      SELECT plant_variant_id, SUM(quantity)::int AS quantity
      FROM catalog_stock_holds
      WHERE status = 'active'
        AND expires_at > now()
        AND plant_variant_id IS NOT NULL
        AND plant_variant_id IN (SELECT id FROM requested_variants)
      GROUP BY plant_variant_id
    ),
    catalog_offers AS (
      SELECT
        sv.id AS sellable_variant_id,
        sv.plant_variant_id,
        sv.pot_id,
        o.id AS offer_id,
        o.consumer_price
      FROM sellable_variants sv
      INNER JOIN requested_variants requested ON requested.id = sv.plant_variant_id
      INNER JOIN offers o
        ON o.sellable_variant_id = sv.id
       AND o.status = 'active'
      INNER JOIN offer_availabilities a
        ON a.offer_id = o.id
       AND a.scope = 'catalog'
    ),
    active_pot_holds AS (
      SELECT pot_id, SUM(quantity)::int AS quantity
      FROM catalog_stock_holds
      WHERE status = 'active'
        AND expires_at > now()
        AND pot_id IS NOT NULL
        AND pot_id IN (SELECT pot_id FROM catalog_offers WHERE pot_id IS NOT NULL)
      GROUP BY pot_id
    )
    SELECT
      published.id,
      published.name,
      published.name_he,
      published.subtitle,
      published.subtitle_he,
      published.description,
      published.description_he,
      published.currency,
      published.images,
      published.light,
      published.water,
      published.water_he,
      published.pet_friendly,
      pv.id AS variant_id,
      pv.size_label,
      pv.nursery_pot_diameter_cm,
      GREATEST(
        COALESCE(i.quantity, 0) - COALESCE(plant_holds.quantity, 0),
        0
      )::int AS plant_quantity,
      catalog_offers.sellable_variant_id,
      catalog_offers.pot_id,
      pot.name AS pot_name,
      pot.name_he AS pot_name_he,
      pot.image AS pot_image,
      pot.color AS pot_color,
      catalog_offers.offer_id,
      catalog_offers.consumer_price,
      CASE
        WHEN catalog_offers.pot_id IS NULL THEN 0
        ELSE GREATEST(
          COALESCE(pot_stock.quantity, 0) - COALESCE(pot_holds.quantity, 0),
          0
        )::int
      END AS pot_quantity
    FROM published_plants published
    LEFT JOIN requested_variants pv ON pv.plant_id = published.id
    LEFT JOIN inventory i ON i.variant_id = pv.id
    LEFT JOIN active_plant_holds plant_holds ON plant_holds.plant_variant_id = pv.id
    LEFT JOIN catalog_offers ON catalog_offers.plant_variant_id = pv.id
    LEFT JOIN pots pot ON pot.id = catalog_offers.pot_id
    LEFT JOIN pot_inventory pot_stock ON pot_stock.pot_id = catalog_offers.pot_id
    LEFT JOIN active_pot_holds pot_holds ON pot_holds.pot_id = catalog_offers.pot_id
    ORDER BY published.name ASC, published.id ASC, pot.name ASC NULLS FIRST, catalog_offers.sellable_variant_id ASC
  `) as CatalogSnapshotRow[];

  const plants: PlantShopRow[] = [];
  const seenPlants = new Set<string>();
  const configuration: CatalogConfigurationRow[] = [];
  for (const row of rows) {
    if (!seenPlants.has(row.id)) {
      seenPlants.add(row.id);
      plants.push({
        id: row.id,
        name: row.name,
        name_he: row.name_he,
        subtitle: row.subtitle,
        subtitle_he: row.subtitle_he,
        description: row.description,
        description_he: row.description_he,
        currency: row.currency,
        images: row.images,
        light: row.light,
        water: row.water,
        water_he: row.water_he,
        pet_friendly: row.pet_friendly,
      });
    }
    if (!row.variant_id) continue;
    configuration.push({
      id: row.variant_id,
      plant_id: row.id,
      size_label: row.size_label,
      nursery_pot_diameter_cm: row.nursery_pot_diameter_cm,
      plant_quantity: row.plant_quantity ?? 0,
      sellable_variant_id: row.sellable_variant_id,
      pot_id: row.pot_id,
      pot_name: row.pot_name,
      pot_name_he: row.pot_name_he,
      pot_image: row.pot_image,
      pot_color: row.pot_color,
      offer_id: row.offer_id,
      consumer_price: row.consumer_price,
      pot_quantity: row.pot_quantity ?? 0,
    });
  }
  return { plants, rows: configuration };
}

function readCatalogConfiguration(rows: CatalogConfigurationRow[]): {
  labelsByPlant: Map<string, Array<string | null>>;
  sizesByPlant: Map<string, CatalogShopSize[]>;
} {
  const byPlant = new Map<string, CatalogShopSize[]>();
  const labelsByPlant = new Map<string, Array<string | null>>();
  const sizesById = new Map<string, CatalogShopSize & { plantId: string }>();

  for (const row of rows) {
    const key = variantKey(row.id);
    let size = sizesById.get(key);
    if (!size) {
      const sizeLabel = optionalTrimmed(row.size_label);
      const diameter = parseDiameter(row.nursery_pot_diameter_cm);
      size = {
        id: row.id,
        plantId: row.plant_id,
        quantity: Math.max(0, Number(row.plant_quantity) || 0),
        variants: [],
        ...(sizeLabel ? { sizeLabel } : {}),
        ...(diameter != null ? { nurseryPotDiameterCm: diameter } : {}),
      };
      sizesById.set(key, size);
      const labels = labelsByPlant.get(row.plant_id) ?? [];
      labels.push(row.size_label);
      labelsByPlant.set(row.plant_id, labels);
    }

    if (!row.sellable_variant_id || !row.offer_id) continue;
    const unitPrice = parsePrice(row.consumer_price);
    if (unitPrice == null) continue;
    const potName = optionalTrimmed(row.pot_name ?? undefined);
    const potNameHe = optionalTrimmed(row.pot_name_he ?? undefined);
    const potImage = optionalTrimmed(row.pot_image ?? undefined);
    const potColor = optionalTrimmed(row.pot_color ?? undefined);
    const shopVariant: CatalogShopVariant = {
      id: row.sellable_variant_id,
      potId: row.pot_id,
      offerId: row.offer_id,
      unitPrice,
      potQuantity: row.pot_id ? Math.max(0, Number(row.pot_quantity) || 0) : 0,
      ...(potName ? { potName } : {}),
      ...(potNameHe ? { potNameHe } : {}),
      ...(potImage ? { potImage } : {}),
      ...(potColor ? { potColor } : {}),
    };
    size.variants.push(shopVariant);
  }

  for (const { plantId, ...size } of sizesById.values()) {
    if (size.variants.length === 0) continue;
    const list = byPlant.get(plantId) ?? [];
    list.push(size);
    byPlant.set(plantId, list);
  }

  for (const [plantId, sizes] of byPlant) {
    byPlant.set(plantId, sizes.sort(compareSizes));
  }
  return { labelsByPlant, sizesByPlant: byPlant };
}

function plantIsUnavailable(sizes: CatalogShopSize[]): boolean {
  if (sizes.length === 0) return true;
  return sizes.every((size) => size.quantity <= 0);
}

function cardsFromSnapshot(snapshot: {
  plants: PlantShopRow[];
  rows: CatalogConfigurationRow[];
}): CatalogShopCard[] {
  const { labelsByPlant, sizesByPlant } = readCatalogConfiguration(snapshot.rows);
  return snapshot.plants.map((plant) => {
    const nameHe = optionalTrimmed(plant.name_he);
    const image = firstStoredPlantImage(plant.images);
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

async function loadCatalogShopCards(): Promise<CatalogShopCard[]> {
  return cardsFromSnapshot(await readCatalogSnapshot(null));
}

let catalogShopCardsCache: (() => Promise<CatalogShopCard[]>) | undefined;

export async function readCatalogShopCards(): Promise<CatalogShopCard[]> {
  if (!process.env.NEXT_RUNTIME) return loadCatalogShopCards();
  if (!catalogShopCardsCache) {
    const { unstable_cache } = await import("next/cache");
    catalogShopCardsCache = unstable_cache(loadCatalogShopCards, ["catalog-shop-cards"], {
      revalidate: CATALOG_SHOP_REVALIDATE_SECONDS,
      tags: [CATALOG_SHOP_CACHE_TAG],
    });
  }
  return catalogShopCardsCache();
}

function mapCatalogShopDetail(
  plant: PlantShopRow,
  sizes: CatalogShopSize[],
): CatalogShopDetail {
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

async function loadCatalogShopDetail(plantId: string): Promise<CatalogShopDetail | null> {
  const snapshot = await readCatalogSnapshot([plantId]);
  const plant = snapshot.plants[0];
  if (!plant) return null;
  const { sizesByPlant } = readCatalogConfiguration(snapshot.rows);
  return mapCatalogShopDetail(plant, sizesByPlant.get(plant.id) ?? []);
}

let catalogShopDetailCache: ((plantId: string) => Promise<CatalogShopDetail | null>) | undefined;

/** Request-memoized so plant layout + page share one load; short tagged cache across requests. */
export const readCatalogShopDetail = cache(async function readCatalogShopDetail(
  plantId: string,
): Promise<CatalogShopDetail | null> {
  const trimmed = plantId.trim();
  if (!trimmed) return null;
  if (!process.env.NEXT_RUNTIME) return loadCatalogShopDetail(trimmed);
  if (!catalogShopDetailCache) {
    const { unstable_cache } = await import("next/cache");
    catalogShopDetailCache = unstable_cache(loadCatalogShopDetail, ["catalog-shop-detail"], {
      revalidate: CATALOG_SHOP_REVALIDATE_SECONDS,
      tags: [CATALOG_SHOP_CACHE_TAG],
    });
  }
  return catalogShopDetailCache(trimmed);
});

/**
 * Map stored v2 Cart lines onto current published Catalog Offers.
 * Drops a line whose Offer, Variant, Plant Size, or stock no longer agrees.
 * Clamps quantity to the smaller of plant and pot availability.
 * Does not write inventory.
 */
export async function resolveCatalogCartLines(
  items: CatalogCartItem[],
): Promise<CatalogCartResolvedLine[]> {
  const requestedPlantIds = [
    ...new Set(items.map((item) => item.plantId.trim()).filter(Boolean)),
  ];
  if (requestedPlantIds.length === 0) return [];

  const snapshot = await readCatalogSnapshot(requestedPlantIds);
  const { sizesByPlant } = readCatalogConfiguration(snapshot.rows);
  const plants = new Map<string, CatalogShopDetail>();
  for (const plant of snapshot.plants) {
    plants.set(plant.id, mapCatalogShopDetail(plant, sizesByPlant.get(plant.id) ?? []));
  }

  const resolved: CatalogCartResolvedLine[] = [];
  for (const item of items) {
    const plant = plants.get(item.plantId.trim());
    if (!plant) continue;
    const size = plant.sizes.find((entry) => variantKey(entry.id) === variantKey(item.plantSizeId));
    if (!size || size.quantity <= 0) continue;
    const sellable = size.variants.find(
      (entry) => variantKey(entry.id) === variantKey(item.sellableVariantId),
    );
    if (!sellable || sellable.offerId !== item.offerId) continue;
    const available =
      sellable.potId == null
        ? size.quantity
        : Math.min(size.quantity, sellable.potQuantity);
    const quantity = Math.min(item.quantity, available);
    if (quantity < 1) continue;

    resolved.push({
      plantId: plant.id,
      plantSizeId: size.id,
      sellableVariantId: sellable.id,
      offerId: sellable.offerId,
      potId: sellable.potId,
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
            ...(sellable.potColor ? { potColor: sellable.potColor } : {}),
          }
        : {}),
    });
  }
  return resolved;
}

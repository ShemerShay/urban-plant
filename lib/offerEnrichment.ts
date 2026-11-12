import { sql } from "@/lib/db";
import type { PlantProduct } from "@/lib/types";

import type { Offer, OfferWithProduct } from "./offerTypes";

type PlantEnrichmentRow = {
  id: string;
  name: string;
  currency: string | null;
  images: unknown;
  subtitle: string | null;
};

type PlantEnrichment = {
  name: string;
  currency: PlantProduct["currency"];
  images: string[];
  subtitle: string;
};

function parseImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapPlantEnrichment(row: PlantEnrichmentRow): PlantEnrichment {
  const currency =
    row.currency === "USD" || row.currency === "EUR" || row.currency === "ILS"
      ? row.currency
      : "ILS";
  return {
    name: row.name.trim() || row.id,
    currency,
    images: parseImages(row.images),
    subtitle: row.subtitle?.trim() || "",
  };
}

/** One plants lookup for many offers (no per-offer getPlantById). */
async function loadPlantEnrichmentByIds(
  productIds: readonly string[],
): Promise<Map<string, PlantEnrichment>> {
  const ids = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await sql`
    SELECT id, name, currency, images, subtitle
    FROM plants
    WHERE id = ANY(${ids}::text[])
  `;
  const byId = new Map<string, PlantEnrichment>();
  for (const row of rows as PlantEnrichmentRow[]) {
    byId.set(row.id, mapPlantEnrichment(row));
  }
  return byId;
}

function offerWithProduct(offer: Offer, product: PlantEnrichment | undefined): OfferWithProduct {
  return {
    ...offer,
    productName: product?.name ?? offer.productId,
    currency: product?.currency ?? "ILS",
    plantImages: product?.images ?? [],
    plantSubtitle: product?.subtitle ?? "",
  };
}

export async function enrichOfferWithProduct(offer: Offer): Promise<OfferWithProduct> {
  const [enriched] = await enrichOffersWithProduct([offer]);
  return enriched!;
}

export async function enrichOffersWithProduct(offers: Offer[]): Promise<OfferWithProduct[]> {
  if (offers.length === 0) return [];
  const byId = await loadPlantEnrichmentByIds(offers.map((offer) => offer.productId));
  return offers.map((offer) => offerWithProduct(offer, byId.get(offer.productId)));
}

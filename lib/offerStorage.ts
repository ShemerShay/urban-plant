/**
 * Sale offers backed by Neon Postgres. Product/Offer creation is manual source data for now.
 */

import { sql } from "@/lib/db";
import { mockPlants } from "@/lib/mockPlants";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

import type { Offer, OfferStatus } from "./offerTypes";

const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";

export function defaultOfferIdForProduct(productId: string): string {
  return `offer-${productId}`;
}

function defaultOffers(): Offer[] {
  return mockPlants.map((plant) => ({
    id: defaultOfferIdForProduct(plant.id),
    productId: plant.id,
    consumerPrice: plant.price,
    ...(typeof plant.baseSupplierPrice === "number"
      ? { supplierPrice: plant.baseSupplierPrice }
      : {}),
    ...(plant.supplierName ? { supplierName: plant.supplierName } : {}),
    status: plant.status === "sold" ? "inactive" : "active",
    createdAt: plant.createdAt ?? SEED_CREATED_AT,
  }));
}

type OfferRow = {
  id: string;
  product_id: string;
  consumer_price: string | number;
  supplier_price: string | number | null;
  supplier_name: string | null;
  status: string;
  created_at: string | Date;
};

function mapOfferRow(row: OfferRow): Offer {
  const status: OfferStatus = row.status === "inactive" ? "inactive" : "active";
  const createdAt = toIsoString(row.created_at) ?? SEED_CREATED_AT;
  const supplierPrice =
    row.supplier_price != null ? parseNumeric(row.supplier_price) : undefined;
  const supplierName =
    typeof row.supplier_name === "string" && row.supplier_name.trim()
      ? row.supplier_name.trim()
      : undefined;

  return {
    id: row.id,
    productId: row.product_id,
    consumerPrice: parseNumeric(row.consumer_price),
    ...(supplierPrice !== undefined ? { supplierPrice } : {}),
    ...(supplierName ? { supplierName } : {}),
    status,
    createdAt,
  };
}

export async function readOffers(): Promise<Offer[]> {
  const rows = await sql`
    SELECT id, product_id, consumer_price, supplier_price, supplier_name, status, created_at
    FROM offers
    ORDER BY created_at ASC
  `;
  const offers = (rows as OfferRow[]).map(mapOfferRow);
  return offers.length > 0 ? offers : defaultOffers();
}

export async function saveOffers(offers: Offer[]): Promise<void> {
  await sql`DELETE FROM offers`;
  for (const offer of offers) {
    await sql`
      INSERT INTO offers (
        id, product_id, consumer_price, supplier_price, supplier_name, status, created_at
      )
      VALUES (
        ${offer.id},
        ${offer.productId},
        ${offer.consumerPrice},
        ${offer.supplierPrice ?? null},
        ${offer.supplierName ?? null},
        ${offer.status},
        ${offer.createdAt}::timestamptz
      )
    `;
  }
}

export async function getOfferById(id: string): Promise<Offer | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT id, product_id, consumer_price, supplier_price, supplier_name, status, created_at
    FROM offers
    WHERE id = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as OfferRow[])[0];
  if (row) return mapOfferRow(row);
  return (await readOffers()).find((offer) => offer.id === trimmed);
}

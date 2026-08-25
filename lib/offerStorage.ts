/**
 * Sale offers backed by Neon Postgres. New rows get UUID primary keys (legacy slug ids may remain until replaced).
 */

import { randomUUID } from "crypto";

import { sql } from "@/lib/db";
import type { InventoryType } from "@/lib/inventoryType";
import { PLANTS_CATALOG_SEED } from "@/lib/plantsCatalogSeed";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

import type { Offer, OfferStatus } from "./offerTypes";

const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";

export type NewOfferInput = {
  productId: string;
  consumerPrice: number;
  status?: OfferStatus;
};

export type UpdateOfferInput = {
  productId?: string;
  consumerPrice?: number;
  status?: OfferStatus;
};

function defaultOffers(): Offer[] {
  return PLANTS_CATALOG_SEED.map((plant) => ({
    id: randomUUID(),
    productId: plant.id,
    consumerPrice: plant.supplierPrice,
    status: "active",
    createdAt: plant.createdAt ?? SEED_CREATED_AT,
  }));
}

export type OfferRow = {
  id: string;
  product_id: string;
  consumer_price: string | number;
  status: string;
  created_at: string | Date;
};

export function mapOfferRow(row: OfferRow): Offer {
  const status: OfferStatus = row.status === "inactive" ? "inactive" : "active";
  const createdAt = toIsoString(row.created_at) ?? SEED_CREATED_AT;

  return {
    id: row.id,
    productId: row.product_id,
    consumerPrice: parseNumeric(row.consumer_price),
    status,
    createdAt,
  };
}

export async function readOffers(filter?: {
  inventoryType?: InventoryType;
}): Promise<Offer[]> {
  const rows = filter?.inventoryType
    ? await sql`
        SELECT o.id, o.product_id, o.consumer_price, o.status, o.created_at
        FROM offers o
        INNER JOIN plants pl ON pl.id = o.product_id
        WHERE pl.inventory_type = ${filter.inventoryType}
        ORDER BY o.created_at ASC
      `
    : await sql`
        SELECT id, product_id, consumer_price, status, created_at
        FROM offers
        ORDER BY created_at ASC
      `;
  const offers = (rows as OfferRow[]).map(mapOfferRow);
  if (filter?.inventoryType) return offers;
  return offers.length > 0 ? offers : defaultOffers();
}

export async function saveOffers(offers: Offer[]): Promise<void> {
  await sql`DELETE FROM offers`;
  for (const offer of offers) {
    await sql`
      INSERT INTO offers (
        id, product_id, consumer_price, status, created_at
      )
      VALUES (
        ${offer.id},
        ${offer.productId},
        ${offer.consumerPrice},
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
    SELECT id, product_id, consumer_price, status, created_at
    FROM offers
    WHERE id = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as OfferRow[])[0];
  if (row) return mapOfferRow(row);
  return (await readOffers()).find((offer) => offer.id === trimmed);
}

/** Inserts a new offer; always assigns a fresh UUID (client must not send slug-style ids). */
export async function appendOffer(input: NewOfferInput): Promise<Offer> {
  const productId = input.productId.trim();
  const status: OfferStatus = input.status === "inactive" ? "inactive" : "active";
  const createdAt = new Date().toISOString();
  const offer: Offer = {
    id: randomUUID(),
    productId,
    consumerPrice: input.consumerPrice,
    status,
    createdAt,
  };

  await sql`
    INSERT INTO offers (
      id, product_id, consumer_price, status, created_at
    )
    VALUES (
      ${offer.id},
      ${offer.productId},
      ${offer.consumerPrice},
      ${offer.status},
      ${offer.createdAt}::timestamptz
    )
  `;

  return offer;
}

export async function updateOffer(
  id: string,
  input: UpdateOfferInput,
): Promise<Offer | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;

  const existing = await getOfferById(trimmed);
  if (!existing) return undefined;

  const productId =
    input.productId !== undefined ? input.productId.trim() : existing.productId;
  const consumerPrice = input.consumerPrice ?? existing.consumerPrice;
  const status: OfferStatus =
    input.status === "inactive" ? "inactive" : input.status === "active" ? "active" : existing.status;

  const offer: Offer = {
    id: trimmed,
    productId,
    consumerPrice,
    status,
    createdAt: existing.createdAt,
  };

  await sql`
    UPDATE offers
    SET
      product_id = ${offer.productId},
      consumer_price = ${offer.consumerPrice},
      status = ${offer.status}
    WHERE id = ${trimmed}
  `;

  return offer;
}

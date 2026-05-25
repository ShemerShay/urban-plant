/**
 * Sale offers backed by Neon Postgres. New rows get UUID primary keys (legacy slug ids may remain until replaced).
 */

import { randomUUID } from "crypto";

import { sql } from "@/lib/db";
import { PLANTS_CATALOG_SEED } from "@/lib/plantsCatalogSeed";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

import type { Offer, OfferStatus } from "./offerTypes";

const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";

export type NewOfferInput = {
  productId: string;
  consumerPrice: number;
  supplierPrice?: number;
  supplierName?: string;
  status?: OfferStatus;
};

export type UpdateOfferInput = {
  productId?: string;
  consumerPrice?: number;
  supplierPrice?: number | null;
  supplierName?: string | null;
  status?: OfferStatus;
};

function defaultOffers(): Offer[] {
  return PLANTS_CATALOG_SEED.map((plant) => ({
    id: randomUUID(),
    productId: plant.id,
    consumerPrice: plant.supplierPrice,
    ...(plant.supplierName ? { supplierName: plant.supplierName } : {}),
    status: "active",
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

/** Inserts a new offer; always assigns a fresh UUID (client must not send slug-style ids). */
export async function appendOffer(input: NewOfferInput): Promise<Offer> {
  const productId = input.productId.trim();
  const status: OfferStatus = input.status === "inactive" ? "inactive" : "active";
  const createdAt = new Date().toISOString();
  const offer: Offer = {
    id: randomUUID(),
    productId,
    consumerPrice: input.consumerPrice,
    ...(typeof input.supplierPrice === "number" ? { supplierPrice: input.supplierPrice } : {}),
    ...(input.supplierName?.trim() ? { supplierName: input.supplierName.trim() } : {}),
    status,
    createdAt,
  };

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

  let supplierPrice: number | undefined;
  if (input.supplierPrice === null) {
    supplierPrice = undefined;
  } else if (typeof input.supplierPrice === "number") {
    supplierPrice = input.supplierPrice;
  } else {
    supplierPrice = existing.supplierPrice;
  }

  let supplierName: string | undefined;
  if (input.supplierName === null) {
    supplierName = undefined;
  } else if (input.supplierName !== undefined) {
    const name = input.supplierName.trim();
    supplierName = name ? name : undefined;
  } else {
    supplierName = existing.supplierName;
  }

  const offer: Offer = {
    id: trimmed,
    productId,
    consumerPrice,
    ...(supplierPrice !== undefined ? { supplierPrice } : {}),
    ...(supplierName ? { supplierName } : {}),
    status,
    createdAt: existing.createdAt,
  };

  await sql`
    UPDATE offers
    SET
      product_id = ${offer.productId},
      consumer_price = ${offer.consumerPrice},
      supplier_price = ${offer.supplierPrice ?? null},
      supplier_name = ${offer.supplierName ?? null},
      status = ${offer.status}
    WHERE id = ${trimmed}
  `;

  return offer;
}

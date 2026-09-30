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
  variant_id?: string | null;
  consumer_price: string | number;
  status: string;
  created_at: string | Date;
};

function mapVariantId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function mapOfferRow(row: OfferRow): Offer {
  const status: OfferStatus = row.status === "inactive" ? "inactive" : "active";
  const createdAt = toIsoString(row.created_at) ?? SEED_CREATED_AT;

  return {
    id: row.id,
    productId: row.product_id,
    variantId: mapVariantId(row.variant_id),
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
        SELECT o.id, o.product_id, o.variant_id, o.consumer_price, o.status, o.created_at
        FROM offers o
        INNER JOIN plants pl ON pl.id = o.product_id
        WHERE pl.inventory_type = ${filter.inventoryType}
        ORDER BY o.created_at ASC
      `
    : await sql`
        SELECT id, product_id, variant_id, consumer_price, status, created_at
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
        id, product_id, variant_id, consumer_price, status, created_at
      )
      VALUES (
        ${offer.id},
        ${offer.productId},
        ${offer.variantId ?? null},
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
    SELECT id, product_id, variant_id, consumer_price, status, created_at
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
      id, product_id, variant_id, consumer_price, status, created_at
    )
    VALUES (
      ${offer.id},
      ${offer.productId},
      ${offer.variantId ?? null},
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
    variantId: existing.variantId ?? null,
    consumerPrice,
    status,
    createdAt: existing.createdAt,
  };

  await sql`
    WITH old AS (
      SELECT id, consumer_price
      FROM offers
      WHERE id = ${trimmed}
    ),
    price_upd AS (
      UPDATE offers
      SET
        product_id = ${offer.productId},
        consumer_price = ${offer.consumerPrice}::numeric,
        status = ${offer.status}
      FROM old
      WHERE offers.id = old.id
      RETURNING offers.id, offers.consumer_price, old.consumer_price AS previous_price
    ),
    affected AS (
      SELECT
        c.id AS cycle_id,
        p.pocket_id,
        pk.name AS pocket_name,
        p.current_offer_id AS offer_id,
        u.consumer_price
      FROM price_upd u
      INNER JOIN pos_spots p ON p.current_offer_id = u.id
      INNER JOIN placement_cycles c
        ON c.pos_spot_id = p.id
       AND c.ended_at IS NULL
      LEFT JOIN pockets pk ON pk.id = p.pocket_id
      WHERE u.consumer_price IS DISTINCT FROM u.previous_price
    ),
    closed_segments AS (
      UPDATE placement_segments s
      SET ended_at = now()
      FROM affected a
      WHERE s.placement_cycle_id = a.cycle_id
        AND s.ended_at IS NULL
        AND s.consumer_price IS DISTINCT FROM a.consumer_price
      RETURNING s.placement_cycle_id
    ),
    opened_segments AS (
      INSERT INTO placement_segments (
        id,
        placement_cycle_id,
        started_at,
        ended_at,
        pocket_id,
        pocket_name,
        offer_id,
        consumer_price
      )
      SELECT
        gen_random_uuid(),
        a.cycle_id,
        now(),
        NULL,
        a.pocket_id,
        CASE WHEN a.pocket_id IS NULL THEN NULL ELSE a.pocket_name END,
        a.offer_id,
        a.consumer_price
      FROM affected a
      INNER JOIN closed_segments cs ON cs.placement_cycle_id = a.cycle_id
      WHERE (
        a.pocket_id IS NULL
        OR (a.pocket_name IS NOT NULL AND length(trim(a.pocket_name)) > 0)
      )
      RETURNING id
    )
    SELECT 1 / CASE
      WHEN (SELECT COUNT(*) FROM affected) = (SELECT COUNT(*) FROM closed_segments)
       AND (SELECT COUNT(*) FROM closed_segments) = (SELECT COUNT(*) FROM opened_segments)
      THEN 1
      ELSE 0
    END AS seg_ok
    FROM price_upd
  `;

  return offer;
}

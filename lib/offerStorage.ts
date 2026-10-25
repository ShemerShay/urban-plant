/**
 * Sale offers backed by Neon Postgres. New rows get UUID primary keys (legacy slug ids may remain until replaced).
 * Plant Offers point at a Sellable Variant. Flowers and legacy rows do not.
 */

import { randomUUID } from "crypto";

import { sql } from "@/lib/db";
import type { InventoryType } from "@/lib/inventoryType";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

import type {
  Offer,
  OfferAvailability,
  OfferAvailabilityScope,
  OfferSellableVariant,
  OfferStatus,
} from "./offerTypes";

const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";

export const OFFER_PRICE_INVALID = "consumerPrice must be a non-negative number";
export const OFFER_PRICE_CONFLICT =
  "This price is already used by another offer for this variant";
export const OFFER_CATALOG_CONFLICT =
  "Another active Catalog offer already exists for this variant";
export const OFFER_AVAILABILITY_MALFORMED = "availability is malformed";
export const OFFER_AVAILABILITY_DUPLICATE = "duplicate availability";
export const OFFER_VARIANT_REQUIRED = "sellableVariantId is required";
export const OFFER_VARIANT_NOT_FOUND = "Sellable variant not found";
export const OFFER_PRODUCT_CONFLICT = "productId does not match the selected variant";
export const OFFER_INVENTORY_CONFLICT = "productId must match the requested inventoryType";
export const OFFER_FLOWER_VARIANT_REJECTED =
  "Flower offers cannot use a sellable variant or availabilities";
export const OFFER_LEGACY_VARIANT_REJECTED =
  "This offer cannot gain a variant or availabilities";
export const OFFER_VARIANT_IMMUTABLE = "sellableVariantId cannot be changed";

export type OfferWriteCode = "conflict" | "invalid" | "not_found";

export class OfferWriteError extends Error {
  readonly code: OfferWriteCode;

  constructor(code: OfferWriteCode, message: string) {
    super(message);
    this.name = "OfferWriteError";
    this.code = code;
  }
}

export function offerWriteHttp(error: OfferWriteError): { status: number; error: string } {
  const status = error.code === "conflict" ? 409 : error.code === "not_found" ? 404 : 400;
  return { status, error: error.message };
}

export type NewFlowerOfferInput = {
  productId: string;
  consumerPrice: number;
  status?: OfferStatus;
};

export type UpdateOfferInput = {
  productId?: string;
  consumerPrice?: number;
  status?: OfferStatus;
  availabilities?: unknown;
  sellableVariantId?: string;
};

export type OfferRow = {
  id: string;
  product_id: string;
  variant_id?: string | null;
  sellable_variant_id?: string | null;
  variant_plant_name?: string | null;
  plant_size_label?: string | null;
  pot_name?: string | null;
  pot_size_label?: string | null;
  availabilities?: unknown;
  consumer_price: string | number;
  status: string;
  created_at: string | Date;
};

type VariantPlant = {
  plantId: string;
  inventoryType: string;
};

function mapVariantId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function mapSellableVariant(row: OfferRow): OfferSellableVariant | null {
  const sellableVariantId = mapVariantId(row.sellable_variant_id);
  if (!sellableVariantId) return null;
  return {
    sellableVariantId,
    plantName: row.variant_plant_name?.trim() || "",
    plantSizeLabel: row.plant_size_label?.trim() || "",
    potName: row.pot_name?.trim() || null,
    potSizeLabel: row.pot_size_label?.trim() || null,
  };
}

function mapAvailabilities(value: unknown): OfferAvailability[] {
  const source = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(source)) return [];
  const availabilities: OfferAvailability[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const scope = (item as { scope?: unknown }).scope;
    const partnerLocationId = (item as { partnerLocationId?: unknown }).partnerLocationId;
    if (scope !== "catalog" && scope !== "partner_location") continue;
    availabilities.push({
      scope,
      partnerLocationId:
        typeof partnerLocationId === "string" && partnerLocationId.trim()
          ? partnerLocationId.trim()
          : null,
    });
  }
  return availabilities;
}

export function mapOfferRow(row: OfferRow): Offer {
  const status: OfferStatus = row.status === "inactive" ? "inactive" : "active";
  const createdAt = toIsoString(row.created_at) ?? SEED_CREATED_AT;
  const sellableVariant = mapSellableVariant(row);

  return {
    id: row.id,
    productId: row.product_id,
    variantId: mapVariantId(row.variant_id),
    sellableVariantId: sellableVariant?.sellableVariantId ?? null,
    sellableVariant,
    availabilities: mapAvailabilities(row.availabilities),
    consumerPrice: parseNumeric(row.consumer_price),
    status,
    createdAt,
  };
}

function pgErrorParts(error: unknown): { code: string; message: string; constraint: string } {
  const candidates: unknown[] = [error];
  if (typeof error === "object" && error && "sourceError" in error) {
    candidates.push(error.sourceError);
  }
  if (error instanceof Error && error.cause) candidates.push(error.cause);
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate == null || !("code" in candidate)) continue;
    const code = String(candidate.code ?? "");
    if (!code) continue;
    const message =
      candidate instanceof Error
        ? candidate.message
        : String("message" in candidate ? candidate.message : "");
    const constraint =
      "constraint" in candidate && candidate.constraint != null
        ? String(candidate.constraint)
        : "";
    return { code, message, constraint };
  }
  return {
    code: "",
    message: error instanceof Error ? error.message : String(error),
    constraint: "",
  };
}

function mapOfferPgError(error: unknown): OfferWriteError | null {
  const { code, message, constraint } = pgErrorParts(error);
  if (
    code === "23505" &&
    (/active catalog offer/i.test(message) || constraint === "offer_active_catalog")
  ) {
    return new OfferWriteError("conflict", OFFER_CATALOG_CONFLICT);
  }
  if (
    code === "23505" &&
    (constraint === "offers_sellable_variant_consumer_price_key" ||
      /offers_sellable_variant_consumer_price_key|duplicate key/i.test(message))
  ) {
    return new OfferWriteError("conflict", OFFER_PRICE_CONFLICT);
  }
  if (code === "23505" && /catalog/i.test(message)) {
    return new OfferWriteError("conflict", OFFER_CATALOG_CONFLICT);
  }
  if (code === "23505") {
    return new OfferWriteError("conflict", OFFER_PRICE_CONFLICT);
  }
  if (code === "23514" && /flower/i.test(message)) {
    return new OfferWriteError("invalid", OFFER_FLOWER_VARIANT_REJECTED);
  }
  if (code === "23514" && /product_id/i.test(message)) {
    return new OfferWriteError("invalid", OFFER_PRODUCT_CONFLICT);
  }
  if (code === "23514" && /availability requires/i.test(message)) {
    return new OfferWriteError("invalid", OFFER_LEGACY_VARIANT_REJECTED);
  }
  if (code === "23503" && /partner_location/i.test(message)) {
    return new OfferWriteError("invalid", OFFER_AVAILABILITY_MALFORMED);
  }
  if (code === "23503" && /sellable_variant/i.test(message)) {
    return new OfferWriteError("not_found", OFFER_VARIANT_NOT_FOUND);
  }
  if (code === "23514" || code === "23503") {
    return new OfferWriteError("invalid", message || OFFER_AVAILABILITY_MALFORMED);
  }
  return null;
}

function throwMapped(error: unknown): never {
  const mapped = mapOfferPgError(error);
  if (mapped) throw mapped;
  throw error;
}

export function parseOfferAvailabilities(value: unknown): OfferAvailability[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new OfferWriteError("invalid", OFFER_AVAILABILITY_MALFORMED);
  }
  const seen = new Set<string>();
  const availabilities: OfferAvailability[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      throw new OfferWriteError("invalid", OFFER_AVAILABILITY_MALFORMED);
    }
    const record = item as Record<string, unknown>;
    const scope = record.scope;
    if (scope !== "catalog" && scope !== "partner_location") {
      throw new OfferWriteError("invalid", OFFER_AVAILABILITY_MALFORMED);
    }
    const rawLocation = record.partnerLocationId;
    const location =
      typeof rawLocation === "string" && rawLocation.trim() ? rawLocation.trim() : null;
    if (rawLocation != null && rawLocation !== "" && location == null) {
      throw new OfferWriteError("invalid", OFFER_AVAILABILITY_MALFORMED);
    }
    if (scope === "catalog") {
      if (location) throw new OfferWriteError("invalid", OFFER_AVAILABILITY_MALFORMED);
      if (seen.has("catalog")) {
        throw new OfferWriteError("invalid", OFFER_AVAILABILITY_DUPLICATE);
      }
      seen.add("catalog");
      availabilities.push({ scope, partnerLocationId: null });
      continue;
    }
    if (!location) throw new OfferWriteError("invalid", OFFER_AVAILABILITY_MALFORMED);
    const key = `partner_location:${location}`;
    if (seen.has(key)) throw new OfferWriteError("invalid", OFFER_AVAILABILITY_DUPLICATE);
    seen.add(key);
    availabilities.push({ scope: scope as OfferAvailabilityScope, partnerLocationId: location });
  }
  return availabilities;
}

function assertConsumerPrice(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new OfferWriteError("invalid", OFFER_PRICE_INVALID);
  }
}

function assertStatus(value: string): asserts value is OfferStatus {
  if (value !== "active" && value !== "inactive") {
    throw new OfferWriteError("invalid", 'status must be "active" or "inactive"');
  }
}

async function assertLocationsExist(availabilities: OfferAvailability[]): Promise<void> {
  const ids = availabilities
    .map((row) => row.partnerLocationId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  const rows = await sql`
    SELECT id
    FROM partner_locations
    WHERE id = ANY(${ids}::text[])
  `;
  if ((rows as { id: string }[]).length !== ids.length) {
    throw new OfferWriteError("invalid", OFFER_AVAILABILITY_MALFORMED);
  }
}

async function queryOffers(filter?: {
  inventoryType?: InventoryType | null;
  id?: string | null;
}): Promise<Offer[]> {
  const inventoryType = filter?.inventoryType ?? null;
  const id = filter?.id ?? null;
  const rows = await sql`
    SELECT
      o.id,
      o.product_id,
      o.variant_id,
      o.sellable_variant_id,
      o.consumer_price,
      o.status,
      o.created_at,
      variant_plant.name AS variant_plant_name,
      pv.size_label AS plant_size_label,
      pot.name AS pot_name,
      ps.size_label AS pot_size_label,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'scope', a.scope,
              'partnerLocationId', a.partner_location_id
            )
            ORDER BY a.scope ASC, a.partner_location_id ASC NULLS FIRST
          )
          FROM offer_availabilities a
          WHERE a.offer_id = o.id
        ),
        '[]'::jsonb
      ) AS availabilities
    FROM offers o
    LEFT JOIN plants product ON product.id = o.product_id
    LEFT JOIN sellable_variants sv ON sv.id = o.sellable_variant_id
    LEFT JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    LEFT JOIN plants variant_plant ON variant_plant.id = pv.plant_id
    LEFT JOIN pot_sizes ps ON ps.id = sv.pot_size_id
    LEFT JOIN pots pot ON pot.id = ps.pot_id
    WHERE (${inventoryType}::text IS NULL OR product.inventory_type = ${inventoryType})
      AND (${id}::text IS NULL OR o.id = ${id})
    ORDER BY o.created_at ASC
  `;
  return (rows as OfferRow[]).map(mapOfferRow);
}

export async function readOffers(filter?: {
  inventoryType?: InventoryType;
}): Promise<Offer[]> {
  return queryOffers({ inventoryType: filter?.inventoryType ?? null });
}

export async function getOfferById(id: string): Promise<Offer | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await queryOffers({ id: trimmed });
  return rows[0];
}

async function readVariantPlant(sellableVariantId: string): Promise<VariantPlant | null> {
  const rows = await sql`
    SELECT pv.plant_id, p.inventory_type
    FROM sellable_variants sv
    INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    INNER JOIN plants p ON p.id = pv.plant_id
    WHERE sv.id = ${sellableVariantId}::uuid
    LIMIT 1
  `;
  const row = (rows as { plant_id: string; inventory_type: string }[])[0];
  if (!row) return null;
  return { plantId: row.plant_id, inventoryType: row.inventory_type };
}

function offerPriceStatusUpdate(offer: {
  id: string;
  productId: string;
  consumerPrice: number;
  status: OfferStatus;
}) {
  return sql`
    WITH old AS (
      SELECT id, consumer_price
      FROM offers
      WHERE id = ${offer.id}
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
}

function replaceAvailabilities(offerId: string, availabilities: OfferAvailability[]) {
  const payload = JSON.stringify(availabilities);
  return [
    sql`
      DELETE FROM offer_availabilities AS a
      WHERE a.offer_id = ${offerId}
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${payload}::jsonb) AS item
          WHERE item->>'scope' = a.scope
            AND (
              (
                a.scope = 'catalog'
                AND a.partner_location_id IS NULL
                AND NULLIF(item->>'partnerLocationId', '') IS NULL
              )
              OR (
                a.scope = 'partner_location'
                AND a.partner_location_id = NULLIF(item->>'partnerLocationId', '')
              )
            )
        )
    `,
    sql`
      INSERT INTO offer_availabilities (offer_id, scope, partner_location_id)
      SELECT
        ${offerId},
        item->>'scope',
        NULLIF(item->>'partnerLocationId', '')
      FROM jsonb_array_elements(${payload}::jsonb) AS item
      ON CONFLICT ON CONSTRAINT offer_availabilities_offer_scope_location_key DO NOTHING
    `,
  ];
}

/** Flower Offers stay outside Sellable Variants and have no availability rows. */
export async function appendFlowerOffer(input: NewFlowerOfferInput): Promise<Offer> {
  const productId = input.productId.trim();
  const status: OfferStatus = input.status === "inactive" ? "inactive" : "active";
  assertConsumerPrice(input.consumerPrice);
  const createdAt = new Date().toISOString();
  const id = randomUUID();

  await sql`
    INSERT INTO offers (
      id, product_id, variant_id, consumer_price, status, created_at
    )
    VALUES (
      ${id},
      ${productId},
      NULL,
      ${input.consumerPrice},
      ${status},
      ${createdAt}::timestamptz
    )
  `;

  const offer = await getOfferById(id);
  if (!offer) throw new OfferWriteError("not_found", "Offer not found");
  return offer;
}

export async function createOrReusePlantOffer(input: {
  sellableVariantId: string;
  consumerPrice: number;
  status?: OfferStatus;
  availabilities?: unknown;
  productId?: string;
  inventoryType?: InventoryType;
}): Promise<{ offer: Offer; reused: boolean }> {
  const sellableVariantId = input.sellableVariantId.trim();
  if (!sellableVariantId) {
    throw new OfferWriteError("invalid", OFFER_VARIANT_REQUIRED);
  }
  assertConsumerPrice(input.consumerPrice);
  const status: OfferStatus = input.status === "inactive" ? "inactive" : "active";
  if (input.status !== undefined) assertStatus(input.status);
  const availabilities = parseOfferAvailabilities(input.availabilities);
  await assertLocationsExist(availabilities);

  const variant = await readVariantPlant(sellableVariantId);
  if (!variant) throw new OfferWriteError("not_found", OFFER_VARIANT_NOT_FOUND);
  if (variant.inventoryType === "flowers") {
    throw new OfferWriteError("invalid", OFFER_FLOWER_VARIANT_REJECTED);
  }
  if (input.inventoryType && variant.inventoryType !== input.inventoryType) {
    throw new OfferWriteError("invalid", OFFER_INVENTORY_CONFLICT);
  }
  if (input.productId !== undefined && input.productId.trim() !== variant.plantId) {
    throw new OfferWriteError("invalid", OFFER_PRODUCT_CONFLICT);
  }

  const offerId = randomUUID();
  let reused = false;
  try {
    const rows = await sql`
      SELECT offer_id, reused
      FROM apply_plant_offer(
        ${offerId},
        ${sellableVariantId}::uuid,
        ${input.consumerPrice}::numeric,
        ${status},
        ${JSON.stringify(availabilities)}::jsonb
      )
    `;
    const row = (rows as { offer_id: string; reused: boolean }[])[0];
    if (!row?.offer_id) throw new OfferWriteError("not_found", "Offer not found");
    reused = row.reused === true || String(row.reused) === "t" || String(row.reused) === "true";
    const offer = await getOfferById(row.offer_id);
    if (!offer) throw new OfferWriteError("not_found", "Offer not found");
    return { offer, reused };
  } catch (error) {
    if (error instanceof OfferWriteError) throw error;
    throwMapped(error);
  }
}

export async function updateOffer(
  id: string,
  input: UpdateOfferInput,
): Promise<Offer | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;

  const existing = await getOfferById(trimmed);
  if (!existing) return undefined;

  if (input.consumerPrice !== undefined) assertConsumerPrice(input.consumerPrice);
  if (input.status !== undefined) assertStatus(input.status);

  const productId =
    input.productId !== undefined ? input.productId.trim() : existing.productId;
  const consumerPrice = input.consumerPrice ?? existing.consumerPrice;
  const status: OfferStatus = input.status ?? existing.status;
  const next = {
    id: trimmed,
    productId,
    consumerPrice,
    status,
  };

  if (existing.sellableVariantId) {
    if (input.productId !== undefined && productId !== existing.productId) {
      throw new OfferWriteError("invalid", OFFER_PRODUCT_CONFLICT);
    }
    if (
      input.sellableVariantId !== undefined &&
      input.sellableVariantId.trim() !== existing.sellableVariantId
    ) {
      throw new OfferWriteError("invalid", OFFER_VARIANT_IMMUTABLE);
    }
    const availabilities =
      input.availabilities !== undefined
        ? parseOfferAvailabilities(input.availabilities)
        : undefined;
    if (availabilities) await assertLocationsExist(availabilities);

    try {
      await sql.transaction([
        sql`
          SELECT id
          FROM sellable_variants
          WHERE id = ${existing.sellableVariantId}::uuid
          FOR UPDATE
        `,
        ...(availabilities ? replaceAvailabilities(trimmed, availabilities) : []),
        offerPriceStatusUpdate(next),
      ]);
    } catch (error) {
      if (error instanceof OfferWriteError) throw error;
      throwMapped(error);
    }
    return getOfferById(trimmed);
  }

  if (input.sellableVariantId !== undefined || input.availabilities !== undefined) {
    throw new OfferWriteError("invalid", OFFER_LEGACY_VARIANT_REJECTED);
  }

  try {
    await offerPriceStatusUpdate(next);
  } catch (error) {
    if (error instanceof OfferWriteError) throw error;
    throwMapped(error);
  }
  return getOfferById(trimmed);
}

/**
 * Sellable Variant = one Plant Size plus an optional Catalog Pot.
 * No selling price and no inventory. Cost is derived, not stored.
 */

import { revalidateCatalogShopCache } from "@/lib/catalogShopCache";
import { sql } from "@/lib/db";
import { isDatabaseUuid } from "@/lib/potStorage";
import { getPlantByIdAsync } from "@/lib/plantStorage";
import { isPlantSizeLabel, type PlantSizeLabel } from "@/lib/plantSizes";
import {
  deriveSellableVariantSupplierCost,
  type DerivedSupplierCost,
} from "@/lib/sellableVariantCost";

export type SellableVariantWriteCode =
  | "not_found"
  | "plant_not_found"
  | "flower_plant"
  | "invalid_plant_size"
  | "inactive_pot"
  | "duplicate"
  | "active_offer"
  | "in_use";

export const SELLABLE_VARIANT_DUPLICATE_MESSAGE = "This plant size already has that pot";
export const SELLABLE_VARIANT_INACTIVE_POT_MESSAGE = "Choose an active pot";
export const SELLABLE_VARIANT_ACTIVE_OFFER_MESSAGE =
  "This variant is used by an active offer. Create a new variant for a different configuration.";

export class SellableVariantWriteError extends Error {
  readonly code: SellableVariantWriteCode;
  readonly existingSellableVariantId?: string;

  constructor(
    code: SellableVariantWriteCode,
    message: string,
    existingSellableVariantId?: string,
  ) {
    super(message);
    this.name = "SellableVariantWriteError";
    this.code = code;
    this.existingSellableVariantId = existingSellableVariantId;
  }
}

export type SellableVariant = DerivedSupplierCost & {
  sellableVariantId: string;
  plantId: string;
  plantSizeId: string;
  plantSizeLabel: PlantSizeLabel;
  potId: string | null;
  potName: string | null;
  potDiameterCm: number | null;
  /** True when an Offer with status active points at this variant. */
  referencedByActiveOffer: boolean;
};

/** Admin Offer picker. Selling price and supplier cost are not included. */
export type SellableVariantChoice = {
  sellableVariantId: string;
  plantId: string;
  plantName: string;
  plantSizeLabel: string;
  potName: string | null;
  potDiameterCm: number | null;
};

type SellableVariantRow = {
  id: string;
  plant_id: string;
  plant_variant_id: string;
  plant_size_label: string;
  plant_supplier_price: string | number | null;
  pot_id: string | null;
  pot_name: string | null;
  pot_diameter_cm: string | number | null;
  pot_supplier_price: string | number | null;
  referenced_by_active_offer: boolean | null;
};

function finiteNumber(value: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function duplicateSellableVariantError(existingSellableVariantId?: string): SellableVariantWriteError {
  return new SellableVariantWriteError(
    "duplicate",
    SELLABLE_VARIANT_DUPLICATE_MESSAGE,
    existingSellableVariantId,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && String(error.code) === "23505";
}

function mapRow(row: SellableVariantRow): SellableVariant {
  const plantSizeLabel = row.plant_size_label.trim();
  if (!isPlantSizeLabel(plantSizeLabel)) {
    throw new SellableVariantWriteError(
      "invalid_plant_size",
      "Plant size must be S, M, or L",
    );
  }
  const potId = row.pot_id;
  const cost = deriveSellableVariantSupplierCost({
    plantSupplierCost: finiteNumber(row.plant_supplier_price),
    potId,
    potSupplierCost: finiteNumber(row.pot_supplier_price),
  });
  return {
    sellableVariantId: row.id,
    plantId: row.plant_id,
    plantSizeId: row.plant_variant_id,
    plantSizeLabel,
    potId,
    potName: row.pot_name?.trim() || null,
    potDiameterCm: finiteNumber(row.pot_diameter_cm),
    referencedByActiveOffer: row.referenced_by_active_offer === true,
    ...cost,
  };
}

export function sellableVariantWriteHttp(error: SellableVariantWriteError): {
  status: number;
  error: string;
} {
  const status =
    error.code === "in_use" || error.code === "duplicate" || error.code === "active_offer"
      ? 409
      : error.code === "not_found" || error.code === "plant_not_found"
        ? 404
        : 400;
  return { status, error: error.message };
}

export function sellableVariantErrorResponse(error: SellableVariantWriteError): {
  status: number;
  body: { error: string; existingSellableVariantId?: string };
} {
  const http = sellableVariantWriteHttp(error);
  return {
    status: http.status,
    body: {
      error: http.error,
      ...(error.existingSellableVariantId
        ? { existingSellableVariantId: error.existingSellableVariantId }
        : {}),
    },
  };
}

async function assertPlant(plantId: string): Promise<void> {
  const plant = await getPlantByIdAsync(plantId);
  if (!plant) {
    throw new SellableVariantWriteError("plant_not_found", "Plant not found");
  }
  if (plant.inventoryType === "flowers") {
    throw new SellableVariantWriteError("flower_plant", "Flower plants cannot have variants");
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error === "object" && error && "code" in error && String(error.code) === "23503") {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /foreign key|violates foreign key constraint/i.test(message);
}

export async function readSellableVariantChoices(): Promise<SellableVariantChoice[]> {
  const rows = await sql`
    SELECT
      sv.id,
      pv.plant_id,
      pl.name AS plant_name,
      pv.size_label AS plant_size_label,
      pot.name AS pot_name,
      pot.diameter_cm AS pot_diameter_cm
    FROM sellable_variants sv
    INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    INNER JOIN plants pl ON pl.id = pv.plant_id
    LEFT JOIN pots pot ON pot.id = sv.pot_id
    WHERE pl.inventory_type = 'plants'
    ORDER BY pl.name ASC, pv.size_label ASC, pot.name ASC NULLS FIRST, sv.id ASC
  `;
  return (rows as {
    id: string;
    plant_id: string;
    plant_name: string;
    plant_size_label: string;
    pot_name: string | null;
    pot_diameter_cm: string | number | null;
  }[]).map((row) => ({
    sellableVariantId: row.id,
    plantId: row.plant_id,
    plantName: row.plant_name.trim(),
    plantSizeLabel: row.plant_size_label.trim(),
    potName: row.pot_name?.trim() || null,
    potDiameterCm: finiteNumber(row.pot_diameter_cm),
  }));
}

export async function readSellableVariantsForPlant(plantId: string): Promise<SellableVariant[]> {
  const trimmed = plantId.trim();
  if (!trimmed) return [];
  await assertPlant(trimmed);
  const rows = await sql`
    SELECT
      sv.id,
      pv.plant_id,
      sv.plant_variant_id,
      pv.size_label AS plant_size_label,
      p.supplier_price AS plant_supplier_price,
      sv.pot_id,
      pot.name AS pot_name,
      pot.diameter_cm AS pot_diameter_cm,
      pot.supplier_price AS pot_supplier_price,
      EXISTS (
        SELECT 1
        FROM offers o
        WHERE o.sellable_variant_id = sv.id
          AND o.status = 'active'
      ) AS referenced_by_active_offer
    FROM sellable_variants sv
    INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    INNER JOIN plants p ON p.id = pv.plant_id
    LEFT JOIN pots pot ON pot.id = sv.pot_id
    WHERE pv.plant_id = ${trimmed}
    ORDER BY pv.size_label ASC, pot.name ASC NULLS FIRST, sv.id ASC
  `;
  return (rows as SellableVariantRow[]).map(mapRow);
}

function parseOptionalPotId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" && isDatabaseUuid(value)) return value.trim();
  throw new SellableVariantWriteError("not_found", "Pot not found");
}

async function readMappedSellableVariant(id: string): Promise<SellableVariant> {
  const rows = await sql`
    SELECT
      sv.id,
      pv.plant_id,
      sv.plant_variant_id,
      pv.size_label AS plant_size_label,
      p.supplier_price AS plant_supplier_price,
      sv.pot_id,
      pot.name AS pot_name,
      pot.diameter_cm AS pot_diameter_cm,
      pot.supplier_price AS pot_supplier_price,
      EXISTS (
        SELECT 1
        FROM offers o
        WHERE o.sellable_variant_id = sv.id
          AND o.status = 'active'
      ) AS referenced_by_active_offer
    FROM sellable_variants sv
    INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    INNER JOIN plants p ON p.id = pv.plant_id
    LEFT JOIN pots pot ON pot.id = sv.pot_id
    WHERE sv.id = ${id}::uuid
    LIMIT 1
  `;
  const row = (rows as SellableVariantRow[])[0];
  if (!row) throw new SellableVariantWriteError("not_found", "Variant not found");
  return mapRow(row);
}

export async function createSellableVariant(input: {
  plantId: string;
  plantSizeId: unknown;
  potId: unknown;
}): Promise<SellableVariant> {
  const plantId = input.plantId.trim();
  await assertPlant(plantId);

  if (typeof input.plantSizeId !== "string" || !isDatabaseUuid(input.plantSizeId)) {
    throw new SellableVariantWriteError("not_found", "Plant size not found");
  }
  const plantSizeId = input.plantSizeId.trim();
  const potId = parseOptionalPotId(input.potId);

  const sizeRows = await sql`
    SELECT id, plant_id, size_label
    FROM plant_variants
    WHERE id = ${plantSizeId}::uuid
    LIMIT 1
  `;
  const size = (sizeRows as { id: string; plant_id: string; size_label: string | null }[])[0];
  if (!size || size.plant_id !== plantId) {
    throw new SellableVariantWriteError("not_found", "Plant size not found");
  }
  const sizeLabel = size.size_label?.trim() ?? "";
  if (!isPlantSizeLabel(sizeLabel)) {
    throw new SellableVariantWriteError("invalid_plant_size", "Plant size must be S, M, or L");
  }

  if (potId) {
    const potRows = await sql`
      SELECT id, active FROM pots WHERE id = ${potId}::uuid LIMIT 1
    `;
    const pot = (potRows as { id: string; active: boolean | null }[])[0];
    if (!pot) {
      throw new SellableVariantWriteError("not_found", "Pot not found");
    }
    if (pot.active === false) {
      throw new SellableVariantWriteError("inactive_pot", SELLABLE_VARIANT_INACTIVE_POT_MESSAGE);
    }
  }

  try {
    const inserted = await sql`
      INSERT INTO sellable_variants (plant_variant_id, pot_id)
      VALUES (${plantSizeId}::uuid, ${potId}::uuid)
      RETURNING id
    `;
    const id = (inserted as { id: string }[])[0]?.id;
    if (!id) throw new SellableVariantWriteError("not_found", "Variant not found");
    await revalidateCatalogShopCache();
    return readMappedSellableVariant(id);
  } catch (error) {
    if (error instanceof SellableVariantWriteError) throw error;
    if (isUniqueViolation(error)) {
      const existing = await sql`
        SELECT id::text AS id
        FROM sellable_variants
        WHERE plant_variant_id = ${plantSizeId}::uuid
          AND pot_id IS NOT DISTINCT FROM ${potId}::uuid
        LIMIT 1
      `;
      throw duplicateSellableVariantError((existing as { id: string }[])[0]?.id);
    }
    throw error;
  }
}

/**
 * Change only the optional Catalog Pot on this row.
 * The Sellable Variant id and Plant Size stay the same.
 * An active Offer locks the pot. Create a new variant for a different pot.
 * Inactive offers, orders, and placement segments do not lock it.
 * Order lines and placement segments keep their own pot snapshots.
 * This does not change plant or pot inventory and does not rewrite a POS pot.
 */
async function sellableVariantHasActiveOffer(sellableVariantId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 AS found
    FROM offers
    WHERE sellable_variant_id = ${sellableVariantId}::uuid
      AND status = 'active'
    LIMIT 1
  `;
  return (rows as unknown[]).length > 0;
}

function activeOfferLockError(): SellableVariantWriteError {
  return new SellableVariantWriteError("active_offer", SELLABLE_VARIANT_ACTIVE_OFFER_MESSAGE);
}

export async function updateSellableVariantPot(input: {
  plantId: string;
  sellableVariantId: string;
  potId: unknown;
}): Promise<SellableVariant> {
  const plantId = input.plantId.trim();
  const sellableVariantId = input.sellableVariantId.trim();
  await assertPlant(plantId);
  if (!isDatabaseUuid(sellableVariantId)) {
    throw new SellableVariantWriteError("not_found", "Variant not found");
  }
  const potId = parseOptionalPotId(input.potId);

  const currentRows = await sql`
    SELECT sv.id, sv.plant_variant_id, sv.pot_id, pv.plant_id
    FROM sellable_variants sv
    INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    WHERE sv.id = ${sellableVariantId}::uuid
    LIMIT 1
  `;
  const current = (
    currentRows as {
      id: string;
      plant_variant_id: string;
      pot_id: string | null;
      plant_id: string;
    }[]
  )[0];
  if (!current || current.plant_id !== plantId) {
    throw new SellableVariantWriteError("not_found", "Variant not found");
  }
  if ((current.pot_id ?? null) === potId) {
    return readMappedSellableVariant(current.id);
  }
  if (await sellableVariantHasActiveOffer(current.id)) {
    throw activeOfferLockError();
  }

  if (potId) {
    const potRows = await sql`
      SELECT id, active FROM pots WHERE id = ${potId}::uuid LIMIT 1
    `;
    const pot = (potRows as { id: string; active: boolean | null }[])[0];
    if (!pot) throw new SellableVariantWriteError("not_found", "Pot not found");
    if (pot.active === false) {
      throw new SellableVariantWriteError("inactive_pot", SELLABLE_VARIANT_INACTIVE_POT_MESSAGE);
    }
  }

  const duplicates = await sql`
    SELECT id::text AS id
    FROM sellable_variants
    WHERE plant_variant_id = ${current.plant_variant_id}::uuid
      AND pot_id IS NOT DISTINCT FROM ${potId}::uuid
      AND id <> ${current.id}::uuid
    LIMIT 1
  `;
  const duplicate = (duplicates as { id: string }[])[0];
  if (duplicate) {
    throw duplicateSellableVariantError(duplicate.id);
  }

  try {
    const updated = await sql`
      UPDATE sellable_variants
      SET
        pot_id = ${potId}::uuid,
        updated_at = now()
      WHERE id = ${current.id}::uuid
        AND plant_variant_id = ${current.plant_variant_id}::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM offers o
          WHERE o.sellable_variant_id = sellable_variants.id
            AND o.status = 'active'
        )
      RETURNING id
    `;
    const id = (updated as { id: string }[])[0]?.id;
    if (!id) {
      if (await sellableVariantHasActiveOffer(current.id)) throw activeOfferLockError();
      throw new SellableVariantWriteError("not_found", "Variant not found");
    }
    await revalidateCatalogShopCache();
    return readMappedSellableVariant(id);
  } catch (error) {
    if (error instanceof SellableVariantWriteError) throw error;
    if (isUniqueViolation(error)) {
      const existing = await sql`
        SELECT id::text AS id
        FROM sellable_variants
        WHERE plant_variant_id = ${current.plant_variant_id}::uuid
          AND pot_id IS NOT DISTINCT FROM ${potId}::uuid
          AND id <> ${current.id}::uuid
        LIMIT 1
      `;
      throw duplicateSellableVariantError((existing as { id: string }[])[0]?.id);
    }
    throw error;
  }
}

export async function deleteSellableVariant(input: {
  plantId: string;
  sellableVariantId: string;
}): Promise<void> {
  const plantId = input.plantId.trim();
  const sellableVariantId = input.sellableVariantId.trim();
  if (!plantId) {
    throw new SellableVariantWriteError("plant_not_found", "Plant not found");
  }
  if (!isDatabaseUuid(sellableVariantId)) {
    throw new SellableVariantWriteError("not_found", "Variant not found");
  }
  try {
    const rows = await sql`
      DELETE FROM sellable_variants sv
      USING plant_variants pv
      WHERE sv.id = ${sellableVariantId}::uuid
        AND sv.plant_variant_id = pv.id
        AND pv.plant_id = ${plantId}
      RETURNING sv.id
    `;
    if ((rows as { id: string }[]).length === 0) {
      throw new SellableVariantWriteError("not_found", "Variant not found");
    }
  } catch (error) {
    if (error instanceof SellableVariantWriteError) throw error;
    if (isForeignKeyViolation(error)) {
      throw new SellableVariantWriteError(
        "in_use",
        "This variant is in use and cannot be deleted",
      );
    }
    throw error;
  }
  await revalidateCatalogShopCache();
}

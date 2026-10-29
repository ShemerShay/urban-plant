/**
 * Plant sizes (table: plant_variants): physical configuration.
 * Customer selling price lives on the Offer.
 * New and changed size labels must be S, M, or L.
 * An existing label outside that set can be loaded and saved unchanged.
 * No database check is added: historical rows may keep other labels.
 * POS occupancy still keys off variant id / size fields only.
 */

import { sql } from "@/lib/db";
import { applyInventoryDelta, getInventoryQuantities } from "@/lib/inventoryStorage";
import { isPlantSizeLabel } from "@/lib/plantSizes";
import { getPlantByIdAsync } from "@/lib/plantStorage";

export type PlantVariant = {
  id: string;
  plantId: string;
  sizeLabel?: string;
  nurseryPotDiameterCm?: number;
};

export type PlantVariantWithQuantity = PlantVariant & {
  quantity: number;
};

export type PlantVariantWriteCode =
  | "plant_not_found"
  | "not_found"
  | "flower_plant"
  | "identity_required"
  | "invalid_size_label"
  | "invalid_quantity"
  | "duplicate_size_label"
  | "plant_id_immutable"
  | "in_use";

/** History note for Admin quantity edits and opening stock. */
export const PLANT_SIZE_ADMIN_QUANTITY_NOTE = "Admin quantity";

export const PLANT_SIZE_QUANTITY_INVALID =
  "Quantity must be a whole number of 0 or more";

export class PlantVariantWriteError extends Error {
  readonly code: PlantVariantWriteCode;

  constructor(code: PlantVariantWriteCode, message: string) {
    super(message);
    this.name = "PlantVariantWriteError";
    this.code = code;
  }
}

type PlantVariantRow = {
  id: string;
  plant_id: string;
  size_label: string | null;
  nursery_pot_diameter_cm: string | number | null;
};

function mapDiameter(value: string | number | null): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function mapPlantVariantRow(row: PlantVariantRow): PlantVariant {
  const sizeLabel =
    typeof row.size_label === "string" && row.size_label.trim()
      ? row.size_label.trim()
      : undefined;
  const diameter = mapDiameter(row.nursery_pot_diameter_cm);
  return {
    id: row.id,
    plantId: row.plant_id,
    ...(sizeLabel ? { sizeLabel } : {}),
    ...(diameter != null ? { nurseryPotDiameterCm: diameter } : {}),
  };
}

export function plantVariantOptionLabel(variant: PlantVariant): string {
  const size = variant.sizeLabel?.trim();
  const cm = variant.nurseryPotDiameterCm;
  if (size && cm != null) return `${size} (${cm} cm)`;
  if (size) return size;
  if (cm != null) return `${cm} cm`;
  return "Size";
}

export async function getPlantVariantById(id: string): Promise<PlantVariant | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT id, plant_id, size_label, nursery_pot_diameter_cm
    FROM plant_variants
    WHERE id = ${trimmed}::uuid
    LIMIT 1
  `;
  const row = (rows as PlantVariantRow[])[0];
  return row ? mapPlantVariantRow(row) : undefined;
}

export async function readPlantVariants(): Promise<PlantVariant[]> {
  const rows = await sql`
    SELECT id, plant_id, size_label, nursery_pot_diameter_cm
    FROM plant_variants
    ORDER BY plant_id ASC, size_label ASC NULLS LAST, id ASC
  `;
  return (rows as PlantVariantRow[]).map(mapPlantVariantRow);
}

export async function readPlantVariantsByPlantId(plantId: string): Promise<PlantVariant[]> {
  const trimmed = plantId.trim();
  if (!trimmed) return [];
  const rows = await sql`
    SELECT id, plant_id, size_label, nursery_pot_diameter_cm
    FROM plant_variants
    WHERE plant_id = ${trimmed}
    ORDER BY size_label ASC NULLS LAST, id ASC
  `;
  return (rows as PlantVariantRow[]).map(mapPlantVariantRow);
}

export async function readPlantVariantsWithQuantity(
  plantId: string,
): Promise<PlantVariantWithQuantity[]> {
  const variants = await readPlantVariantsByPlantId(plantId);
  const quantities = await getInventoryQuantities(variants.map((variant) => variant.id));
  return variants.map((variant) => ({
    ...variant,
    quantity: quantities.get(variant.id) ?? 0,
  }));
}

function trimSizeLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new PlantVariantWriteError("identity_required", "sizeLabel must be a string");
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseDiameter(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PlantVariantWriteError(
      "identity_required",
      "nurseryPotDiameterCm must be a positive number",
    );
  }
  return n;
}

function assertVariantIdentity(sizeLabel: string | null, diameter: number | null): void {
  if (!sizeLabel && diameter == null) {
    throw new PlantVariantWriteError(
      "identity_required",
      "A variant needs a size label or a nursery pot diameter",
    );
  }
}

/**
 * Create requires S/M/L.
 * Update allows the stored label to stay, including a legacy label.
 * A changed label must be S, M, or L. Labels are not rewritten automatically.
 */
function assertCanonicalPlantSize(
  sizeLabel: string | null,
  previous: string | null | undefined,
): void {
  if (previous !== undefined && sizeLabel === previous) return;
  if (sizeLabel !== null && isPlantSizeLabel(sizeLabel)) return;
  throw new PlantVariantWriteError("invalid_size_label", "sizeLabel must be S, M, or L");
}

async function assertPlantAcceptsVariants(plantId: string): Promise<void> {
  const plant = await getPlantByIdAsync(plantId);
  if (!plant) {
    throw new PlantVariantWriteError("plant_not_found", "Plant not found");
  }
  if (plant.inventoryType === "flowers") {
    throw new PlantVariantWriteError(
      "flower_plant",
      "Flower plants cannot have plant sizes",
    );
  }
}

async function assertUniqueSizeLabel(input: {
  plantId: string;
  sizeLabel: string | null;
  excludeId?: string;
}): Promise<void> {
  if (!input.sizeLabel) return;
  const rows = input.excludeId
    ? await sql`
        SELECT id
        FROM plant_variants
        WHERE plant_id = ${input.plantId}
          AND size_label IS NOT NULL
          AND trim(size_label) = ${input.sizeLabel}
          AND id <> ${input.excludeId}::uuid
        LIMIT 1
      `
    : await sql`
        SELECT id
        FROM plant_variants
        WHERE plant_id = ${input.plantId}
          AND size_label IS NOT NULL
          AND trim(size_label) = ${input.sizeLabel}
        LIMIT 1
      `;
  if ((rows as { id: string }[]).length > 0) {
    throw new PlantVariantWriteError(
      "duplicate_size_label",
      "This plant already has a variant with that size label",
    );
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error === "object" && error && "code" in error && String(error.code) === "23503") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /foreign key|violates foreign key constraint/i.test(message);
}

export const PLANT_SIZE_DELETE_BLOCKED_ORDER =
  "Cannot delete this size: referenced by a historical order";
export const PLANT_SIZE_DELETE_BLOCKED_POS =
  "Cannot delete this size: used by POS/placement";
export const PLANT_SIZE_DELETE_BLOCKED_SELLABLE =
  "Cannot delete this size: used by a Sellable Variant";
export const PLANT_SIZE_DELETE_BLOCKED_INVENTORY =
  "Cannot delete this size: has inventory/history";
export const PLANT_SIZE_DELETE_BLOCKED_IN_USE =
  "This size is in use and cannot be deleted";

async function plantSizeDeleteBlockMessage(variantId: string): Promise<string | null> {
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM order_items WHERE plant_variant_id = ${variantId}::uuid) AS order_items,
      (SELECT count(*)::int FROM pos_spots WHERE plant_variant_id = ${variantId}::uuid) AS pos_spots,
      (SELECT count(*)::int FROM placement_cycles WHERE plant_variant_id = ${variantId}::uuid) AS placement_cycles,
      (SELECT count(*)::int FROM sellable_variants WHERE plant_variant_id = ${variantId}::uuid) AS sellable_variants,
      (SELECT count(*)::int FROM inventory WHERE variant_id = ${variantId}::uuid) AS inventory,
      (SELECT count(*)::int FROM inventory_history WHERE variant_id = ${variantId}::uuid) AS inventory_history,
      (SELECT count(*)::int FROM catalog_stock_holds WHERE plant_variant_id = ${variantId}::uuid) AS catalog_holds
  `;
  const counts = (
    rows as {
      order_items: number;
      pos_spots: number;
      placement_cycles: number;
      sellable_variants: number;
      inventory: number;
      inventory_history: number;
      catalog_holds: number;
    }[]
  )[0];
  if (!counts) return null;
  if (counts.order_items > 0) return PLANT_SIZE_DELETE_BLOCKED_ORDER;
  if (counts.pos_spots > 0 || counts.placement_cycles > 0) return PLANT_SIZE_DELETE_BLOCKED_POS;
  if (counts.sellable_variants > 0) return PLANT_SIZE_DELETE_BLOCKED_SELLABLE;
  if (counts.inventory > 0 || counts.inventory_history > 0 || counts.catalog_holds > 0) {
    return PLANT_SIZE_DELETE_BLOCKED_INVENTORY;
  }
  return null;
}

export async function createPlantVariant(input: {
  plantId: string;
  sizeLabel?: unknown;
  nurseryPotDiameterCm?: unknown;
}): Promise<PlantVariant> {
  const plantId = input.plantId.trim();
  if (!plantId) {
    throw new PlantVariantWriteError("plant_not_found", "Plant not found");
  }
  await assertPlantAcceptsVariants(plantId);
  const sizeLabel = trimSizeLabel(input.sizeLabel);
  const diameter = parseDiameter(input.nurseryPotDiameterCm);
  assertVariantIdentity(sizeLabel, diameter);
  assertCanonicalPlantSize(sizeLabel, undefined);
  await assertUniqueSizeLabel({ plantId, sizeLabel });

  const rows = await sql`
    INSERT INTO plant_variants (plant_id, size_label, nursery_pot_diameter_cm)
    VALUES (
      ${plantId},
      ${sizeLabel},
      ${diameter}
    )
    RETURNING id, plant_id, size_label, nursery_pot_diameter_cm
  `;
  const row = (rows as PlantVariantRow[])[0];
  if (!row) throw new Error("Could not create variant");
  return mapPlantVariantRow(row);
}

/** Missing quantity is 0. A present value must be a whole number of 0 or more. */
export function parsePlantSizeOpeningQuantity(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  throw new PlantVariantWriteError("invalid_quantity", PLANT_SIZE_QUANTITY_INVALID);
}

/**
 * Create a plant size, then initialize central stock when quantity is above 0.
 * Quantity 0 leaves no inventory row and no history.
 * Opening stock goes through applyInventoryDelta so history stays append-only.
 * This path does not set nursery pot diameter.
 */
export async function createPlantSizeWithOpeningQuantity(input: {
  plantId: string;
  sizeLabel?: unknown;
  quantity: number;
}): Promise<{ variant: PlantVariant; quantity: number }> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new PlantVariantWriteError("invalid_quantity", PLANT_SIZE_QUANTITY_INVALID);
  }
  const variant = await createPlantVariant({
    plantId: input.plantId,
    sizeLabel: input.sizeLabel,
  });
  if (input.quantity === 0) return { variant, quantity: 0 };
  try {
    const balance = await applyInventoryDelta({
      variantId: variant.id,
      delta: input.quantity,
      note: PLANT_SIZE_ADMIN_QUANTITY_NOTE,
    });
    return { variant, quantity: balance.quantity };
  } catch (error) {
    try {
      await deletePlantVariant({ plantId: variant.plantId, variantId: variant.id });
    } catch {
      // The inventory error is the one to surface. Cleanup can fail if a row was committed.
    }
    throw error;
  }
}

export async function updatePlantVariant(input: {
  plantId: string;
  variantId: string;
  sizeLabel?: unknown;
  nurseryPotDiameterCm?: unknown;
  plantIdFromBody?: unknown;
}): Promise<PlantVariant> {
  const plantId = input.plantId.trim();
  const variantId = input.variantId.trim();
  if (!plantId) throw new PlantVariantWriteError("plant_not_found", "Plant not found");
  if (!variantId) throw new PlantVariantWriteError("not_found", "Variant not found");
  if (input.plantIdFromBody !== undefined && input.plantIdFromBody !== null) {
    const nextPlantId =
      typeof input.plantIdFromBody === "string" ? input.plantIdFromBody.trim() : "";
    if (nextPlantId && nextPlantId !== plantId) {
      throw new PlantVariantWriteError("plant_id_immutable", "plantId cannot be changed");
    }
  }
  await assertPlantAcceptsVariants(plantId);

  const existing = await getPlantVariantById(variantId);
  if (!existing || existing.plantId !== plantId) {
    throw new PlantVariantWriteError("not_found", "Variant not found");
  }

  const previousSize = existing.sizeLabel ?? null;
  const sizeLabel =
    input.sizeLabel === undefined ? previousSize : trimSizeLabel(input.sizeLabel);
  const diameter =
    input.nurseryPotDiameterCm === undefined
      ? existing.nurseryPotDiameterCm ?? null
      : parseDiameter(input.nurseryPotDiameterCm);
  assertVariantIdentity(sizeLabel, diameter);
  assertCanonicalPlantSize(sizeLabel, previousSize);
  await assertUniqueSizeLabel({ plantId, sizeLabel, excludeId: variantId });

  const rows = await sql`
    UPDATE plant_variants
    SET
      size_label = ${sizeLabel},
      nursery_pot_diameter_cm = ${diameter}
    WHERE id = ${variantId}::uuid AND plant_id = ${plantId}
    RETURNING id, plant_id, size_label, nursery_pot_diameter_cm
  `;
  const row = (rows as PlantVariantRow[])[0];
  if (!row) throw new PlantVariantWriteError("not_found", "Variant not found");
  return mapPlantVariantRow(row);
}

export async function deletePlantVariant(input: {
  plantId: string;
  variantId: string;
}): Promise<void> {
  const plantId = input.plantId.trim();
  const variantId = input.variantId.trim();
  if (!plantId) throw new PlantVariantWriteError("plant_not_found", "Plant not found");
  if (!variantId) throw new PlantVariantWriteError("not_found", "Variant not found");

  const existing = await getPlantVariantById(variantId);
  if (!existing || existing.plantId !== plantId) {
    throw new PlantVariantWriteError("not_found", "Variant not found");
  }

  const blocked = await plantSizeDeleteBlockMessage(variantId);
  if (blocked) {
    throw new PlantVariantWriteError("in_use", blocked);
  }

  try {
    const rows = await sql`
      DELETE FROM plant_variants
      WHERE id = ${variantId}::uuid AND plant_id = ${plantId}
      RETURNING id
    `;
    if ((rows as { id: string }[]).length === 0) {
      throw new PlantVariantWriteError("not_found", "Variant not found");
    }
  } catch (error) {
    if (error instanceof PlantVariantWriteError) throw error;
    if (isForeignKeyViolation(error)) {
      throw new PlantVariantWriteError("in_use", PLANT_SIZE_DELETE_BLOCKED_IN_USE);
    }
    throw error;
  }
}

export function plantVariantWriteHttp(error: PlantVariantWriteError): {
  status: number;
  error: string;
} {
  const status =
    error.code === "in_use"
      ? 409
      : error.code === "not_found" || error.code === "plant_not_found"
        ? 404
        : 400;
  return { status, error: error.message };
}

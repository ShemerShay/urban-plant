/**
 * Plant sizes (table: plant_variants): physical configuration plus Catalog price.
 * New and changed size labels must be S, M, or L.
 * An existing label outside that set can be loaded and saved unchanged.
 * No database check is added: historical rows may keep other labels.
 * POS occupancy still keys off variant id / size fields only.
 */

import { sql } from "@/lib/db";
import { getInventoryQuantities } from "@/lib/inventoryStorage";
import { isPlantSizeLabel } from "@/lib/plantSizes";
import { getPlantByIdAsync } from "@/lib/plantStorage";

export type PlantVariant = {
  id: string;
  plantId: string;
  sizeLabel?: string;
  nurseryPotDiameterCm?: number;
  catalogPrice?: number | null;
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
  | "duplicate_size_label"
  | "invalid_catalog_price"
  | "plant_id_immutable"
  | "in_use";

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
  catalog_price?: string | number | null;
};

function mapDiameter(value: string | number | null): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function mapCatalogPrice(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function mapPlantVariantRow(row: PlantVariantRow): PlantVariant {
  const sizeLabel =
    typeof row.size_label === "string" && row.size_label.trim()
      ? row.size_label.trim()
      : undefined;
  const diameter = mapDiameter(row.nursery_pot_diameter_cm);
  const catalogPrice = mapCatalogPrice(row.catalog_price);
  return {
    id: row.id,
    plantId: row.plant_id,
    ...(sizeLabel ? { sizeLabel } : {}),
    ...(diameter != null ? { nurseryPotDiameterCm: diameter } : {}),
    catalogPrice,
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
    SELECT id, plant_id, size_label, nursery_pot_diameter_cm, catalog_price
    FROM plant_variants
    WHERE id = ${trimmed}::uuid
    LIMIT 1
  `;
  const row = (rows as PlantVariantRow[])[0];
  return row ? mapPlantVariantRow(row) : undefined;
}

export async function readPlantVariants(): Promise<PlantVariant[]> {
  const rows = await sql`
    SELECT id, plant_id, size_label, nursery_pot_diameter_cm, catalog_price
    FROM plant_variants
    ORDER BY plant_id ASC, size_label ASC NULLS LAST, id ASC
  `;
  return (rows as PlantVariantRow[]).map(mapPlantVariantRow);
}

export async function readPlantVariantsByPlantId(plantId: string): Promise<PlantVariant[]> {
  const trimmed = plantId.trim();
  if (!trimmed) return [];
  const rows = await sql`
    SELECT id, plant_id, size_label, nursery_pot_diameter_cm, catalog_price
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

export function parseCatalogPriceInput(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PlantVariantWriteError(
      "invalid_catalog_price",
      "catalogPrice must be greater than 0, or empty",
    );
  }
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) {
    throw new PlantVariantWriteError(
      "invalid_catalog_price",
      "catalogPrice must have at most 2 decimal places",
    );
  }
  return cents / 100;
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

export async function createPlantVariant(input: {
  plantId: string;
  sizeLabel?: unknown;
  nurseryPotDiameterCm?: unknown;
  catalogPrice?: unknown;
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
  const catalogPrice = parseCatalogPriceInput(input.catalogPrice);

  const rows = await sql`
    INSERT INTO plant_variants (plant_id, size_label, nursery_pot_diameter_cm, catalog_price)
    VALUES (
      ${plantId},
      ${sizeLabel},
      ${diameter},
      ${catalogPrice}
    )
    RETURNING id, plant_id, size_label, nursery_pot_diameter_cm, catalog_price
  `;
  const row = (rows as PlantVariantRow[])[0];
  if (!row) throw new Error("Could not create variant");
  return mapPlantVariantRow(row);
}

export async function updatePlantVariant(input: {
  plantId: string;
  variantId: string;
  sizeLabel?: unknown;
  nurseryPotDiameterCm?: unknown;
  catalogPrice?: unknown;
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
  const catalogPrice =
    input.catalogPrice === undefined
      ? existing.catalogPrice ?? null
      : parseCatalogPriceInput(input.catalogPrice);

  const rows = await sql`
    UPDATE plant_variants
    SET
      size_label = ${sizeLabel},
      nursery_pot_diameter_cm = ${diameter},
      catalog_price = ${catalogPrice}
    WHERE id = ${variantId}::uuid AND plant_id = ${plantId}
    RETURNING id, plant_id, size_label, nursery_pot_diameter_cm, catalog_price
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
      throw new PlantVariantWriteError(
        "in_use",
        "This variant is in use and cannot be deleted",
      );
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

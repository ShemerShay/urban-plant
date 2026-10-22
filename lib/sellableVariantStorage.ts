/**
 * Sellable Variant = one Plant Size plus an optional Pot Size.
 * No selling price and no inventory. Cost is derived, not stored.
 */

import { sql } from "@/lib/db";
import { isDatabaseUuid } from "@/lib/potStorage";
import { getPlantByIdAsync } from "@/lib/plantStorage";
import { isPlantSizeLabel, type PlantSizeLabel } from "@/lib/plantSizes";
import { isPotSizeLabel, type PotSizeLabel } from "@/lib/potSizes";
import {
  deriveSellableVariantSupplierCost,
  type DerivedSupplierCost,
} from "@/lib/sellableVariantCost";

export type SellableVariantWriteCode =
  | "not_found"
  | "plant_not_found"
  | "flower_plant"
  | "invalid_plant_size"
  | "duplicate";

export class SellableVariantWriteError extends Error {
  readonly code: SellableVariantWriteCode;

  constructor(code: SellableVariantWriteCode, message: string) {
    super(message);
    this.name = "SellableVariantWriteError";
    this.code = code;
  }
}

export type SellableVariant = DerivedSupplierCost & {
  sellableVariantId: string;
  plantId: string;
  plantSizeId: string;
  plantSizeLabel: PlantSizeLabel;
  potSizeId: string | null;
  potId: string | null;
  potName: string | null;
  potSizeLabel: PotSizeLabel | null;
};

type SellableVariantRow = {
  id: string;
  plant_id: string;
  plant_variant_id: string;
  plant_size_label: string;
  plant_supplier_price: string | number | null;
  pot_size_id: string | null;
  pot_id: string | null;
  pot_name: string | null;
  pot_size_label: string | null;
  pot_supplier_price: string | number | null;
};

function finiteNumber(value: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
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
  const potSizeLabelRaw = row.pot_size_label?.trim() ?? "";
  const potSizeLabel = potSizeLabelRaw && isPotSizeLabel(potSizeLabelRaw) ? potSizeLabelRaw : null;
  const potSizeId = row.pot_size_id;
  const cost = deriveSellableVariantSupplierCost({
    plantSupplierCost: finiteNumber(row.plant_supplier_price),
    potSizeId,
    potSupplierCost: finiteNumber(row.pot_supplier_price),
  });
  return {
    sellableVariantId: row.id,
    plantId: row.plant_id,
    plantSizeId: row.plant_variant_id,
    plantSizeLabel,
    potSizeId,
    potId: row.pot_id,
    potName: row.pot_name?.trim() || null,
    potSizeLabel,
    ...cost,
  };
}

export function sellableVariantWriteHttp(error: SellableVariantWriteError): {
  status: number;
  error: string;
} {
  const status =
    error.code === "not_found" || error.code === "plant_not_found"
      ? 404
      : error.code === "duplicate"
        ? 409
        : 400;
  return { status, error: error.message };
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
      sv.pot_size_id,
      ps.pot_id,
      pot.name AS pot_name,
      ps.size_label AS pot_size_label,
      ps.supplier_price AS pot_supplier_price
    FROM sellable_variants sv
    INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    INNER JOIN plants p ON p.id = pv.plant_id
    LEFT JOIN pot_sizes ps ON ps.id = sv.pot_size_id
    LEFT JOIN pots pot ON pot.id = ps.pot_id
    WHERE pv.plant_id = ${trimmed}
    ORDER BY pv.size_label ASC, pot.name ASC NULLS FIRST, ps.size_label ASC, sv.id ASC
  `;
  return (rows as SellableVariantRow[]).map(mapRow);
}

export async function createSellableVariant(input: {
  plantId: string;
  plantSizeId: unknown;
  potSizeId: unknown;
}): Promise<SellableVariant> {
  const plantId = input.plantId.trim();
  await assertPlant(plantId);

  if (typeof input.plantSizeId !== "string" || !isDatabaseUuid(input.plantSizeId)) {
    throw new SellableVariantWriteError("not_found", "Plant size not found");
  }
  const plantSizeId = input.plantSizeId.trim();

  let potSizeId: string | null;
  if (input.potSizeId == null) {
    potSizeId = null;
  } else if (typeof input.potSizeId === "string" && isDatabaseUuid(input.potSizeId)) {
    potSizeId = input.potSizeId.trim();
  } else {
    throw new SellableVariantWriteError("not_found", "Pot size not found");
  }

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

  if (potSizeId) {
    const potRows = await sql`
      SELECT id FROM pot_sizes WHERE id = ${potSizeId}::uuid LIMIT 1
    `;
    if ((potRows as { id: string }[]).length === 0) {
      throw new SellableVariantWriteError("not_found", "Pot size not found");
    }
  }

  try {
    const inserted = await sql`
      INSERT INTO sellable_variants (plant_variant_id, pot_size_id)
      VALUES (${plantSizeId}::uuid, ${potSizeId}::uuid)
      RETURNING id
    `;
    const id = (inserted as { id: string }[])[0]?.id;
    if (!id) throw new SellableVariantWriteError("not_found", "Variant not found");
    const rows = await sql`
      SELECT
        sv.id,
        pv.plant_id,
        sv.plant_variant_id,
        pv.size_label AS plant_size_label,
        p.supplier_price AS plant_supplier_price,
        sv.pot_size_id,
        ps.pot_id,
        pot.name AS pot_name,
        ps.size_label AS pot_size_label,
        ps.supplier_price AS pot_supplier_price
      FROM sellable_variants sv
      INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
      INNER JOIN plants p ON p.id = pv.plant_id
      LEFT JOIN pot_sizes ps ON ps.id = sv.pot_size_id
      LEFT JOIN pots pot ON pot.id = ps.pot_id
      WHERE sv.id = ${id}::uuid
      LIMIT 1
    `;
    const row = (rows as SellableVariantRow[])[0];
    if (!row) throw new SellableVariantWriteError("not_found", "Variant not found");
    return mapRow(row);
  } catch (error) {
    if (error instanceof SellableVariantWriteError) throw error;
    if (isUniqueViolation(error)) {
      throw new SellableVariantWriteError(
        "duplicate",
        "This plant size already has that pot size",
      );
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
}

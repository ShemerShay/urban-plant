/**
 * Catalog plant variants (physical configuration). Read-only for Slice A occupancy.
 */

import { sql } from "@/lib/db";

export type PlantVariant = {
  id: string;
  plantId: string;
  sizeLabel?: string;
  nurseryPotDiameterCm?: number;
};

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
  return "Variant";
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

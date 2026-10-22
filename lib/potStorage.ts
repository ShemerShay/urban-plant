/**
 * Legacy Catalog pots. Shop matching is still an exact size_label match on
 * pot_variants, and catalog_price stays the customer selling price.
 * Pot sizes, colors, and central pot inventory are separate tables.
 */

import { sql } from "@/lib/db";
import { isPotSizeLabel, type PotSizeLabel } from "@/lib/potSizes";

export type Pot = {
  id: string;
  name: string;
  nameHe?: string;
  image?: string;
};

export type PotVariant = {
  id: string;
  potId: string;
  sizeLabel: PotSizeLabel;
  color: string;
  colorHe?: string;
  catalogPrice: number;
};

const DATABASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDatabaseUuid(value: string): boolean {
  return DATABASE_UUID.test(value.trim());
}

export type PotWriteCode =
  | "not_found"
  | "name_required"
  | "invalid_size_label"
  | "invalid_catalog_price"
  | "invalid_supplier_price"
  | "color_required"
  | "duplicate"
  | "in_use";

export class PotWriteError extends Error {
  readonly code: PotWriteCode;

  constructor(code: PotWriteCode, message: string) {
    super(message);
    this.name = "PotWriteError";
    this.code = code;
  }
}

type PotRow = {
  id: string;
  name: string;
  name_he: string | null;
  image: string | null;
};

type PotVariantRow = {
  id: string;
  pot_id: string;
  size_label: string;
  color: string;
  color_he: string | null;
  catalog_price: string | number;
};

function optionalTrimmed(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function mapPot(row: PotRow): Pot {
  const nameHe = optionalTrimmed(row.name_he);
  const image = optionalTrimmed(row.image);
  return {
    id: row.id,
    name: row.name.trim(),
    ...(nameHe ? { nameHe } : {}),
    ...(image ? { image } : {}),
  };
}

function mapPrice(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  return n;
}

function mapVariant(row: PotVariantRow): PotVariant {
  const sizeLabel = row.size_label.trim();
  if (!isPotSizeLabel(sizeLabel)) {
    throw new PotWriteError("invalid_size_label", "sizeLabel must be S, M, or L");
  }
  const colorHe = optionalTrimmed(row.color_he);
  return {
    id: row.id,
    potId: row.pot_id,
    sizeLabel,
    color: row.color.trim(),
    ...(colorHe ? { colorHe } : {}),
    catalogPrice: mapPrice(row.catalog_price),
  };
}

function parseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new PotWriteError("name_required", "name is required");
  return name;
}

function parseOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseSizeLabel(value: unknown): PotSizeLabel {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!isPotSizeLabel(raw)) {
    throw new PotWriteError("invalid_size_label", "sizeLabel must be S, M, or L");
  }
  return raw;
}

function parseRequiredCatalogPrice(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    throw new PotWriteError("invalid_catalog_price", "catalogPrice must be greater than 0");
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PotWriteError("invalid_catalog_price", "catalogPrice must be greater than 0");
  }
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) {
    throw new PotWriteError(
      "invalid_catalog_price",
      "catalogPrice must have at most 2 decimal places",
    );
  }
  return cents / 100;
}

function parseColor(value: unknown): string {
  const color = typeof value === "string" ? value.trim() : "";
  if (!color) throw new PotWriteError("color_required", "color is required");
  return color;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && String(error.code) === "23505";
}

export function potWriteHttp(error: PotWriteError): { status: number; error: string } {
  const status =
    error.code === "not_found" ? 404 : error.code === "duplicate" || error.code === "in_use" ? 409 : 400;
  return { status, error: error.message };
}

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error === "object" && error && "code" in error && String(error.code) === "23503") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /foreign key|violates foreign key constraint/i.test(message);
}

export async function getPotById(id: string): Promise<Pot | undefined> {
  const trimmed = id.trim();
  if (!isDatabaseUuid(trimmed)) return undefined;
  const rows = await sql`
    SELECT id, name, name_he, image
    FROM pots
    WHERE id = ${trimmed}::uuid
    LIMIT 1
  `;
  const row = (rows as PotRow[])[0];
  return row ? mapPot(row) : undefined;
}

export async function createPot(input: {
  name: unknown;
  nameHe?: unknown;
  image?: unknown;
}): Promise<Pot> {
  const name = parseName(input.name);
  const nameHe = parseOptionalText(input.nameHe);
  const image = parseOptionalText(input.image);
  const rows = await sql`
    INSERT INTO pots (name, name_he, image)
    VALUES (${name}, ${nameHe}, ${image})
    RETURNING id, name, name_he, image
  `;
  return mapPot((rows as PotRow[])[0]);
}

export async function updatePot(input: {
  potId: string;
  name?: unknown;
  nameHe?: unknown;
  image?: unknown;
}): Promise<Pot> {
  const existing = await getPotById(input.potId);
  if (!existing) throw new PotWriteError("not_found", "Pot not found");
  const name = input.name === undefined ? existing.name : parseName(input.name);
  const nameHe =
    input.nameHe === undefined ? (existing.nameHe ?? null) : parseOptionalText(input.nameHe);
  const image = input.image === undefined ? (existing.image ?? null) : parseOptionalText(input.image);
  const rows = await sql`
    UPDATE pots
    SET name = ${name}, name_he = ${nameHe}, image = ${image}
    WHERE id = ${existing.id}::uuid
    RETURNING id, name, name_he, image
  `;
  const row = (rows as PotRow[])[0];
  if (!row) throw new PotWriteError("not_found", "Pot not found");
  return mapPot(row);
}

export async function deletePot(potId: string): Promise<void> {
  const existing = await getPotById(potId);
  if (!existing) throw new PotWriteError("not_found", "Pot not found");
  try {
    await sql`DELETE FROM pots WHERE id = ${existing.id}::uuid`;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PotWriteError(
        "in_use",
        /sellable_variants/i.test(message)
          ? "This pot is used by a variant and cannot be deleted"
          : "This pot has central inventory and cannot be deleted",
      );
    }
    throw error;
  }
}

async function insertVariant(input: {
  potId: string;
  sizeLabel: PotSizeLabel;
  color: string;
  colorHe: string | null;
  catalogPrice: number;
}): Promise<PotVariant> {
  try {
    const rows = await sql`
      INSERT INTO pot_variants (pot_id, size_label, color, color_he, catalog_price)
      VALUES (
        ${input.potId}::uuid,
        ${input.sizeLabel},
        ${input.color},
        ${input.colorHe},
        ${input.catalogPrice}
      )
      RETURNING id, pot_id, size_label, color, color_he, catalog_price
    `;
    return mapVariant((rows as PotVariantRow[])[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PotWriteError("duplicate", "This pot already has that size and color");
    }
    throw error;
  }
}

/**
 * Legacy Catalog writer. Shop, cart, checkout, and orders still read
 * pot_variants.catalog_price. Slice 5 replaces that read. Slice 7 drops the table.
 * Pot Size and Color writes do not call this.
 */
export async function createPotVariant(input: {
  potId: string;
  sizeLabel: unknown;
  color: unknown;
  colorHe?: unknown;
  catalogPrice: unknown;
}): Promise<PotVariant> {
  const pot = await getPotById(input.potId);
  if (!pot) throw new PotWriteError("not_found", "Pot not found");
  return insertVariant({
    potId: pot.id,
    sizeLabel: parseSizeLabel(input.sizeLabel),
    color: parseColor(input.color),
    colorHe: parseOptionalText(input.colorHe),
    catalogPrice: parseRequiredCatalogPrice(input.catalogPrice),
  });
}

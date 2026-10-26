/**
 * Pot records for admin.
 * Customer Catalog selling does not read pot_variants or catalog_price.
 * Pot sizes, colors, and central pot inventory are separate tables.
 */

import { sql } from "@/lib/db";

export type Pot = {
  id: string;
  name: string;
  nameHe?: string;
  image?: string;
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

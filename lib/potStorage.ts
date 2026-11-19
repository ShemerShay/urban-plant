/**
 * Catalog Pot records. Each row is one physical pot SKU.
 * Selling price lives on the Offer. Central quantity lives in pot_inventory.
 */

import { revalidateCatalogShopCache } from "@/lib/catalogShopCache";
import { sql } from "@/lib/db";

export const POT_FORMS = ["classic", "tall", "bowl"] as const;

export type PotForm = (typeof POT_FORMS)[number];

export type Pot = {
  id: string;
  name: string;
  nameHe?: string;
  image?: string;
  family?: string;
  diameterCm?: number;
  material?: string;
  color?: string;
  form?: PotForm;
  texture?: string;
  active: boolean;
  supplierPrice: number | null;
  quantity: number;
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
  | "invalid_quantity"
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

export type PotRow = {
  id: string;
  name: string;
  name_he: string | null;
  image: string | null;
  family: string | null;
  diameter_cm: string | number | null;
  material: string | null;
  color: string | null;
  form: string | null;
  texture: string | null;
  active: boolean | null;
  supplier_price: string | number | null;
  quantity: string | number | null;
};

function optionalTrimmed(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function mapDiameter(value: string | number | null): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function mapForm(value: string | null): PotForm | undefined {
  const form = optionalTrimmed(value);
  if (form === "classic" || form === "tall" || form === "bowl") return form;
  return undefined;
}

export function potFromRow(row: PotRow): Pot {
  const nameHe = optionalTrimmed(row.name_he);
  const image = optionalTrimmed(row.image);
  const family = optionalTrimmed(row.family);
  const material = optionalTrimmed(row.material);
  const color = optionalTrimmed(row.color);
  const texture = optionalTrimmed(row.texture);
  const diameterCm = mapDiameter(row.diameter_cm);
  const form = mapForm(row.form);
  const supplierPrice = mapSupplierPrice(row.supplier_price);
  const quantity = row.quantity == null ? 0 : Number(row.quantity);
  return {
    id: row.id,
    name: row.name.trim(),
    active: row.active !== false,
    supplierPrice,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    ...(nameHe ? { nameHe } : {}),
    ...(image ? { image } : {}),
    ...(family ? { family } : {}),
    ...(diameterCm != null ? { diameterCm } : {}),
    ...(material ? { material } : {}),
    ...(color ? { color } : {}),
    ...(form ? { form } : {}),
    ...(texture ? { texture } : {}),
  };
}

function mapSupplierPrice(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Empty means no supplier cost. A present value must be 0 or greater, with at most 2 decimals. */
export function parsePotSupplierPrice(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new PotWriteError("invalid_supplier_price", "supplierPrice must be 0 or greater");
  }
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) {
    throw new PotWriteError(
      "invalid_supplier_price",
      "supplierPrice must have at most 2 decimal places",
    );
  }
  return cents / 100;
}

export function parsePotQuantity(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value.trim())) return Number(value.trim());
  throw new PotWriteError("invalid_quantity", "Quantity must be a whole number of 0 or more");
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

function potFromJoinedRow(row: PotRow): Pot {
  return potFromRow(row);
}

export async function readPots(): Promise<Pot[]> {
  const rows = await sql`
    SELECT
      p.id, p.name, p.name_he, p.image, p.family, p.diameter_cm, p.material, p.color,
      p.form, p.texture, p.active, p.supplier_price, i.quantity
    FROM pots p
    LEFT JOIN pot_inventory i ON i.pot_id = p.id
    ORDER BY p.name ASC, p.id ASC
  `;
  return (rows as PotRow[]).map(potFromJoinedRow);
}

export async function getPotById(id: string): Promise<Pot | undefined> {
  const trimmed = id.trim();
  if (!isDatabaseUuid(trimmed)) return undefined;
  const rows = await sql`
    SELECT
      p.id, p.name, p.name_he, p.image, p.family, p.diameter_cm, p.material, p.color,
      p.form, p.texture, p.active, p.supplier_price, i.quantity
    FROM pots p
    LEFT JOIN pot_inventory i ON i.pot_id = p.id
    WHERE p.id = ${trimmed}::uuid
    LIMIT 1
  `;
  const row = (rows as PotRow[])[0];
  return row ? potFromRow(row) : undefined;
}

export async function createPot(input: {
  name: unknown;
  nameHe?: unknown;
  image?: unknown;
  supplierPrice?: unknown;
}): Promise<Pot> {
  const name = parseName(input.name);
  const nameHe = parseOptionalText(input.nameHe);
  const image = parseOptionalText(input.image);
  const supplierPrice =
    input.supplierPrice === undefined ? null : parsePotSupplierPrice(input.supplierPrice);
  const rows = await sql`
    INSERT INTO pots (name, name_he, image, supplier_price)
    VALUES (${name}, ${nameHe}, ${image}, ${supplierPrice})
    RETURNING id
  `;
  const id = (rows as { id: string }[])[0]?.id;
  const pot = id ? await getPotById(id) : undefined;
  if (!pot) throw new PotWriteError("not_found", "Pot not found");
  await revalidateCatalogShopCache();
  return pot;
}

export async function updatePot(input: {
  potId: string;
  name?: unknown;
  nameHe?: unknown;
  image?: unknown;
  supplierPrice?: unknown;
}): Promise<Pot> {
  const existing = await getPotById(input.potId);
  if (!existing) throw new PotWriteError("not_found", "Pot not found");
  const name = input.name === undefined ? existing.name : parseName(input.name);
  const nameHe =
    input.nameHe === undefined ? (existing.nameHe ?? null) : parseOptionalText(input.nameHe);
  const image = input.image === undefined ? (existing.image ?? null) : parseOptionalText(input.image);
  const supplierPrice =
    input.supplierPrice === undefined
      ? existing.supplierPrice
      : parsePotSupplierPrice(input.supplierPrice);
  await sql`
    UPDATE pots
    SET name = ${name}, name_he = ${nameHe}, image = ${image}, supplier_price = ${supplierPrice}
    WHERE id = ${existing.id}::uuid
  `;
  const pot = await getPotById(existing.id);
  if (!pot) throw new PotWriteError("not_found", "Pot not found");
  await revalidateCatalogShopCache();
  return pot;
}

const POT_DELETE_REASONS = {
  offer: "an offer",
  variant: "a sellable variant",
  pos: "a partner spot",
  placement: "placement history",
  hold: "an active catalog hold",
} as const;

export async function deletePot(potId: string): Promise<void> {
  const existing = await getPotById(potId);
  if (!existing) throw new PotWriteError("not_found", "Pot not found");
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM sellable_variants WHERE pot_id = ${existing.id}::uuid) AS variants,
      (
        SELECT count(*)::int
        FROM offers o
        INNER JOIN sellable_variants sv ON sv.id = o.sellable_variant_id
        WHERE sv.pot_id = ${existing.id}::uuid
      ) AS offers,
      (SELECT count(*)::int FROM pos_spots WHERE pot_id = ${existing.id}::uuid) AS spots,
      (SELECT count(*)::int FROM placement_segments WHERE pot_id = ${existing.id}::uuid) AS segments,
      (
        SELECT count(*)::int
        FROM catalog_stock_holds
        WHERE pot_id = ${existing.id}::uuid
          AND status = 'active'
          AND expires_at > now()
      ) AS holds
  `;
  const counts = (rows as {
    variants: number;
    offers: number;
    spots: number;
    segments: number;
    holds: number;
  }[])[0];
  const reasons: string[] = [];
  if (counts && counts.offers > 0) reasons.push(POT_DELETE_REASONS.offer);
  if (counts && counts.variants > 0) reasons.push(POT_DELETE_REASONS.variant);
  if (counts && counts.spots > 0) reasons.push(POT_DELETE_REASONS.pos);
  if (counts && counts.segments > 0) reasons.push(POT_DELETE_REASONS.placement);
  if (counts && counts.holds > 0) reasons.push(POT_DELETE_REASONS.hold);
  if (reasons.length > 0) {
    throw new PotWriteError(
      "in_use",
      `This pot cannot be deleted because it is used by ${reasons.join(", ")}.`,
    );
  }
  try {
    await sql.transaction([
      sql`
        DELETE FROM catalog_stock_holds
        WHERE pot_id = ${existing.id}::uuid
          AND NOT (status = 'active' AND expires_at > now())
      `,
      sql`DELETE FROM pots WHERE id = ${existing.id}::uuid`,
    ]);
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new PotWriteError(
        "in_use",
        "This pot cannot be deleted because it is still used by a sellable variant, offer, partner spot, placement history, or an active catalog hold.",
      );
    }
    throw error;
  }
  await revalidateCatalogShopCache();
}

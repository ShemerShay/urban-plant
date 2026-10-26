/**
 * Pot → Pot Size → Color.
 * Supplier cost lives on the Pot Size. A Color has no cost and no selling price.
 * Customer Catalog selling does not read pot_variants.
 */

import { sql } from "@/lib/db";
import { getPotById, isDatabaseUuid, PotWriteError, type Pot } from "@/lib/potStorage";
import { isPotSizeLabel, POT_SIZE_LABELS, type PotSizeLabel } from "@/lib/potSizes";

export type PotSize = {
  id: string;
  potId: string;
  sizeLabel: PotSizeLabel;
  supplierPrice: number | null;
};

export type PotColor = {
  id: string;
  potSizeId: string;
  color: string;
  colorHe?: string;
  quantity: number;
};

export type PotSizeWithColors = PotSize & {
  colors: PotColor[];
};

export type PotWithSizes = Pot & {
  sizes: PotSizeWithColors[];
};

type PotSizeRow = {
  id: string;
  pot_id: string;
  size_label: string;
  supplier_price: string | number | null;
};

type PotColorRow = {
  id: string;
  pot_size_id: string;
  color: string;
  color_he: string | null;
  quantity: string | number | null;
};

function optionalTrimmed(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function mapSupplierPrice(value: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSize(row: PotSizeRow): PotSize {
  const sizeLabel = row.size_label.trim();
  if (!isPotSizeLabel(sizeLabel)) {
    throw new PotWriteError("invalid_size_label", "sizeLabel must be S, M, or L");
  }
  return {
    id: row.id,
    potId: row.pot_id,
    sizeLabel,
    supplierPrice: mapSupplierPrice(row.supplier_price),
  };
}

function mapColor(row: PotColorRow): PotColor {
  const colorHe = optionalTrimmed(row.color_he);
  const quantity = row.quantity == null ? 0 : Number(row.quantity);
  return {
    id: row.id,
    potSizeId: row.pot_size_id,
    color: row.color.trim(),
    ...(colorHe ? { colorHe } : {}),
    quantity: Number.isFinite(quantity) ? quantity : 0,
  };
}

function parseSizeLabel(value: unknown): PotSizeLabel {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!isPotSizeLabel(raw)) {
    throw new PotWriteError("invalid_size_label", "sizeLabel must be S, M, or L");
  }
  return raw;
}

function parseColor(value: unknown): string {
  const color = typeof value === "string" ? value.trim() : "";
  if (!color) throw new PotWriteError("color_required", "color is required");
  return color;
}

function parseOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Empty means no supplier cost. A present value must be 0 or greater, with at most 2 decimals. */
function parseSupplierPrice(value: unknown): number | null {
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && String(error.code) === "23505";
}

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error === "object" && error && "code" in error && String(error.code) === "23503") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /foreign key|violates foreign key constraint/i.test(message);
}

function sizeRank(label: PotSizeLabel): number {
  return POT_SIZE_LABELS.indexOf(label);
}

type PotRow = {
  id: string;
  name: string;
  name_he: string | null;
  image: string | null;
};

function mapPotRow(row: PotRow): Pot {
  const nameHe = optionalTrimmed(row.name_he);
  const image = optionalTrimmed(row.image);
  return {
    id: row.id,
    name: row.name.trim(),
    ...(nameHe ? { nameHe } : {}),
    ...(image ? { image } : {}),
  };
}

export async function readPotsWithSizes(): Promise<PotWithSizes[]> {
  const potRows = await sql`
    SELECT id, name, name_he, image
    FROM pots
    ORDER BY name ASC, id ASC
  `;
  const sizeRows = await sql`
    SELECT id, pot_id, size_label, supplier_price
    FROM pot_sizes
  `;
  const colorRows = await sql`
    SELECT c.id, c.pot_size_id, c.color, c.color_he, i.quantity
    FROM pot_colors c
    LEFT JOIN pot_inventory i ON i.pot_color_id = c.id
    ORDER BY c.color ASC, c.id ASC
  `;

  const colorsBySize = new Map<string, PotColor[]>();
  for (const row of colorRows as PotColorRow[]) {
    const color = mapColor(row);
    const list = colorsBySize.get(color.potSizeId) ?? [];
    list.push(color);
    colorsBySize.set(color.potSizeId, list);
  }

  const sizesByPot = new Map<string, PotSizeWithColors[]>();
  for (const row of sizeRows as PotSizeRow[]) {
    const size = mapSize(row);
    const list = sizesByPot.get(size.potId) ?? [];
    list.push({ ...size, colors: colorsBySize.get(size.id) ?? [] });
    sizesByPot.set(size.potId, list);
  }
  for (const list of sizesByPot.values()) {
    list.sort((a, b) => sizeRank(a.sizeLabel) - sizeRank(b.sizeLabel) || a.id.localeCompare(b.id));
  }

  return (potRows as PotRow[]).map((row) => {
    const pot = mapPotRow(row);
    return { ...pot, sizes: sizesByPot.get(pot.id) ?? [] };
  });
}

async function requirePot(potId: string): Promise<Pot> {
  const pot = await getPotById(potId);
  if (!pot) throw new PotWriteError("not_found", "Pot not found");
  return pot;
}

async function requireSize(potId: string, sizeId: string): Promise<PotSize> {
  if (!isDatabaseUuid(potId) || !isDatabaseUuid(sizeId)) {
    throw new PotWriteError("not_found", "Pot size not found");
  }
  const rows = await sql`
    SELECT id, pot_id, size_label, supplier_price
    FROM pot_sizes
    WHERE id = ${sizeId.trim()}::uuid
      AND pot_id = ${potId.trim()}::uuid
    LIMIT 1
  `;
  const row = (rows as PotSizeRow[])[0];
  if (!row) throw new PotWriteError("not_found", "Pot size not found");
  return mapSize(row);
}

async function requireColor(potId: string, sizeId: string, colorId: string): Promise<PotColor> {
  if (!isDatabaseUuid(potId) || !isDatabaseUuid(sizeId) || !isDatabaseUuid(colorId)) {
    throw new PotWriteError("not_found", "Color not found");
  }
  const rows = await sql`
    SELECT c.id, c.pot_size_id, c.color, c.color_he, i.quantity
    FROM pot_colors c
    INNER JOIN pot_sizes s ON s.id = c.pot_size_id
    LEFT JOIN pot_inventory i ON i.pot_color_id = c.id
    WHERE c.id = ${colorId.trim()}::uuid
      AND c.pot_size_id = ${sizeId.trim()}::uuid
      AND s.pot_id = ${potId.trim()}::uuid
    LIMIT 1
  `;
  const row = (rows as PotColorRow[])[0];
  if (!row) throw new PotWriteError("not_found", "Color not found");
  return mapColor(row);
}

export async function createPotSize(input: {
  potId: string;
  sizeLabel: unknown;
  supplierPrice?: unknown;
}): Promise<PotSize> {
  const pot = await requirePot(input.potId);
  const sizeLabel = parseSizeLabel(input.sizeLabel);
  const supplierPrice = parseSupplierPrice(input.supplierPrice);
  try {
    const rows = await sql`
      INSERT INTO pot_sizes (pot_id, size_label, supplier_price)
      VALUES (${pot.id}::uuid, ${sizeLabel}, ${supplierPrice})
      RETURNING id, pot_id, size_label, supplier_price
    `;
    return mapSize((rows as PotSizeRow[])[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PotWriteError("duplicate", "This pot already has that pot size");
    }
    throw error;
  }
}

export async function updatePotSize(input: {
  potId: string;
  sizeId: string;
  sizeLabel?: unknown;
  supplierPrice?: unknown;
}): Promise<PotSize> {
  const existing = await requireSize(input.potId, input.sizeId);
  const sizeLabel =
    input.sizeLabel === undefined ? existing.sizeLabel : parseSizeLabel(input.sizeLabel);
  const supplierPrice =
    input.supplierPrice === undefined ? existing.supplierPrice : parseSupplierPrice(input.supplierPrice);
  try {
    const rows = await sql`
      UPDATE pot_sizes
      SET size_label = ${sizeLabel},
          supplier_price = ${supplierPrice},
          updated_at = now()
      WHERE id = ${existing.id}::uuid
        AND pot_id = ${existing.potId}::uuid
      RETURNING id, pot_id, size_label, supplier_price
    `;
    const row = (rows as PotSizeRow[])[0];
    if (!row) throw new PotWriteError("not_found", "Pot size not found");
    return mapSize(row);
  } catch (error) {
    if (error instanceof PotWriteError) throw error;
    if (isUniqueViolation(error)) {
      throw new PotWriteError("duplicate", "This pot already has that pot size");
    }
    throw error;
  }
}

export async function deletePotSize(input: { potId: string; sizeId: string }): Promise<void> {
  await requireSize(input.potId, input.sizeId);
  try {
    const rows = await sql`
      DELETE FROM pot_sizes
      WHERE id = ${input.sizeId.trim()}::uuid
        AND pot_id = ${input.potId.trim()}::uuid
      RETURNING id
    `;
    if ((rows as { id: string }[]).length === 0) {
      throw new PotWriteError("not_found", "Pot size not found");
    }
  } catch (error) {
    if (error instanceof PotWriteError) throw error;
    if (isForeignKeyViolation(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PotWriteError(
        "in_use",
        /sellable_variants/i.test(message)
          ? "This pot size is used by a variant and cannot be deleted"
          : "This pot size has central inventory and cannot be deleted",
      );
    }
    throw error;
  }
}

export async function createPotColor(input: {
  potId: string;
  sizeId: string;
  color: unknown;
  colorHe?: unknown;
}): Promise<PotColor> {
  const size = await requireSize(input.potId, input.sizeId);
  const color = parseColor(input.color);
  const colorHe = parseOptionalText(input.colorHe);
  try {
    const rows = await sql`
      INSERT INTO pot_colors (pot_size_id, color, color_he)
      VALUES (${size.id}::uuid, ${color}, ${colorHe})
      RETURNING id, pot_size_id, color, color_he
    `;
    const row = (rows as PotColorRow[])[0];
    return mapColor({ ...row, quantity: null });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PotWriteError("duplicate", "This pot size already has that color");
    }
    throw error;
  }
}

export async function updatePotColor(input: {
  potId: string;
  sizeId: string;
  colorId: string;
  color?: unknown;
  colorHe?: unknown;
}): Promise<PotColor> {
  const existing = await requireColor(input.potId, input.sizeId, input.colorId);
  const color = input.color === undefined ? existing.color : parseColor(input.color);
  const colorHe =
    input.colorHe === undefined ? (existing.colorHe ?? null) : parseOptionalText(input.colorHe);
  try {
    const rows = await sql`
      UPDATE pot_colors
      SET color = ${color},
          color_he = ${colorHe},
          updated_at = now()
      WHERE id = ${existing.id}::uuid
        AND pot_size_id = ${existing.potSizeId}::uuid
      RETURNING id, pot_size_id, color, color_he
    `;
    const row = (rows as PotColorRow[])[0];
    if (!row) throw new PotWriteError("not_found", "Color not found");
    const quantity = existing.quantity;
    return mapColor({ ...row, quantity });
  } catch (error) {
    if (error instanceof PotWriteError) throw error;
    if (isUniqueViolation(error)) {
      throw new PotWriteError("duplicate", "This pot size already has that color");
    }
    throw error;
  }
}

export async function deletePotColor(input: {
  potId: string;
  sizeId: string;
  colorId: string;
}): Promise<void> {
  await requireColor(input.potId, input.sizeId, input.colorId);
  try {
    const rows = await sql`
      DELETE FROM pot_colors
      WHERE id = ${input.colorId.trim()}::uuid
        AND pot_size_id = ${input.sizeId.trim()}::uuid
      RETURNING id
    `;
    if ((rows as { id: string }[]).length === 0) {
      throw new PotWriteError("not_found", "Color not found");
    }
  } catch (error) {
    if (error instanceof PotWriteError) throw error;
    if (isForeignKeyViolation(error)) {
      throw new PotWriteError("in_use", "This color has central inventory and cannot be deleted");
    }
    throw error;
  }
}

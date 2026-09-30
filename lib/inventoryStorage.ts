/**
 * Central Back Office inventory: current quantity per variant + append-only history.
 * Partner/POS placement is not stock. Flowers are not writable.
 */

import { sql } from "@/lib/db";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

export type InventoryChangeCode =
  | "delta_zero"
  | "invalid_delta"
  | "variant_not_found"
  | "flower_variant"
  | "insufficient_quantity";

export class InventoryChangeError extends Error {
  readonly code: InventoryChangeCode;

  constructor(code: InventoryChangeCode, message: string) {
    super(message);
    this.name = "InventoryChangeError";
    this.code = code;
  }
}

export type InventoryBalance = {
  variantId: string;
  quantity: number;
  updatedAt: string;
};

export type InventoryHistoryEntry = {
  id: string;
  variantId: string;
  delta: number;
  note: string | null;
  createdAt: string;
};

type InventoryRow = {
  variant_id: string;
  quantity: string | number;
  updated_at: string | Date;
};

type HistoryRow = {
  id: string;
  variant_id: string;
  delta: string | number;
  note: string | null;
  created_at: string | Date;
};

function trimVariantId(variantId: string): string {
  return variantId.trim();
}

function parseNote(note: string | null | undefined): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  return trimmed ? trimmed : null;
}

function mapBalance(row: InventoryRow): InventoryBalance {
  const updatedAt = toIsoString(row.updated_at);
  if (!updatedAt) throw new Error("inventory.updated_at is required");
  return {
    variantId: String(row.variant_id),
    quantity: parseNumeric(row.quantity),
    updatedAt,
  };
}

function mapHistory(row: HistoryRow): InventoryHistoryEntry {
  const createdAt = toIsoString(row.created_at);
  if (!createdAt) throw new Error("inventory_history.created_at is required");
  return {
    id: String(row.id),
    variantId: String(row.variant_id),
    delta: parseNumeric(row.delta),
    note: row.note == null || String(row.note).trim() === "" ? null : String(row.note),
    createdAt,
  };
}

function assertWritableDelta(delta: number): void {
  if (!Number.isInteger(delta)) {
    throw new InventoryChangeError("invalid_delta", "Inventory delta must be a non-zero integer");
  }
  if (delta === 0) {
    throw new InventoryChangeError("delta_zero", "Inventory delta cannot be 0");
  }
}

async function loadVariantInventoryType(
  variantId: string,
): Promise<"plants" | "flowers" | null> {
  const rows = await sql`
    SELECT COALESCE(p.inventory_type, 'plants') AS inventory_type
    FROM plant_variants pv
    INNER JOIN plants p ON p.id = pv.plant_id
    WHERE pv.id = ${variantId}::uuid
    LIMIT 1
  `;
  const inventoryType = (rows as { inventory_type: string }[])[0]?.inventory_type;
  if (inventoryType === "flowers" || inventoryType === "plants") return inventoryType;
  return null;
}

/** Current central quantity. Missing row is 0. */
export async function getInventoryQuantity(variantId: string): Promise<number> {
  const id = trimVariantId(variantId);
  if (!id) return 0;
  const rows = await sql`
    SELECT quantity
    FROM inventory
    WHERE variant_id = ${id}::uuid
  `;
  const row = (rows as { quantity: string | number }[])[0];
  return row ? parseNumeric(row.quantity) : 0;
}

export async function getInventoryBalance(
  variantId: string,
): Promise<InventoryBalance | null> {
  const id = trimVariantId(variantId);
  if (!id) return null;
  const rows = await sql`
    SELECT variant_id, quantity, updated_at
    FROM inventory
    WHERE variant_id = ${id}::uuid
  `;
  const row = (rows as InventoryRow[])[0];
  return row ? mapBalance(row) : null;
}

export async function readInventoryHistory(
  variantId: string,
): Promise<InventoryHistoryEntry[]> {
  const id = trimVariantId(variantId);
  if (!id) return [];
  const rows = await sql`
    SELECT id, variant_id, delta, note, created_at
    FROM inventory_history
    WHERE variant_id = ${id}::uuid
    ORDER BY created_at ASC, id ASC
  `;
  return (rows as HistoryRow[]).map(mapHistory);
}

type InventorySqlQuery = ReturnType<typeof sql>;

/**
 * Three statements that apply a signed delta and append history.
 * Callers must run them in one Neon transaction with any coupled writes.
 */
export function inventoryDeltaQueries(input: {
  variantId: string;
  delta: number;
  note?: string | null;
}): InventorySqlQuery[] {
  const variantId = trimVariantId(input.variantId);
  const note = parseNote(input.note);
  return [
    sql`
      INSERT INTO inventory (variant_id, quantity, updated_at)
      VALUES (${variantId}::uuid, 0, now())
      ON CONFLICT (variant_id) DO NOTHING
    `,
    sql`
      UPDATE inventory
      SET quantity = quantity + ${input.delta}::integer,
          updated_at = now()
      WHERE variant_id = ${variantId}::uuid
      RETURNING variant_id, quantity, updated_at
    `,
    sql`
      INSERT INTO inventory_history (variant_id, delta, note)
      VALUES (${variantId}::uuid, ${input.delta}::integer, ${note})
      RETURNING id
    `,
  ];
}

export function mapInventoryWriteError(error: unknown): never {
  if (error instanceof InventoryChangeError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (/inventory_quantity_non_negative/i.test(message)) {
    throw new InventoryChangeError(
      "insufficient_quantity",
      "Inventory quantity cannot go below 0",
    );
  }
  throw error;
}

/** Validate a plant variant and return the inventory SQL list. Does not write. */
export async function prepareInventoryDelta(input: {
  variantId: string;
  delta: number;
  note?: string | null;
}): Promise<{ queries: InventorySqlQuery[] }> {
  const variantId = trimVariantId(input.variantId);
  if (!variantId) {
    throw new InventoryChangeError("variant_not_found", "Variant is required");
  }
  assertWritableDelta(input.delta);

  const inventoryType = await loadVariantInventoryType(variantId);
  if (inventoryType == null) {
    throw new InventoryChangeError("variant_not_found", "Variant not found");
  }
  if (inventoryType === "flowers") {
    throw new InventoryChangeError(
      "flower_variant",
      "Flowers cannot receive inventory changes",
    );
  }

  return {
    queries: inventoryDeltaQueries({
      variantId,
      delta: input.delta,
      note: input.note,
    }),
  };
}

/**
 * Apply a signed central-stock change and append history in one statement.
 * Positive delta receives stock; negative delta sends stock out.
 */
export async function applyInventoryDelta(input: {
  variantId: string;
  delta: number;
  note?: string | null;
}): Promise<InventoryBalance> {
  const prepared = await prepareInventoryDelta(input);

  try {
    const results = await sql.transaction(prepared.queries);
    const row = (results[1] as InventoryRow[])[0];
    if (!row) {
      throw new InventoryChangeError(
        "insufficient_quantity",
        "Inventory quantity cannot go below 0",
      );
    }
    return mapBalance(row);
  } catch (error) {
    mapInventoryWriteError(error);
  }
}

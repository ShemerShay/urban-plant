/**
 * Central pot inventory: one current quantity per Pot Color, plus append-only history.
 * A missing row is 0. This table is not plant inventory.
 */

import { sql } from "@/lib/db";
import { isDatabaseUuid } from "@/lib/potStorage";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

export type PotInventoryChangeCode =
  | "delta_zero"
  | "invalid_delta"
  | "color_not_found"
  | "insufficient_quantity";

export class PotInventoryChangeError extends Error {
  readonly code: PotInventoryChangeCode;

  constructor(code: PotInventoryChangeCode, message: string) {
    super(message);
    this.name = "PotInventoryChangeError";
    this.code = code;
  }
}

export type PotInventoryBalance = {
  potColorId: string;
  quantity: number;
  updatedAt: string;
};

type BalanceRow = {
  pot_color_id: string;
  quantity: string | number;
  updated_at: string | Date;
};

type HistoryRow = {
  id: string;
  pot_color_id: string;
  delta: string | number;
  note: string | null;
  created_at: string | Date;
};

function parseNote(note: string | null | undefined): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  return trimmed ? trimmed : null;
}

function assertWritableDelta(delta: number): void {
  if (!Number.isInteger(delta)) {
    throw new PotInventoryChangeError("invalid_delta", "Inventory delta must be a non-zero integer");
  }
  if (delta === 0) {
    throw new PotInventoryChangeError("delta_zero", "Inventory delta cannot be 0");
  }
}

function mapBalance(row: BalanceRow): PotInventoryBalance {
  const updatedAt = toIsoString(row.updated_at);
  if (!updatedAt) throw new Error("pot_inventory.updated_at is required");
  return {
    potColorId: String(row.pot_color_id),
    quantity: parseNumeric(row.quantity),
    updatedAt,
  };
}

export async function getPotInventoryQuantity(potColorId: string): Promise<number> {
  const id = potColorId.trim();
  if (!isDatabaseUuid(id)) return 0;
  const rows = await sql`
    SELECT quantity
    FROM pot_inventory
    WHERE pot_color_id = ${id}::uuid
  `;
  const row = (rows as { quantity: string | number }[])[0];
  return row ? parseNumeric(row.quantity) : 0;
}

export async function readPotInventoryHistory(potColorId: string): Promise<
  { id: string; potColorId: string; delta: number; note: string | null; createdAt: string }[]
> {
  const id = potColorId.trim();
  if (!isDatabaseUuid(id)) return [];
  const rows = await sql`
    SELECT id, pot_color_id, delta, note, created_at
    FROM pot_inventory_history
    WHERE pot_color_id = ${id}::uuid
    ORDER BY created_at ASC, id ASC
  `;
  return (rows as HistoryRow[]).map((row) => {
    const createdAt = toIsoString(row.created_at);
    if (!createdAt) throw new Error("pot_inventory_history.created_at is required");
    return {
      id: String(row.id),
      potColorId: String(row.pot_color_id),
      delta: parseNumeric(row.delta),
      note: row.note == null || String(row.note).trim() === "" ? null : String(row.note),
      createdAt,
    };
  });
}

function mapWriteError(error: unknown): never {
  if (error instanceof PotInventoryChangeError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (/pot_inventory_quantity_non_negative/i.test(message)) {
    throw new PotInventoryChangeError(
      "insufficient_quantity",
      "Inventory quantity cannot go below 0",
    );
  }
  throw error;
}

/** Apply a signed central-stock change for one Pot Color and append history. */
export async function applyPotInventoryDelta(input: {
  potId: string;
  sizeId: string;
  potColorId: string;
  delta: number;
  note?: string | null;
}): Promise<PotInventoryBalance> {
  const potColorId = input.potColorId.trim();
  assertWritableDelta(input.delta);
  if (
    !isDatabaseUuid(input.potId) ||
    !isDatabaseUuid(input.sizeId) ||
    !isDatabaseUuid(potColorId)
  ) {
    throw new PotInventoryChangeError("color_not_found", "Color not found");
  }
  const owned = await sql`
    SELECT c.id
    FROM pot_colors c
    INNER JOIN pot_sizes s ON s.id = c.pot_size_id
    WHERE c.id = ${potColorId}::uuid
      AND c.pot_size_id = ${input.sizeId.trim()}::uuid
      AND s.pot_id = ${input.potId.trim()}::uuid
    LIMIT 1
  `;
  if ((owned as { id: string }[]).length === 0) {
    throw new PotInventoryChangeError("color_not_found", "Color not found");
  }

  const note = parseNote(input.note);
  const statements: ReturnType<typeof sql>[] = [];
  if (input.delta > 0) {
    statements.push(sql`
      INSERT INTO pot_inventory (pot_color_id, quantity, updated_at)
      VALUES (${potColorId}::uuid, 0, now())
      ON CONFLICT (pot_color_id) DO NOTHING
    `);
  }
  statements.push(sql`
    WITH updated AS (
      UPDATE pot_inventory
      SET quantity = quantity + ${input.delta}::integer,
          updated_at = now()
      WHERE pot_color_id = ${potColorId}::uuid
        AND quantity + ${input.delta}::integer >= 0
      RETURNING pot_color_id, quantity, updated_at
    ),
    recorded AS (
      INSERT INTO pot_inventory_history (pot_color_id, delta, note)
      SELECT pot_color_id, ${input.delta}::integer, ${note}
      FROM updated
      RETURNING id
    )
    SELECT pot_color_id, quantity, updated_at
    FROM updated
  `);
  try {
    const results = await sql.transaction(statements);
    const row = (results[results.length - 1] as BalanceRow[])[0];
    if (!row) {
      throw new PotInventoryChangeError(
        "insufficient_quantity",
        "Inventory quantity cannot go below 0",
      );
    }
    return mapBalance(row);
  } catch (error) {
    mapWriteError(error);
  }
}

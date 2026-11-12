/**
 * Central pot inventory: one current quantity per Catalog Pot, plus append-only history.
 * A missing row is 0. This table is not plant inventory.
 */

import { revalidateCatalogShopCache } from "@/lib/catalogShopCache";
import { sql } from "@/lib/db";
import { isDatabaseUuid } from "@/lib/potStorage";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

export const POT_OUT_OF_STOCK_MESSAGE = "This pot is out of stock";
export const POT_ADMIN_QUANTITY_NOTE = "Admin quantity";

export type PotInventoryChangeCode =
  | "delta_zero"
  | "invalid_delta"
  | "pot_not_found"
  | "insufficient_quantity"
  | "invalid_quantity";

export class PotInventoryChangeError extends Error {
  readonly code: PotInventoryChangeCode;

  constructor(code: PotInventoryChangeCode, message: string) {
    super(message);
    this.name = "PotInventoryChangeError";
    this.code = code;
  }
}

export type PotInventoryBalance = {
  potId: string;
  quantity: number;
  updatedAt: string;
};

type BalanceRow = {
  pot_id: string;
  quantity: string | number;
  updated_at: string | Date;
};

type HistoryRow = {
  id: string;
  pot_id: string;
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
    potId: String(row.pot_id),
    quantity: parseNumeric(row.quantity),
    updatedAt,
  };
}

export async function getPotInventoryQuantity(potId: string): Promise<number> {
  const id = potId.trim();
  if (!isDatabaseUuid(id)) return 0;
  const rows = await sql`
    SELECT quantity
    FROM pot_inventory
    WHERE pot_id = ${id}::uuid
  `;
  const row = (rows as { quantity: string | number }[])[0];
  return row ? parseNumeric(row.quantity) : 0;
}

export async function readPotInventoryHistory(potId: string): Promise<
  { id: string; potId: string; delta: number; note: string | null; createdAt: string }[]
> {
  const id = potId.trim();
  if (!isDatabaseUuid(id)) return [];
  const rows = await sql`
    SELECT id, pot_id, delta, note, created_at
    FROM pot_inventory_history
    WHERE pot_id = ${id}::uuid
    ORDER BY created_at ASC, id ASC
  `;
  return (rows as HistoryRow[]).map((row) => {
    const createdAt = toIsoString(row.created_at);
    if (!createdAt) throw new Error("pot_inventory_history.created_at is required");
    return {
      id: String(row.id),
      potId: String(row.pot_id),
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
  if (/This pot is out of stock/i.test(message)) {
    throw new PotInventoryChangeError("insufficient_quantity", POT_OUT_OF_STOCK_MESSAGE);
  }
  throw error;
}

export type PotInventorySqlQuery = ReturnType<typeof sql>;

/** Validate a pot and return lock + decrement queries. Does not write. */
export async function preparePotInventoryDelta(input: {
  potId: string;
  delta: number;
  note?: string | null;
}): Promise<{ queries: PotInventorySqlQuery[] }> {
  const potId = input.potId.trim();
  assertWritableDelta(input.delta);
  if (!isDatabaseUuid(potId)) {
    throw new PotInventoryChangeError("pot_not_found", "Pot not found");
  }
  const existing = await sql`
    SELECT id FROM pots WHERE id = ${potId}::uuid LIMIT 1
  `;
  if ((existing as { id: string }[]).length === 0) {
    throw new PotInventoryChangeError("pot_not_found", "Pot not found");
  }
  const note = parseNote(input.note);
  const queries: PotInventorySqlQuery[] = [
    sql`
      SELECT quantity
      FROM pot_inventory
      WHERE pot_id = ${potId}::uuid
      FOR UPDATE
    `,
  ];
  if (input.delta > 0) {
    queries.push(sql`
      INSERT INTO pot_inventory (pot_id, quantity, updated_at)
      VALUES (${potId}::uuid, 0, now())
      ON CONFLICT (pot_id) DO NOTHING
    `);
  }
  queries.push(sql`
    WITH updated AS (
      UPDATE pot_inventory
      SET quantity = quantity + ${input.delta}::integer,
          updated_at = now()
      WHERE pot_id = ${potId}::uuid
        AND quantity + ${input.delta}::integer >= 0
      RETURNING pot_id
    ),
    recorded AS (
      INSERT INTO pot_inventory_history (pot_id, delta, note)
      SELECT pot_id, ${input.delta}::integer, ${note}
      FROM updated
      RETURNING id
    )
    SELECT 1 / COUNT(*)::integer AS ok
    FROM updated
  `);
  return { queries };
}

/** Apply a signed central-stock change for one Catalog Pot and append history. */
export async function applyPotInventoryDelta(input: {
  potId: string;
  delta: number;
  note?: string | null;
}): Promise<PotInventoryBalance> {
  const potId = input.potId.trim();
  assertWritableDelta(input.delta);
  if (!isDatabaseUuid(potId)) {
    throw new PotInventoryChangeError("pot_not_found", "Pot not found");
  }
  const owned = await sql`
    SELECT id FROM pots WHERE id = ${potId}::uuid LIMIT 1
  `;
  if ((owned as { id: string }[]).length === 0) {
    throw new PotInventoryChangeError("pot_not_found", "Pot not found");
  }

  const note = parseNote(input.note);
  const statements: ReturnType<typeof sql>[] = [];
  if (input.delta > 0) {
    statements.push(sql`
      INSERT INTO pot_inventory (pot_id, quantity, updated_at)
      VALUES (${potId}::uuid, 0, now())
      ON CONFLICT (pot_id) DO NOTHING
    `);
  }
  statements.push(sql`
    WITH updated AS (
      UPDATE pot_inventory
      SET quantity = quantity + ${input.delta}::integer,
          updated_at = now()
      WHERE pot_id = ${potId}::uuid
        AND quantity + ${input.delta}::integer >= 0
      RETURNING pot_id, quantity, updated_at
    ),
    recorded AS (
      INSERT INTO pot_inventory_history (pot_id, delta, note)
      SELECT pot_id, ${input.delta}::integer, ${note}
      FROM updated
      RETURNING id
    )
    SELECT pot_id, quantity, updated_at
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
    await revalidateCatalogShopCache();
    return mapBalance(row);
  } catch (error) {
    mapWriteError(error);
  }
}

/** Absolute admin quantity. Delta 0 writes nothing. Missing balance is 0. */
export async function setPotCentralQuantity(input: {
  potId: string;
  quantity: number;
  note?: string | null;
}): Promise<number> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new PotInventoryChangeError("invalid_quantity", "Quantity must be a whole number of 0 or more");
  }
  const current = await getPotInventoryQuantity(input.potId);
  const delta = input.quantity - current;
  if (delta === 0) return current;
  const balance = await applyPotInventoryDelta({
    potId: input.potId,
    delta,
    note: input.note ?? POT_ADMIN_QUANTITY_NOTE,
  });
  return balance.quantity;
}

/** Lock the pot and reject placement when central quantity is not above 0. */
export function potCentralStockGuardQuery(potId: string): PotInventorySqlQuery {
  return sql`SELECT assert_pot_central_quantity_available(${potId.trim()}::uuid)`;
}

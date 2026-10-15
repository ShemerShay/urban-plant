/**
 * Catalog stock reservations against central plant-variant inventory.
 * Available = inventory.quantity - active unexpired holds.
 * Acquire, release, expire, and consume do not change inventory.quantity.
 */

import "server-only";

import { sql } from "@/lib/db";
import { PAYMENT_HOLD_TTL_MS } from "@/lib/paymentHoldExpiry";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

export type CatalogStockHoldStatus = "active" | "consumed" | "released" | "expired";

export type CatalogStockHold = {
  id: string;
  attemptId: string;
  plantVariantId: string;
  quantity: number;
  status: CatalogStockHoldStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CatalogHoldRequestLine = {
  plantVariantId: string;
  quantity: number;
};

export type CatalogStockHoldErrorCode =
  | "invalid_quantity"
  | "variant_not_found"
  | "attempt_not_found"
  | "not_catalog_attempt"
  | "insufficient_quantity"
  | "already_held";

export class CatalogStockHoldError extends Error {
  readonly code: CatalogStockHoldErrorCode;

  constructor(code: CatalogStockHoldErrorCode, message: string) {
    super(message);
    this.name = "CatalogStockHoldError";
    this.code = code;
  }
}

type HoldRow = {
  id: string;
  attempt_id: string;
  plant_variant_id: string;
  quantity: string | number;
  status: string;
  expires_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
};

const HOLD_STATUSES = new Set<CatalogStockHoldStatus>([
  "active",
  "consumed",
  "released",
  "expired",
]);

function mapHoldRow(row: HoldRow): CatalogStockHold {
  const status = HOLD_STATUSES.has(row.status as CatalogStockHoldStatus)
    ? (row.status as CatalogStockHoldStatus)
    : "expired";
  const expiresAt = toIsoString(row.expires_at);
  const createdAt = toIsoString(row.created_at);
  const updatedAt = toIsoString(row.updated_at);
  if (!expiresAt || !createdAt || !updatedAt) {
    throw new Error("catalog_stock_holds timestamps are required");
  }
  return {
    id: String(row.id),
    attemptId: String(row.attempt_id),
    plantVariantId: String(row.plant_variant_id),
    quantity: parseNumeric(row.quantity),
    status,
    expiresAt,
    createdAt,
    updatedAt,
  };
}

function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function aggregateLines(lines: CatalogHoldRequestLine[]): Map<string, number> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new CatalogStockHoldError(
      "invalid_quantity",
      "At least one plant variant quantity is required",
    );
  }
  const totals = new Map<string, number>();
  for (const line of lines) {
    const variantId = line.plantVariantId?.trim() ?? "";
    if (!variantId) {
      throw new CatalogStockHoldError("variant_not_found", "Plant variant is required");
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new CatalogStockHoldError(
        "invalid_quantity",
        "Hold quantity must be a positive integer",
      );
    }
    totals.set(variantId, (totals.get(variantId) ?? 0) + line.quantity);
  }
  return totals;
}

async function canonicalPlantVariantTotals(
  totals: Map<string, number>,
): Promise<Map<string, number>> {
  const variantIds = [...totals.keys()];
  let rows: { id: string }[];
  try {
    rows = (await sql`
      SELECT id
      FROM plant_variants
      WHERE id = ANY(${variantIds}::uuid[])
    `) as { id: string }[];
  } catch (error) {
    if (pgCode(error) === "22P02") {
      throw new CatalogStockHoldError(
        "variant_not_found",
        "Catalog holds are plant variants only",
      );
    }
    throw error;
  }
  const byLower = new Map(
    (rows as { id: string }[]).map((row) => [String(row.id).toLowerCase(), String(row.id)]),
  );
  const canonical = new Map<string, number>();
  for (const [variantId, quantity] of totals) {
    const storedId = byLower.get(variantId.toLowerCase());
    if (!storedId) {
      throw new CatalogStockHoldError(
        "variant_not_found",
        "Catalog holds are plant variants only",
      );
    }
    canonical.set(storedId, (canonical.get(storedId) ?? 0) + quantity);
  }
  return canonical;
}

async function assertCatalogAttempt(attemptId: string): Promise<void> {
  const rows = await sql`
    SELECT channel
    FROM payment_attempts
    WHERE id = ${attemptId}::uuid
    LIMIT 1
  `;
  const channel = (rows as { channel: string }[])[0]?.channel;
  if (!channel) {
    throw new CatalogStockHoldError("attempt_not_found", "Payment attempt not found");
  }
  if (channel !== "catalog") {
    throw new CatalogStockHoldError(
      "not_catalog_attempt",
      "Catalog holds require a catalog payment attempt",
    );
  }
}

function mapAcquireError(error: unknown, attemptId: string): Promise<never> {
  return (async () => {
    if (error instanceof CatalogStockHoldError) throw error;
    const code = pgCode(error);
    const message = errorMessage(error);
    if (code === "23505") {
      throw new CatalogStockHoldError(
        "already_held",
        "This payment attempt already holds that plant variant",
      );
    }
    if (code === "23503" && /payment_attempts/i.test(message)) {
      throw new CatalogStockHoldError("attempt_not_found", "Payment attempt not found");
    }
    if (code === "23503") {
      throw new CatalogStockHoldError(
        "variant_not_found",
        "Catalog holds are plant variants only",
      );
    }
    if (/division by zero/i.test(message)) {
      const existing = await sql`
        SELECT 1
        FROM catalog_stock_holds
        WHERE attempt_id = ${attemptId}::uuid
        LIMIT 1
      `;
      if ((existing as unknown[]).length > 0) {
        throw new CatalogStockHoldError(
          "already_held",
          "This payment attempt already has catalog stock holds",
        );
      }
      throw new CatalogStockHoldError(
        "insufficient_quantity",
        "Not enough catalog stock to hold",
      );
    }
    throw error;
  })();
}

/**
 * Reserve aggregated plant-variant quantities for one catalog attempt.
 * Same variant on multiple lines becomes one hold. Inventory quantity is unchanged.
 */
export async function acquireCatalogStockHolds(input: {
  attemptId: string;
  lines: CatalogHoldRequestLine[];
}): Promise<CatalogStockHold[]> {
  const attemptId = input.attemptId.trim();
  if (!attemptId) {
    throw new CatalogStockHoldError("attempt_not_found", "Payment attempt not found");
  }
  const totals = await canonicalPlantVariantTotals(aggregateLines(input.lines));
  const variantIds = [...totals.keys()].sort();
  await assertCatalogAttempt(attemptId);

  const payload = JSON.stringify(
    variantIds.map((plantVariantId) => ({
      plantVariantId,
      quantity: totals.get(plantVariantId),
    })),
  );

  const lockQueries = variantIds.map(
    (variantId) => sql`
        SELECT pg_advisory_xact_lock(
          hashtext('catalog_stock_hold'),
          hashtext(${variantId}::text)
        )
    `,
  );

  try {
    await sql.transaction([
      ...lockQueries,
      sql`
        SELECT id
        FROM payment_attempts
        WHERE id = ${attemptId}::uuid
          AND channel = 'catalog'
        FOR UPDATE
      `,
      sql`
        WITH requested AS (
          SELECT
            (elem->>'plantVariantId')::uuid AS plant_variant_id,
            (elem->>'quantity')::int AS quantity
          FROM jsonb_array_elements(${payload}::jsonb) AS elem
        ),
        availability AS (
          SELECT
            r.plant_variant_id,
            r.quantity,
            GREATEST(
              COALESCE(i.quantity, 0) - COALESCE((
                SELECT SUM(h.quantity)::int
                FROM catalog_stock_holds h
                WHERE h.plant_variant_id = r.plant_variant_id
                  AND h.status = 'active'
                  AND h.expires_at > now()
              ), 0),
              0
            ) AS available_qty
          FROM requested r
          LEFT JOIN inventory i ON i.variant_id = r.plant_variant_id
        ),
        ins AS (
          INSERT INTO catalog_stock_holds (
            attempt_id,
            plant_variant_id,
            quantity,
            status,
            expires_at,
            created_at,
            updated_at
          )
          SELECT
            ${attemptId}::uuid,
            a.plant_variant_id,
            a.quantity,
            'active',
            now() + (${PAYMENT_HOLD_TTL_MS} * interval '1 millisecond'),
            now(),
            now()
          FROM availability a
          WHERE NOT EXISTS (
            SELECT 1
            FROM catalog_stock_holds existing
            WHERE existing.attempt_id = ${attemptId}::uuid
          )
            AND NOT EXISTS (
              SELECT 1
              FROM availability short
              WHERE short.quantity > short.available_qty
            )
          RETURNING id
        )
        SELECT 1 / (
          CASE
            WHEN (SELECT COUNT(*)::int FROM ins) = ${variantIds.length} THEN 1
            ELSE 0
          END
        ) AS hold_ok
      `,
    ]);
  } catch (error) {
    await mapAcquireError(error, attemptId);
  }

  return listCatalogStockHoldsForAttempt(attemptId);
}

export async function listCatalogStockHoldsForAttempt(
  attemptId: string,
): Promise<CatalogStockHold[]> {
  const id = attemptId.trim();
  if (!id) return [];
  const rows = await sql`
    SELECT
      id,
      attempt_id,
      plant_variant_id,
      quantity,
      status,
      expires_at,
      created_at,
      updated_at
    FROM catalog_stock_holds
    WHERE attempt_id = ${id}::uuid
    ORDER BY plant_variant_id ASC, id ASC
  `;
  return (rows as HoldRow[]).map(mapHoldRow);
}

/** Central quantity minus active holds that have not reached expires_at. */
export async function getCatalogAvailableQuantity(plantVariantId: string): Promise<number> {
  const id = plantVariantId.trim();
  if (!id) return 0;
  const rows = await sql`
    SELECT GREATEST(
      COALESCE((
        SELECT quantity
        FROM inventory
        WHERE variant_id = ${id}::uuid
      ), 0) - COALESCE((
        SELECT SUM(quantity)::int
        FROM catalog_stock_holds
        WHERE plant_variant_id = ${id}::uuid
          AND status = 'active'
          AND expires_at > now()
      ), 0),
      0
    )::int AS available
  `;
  return parseNumeric((rows as { available: string | number }[])[0]?.available);
}

/** Cancel active holds for an attempt. Does not change inventory. */
export async function releaseCatalogStockHolds(attemptId: string): Promise<number> {
  const id = attemptId.trim();
  if (!id) return 0;
  const rows = await sql`
    UPDATE catalog_stock_holds
    SET status = 'released', updated_at = now()
    WHERE attempt_id = ${id}::uuid
      AND status = 'active'
    RETURNING id
  `;
  return (rows as unknown[]).length;
}

/**
 * Mark active holds past expires_at as expired.
 * Optional attemptId limits the update to one attempt.
 */
export async function expireStaleCatalogStockHolds(options?: {
  attemptId?: string;
}): Promise<number> {
  const attemptId = options?.attemptId?.trim() || null;
  const rows = attemptId
    ? await sql`
        UPDATE catalog_stock_holds
        SET status = 'expired', updated_at = now()
        WHERE status = 'active'
          AND expires_at <= now()
          AND attempt_id = ${attemptId}::uuid
        RETURNING id
      `
    : await sql`
        UPDATE catalog_stock_holds
        SET status = 'expired', updated_at = now()
        WHERE status = 'active'
          AND expires_at <= now()
        RETURNING id
      `;
  return (rows as unknown[]).length;
}

/**
 * Mark this attempt's still-active unexpired holds consumed.
 * Inventory decrement belongs to catalog finalization, not this step.
 */
export async function consumeCatalogStockHolds(attemptId: string): Promise<number> {
  const id = attemptId.trim();
  if (!id) return 0;
  const rows = await sql`
    UPDATE catalog_stock_holds
    SET status = 'consumed', updated_at = now()
    WHERE attempt_id = ${id}::uuid
      AND status = 'active'
      AND expires_at > now()
    RETURNING id
  `;
  return (rows as unknown[]).length;
}

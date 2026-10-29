/**
 * Catalog stock reservations.
 * A hold is either a Plant Size or a Catalog Pot, never both and never a Variant.
 * Available plant quantity = inventory.quantity - active unexpired plant holds.
 * Available pot quantity = pot_inventory.quantity - active unexpired pot holds.
 * A missing pot inventory row is 0.
 * Acquire, release, expire, and consume do not change inventory quantities.
 */

import "server-only";

import { sql } from "@/lib/db";
import { PAYMENT_HOLD_TTL_MS } from "@/lib/paymentHoldExpiry";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

export type CatalogStockHoldStatus = "active" | "consumed" | "released" | "expired";

export type CatalogStockHold = {
  id: string;
  attemptId: string;
  plantVariantId: string | null;
  potId: string | null;
  quantity: number;
  status: CatalogStockHoldStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CatalogHoldRequestLine = {
  plantVariantId?: string | null;
  potId?: string | null;
  quantity: number;
};

export type CatalogStockHoldErrorCode =
  | "invalid_quantity"
  | "variant_not_found"
  | "color_not_found"
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
  plant_variant_id: string | null;
  pot_id: string | null;
  quantity: string | number;
  status: string;
  expires_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
};

type HoldResource = { kind: "plant" | "color"; id: string; quantity: number };

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
    plantVariantId: row.plant_variant_id ? String(row.plant_variant_id) : null,
    potId: row.pot_id ? String(row.pot_id) : null,
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

function aggregateLines(lines: CatalogHoldRequestLine[]): HoldResource[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new CatalogStockHoldError("invalid_quantity", "At least one hold quantity is required");
  }
  const totals = new Map<string, HoldResource>();
  for (const line of lines) {
    const plantId = line.plantVariantId?.trim() || "";
    const colorId = line.potId?.trim() || "";
    if ((plantId && colorId) || (!plantId && !colorId)) {
      throw new CatalogStockHoldError(
        "invalid_quantity",
        "A catalog hold is a plant size or a pot",
      );
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new CatalogStockHoldError("invalid_quantity", "Hold quantity must be a positive integer");
    }
    const kind = plantId ? "plant" : "color";
    const id = plantId || colorId;
    const key = `${kind}:${id.toLowerCase()}`;
    const existing = totals.get(key);
    if (existing) existing.quantity += line.quantity;
    else totals.set(key, { kind, id, quantity: line.quantity });
  }
  return [...totals.values()];
}

async function canonicalResources(resources: HoldResource[]): Promise<HoldResource[]> {
  const plantIds = resources.filter((row) => row.kind === "plant").map((row) => row.id);
  const colorIds = resources.filter((row) => row.kind === "color").map((row) => row.id);
  let plantRows: { id: string }[] = [];
  let colorRows: { id: string }[] = [];
  try {
    if (plantIds.length > 0) {
      plantRows = (await sql`
        SELECT id::text AS id FROM plant_variants WHERE id = ANY(${plantIds}::uuid[])
      `) as { id: string }[];
    }
    if (colorIds.length > 0) {
      colorRows = (await sql`
        SELECT id::text AS id FROM pots WHERE id = ANY(${colorIds}::uuid[])
      `) as { id: string }[];
    }
  } catch (error) {
    if (pgCode(error) === "22P02") {
      throw new CatalogStockHoldError("variant_not_found", "Catalog hold resource was not found");
    }
    throw error;
  }
  const plants = new Map(plantRows.map((row) => [row.id.toLowerCase(), row.id]));
  const colors = new Map(colorRows.map((row) => [row.id.toLowerCase(), row.id]));
  const canonical = new Map<string, HoldResource>();
  for (const resource of resources) {
    const stored =
      resource.kind === "plant"
        ? plants.get(resource.id.toLowerCase())
        : colors.get(resource.id.toLowerCase());
    if (!stored) {
      throw new CatalogStockHoldError(
        resource.kind === "plant" ? "variant_not_found" : "color_not_found",
        resource.kind === "plant" ? "Plant size was not found" : "Pot was not found",
      );
    }
    const key = `${resource.kind}:${stored}`;
    const existing = canonical.get(key);
    if (existing) existing.quantity += resource.quantity;
    else canonical.set(key, { kind: resource.kind, id: stored, quantity: resource.quantity });
  }
  return [...canonical.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function assertCatalogAttempt(attemptId: string): Promise<void> {
  const rows = await sql`
    SELECT channel
    FROM payment_attempts
    WHERE id = ${attemptId}::uuid
    LIMIT 1
  `;
  const channel = (rows as { channel: string }[])[0]?.channel;
  if (!channel) throw new CatalogStockHoldError("attempt_not_found", "Payment attempt not found");
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
      throw new CatalogStockHoldError("already_held", "This payment attempt already holds that resource");
    }
    if (code === "23503" && /payment_attempts/i.test(message)) {
      throw new CatalogStockHoldError("attempt_not_found", "Payment attempt not found");
    }
    if (code === "23514" || (code === "23503" && /pots/i.test(message))) {
      throw new CatalogStockHoldError("color_not_found", "Pot was not found");
    }
    if (code === "23503") {
      throw new CatalogStockHoldError("variant_not_found", "Plant size was not found");
    }
    if (/division by zero/i.test(message)) {
      const existing = await sql`
        SELECT 1 FROM catalog_stock_holds WHERE attempt_id = ${attemptId}::uuid LIMIT 1
      `;
      if ((existing as unknown[]).length > 0) {
        throw new CatalogStockHoldError(
          "already_held",
          "This payment attempt already has catalog stock holds",
        );
      }
      throw new CatalogStockHoldError("insufficient_quantity", "Not enough catalog stock to hold");
    }
    throw error;
  })();
}

/**
 * Reserve plant-size and pot-color quantities for one catalog attempt.
 * Same resource on multiple lines becomes one hold. Inventory quantity is unchanged.
 * A short plant or color bucket inserts nothing.
 */
export async function acquireCatalogStockHolds(input: {
  attemptId: string;
  lines: CatalogHoldRequestLine[];
}): Promise<CatalogStockHold[]> {
  const attemptId = input.attemptId.trim();
  if (!attemptId) throw new CatalogStockHoldError("attempt_not_found", "Payment attempt not found");
  const resources = await canonicalResources(aggregateLines(input.lines));
  await assertCatalogAttempt(attemptId);
  const payload = JSON.stringify(
    resources.map((resource) => ({
      kind: resource.kind,
      id: resource.id,
      quantity: resource.quantity,
    })),
  );
  const lockQueries = resources.map(
    (resource) => sql`
      SELECT pg_advisory_xact_lock(
        hashtext('catalog_stock_hold'),
        hashtext(${resource.id}::text)
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
            elem->>'kind' AS kind,
            (elem->>'id')::uuid AS resource_id,
            (elem->>'quantity')::int AS quantity
          FROM jsonb_array_elements(${payload}::jsonb) AS elem
        ),
        availability AS (
          SELECT
            r.kind,
            r.resource_id,
            r.quantity,
            CASE
              WHEN r.kind = 'plant' THEN GREATEST(
                COALESCE((SELECT i.quantity FROM inventory i WHERE i.variant_id = r.resource_id), 0)
                - COALESCE((
                  SELECT SUM(h.quantity)::int
                  FROM catalog_stock_holds h
                  WHERE h.plant_variant_id = r.resource_id
                    AND h.status = 'active'
                    AND h.expires_at > now()
                ), 0),
                0
              )
              ELSE GREATEST(
                COALESCE((SELECT pi.quantity FROM pot_inventory pi WHERE pi.pot_id = r.resource_id), 0)
                - COALESCE((
                  SELECT SUM(h.quantity)::int
                  FROM catalog_stock_holds h
                  WHERE h.pot_id = r.resource_id
                    AND h.status = 'active'
                    AND h.expires_at > now()
                ), 0),
                0
              )
            END AS available_qty
          FROM requested r
        ),
        ins AS (
          INSERT INTO catalog_stock_holds (
            attempt_id,
            plant_variant_id,
            pot_id,
            quantity,
            status,
            expires_at,
            created_at,
            updated_at
          )
          SELECT
            ${attemptId}::uuid,
            CASE WHEN a.kind = 'plant' THEN a.resource_id ELSE NULL END,
            CASE WHEN a.kind = 'color' THEN a.resource_id ELSE NULL END,
            a.quantity,
            'active',
            now() + (${PAYMENT_HOLD_TTL_MS} * interval '1 millisecond'),
            now(),
            now()
          FROM availability a
          WHERE NOT EXISTS (
            SELECT 1 FROM catalog_stock_holds existing WHERE existing.attempt_id = ${attemptId}::uuid
          )
            AND NOT EXISTS (
              SELECT 1 FROM availability short WHERE short.quantity > short.available_qty
            )
          RETURNING id
        )
        SELECT 1 / (
          CASE
            WHEN (SELECT COUNT(*)::int FROM ins) = ${resources.length} THEN 1
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
      pot_id,
      quantity,
      status,
      expires_at,
      created_at,
      updated_at
    FROM catalog_stock_holds
    WHERE attempt_id = ${id}::uuid
    ORDER BY plant_variant_id ASC NULLS LAST, pot_id ASC NULLS LAST, id ASC
  `;
  return (rows as HoldRow[]).map(mapHoldRow);
}

/** Central plant quantity minus active holds that have not reached expires_at. */
export async function getCatalogAvailableQuantity(plantVariantId: string): Promise<number> {
  const id = plantVariantId.trim();
  if (!id) return 0;
  const rows = await sql`
    SELECT GREATEST(
      COALESCE((SELECT quantity FROM inventory WHERE variant_id = ${id}::uuid), 0)
      - COALESCE((
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

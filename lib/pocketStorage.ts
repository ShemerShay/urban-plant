import { sql } from "@/lib/db";
import { toIsoString } from "@/lib/storageUtils";

import type { Pocket } from "./pocketTypes";

export type PocketRow = {
  id: string;
  partner_location_id: string;
  name: string;
  created_at: string | Date;
};

const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";

export class PocketNameConflictError extends Error {
  constructor() {
    super("A pocket with this name already exists for this partner");
    this.name = "PocketNameConflictError";
  }
}

export class PocketHasAssignedSpotsError extends Error {
  readonly assignedCount: number;

  constructor(assignedCount: number) {
    super(
      `Cannot delete pocket while ${assignedCount} POS spot(s) are assigned. Move or unassign them first.`,
    );
    this.name = "PocketHasAssignedSpotsError";
    this.assignedCount = assignedCount;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505",
  );
}

export function mapPocketRow(row: PocketRow): Pocket {
  return {
    id: row.id,
    partnerLocationId: row.partner_location_id,
    name: row.name.trim(),
    createdAt: toIsoString(row.created_at) ?? SEED_CREATED_AT,
  };
}

export async function readPocketsByPartner(partnerLocationId: string): Promise<Pocket[]> {
  const trimmed = partnerLocationId.trim();
  if (!trimmed) return [];
  const rows = await sql`
    SELECT id, partner_location_id, name, created_at
    FROM pockets
    WHERE partner_location_id = ${trimmed}
    ORDER BY lower(name) ASC, created_at ASC
  `;
  return (rows as PocketRow[]).map(mapPocketRow);
}

export async function getPocketById(id: string): Promise<Pocket | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT id, partner_location_id, name, created_at
    FROM pockets
    WHERE id = ${trimmed}::uuid
    LIMIT 1
  `;
  const row = (rows as PocketRow[])[0];
  return row ? mapPocketRow(row) : undefined;
}

export async function createPocket(input: {
  partnerLocationId: string;
  name: string;
}): Promise<Pocket> {
  const partnerLocationId = input.partnerLocationId.trim();
  const name = input.name.trim();
  if (!partnerLocationId || !name) {
    throw new Error("partnerLocationId and name are required");
  }

  try {
    const rows = await sql`
      INSERT INTO pockets (partner_location_id, name)
      VALUES (${partnerLocationId}, ${name})
      RETURNING id, partner_location_id, name, created_at
    `;
    const row = (rows as PocketRow[])[0];
    if (!row) throw new Error("Could not create pocket");
    return mapPocketRow(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw new PocketNameConflictError();
    throw err;
  }
}

export async function updatePocket(
  id: string,
  patch: { name: string },
): Promise<Pocket | null> {
  const trimmedId = id.trim();
  const name = patch.name.trim();
  if (!trimmedId || !name) return null;

  try {
    const rows = await sql`
      UPDATE pockets
      SET name = ${name}
      WHERE id = ${trimmedId}::uuid
      RETURNING id, partner_location_id, name, created_at
    `;
    const row = (rows as PocketRow[])[0];
    return row ? mapPocketRow(row) : null;
  } catch (err) {
    if (isUniqueViolation(err)) throw new PocketNameConflictError();
    throw err;
  }
}

export async function countPosSpotsForPocket(pocketId: string): Promise<number> {
  const trimmed = pocketId.trim();
  if (!trimmed) return 0;
  const rows = await sql`
    SELECT count(*)::int AS count
    FROM pos_spots
    WHERE pocket_id = ${trimmed}::uuid
  `;
  const count = (rows as { count: number }[])[0]?.count;
  return typeof count === "number" ? count : 0;
}

/**
 * Delete a pocket. POS rows in the pocket are unassigned (pocket_id = null).
 * Remaining plant occupancy is Removed. Flower offers and sold leftover offers are kept.
 * Spot rows, slugs, and numbers are preserved. Status and payment holds are left unchanged.
 */
export async function deletePocket(id: string): Promise<{
  deleted: boolean;
  inactivatedCount: number;
}> {
  const trimmed = id.trim();
  if (!trimmed) return { deleted: false, inactivatedCount: 0 };

  const inactivatedQuery = sql`
    WITH old AS (
      SELECT id, plant_variant_id
      FROM pos_spots
      WHERE pocket_id = ${trimmed}::uuid
    ),
    cleared AS (
      UPDATE pos_spots p
      SET
        plant_variant_id = NULL,
        current_offer_id = CASE
          WHEN p.status = 'sold' THEN p.current_offer_id
          WHEN EXISTS (
            SELECT 1
            FROM offers o
            INNER JOIN plants pl ON pl.id = o.product_id
            WHERE o.id = p.current_offer_id
              AND COALESCE(pl.inventory_type, 'plants') = 'flowers'
          ) THEN p.current_offer_id
          ELSE NULL
        END,
        offer_placed_at = CASE
          WHEN p.status = 'sold' THEN p.offer_placed_at
          WHEN EXISTS (
            SELECT 1
            FROM offers o
            INNER JOIN plants pl ON pl.id = o.product_id
            WHERE o.id = p.current_offer_id
              AND COALESCE(pl.inventory_type, 'plants') = 'flowers'
          ) THEN p.offer_placed_at
          ELSE NULL
        END,
        pocket_id = NULL
      WHERE p.pocket_id = ${trimmed}::uuid
      RETURNING p.id, p.plant_variant_id AS new_variant_id
    ),
    closed AS (
      UPDATE placement_cycles c
      SET
        ended_at = now(),
        end_reason = 'removed'
      FROM old
      INNER JOIN cleared ON cleared.id = old.id
      WHERE c.pos_spot_id = old.id
        AND c.ended_at IS NULL
        AND old.plant_variant_id IS NOT NULL
        AND cleared.new_variant_id IS NULL
      RETURNING c.id
    )
    SELECT cleared.id
    FROM cleared
    CROSS JOIN (SELECT COUNT(*)::int AS n FROM closed) closed_done
  `;
  const deleteQuery = sql`
    DELETE FROM pockets
    WHERE id = ${trimmed}::uuid
    RETURNING id
  `;
  const results = await sql.transaction([inactivatedQuery, deleteQuery]);
  const inactivated = (results[0] ?? []) as { id: string }[];
  const inactivatedCount = inactivated.length;
  const rows = (results[1] ?? []) as { id: string }[];
  return {
    deleted: (rows as { id: string }[]).length > 0,
    inactivatedCount,
  };
}

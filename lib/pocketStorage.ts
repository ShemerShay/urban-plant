import { sql } from "@/lib/db";
import { toIsoString } from "@/lib/storageUtils";

import type { Pocket } from "./pocketTypes";

type PocketRow = {
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

function mapPocketRow(row: PocketRow): Pocket {
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
 * Delete a pocket. Assigned POS spots are set inactive and unassigned (pocket_id = null).
 * Spot rows, slugs, and numbers are preserved for historical Orders / Events / QR identity.
 */
export async function deletePocket(id: string): Promise<{
  deleted: boolean;
  inactivatedCount: number;
}> {
  const trimmed = id.trim();
  if (!trimmed) return { deleted: false, inactivatedCount: 0 };

  const inactivated = await sql`
    UPDATE pos_spots
    SET
      status = 'inactive',
      pocket_id = NULL
    WHERE pocket_id = ${trimmed}::uuid
    RETURNING id
  `;
  const inactivatedCount = (inactivated as { id: string }[]).length;

  const rows = await sql`
    DELETE FROM pockets
    WHERE id = ${trimmed}::uuid
    RETURNING id
  `;
  return {
    deleted: (rows as { id: string }[]).length > 0,
    inactivatedCount,
  };
}

/**
 * POS Spots are the stable physical QR anchors. Local availability lives here.
 */

import { sql } from "@/lib/db";
import { toIsoString } from "@/lib/storageUtils";

import type { MaintenanceStatus, PosSpot, PosSpotStatus } from "./posSpotTypes";

const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";

function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function posSpotSlugPart(value: string): string {
  return slugPart(value);
}

export function defaultPosSpotId(partnerLocationId: string, productId: string): string {
  return `pos-${slugPart(partnerLocationId)}-${slugPart(productId)}`;
}

export function defaultSpotSlug(partnerLocationId: string, productId: string): string {
  return `${slugPart(partnerLocationId)}-${slugPart(productId)}`;
}

type PosSpotRow = {
  id: string;
  partner_location_id: string;
  pos_number: string | null;
  spot_description: string;
  placement_notes: string | null;
  spot_slug: string;
  current_offer_id: string;
  status: string;
  placed_at: string | Date | null;
  latest_maintenance_status: string | null;
  last_checked_at: string | Date | null;
  last_watered_at: string | Date | null;
  last_handled_at: string | Date | null;
  last_handled_by: string | null;
  created_at: string | Date;
};

function normalizeStatus(value: string): PosSpotStatus {
  if (value === "sold" || value === "inactive") return value;
  return "available";
}

function normalizeMaintenanceStatus(value: string | null): MaintenanceStatus | undefined {
  if (value === "checked" || value === "needs_watering" || value === "needs_treatment") {
    return value;
  }
  return undefined;
}

function mapPosSpotRow(row: PosSpotRow): PosSpot {
  const latestMaintenanceStatus = normalizeMaintenanceStatus(row.latest_maintenance_status);
  const placedAt = toIsoString(row.placed_at);
  const lastCheckedAt = toIsoString(row.last_checked_at);
  const lastWateredAt = toIsoString(row.last_watered_at);
  const lastHandledAt = toIsoString(row.last_handled_at);
  const createdAt = toIsoString(row.created_at) ?? SEED_CREATED_AT;
  const posNumber =
    typeof row.pos_number === "string" && row.pos_number.trim() ? row.pos_number.trim() : undefined;
  const placementNotes =
    typeof row.placement_notes === "string" && row.placement_notes.trim()
      ? row.placement_notes.trim()
      : undefined;
  const lastHandledBy =
    typeof row.last_handled_by === "string" && row.last_handled_by.trim()
      ? row.last_handled_by.trim()
      : undefined;

  return {
    id: row.id,
    partnerLocationId: row.partner_location_id,
    ...(posNumber ? { posNumber } : {}),
    spotDescription: row.spot_description,
    ...(placementNotes ? { placementNotes } : {}),
    spotSlug: row.spot_slug,
    currentOfferId: row.current_offer_id,
    status: normalizeStatus(row.status),
    ...(placedAt ? { placedAt } : {}),
    ...(latestMaintenanceStatus ? { latestMaintenanceStatus } : {}),
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
    ...(lastWateredAt ? { lastWateredAt } : {}),
    ...(lastHandledAt ? { lastHandledAt } : {}),
    ...(lastHandledBy ? { lastHandledBy } : {}),
    createdAt,
  };
}

export async function readPosSpots(): Promise<PosSpot[]> {
  const rows = await sql`
    SELECT
      id,
      partner_location_id,
      pos_number,
      spot_description,
      placement_notes,
      spot_slug,
      current_offer_id,
      status,
      placed_at,
      latest_maintenance_status,
      last_checked_at,
      last_watered_at,
      last_handled_at,
      last_handled_by,
      created_at
    FROM pos_spots
    ORDER BY created_at ASC
  `;
  return (rows as PosSpotRow[]).map(mapPosSpotRow);
}

export async function savePosSpots(spots: PosSpot[]): Promise<void> {
  await sql`DELETE FROM pos_spots`;
  for (const spot of spots) {
    await insertPosSpot(spot);
  }
}

async function insertPosSpot(posSpot: PosSpot): Promise<void> {
  await sql`
    INSERT INTO pos_spots (
      id,
      partner_location_id,
      pos_number,
      spot_description,
      placement_notes,
      spot_slug,
      current_offer_id,
      status,
      placed_at,
      latest_maintenance_status,
      last_checked_at,
      last_watered_at,
      last_handled_at,
      last_handled_by,
      created_at
    )
    VALUES (
      ${posSpot.id},
      ${posSpot.partnerLocationId},
      ${posSpot.posNumber ?? null},
      ${posSpot.spotDescription},
      ${posSpot.placementNotes ?? null},
      ${posSpot.spotSlug},
      ${posSpot.currentOfferId},
      ${posSpot.status},
      ${posSpot.placedAt ?? null}::timestamptz,
      ${posSpot.latestMaintenanceStatus ?? null},
      ${posSpot.lastCheckedAt ?? null}::timestamptz,
      ${posSpot.lastWateredAt ?? null}::timestamptz,
      ${posSpot.lastHandledAt ?? null}::timestamptz,
      ${posSpot.lastHandledBy ?? null},
      ${posSpot.createdAt}::timestamptz
    )
  `;
}

export async function getPosSpotById(id: string): Promise<PosSpot | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT
      id,
      partner_location_id,
      pos_number,
      spot_description,
      placement_notes,
      spot_slug,
      current_offer_id,
      status,
      placed_at,
      latest_maintenance_status,
      last_checked_at,
      last_watered_at,
      last_handled_at,
      last_handled_by,
      created_at
    FROM pos_spots
    WHERE id = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as PosSpotRow[])[0];
  return row ? mapPosSpotRow(row) : undefined;
}

export async function getPosSpotBySpotSlug(spotSlug: string): Promise<PosSpot | undefined> {
  const trimmed = spotSlug.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT
      id,
      partner_location_id,
      pos_number,
      spot_description,
      placement_notes,
      spot_slug,
      current_offer_id,
      status,
      placed_at,
      latest_maintenance_status,
      last_checked_at,
      last_watered_at,
      last_handled_at,
      last_handled_by,
      created_at
    FROM pos_spots
    WHERE spot_slug = ${trimmed} OR id = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as PosSpotRow[])[0];
  return row ? mapPosSpotRow(row) : undefined;
}

export async function setPosSpotStatus(id: string, status: PosSpotStatus): Promise<PosSpot | null> {
  const rows = await sql`
    UPDATE pos_spots
    SET status = ${status}
    WHERE id = ${id}
    RETURNING
      id,
      partner_location_id,
      pos_number,
      spot_description,
      placement_notes,
      spot_slug,
      current_offer_id,
      status,
      placed_at,
      latest_maintenance_status,
      last_checked_at,
      last_watered_at,
      last_handled_at,
      last_handled_by,
      created_at
  `;
  const row = (rows as PosSpotRow[])[0];
  return row ? mapPosSpotRow(row) : null;
}

export async function appendPosSpot(posSpot: PosSpot): Promise<PosSpot> {
  const existing = await sql`
    SELECT id FROM pos_spots
    WHERE id = ${posSpot.id} OR spot_slug = ${posSpot.spotSlug}
    LIMIT 1
  `;
  if ((existing as { id: string }[]).length > 0) {
    throw new Error("POS Spot id or spot slug already exists");
  }
  await insertPosSpot(posSpot);
  return posSpot;
}

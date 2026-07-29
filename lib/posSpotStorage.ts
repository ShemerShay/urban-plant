/**
 * POS Spots are the stable physical QR anchors. Local availability lives here.
 */

import { sql } from "@/lib/db";
import { addCalendarDaysUtc, toIsoDateString, toIsoString, utcCalendarDateString } from "@/lib/storageUtils";

import { normalizePosSpotSlug } from "./posSpotSlugUtils";
import type { PosSpot, PosSpotStatus } from "./posSpotTypes";

const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";

/** Column list for SELECT / RETURNING (keep in sync with migrations). */
const POS_SPOT_ROW_SQL = sql`
  id,
  spot_name,
  partner_location_id,
  pos_number,
  pocket_id,
  pocket,
  pocket_other,
  pos_name,
  spot_description,
  placement_notes,
  spot_slug,
  current_offer_id,
  status,
  offer_placed_at,
  check_status,
  check_by,
  next_check,
  pos_weekly_note,
  created_at
`;

type PosSpotRow = {
  id: string;
  spot_name: string;
  partner_location_id: string;
  pos_number: string | null;
  pocket_id: string | null;
  pocket: string | null;
  pocket_other: string | null;
  pos_name: string | null;
  spot_description: string | null;
  placement_notes: string | null;
  spot_slug: string;
  current_offer_id: string;
  status: string;
  offer_placed_at: string | Date | null;
  check_status: boolean;
  check_by: string | null;
  next_check: string | Date | null;
  pos_weekly_note: string | null;
  created_at: string | Date;
};

function resolvePosName(row: PosSpotRow): string {
  const fromCol = typeof row.pos_name === "string" ? row.pos_name.trim() : "";
  if (fromCol) return fromCol;
  const spotName = typeof row.spot_name === "string" ? row.spot_name.trim() : "";
  if (spotName) return spotName.replace(/_/g, " ");
  const fromDesc = typeof row.spot_description === "string" ? row.spot_description.trim() : "";
  if (fromDesc) return fromDesc;
  const posNum =
    typeof row.pos_number === "string" && row.pos_number.trim() ? row.pos_number.trim() : "";
  if (posNum) return `POS ${posNum}`;
  const slug = row.spot_slug.trim();
  return slug || "POS Spot";
}

function resolveOptionalDescription(row: PosSpotRow, posName: string): string | undefined {
  const desc = typeof row.spot_description === "string" ? row.spot_description.trim() : "";
  if (!desc) return undefined;
  if (desc === posName) return undefined;
  return desc;
}

function normalizeStatus(value: string): PosSpotStatus {
  if (value === "sold" || value === "inactive") return value;
  return "available";
}

/**
 * When `next_check` is before today but the row still has `check_status = true`, treat the spot
 * as unchecked in the API/UI. `next_check` stays on the last due date until someone checks again.
 *
 * TODO: Persist overdue flips and advance reminders via a backend scheduler/cron so the database
 * stays authoritative without relying on PATCH or this read-time rule alone.
 */
function mapPosSpotRow(row: PosSpotRow): PosSpot {
  const offerPlacedAt = toIsoString(row.offer_placed_at);
  const createdAt = toIsoString(row.created_at) ?? SEED_CREATED_AT;
  const posNumber =
    typeof row.pos_number === "string" && row.pos_number.trim() ? row.pos_number.trim() : undefined;
  const pocketId =
    typeof row.pocket_id === "string" && row.pocket_id.trim() ? row.pocket_id.trim() : undefined;
  const pocket =
    typeof row.pocket === "string" && row.pocket.trim() ? row.pocket.trim() : undefined;
  const pocketOther =
    typeof row.pocket_other === "string" && row.pocket_other.trim()
      ? row.pocket_other.trim()
      : undefined;
  const placementNotes =
    typeof row.placement_notes === "string" && row.placement_notes.trim()
      ? row.placement_notes.trim()
      : undefined;
  const noteRaw = typeof row.pos_weekly_note === "string" ? row.pos_weekly_note.trim() : "";
  const posWeeklyNote = noteRaw ? noteRaw : undefined;

  const posName = resolvePosName(row);
  const spotDescription = resolveOptionalDescription(row, posName);
  const spotName =
    typeof row.spot_name === "string" && row.spot_name.trim()
      ? row.spot_name.trim()
      : row.spot_slug.trim();

  const today = utcCalendarDateString();
  const dbChecked = Boolean(row.check_status);
  const nextCheck = toIsoDateString(row.next_check);
  const checkByRaw = typeof row.check_by === "string" && row.check_by.trim() ? row.check_by.trim() : undefined;

  let checkStatus = dbChecked;
  let checkBy = checkByRaw;
  if (dbChecked && nextCheck && nextCheck < today) {
    checkStatus = false;
    checkBy = undefined;
  }

  return {
    id: row.id,
    spotName,
    partnerLocationId: row.partner_location_id,
    ...(posNumber ? { posNumber } : {}),
    ...(pocketId ? { pocketId } : {}),
    ...(pocket ? { pocket } : {}),
    ...(pocketOther ? { pocketOther } : {}),
    posName,
    ...(spotDescription ? { spotDescription } : {}),
    ...(placementNotes ? { placementNotes } : {}),
    spotSlug: row.spot_slug,
    currentOfferId: row.current_offer_id,
    status: normalizeStatus(row.status),
    ...(offerPlacedAt ? { offerPlacedAt } : {}),
    checkStatus,
    ...(checkBy ? { checkBy } : {}),
    ...(nextCheck ? { nextCheck } : {}),
    ...(posWeeklyNote ? { posWeeklyNote } : {}),
    createdAt,
  };
}

export async function readPosSpots(): Promise<PosSpot[]> {
  const rows = await sql`
    SELECT ${POS_SPOT_ROW_SQL}
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
      spot_name,
      partner_location_id,
      pos_number,
      pocket_id,
      pocket,
      pocket_other,
      pos_name,
      spot_description,
      placement_notes,
      spot_slug,
      current_offer_id,
      status,
      offer_placed_at,
      check_status,
      check_by,
      next_check,
      pos_weekly_note,
      created_at
    )
    VALUES (
      ${posSpot.id}::uuid,
      ${posSpot.spotName},
      ${posSpot.partnerLocationId},
      ${posSpot.posNumber ?? null},
      ${posSpot.pocketId ?? null}::uuid,
      ${posSpot.pocket ?? null},
      ${posSpot.pocketOther ?? null},
      ${posSpot.posName},
      ${posSpot.spotDescription ?? null},
      ${posSpot.placementNotes ?? null},
      ${posSpot.spotSlug},
      ${posSpot.currentOfferId},
      ${posSpot.status},
      ${posSpot.offerPlacedAt ?? null}::timestamptz,
      ${posSpot.checkStatus},
      ${posSpot.checkBy ?? null},
      ${posSpot.nextCheck ?? null}::date,
      ${posSpot.posWeeklyNote ?? null},
      ${posSpot.createdAt}::timestamptz
    )
  `;
}

export async function getPosSpotById(id: string): Promise<PosSpot | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT ${POS_SPOT_ROW_SQL}
    FROM pos_spots
    WHERE id = ${trimmed}::uuid
    LIMIT 1
  `;
  const row = (rows as PosSpotRow[])[0];
  return row ? mapPosSpotRow(row) : undefined;
}

export async function getPosSpotBySpotSlug(spotSlug: string): Promise<PosSpot | undefined> {
  const trimmed = spotSlug.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT ${POS_SPOT_ROW_SQL}
    FROM pos_spots
    WHERE spot_slug = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as PosSpotRow[])[0];
  return row ? mapPosSpotRow(row) : undefined;
}

/** When `next_check` is missing, set it to one week from today (UTC calendar date). Idempotent. */
export async function ensurePosSpotNextVisitIfMissing(id: string): Promise<void> {
  const fallback = addCalendarDaysUtc(utcCalendarDateString(), 7);
  await sql`
    UPDATE pos_spots
    SET next_check = ${fallback}::date
    WHERE id = ${id}::uuid AND next_check IS NULL
  `;
}

/**
 * Loads a POS spot by slug and ensures `next_check` is set (week from today when it was null).
 * Intended for the public `/pos/[spotSlug]` page so visitors always see a next visit date.
 */
export async function getPosSpotBySpotSlugEnsuringNextVisit(spotSlug: string): Promise<PosSpot | undefined> {
  const spot = await getPosSpotBySpotSlug(spotSlug);
  if (!spot) return undefined;
  if (!spot.nextCheck) {
    await ensurePosSpotNextVisitIfMissing(spot.id);
    return getPosSpotBySpotSlug(spotSlug);
  }
  return spot;
}

export async function setPosSpotStatus(id: string, status: PosSpotStatus): Promise<PosSpot | null> {
  const rows = await sql`
    UPDATE pos_spots
    SET status = ${status}
    WHERE id = ${id}::uuid
    RETURNING ${POS_SPOT_ROW_SQL}
  `;
  const row = (rows as PosSpotRow[])[0];
  return row ? mapPosSpotRow(row) : null;
}

export async function appendPosSpot(posSpot: PosSpot): Promise<PosSpot> {
  const existing = await sql`
    SELECT id FROM pos_spots
    WHERE spot_slug = ${posSpot.spotSlug} OR spot_name = ${posSpot.spotName}
    LIMIT 1
  `;
  if ((existing as { id: string }[]).length > 0) {
    throw new Error("POS Spot spot name or spot slug already exists");
  }
  await insertPosSpot(posSpot);
  return posSpot;
}

export class PosSpotSlugConflictError extends Error {
  constructor() {
    super("spot slug already in use");
    this.name = "PosSpotSlugConflictError";
  }
}

type PosSpotCheckDbRow = {
  check_status: boolean;
  next_check: string | Date | null;
};

async function getPosSpotCheckDb(id: string): Promise<PosSpotCheckDbRow | undefined> {
  const rows = await sql`
    SELECT check_status, next_check
    FROM pos_spots
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return (rows as PosSpotCheckDbRow[])[0];
}

function computeNextCheckAfterMarkChecked(prev: PosSpotCheckDbRow | undefined): string {
  const today = utcCalendarDateString();
  const prevNext = prev ? toIsoDateString(prev.next_check) : undefined;
  const wasChecked = Boolean(prev?.check_status);
  const needRenewal = !wasChecked || !prevNext || prevNext < today;
  if (needRenewal) return addCalendarDaysUtc(today, 7);
  return prevNext ?? addCalendarDaysUtc(today, 7);
}

/**
 * Updates editable POS fields. Keeps the same row `id` (UUID) so orders and FKs stay valid
 * when `spotSlug` changes (QR URL is derived from `spot_slug`, not from `id`).
 */
export async function updatePosSpot(
  id: string,
  patch: {
    partnerLocationId: string;
    posNumber: string;
    posName: string;
    /** When omitted, existing spot_name is preserved (pocket moves must not rewrite identity). */
    spotName?: string;
    spotDescription?: string;
    /** When omitted, existing spot_slug is preserved. */
    spotSlug?: string;
    pocketId?: string | null;
    updatePocketId?: boolean;
    /** @deprecated Legacy columns; only written when explicitly provided. */
    pocket?: string | null;
    pocketOther?: string | null;
    updateLegacyPocket?: boolean;
    currentOfferId: string;
    checkStatus?: boolean;
    checkBy?: string | null;
    updateCheckFields?: boolean;
    posWeeklyNote?: string | null;
    updatePosWeeklyNote?: boolean;
    offerPlacedAt?: string | null;
    updateOfferPlacedAt?: boolean;
    status?: PosSpotStatus;
    updateStatus?: boolean;
  },
): Promise<PosSpot | null> {
  const trimmedId = id.trim();
  if (!trimmedId) return null;

  const existingRows = await sql`
    SELECT ${POS_SPOT_ROW_SQL}
    FROM pos_spots
    WHERE id = ${trimmedId}::uuid
    LIMIT 1
  `;
  const existingRow = (existingRows as PosSpotRow[])[0];
  if (!existingRow) return null;

  const spotSlugRaw =
    typeof patch.spotSlug === "string" && patch.spotSlug.trim()
      ? patch.spotSlug
      : existingRow.spot_slug;
  const spotSlug = normalizePosSpotSlug(spotSlugRaw);
  if (!spotSlug) return null;

  const spotNameRaw =
    typeof patch.spotName === "string" && patch.spotName.trim()
      ? patch.spotName
      : existingRow.spot_name;
  const spotName = normalizePosSpotSlug(spotNameRaw) || spotSlug;
  const posName = patch.posName.trim();
  if (!posName) return null;

  const conflict = await sql`
    SELECT id FROM pos_spots
    WHERE (spot_slug = ${spotSlug} OR spot_name = ${spotName}) AND id <> ${trimmedId}::uuid
    LIMIT 1
  `;
  if ((conflict as { id: string }[]).length > 0) {
    throw new PosSpotSlugConflictError();
  }

  const posNumberTrimmed = patch.posNumber.trim();
  const posNumber = posNumberTrimmed ? posNumberTrimmed : null;
  const spotDescriptionTrimmed = patch.spotDescription?.trim() ?? "";
  const spotDescription = spotDescriptionTrimmed ? spotDescriptionTrimmed : null;

  const updatePocketId = Boolean(patch.updatePocketId);
  const pocketIdTrimmed =
    typeof patch.pocketId === "string" && patch.pocketId.trim() ? patch.pocketId.trim() : null;
  const pocketIdForSql = updatePocketId ? pocketIdTrimmed : existingRow.pocket_id;

  const updateLegacyPocket = Boolean(patch.updateLegacyPocket);
  const pocketTrimmed = typeof patch.pocket === "string" ? patch.pocket.trim() : "";
  const pocket = pocketTrimmed ? pocketTrimmed : null;
  const pocketOtherTrimmed = typeof patch.pocketOther === "string" ? patch.pocketOther.trim() : "";
  const pocketOther =
    pocket === "other" && pocketOtherTrimmed ? pocketOtherTrimmed : pocket === "other" ? null : null;
  const legacyPocketForSql = updateLegacyPocket ? pocket : existingRow.pocket;
  const legacyPocketOtherForSql = updateLegacyPocket ? pocketOther : existingRow.pocket_other;

  const updateCheck = Boolean(patch.updateCheckFields && typeof patch.checkStatus === "boolean");
  const clearingCheck = updateCheck && patch.checkStatus === false;
  const settingCheck = updateCheck && patch.checkStatus === true;

  const statusIsValid =
    patch.status === "available" || patch.status === "sold" || patch.status === "inactive";
  const updateStatus = Boolean(patch.updateStatus && statusIsValid);
  const statusForSql = updateStatus ? patch.status! : null;

  let nextCheckForSql: string | null = null;
  let checkByForSql: string | null | undefined;

  if (clearingCheck) {
    checkByForSql = null;
  } else if (settingCheck) {
    const prev = await getPosSpotCheckDb(trimmedId);
    nextCheckForSql = computeNextCheckAfterMarkChecked(prev);
    const by = typeof patch.checkBy === "string" ? patch.checkBy.trim() : "";
    checkByForSql = by || null;
  }

  const rows = await sql`
    UPDATE pos_spots
    SET
      partner_location_id = ${patch.partnerLocationId.trim()},
      pos_number = ${posNumber},
      spot_name = ${spotName},
      pocket_id = ${pocketIdForSql}::uuid,
      pocket = ${legacyPocketForSql},
      pocket_other = ${legacyPocketOtherForSql},
      pos_name = ${posName},
      spot_description = ${spotDescription},
      spot_slug = ${spotSlug},
      current_offer_id = ${patch.currentOfferId.trim()},
      check_status = CASE
        WHEN ${updateCheck} THEN ${patch.checkStatus ?? false}
        ELSE check_status
      END,
      check_by = CASE
        WHEN ${clearingCheck} THEN NULL
        WHEN ${settingCheck} THEN ${checkByForSql ?? null}
        ELSE check_by
      END,
      next_check = CASE
        WHEN ${clearingCheck} THEN next_check
        WHEN ${settingCheck} THEN ${nextCheckForSql}::date
        ELSE next_check
      END,
      pos_weekly_note = CASE
        WHEN ${patch.updatePosWeeklyNote ?? false} THEN ${patch.posWeeklyNote ?? null}
        ELSE pos_weekly_note
      END,
      offer_placed_at = CASE
        WHEN ${patch.updateOfferPlacedAt ?? false} THEN ${patch.offerPlacedAt ?? null}::timestamptz
        ELSE offer_placed_at
      END,
      status = CASE
        WHEN ${updateStatus} THEN ${statusForSql}
        ELSE status
      END
    WHERE id = ${trimmedId}::uuid
    RETURNING ${POS_SPOT_ROW_SQL}
  `;

  const row = (rows as PosSpotRow[])[0];
  return row ? mapPosSpotRow(row) : null;
}

export async function readPosSpotsByPartner(partnerLocationId: string): Promise<PosSpot[]> {
  const trimmed = partnerLocationId.trim();
  if (!trimmed) return [];
  const rows = await sql`
    SELECT ${POS_SPOT_ROW_SQL}
    FROM pos_spots
    WHERE partner_location_id = ${trimmed}
    ORDER BY created_at ASC
  `;
  return (rows as PosSpotRow[]).map(mapPosSpotRow);
}

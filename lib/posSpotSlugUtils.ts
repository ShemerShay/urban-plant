/**
 * POS slug / spot_name normalization — safe to import from Client Components (no DB / env side effects).
 *
 * QR identity = Partner name + POS Spot number only.
 * Pocket must never be part of spot_slug / spot_name generation.
 */

/** Legacy hyphen slug (existing rows); kept for backward-compatible normalization. */
function slugPartHyphen(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function posSpotSlugPart(value: string): string {
  return slugPartHyphen(value);
}

/** Normalize one segment for spot_name / spot_slug (underscore-separated). */
export function posSpotSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Normalize a full spot_name / spot_slug string (underscore format). */
export function normalizePosSpotSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Create-time identity: partner + spot number only.
 * Do not pass Pocket — Pocket is physical placement, not QR identity.
 */
export function buildPosSpotNameAndSlug(
  partnerName: string,
  spotNumber: string,
): { spotName: string; spotSlug: string } {
  const parts = [posSpotSegment(partnerName), posSpotSegment(spotNumber)].filter(Boolean);
  const combined = parts.join("_");
  return { spotName: combined, spotSlug: combined };
}

/** Admin display label only — not used for QR / slug. */
export function formatPosSpotDisplayName(
  partnerName: string,
  spotNumber: string,
  pocketName?: string | null,
): string {
  const pocketLabel =
    typeof pocketName === "string" && pocketName.trim() ? pocketName.trim() : "Unassigned";
  return `${partnerName.trim()} · ${spotNumber.trim()} · ${pocketLabel}`;
}

/** @deprecated Use buildPosSpotNameAndSlug(partnerName, spotNumber). */
export function buildPosSpotNameAndSlugFromPocketName(
  partnerName: string,
  spotNumber: string,
  _pocketName?: string,
): { spotName: string; spotSlug: string } {
  return buildPosSpotNameAndSlug(partnerName, spotNumber);
}

/** @deprecated Use formatPosSpotDisplayName. */
export function formatPosSpotDisplayNameFromPocketName(
  partnerName: string,
  spotNumber: string,
  pocketName?: string | null,
): string {
  return formatPosSpotDisplayName(partnerName, spotNumber, pocketName);
}

/** @deprecated Use buildPosSpotNameAndSlug with partner display name. */
export function suggestedPosSpotSlug(partnerLocationId: string, posName: string): string {
  return posSpotSlugPart(`${partnerLocationId}-${posName}`);
}

export function defaultPosSpotId(partnerLocationId: string, productId: string): string {
  return `pos-${slugPartHyphen(partnerLocationId)}-${slugPartHyphen(productId)}`;
}

export function defaultSpotSlug(partnerLocationId: string, productId: string): string {
  return `${slugPartHyphen(partnerLocationId)}-${slugPartHyphen(productId)}`;
}

/** Suggest next ascending POS number for a partner from existing spot numbers. */
export function suggestNextPosNumber(existingPosNumbers: Array<string | undefined>): string {
  let max = 0;
  for (const value of existingPosNumbers) {
    if (typeof value !== "string") continue;
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

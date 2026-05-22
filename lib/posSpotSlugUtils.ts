/**
 * POS slug / spot_name normalization — safe to import from Client Components (no DB / env side effects).
 */

import { pocketNameForSlug } from "./posSpotPocket";

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

export function buildPosSpotNameAndSlug(
  partnerName: string,
  spotNumber: string,
  pocket: string,
  pocketOther?: string,
): { spotName: string; spotSlug: string } {
  const pocketPart = posSpotSegment(pocketNameForSlug(pocket, pocketOther));
  const parts = [
    posSpotSegment(partnerName),
    posSpotSegment(spotNumber),
    pocketPart,
  ].filter(Boolean);
  const combined = parts.join("_");
  return { spotName: combined, spotSlug: combined };
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

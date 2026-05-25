/** Build URLs for POS Spot QRs. */

/** Default POS spot for `/` during pilot. */
export const DEFAULT_POS_SPOT_SLUG = "caf_lev_hair_9_waiting_area";

export function posSpotPath(spotSlug: string): string {
  return `/pos/${encodeURIComponent(spotSlug.trim())}`;
}

export function posSpotCheckoutPath(spotSlug: string): string {
  return `/checkout/pos/${encodeURIComponent(spotSlug.trim())}`;
}

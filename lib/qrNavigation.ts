/** Build URLs for POS Spot QRs. */

export function posSpotPath(spotSlug: string): string {
  return `/pos/${encodeURIComponent(spotSlug.trim())}`;
}

export function posSpotCheckoutPath(spotSlug: string): string {
  return `/checkout/pos/${encodeURIComponent(spotSlug.trim())}`;
}

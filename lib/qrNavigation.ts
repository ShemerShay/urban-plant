/** Build URLs used by legacy plant QRs and new POS Spot QRs. */

export function plantPagePath(plantId: string, locationId?: string | null): string {
  const base = `/plant/${plantId}`;
  const trimmed = typeof locationId === "string" ? locationId.trim() : "";
  return trimmed ? `${base}?location=${encodeURIComponent(trimmed)}` : base;
}

export function checkoutPath(plantId: string, locationId?: string | null): string {
  const base = `/checkout/${plantId}`;
  const trimmed = typeof locationId === "string" ? locationId.trim() : "";
  return trimmed ? `${base}?location=${encodeURIComponent(trimmed)}` : base;
}

export function posSpotPath(spotSlug: string): string {
  return `/pos/${encodeURIComponent(spotSlug.trim())}`;
}

export function posSpotCheckoutPath(spotSlug: string): string {
  return `/checkout/pos/${encodeURIComponent(spotSlug.trim())}`;
}

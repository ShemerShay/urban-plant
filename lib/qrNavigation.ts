/** Build URLs used after scanning a QR with optional `location` query param. */

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

import type { PosSpot, PosSpotStatus } from "@/lib/posSpotTypes";

/** POS statuses that currently hold a live plant on the shelf. */
const WATERABLE_STATUSES = new Set<PosSpotStatus>(["available", "held_for_payment"]);

/** True when a POS spot is eligible to be marked watered. */
export function isPosSpotWaterable(spot: Pick<PosSpot, "status">): boolean {
  return WATERABLE_STATUSES.has(spot.status);
}

/**
 * True when `lastWateredAt` falls within the last `withinDays` calendar days (UTC),
 * counting today. Used for "watered this week" style UI.
 */
export function isWateredRecently(
  lastWateredAt: string | undefined,
  withinDays = 7,
  now: Date = new Date(),
): boolean {
  if (!lastWateredAt?.trim()) return false;
  const wateredMs = Date.parse(lastWateredAt);
  if (Number.isNaN(wateredMs)) return false;
  const cutoffMs = now.getTime() - withinDays * 86_400_000;
  return wateredMs >= cutoffMs;
}

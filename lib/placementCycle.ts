/**
 * Placement Cycle write effect for a POS occupancy mutation.
 * Cycle rows are written in the same SQL statement as the occupancy change.
 */

import type { OccupancyIntent } from "@/lib/posOccupancy";
import type { PosSpotStatus } from "@/lib/posSpotTypes";

export const CYCLE_END_REASONS = ["sold", "removed", "replaced", "deactivated"] as const;

export type CycleEndReason = (typeof CYCLE_END_REASONS)[number];

export type CycleWriteEffect =
  | { kind: "none" }
  | { kind: "open" }
  | { kind: "close"; reason: "removed" | "deactivated" | "sold" }
  | { kind: "replace" };

function trimmedId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Map a POS occupancy write onto Cycle open / close / replace.
 * Flowers never open a Cycle (no occupying variant).
 */
export function cycleEffectForPosWrite(input: {
  occupancyAction?: OccupancyIntent | null;
  existingStatus: PosSpotStatus;
  nextStatus: PosSpotStatus;
  existingVariantId: string | null | undefined;
  nextVariantId: string | null | undefined;
}): CycleWriteEffect {
  const action = input.occupancyAction ?? "update";
  const existingVariant = trimmedId(input.existingVariantId);
  const nextVariant = trimmedId(input.nextVariantId);

  if (action === "replace" || (existingVariant && nextVariant && existingVariant !== nextVariant)) {
    return { kind: "replace" };
  }

  if (action === "place" || (!existingVariant && nextVariant)) {
    return { kind: "open" };
  }

  if (action === "remove" || (existingVariant && !nextVariant)) {
    return existingVariant ? { kind: "close", reason: "removed" } : { kind: "none" };
  }

  if (
    existingVariant &&
    nextVariant &&
    input.nextStatus === "inactive" &&
    input.existingStatus !== "inactive"
  ) {
    return { kind: "close", reason: "deactivated" };
  }

  if (
    existingVariant &&
    nextVariant &&
    input.existingStatus === "inactive" &&
    input.nextStatus !== "inactive"
  ) {
    return { kind: "open" };
  }

  return { kind: "none" };
}

export function cycleSqlFlags(effect: CycleWriteEffect): {
  shouldClose: boolean;
  shouldOpen: boolean;
  closeReason: CycleEndReason;
} {
  if (effect.kind === "replace") {
    return { shouldClose: true, shouldOpen: true, closeReason: "replaced" };
  }
  if (effect.kind === "open") {
    return { shouldClose: false, shouldOpen: true, closeReason: "removed" };
  }
  if (effect.kind === "close") {
    return { shouldClose: true, shouldOpen: false, closeReason: effect.reason };
  }
  return { shouldClose: false, shouldOpen: false, closeReason: "removed" };
}
